import { existsSync } from "node:fs";
import { join } from "node:path";
import { WORKSPACE_HEADER, WORKSPACE_ID } from "@kipscope/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type Client,
  codeOf,
  grant,
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
const create = async (c: Client) =>
  (await c.post("/api/workspaces", {})).body.workspace.id as string;
/** A new workspace of `c` whose grant the server widened to `refs` (the way add-case-open will). */
const createGranted = async (c: Client, refs: string[] = ["testcar"]) => {
  const id = await create(c);
  if (t) grant(t, id, refs);
  return id;
};
const windowCreate = { type: "window.create", ...range };
const scopeSet = { type: "scope.set", dataRef: SCOPE.dataRef, from: SCOPE.from, to: SCOPE.to };
const idsOf = (body: { workspaces: { id: string }[] }) => body.workspaces.map((w) => w.id);

describe("many workspaces", () => {
  it("keeps workspaces apart", async () => {
    t = await multiApp();
    const alice = t.as("alice");
    const a = await create(alice);
    const b = await create(alice);
    expect(a).toMatch(WORKSPACE_ID);
    expect(b).toMatch(WORKSPACE_ID);
    expect(a).not.toBe(b);
    for (let i = 0; i < 3; i++) expect((await alice.command(windowCreate, a)).status).toBe(200);
    const bWorkspace = await alice.get(`/api/w/${b}/workspace`);
    expect(bWorkspace.body.revision).toBe(0);
    expect(bWorkspace.body.workspace.windows).toEqual([]);
    const aWorkspace = await alice.get(`/api/w/${a}/workspace`);
    expect(aWorkspace.body.revision).toBe(3);
    const summary = await alice.get(`/api/workspaces/${a}`);
    expect(summary.body.workspace).toMatchObject({
      id: a,
      owner: "alice",
      share: "private",
      windows: 3,
    });
  });

  it("gives a new workspace its owner from the identity, never from the body", async () => {
    t = await multiApp();
    const alice = t.as("alice");
    const forged = await alice.post("/api/workspaces", { owner: "mallory" });
    expect(forged.status).toBe(400);
    const own = await alice.post("/api/workspaces", {});
    expect(own.body.workspace.owner).toBe("alice");
    expect(own.body.workspace.share).toBe("private");
    expect(t.workspaces.listOf("mallory")).toEqual([]);
    // No body at all works as well.
    const bare = await alice.post("/api/workspaces");
    expect(bare.status).toBe(200);
  });

  it("addresses a workspace by its prefix", async () => {
    t = await multiApp();
    const alice = t.as("alice");
    const a = await create(alice);
    const posted = await alice.command(windowCreate, a);
    expect(posted.status).toBe(200);
    expect(posted.headers[WORKSPACE_HEADER]).toBe(a);
    const read = await alice.get(`/api/w/${a}/workspace`);
    expect(read.body.workspace.windows).toHaveLength(1);
    expect(read.headers[WORKSPACE_HEADER]).toBe(a);

    const live = await alice.live(a);
    await live.next((m) => m.type === "state");
    expect(live.messages.map((m) => m.type)).toEqual(["hello", "summary", "state"]);
    expect(live.last("summary")?.summary.id).toBe(a);
    expect(live.last("state")?.revision).toBe(1);
    live.close();

    const unknown = await alice.get("/api/w/zzzzzzzzzz/workspace");
    expect(unknown.status).toBe(404);
    expect(codeOf(unknown.body)).toBe("unknown_workspace");
    // A prefix of the wrong form is no prefix: the path is not found.
    const odd = await alice.get("/api/w/ABC/workspace");
    expect(odd.status).toBe(404);
    // The old prefix is an unknown route, and the workspace is unchanged.
    const old = await alice.get(`/api/s/${a}/workspace`);
    expect(old.status).toBe(404);
    expect((await alice.get(`/api/w/${a}/workspace`)).body.revision).toBe(1);
  });

  it("names the workspace on the routes that serve one and on no other", async () => {
    t = await multiApp({ licenseText: "AAL" });
    const alice = t.as("alice");
    const a = await create(alice);
    expect((await alice.get("/api/me")).headers[WORKSPACE_HEADER]).toBeUndefined();
    expect((await alice.get("/api/workspaces")).headers[WORKSPACE_HEADER]).toBeUndefined();
    expect((await alice.get("/api/views")).headers[WORKSPACE_HEADER]).toBeUndefined();
    expect((await alice.get("/api/license")).headers[WORKSPACE_HEADER]).toBeUndefined();
    for (const path of ["workspace", "render-status", "catalog", "signals", "meta"])
      expect((await alice.get(`/api/w/${a}/${path}`)).headers[WORKSPACE_HEADER], path).toBe(a);
    // A prefix on a workspace-independent route is ignored, even one that names no workspace.
    expect((await alice.get("/api/w/zzzzzzzzzz/me")).status).toBe(200);
    const listed = await alice.get(`/api/w/${a}/workspaces`);
    expect(listed.status).toBe(200);
    expect(idsOf(listed.body)).toEqual([a]);
  });

  it("serves the most recently active workspace without a prefix", async () => {
    t = await multiApp();
    const alice = t.as("alice");
    const first = await alice.get("/api/workspace");
    const w1 = first.headers[WORKSPACE_HEADER] as string;
    expect(w1).toMatch(WORKSPACE_ID);
    await new Promise((r) => setTimeout(r, 5));
    const w2 = await create(alice);
    expect(w2).not.toBe(w1);
    expect((await alice.get("/api/workspace")).headers[WORKSPACE_HEADER]).toBe(w2);
    await new Promise((r) => setTimeout(r, 5));
    expect((await alice.command({ type: "cursor.set", cursor: "a", t: "5" }, w1)).status).toBe(200);
    expect((await alice.get("/api/workspace")).headers[WORKSPACE_HEADER]).toBe(w1);
    const list = await alice.get("/api/workspaces");
    expect(idsOf(list.body)).toEqual([w1, w2]);
  });

  it("makes a live connect count as activity", async () => {
    t = await multiApp();
    const alice = t.as("alice");
    const w1 = await create(alice);
    await new Promise((r) => setTimeout(r, 5));
    const w2 = await create(alice);
    expect((await alice.get("/api/workspace")).headers[WORKSPACE_HEADER]).toBe(w2);
    await new Promise((r) => setTimeout(r, 5));
    const live = await alice.live(w1);
    await live.next((m) => m.type === "state");
    expect((await alice.get("/api/workspace")).headers[WORKSPACE_HEADER]).toBe(w1);
    live.close();
  });

  it("keeps the default workspaces of two users apart", async () => {
    t = await multiApp();
    const a = await t.as("alice").get("/api/workspace");
    const b = await t.as("bob").get("/api/workspace");
    expect(a.headers[WORKSPACE_HEADER]).not.toBe(b.headers[WORKSPACE_HEADER]);
    expect(t.workspaces.listOf("alice")).toHaveLength(1);
    expect(t.workspaces.listOf("bob")).toHaveLength(1);
  });
});

describe("a new tab never mirrors another", () => {
  /** A registry clock the test moves. */
  const START = Date.parse("2026-10-19T08:00:00Z");

  it("never hands one free workspace to two tabs", async () => {
    let clock = START;
    t = await multiApp({ now: () => clock });
    const alice = t.as("alice");
    // F is free; L (later) has one live client.
    const f = await create(alice);
    clock += 1000;
    const l = await create(alice);
    const live = await alice.live(l);
    await live.next((m) => m.type === "state");
    clock += 1000;

    const [one, two] = await Promise.all([
      alice.post("/api/workspaces", { reuse: true }),
      alice.post("/api/workspaces", { reuse: true }),
    ]);
    expect([one.status, two.status]).toEqual([200, 200]);
    const answers = [one.body, two.body];
    const reused = answers.find((b) => b.reused === true);
    const made = answers.find((b) => b.reused === false);
    // One request got F, the other a new workspace N; neither got L.
    expect(reused?.workspace.id).toBe(f);
    expect(made?.workspace.id).not.toBe(f);
    expect(made?.workspace.id).not.toBe(l);
    expect(made?.workspace.id).toMatch(WORKSPACE_ID);

    // The claim lasts 10 s: 11 s later, with no client connected meanwhile, F is free again.
    // (N is dropped first, so that F is the latest free workspace of alice.)
    expect((await alice.del(`/api/workspaces/${made?.workspace.id}`)).status).toBe(200);
    clock += 11_000;
    const third = await alice.post("/api/workspaces", { reuse: true });
    expect(third.body.reused).toBe(true);
    expect(third.body.workspace.id).toBe(f);

    // reuse together with open is a bad request.
    const both = await alice.post("/api/workspaces", { reuse: true, open: { name: "x" } });
    expect(both.status).toBe(400);
    live.close();
  });

  it("frees a claimed workspace again after a live connect and disconnect", async () => {
    t = await multiApp();
    const alice = t.as("alice");
    const f = await create(alice);
    const first = await alice.post("/api/workspaces", { reuse: true });
    expect([first.body.workspace.id, first.body.reused]).toEqual([f, true]);
    // The tab connected live; when it closes, the workspace is free at once, not after 10 s.
    const live = await alice.live(f);
    await live.next((m) => m.type === "state");
    live.close();
    await vi.waitFor(
      async () => expect((await alice.get(`/api/workspaces/${f}`)).body.workspace.clients).toBe(0),
      { timeout: 3000, interval: 20 },
    );
    const again = await alice.post("/api/workspaces", { reuse: true });
    expect([again.body.workspace.id, again.body.reused]).toEqual([f, true]);
  });

  it("makes a new workspace for reuse when the user owns none free", async () => {
    t = await multiApp();
    const alice = t.as("alice");
    const made = await alice.post("/api/workspaces", { reuse: true });
    expect(made.status).toBe(200);
    expect(made.body.reused).toBe(false);
    expect(t.workspaces.listOf("alice")).toHaveLength(1);
    // Never another user's workspace.
    const bob = await t.as("bob").post("/api/workspaces", { reuse: true });
    expect(bob.body.reused).toBe(false);
    expect(bob.body.workspace.owner).toBe("bob");
  });
});

describe("rights per workspace", () => {
  it("enforces workspace rights", async () => {
    t = await multiApp();
    const alice = t.as("alice");
    const bob = t.as("bob");
    const a = await createGranted(alice, ["testcar"]);
    expect((await alice.command(scopeSet, a)).status).toBe(200);
    expect((await alice.command(windowCreate, a)).status).toBe(200);
    const revision = t.workspaces.get(a)?.store.revision;

    // 1. Private: no access, the live channel gives no message.
    const denied = await bob.get(`/api/w/${a}/workspace`);
    expect([denied.status, codeOf(denied.body)]).toEqual([403, "forbidden"]);
    const refusedLive = await bob.live(a);
    expect(refusedLive.messages).toEqual([]);
    expect(refusedLive.status === 403 || refusedLive.closeCode !== undefined).toBe(true);

    // 2. Read: both reads work, both changes are refused and change nothing.
    expect((await alice.post(`/api/workspaces/${a}/share`, { share: "read" })).status).toBe(200);
    expect((await bob.get(`/api/w/${a}/workspace`)).status).toBe(200);
    expect((await bob.get(`/api/w/${a}/catalog`)).status).toBe(200);
    for (const attempt of [
      await bob.command(windowCreate, a),
      await bob.post(`/api/w/${a}/views/open`, { name: "x" }),
    ]) {
      expect(attempt.status).toBe(403);
      expect(codeOf(attempt.body)).toBe("read_only");
    }
    expect(t.workspaces.get(a)?.store.revision).toBe(revision);

    // 3. Write: the command is accepted.
    expect((await alice.post(`/api/workspaces/${a}/share`, { share: "write" })).status).toBe(200);
    expect((await bob.command(windowCreate, a)).status).toBe(200);
    expect(t.workspaces.get(a)?.store.revision).toBe((revision ?? 0) + 1);

    // 4. Only the owner changes the share level or deletes.
    for (const attempt of [
      await bob.post(`/api/workspaces/${a}/share`, { share: "private" }),
      await bob.del(`/api/workspaces/${a}`),
    ]) {
      expect([attempt.status, codeOf(attempt.body)]).toEqual([403, "not_owner"]);
    }
    expect(t.workspaces.get(a)).toBeDefined();
    expect(t.workspaces.get(a)?.record.share).toBe("write");
  });

  it("refuses a change by a reader before it looks at the command", async () => {
    t = await multiApp();
    const alice = t.as("alice");
    const bob = t.as("bob");
    const a = await create(alice);
    await alice.post(`/api/workspaces/${a}/share`, { share: "read" });
    // Even a command that is invalid, or a body that is no JSON object, answers read_only first.
    for (const body of [{ type: "nonsense" }, {}, [1, 2]]) {
      const res = await bob.command(body, a);
      expect([res.status, codeOf(res.body)], JSON.stringify(body)).toEqual([403, "read_only"]);
    }
    for (const url of ["views", "views/open"]) {
      const res = await bob.post(`/api/w/${a}/${url}`, { title: "t", name: "x" });
      expect([res.status, codeOf(res.body)], url).toEqual([403, "read_only"]);
    }
    // An import that does not open changes only the user's own views.
    const stored = await bob.post(`/api/w/${a}/views/import`, { text: "{}" });
    expect(stored.status).toBe(400);
    const imported = await bob.post(`/api/w/${a}/views/import`, { text: "{}", open: true });
    expect([imported.status, codeOf(imported.body)]).toEqual([403, "read_only"]);
  });

  it("does not let a user read another user's private workspace through the summary route", async () => {
    t = await multiApp();
    const alice = t.as("alice");
    const bob = t.as("bob");
    const a = await create(alice);
    const res = await bob.get(`/api/workspaces/${a}`);
    expect(res.status).toBe(403);
    expect(res.text).not.toContain("alice");
    expect((await bob.get("/api/workspaces")).body.workspaces).toEqual([]);
    const shared = await alice.post(`/api/workspaces/${a}/share`, { share: "read" });
    expect(shared.status).toBe(200);
    const open = await bob.get(`/api/workspaces/${a}`);
    expect(open.status).toBe(200);
    expect(open.body.workspace.rights).toEqual({ open: true, change: false, owner: false });
    // Still only his own in his list.
    expect((await bob.get("/api/workspaces")).body.workspaces).toEqual([]);
  });

  it("applies share, grant and delete to open connections", async () => {
    t = await multiApp();
    const alice = t.as("alice");
    const bob = t.as("bob");
    const a = await createGranted(alice, ["testcar"]);
    await alice.post(`/api/workspaces/${a}/share`, { share: "write" });
    const live = await bob.live(a);
    await live.next((m) => m.type === "state");
    expect(live.last("summary")?.summary.rights).toEqual({
      open: true,
      change: true,
      owner: false,
    });

    // 1. write -> read: a summary with the new rights, the channel stays open.
    await alice.post(`/api/workspaces/${a}/share`, { share: "read" });
    const reduced = await live.next(
      (m) => m.type === "summary" && m.summary.rights?.change === false,
    );
    expect(reduced).toMatchObject({ summary: { id: a, rights: { open: true, change: false } } });
    expect(live.closeCode).toBeUndefined();

    // 2. read -> private: closed with 4403.
    await alice.post(`/api/workspaces/${a}/share`, { share: "private" });
    expect(await live.closedBy()).toBe(4403);

    // 3. A new connection under write; grantObjects widens the grant: a summary with granted 2.
    await alice.post(`/api/workspaces/${a}/share`, { share: "write" });
    const again = await bob.live(a);
    await again.next((m) => m.type === "state");
    expect(again.last("summary")?.summary.granted).toBe(1);
    grant(t, a, ["othercar"]);
    const widened = await again.next((m) => m.type === "summary" && m.summary.granted === 2);
    expect(widened).toMatchObject({ summary: { id: a, granted: 2 } });
    expect(again.closeCode).toBeUndefined();

    // 4. Delete: closed with 4404, and the workspace is gone.
    expect((await alice.del(`/api/workspaces/${a}`)).status).toBe(200);
    expect(await again.closedBy()).toBe(4404);
    const gone = await alice.get(`/api/workspaces/${a}`);
    expect([gone.status, codeOf(gone.body)]).toEqual([404, "unknown_workspace"]);
  });

  it("closes the owner's own connection when the workspace is deleted", async () => {
    t = await multiApp();
    const alice = t.as("alice");
    const a = await create(alice);
    const live = await alice.live(a);
    await live.next((m) => m.type === "state");
    await alice.del(`/api/workspaces/${a}`);
    expect(await live.closedBy()).toBe(4404);
  });

  it("keeps render status per workspace", async () => {
    t = await multiApp();
    const alice = t.as("alice");
    const a = await create(alice);
    const b = await create(alice);
    const liveA = await alice.live(a);
    const liveB = await alice.live(b);
    await liveA.next((m) => m.type === "state");
    await liveB.next((m) => m.type === "state");
    await alice.command(windowCreate, a);
    const status = await alice.get(`/api/w/${a}/render-status`);
    expect(status.body.revision).toBe(1);
    expect(status.body.clients).toHaveLength(1);
    const helloA = liveA.messages.find((m) => m.type === "hello");
    expect(status.body.clients[0]).toMatchObject({
      clientId: (helloA as { clientId: string }).clientId,
      user: "alice",
    });
    const other = await alice.get(`/api/w/${b}/render-status`);
    expect(other.body.revision).toBe(0);
    expect(other.body.clients).toHaveLength(1);
    liveA.close();
    liveB.close();
  });

  it("lists the user of each connection in the render status", async () => {
    t = await multiApp();
    const alice = t.as("alice");
    const bob = t.as("bob");
    const a = await create(alice);
    await alice.post(`/api/workspaces/${a}/share`, { share: "read" });
    const l1 = await alice.live(a);
    const l2 = await bob.live(a);
    await l1.next((m) => m.type === "state");
    await l2.next((m) => m.type === "state");
    const users = (await bob.get(`/api/w/${a}/render-status`)).body.clients.map(
      (c: { user: string }) => c.user,
    );
    expect(users.sort()).toEqual(["alice", "bob"]);
  });
});

describe("workspace management", () => {
  it("lists, shares and deletes workspaces", async () => {
    t = await multiApp();
    const alice = t.as("alice");
    const bob = t.as("bob");
    const w1 = await createGranted(alice, ["testcar"]);
    const w2 = await create(alice);
    await bob.post("/api/workspaces", {});
    await new Promise((r) => setTimeout(r, 5));
    expect((await alice.command(scopeSet, w1)).status).toBe(200);

    const list = await alice.get("/api/workspaces");
    expect(idsOf(list.body)).toEqual([w1, w2]);
    expect(list.body.workspaces[0]).toMatchObject({
      id: w1,
      owner: "alice",
      scope: SCOPE,
      clients: 0,
      granted: 1,
      rights: { open: true, change: true, owner: true },
    });
    expect(list.body.workspaces[1]).toMatchObject({ id: w2, granted: 0 });

    const shared = await alice.post(`/api/workspaces/${w1}/share`, { share: "write" });
    expect(shared.status).toBe(200);
    expect(shared.body.workspace.share).toBe("write");

    t.workspaces.flush();
    const file = join(t.stateDir, "workspaces", `${w2}.json`);
    expect(existsSync(file)).toBe(true);
    const deleted = await alice.del(`/api/workspaces/${w2}`);
    expect(deleted.body).toEqual({ deleted: w2 });
    expect(existsSync(file)).toBe(false);
    const after = await alice.get("/api/workspaces");
    expect(idsOf(after.body)).toEqual([w1]);
    const again = await alice.del(`/api/workspaces/${w2}`);
    expect([again.status, codeOf(again.body)]).toEqual([404, "unknown_workspace"]);
  });

  it("reports granted all in the list in none mode", async () => {
    t = await multiApp({ identity: "none" });
    const me = t.anon;
    const w = await create(me);
    const list = await me.get("/api/workspaces");
    expect(list.body.workspaces[0]).toMatchObject({
      id: w,
      owner: "local",
      granted: "all",
      clients: 0,
      rights: { open: true, change: true, owner: true },
    });
  });

  it("rejects a malformed share request", async () => {
    t = await multiApp();
    const alice = t.as("alice");
    const a = await create(alice);
    for (const body of [{}, { share: "public" }, { share: "read", owner: "bob" }]) {
      const res = await alice.post(`/api/workspaces/${a}/share`, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await alice.get(`/api/workspaces/${a}`)).body.workspace.share).toBe("private");
  });

  it("creates a workspace with an open view", async () => {
    // none mode: every workspace may read every data ref, so an open needs no grant.
    t = await multiApp({ identity: "none" });
    const me = t.anon;
    const doc = viewDoc([[SIG], [`testcar/Cyc_B10h.CYC`]]);
    const opened = await me.post("/api/workspaces", { open: { view: doc } });
    expect(opened.status).toBe(200);
    expect(opened.body.workspace.windows).toBe(2);
    expect(opened.body.result.ok).toBe(true);
    const unsupported = await me.post("/api/workspaces", {
      open: { view: { kipscope: "view", version: 9 } },
    });
    expect([unsupported.status, codeOf(unsupported.body)]).toEqual([422, "unsupported_version"]);
    const unknown = await me.post("/api/workspaces", { open: { name: "nope" } });
    expect([unknown.status, codeOf(unknown.body)]).toEqual([404, "unknown_view"]);
    // Only the first one made a workspace.
    const list = await me.get("/api/workspaces");
    expect(list.body.workspaces).toHaveLength(1);
    expect(list.body.workspaces[0].windows).toBe(2);
  });

  it("opens a saved view of the requester into a new workspace", async () => {
    t = await multiApp({ identity: "none" });
    const me = t.anon;
    const first = await create(me);
    await me.command({ ...windowCreate }, first);
    await me.command({ type: "window.addSignal", windowId: "w1", signalId: SIG }, first);
    expect((await me.post(`/api/w/${first}/views`, { title: "Speeds" })).status).toBe(200);
    const opened = await me.post("/api/workspaces", { open: { name: "speeds" } });
    expect(opened.status).toBe(200);
    expect(opened.body.workspace.id).not.toBe(first);
    expect(opened.body.workspace.windows).toBe(1);
  });

  it("opens a saved view by the title the Views menu shows", async () => {
    t = await multiApp({ identity: "none" });
    const me = t.anon;
    const first = await create(me);
    await me.command({ ...windowCreate }, first);
    await me.command({ type: "window.addSignal", windowId: "w1", signalId: SIG }, first);
    expect((await me.post(`/api/w/${first}/views`, { title: "Speeds" })).status).toBe(200);
    // The title as shown, in any case, for ?view= and for an open in the workspace.
    for (const name of ["Speeds", "SPEEDS"]) {
      const opened = await me.post("/api/workspaces", { open: { name } });
      expect(opened.status, name).toBe(200);
      expect(opened.body.workspace.windows).toBe(1);
    }
    const inPlace = await me.post(`/api/w/${first}/views/open`, { name: "Speeds" });
    expect(inPlace.status).toBe(200);
    // That open kept the workspace before it as "Before last open", which opens by that title.
    const previous = await me.post("/api/workspaces", { open: { name: "Before last open" } });
    expect(previous.status).toBe(200);
    expect(previous.body.workspace.windows).toBe(1);

    // A second view with the same title: the title is ambiguous and the answer names both.
    const again = { title: "Speeds", name: "speeds-2" };
    expect((await me.post(`/api/w/${first}/views`, again)).status).toBe(200);
    const ambiguous = await me.post("/api/workspaces", { open: { name: "Speeds" } });
    expect([ambiguous.status, codeOf(ambiguous.body)]).toEqual([409, "ambiguous_view"]);
    expect(ambiguous.body.error.message).toMatch(/speeds, speeds-2|speeds-2, speeds/);
    // The name still comes first, and an unknown title is an unknown view.
    expect((await me.post("/api/workspaces", { open: { name: "speeds" } })).status).toBe(200);
    const nope = await me.post("/api/workspaces", { open: { name: "No such title" } });
    expect([nope.status, codeOf(nope.body)]).toEqual([404, "unknown_view"]);
  });

  it("evicts the oldest idle workspace at the limit and refuses when all have clients", async () => {
    t = await multiApp({ workspaceLimit: 3 });
    const alice = t.as("alice");
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(await create(alice));
      await new Promise((r) => setTimeout(r, 3));
    }
    const fourth = await create(alice);
    const list = idsOf((await alice.get("/api/workspaces")).body);
    expect(list).toHaveLength(3);
    expect(list).not.toContain(ids[0]);
    expect(list).toContain(fourth);
    // Every workspace has a client: no room.
    const lives = [];
    for (const id of list) lives.push(await alice.live(id));
    for (const live of lives) await live.next((m) => m.type === "state");
    const full = await alice.post("/api/workspaces", {});
    expect([full.status, codeOf(full.body)]).toEqual([409, "workspace_limit"]);
    // Another user is not bound by her workspaces.
    expect((await t.as("bob").post("/api/workspaces", {})).status).toBe(200);
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

describe("signal lists of open workspaces", () => {
  it("shares and keeps the signal lists of open workspaces", async () => {
    t = await multiApp({ mode: "scoped", adapter: memoryAdapter(CARS) });
    const alice = t.as("alice");
    const bob = t.as("bob");
    const a = await createGranted(alice, ["car0"]);
    const b = await createGranted(bob, ["car0"]);
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
      const catalog = await who.get(`/api/w/${id}/catalog`);
      expect(catalog.status).toBe(200);
      expect(catalog.body.scope).toEqual(scopeOfCar(0));
    }
    // One list for both workspaces on the scope.
    expect(listCallsOf(t, "car0")).toBe(1);

    // Six more workspaces with six other scopes connect and read their catalogs.
    const lives = [];
    for (let i = 1; i <= 6; i++) {
      const id = await createGranted(alice, [`car${i}`]);
      expect((await alice.command({ type: "scope.set", ...scopeOfCar(i) }, id)).status).toBe(200);
      lives.push(await alice.live(id));
      expect((await alice.get(`/api/w/${id}/catalog`)).status).toBe(200);
    }
    const again = await alice.get(`/api/w/${a}/catalog`);
    expect(again.status).toBe(200);
    expect(listCallsOf(t, "car0")).toBe(1);
    for (let i = 1; i <= 6; i++) expect(listCallsOf(t, `car${i}`), `car${i}`).toBe(1);
    liveA.close();
    liveB.close();
    for (const l of lives) l.close();
  });

  it("keeps an open workspace's list while other lists come and go", async () => {
    t = await multiApp({ mode: "scoped", adapter: memoryAdapter(CARS) });
    const alice = t.as("alice");
    const a = await createGranted(alice, ["car0"]);
    expect((await alice.command({ type: "scope.set", ...scopeOfCar(0) }, a)).status).toBe(200);
    const live = await alice.live(a);
    await live.next((m) => m.type === "state");
    // Seven other scopes load without a live client: only four of them stay besides the open one.
    for (let i = 1; i <= 7; i++) {
      const id = await createGranted(alice, [`car${i}`]);
      expect((await alice.command({ type: "scope.set", ...scopeOfCar(i) }, id)).status).toBe(200);
    }
    expect((await alice.get(`/api/w/${a}/catalog`)).status).toBe(200);
    expect(listCallsOf(t, "car0")).toBe(1);
    // The closed ones were dropped: the oldest of them has to load again.
    const early = await createGranted(alice, ["car1"]);
    expect((await alice.command({ type: "scope.set", ...scopeOfCar(1) }, early)).status).toBe(200);
    expect(listCallsOf(t, "car1")).toBe(2);
    live.close();
  });

  /**
   * Both workspaces hold a window with one signal of the scope; `connect` lists those that have a
   * live client. Returns the signal names the source was asked to measure.
   */
  async function periodsOfOpenWorkspaces(connect: ("a" | "b")[]) {
    t = await multiApp({ mode: "scoped", adapter: testSource() });
    const alice = t.as("alice");
    const scope = { dataRef: "testcar", from: "1790812800000000000", to: "1790812920000000000" };
    const ids = { a: await createGranted(alice), b: await createGranted(alice) };
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
    // The gap info of the scope measures the signals of the workspaces that have a live client.
    expect((await alice.get(`/api/w/${ids.a}/gaps?dataRef=testcar`)).status).toBe(200);
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

  it("measures periods for the open workspaces' signals", async () => {
    // Neither signal has a cycle time in a DBC, so both are measured.
    const names = await periodsOfOpenWorkspaces(["a", "b"]);
    expect(names.has("Fast_100h.SIG_A")).toBe(true);
    expect(names.has("Nodbc_500h.RAW")).toBe(true);
  });

  it("measures no period for the signals of a workspace nobody has open", async () => {
    const names = await periodsOfOpenWorkspaces(["a"]);
    expect(names.has("Fast_100h.SIG_A")).toBe(true);
    expect(names.has("Nodbc_500h.RAW")).toBe(false);
  });
});
