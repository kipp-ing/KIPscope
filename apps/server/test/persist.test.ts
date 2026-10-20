import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { EMPTY_WORKSPACE, type Workspace } from "@kipscope/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceRegistry } from "../src/workspaces.ts";

// Count the renames that put a state file in place (design V4/M4: tmp + rename).
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

/** The workspace file (version 2) of an id, written by hand for the broken-file cases. */
const workspaceFile = (id: string, over: Record<string, unknown> = {}) => ({
  kipscope: "workspace",
  version: 2,
  id,
  owner: "local",
  share: "private",
  grant: { objects: "all" },
  createdAt: "2026-10-19T08:00:00Z",
  lastActiveAt: "2026-10-19T08:00:00Z",
  revision: 3,
  workspace: { windows: "x" },
  ...over,
});

describe("workspace state files", () => {
  let dir: string;
  let workspaces: string;
  let warnings: string[];
  const open = (seed: () => Workspace = () => EMPTY_WORKSPACE) => {
    const store = new WorkspaceRegistry({
      dir,
      seed,
      identity: "none",
      idleDays: 30,
      now: () => Date.now(),
      log: { info: () => {}, warn: (m) => warnings.push(m) },
    });
    store.start();
    stores.push(store);
    return store;
  };
  const stores: WorkspaceRegistry[] = [];
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kipscope-state-"));
    workspaces = join(dir, "workspaces");
    warnings = [];
    renames.calls.length = 0;
  });
  afterEach(() => {
    for (const s of stores.splice(0)) s.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it("restores workspace and revision", () => {
    const first = open();
    const a = first.create("local");
    // Five accepted commands: an open (view, colours, IDs), then edits (view becomes modified).
    expect(a.store.execute({ type: "view.open", view: VIEW, name: "restored" }, ctx)).toMatchObject(
      {
        ok: true,
      },
    );
    expect(
      a.store.execute({ type: "window.create", title: "Second", from: "0", to: "1000" }, ctx).ok,
    ).toBe(true);
    expect(
      a.store.execute({ type: "window.addSignal", windowId: "w3", signalId: "car/B" }, ctx).ok,
    ).toBe(true);
    expect(a.store.execute({ type: "cursor.set", cursor: "a", t: "500" }, ctx).ok).toBe(true);
    expect(a.store.execute({ type: "cursor.setDiff", diff: false }, ctx).ok).toBe(true);
    expect(a.store.revision).toBe(5);
    first.flush();
    first.stop();

    const second = open();
    const b = second.get(a.record.id);
    expect(b?.store.workspace).toEqual(a.store.workspace);
    expect(b?.store.workspace.view).toMatchObject({ name: "restored", modified: true });
    expect(b?.store.revision).toBe(5);
    expect(b?.store.execute({ type: "cursor.set", cursor: "b", t: "900" }, ctx)).toMatchObject({
      ok: true,
      revision: 6,
    });
  });

  it("writes the documented version 2 envelope", () => {
    const store = open();
    const s = store.create("local");
    s.store.execute({ type: "window.create", from: "0", to: "1000" }, ctx);
    store.flush();
    const path = join(workspaces, `${s.record.id}.json`);
    const file = JSON.parse(readFileSync(path, "utf8"));
    expect(file).toMatchObject({
      kipscope: "workspace",
      version: 2,
      id: s.record.id,
      owner: "local",
      share: "private",
      grant: { objects: "all" },
      revision: 1,
    });
    expect(typeof file.createdAt).toBe("string");
    expect(typeof file.lastActiveAt).toBe("string");
    expect(file.workspace.windows).toHaveLength(1);
    expect(readFileSync(path, "utf8")).toContain('\n  "kipscope"');
  });

  it("writes once after the last change", () => {
    vi.useFakeTimers({ now: new Date("2026-10-19T08:00:00Z") });
    const store = open();
    const s = store.create("local");
    const path = join(workspaces, `${s.record.id}.json`);
    // Let the creation settle, so only the 20 commands are counted.
    vi.advanceTimersByTime(1_000);
    renames.calls.length = 0;
    const before = existsSync(path) ? readFileSync(path, "utf8") : "";

    // 20 commands within 100 ms.
    for (let i = 0; i < 20; i++) {
      expect(s.store.execute({ type: "cursor.set", cursor: "a", t: String(i + 1) }, ctx).ok).toBe(
        true,
      );
      if (i < 19) vi.advanceTimersByTime(5);
    }
    vi.advanceTimersByTime(499);
    expect(renames.calls.filter((p) => p === path)).toHaveLength(0);
    expect(existsSync(path) ? readFileSync(path, "utf8") : "").toBe(before);

    vi.advanceTimersByTime(2);
    expect(renames.calls.filter((p) => p === path)).toHaveLength(1);
    expect(JSON.parse(readFileSync(path, "utf8")).revision).toBe(20);
    expect(readdirSync(workspaces).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(readdirSync(workspaces)).toEqual([`${s.record.id}.json`]);

    // Nothing further without a further change.
    vi.advanceTimersByTime(5_000);
    expect(renames.calls.filter((p) => p === path)).toHaveLength(1);
  });

  it("flush writes at once and cancels the pending write", () => {
    vi.useFakeTimers({ now: new Date("2026-10-19T08:00:00Z") });
    const store = open();
    const s = store.create("local");
    const path = join(workspaces, `${s.record.id}.json`);
    vi.advanceTimersByTime(1_000);
    renames.calls.length = 0;
    s.store.execute({ type: "window.create", from: "0", to: "1000" }, ctx);
    store.flush();
    expect(JSON.parse(readFileSync(path, "utf8")).revision).toBe(1);
    expect(renames.calls.filter((p) => p === path)).toHaveLength(1);
    vi.advanceTimersByTime(5_000);
    expect(renames.calls.filter((p) => p === path)).toHaveLength(1);
  });

  it("never fails a command when the write fails", () => {
    vi.useFakeTimers({ now: new Date("2026-10-19T08:00:00Z") });
    const store = open();
    const s = store.create("local");
    // The workspaces folder is replaced by a plain file: every write fails.
    store.flush();
    rmSync(workspaces, { recursive: true, force: true });
    writeFileSync(workspaces, "in the way");
    expect(s.store.execute({ type: "window.create", from: "0", to: "1000" }, ctx).ok).toBe(true);
    expect(() => vi.advanceTimersByTime(2_000)).not.toThrow();
    expect(s.store.revision).toBe(1);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
  });

  it("moves a broken state file aside", () => {
    mkdirSync(workspaces, { recursive: true });
    const text = JSON.stringify(workspaceFile("aaaaaaaaaa", { workspace: { windows: "x" } }));
    writeFileSync(join(workspaces, "aaaaaaaaaa.json"), text);
    const store = open();
    expect(store.get("aaaaaaaaaa")).toBeUndefined();
    expect(readFileSync(join(workspaces, "aaaaaaaaaa.bad.json"), "utf8")).toBe(text);
    expect(existsSync(join(workspaces, "aaaaaaaaaa.json"))).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("aaaaaaaaaa");
    // A fresh start for that user: a new workspace is empty at revision 0.
    const fresh = store.create("local");
    expect(fresh.store.revision).toBe(0);
    expect(fresh.store.workspace).toEqual(EMPTY_WORKSPACE);
  });

  it("moves a file with another kind, version or grant aside, replacing an older .bad", () => {
    mkdirSync(workspaces, { recursive: true });
    writeFileSync(join(workspaces, "aaaaaaaaaa.bad.json"), "old");
    writeFileSync(
      join(workspaces, "aaaaaaaaaa.json"),
      JSON.stringify(workspaceFile("aaaaaaaaaa", { version: 3, workspace: EMPTY_WORKSPACE })),
    );
    writeFileSync(
      join(workspaces, "bbbbbbbbbb.json"),
      JSON.stringify(
        workspaceFile("bbbbbbbbbb", { kipscope: "other", workspace: EMPTY_WORKSPACE }),
      ),
    );
    writeFileSync(
      join(workspaces, "cccccccccc.json"),
      JSON.stringify(
        workspaceFile("cccccccccc", { grant: { objects: "some" }, workspace: EMPTY_WORKSPACE }),
      ),
    );
    open();
    expect(readFileSync(join(workspaces, "aaaaaaaaaa.bad.json"), "utf8")).toContain('"version":3');
    expect(existsSync(join(workspaces, "bbbbbbbbbb.bad.json"))).toBe(true);
    expect(existsSync(join(workspaces, "cccccccccc.bad.json"))).toBe(true);
    expect(warnings).toHaveLength(3);
  });

  it("treats a missing file as a fresh start", () => {
    const store = open();
    expect(store.listOf("local")).toEqual([]);
    expect(warnings).toEqual([]);
    expect(existsSync(workspaces) ? readdirSync(workspaces) : []).toEqual([]);
  });

  it("keeps the restored measurement", async () => {
    // Black box through main.ts, one start with the project file. Needs no ClickHouse: the server retries the catalog.
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
    mkdirSync(workspaces, { recursive: true });
    writeFileSync(
      join(workspaces, "aaaaaaaaaa.json"),
      JSON.stringify(workspaceFile("aaaaaaaaaa", { revision: 3, workspace: state })),
    );
    const project = join(dir, "kipscope.yaml");
    writeFileSync(project, "measurement:\n  name: smart451 test\n");

    type Body = { revision: number; workspace: Workspace };
    const port = await freePort();
    const main = resolve(import.meta.dirname, "../src/main.ts");
    const env = {
      ...process.env,
      KIPSCOPE_IDENTITY: "none",
      KIPSCOPE_PORT: String(port),
      KIPSCOPE_HOST: "127.0.0.1",
      KIPSCOPE_STATE_DIR: dir,
      KIPSCOPE_PROJECT_FILE: project,
    };
    const child = spawn(process.execPath, [main], { env, stdio: "ignore" });
    const base = `http://127.0.0.1:${port}`;
    try {
      let restored: Body | undefined;
      for (let i = 0; i < 100 && !restored; i++) {
        try {
          const res = await fetch(`${base}/api/w/aaaaaaaaaa/workspace`);
          if (res.ok) restored = (await res.json()) as Body;
          else await new Promise((r) => setTimeout(r, 100));
        } catch {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      expect(restored, "server did not start").toBeDefined();
      // The restored workspace whole, measurement included; view.modified as stored.
      expect(restored?.workspace.measurement).toEqual({ name: "old", object: "keep?" });
      expect(restored?.workspace.windows).toEqual(state.windows);
      expect(restored?.workspace.colors).toEqual({ "car/A": 2 });
      expect(restored?.workspace.cursors).toEqual({ a: "5", diff: true });
      expect(restored?.workspace.view?.modified).toBe(true);
      expect(restored?.revision).toBe(3);

      // A new workspace takes the project file's measurement.
      const created = await fetch(`${base}/api/workspaces`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(created.status).toBe(200);
      const id = ((await created.json()) as { workspace: { id: string } }).workspace.id;
      const fresh = (await (await fetch(`${base}/api/w/${id}/workspace`)).json()) as Body;
      expect(fresh.workspace.measurement).toEqual({ name: "smart451 test" });
      expect(fresh.workspace.windows).toEqual([]);
      expect(fresh.revision).toBe(0);
    } finally {
      child.kill("SIGTERM");
      await new Promise((r) => child.once("close", r));
    }
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
