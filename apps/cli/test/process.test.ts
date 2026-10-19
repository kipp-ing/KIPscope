import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closedUrl, type Harness, startServer } from "./helpers.ts";

const MAIN = resolve(import.meta.dirname, "../src/main.ts");
const ROOT = resolve(import.meta.dirname, "../../..");

function kipscope(
  ...argv: string[]
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const env: Record<string, string | undefined> = { ...process.env, TZ: "Europe/Berlin" };
  delete env.KIPSCOPE_URL;
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [MAIN, ...argv], { cwd: ROOT, env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

describe("separate process", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startServer();
  });
  afterAll(() => h.close());

  it("prints one JSON line on stdout and nothing on stderr", async () => {
    const fresh = await startServer();
    try {
      const result = await kipscope("--server", fresh.url, "diff", "on");
      expect(result.code).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout.endsWith("\n")).toBe(true);
      expect(result.stdout.trimEnd().split("\n")).toHaveLength(1);
      expect(JSON.parse(result.stdout)).toEqual({
        ok: true,
        outcome: "ok",
        exitCode: 0,
        accepted: true,
        command: { type: "cursor.setDiff", diff: true },
        revision: 1,
        // The session the call served (add-multiuser M13): the harness has the one, `0000000000`.
        session: expect.stringMatching(/^[a-z0-9]{10}$/),
      });
    } finally {
      await fresh.close();
    }
  });

  it("prints the reason of a failure on stderr", async () => {
    const result = await kipscope("--server", h.url, "cursor", "move", "b", "+1s");
    expect(result.code).toBe(1);
    expect(result.stdout.trimEnd().split("\n")).toHaveLength(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, outcome: "rejected" });
    expect(result.stderr.trimEnd().split("\n")).toHaveLength(1);
    expect(result.stderr).toContain("cursor_off");

    // `--table` prints its lines on success only: a failure is the JSON line and the reason.
    const table = await kipscope("--server", h.url, "events", "list", "--table", "--ref", "nope");
    expect(table.code).toBe(1);
    expect(table.stdout.trimEnd().split("\n")).toHaveLength(1);
    expect(JSON.parse(table.stdout)).toMatchObject({
      ok: false,
      outcome: "rejected",
      error: { code: "unknown_data_ref" },
    });
    expect(table.stderr.trimEnd().split("\n")).toHaveLength(1);
    expect(table.stderr).toContain("unknown_data_ref");
  });

  it("exits 3 when the server is unreachable", async () => {
    const result = await kipscope("--server", await closedUrl(), "state");
    expect(result.code).toBe(3);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      outcome: "unreachable",
      exitCode: 3,
    });
    expect(result.stderr).toContain("unreachable");
  });

  it("prints the usage with --help and exits 0", async () => {
    const result = await kipscope("--help");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("window create");
    expect(result.stderr).toBe("");
  });
});

describe("view export as a separate process", () => {
  let h: Harness;
  let dir: string;
  beforeAll(async () => {
    h = await startServer();
    dir = mkdtempSync(join(tmpdir(), "kipscope-export-"));
  });
  afterAll(async () => {
    rmSync(dir, { recursive: true, force: true });
    await h.close();
  });

  it("exports a view as YAML text", async () => {
    // Success: the YAML text itself on stdout, nothing on stderr, then the file imports again.
    expect(
      (
        await kipscope(
          "--server",
          h.url,
          "window",
          "create",
          "--title",
          "Speeds",
          "--from",
          "0",
          "--to",
          "10",
        )
      ).code,
    ).toBe(0);
    expect((await kipscope("--server", h.url, "view", "save", "Speeds")).code).toBe(0);

    const exported = await kipscope("--server", h.url, "view", "export", "speeds");
    expect(exported.code).toBe(0);
    expect(exported.stderr).toBe("");
    expect(exported.stdout.startsWith("kipscope: view\n")).toBe(true);
    expect(exported.stdout).toContain("title: Speeds");
    // The text is the stored file, unchanged.
    expect(exported.stdout).toBe(readFileSync(join(h.viewsDir, "speeds.yaml"), "utf8"));

    const file = join(dir, "s.yaml");
    writeFileSync(file, exported.stdout);
    const imported = await kipscope(
      "--server",
      h.url,
      "view",
      "import",
      file,
      "--name",
      "speeds-copy",
    );
    expect(imported.code).toBe(0);
    expect(JSON.parse(imported.stdout).data.view.name).toBe("speeds-copy");

    // --out: the file gets the text, stdout is one JSON line with name, path and bytes.
    const out = join(dir, "o.yaml");
    const written = await kipscope("--server", h.url, "view", "export", "speeds", "--out", out);
    expect(written.code).toBe(0);
    expect(written.stdout.trimEnd().split("\n")).toHaveLength(1);
    const line = JSON.parse(written.stdout);
    expect(line).toMatchObject({ ok: true, outcome: "ok", data: { name: "speeds" } });
    expect(line.data.bytes).toBe(statSync(out).size);
    expect(readFileSync(out, "utf8")).toBe(exported.stdout);
    expect(resolve(line.data.path)).toBe(out);

    // Failure: the usual JSON line and the reason on stderr, no YAML.
    const failed = await kipscope("--server", h.url, "view", "export", "nope");
    expect(failed.code).toBe(1);
    expect(failed.stdout.trimEnd().split("\n")).toHaveLength(1);
    expect(JSON.parse(failed.stdout)).toMatchObject({
      ok: false,
      outcome: "rejected",
      error: { code: "unknown_view" },
    });
    expect(failed.stderr.trimEnd().split("\n")).toHaveLength(1);
    expect(failed.stderr).toContain("unknown_view");
  });
});
