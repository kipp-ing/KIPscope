import { spawn } from "node:child_process";
import { resolve } from "node:path";
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
