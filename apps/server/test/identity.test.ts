import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type IdentityRequest, loadIdentity } from "../src/identity.ts";

const dir = mkdtempSync(join(tmpdir(), "kipscope-identity-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const logs: string[] = [];
const log = {
  info: (m: string) => logs.push(`info ${m}`),
  warn: (m: string) => logs.push(`warn ${m}`),
};

const module_ = (name: string, text: string) => {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
};
const request: IdentityRequest = {
  headers: { "x-user": "carol" },
  peer: "127.0.0.1",
  method: "GET",
  path: "/api/me",
};

describe("identity module loader", () => {
  it("refuses a bad identity module", async () => {
    const missing = join(dir, "does-not-exist.mjs");
    const notFunction = module_("number.mjs", "export default 42;\n");
    const noIdentify = module_("noidentify.mjs", 'export default () => ({ kind: "x" });\n');
    const messageOf = async (path: string) => {
      try {
        await loadIdentity({ kind: "module", path }, { env: {}, log });
      } catch (error) {
        return (error as Error).message;
      }
      return "";
    };
    const a = await messageOf(missing);
    expect(a).toContain("KIPSCOPE_IDENTITY");
    expect(a).toContain(missing);
    const b = await messageOf(notFunction);
    expect(b).toContain("KIPSCOPE_IDENTITY");
    expect(b).toContain("default export");
    const c = await messageOf(noIdentify);
    expect(c).toContain("KIPSCOPE_IDENTITY");
    expect(c).toContain("identify");
  });

  it("refuses factories that return no adapter, or throw", async () => {
    const cases: [string, string, RegExp][] = [
      ["null.mjs", "export default () => null;\n", /KIPSCOPE_IDENTITY/],
      [
        "nokind.mjs",
        "export default () => ({ identify: async () => ({}) });\n",
        /KIPSCOPE_IDENTITY/,
      ],
      [
        "throws.mjs",
        'export default () => { throw new Error("boom-in-factory"); };\n',
        /KIPSCOPE_IDENTITY.*boom-in-factory/s,
      ],
      ["syntax.mjs", "export default (\n", /KIPSCOPE_IDENTITY/],
    ];
    for (const [name, text, pattern] of cases) {
      const path = module_(name, text);
      await expect(loadIdentity({ kind: "module", path }, { env: {}, log }), name).rejects.toThrow(
        pattern,
      );
    }
  });

  it("loads a module by absolute and by relative path and passes env and log", async () => {
    const path = module_(
      "good.mjs",
      `export default async ({ env, log }) => {
  log.info("hello from the module");
  return {
    kind: "mine",
    async identify(request) {
      const user = request.headers["x-user"];
      if (!user) return { refused: "unauthenticated" };
      return { user, roles: [env.ROLE_FOR_TEST ?? "none"] };
    },
  };
};
`,
    );
    for (const spec of [path, relative(process.cwd(), path)]) {
      const adapter = await loadIdentity(
        { kind: "module", path: spec },
        { env: { ROLE_FOR_TEST: "testers" }, log },
      );
      expect(adapter?.kind).toBe("mine");
      expect(await adapter?.identify(request)).toEqual({ user: "carol", roles: ["testers"] });
      expect(await adapter?.identify({ ...request, headers: {} })).toEqual({
        refused: "unauthenticated",
      });
    }
    expect(logs).toContain("info hello from the module");
  });

  it("loads the example forward-header module by its repo path", async () => {
    const adapter = await loadIdentity(
      { kind: "module", path: resolve(import.meta.dirname, "../examples/forward-header.mjs") },
      { env: {}, log },
    );
    expect(adapter?.kind).toEqual(expect.any(String));
    const signedIn = await adapter?.identify({
      headers: { "x-forwarded-user": "alice", "x-forwarded-groups": "testers" },
      peer: "127.0.0.1",
      method: "GET",
      path: "/api/me",
    });
    expect(signedIn).toEqual({ user: "alice", roles: ["testers"] });
  });
});

describe("one place for the credential", () => {
  it("reads the credential and the identity in four files only", () => {
    // grep -rln "authorization\|x-forwarded-user\|identify(" apps/server/src
    const root = resolve(import.meta.dirname, "../src");
    const files: string[] = [];
    const walk = (folder: string) => {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const path = join(folder, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) files.push(path);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(20);
    const hits = files
      .filter((file) =>
        /authorization|x-forwarded-user|identify\(/.test(readFileSync(file, "utf8")),
      )
      .map((file) => relative(root, file))
      .sort();
    expect(hits).toEqual(["config.ts", "guard.ts", "identity.ts", "identity/oidc.ts"]);
  });

  it("decides access in guard.ts and rights.ts only", () => {
    // Routes read the user and the workspace the guard set; none calls the rights functions to decide.
    const root = resolve(import.meta.dirname, "../src/routes");
    for (const name of readdirSync(root)) {
      const text = readFileSync(join(root, name), "utf8");
      expect(text, `${name} calls rightsOf`).not.toMatch(/\brightsOf\(/);
      expect(text, `${name} calls loadRules`).not.toMatch(/\bloadRules\(/);
    }
  });
});
