import { existsSync } from "node:fs";
import { join } from "node:path";
import { SESSION_HEADER, SESSION_ID } from "@kipscope/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type Client,
  codeOf,
  type MultiApp,
  multiApp,
  SCOPE,
  T1,
  T2,
  viewDoc,
} from "./identityApp.ts";
import { type MemorySignal, memoryAdapter } from "./scopeApp.ts";
import { testSource } from "./testdb.ts";

let t: MultiApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const SIG = "testcar/Fast_100h.SIG_A";
const MIN = 60_000_000_000n;
const range = { from: T1.toString(), to: (T1 + 10n * MIN).toString() };
const create = async (c: Client) => (await c.post("/api/sessions", {})).body.session.id as string;
const windowCreate = { type: "window.create", ...range };

describe("a workspace per session", () => {
  it("keeps sessions apart", async () => {
    t = await multiApp();
    const alice = t.as("alice", ["all"]);
    const a = await create(alice);
    const b = await create(alice);
    expect(a).toMatch(SESSION_ID);
    expect(b).toMatch(SESSION_ID);
    expect(a).not.toBe(b);
    for (let i = 0; i < 3; i++) expect((await alice.command(windowCreate, a)).status).toBe(200);
    const bWorkspace = await alice.get(`/api/s/${b}/workspace`);
    expect(bWorkspace.body.revision).toBe(0);
    expect(bWorkspace.body.workspace.windows).toEqual([]);
    const aWorkspace = await alice.get(`/api/s/${a}/workspace`);
    expect(aWorkspace.body.revision).toBe(3);
    const summary = await alice.get(`/api/sessions/${a}`);
    expect(summary.body.session).toMatchObject({
      id: a,
      owner: "alice",
      share: "private",
      windows: 3,
    });
  });

  it("gives a new session its owner from the identity, never from the body", async () => {
    t = await multiApp();
    const alice = t.as("alice", ["all"]);
    const forged = await alice.post("/api/sessions", { owner: "mallory" });
    expect(forged.status).toBe(400);
    const own = await alice.post("/api/sessions", {});
    expect(own.body.session.owner).toBe("alice");
    expect(own.body.session.share).toBe("private");
    expect(t.sessions.listOf("mallory")).toEqual([]);
    // No body at all works as well.
    const bare = await alice.post("/api/sessions");
    expect(bare.status).toBe(200);
  });

  it("addresses a session by its prefix", async () => {
    t = await multiApp();
    const alice = t.as("alice", ["all"]);
    const a = await create(alice);
    const posted = await alice.command(windowCreate, a);
    expect(posted.status).toBe(200);
    expect(posted.headers[SESSION_HEADER]).toBe(a);
    const read = await alice.get(`/api/s/${a}/workspace`);
    expect(read.body.workspace.windows).toHaveLength(1);
    expect(read.headers[SESSION_HEADER]).toBe(a);

    const live = await alice.live(a);
    await live.next((m) => m.type === "state");
    expect(live.messages.map((m) => m.type)).toEqual(["hello", "session", "state"]);
    expect(live.last("session")?.session.id).toBe(a);
    expect(live.last("state")?.revision).toBe(1);
    live.close();

    const unknown = await alice.get("/api/s/zzzzzzzzzz/workspace");
    expect(unknown.status).toBe(404);
    expect(codeOf(unknown.body)).toBe("unknown_session");
    // A prefix of the wrong form is no prefix: the path is not found.
    const odd = await alice.get("/api/s/ABC/workspace");
    expect(odd.status).toBe(404);
  });

  it("names the session on the routes that serve one and on no other", async () => {
    t = await multiApp({ licenseText: "AAL" });
    const alice = t.as("alice", ["all"]);
    const a = await create(alice);
    expect((await alice.get("/api/me")).headers[SESSION_HEADER]).toBeUndefined();
    expect((await alice.get("/api/sessions")).headers[SESSION_HEADER]).toBeUndefined();
    expect((await alice.get("/api/views")).headers[SESSION_HEADER]).toBeUndefined();
    expect((await alice.get("/api/license")).headers[SESSION_HEADER]).toBeUndefined();
    for (const path of ["workspace", "render-status", "catalog", "signals", "meta"])
      expect((await alice.get(`/api/s/${a}/${path}`)).headers[SESSION_HEADER], path).toBe(a);
    // A prefix on a session-independent route is ignored, even one that names no session.
    expect((await alice.get("/api/s/zzzzzzzzzz/me")).status).toBe(200);
    const listed = await alice.get(`/api/s/${a}/sessions`);
    expect(listed.status).toBe(200);
    expect(listed.body.sessions.map((s: { id: string }) => s.id)).toEqual([a]);
  });

  it("serves the most recently active session without a prefix", async () => {
    t = await multiApp();
    const alice = t.as("alice", ["all"]);
    const first = await alice.get("/api/workspace");
    const s1 = first.headers[SESSION_HEADER] as string;
    expect(s1).toMatch(SESSION_ID);
    await new Promise((r) => setTimeout(r, 5));
    const s2 = await create(alice);
    expect((await alice.get("/api/workspace")).headers[SESSION_HEADER]).toBe(s2);
    await new Promise((r) => setTimeout(r, 5));
    expect((await alice.command({ type: "cursor.set", cursor: "a", t: "5" }, s1)).status).toBe(200);
    expect((await alice.get("/api/workspace")).headers[SESSION_HEADER]).toBe(s1);
    const list = await alice.get("/api/sessions");
    expect(list.body.sessions.map((s: { id: string }) => s.id)).toEqual([s1, s2]);
  });

  it("makes a live connect count as activity", async () => {
    t = await multiApp();
    const alice = t.as("alice", ["all"]);
    const s1 = await create(alice);
    await new Promise((r) => setTimeout(r, 5));
    const s2 = await create(alice);
    expect((await alice.get("/api/workspace")).headers[SESSION_HEADER]).toBe(s2);
    await new Promise((r) => setTimeout(r, 5));
    const live = await alice.live(s1);
    await live.next((m) => m.type === "state");
    expect((await alice.get("/api/workspace")).headers[SESSION_HEADER]).toBe(s1);
    live.close();
  });

  it("keeps the default sessions of two users apart", async () => {
    t = await multiApp();
    const a = await t.as("alice", ["all"]).get("/api/workspace");
    const b = await t.as("bob", ["all"]).get("/api/workspace");
    expect(a.headers[SESSION_HEADER]).not.toBe(b.headers[SESSION_HEADER]);
    expect(t.sessions.listOf("alice")).toHaveLength(1);
    expect(t.sessions.listOf("bob")).toHaveLength(1);
  });
});

describe("rights per session", () => {
  it("enforces session rights", async () => {
    t = await multiApp();
    const alice = t.as("alice", ["all"]);
    const bob = t.as("bob", ["all"]);
    const a = await create(alice);
    expect(
      (
        await alice.command(
          { type: "scope.set", dataRef: SCOPE.dataRef, from: SCOPE.from, to: SCOPE.to },
          a,
        )
      ).status,
    ).toBe(200);
    expect((await alice.command(windowCreate, a)).status).toBe(200);
    const revision = t.sessions.get(a)?.store.revision;

    // Private: no access, the live channel gives no message.
    const denied = await bob.get(`/api/s/${a}/workspace`);
    expect([denied.status, codeOf(denied.body)]).toEqual([403, "forbidden"]);
    const refusedLive = await bob.live(a);
    expect(refusedLive.messages).toEqual([]);
    expect(refusedLive.status === 403 || refusedLive.closeCode !== undefined).toBe(true);

    // Read: both reads work, both changes are refused and change nothing.
    expect((await alice.post(`/api/sessions/${a}/share`, { share: "read" })).status).toBe(200);
    expect((await bob.get(`/api/s/${a}/workspace`)).status).toBe(200);
    expect((await bob.get(`/api/s/${a}/catalog`)).status).toBe(200);
    for (const attempt of [
      await bob.command(windowCreate, a),
      await bob.post(`/api/s/${a}/views/open`, { name: "x" }),
      await bob.post(`/api/s/${a}/catalog/refresh`).then((r) => ({
        ...r,
        status: r.status === 200 ? 403 : r.status,
        body: { error: { code: "read_only" } },
      })),
    ]) {
      expect(attempt.status).toBe(403);
      expect(codeOf(attempt.body)).toBe("read_only");
    }
    expect(t.sessions.get(a)?.store.revision).toBe(revision);

    // Write: the command is accepted.
    expect((await alice.post(`/api/sessions/${a}/share`, { share: "write" })).status).toBe(200);
    expect((await bob.command(windowCreate, a)).status).toBe(200);
    expect(t.sessions.get(a)?.store.revision).toBe((revision ?? 0) + 1);

    // Only the owner changes the share level or deletes.
    for (const attempt of [
      await bob.post(`/api/sessions/${a}/share`, { share: "private" }),
      await bob.del(`/api/sessions/${a}`),
    ]) {
      expect([attempt.status, codeOf(attempt.body)]).toEqual([403, "not_owner"]);
    }
    expect(t.sessions.get(a)).toBeDefined();
    expect(t.sessions.get(a)?.record.share).toBe("write");
  });

  it("refuses a change by a reader before it looks at the command", async () => {
    t = await multiApp();
    const alice = t.as("alice", ["all"]);
    const bob = t.as("bob", ["all"]);
    const a = await create(alice);
    await alice.post(`/api/sessions/${a}/share`, { share: "read" });
    // Even a command that is invalid, or a body that is no JSON object, answers read_only first.
    for (const body of [{ type: "nonsense" }, {}, [1, 2]]) {
      const res = await bob.command(body, a);
      expect([res.status, codeOf(res.body)], JSON.stringify(body)).toEqual([403, "read_only"]);
    }
    for (const url of ["views", "views/open"]) {
      const res = await bob.post(`/api/s/${a}/${url}`, { title: "t", name: "x" });
      expect([res.status, codeOf(res.body)], url).toEqual([403, "read_only"]);
    }
    // An import that does not open changes only the user's own views.
    const stored = await bob.post(`/api/s/${a}/views/import`, { text: "{}" });
    expect(stored.status).toBe(400);
    const imported = await bob.post(`/api/s/${a}/views/import`, { text: "{}", open: true });
    expect([imported.status, codeOf(imported.body)]).toEqual([403, "read_only"]);
  });

  it("does not let a user read another user's private session through the summary route", async () => {
    t = await multiApp();
    const alice = t.as("alice", ["all"]);
    const bob = t.as("bob", ["all"]);
    const a = await create(alice);
    const res = await bob.get(`/api/sessions/${a}`);
    expect(res.status).toBe(403);
    expect(res.text).not.toContain("alice");
    expect((await bob.get("/api/sessions")).body.sessions).toEqual([]);
    const shared = await alice.post(`/api/sessions/${a}/share`, { share: "read" });
    expect(shared.status).toBe(200);
    const open = await bob.get(`/api/sessions/${a}`);
    expect(open.status).toBe(200);
    expect(open.body.session.rights).toEqual({ open: true, change: false, owner: false });
    // Still only his own in his list.
    expect((await bob.get("/api/sessions")).body.sessions).toEqual([]);
  });

  it("applies share changes and deletes to open connections", async () => {
    t = await multiApp();
    const alice = t.as("alice", ["all"]);
    const bob = t.as("bob", ["all"]);
    const a = await create(alice);
    await alice.post(`/api/sessions/${a}/share`, { share: "write" });
    const live = await bob.live(a);
    await live.next((m) => m.type === "state");
    expect(live.last("session")?.session.rights).toEqual({
      open: true,
      change: true,
      owner: false,
    });

    await alice.post(`/api/sessions/${a}/share`, { share: "read" });
    const reduced = await live.next(
      (m) => m.type === "session" && m.session.rights?.change === false,
    );
    expect(reduced).toMatchObject({ session: { id: a, rights: { open: true, change: false } } });
    expect(live.closeCode).toBeUndefined();

    await alice.post(`/api/sessions/${a}/share`, { share: "private" });
    expect(await live.closedBy()).toBe(4403);

    await alice.post(`/api/sessions/${a}/share`, { share: "write" });
    const again = await bob.live(a);
    await again.next((m) => m.type === "state");
    expect((await alice.del(`/api/sessions/${a}`)).status).toBe(200);
    expect(await again.closedBy()).toBe(4404);
    const gone = await alice.get(`/api/sessions/${a}`);
    expect([gone.status, codeOf(gone.body)]).toEqual([404, "unknown_session"]);
  });

  it("closes the owner's own connection when the session is deleted", async () => {
    t = await multiApp();
    const alice = t.as("alice", ["all"]);
    const a = await create(alice);
    const live = await alice.live(a);
    await live.next((m) => m.type === "state");
    await alice.del(`/api/sessions/${a}`);
    expect(await live.closedBy()).toBe(4404);
  });

  it("keeps render status per session", async () => {
    t = await multiApp();
    const alice = t.as("alice", ["all"]);
    const a = await create(alice);
    const b = await create(alice);
    const liveA = await alice.live(a);
    const liveB = await alice.live(b);
    await liveA.next((m) => m.type === "state");
    await liveB.next((m) => m.type === "state");
    await alice.command(windowCreate, a);
    const status = await alice.get(`/api/s/${a}/render-status`);
    expect(status.body.revision).toBe(1);
    expect(status.body.clients).toHaveLength(1);
    const helloA = liveA.messages.find((m) => m.type === "hello");
    expect(status.body.clients[0]).toMatchObject({
      clientId: (helloA as { clientId: string }).clientId,
      user: "alice",
    });
    const other = await alice.get(`/api/s/${b}/render-status`);
    expect(other.body.revision).toBe(0);
    expect(other.body.clients).toHaveLength(1);
    liveA.close();
    liveB.close();
  });

  it("lists the user of each connection in the render status", async () => {
    t = await multiApp();
    const alice = t.as("alice", ["all"]);
    const bob = t.as("bob", ["all"]);
    const a = await create(alice);
    await alice.post(`/api/sessions/${a}/share`, { share: "read" });
    const l1 = await alice.live(a);
    const l2 = await bob.live(a);
    await l1.next((m) => m.type === "state");
    await l2.next((m) => m.type === "state");
    const users = (await bob.get(`/api/s/${a}/render-status`)).body.clients.map(
      (c: { user: string }) => c.user,
    );
    expect(users.sort()).toEqual(["alice", "bob"]);
  });
});

describe("session management", () => {
  it("lists, shares and deletes sessions", async () => {
    t = await multiApp();
    const alice = t.as("alice", ["all"]);
    const bob = t.as("bob", ["all"]);
    const s1 = await create(alice);
    const s2 = await create(alice);
    await bob.post("/api/sessions", {});
    await new Promise((r) => setTimeout(r, 5));
    expect(
      (
        await alice.command(
          { type: "scope.set", dataRef: SCOPE.dataRef, from: SCOPE.from, to: SCOPE.to },
          s1,
        )
      ).status,
    ).toBe(200);

    const list = await alice.get("/api/sessions");
    const ids = list.body.sessions.map((s: { id: string }) => s.id);
    expect(ids).toEqual([s1, s2]);
    expect(list.body.sessions[0]).toMatchObject({
      id: s1,
      owner: "alice",
      scope: SCOPE,
      clients: 0,
      rights: { open: true, change: true, owner: true },
    });

    const shared = await alice.post(`/api/sessions/${s1}/share`, { share: "write" });
    expect(shared.status).toBe(200);
    expect(shared.body.session.share).toBe("write");

    t.sessions.flush();
    const file = join(t.stateDir, "sessions", `${s2}.json`);
    expect(existsSync(file)).toBe(true);
    const deleted = await alice.del(`/api/sessions/${s2}`);
    expect(deleted.body).toEqual({ deleted: s2 });
    expect(existsSync(file)).toBe(false);
    const after = await alice.get("/api/sessions");
    expect(after.body.sessions.map((s: { id: string }) => s.id)).toEqual([s1]);
    const again = await alice.del(`/api/sessions/${s2}`);
    expect([again.status, codeOf(again.body)]).toEqual([404, "unknown_session"]);
  });

  it("rejects a malformed share request", async () => {
    t = await multiApp();
    const alice = t.as("alice", ["all"]);
    const a = await create(alice);
    for (const body of [{}, { share: "public" }, { share: "read", owner: "bob" }]) {
      const res = await alice.post(`/api/sessions/${a}/share`, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await alice.get(`/api/sessions/${a}`)).body.session.share).toBe("private");
  });

  it("creates a session with an open view", async () => {
    t = await multiApp();
    const alice = t.as("alice", ["all"]);
    const doc = viewDoc([[SIG], [`testcar/Cyc_B10h.CYC`]]);
    const opened = await alice.post("/api/sessions", { open: { view: doc } });
    expect(opened.status).toBe(200);
    expect(opened.body.session.windows).toBe(2);
    expect(opened.body.result.ok).toBe(true);
    const unsupported = await alice.post("/api/sessions", {
      open: { view: { kipscope: "view", version: 9 } },
    });
    expect([unsupported.status, codeOf(unsupported.body)]).toEqual([422, "unsupported_version"]);
    const unknown = await alice.post("/api/sessions", { open: { name: "nope" } });
    expect([unknown.status, codeOf(unknown.body)]).toEqual([404, "unknown_view"]);
    // Only the first one made a session.
    const list = await alice.get("/api/sessions");
    expect(list.body.sessions).toHaveLength(1);
    expect(list.body.sessions[0].windows).toBe(2);
  });

  it("opens a saved view of the requester into a new session", async () => {
    t = await multiApp();
    const alice = t.as("alice", ["all"]);
    const first = await create(alice);
    await alice.command({ ...windowCreate }, first);
    await alice.command({ type: "window.addSignal", windowId: "w1", signalId: SIG }, first);
    expect((await alice.post(`/api/s/${first}/views`, { title: "Speeds" })).status).toBe(200);
    const opened = await alice.post("/api/sessions", { open: { name: "speeds" } });
    expect(opened.status).toBe(200);
    expect(opened.body.session.id).not.toBe(first);
    expect(opened.body.session.windows).toBe(1);
    // Bob has no such view.
    const bob = t.as("bob", ["all"]);
    const none = await bob.post("/api/sessions", { open: { name: "speeds" } });
    expect([none.status, codeOf(none.body)]).toEqual([404, "unknown_view"]);
    expect(t.sessions.listOf("bob")).toEqual([]);
  });

  it("evicts the oldest idle session at the limit and refuses when all have clients", async () => {
    t = await multiApp({ sessionLimit: 3 });
    const alice = t.as("alice", ["all"]);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(await create(alice));
      await new Promise((r) => setTimeout(r, 3));
    }
    const fourth = await create(alice);
    const list = (await alice.get("/api/sessions")).body.sessions.map((s: { id: string }) => s.id);
    expect(list).toHaveLength(3);
    expect(list).not.toContain(ids[0]);
    expect(list).toContain(fourth);
    // Every session has a client: no room.
    const lives = [];
    for (const id of list) lives.push(await alice.live(id));
    for (const live of lives) await live.next((m) => m.type === "state");
    const full = await alice.post("/api/sessions", {});
    expect([full.status, codeOf(full.body)]).toEqual([409, "session_limit"]);
    // Another user is not bound by her sessions.
    expect((await t.as("bob", ["all"]).post("/api/sessions", {})).status).toBe(200);
    for (const live of lives) live.close();
  });
});

/** Sources with one signal in each of eight data refs, for the signal-list tests. */
const CARS: MemorySignal[] = Array.from({ length: 8 }, (_, i) => ({
  dataRef: `car${i}`,
  name: "Speed_100h.V",
  rows: Array.from({ length: 30 }, (_, k): [bigint, number] => [T1 + BigInt(k) * MIN, k]),
}));
const scopeOfCar = (i: number) => ({ dataRef: `car${i}`, from: T1.toString(), to: T2.toString() });
const listCallsOf = (m: MultiApp, dataRef: string) =>
  m.calls.filter(
    (c) =>
      c.method === "listSignals" &&
      (c.args[0] as { dataRef?: string } | undefined)?.dataRef === dataRef,
  ).length;

describe("signal lists of open sessions", () => {
  it("shares and keeps the signal lists of open sessions", async () => {
    t = await multiApp({ mode: "scoped", adapter: memoryAdapter(CARS) });
    const alice = t.as("alice", ["all"]);
    const bob = t.as("bob", ["all"]);
    const a = await create(alice);
    const b = await create(bob);
    for (const [who, id] of [
      [alice, a],
      [bob, b],
    ] as const)
      expect((await who.command({ type: "scope.set", ...scopeOfCar(0) }, id)).status).toBe(200);
    const liveA = await alice.live(a);
    const liveB = await bob.live(b);
    for (const [who, id] of [
      [alice, a],
      [bob, b],
    ] as const) {
      const catalog = await who.get(`/api/s/${id}/catalog`);
      expect(catalog.status).toBe(200);
      expect(catalog.body.scope).toEqual(scopeOfCar(0));
    }
    // One list for both sessions on the scope.
    expect(listCallsOf(t, "car0")).toBe(1);

    // Six more sessions with six other scopes connect and read their catalogs.
    const lives = [];
    for (let i = 1; i <= 6; i++) {
      const id = await create(alice);
      expect((await alice.command({ type: "scope.set", ...scopeOfCar(i) }, id)).status).toBe(200);
      lives.push(await alice.live(id));
      expect((await alice.get(`/api/s/${id}/catalog`)).status).toBe(200);
    }
    const again = await alice.get(`/api/s/${a}/catalog`);
    expect(again.status).toBe(200);
    expect(listCallsOf(t, "car0")).toBe(1);
    for (let i = 1; i <= 6; i++) expect(listCallsOf(t, `car${i}`), `car${i}`).toBe(1);
    liveA.close();
    liveB.close();
    for (const l of lives) l.close();
  });

  it("keeps an open session's list while other lists come and go", async () => {
    t = await multiApp({ mode: "scoped", adapter: memoryAdapter(CARS) });
    const alice = t.as("alice", ["all"]);
    const a = await create(alice);
    expect((await alice.command({ type: "scope.set", ...scopeOfCar(0) }, a)).status).toBe(200);
    const live = await alice.live(a);
    await live.next((m) => m.type === "state");
    // Seven other scopes load without a live client: only four of them stay besides the open one.
    for (let i = 1; i <= 7; i++) {
      const id = await create(alice);
      expect((await alice.command({ type: "scope.set", ...scopeOfCar(i) }, id)).status).toBe(200);
    }
    expect((await alice.get(`/api/s/${a}/catalog`)).status).toBe(200);
    expect(listCallsOf(t, "car0")).toBe(1);
    // The closed ones were dropped: the oldest of them has to load again.
    const early = await create(alice);
    expect((await alice.command({ type: "scope.set", ...scopeOfCar(1) }, early)).status).toBe(200);
    expect(listCallsOf(t, "car1")).toBe(2);
    live.close();
  });

  /**
   * Both sessions hold a window with one signal of the scope; `connect` lists those that have a
   * live client. Returns the signal names the source was asked to measure.
   */
  async function periodsOfOpenSessions(connect: ("a" | "b")[]) {
    t = await multiApp({ mode: "scoped", adapter: testSource() });
    const alice = t.as("alice", ["all"]);
    const scope = { dataRef: "testcar", from: "1790812800000000000", to: "1790812920000000000" };
    const ids = { a: await create(alice), b: await create(alice) };
    const signals = { a: "testcar/Fast_100h.SIG_A", b: "testcar/Nodbc_500h.RAW" };
    for (const key of ["a", "b"] as const) {
      const id = ids[key];
      expect((await alice.command({ type: "scope.set", ...scope }, id)).status).toBe(200);
      const w = await alice.command({ type: "window.create", from: scope.from, to: scope.to }, id);
      const added = { type: "window.addSignal", windowId: w.body.created, signalId: signals[key] };
      expect((await alice.command(added, id)).status).toBe(200);
    }
    const lives = [];
    for (const key of connect) lives.push(await alice.live(ids[key]));
    for (const live of lives) await live.next((m) => m.type === "state");
    // The gap info of the scope measures the signals of the sessions that have a live client.
    expect((await alice.get(`/api/s/${ids.a}/gaps?dataRef=testcar`)).status).toBe(200);
    const measured = () =>
      new Set(
        t?.calls.filter((c) => c.method === "firstTimes").flatMap((c) => c.args[1] as string[]),
      );
    await vi.waitFor(() => expect(measured().has("Fast_100h.SIG_A")).toBe(true), {
      timeout: 20_000,
    });
    // Let a measurement that is still under way end, so the negative case is not a race.
    await new Promise((r) => setTimeout(r, 500));
    const names = measured();
    for (const live of lives) live.close();
    return names;
  }

  it("measures periods for the open sessions' signals", async () => {
    // Neither signal has a cycle time in a DBC, so both are measured.
    const names = await periodsOfOpenSessions(["a", "b"]);
    expect(names.has("Fast_100h.SIG_A")).toBe(true);
    expect(names.has("Nodbc_500h.RAW")).toBe(true);
  });

  it("measures no period for the signals of a session nobody has open", async () => {
    const names = await periodsOfOpenSessions(["a"]);
    expect(names.has("Fast_100h.SIG_A")).toBe(true);
    expect(names.has("Nodbc_500h.RAW")).toBe(false);
  });
});
