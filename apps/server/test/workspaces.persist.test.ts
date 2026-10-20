import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EMPTY_WORKSPACE, type Workspace } from "@kipscope/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceStore } from "../src/workspace.ts";
import { summaryOf } from "../src/workspaces.ts";
import { ctx, newRegistry, T1, T2, tempState } from "./workspacesKit.ts";

let state: ReturnType<typeof tempState>;
const stores: { stop(): void }[] = [];
beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-10-19T08:00:00Z") });
  state = tempState("kipscope-workspaces-persist-");
});
afterEach(() => {
  for (const s of stores.splice(0)) s.stop();
  vi.useRealTimers();
  state.cleanup();
});

const open = (extra: Parameters<typeof newRegistry>[1] = {}) => {
  const made = newRegistry(state.dir, extra);
  stores.push(made.registry);
  made.registry.start();
  return made;
};

describe("workspaces on disk", () => {
  it("restores every workspace", () => {
    // A server (oidc) registry, so that grantObjects widens a grant.
    const first = open({ identity: "oidc" });
    const a = first.registry.create("alice");
    vi.advanceTimersByTime(1000);
    const b = first.registry.create("bob");
    for (let i = 1; i <= 5; i++)
      expect(a.store.execute({ type: "cursor.set", cursor: "a", t: String(i * 10) }, ctx).ok).toBe(
        true,
      );
    for (let i = 1; i <= 2; i++)
      expect(
        b.store.execute({ type: "window.create", from: "0", to: String(i * 100) }, ctx).ok,
      ).toBe(true);
    first.registry.setShare(a.record.id, "read");
    first.registry.grantObjects(a.record.id, ["testcar"]);
    first.registry.flush();
    first.registry.stop();

    const second = open({ identity: "oidc" });
    const a2 = second.registry.get(a.record.id);
    const b2 = second.registry.get(b.record.id);
    expect(a2?.store.workspace).toEqual(a.store.workspace);
    expect(b2?.store.workspace).toEqual(b.store.workspace);
    expect(a2?.store.revision).toBe(5);
    expect(b2?.store.revision).toBe(2);
    expect(a2?.record).toEqual(a.record);
    expect(b2?.record).toEqual(b.record);
    expect(a2?.record.owner).toBe("alice");
    expect(a2?.record.grant).toEqual({ objects: ["testcar"] });
    expect(b2?.record.grant).toEqual({ objects: [] });
    expect(a2?.record.share).toBe("read");
    expect(b2?.record.share).toBe("private");
    expect(second.registry.listOf("alice")).toHaveLength(1);
    expect(second.registry.listOf("bob")).toHaveLength(1);
    expect(second.warn).toEqual([]);
    // The next command continues the revision.
    expect(a2?.store.execute({ type: "cursor.set", cursor: "b", t: "99" }, ctx)).toMatchObject({
      ok: true,
      revision: 6,
    });
  });

  it("restores a scope and the open view as stored", () => {
    const first = open();
    const a = first.registry.create("alice");
    expect(
      a.store.execute({ type: "window.create", from: T1, to: "1790817000000000000" }, ctx).ok,
    ).toBe(true);
    expect(a.store.execute({ type: "scope.set", dataRef: "car", from: T1, to: T2 }, ctx).ok).toBe(
      true,
    );
    first.registry.flush();
    first.registry.stop();
    const second = open();
    const restored = second.registry.get(a.record.id);
    expect(restored?.store.workspace.scope).toEqual({ dataRef: "car", from: T1, to: T2 });
    // The restored scope still bounds commands.
    expect(restored?.store.execute({ type: "cursor.set", cursor: "b", t: T2 }, ctx)).toMatchObject({
      ok: false,
      code: "out_of_scope",
    });
  });

  it("moves a broken workspace file aside", () => {
    const first = open();
    const a = first.registry.create("alice");
    first.registry.flush();
    first.registry.stop();
    const text = '{"kipscope":"workspace","version":2}';
    writeFileSync(join(state.workspacesDir, "bbbbbbbbbb.json"), text);

    const second = open();
    expect(second.registry.get(a.record.id)?.record.owner).toBe("alice");
    expect(second.registry.get("bbbbbbbbbb")).toBeUndefined();
    expect(readFileSync(join(state.workspacesDir, "bbbbbbbbbb.bad.json"), "utf8")).toBe(text);
    expect(existsSync(join(state.workspacesDir, "bbbbbbbbbb.json"))).toBe(false);
    expect(second.warn).toHaveLength(1);
    expect(second.warn[0]).toContain("bbbbbbbbbb");
  });

  it("moves aside files with the wrong kind, version, id, owner, grant or workspace", () => {
    mkdirSync(state.workspacesDir, { recursive: true });
    const good = {
      kipscope: "workspace",
      version: 2,
      id: "cccccccccc",
      owner: "alice",
      share: "private",
      grant: { objects: ["testcar"] },
      createdAt: "2026-10-19T08:00:00.000Z",
      lastActiveAt: "2026-10-19T08:00:00.000Z",
      revision: 0,
      workspace: EMPTY_WORKSPACE,
    };
    const variants: Record<string, unknown> = {
      aaaaaaaaaa: { ...good, id: "aaaaaaaaaa", kipscope: "other" },
      bbbbbbbbbb: { ...good, id: "bbbbbbbbbb", version: 3 },
      // The file name and the id inside must agree: no workspace under a foreign name.
      dddddddddd: { ...good, id: "eeeeeeeeee" },
      ffffffffff: { ...good, id: "ffffffffff", owner: "../x" },
      gggggggggg: { ...good, id: "gggggggggg", share: "everyone" },
      hhhhhhhhhh: { ...good, id: "hhhhhhhhhh", revision: -1 },
      iiiiiiiiii: { ...good, id: "iiiiiiiiii", workspace: { windows: "x" } },
      kkkkkkkkkk: { ...good, id: "kkkkkkkkkk", grant: { objects: "some" } },
    };
    for (const [name, doc] of Object.entries(variants))
      writeFileSync(join(state.workspacesDir, `${name}.json`), JSON.stringify(doc));
    writeFileSync(join(state.workspacesDir, "jjjjjjjjjj.json"), "not json {");
    writeFileSync(join(state.workspacesDir, "cccccccccc.json"), JSON.stringify(good));
    // A stray file that is no workspace file is left alone.
    writeFileSync(join(state.workspacesDir, "notes.txt"), "hello");

    const made = open();
    expect(made.registry.get("cccccccccc")?.record.owner).toBe("alice");
    expect(made.registry.get("cccccccccc")?.record.grant).toEqual({ objects: ["testcar"] });
    for (const name of [...Object.keys(variants), "jjjjjjjjjj"]) {
      expect(made.registry.get(name), name).toBeUndefined();
      expect(existsSync(join(state.workspacesDir, `${name}.bad.json`)), name).toBe(true);
    }
    expect(made.registry.get("eeeeeeeeee")).toBeUndefined();
    expect(made.warn).toHaveLength(Object.keys(variants).length + 1);
    expect(readFileSync(join(state.workspacesDir, "notes.txt"), "utf8")).toBe("hello");
  });

  it("removes the file of a deleted workspace", () => {
    const made = open();
    const a = made.registry.create("alice");
    made.registry.flush();
    expect(state.files()).toEqual([`${a.record.id}.json`]);
    made.registry.delete(a.record.id);
    expect(state.files()).toEqual([]);
    // A pending debounced write of the deleted workspace must not bring the file back.
    vi.advanceTimersByTime(5_000);
    expect(state.files()).toEqual([]);
  });

  it("starts empty on an empty state dir without creating files", () => {
    const made = open();
    expect(made.registry.listOf("alice")).toEqual([]);
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
    const mine = made.registry.listOf("local");
    expect(mine).toHaveLength(1);
    const s = mine[0];
    expect(s?.record).toMatchObject({
      owner: "local",
      share: "private",
      grant: { objects: "all" },
    });
    expect(s?.store.revision).toBe(7);
    expect(s?.store.workspace).toEqual(workspace);
    expect(s?.store.workspace.windows).toHaveLength(2);
    // The next command continues at 8.
    expect(s?.store.execute({ type: "cursor.set", cursor: "b", t: "9" }, ctx)).toMatchObject({
      revision: 8,
    });

    made.registry.flush();
    expect(existsSync(join(state.dir, "workspace.json"))).toBe(false);
    expect(readFileSync(join(state.dir, "workspace.migrated.json"), "utf8")).toBe(text);
    expect(state.files()).toEqual([`${s?.record.id}.json`]);
    expect(readFileSync(join(state.dir, "users", "local", "views", "speeds.yaml"), "utf8")).toBe(
      "kipscope: view\nversion: 1\n",
    );
    expect(existsSync(join(state.dir, "views"))).toBe(false);
    // One log line per step.
    // (The temp dir's own name is cut out first: it contains "workspaces".)
    const lines = made.info.map((m) => m.replaceAll(state.dir, "<dir>"));
    expect(lines.filter((m) => /workspace/i.test(m))).toHaveLength(1);
    expect(lines.filter((m) => /views/i.test(m))).toHaveLength(1);
    made.registry.stop();

    // A second start migrates nothing and logs no migration.
    const again = open();
    expect(again.registry.listOf("local")).toHaveLength(1);
    expect(again.registry.listOf("local")[0]?.store.revision).toBe(8);
    expect(
      again.info.map((m) => m.replaceAll(state.dir, "<dir>")).filter((m) => /migrat/i.test(m)),
    ).toEqual([]);
    expect(readFileSync(join(state.dir, "workspace.migrated.json"), "utf8")).toBe(text);
    expect(readdirSync(join(state.dir, "users", "local", "views"))).toEqual(["speeds.yaml"]);
  });

  /** A session file as round 1 wrote it: kipscope "session", version 1, no grant. */
  function roundOneFile(id: string, revision: number) {
    const old = new WorkspaceStore(ctx);
    for (let i = 0; i < revision; i++)
      old.execute({ type: "cursor.set", cursor: "a", t: String(i + 1) });
    expect(old.revision).toBe(revision);
    return {
      file: {
        kipscope: "session",
        version: 1,
        id,
        owner: "local",
        share: "private",
        createdAt: "2026-10-19T08:00:00.000Z",
        lastActiveAt: "2026-10-19T09:00:00.000Z",
        revision,
        workspace: old.workspace,
      },
      workspace: old.workspace,
    };
  }

  it("migrates the session folder of round 1", () => {
    const { file, workspace } = roundOneFile("aaaaaaaaaa", 4);
    mkdirSync(join(state.dir, "sessions"));
    writeFileSync(join(state.dir, "sessions", "aaaaaaaaaa.json"), JSON.stringify(file));

    const made = open();
    // The folder was renamed, and the entry reads as a workspace with grant all.
    expect(existsSync(join(state.dir, "sessions"))).toBe(false);
    expect(state.files()).toEqual(["aaaaaaaaaa.json"]);
    const entry = made.registry.get("aaaaaaaaaa");
    expect(entry?.record).toMatchObject({ owner: "local", share: "private" });
    expect(entry?.store.workspace).toEqual(workspace);
    expect(made.registry.grantOf("aaaaaaaaaa")).toEqual({ objects: "all" });
    if (!entry) throw new Error("no workspace");
    expect(summaryOf(entry, undefined, made.registry.grantOf("aaaaaaaaaa")).granted).toBe("all");
    expect(
      made.info.map((m) => m.replaceAll(state.dir, "<dir>")).filter((m) => /migrat|renam/i.test(m)),
    ).toHaveLength(1);

    // The command gets revision 5; the next write turns the file into version 2.
    expect(entry.store.execute({ type: "cursor.set", cursor: "b", t: "9" }, ctx)).toMatchObject({
      ok: true,
      revision: 5,
    });
    made.registry.flush();
    const after = JSON.parse(readFileSync(join(state.workspacesDir, "aaaaaaaaaa.json"), "utf8"));
    expect(after).toMatchObject({
      kipscope: "workspace",
      version: 2,
      id: "aaaaaaaaaa",
      grant: { objects: "all" },
      revision: 5,
    });
    expect(existsSync(join(state.dir, "sessions"))).toBe(false);
  });

  it("reads a legacy session file inside workspaces/ as grant all", () => {
    const { file } = roundOneFile("bbbbbbbbbb", 2);
    mkdirSync(state.workspacesDir, { recursive: true });
    writeFileSync(join(state.workspacesDir, "bbbbbbbbbb.json"), JSON.stringify(file));
    const made = open();
    expect(made.registry.get("bbbbbbbbbb")?.store.revision).toBe(2);
    expect(made.registry.get("bbbbbbbbbb")?.record.grant).toEqual({ objects: "all" });
    expect(made.warn).toEqual([]);
  });

  it("migrates the session folder before workspace.json and leaves that file", () => {
    const { file } = roundOneFile("aaaaaaaaaa", 1);
    mkdirSync(join(state.dir, "sessions"));
    writeFileSync(join(state.dir, "sessions", "aaaaaaaaaa.json"), JSON.stringify(file));
    const { text } = oldWorkspaceFile();
    writeFileSync(join(state.dir, "workspace.json"), text);
    const made = open();
    // Step 1 made workspaces/, so step 2 does not run.
    expect(made.registry.listOf("local").map((e) => e.record.id)).toEqual(["aaaaaaaaaa"]);
    expect(readFileSync(join(state.dir, "workspace.json"), "utf8")).toBe(text);
  });

  it("does not migrate over existing workspaces or user views", () => {
    const first = open();
    const kept = first.registry.create("alice");
    first.registry.flush();
    first.registry.stop();
    mkdirSync(join(state.dir, "users", "local", "views"), { recursive: true });
    writeFileSync(join(state.dir, "users", "local", "views", "own.yaml"), "x");
    const { text } = oldWorkspaceFile();
    writeFileSync(join(state.dir, "workspace.json"), text);
    mkdirSync(join(state.dir, "views"));
    writeFileSync(join(state.dir, "views", "old.yaml"), "y");

    const made = open();
    expect(made.registry.listOf("local")).toEqual([]);
    expect(made.registry.get(kept.record.id)).toBeDefined();
    // Both old locations stay where they are: nothing is overwritten.
    expect(readFileSync(join(state.dir, "workspace.json"), "utf8")).toBe(text);
    expect(readFileSync(join(state.dir, "views", "old.yaml"), "utf8")).toBe("y");
    expect(readdirSync(join(state.dir, "users", "local", "views"))).toEqual(["own.yaml"]);
  });

  it("moves an unreadable workspace.json aside and starts without a workspace", () => {
    writeFileSync(
      join(state.dir, "workspace.json"),
      '{"kipscope":"workspace","version":1,"revision":3,"workspace":{"windows":"x"}}',
    );
    const made = open();
    expect(made.registry.listOf("local")).toEqual([]);
    expect(existsSync(join(state.dir, "workspace.bad.json"))).toBe(true);
    expect(existsSync(join(state.dir, "workspace.json"))).toBe(false);
    expect(made.warn.length).toBeGreaterThanOrEqual(1);
    expect(made.warn.join("\n")).toMatch(/workspace/);
  });

  it("writes one file per workspace with the owner and the grant inside", () => {
    const made = open();
    const a = made.registry.create("alice");
    const b = made.registry.create("bob");
    made.registry.flush();
    expect(state.files()).toEqual([`${a.record.id}.json`, `${b.record.id}.json`].sort());
    const file = JSON.parse(readFileSync(join(state.workspacesDir, `${a.record.id}.json`), "utf8"));
    expect(file).toMatchObject({
      kipscope: "workspace",
      version: 2,
      id: a.record.id,
      owner: "alice",
      share: "private",
      grant: { objects: "all" },
      revision: 0,
    });
  });
});
