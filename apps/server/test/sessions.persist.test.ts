import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EMPTY_WORKSPACE, type Workspace } from "@kipscope/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceStore } from "../src/workspace.ts";
import { ctx, newStore, T1, T2, tempState } from "./sessionsKit.ts";

let state: ReturnType<typeof tempState>;
const stores: { stop(): void }[] = [];
beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-10-19T08:00:00Z") });
  state = tempState("kipscope-sessions-persist-");
});
afterEach(() => {
  for (const s of stores.splice(0)) s.stop();
  vi.useRealTimers();
  state.cleanup();
});

const open = (extra: Parameters<typeof newStore>[1] = {}) => {
  const made = newStore(state.dir, extra);
  stores.push(made.store);
  made.store.start();
  return made;
};

describe("sessions on disk", () => {
  it("restores every session", () => {
    const first = open();
    const a = first.store.create("alice");
    vi.advanceTimersByTime(1000);
    const b = first.store.create("bob");
    for (let i = 1; i <= 5; i++)
      expect(a.store.execute({ type: "cursor.set", cursor: "a", t: String(i * 10) }, ctx).ok).toBe(
        true,
      );
    for (let i = 1; i <= 2; i++)
      expect(
        b.store.execute({ type: "window.create", from: "0", to: String(i * 100) }, ctx).ok,
      ).toBe(true);
    first.store.setShare(a.record.id, "read");
    first.store.flush();
    first.store.stop();

    const second = open();
    const a2 = second.store.get(a.record.id);
    const b2 = second.store.get(b.record.id);
    expect(a2?.store.workspace).toEqual(a.store.workspace);
    expect(b2?.store.workspace).toEqual(b.store.workspace);
    expect(a2?.store.revision).toBe(5);
    expect(b2?.store.revision).toBe(2);
    expect(a2?.record).toEqual(a.record);
    expect(b2?.record).toEqual(b.record);
    expect(a2?.record.owner).toBe("alice");
    expect(a2?.record.share).toBe("read");
    expect(b2?.record.share).toBe("private");
    expect(second.store.listOf("alice")).toHaveLength(1);
    expect(second.store.listOf("bob")).toHaveLength(1);
    expect(second.warn).toEqual([]);
    // The next command continues the revision.
    expect(a2?.store.execute({ type: "cursor.set", cursor: "b", t: "99" }, ctx)).toMatchObject({
      ok: true,
      revision: 6,
    });
  });

  it("restores a scope and the open view as stored", () => {
    const first = open();
    const a = first.store.create("alice");
    expect(
      a.store.execute({ type: "window.create", from: T1, to: "1790817000000000000" }, ctx).ok,
    ).toBe(true);
    expect(a.store.execute({ type: "scope.set", dataRef: "car", from: T1, to: T2 }, ctx).ok).toBe(
      true,
    );
    first.store.flush();
    first.store.stop();
    const second = open();
    const restored = second.store.get(a.record.id);
    expect(restored?.store.workspace.scope).toEqual({ dataRef: "car", from: T1, to: T2 });
    // The restored scope still bounds commands.
    expect(restored?.store.execute({ type: "cursor.set", cursor: "b", t: T2 }, ctx)).toMatchObject({
      ok: false,
      code: "out_of_scope",
    });
  });

  it("moves a broken session file aside", () => {
    const first = open();
    const a = first.store.create("alice");
    first.store.flush();
    first.store.stop();
    const text = '{"kipscope":"session","version":1}';
    writeFileSync(join(state.sessionsDir, "bbbbbbbbbb.json"), text);

    const second = open();
    expect(second.store.get(a.record.id)?.record.owner).toBe("alice");
    expect(second.store.get("bbbbbbbbbb")).toBeUndefined();
    expect(readFileSync(join(state.sessionsDir, "bbbbbbbbbb.bad.json"), "utf8")).toBe(text);
    expect(existsSync(join(state.sessionsDir, "bbbbbbbbbb.json"))).toBe(false);
    expect(second.warn).toHaveLength(1);
    expect(second.warn[0]).toContain("bbbbbbbbbb");
  });

  it("moves aside files with the wrong kind, version, id, owner or workspace", () => {
    mkdirSync(state.sessionsDir, { recursive: true });
    const good = {
      kipscope: "session",
      version: 1,
      id: "cccccccccc",
      owner: "alice",
      share: "private",
      createdAt: "2026-10-19T08:00:00.000Z",
      lastActiveAt: "2026-10-19T08:00:00.000Z",
      revision: 0,
      workspace: EMPTY_WORKSPACE,
    };
    const variants: Record<string, unknown> = {
      aaaaaaaaaa: { ...good, id: "aaaaaaaaaa", kipscope: "workspace" },
      bbbbbbbbbb: { ...good, id: "bbbbbbbbbb", version: 2 },
      // The file name and the id inside must agree: no session under a foreign name.
      dddddddddd: { ...good, id: "eeeeeeeeee" },
      ffffffffff: { ...good, id: "ffffffffff", owner: "../x" },
      gggggggggg: { ...good, id: "gggggggggg", share: "everyone" },
      hhhhhhhhhh: { ...good, id: "hhhhhhhhhh", revision: -1 },
      iiiiiiiiii: { ...good, id: "iiiiiiiiii", workspace: { windows: "x" } },
    };
    for (const [name, doc] of Object.entries(variants))
      writeFileSync(join(state.sessionsDir, `${name}.json`), JSON.stringify(doc));
    writeFileSync(join(state.sessionsDir, "jjjjjjjjjj.json"), "not json {");
    writeFileSync(join(state.sessionsDir, "cccccccccc.json"), JSON.stringify(good));
    // A stray file that is no session file is left alone.
    writeFileSync(join(state.sessionsDir, "notes.txt"), "hello");

    const made = open();
    expect(made.store.get("cccccccccc")?.record.owner).toBe("alice");
    for (const name of [...Object.keys(variants), "jjjjjjjjjj"]) {
      expect(made.store.get(name), name).toBeUndefined();
      expect(existsSync(join(state.sessionsDir, `${name}.bad.json`)), name).toBe(true);
    }
    expect(made.store.get("eeeeeeeeee")).toBeUndefined();
    expect(made.warn).toHaveLength(Object.keys(variants).length + 1);
    expect(readFileSync(join(state.sessionsDir, "notes.txt"), "utf8")).toBe("hello");
  });

  it("removes the file of a deleted session", () => {
    const made = open();
    const a = made.store.create("alice");
    made.store.flush();
    expect(state.files()).toEqual([`${a.record.id}.json`]);
    made.store.delete(a.record.id);
    expect(state.files()).toEqual([]);
    // A pending debounced write of the deleted session must not bring the file back.
    vi.advanceTimersByTime(5_000);
    expect(state.files()).toEqual([]);
  });

  it("starts empty on an empty state dir without creating files", () => {
    const made = open();
    expect(made.store.listOf("alice")).toEqual([]);
    expect(made.warn).toEqual([]);
    expect(readdirSync(state.dir).filter((f) => f.endsWith(".bad.json"))).toEqual([]);
  });

  /** A v1 workspace.json holding revision 7 and two windows, built by applying commands. */
  function oldWorkspaceFile(): { text: string; workspace: Workspace } {
    const old = new WorkspaceStore(ctx);
    old.execute({ type: "window.create", from: "0", to: "1000" });
    old.execute({ type: "window.create", from: "0", to: "2000" });
    for (let i = 0; i < 5; i++) old.execute({ type: "cursor.set", cursor: "a", t: String(i + 1) });
    expect(old.revision).toBe(7);
    const text = JSON.stringify({
      kipscope: "workspace",
      version: 1,
      revision: 7,
      written: "2026-10-18T10:00:00.000Z",
      workspace: old.workspace,
    });
    return { text, workspace: old.workspace };
  }

  it("migrates the single workspace and the views", () => {
    const { text, workspace } = oldWorkspaceFile();
    writeFileSync(join(state.dir, "workspace.json"), text);
    mkdirSync(join(state.dir, "views"));
    writeFileSync(join(state.dir, "views", "speeds.yaml"), "kipscope: view\nversion: 1\n");

    const made = open();
    const mine = made.store.listOf("local");
    expect(mine).toHaveLength(1);
    const s = mine[0];
    expect(s?.record).toMatchObject({ owner: "local", share: "private" });
    expect(s?.store.revision).toBe(7);
    expect(s?.store.workspace).toEqual(workspace);
    expect(s?.store.workspace.windows).toHaveLength(2);
    // The next command continues at 8.
    expect(s?.store.execute({ type: "cursor.set", cursor: "b", t: "9" }, ctx)).toMatchObject({
      revision: 8,
    });

    made.store.flush();
    expect(existsSync(join(state.dir, "workspace.json"))).toBe(false);
    expect(readFileSync(join(state.dir, "workspace.migrated.json"), "utf8")).toBe(text);
    expect(state.files()).toEqual([`${s?.record.id}.json`]);
    expect(readFileSync(join(state.dir, "users", "local", "views", "speeds.yaml"), "utf8")).toBe(
      "kipscope: view\nversion: 1\n",
    );
    expect(existsSync(join(state.dir, "views"))).toBe(false);
    // One log line per step.
    expect(made.info.filter((m) => /workspace/i.test(m))).toHaveLength(1);
    expect(made.info.filter((m) => /views/i.test(m))).toHaveLength(1);
    made.store.stop();

    // A second start migrates nothing and logs no migration.
    const again = open();
    expect(again.store.listOf("local")).toHaveLength(1);
    expect(again.store.listOf("local")[0]?.store.revision).toBe(8);
    expect(again.info.filter((m) => /migrat/i.test(m))).toEqual([]);
    expect(readFileSync(join(state.dir, "workspace.migrated.json"), "utf8")).toBe(text);
    expect(readdirSync(join(state.dir, "users", "local", "views"))).toEqual(["speeds.yaml"]);
  });

  it("does not migrate over existing sessions or user views", () => {
    const first = open();
    const kept = first.store.create("alice");
    first.store.flush();
    first.store.stop();
    mkdirSync(join(state.dir, "users", "local", "views"), { recursive: true });
    writeFileSync(join(state.dir, "users", "local", "views", "own.yaml"), "x");
    const { text } = oldWorkspaceFile();
    writeFileSync(join(state.dir, "workspace.json"), text);
    mkdirSync(join(state.dir, "views"));
    writeFileSync(join(state.dir, "views", "old.yaml"), "y");

    const made = open();
    expect(made.store.listOf("local")).toEqual([]);
    expect(made.store.get(kept.record.id)).toBeDefined();
    // Both old locations stay where they are: nothing is overwritten.
    expect(readFileSync(join(state.dir, "workspace.json"), "utf8")).toBe(text);
    expect(readFileSync(join(state.dir, "views", "old.yaml"), "utf8")).toBe("y");
    expect(readdirSync(join(state.dir, "users", "local", "views"))).toEqual(["own.yaml"]);
  });

  it("moves an unreadable workspace.json aside and starts without a session", () => {
    writeFileSync(
      join(state.dir, "workspace.json"),
      '{"kipscope":"workspace","version":1,"revision":3,"workspace":{"windows":"x"}}',
    );
    const made = open();
    expect(made.store.listOf("local")).toEqual([]);
    expect(existsSync(join(state.dir, "workspace.bad.json"))).toBe(true);
    expect(existsSync(join(state.dir, "workspace.json"))).toBe(false);
    expect(made.warn.length).toBeGreaterThanOrEqual(1);
    expect(made.warn.join("\n")).toMatch(/workspace/);
  });

  it("writes one file per session with the owner inside", () => {
    const made = open();
    const a = made.store.create("alice");
    const b = made.store.create("bob");
    made.store.flush();
    expect(state.files()).toEqual([`${a.record.id}.json`, `${b.record.id}.json`].sort());
    const file = JSON.parse(readFileSync(join(state.sessionsDir, `${a.record.id}.json`), "utf8"));
    expect(file).toMatchObject({
      kipscope: "session",
      version: 1,
      id: a.record.id,
      owner: "alice",
      share: "private",
      revision: 0,
    });
  });
});
