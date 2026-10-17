import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { EMPTY_WORKSPACE, type Workspace } from "@kipscope/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadState, StatePersister } from "../src/persist.ts";
import { WorkspaceStore } from "../src/workspace.ts";

// Count the renames that put a state file in place (design V4: tmp + rename).
const renames = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return {
    ...real,
    renameSync: (from: string, to: string) => {
      renames.calls.push(String(to));
      return real.renameSync(from, to);
    },
  };
});

const ctx = {
  signalExists: (id: string) => id.startsWith("car/"),
  hasStates: () => false,
  catalogReady: () => true,
};

const VIEW = {
  kipscope: "view",
  version: 1,
  title: "Restored",
  data: ["car"],
  linkTime: true,
  cursors: { diff: false },
  digits: 3,
  windows: [
    {
      kind: "timeseries",
      from: "2026-10-13T13:08:00Z",
      to: "2026-10-13T13:08:20Z",
      mode: "line",
      envelope: false,
      signals: ["car/A"],
    },
  ],
};

describe("state file", () => {
  let dir: string;
  let path: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kipscope-state-"));
    path = join(dir, "workspace.json");
    renames.calls.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it("restores workspace and revision", () => {
    const a = new WorkspaceStore(ctx);
    const persister = new StatePersister(path);
    persister.subscribe(a);
    // Five accepted commands: an open (view, colours, IDs), then edits (view becomes modified).
    expect(a.execute({ type: "view.open", view: VIEW, name: "restored" })).toMatchObject({
      ok: true,
    });
    expect(a.execute({ type: "window.create", title: "Second", from: "0", to: "1000" }).ok).toBe(
      true,
    );
    expect(a.execute({ type: "window.addSignal", windowId: "w3", signalId: "car/B" }).ok).toBe(
      true,
    );
    expect(a.execute({ type: "cursor.set", cursor: "a", t: "500" }).ok).toBe(true);
    expect(a.execute({ type: "cursor.setDiff", diff: false }).ok).toBe(true);
    expect(a.revision).toBe(5);
    persister.flush();

    const loaded = loadState(path);
    expect(loaded?.revision).toBe(5);
    const b = new WorkspaceStore(ctx, {
      initial: loaded as { revision: number; workspace: Workspace },
    });
    expect(b.workspace).toEqual(a.workspace);
    expect(b.workspace.view).toMatchObject({ name: "restored", modified: true });
    expect(b.revision).toBe(5);
    expect(b.execute({ type: "cursor.set", cursor: "b", t: "900" })).toMatchObject({
      ok: true,
      revision: 6,
    });
  });

  it("writes the documented envelope", () => {
    const store = new WorkspaceStore(ctx);
    const persister = new StatePersister(path);
    persister.subscribe(store);
    store.execute({ type: "window.create", from: "0", to: "1000" });
    persister.flush();
    const file = JSON.parse(readFileSync(path, "utf8"));
    expect(file).toMatchObject({ kipscope: "workspace", version: 1, revision: 1 });
    expect(typeof file.written).toBe("string");
    expect(file.workspace.windows).toHaveLength(1);
    expect(readFileSync(path, "utf8")).toContain('\n  "kipscope"');
  });

  it("writes once after the last change", () => {
    vi.useFakeTimers();
    const store = new WorkspaceStore(ctx);
    const persister = new StatePersister(path);
    persister.subscribe(store);

    // 20 commands within 100 ms.
    for (let i = 0; i < 20; i++) {
      expect(store.execute({ type: "cursor.set", cursor: "a", t: String(i + 1) }).ok).toBe(true);
      if (i < 19) vi.advanceTimersByTime(5);
    }
    vi.advanceTimersByTime(499);
    expect(existsSync(path)).toBe(false);
    expect(renames.calls.filter((p) => p === path)).toHaveLength(0);

    vi.advanceTimersByTime(2);
    expect(renames.calls.filter((p) => p === path)).toHaveLength(1);
    expect(JSON.parse(readFileSync(path, "utf8")).revision).toBe(20);
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(readdirSync(dir)).toEqual(["workspace.json"]);

    // Nothing further without a further change.
    vi.advanceTimersByTime(5_000);
    expect(renames.calls.filter((p) => p === path)).toHaveLength(1);
  });

  it("flush writes at once and cancels the pending write", () => {
    vi.useFakeTimers();
    const store = new WorkspaceStore(ctx);
    const persister = new StatePersister(path);
    persister.subscribe(store);
    store.execute({ type: "window.create", from: "0", to: "1000" });
    expect(existsSync(path)).toBe(false);
    persister.flush();
    expect(JSON.parse(readFileSync(path, "utf8")).revision).toBe(1);
    vi.advanceTimersByTime(5_000);
    expect(renames.calls.filter((p) => p === path)).toHaveLength(1);
  });

  it("moves a broken state file aside", () => {
    const text = '{"kipscope":"workspace","version":1,"revision":3,"workspace":{"windows":"x"}}';
    writeFileSync(path, text);
    const warnings: string[] = [];
    const collect = (m: unknown) => {
      warnings.push(String(m));
    };
    vi.spyOn(console, "warn").mockImplementation(collect);
    vi.spyOn(process.stderr, "write").mockImplementation((m) => {
      collect(m);
      return true;
    });

    const loaded = loadState(path, collect);
    // A fresh start: no restored state (or an explicitly fresh one at revision 0).
    expect(loaded === undefined || loaded.revision === 0).toBe(true);
    expect(readFileSync(join(dir, "workspace.bad.json"), "utf8")).toBe(text);
    expect(existsSync(path)).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/workspace/);

    const fresh = new WorkspaceStore(ctx, loaded ? { initial: loaded } : {});
    expect(fresh.revision).toBe(0);
    expect(fresh.workspace).toEqual(EMPTY_WORKSPACE);
  });

  it("moves a file with another kind or version aside, replacing an older .bad", () => {
    writeFileSync(join(dir, "workspace.bad.json"), "old");
    writeFileSync(
      path,
      JSON.stringify({
        kipscope: "workspace",
        version: 2,
        revision: 1,
        workspace: EMPTY_WORKSPACE,
      }),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    loadState(path, () => {});
    expect(readFileSync(join(dir, "workspace.bad.json"), "utf8")).toContain('"version":2');
  });

  it("treats a missing file as a fresh start", () => {
    const loaded = loadState(path, () => {});
    expect(loaded === undefined || loaded.revision === 0).toBe(true);
    expect(existsSync(join(dir, "workspace.bad.json"))).toBe(false);
  });

  it("keeps the restored measurement", async () => {
    // Black box through main.ts, two starts. Needs no ClickHouse: the server retries the catalog.
    const state: Workspace = {
      ...EMPTY_WORKSPACE,
      windows: [
        { id: "w1", kind: "values", mode: "line", signals: [{ id: "a2", signalId: "car/A" }] },
      ],
      nextId: 3,
      colors: { "car/A": 2 },
      cursors: { a: "5", diff: true },
      measurement: { name: "old", object: "keep?" },
      view: { name: "mine", title: "Mine", modified: true },
    };
    writeFileSync(
      path,
      JSON.stringify({
        kipscope: "workspace",
        version: 1,
        revision: 3,
        written: new Date().toISOString(),
        workspace: state,
      }),
    );
    const project = join(dir, "kipscope.yaml");
    writeFileSync(project, "measurement:\n  name: smart451 test\n");

    type Body = { revision: number; workspace: Workspace };
    const startAndRead = async (): Promise<Body | undefined> => {
      const port = await freePort();
      const main = resolve(import.meta.dirname, "../src/main.ts");
      const env = {
        ...process.env,
        KIPSCOPE_PORT: String(port),
        KIPSCOPE_HOST: "127.0.0.1",
        KIPSCOPE_STATE_DIR: dir,
        KIPSCOPE_PROJECT_FILE: project,
      };
      const child = spawn(process.execPath, [main], { env, stdio: "ignore" });
      try {
        for (let i = 0; i < 100; i++) {
          try {
            return (await (await fetch(`http://127.0.0.1:${port}/api/workspace`)).json()) as Body;
          } catch {
            await new Promise((r) => setTimeout(r, 100));
          }
        }
        return undefined;
      } finally {
        child.kill("SIGTERM");
        await new Promise((r) => child.once("close", r));
      }
    };

    // First start: the restored workspace whole, measurement included; view.modified as stored.
    const restored = await startAndRead();
    expect(restored, "server did not start").toBeDefined();
    expect(restored?.workspace.measurement).toEqual({ name: "old", object: "keep?" });
    expect(restored?.workspace.windows).toEqual(state.windows);
    expect(restored?.workspace.colors).toEqual({ "car/A": 2 });
    expect(restored?.workspace.cursors).toEqual({ a: "5", diff: true });
    expect(restored?.workspace.view?.modified).toBe(true);
    expect(restored?.revision).toBe(3);

    // Second start without a state file: a fresh workspace takes the project file's measurement.
    rmSync(path, { force: true });
    const fresh = await startAndRead();
    expect(fresh, "server did not start").toBeDefined();
    expect(fresh?.workspace.measurement).toEqual({ name: "smart451 test" });
    expect(fresh?.workspace.windows).toEqual([]);
  }, 60_000);
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("no address");
  await new Promise<void>((r) => server.close(() => r()));
  return address.port;
}
