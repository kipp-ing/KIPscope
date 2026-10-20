import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EMPTY_WORKSPACE,
  GRANT_ALL,
  GRANT_NONE,
  MAX_GRANT_OBJECTS,
  WORKSPACE_ID,
} from "@kipscope/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { covers } from "../src/rights.ts";
import { GrantLimitError, WorkspaceLimitError, type WorkspaceRegistry } from "../src/workspaces.ts";
import { ctx, newRegistry, T1, T2, tempState } from "./workspacesKit.ts";

const DAY = 86_400_000;
const START = new Date("2026-10-19T08:00:00Z");

let state: ReturnType<typeof tempState>;
let registry: WorkspaceRegistry | undefined;
beforeEach(() => {
  vi.useFakeTimers({ now: START });
  state = tempState();
});
afterEach(() => {
  registry?.stop();
  registry = undefined;
  vi.useRealTimers();
  state.cleanup();
});

const fresh = (
  extra: Parameters<typeof newRegistry>[1] = {},
  seed?: Parameters<typeof newRegistry>[2],
) => {
  const made = newRegistry(state.dir, extra, seed);
  registry = made.registry;
  made.registry.start();
  return made;
};

describe("workspace registry", () => {
  it("creates workspaces with random IDs, the owner and a private share", () => {
    const { registry } = fresh();
    const a = registry.create("alice");
    const b = registry.create("alice");
    expect(a.record.id).toMatch(WORKSPACE_ID);
    expect(b.record.id).toMatch(WORKSPACE_ID);
    expect(a.record.id).not.toBe(b.record.id);
    expect(a.record).toMatchObject({
      owner: "alice",
      share: "private",
      createdAt: START.toISOString(),
      lastActiveAt: START.toISOString(),
    });
    expect(a.store.revision).toBe(0);
    expect(registry.get(a.record.id)).toBe(a);
    expect(registry.get("zzzzzzzzzz")).toBeUndefined();
  });

  it("gives a new workspace the initial grant of the identity", () => {
    const none = fresh();
    expect(none.registry.create("alice").record.grant).toEqual(GRANT_ALL);
    none.registry.stop();
    // Any other identity: empty, so the workspace shows nothing until grantObjects.
    const oidc = newRegistry(join(state.dir, "other"), { identity: "oidc" });
    registry = oidc.registry;
    oidc.registry.start();
    const w = oidc.registry.create("alice");
    expect(w.record.grant).toEqual(GRANT_NONE);
    expect(oidc.registry.grantOf(w.record.id)).toEqual(GRANT_NONE);
  });

  it("seeds a new workspace through the seed function with the initial grant", () => {
    const grants: unknown[] = [];
    const { registry } = fresh({}, (grant) => {
      grants.push(grant);
      return {
        ...EMPTY_WORKSPACE,
        measurement: { name: "smart451 test" },
        eventSignals: ["testcar/E"],
      };
    });
    const first = registry.create("alice");
    expect(first.store.workspace.measurement).toEqual({ name: "smart451 test" });
    expect(first.store.workspace.eventSignals).toEqual(["testcar/E"]);
    expect(first.store.revision).toBe(0);
    expect(grants).toEqual([GRANT_ALL]);
  });

  it("lists a user's own workspaces, latest last-active first", () => {
    const { registry } = fresh();
    const a = registry.create("alice");
    vi.advanceTimersByTime(1000);
    const b = registry.create("alice");
    vi.advanceTimersByTime(1000);
    const c = registry.create("alice");
    registry.create("bob");
    expect(registry.listOf("alice").map((s) => s.record.id)).toEqual([
      c.record.id,
      b.record.id,
      a.record.id,
    ]);
    vi.advanceTimersByTime(1000);
    registry.touch(a.record.id);
    expect(registry.listOf("alice").map((s) => s.record.id)).toEqual([
      a.record.id,
      c.record.id,
      b.record.id,
    ]);
    expect(a.record.lastActiveAt).toBe(new Date(START.getTime() + 3000).toISOString());
    expect(registry.listOf("bob")).toHaveLength(1);
    expect(registry.listOf("nobody")).toEqual([]);
  });

  it("serves the latest own workspace by default, else creates one", () => {
    const { registry } = fresh();
    const a = registry.create("alice");
    vi.advanceTimersByTime(1000);
    const b = registry.create("alice");
    const bob = registry.create("bob");
    expect(registry.defaultOf("alice")).toBe(b);
    // Never someone else's workspace, however recent.
    vi.advanceTimersByTime(1000);
    registry.touch(bob.record.id);
    expect(registry.defaultOf("alice")).toBe(b);
    vi.advanceTimersByTime(1000);
    registry.touch(a.record.id);
    expect(registry.defaultOf("alice")).toBe(a);
    // A user without workspaces gets one, and keeps it.
    const first = registry.defaultOf("carol");
    expect(first.record.owner).toBe("carol");
    expect(registry.defaultOf("carol")).toBe(first);
    expect(registry.listOf("carol")).toEqual([first]);
  });

  it("reuses a free workspace once", () => {
    const { registry } = fresh();
    const f = registry.create("alice");
    vi.advanceTimersByTime(1000);
    const l = registry.create("alice");
    l.store.connect("alice");
    registry.create("bob");
    // L is the latest, but has a live client: F is the free one. The second call in the same
    // tick cannot get F again, so it makes a new workspace N.
    const one = registry.reuseOf("alice");
    const two = registry.reuseOf("alice");
    expect(one.entry).toBe(f);
    expect(one.reused).toBe(true);
    expect(two.reused).toBe(false);
    expect(two.entry).not.toBe(f);
    expect(two.entry).not.toBe(l);
    expect(two.entry.record.owner).toBe("alice");
    expect(registry.get(two.entry.record.id)).toBe(two.entry);
    // The claim lives in memory for 10 s only: 11 s later, with no client connected meanwhile,
    // F is free again. (N is dropped first so that F is the latest free workspace.)
    registry.delete(two.entry.record.id);
    vi.advanceTimersByTime(11_000);
    const three = registry.reuseOf("alice");
    expect(three.reused).toBe(true);
    expect(three.entry).toBe(f);
  });

  it("keeps a claimed workspace from a second pick for 10 s", () => {
    const { registry } = fresh();
    const f = registry.create("alice");
    expect(registry.reuseOf("alice").entry).toBe(f);
    vi.advanceTimersByTime(9_000);
    const second = registry.reuseOf("alice");
    expect(second.reused).toBe(false);
    expect(second.entry).not.toBe(f);
  });

  it("makes a new workspace for reuse when none qualifies", () => {
    const { registry } = fresh();
    const only = registry.create("alice");
    only.store.connect("alice");
    const { entry, reused } = registry.reuseOf("alice");
    expect(reused).toBe(false);
    expect(entry).not.toBe(only);
    expect(registry.reuseOf("dave").reused).toBe(false);
  });

  it("sets the share level, deletes, and reports both", () => {
    const { registry } = fresh();
    const s = registry.create("alice");
    const events: string[] = [];
    registry.onChange((e) => events.push(`${e.type}:${e.entry.record.id}`));
    expect(registry.setShare(s.record.id, "write").record.share).toBe("write");
    expect(registry.get(s.record.id)?.record.share).toBe("write");
    expect(() => registry.setShare("zzzzzzzzzz", "read")).toThrow();
    expect(registry.delete(s.record.id)).toBe(true);
    expect(registry.delete(s.record.id)).toBe(false);
    expect(registry.get(s.record.id)).toBeUndefined();
    expect(registry.listOf("alice")).toEqual([]);
    expect(events).toEqual([`share:${s.record.id}`, `delete:${s.record.id}`]);
  });

  it("fires command events with scopeChanged and stops after unsubscribe", () => {
    const { registry } = fresh();
    const s = registry.create("alice");
    const seen: { type: string; scopeChanged: boolean }[] = [];
    const off = registry.onChange((e) => seen.push({ type: e.type, scopeChanged: e.scopeChanged }));
    s.store.execute({ type: "window.create", from: "0", to: "10" }, ctx);
    s.store.execute({ type: "scope.set", dataRef: "testcar", from: T1, to: T2 }, ctx);
    s.store.execute({ type: "scope.set", dataRef: "testcar", from: T1, to: T2 }, ctx);
    s.store.execute({ type: "scope.clear" }, ctx);
    expect(seen).toEqual([
      { type: "command", scopeChanged: false },
      { type: "command", scopeChanged: true },
      { type: "command", scopeChanged: false },
      { type: "command", scopeChanged: true },
    ]);
    off();
    s.store.execute({ type: "cursor.set", cursor: "a", t: "5" }, ctx);
    expect(seen).toHaveLength(4);
  });

  it("lists the workspaces with a live client as open", () => {
    const { registry } = fresh();
    const a = registry.create("alice");
    const b = registry.create("bob");
    expect(registry.open()).toEqual([]);
    const c1 = a.store.connect("alice");
    const c2 = a.store.connect("bob");
    expect(registry.open()).toEqual([a]);
    b.store.connect("bob");
    expect(registry.open()).toHaveLength(2);
    a.store.disconnect(c1);
    expect(registry.open()).toHaveLength(2);
    a.store.disconnect(c2);
    expect(registry.open()).toEqual([b]);
  });

  it("widens a grant only through grantObjects", () => {
    const { registry, warn } = fresh({ identity: "oidc" });
    const a = registry.create("alice");
    const events: string[] = [];
    registry.onChange((e) => events.push(e.type));
    expect(registry.grantOf(a.record.id)).toEqual({ objects: [] });

    // 1. The first call adds one object, persists it and fires one grant event.
    expect(registry.grantObjects(a.record.id, ["testcar"])).toBe(a);
    expect(registry.grantOf(a.record.id)).toEqual({ objects: ["testcar"] });
    expect(covers(registry.grantOf(a.record.id), "testcar")).toBe(true);
    expect(covers(registry.grantOf(a.record.id), "othercar")).toBe(false);
    expect(events).toEqual(["grant"]);
    registry.flush();
    const file = JSON.parse(readFileSync(join(state.workspacesDir, `${a.record.id}.json`), "utf8"));
    expect(file.grant).toEqual({ objects: ["testcar"] });

    // 2. Unique, the existing order kept, the new ones appended.
    registry.grantObjects(a.record.id, ["othercar", "testcar"]);
    expect(registry.grantOf(a.record.id)).toEqual({ objects: ["testcar", "othercar"] });

    // 3. An unknown ID gives undefined and fires nothing.
    const before = events.length;
    expect(registry.grantObjects("zzzzzzzzzz", ["x"])).toBeUndefined();
    expect(events).toHaveLength(before);

    // 4. More than 2,000 objects are refused and leave the grant as it was.
    const many = Array.from({ length: MAX_GRANT_OBJECTS - 1 }, (_, i) => `car${i}`);
    expect(() => registry.grantObjects(a.record.id, many)).toThrow(GrantLimitError);
    expect(registry.grantOf(a.record.id)).toEqual({ objects: ["testcar", "othercar"] });
    // Exactly at the limit is fine.
    const fits = Array.from({ length: MAX_GRANT_OBJECTS - 2 }, (_, i) => `car${i}`);
    registry.grantObjects(a.record.id, fits);
    const granted = registry.grantOf(a.record.id).objects;
    expect(Array.isArray(granted) && granted.length).toBe(MAX_GRANT_OBJECTS);
    expect(warn).toEqual([]);
  });

  it("is a no-op for grantObjects on an all grant", () => {
    const { registry } = fresh();
    const a = registry.create("alice");
    registry.grantObjects(a.record.id, ["testcar"]);
    expect(registry.grantOf(a.record.id)).toEqual(GRANT_ALL);
    expect(a.record.grant).toEqual(GRANT_ALL);
  });

  it("reads a stored all as an empty grant on a server", () => {
    const first = fresh();
    const a = first.registry.create("local");
    first.registry.flush();
    first.registry.stop();
    // The state dir of `none` mode, now started under another identity.
    const server = newRegistry(state.dir, { identity: "oidc" });
    registry = server.registry;
    server.registry.start();
    expect(server.registry.get(a.record.id)?.record.grant).toEqual(GRANT_ALL);
    expect(server.registry.grantOf(a.record.id)).toEqual(GRANT_NONE);
  });

  it("evicts the least recently active workspace at the limit", () => {
    const { registry } = fresh({ limit: 200 });
    const made = [];
    for (let i = 0; i < 200; i++) {
      made.push(registry.create("alice"));
      vi.advanceTimersByTime(1000);
    }
    expect(registry.listOf("alice")).toHaveLength(200);
    // Another user's workspaces do not count.
    registry.create("bob");
    const oldest = made[0];
    const second = made[1];
    if (!oldest || !second) throw new Error("no workspaces");
    oldest.store.connect("alice");

    const extra = registry.create("alice");
    expect(registry.get(oldest.record.id)).toBe(oldest);
    expect(registry.get(second.record.id)).toBeUndefined();
    expect(registry.get(extra.record.id)).toBe(extra);
    expect(registry.listOf("alice")).toHaveLength(200);

    // Every workspace has a client: nothing may be evicted.
    for (const s of registry.listOf("alice")) s.store.connect("alice");
    expect(() => registry.create("alice")).toThrow(WorkspaceLimitError);
    expect(registry.listOf("alice")).toHaveLength(200);
    // Bob is not bound by alice's limit.
    expect(() => registry.create("bob")).not.toThrow();
  });

  it("uses the limit of 200 by default", () => {
    const { registry } = fresh();
    for (let i = 0; i < 200; i++) registry.create("alice");
    registry.create("alice");
    expect(registry.listOf("alice")).toHaveLength(200);
  });

  it("removes idle workspaces without clients", () => {
    const { registry } = fresh({ idleDays: 30 });
    const old = registry.create("alice");
    const oldWithClient = registry.create("alice");
    oldWithClient.store.connect("alice");
    vi.setSystemTime(Date.now() + 2 * DAY);
    const recent = registry.create("alice");
    // The clock jumps (no hourly run in between): 29 days later the first two are 31 days idle, `recent` 29 days.
    vi.setSystemTime(Date.now() + 29 * DAY);
    const current = registry.create("alice");
    registry.flush();
    expect(state.files()).toHaveLength(4);
    expect(registry.cleanup()).toBe(1);
    expect(registry.get(old.record.id)).toBeUndefined();
    expect(registry.get(oldWithClient.record.id)).toBe(oldWithClient);
    expect(registry.get(recent.record.id)).toBe(recent);
    expect(registry.get(current.record.id)).toBe(current);
    expect(existsSync(join(state.workspacesDir, `${old.record.id}.json`))).toBe(false);
    expect(state.files()).toHaveLength(3);
    // Nothing more to remove now.
    expect(registry.cleanup()).toBe(0);
  });

  it("runs the idle cleanup every hour", () => {
    const { registry } = fresh({ idleDays: 1 });
    const s = registry.create("alice");
    vi.advanceTimersByTime(23 * 3_600_000);
    expect(registry.get(s.record.id)).toBeDefined();
    // 24 h + 1 h tick: idle for more than one day, the hourly run removes it.
    vi.advanceTimersByTime(2 * 3_600_000);
    expect(registry.get(s.record.id)).toBeUndefined();
  });

  it("a live connect keeps a workspace from idling out", () => {
    const { registry } = fresh({ idleDays: 30 });
    const s = registry.create("alice");
    vi.advanceTimersByTime(29 * DAY);
    registry.touch(s.record.id);
    vi.advanceTimersByTime(29 * DAY);
    expect(registry.cleanup()).toBe(0);
    expect(registry.get(s.record.id)).toBe(s);
  });

  it("stop() turns the timers off", () => {
    const { registry } = fresh({ idleDays: 1 });
    const s = registry.create("alice");
    registry.stop();
    vi.advanceTimersByTime(3 * DAY);
    expect(registry.get(s.record.id)).toBe(s);
  });
});
