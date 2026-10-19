import type { LiveServerMessage, RenderStatus } from "@kipscope/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { buildApp } from "../src/app.ts";
import { Catalog } from "../src/catalog.ts";
import type { DataSource } from "../src/datasource.ts";
import { loadDbcFiles } from "../src/dbc.ts";
import type { LiveOptions } from "../src/routes/workspace.ts";
import { WorkspaceStore } from "../src/workspace.ts";
import { testDbcFiles, testSource } from "./testdb.ts";

const source = {} as DataSource;

function setup() {
  const workspace = new WorkspaceStore({
    signalExists: (id) => id.startsWith("car/"),
    hasStates: () => false,
  });
  const app = buildApp({ catalog: new Catalog(source, async () => new Map()), source, workspace });
  return { app, workspace };
}

describe("window-workflow commands over HTTP", () => {
  const units: Record<string, string> = {
    "car/A": "V",
    "car/B": "km/h",
    "car/C": "V",
    "car/D": "°C",
    "car/E": "1/min",
    "car/F": "rpm/10ms",
  };
  const workspace = new WorkspaceStore({
    signalExists: (id) => id.startsWith("car/"),
    hasStates: () => false,
    unitOf: (id) => units[id],
  });
  const app = buildApp({ catalog: new Catalog(source, async () => new Map()), source, workspace });
  afterAll(() => app.close());

  const command = async (body: Record<string, unknown>) => {
    const res = await app.inject({ method: "POST", url: "/api/commands", body });
    return { status: res.statusCode, body: res.json() };
  };
  const state = async () => (await app.inject({ url: "/api/workspace" })).json();

  it("applies the window-workflow commands over HTTP", async () => {
    expect((await state()).workspace.linkTime).toBe(true);
    expect((await command({ type: "window.create", from: "0", to: "1000" })).body.created).toBe(
      "w1",
    );
    expect((await command({ type: "window.create" })).body).toMatchObject({
      ok: true,
      created: "w2",
    });
    const added = await command({ type: "window.addSignal", windowId: "w1", signalId: "car/A" });
    expect(added.body).toEqual({ ok: true, revision: 3, created: "a3" });

    expect(
      (await command({ type: "window.rename", windowId: "w2", title: " HV voltages " })).body,
    ).toEqual({ ok: true, revision: 4 });
    expect(
      (await command({ type: "window.setHeight", windowId: "w2", height: 400 })).body.revision,
    ).toBe(5);
    expect((await command({ type: "window.setHeight", windowId: "w2", height: 100 })).status).toBe(
      400,
    );
    // w1 keeps car/C, so the move below does not empty it (an emptied window is removed).
    const kept = await command({ type: "window.addSignal", windowId: "w1", signalId: "car/C" });
    expect(kept.body).toEqual({ ok: true, revision: 6, created: "a4" });
    const moved = await command({
      type: "window.moveSignal",
      windowId: "w1",
      assignmentId: "a3",
      targetWindowId: "w2",
    });
    expect(moved.body).toEqual({ ok: true, revision: 7 });
    // Moving into a window that has the signal answers 422 already_in_window.
    await command({ type: "window.addSignal", windowId: "w1", signalId: "car/A" });
    const dup = await command({
      type: "window.moveSignal",
      windowId: "w1",
      assignmentId: "a5",
      targetWindowId: "w2",
    });
    expect(dup.status).toBe(422);
    expect(dup.body).toMatchObject({ ok: false, code: "already_in_window" });
    // Unlink, set a range on one window only, link again.
    expect((await command({ type: "workspace.setLinkTime", linked: false })).body.ok).toBe(true);
    await command({ type: "window.setRange", windowId: "w1", from: "10", to: "20" });
    let ws = (await state()).workspace;
    expect(ws.windows[0].range).toEqual({ from: "10", to: "20" });
    expect(ws.windows[1].range).toEqual({ from: "0", to: "1000" });
    await command({ type: "workspace.setLinkTime", linked: true });

    ws = (await state()).workspace;
    expect(ws.linkTime).toBe(true);
    expect(ws.windows.map((w: { range: unknown }) => w.range)).toEqual([
      { from: "10", to: "20" },
      { from: "10", to: "20" },
    ]);
    expect(ws.windows[1]).toMatchObject({ title: "HV voltages", height: 400 });
    expect(ws.windows[1].signals).toEqual([{ id: "a3", signalId: "car/A" }]);
    expect(ws.windows[0].signals).toEqual([
      { id: "a4", signalId: "car/C" },
      { id: "a5", signalId: "car/A" },
    ]);
    expect(ws.colors["car/A"]).toBe(0);
  });

  it("returns the created window and assignment of a move", async () => {
    const before = (await state()).revision;
    const copy = await command({
      type: "window.moveSignal",
      windowId: "w2",
      assignmentId: "a3",
      copy: true,
    });
    expect(copy.status).toBe(200);
    expect(copy.body).toMatchObject({ ok: true, revision: before + 1 });
    expect(copy.body.createdWindow).toMatch(/^w\d+$/);
    expect(copy.body.created).toMatch(/^a\d+$/);
    const ws = (await state()).workspace;
    const fresh = ws.windows.find((w: { id: string }) => w.id === copy.body.createdWindow);
    expect(fresh).toMatchObject({ range: { from: "10", to: "20" }, height: 400 });
    expect(fresh).not.toHaveProperty("title");
    expect(fresh.signals).toEqual([{ id: copy.body.created, signalId: "car/A" }]);
  });

  it("returns the window a move removed", async () => {
    // Self-contained: its own target window, no reliance on earlier tests.
    const target = (await command({ type: "window.create", from: "0", to: "1000" })).body.created;
    const win = (await command({ type: "window.create" })).body.created;
    const sig = await command({ type: "window.addSignal", windowId: win, signalId: "car/B" });
    const before = (await state()).revision;
    const moved = await command({
      type: "window.moveSignal",
      windowId: win,
      assignmentId: sig.body.created,
      targetWindowId: target,
    });
    expect(moved.status).toBe(200);
    expect(moved.body).toEqual({ ok: true, revision: before + 1, removedWindow: win });
    let ws = (await state()).workspace;
    expect(ws.windows.some((w: { id: string }) => w.id === win)).toBe(false);
    expect(
      ws.windows
        .find((w: { id: string }) => w.id === target)
        .signals.map((a: { signalId: string }) => a.signalId),
    ).toContain("car/B");
    // The removed ID answers unknown_window like any removed window.
    const gone = await command({ type: "window.rename", windowId: win, title: "x" });
    expect(gone.status).toBe(422);
    expect(gone.body).toMatchObject({ ok: false, code: "unknown_window" });

    // Into a new window: createdWindow and removedWindow in one answer, one revision.
    const win2 = (await command({ type: "window.create" })).body.created;
    const sig2 = await command({ type: "window.addSignal", windowId: win2, signalId: "car/E" });
    const before2 = (await state()).revision;
    const fresh = await command({
      type: "window.moveSignal",
      windowId: win2,
      assignmentId: sig2.body.created,
    });
    expect(fresh.body).toMatchObject({ ok: true, revision: before2 + 1, removedWindow: win2 });
    expect(fresh.body.createdWindow).toMatch(/^w\d+$/);
    expect(fresh.body.createdWindow).not.toBe(win2);
    ws = (await state()).workspace;
    expect(ws.windows.some((w: { id: string }) => w.id === win2)).toBe(false);
    expect(ws.windows.some((w: { id: string }) => w.id === fresh.body.createdWindow)).toBe(true);

    // A copy and removeSignal remove nothing.
    const win3 = (await command({ type: "window.create" })).body.created;
    const sig3 = await command({ type: "window.addSignal", windowId: win3, signalId: "car/D" });
    const copy = await command({
      type: "window.moveSignal",
      windowId: win3,
      assignmentId: sig3.body.created,
      copy: true,
    });
    expect(copy.body).not.toHaveProperty("removedWindow");
    const rm = await command({
      type: "window.removeSignal",
      windowId: win3,
      assignmentId: sig3.body.created,
    });
    expect(rm.body).not.toHaveProperty("removedWindow");
    expect((await state()).workspace.windows.some((w: { id: string }) => w.id === win3)).toBe(true);
  });

  it("answers too_many_units over HTTP", async () => {
    const w = (await command({ type: "window.create" })).body.created;
    for (const id of ["car/A", "car/B", "car/D", "car/E"]) {
      const r = await command({ type: "window.addSignal", windowId: w, signalId: id });
      expect(r.body.ok).toBe(true);
    }
    const before = (await state()).revision;
    const res = await command({ type: "window.addSignal", windowId: w, signalId: "car/F" });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ ok: false, code: "too_many_units" });
    expect(res.body.message).toContain("V, km/h, °C, 1/min");
    expect((await state()).revision).toBe(before);
    // A second signal of an existing unit is accepted.
    expect(
      (await command({ type: "window.addSignal", windowId: w, signalId: "car/C" })).body.ok,
    ).toBe(true);
  });
});

describe("cursor commands over HTTP", () => {
  const { app } = setup();
  afterAll(() => app.close());

  const command = async (body: Record<string, unknown>) => {
    const res = await app.inject({ method: "POST", url: "/api/commands", body });
    return { status: res.statusCode, body: res.json() };
  };
  const state = async () => (await app.inject({ url: "/api/workspace" })).json();

  it("applies cursor commands over HTTP", async () => {
    // Fresh workspace: both cursors off, diff off.
    const fresh = await state();
    expect(fresh.workspace.cursors).toEqual({ diff: false });

    const created = await command({ type: "window.create", kind: "values" });
    expect(created.body).toEqual({ ok: true, revision: 1, created: "w1" });
    let ws = (await state()).workspace;
    expect(ws.windows).toEqual([{ id: "w1", kind: "values", mode: "line", signals: [] }]);
    expect(ws.windows[0].range).toBeUndefined();

    const set = await command({ type: "cursor.set", cursor: "a", t: "2026-10-13T13:08:00.093Z" });
    expect(set.body).toEqual({ ok: true, revision: 2 });
    expect((await state()).workspace.cursors).toEqual({ a: "1791896880093000000", diff: false });

    const moved = await command({ type: "cursor.move", cursor: "a", by: "902000000" });
    expect(moved.body).toEqual({ ok: true, revision: 3 });
    expect((await state()).workspace.cursors).toEqual({ a: "1791896880995000000", diff: false });

    const diff = await command({ type: "cursor.setDiff", diff: true });
    expect(diff.body).toEqual({ ok: true, revision: 4 });
    expect((await state()).workspace.cursors).toEqual({ a: "1791896880995000000", diff: true });

    // Rejections change nothing: B is off, and a move past the bounds.
    const off = await command({ type: "cursor.move", cursor: "b", by: "1000" });
    expect(off.status).toBe(422);
    expect(off.body).toMatchObject({ ok: false, code: "cursor_off" });
    const bounds = await command({
      type: "cursor.move",
      cursor: "a",
      by: "-9000000000000000000",
    });
    expect(bounds.status).toBe(400);
    expect(bounds.body).toMatchObject({ ok: false, code: "invalid_command" });
    expect((await state()).revision).toBe(4);

    const removed = await command({ type: "cursor.remove", cursor: "a" });
    expect(removed.body).toEqual({ ok: true, revision: 5 });
    ws = (await state()).workspace;
    expect(ws.cursors).toEqual({ diff: true });
    expect(ws.windows).toHaveLength(1);

    // A values window rejects range commands over HTTP.
    const range = await command({ type: "window.setRange", windowId: "w1", from: "0", to: "10" });
    expect(range.status).toBe(400);
    expect(range.body).toMatchObject({ ok: false, code: "invalid_command" });
  });

  it("applies the options command over HTTP", async () => {
    const before = (await state()).revision;
    expect((await state()).workspace.options).toEqual({ digits: 3 });
    const set = await command({ type: "workspace.setOptions", digits: 4 });
    expect(set.body).toEqual({ ok: true, revision: before + 1 });
    expect((await state()).workspace.options).toEqual({ digits: 4 });
    // Other values are rejected and change nothing.
    const bad = await command({ type: "workspace.setOptions", digits: 5 });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ ok: false, code: "invalid_command" });
    const after = await state();
    expect(after.revision).toBe(before + 1);
    expect(after.workspace.options).toEqual({ digits: 4 });
  });
});

describe("POST /api/commands, GET /api/workspace", () => {
  const { app } = setup();
  afterAll(() => app.close());

  const command = (body: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/api/commands", body });

  it("increments the revision for accepted commands and returns created IDs", async () => {
    const created = await command({ type: "window.create", from: "0", to: "1000" });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toEqual({ ok: true, revision: 1, created: "w1" });
    const added = await command({ type: "window.addSignal", windowId: "w1", signalId: "car/A" });
    expect(added.json()).toEqual({ ok: true, revision: 2, created: "a2" });
    const state = (await app.inject({ url: "/api/workspace" })).json();
    expect(state.revision).toBe(2);
    expect(state.workspace.windows[0].signals).toEqual([{ id: "a2", signalId: "car/A" }]);
  });

  it("rejects commands without changing the revision", async () => {
    const before = (await app.inject({ url: "/api/workspace" })).json();
    const unknown = await command({ type: "window.remove", windowId: "w99" });
    expect(unknown.statusCode).toBe(422);
    expect(unknown.json()).toMatchObject({ ok: false, code: "unknown_window" });
    const invalid = await command({ type: "window.remove" });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ ok: false, code: "invalid_command" });
    const after = (await app.inject({ url: "/api/workspace" })).json();
    expect(after).toEqual(before);
  });
});

describe("measurement start value (add-footer)", () => {
  const measurement = {
    name: "Testfahrt A9",
    object: "smart451",
    meta: [
      { key: "driver", value: "Jan" },
      { key: "run", value: "3" },
      { key: "wet", value: "true" },
    ],
  };

  it("starts with the measurement from the project file", async () => {
    const workspace = new WorkspaceStore(
      { signalExists: () => true, hasStates: () => false },
      { measurement },
    );
    const app = buildApp({
      catalog: new Catalog(source, async () => new Map()),
      source,
      workspace,
    });
    try {
      const start = (await app.inject({ url: "/api/workspace" })).json();
      expect(start.revision).toBe(0);
      expect(start.workspace.measurement).toEqual(measurement);

      // Commands win: the start value is only the state at revision 0.
      const set = await app.inject({
        method: "POST",
        url: "/api/commands",
        body: { type: "measurement.set", object: "testcar" },
      });
      expect(set.json()).toEqual({ ok: true, revision: 1 });
      const after = (await app.inject({ url: "/api/workspace" })).json();
      expect(after.workspace.measurement).toEqual({ ...measurement, object: "testcar" });
    } finally {
      await app.close();
    }
  });

  it("has no measurement without a project section", async () => {
    const { app } = setup();
    try {
      const state = (await app.inject({ url: "/api/workspace" })).json();
      expect(state.workspace).not.toHaveProperty("measurement");
    } finally {
      await app.close();
    }
  });
});

/** Opens a WebSocket and collects server messages. */
async function connect(base: string) {
  const ws = new WebSocket(`${base.replace("http", "ws")}/api/live`);
  const messages: LiveServerMessage[] = [];
  const waiters: (() => void)[] = [];
  ws.on("message", (data) => {
    messages.push(JSON.parse(data.toString()));
    for (const w of waiters.splice(0)) w();
  });
  await new Promise((resolve) => ws.once("open", resolve));
  const next = async (predicate: (m: LiveServerMessage) => boolean) => {
    for (;;) {
      const found = messages.find(predicate);
      if (found) return found;
      await new Promise<void>((r) => waiters.push(r));
    }
  };
  return { ws, messages, next };
}

describe("WS /api/live and GET /api/render-status", () => {
  const { app } = setup();
  let base = "";
  beforeAll(async () => {
    base = await app.listen({ port: 0, host: "127.0.0.1" });
  });
  afterAll(() => app.close());

  const renderStatus = async (): Promise<RenderStatus> =>
    (await fetch(`${base}/api/render-status`)).json() as Promise<RenderStatus>;
  const post = (body: unknown) =>
    fetch(`${base}/api/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json());

  it("sends the state on connect and after each accepted command", async () => {
    const client = await connect(base);
    const hello = await client.next((m) => m.type === "hello");
    expect(hello).toEqual({ type: "hello", clientId: expect.stringMatching(/^c\d+$/) });
    expect(await client.next((m) => m.type === "state" && m.revision === 0)).toBeTruthy();
    // After the hello and before the state: the session this channel serves, with the user's rights.
    expect(client.messages.map((m) => m.type).slice(0, 3)).toEqual(["hello", "session", "state"]);
    const served = client.messages[1];
    expect(served?.type === "session" && served.session).toMatchObject({
      owner: "local",
      share: "private",
      revision: 0,
      rights: { open: true, change: true, owner: true },
    });
    await post({ type: "window.create", from: "0", to: "10" });
    const pushed = await client.next((m) => m.type === "state" && m.revision === 1);
    expect(pushed.type === "state" && pushed.workspace.windows).toHaveLength(1);
    client.ws.close();
  });

  it("reports rendered revisions, complete and with errors", async () => {
    const client = await connect(base);
    const hello = await client.next((m) => m.type === "hello");
    const clientId = hello.type === "hello" ? hello.clientId : "";
    const { revision } = await post({ type: "window.create", from: "0", to: "10" });
    // Each client is listed with its user (add-multiuser M4); without an identity that is `local`.
    expect((await renderStatus()).clients.find((c) => c.clientId === clientId)?.user).toBe("local");

    client.ws.send(JSON.stringify({ type: "rendered", revision, status: "complete" }));
    await expect
      .poll(
        async () =>
          (await renderStatus()).clients.find((c) => c.clientId === clientId)?.rendered?.revision,
      )
      .toBe(revision);

    const { revision: next } = await post({
      type: "window.addSignal",
      windowId: "w1",
      signalId: "car/A",
    });
    const errors = [{ windowId: "w1", signalId: "car/A", message: "source_error: timeout" }];
    client.ws.send(JSON.stringify({ type: "rendered", revision: next, status: "error", errors }));
    await expect
      .poll(
        async () => (await renderStatus()).clients.find((c) => c.clientId === clientId)?.rendered,
      )
      .toMatchObject({ revision: next, status: "error", errors });

    // Acknowledgements for revisions that do not exist yet are ignored.
    client.ws.send(JSON.stringify({ type: "rendered", revision: 999, status: "complete" }));
    await new Promise((r) => setTimeout(r, 50));
    const status = await renderStatus();
    expect(status.revision).toBe(next);
    expect(status.clients.find((c) => c.clientId === clientId)?.rendered?.revision).toBe(next);

    client.ws.close();
    await expect
      .poll(async () => (await renderStatus()).clients.some((c) => c.clientId === clientId))
      .toBe(false);
  });
});

describe("live channel heartbeat (add-multiuser M8)", () => {
  const workspace = new WorkspaceStore({
    signalExists: (id) => id.startsWith("car/"),
    hasStates: () => false,
  });
  // A short interval: the server pings every 50 ms and drops a client that missed the last pong.
  // (Spread, because `AppDeps` does not list the option yet; `LiveOptions` types it.)
  const live: LiveOptions = { liveHeartbeatMs: 50 };
  const app = buildApp({
    catalog: new Catalog(source, async () => new Map()),
    source,
    workspace,
    ...live,
  });
  let base = "";
  beforeAll(async () => {
    base = await app.listen({ port: 0, host: "127.0.0.1" });
  });
  afterAll(() => app.close());

  const clientIds = async (): Promise<string[]> =>
    ((await (await fetch(`${base}/api/render-status`)).json()) as RenderStatus).clients.map(
      (c) => c.clientId,
    );
  const open = async (autoPong: boolean) => {
    const ws = new WebSocket(`${base.replace("http", "ws")}/api/live`, { autoPong });
    const pings: number[] = [];
    ws.on("ping", () => pings.push(Date.now()));
    const hello = new Promise<string>((resolve) =>
      ws.on("message", (data) => {
        const m = JSON.parse(data.toString()) as LiveServerMessage;
        if (m.type === "hello") resolve(m.clientId);
      }),
    );
    ws.on("error", () => {});
    return { ws, pings, clientId: await hello };
  };

  it("drops a client that never answers ping from render-status and keeps one that does", async () => {
    const silent = await open(false);
    const alive = await open(true);
    expect(await clientIds()).toEqual(expect.arrayContaining([silent.clientId, alive.clientId]));

    // The silent one is dropped within a few intervals: ping, a missed pong, then terminate.
    await expect.poll(clientIds, { timeout: 2000, interval: 25 }).not.toContain(silent.clientId);
    expect(silent.pings.length).toBeGreaterThanOrEqual(1);
    await expect.poll(() => silent.ws.readyState, { timeout: 2000 }).toBe(WebSocket.CLOSED);

    // The client that answers stays, long after the silent one went.
    await new Promise((r) => setTimeout(r, 300));
    expect(alive.pings.length).toBeGreaterThan(2);
    expect(await clientIds()).toContain(alive.clientId);
    expect(alive.ws.readyState).toBe(WebSocket.OPEN);
    alive.ws.close();
    await expect.poll(clientIds, { timeout: 2000 }).not.toContain(alive.clientId);
  });
});

describe("listeners and pushes (harden-robustness)", () => {
  it("a throwing listener neither fails the command nor starves later listeners", () => {
    const errors: unknown[] = [];
    const boom = new Error("push failed");
    const store = new WorkspaceStore(
      { signalExists: () => true, hasStates: () => false },
      { onListenerError: (error) => errors.push(error) },
    );
    const got: number[][] = [[], [], []];
    store.subscribe((revision) => got[0]?.push(revision));
    store.subscribe(() => {
      throw boom;
    });
    store.subscribe((revision) => got[2]?.push(revision));
    const result = store.execute({ type: "window.create", from: "0", to: "10" });
    expect(result).toMatchObject({ ok: true, revision: 1 });
    expect(got[0]).toEqual([1]);
    expect(got[2]).toEqual([1]);
    expect(errors).toEqual([boom]);
  });

  it("names the command type in state pushes", async () => {
    const { app, workspace } = setup();
    workspace.execute({ type: "window.create", from: "0", to: "10" });
    const base = await app.listen({ port: 0, host: "127.0.0.1" });
    try {
      const client = await connect(base);
      const first = await client.next((m) => m.type === "state");
      expect(first).not.toHaveProperty("command");
      const res = await fetch(`${base}/api/commands`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "window.setRange", windowId: "w1", from: "0", to: "10" }),
      });
      const { revision } = (await res.json()) as { revision: number };
      const pushed = await client.next((m) => m.type === "state" && m.revision === revision);
      expect(pushed).toMatchObject({ type: "state", revision, command: "window.setRange" });
      client.ws.close();
    } finally {
      await app.close();
    }
  });
});

describe("events commands over HTTP (add-events)", () => {
  const real = testSource();
  const catalog = new Catalog(real, () => loadDbcFiles(testDbcFiles));
  const workspace = new WorkspaceStore(
    {
      signalExists: (id) => catalog.get(id) !== undefined,
      hasStates: (id) => catalog.get(id)?.states !== undefined,
    },
    { eventSignals: ["testcar/Ign_A20h.MODE"] },
  );
  const app = buildApp({ catalog, source: real, workspace });
  beforeAll(() => catalog.refresh());
  afterAll(() => app.close());

  const command = async (body: Record<string, unknown>) => {
    const res = await app.inject({ method: "POST", url: "/api/commands", body });
    return { status: res.statusCode, body: res.json() };
  };
  const state = async () => (await app.inject({ url: "/api/workspace" })).json();

  it("applies the events commands over HTTP", async () => {
    // The project file's signal is the start value, at revision 0.
    const start = await state();
    expect(start.revision).toBe(0);
    expect(start.workspace.eventSignals).toEqual(["testcar/Ign_A20h.MODE"]);

    const added = await command({ type: "events.addSignal", signalId: "testcar/DIAG.door" });
    expect(added.status).toBe(200);
    expect(added.body).toMatchObject({ ok: true, revision: 1 });
    expect((await state()).workspace.eventSignals).toEqual([
      "testcar/Ign_A20h.MODE",
      "testcar/DIAG.door",
    ]);

    // Rejected: no states, listed twice, unknown, not listed.
    expect(
      (await command({ type: "events.addSignal", signalId: "testcar/Fast_100h.SIG_A" })).body,
    ).toMatchObject({ ok: false, code: "not_state_signal" });
    expect(
      (await command({ type: "events.addSignal", signalId: "testcar/DIAG.door" })).body,
    ).toMatchObject({ ok: false, code: "already_listed" });
    expect(
      (await command({ type: "events.addSignal", signalId: "testcar/Nope.X" })).body,
    ).toMatchObject({ ok: false, code: "unknown_signal" });
    expect(
      (await command({ type: "events.removeSignal", signalId: "testcar/DIAG.lock" })).body,
    ).toMatchObject({ ok: false, code: "not_listed" });
    expect((await state()).revision).toBe(1);

    // The filter, in normal form; the default removes the field.
    const set = await command({ type: "events.setFilter", filter: "Faults  bms" });
    expect(set.body).toMatchObject({ ok: true, revision: 2 });
    expect((await state()).workspace.eventFilter).toBe("faults bms");
    const bad = await command({ type: "events.setFilter", filter: "ecu:" });
    expect(bad.body).toMatchObject({ ok: false, code: "invalid_filter" });
    expect((await state()).revision).toBe(2);
    await command({ type: "events.setFilter", filter: "active changes" });
    expect((await state()).workspace).not.toHaveProperty("eventFilter");

    const removed = await command({
      type: "events.removeSignal",
      signalId: "testcar/Ign_A20h.MODE",
    });
    expect(removed.body).toMatchObject({ ok: true });
    expect((await state()).workspace.eventSignals).toEqual(["testcar/DIAG.door"]);
  });
});
