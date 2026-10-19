import { existsSync } from "node:fs";
import { join } from "node:path";
import { EMPTY_WORKSPACE, SESSION_ID } from "@kipscope/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionLimitError, type SessionStore } from "../src/sessions.ts";
import { ctx, newStore, T1, T2, tempState } from "./sessionsKit.ts";

const DAY = 86_400_000;
const START = new Date("2026-10-19T08:00:00Z");

let state: ReturnType<typeof tempState>;
let store: SessionStore | undefined;
beforeEach(() => {
  vi.useFakeTimers({ now: START });
  state = tempState();
});
afterEach(() => {
  store?.stop();
  store = undefined;
  vi.useRealTimers();
  state.cleanup();
});

const fresh = (extra: Parameters<typeof newStore>[1] = {}) => {
  const made = newStore(state.dir, extra);
  store = made.store;
  made.store.start();
  return made;
};

describe("session store", () => {
  it("creates sessions with random IDs, the owner and a private share", () => {
    const { store } = fresh();
    const a = store.create("alice");
    const b = store.create("alice");
    expect(a.record.id).toMatch(SESSION_ID);
    expect(b.record.id).toMatch(SESSION_ID);
    expect(a.record.id).not.toBe(b.record.id);
    expect(a.record).toMatchObject({
      owner: "alice",
      share: "private",
      createdAt: START.toISOString(),
      lastActiveAt: START.toISOString(),
    });
    expect(a.store.revision).toBe(0);
    expect(store.get(a.record.id)).toBe(a);
    expect(store.get("zzzzzzzzzz")).toBeUndefined();
  });

  it("seeds a new session's workspace and lets the caller override the seed", () => {
    const made = newStore(state.dir, {}, () => ({
      ...EMPTY_WORKSPACE,
      measurement: { name: "smart451 test" },
      eventSignals: ["testcar/E"],
    }));
    store = made.store;
    made.store.start();
    const first = made.store.create("alice");
    expect(first.store.workspace.measurement).toEqual({ name: "smart451 test" });
    expect(first.store.workspace.eventSignals).toEqual(["testcar/E"]);
    expect(first.store.revision).toBe(0);
    const own = made.store.create("alice", { ...EMPTY_WORKSPACE, measurement: { name: "own" } });
    expect(own.store.workspace.measurement).toEqual({ name: "own" });
    expect(own.store.workspace.eventSignals).toBeUndefined();
    expect(own.store.revision).toBe(0);
  });

  it("lists a user's own sessions, latest last-active first", () => {
    const { store } = fresh();
    const a = store.create("alice");
    vi.advanceTimersByTime(1000);
    const b = store.create("alice");
    vi.advanceTimersByTime(1000);
    const c = store.create("alice");
    store.create("bob");
    expect(store.listOf("alice").map((s) => s.record.id)).toEqual([
      c.record.id,
      b.record.id,
      a.record.id,
    ]);
    vi.advanceTimersByTime(1000);
    store.touch(a.record.id);
    expect(store.listOf("alice").map((s) => s.record.id)).toEqual([
      a.record.id,
      c.record.id,
      b.record.id,
    ]);
    expect(a.record.lastActiveAt).toBe(new Date(START.getTime() + 3000).toISOString());
    expect(store.listOf("bob")).toHaveLength(1);
    expect(store.listOf("nobody")).toEqual([]);
  });

  it("serves the latest own session that canOpen accepts, else creates one", () => {
    const { store } = fresh();
    const a = store.create("alice");
    vi.advanceTimersByTime(1000);
    const b = store.create("alice");
    const bob = store.create("bob");
    expect(store.defaultOf("alice", () => true)).toBe(b);
    // The latest is refused (e.g. it holds hidden data): the next one serves.
    expect(store.defaultOf("alice", (s) => s !== b)).toBe(a);
    // Never someone else's session, however recent.
    expect(store.defaultOf("alice", (s) => s.record.owner === "alice")).toBe(b);
    // Nothing openable: a new empty one, owned by the user, kept in the list.
    const created = store.defaultOf("alice", () => false);
    expect([a, b]).not.toContain(created);
    expect(created.record.owner).toBe("alice");
    expect(store.listOf("alice")).toContain(created);
    expect(store.get(bob.record.id)).toBe(bob);
    // A user without sessions gets one.
    const first = store.defaultOf("carol", () => true);
    expect(first.record.owner).toBe("carol");
    expect(store.defaultOf("carol", () => true)).toBe(first);
  });

  it("sets the share level, deletes, and reports both", () => {
    const { store } = fresh();
    const s = store.create("alice");
    const events: string[] = [];
    store.onChange((e) => events.push(`${e.type}:${e.session.record.id}`));
    expect(store.setShare(s.record.id, "write").record.share).toBe("write");
    expect(store.get(s.record.id)?.record.share).toBe("write");
    expect(() => store.setShare("zzzzzzzzzz", "read")).toThrow();
    expect(store.delete(s.record.id)).toBe(true);
    expect(store.delete(s.record.id)).toBe(false);
    expect(store.get(s.record.id)).toBeUndefined();
    expect(store.listOf("alice")).toEqual([]);
    expect(events).toEqual([`share:${s.record.id}`, `delete:${s.record.id}`]);
  });

  it("fires command events with scopeChanged and stops after unsubscribe", () => {
    const { store } = fresh();
    const s = store.create("alice");
    const seen: { type: string; scopeChanged: boolean }[] = [];
    const off = store.onChange((e) => seen.push({ type: e.type, scopeChanged: e.scopeChanged }));
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

  it("lists the sessions with a live client as open", () => {
    const { store } = fresh();
    const a = store.create("alice");
    const b = store.create("bob");
    expect(store.open()).toEqual([]);
    const c1 = a.store.connect("alice");
    const c2 = a.store.connect("bob");
    expect(store.open()).toEqual([a]);
    b.store.connect("bob");
    expect(store.open()).toHaveLength(2);
    a.store.disconnect(c1);
    expect(store.open()).toHaveLength(2);
    a.store.disconnect(c2);
    expect(store.open()).toEqual([b]);
  });

  it("evicts the least recently active session at the limit", () => {
    const { store } = fresh({ limit: 200 });
    const made = [];
    for (let i = 0; i < 200; i++) {
      made.push(store.create("alice"));
      vi.advanceTimersByTime(1000);
    }
    expect(store.listOf("alice")).toHaveLength(200);
    // Another user's sessions do not count.
    store.create("bob");
    const oldest = made[0];
    const second = made[1];
    if (!oldest || !second) throw new Error("no sessions");
    oldest.store.connect("alice");

    const extra = store.create("alice");
    expect(store.get(oldest.record.id)).toBe(oldest);
    expect(store.get(second.record.id)).toBeUndefined();
    expect(store.get(extra.record.id)).toBe(extra);
    expect(store.listOf("alice")).toHaveLength(200);

    // Every session has a client: nothing may be evicted.
    for (const s of store.listOf("alice")) s.store.connect("alice");
    expect(() => store.create("alice")).toThrow(SessionLimitError);
    expect(store.listOf("alice")).toHaveLength(200);
    // Bob is not bound by alice's limit.
    expect(() => store.create("bob")).not.toThrow();
  });

  it("uses the limit of 200 by default", () => {
    const { store } = fresh();
    for (let i = 0; i < 200; i++) store.create("alice");
    store.create("alice");
    expect(store.listOf("alice")).toHaveLength(200);
  });

  it("removes idle sessions without clients", () => {
    const { store } = fresh({ idleDays: 30 });
    const old = store.create("alice");
    const oldWithClient = store.create("alice");
    oldWithClient.store.connect("alice");
    vi.setSystemTime(Date.now() + 2 * DAY);
    const recent = store.create("alice");
    // The clock jumps (no hourly run in between): 29 days later the first two are 31 days idle, `recent` 29 days.
    vi.setSystemTime(Date.now() + 29 * DAY);
    const current = store.create("alice");
    store.flush();
    expect(state.files()).toHaveLength(4);
    expect(store.cleanup()).toBe(1);
    expect(store.get(old.record.id)).toBeUndefined();
    expect(store.get(oldWithClient.record.id)).toBe(oldWithClient);
    expect(store.get(recent.record.id)).toBe(recent);
    expect(store.get(current.record.id)).toBe(current);
    expect(existsSync(join(state.sessionsDir, `${old.record.id}.json`))).toBe(false);
    expect(state.files()).toHaveLength(3);
    // Nothing more to remove now.
    expect(store.cleanup()).toBe(0);
  });

  it("runs the idle cleanup every hour", () => {
    const { store } = fresh({ idleDays: 1 });
    const s = store.create("alice");
    vi.advanceTimersByTime(23 * 3_600_000);
    expect(store.get(s.record.id)).toBeDefined();
    // 24 h + 1 h tick: idle for more than one day, the hourly run removes it.
    vi.advanceTimersByTime(2 * 3_600_000);
    expect(store.get(s.record.id)).toBeUndefined();
  });

  it("a live connect keeps a session from idling out", () => {
    const { store } = fresh({ idleDays: 30 });
    const s = store.create("alice");
    vi.advanceTimersByTime(29 * DAY);
    store.touch(s.record.id);
    vi.advanceTimersByTime(29 * DAY);
    expect(store.cleanup()).toBe(0);
    expect(store.get(s.record.id)).toBe(s);
  });

  it("stop() turns the timers off", () => {
    const { store } = fresh({ idleDays: 1 });
    const s = store.create("alice");
    store.stop();
    vi.advanceTimersByTime(3 * DAY);
    expect(store.get(s.record.id)).toBe(s);
  });
});
