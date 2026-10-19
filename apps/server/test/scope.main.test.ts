/**
 * KIPSCOPE_SCOPE_PAD at the wiring level (add-scope Z11): a black box through `main.ts`, the one
 * place that hands `config.scopePad` to the app. Runs on the test ClickHouse, in scoped mode, so
 * only the opened view's scope list is loaded.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { testDbcFiles, testDiagCatalogs } from "./testdb.ts";

const S = 1_000_000_000n;
const MIN = 60n * S;
/** 2026-10-01T01:00:00Z in ns, by hand (1790816400 s). */
const T1 = 1790816400000000000n;

/** A view without a scope: one window 01:10-01:20 of testcar, so the scope is derived (Z8). */
const VIEW = {
  kipscope: "view",
  version: 1,
  title: "Derived",
  data: ["testcar"],
  linkTime: true,
  cursors: { diff: false },
  digits: 3,
  windows: [
    {
      kind: "timeseries",
      from: "2026-10-01T01:10:00Z",
      to: "2026-10-01T01:20:00Z",
      mode: "line",
      envelope: false,
      signals: ["testcar/Fast_100h.SIG_A"],
    },
  ],
};

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("no address");
  await new Promise<void>((r) => server.close(() => r()));
  return address.port;
}

const running: { child: ChildProcess; dir: string }[] = [];
afterEach(async () => {
  for (const { child, dir } of running.splice(0)) {
    child.kill("SIGTERM");
    await new Promise((r) => child.once("close", r));
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Starts main.ts on the test DB with `pad` as KIPSCOPE_SCOPE_PAD (unset: undefined) and returns its base URL. */
async function start(pad: string | undefined): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "kipscope-main-"));
  const port = await freePort();
  // Nothing of the developer's .env reaches the child: carserver must never be queried here.
  const env: Record<string, string | undefined> = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith("KIPSCOPE_") && !key.startsWith("CLICKHOUSE_"),
    ),
  );
  Object.assign(env, {
    KIPSCOPE_PORT: String(port),
    KIPSCOPE_HOST: "127.0.0.1",
    KIPSCOPE_STATE_DIR: dir,
    KIPSCOPE_CATALOG: "scoped",
    KIPSCOPE_DBC_FILES: testDbcFiles.join(","),
    KIPSCOPE_DIAG_CATALOGS: testDiagCatalogs.join(","),
    CLICKHOUSE_URL: process.env.TEST_CLICKHOUSE_URL || "http://localhost:8124",
    CLICKHOUSE_USER: process.env.TEST_CLICKHOUSE_USER || "kipscope",
    CLICKHOUSE_PASSWORD: process.env.TEST_CLICKHOUSE_PASSWORD ?? "kipscope",
    CLICKHOUSE_DATABASE: "sdlog",
    ...(pad === undefined ? {} : { KIPSCOPE_SCOPE_PAD: pad }),
  });
  const main = resolve(import.meta.dirname, "../src/main.ts");
  const child = spawn(process.execPath, [main], { env, stdio: "ignore" });
  running.push({ child, dir });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`${base}/api/workspace`);
      return base;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("server did not start");
}

async function openView(base: string) {
  const answer = await fetch(`${base}/api/commands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "view.open", view: VIEW }),
  });
  const result = (await answer.json()) as { ok?: boolean };
  expect(answer.status, JSON.stringify(result)).toBe(200);
  const state = await fetch(`${base}/api/workspace`);
  return ((await state.json()) as { workspace: { scope?: unknown } }).workspace.scope;
}

describe("KIPSCOPE_SCOPE_PAD reaches the command endpoint through main.ts", () => {
  it("pads a derived scope by the configured value, not by 1 h", async () => {
    const scope = await openView(await start("10min"));
    // 01:10 - 10 min = 01:00 and 01:20 + 10 min = 01:30, by hand.
    expect(scope).toEqual({
      dataRef: "testcar",
      from: T1.toString(),
      to: (T1 + 30n * MIN).toString(),
    });
  }, 60_000);

  it("pads by 1 h when the variable is unset", async () => {
    const scope = await openView(await start(undefined));
    // 01:10 - 1 h = 00:10 and 01:20 + 1 h = 02:20.
    expect(scope).toEqual({
      dataRef: "testcar",
      from: (T1 - 50n * MIN).toString(),
      to: (T1 + 80n * MIN).toString(),
    });
  }, 60_000);
});
