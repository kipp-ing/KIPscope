import type { DiagEvent, EventList } from "@kipscope/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.ts";
import { Catalog } from "../src/catalog.ts";
import type { DataSource } from "../src/datasource.ts";
import { loadDbcFiles } from "../src/dbc.ts";
import { WorkspaceStore } from "../src/workspace.ts";
import { scopeApp } from "./scopeApp.ts";
import { testDataSource, testDbcFiles, testEventMapping, testSource } from "./testdb.ts";

/** Decimal ns of 2026-10-01T00:00:00Z + h:m:s.ms (design T base B). */
const B = BigInt(Date.UTC(2026, 9, 1)) * 1_000_000n;
const ns = (h: number, m: number, s: number, ms = 0) =>
  String(B + BigInt(((h * 60 + m) * 60 + s) * 1000 + ms) * 1_000_000n);

/** App on the test DB with the catalog's state signals known to the workspace (as main.ts wires it). */
function appFor(source: DataSource, eventSignals: string[] = []) {
  const catalog = new Catalog(source, () => loadDbcFiles(testDbcFiles));
  const workspace = new WorkspaceStore(
    {
      signalExists: (id) => catalog.get(id) !== undefined,
      hasStates: (id) => catalog.get(id)?.states !== undefined,
    },
    { eventSignals },
  );
  const app = buildApp({ catalog, source, workspace });
  // buildApp only takes a boolean logger, so the spy replaces app.log.warn.
  const warn = vi.spyOn(app.log, "warn").mockImplementation(() => undefined);
  return { app, catalog, workspace, warn };
}

async function getEvents(
  app: ReturnType<typeof appFor>["app"],
  query: Record<string, string | string[]>,
) {
  const res = await app.inject({ url: "/api/events", query });
  return { status: res.statusCode, body: res.json() };
}

describe("GET /api/events on the test DB", () => {
  const { app, catalog } = appFor(testDataSource());
  beforeAll(async () => {
    await app.ready();
    await catalog.refresh();
  });
  afterAll(() => app.close());

  const get = (query: Record<string, string | string[]>) => getEvents(app, query);

  it("lists the events of testcar with categories", async () => {
    const { status, body } = await get({ dataRef: "testcar" });
    expect(status).toBe(200);
    const list = body as EventList;
    expect(list.dataRef).toBe("testcar");
    expect(list.total).toBe(18);
    expect(list.counts).toEqual({
      active: 2,
      pending: 1,
      stored: 2,
      untested: 2,
      passed: 1,
      change: 2,
      snapshot: 4,
      refused: 1,
      transport: 1,
      other: 2,
    });
    expect(list.sources).toEqual([
      { source: "BMS", count: 11 },
      { source: "VCU", count: 7 },
    ]);
    expect(list).not.toHaveProperty("filter");
    expect(list).not.toHaveProperty("truncated");
    expect(list.skipped).toEqual([]);

    // Time order, ties by kind, source and name; the row without a time (P0NULL0) is never returned.
    expect(list.events.map((e) => e.name)).toEqual([
      "VCU.door",
      "VCU.door",
      "VCU.door",
      "VCU.door",
      "DIAG.lock",
      "VCU.door",
      "SID 22",
      "incomplete",
      "boot",
      "P0AA100",
      "P0C4600",
      "P0C7800",
      "P0CA700",
      "P0E1A00",
      "P0FFF00",
      "P180D13",
      "P1CA100",
      "U019B00",
    ]);
    expect(list.events.some((e) => e.name === "P0NULL0")).toBe(false);
    const times = list.events.map((e) => BigInt(e.t));
    expect([...times].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual(times);

    const byName = (name: string) => list.events.filter((e) => e.name === name);
    expect(byName("P0CA700")).toEqual([
      {
        t: ns(5, 0, 0),
        category: "active",
        kind: "dtc",
        source: "BMS",
        name: "P0CA700",
        text: "Discharge current too high",
        detail: "initial",
        value: 41,
        status: "0x29 failing now · confirmed · failed since clear",
      },
    ]);
    // The inferred change carries what it came from.
    const doors = byName("VCU.door");
    expect(doors.map((e) => e.category)).toEqual([
      "snapshot",
      "snapshot",
      "change",
      "snapshot",
      "change",
    ]);
    expect(doors[2]).toMatchObject({ text: "open", from: { text: "closed", t: ns(1, 1, 30) } });
    expect(doors[2]).not.toHaveProperty("inferred");
    expect(doors[4]).toMatchObject({
      text: "closed",
      inferred: true,
      from: { text: "open", t: ns(1, 4, 30) },
    });
    expect(byName("SID 22")[0]).toMatchObject({
      category: "refused",
      value: 49,
      text: "requestOutOfRange",
    });
    expect(byName("incomplete")[0]).toMatchObject({
      category: "transport",
      detail: "132 of 403 bytes, then a new message",
    });
    expect(byName("P0FFF00")[0]).toMatchObject({ category: "other", value: 3.5 });
    expect(byName("P0FFF00")[0]).not.toHaveProperty("status");
    expect(byName("P0E1A00")[0]).toMatchObject({ category: "passed", status: "0x00" });
  });

  it("filters on the server", async () => {
    const faults = await get({ dataRef: "testcar", filter: "faults ecu:bms" });
    expect(faults.status).toBe(200);
    expect(faults.body.filter).toBe("faults ecu:bms");
    expect(faults.body.total).toBe(18);
    const categories = (faults.body.events as DiagEvent[]).map((e) => e.category).sort();
    expect(categories).toEqual(["active", "active", "pending", "stored", "stored"]);
    // counts and sources describe the events before the filter.
    expect(faults.body.counts.snapshot).toBe(4);

    // Keywords are case-insensitive and duplicates drop out of the normal form.
    const again = await get({ dataRef: "testcar", filter: "FAULTS Fault" });
    expect(again.body.filter).toBe("faults");
    expect(again.body.events).toHaveLength(5);

    // A range: the VCU.door rows before 02:00 (the half-open end excludes 02:00:00).
    const range = await get({
      dataRef: "testcar",
      from: "2026-10-01T01:00:00Z",
      to: "2026-10-01T02:00:00Z",
    });
    expect(range.status).toBe(200);
    expect(range.body.total).toBe(4);
    expect(range.body.events).toHaveLength(4);
    expect((range.body.events as DiagEvent[]).every((e) => e.name === "VCU.door")).toBe(true);
    expect(range.body).not.toHaveProperty("filter");

    // The empty filter passes everything; a bad one is a 400 naming the key.
    const empty = await get({ dataRef: "testcar", filter: "" });
    expect(empty.body.events).toHaveLength(18);
    const bad = await get({ dataRef: "testcar", filter: "ecu:" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("invalid_filter");
    expect(bad.body.error.message).toContain("ecu");
  });

  it("rejects bad parameters", async () => {
    expect((await get({})).status).toBe(400);
    const unknown = await get({ dataRef: "nope" });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe("unknown_data_ref");
    expect((await get({ dataRef: "testcar", from: "2026-10-01T01:00:00Z" })).status).toBe(400);
    expect((await get({ dataRef: "testcar", to: "2026-10-01T01:00:00Z" })).status).toBe(400);
    expect(
      (await get({ dataRef: "testcar", from: "2026-10-01T02:00:00Z", to: "2026-10-01T01:00:00Z" }))
        .status,
    ).toBe(400);
    expect(
      (await get({ dataRef: "testcar", from: "2026-10-01T01:00:00Z", to: "2026-10-01T01:00:00Z" }))
        .status,
    ).toBe(400);
    expect((await get({ dataRef: "testcar", from: "x", to: "y" })).status).toBe(400);
  });

  it("reports skipped signals", async () => {
    const { status, body } = await get({
      dataRef: "testcar",
      signal: ["testcar/Fast_100h.SIG_A", "testcar/Nope.X", "othercar/Fast_100h.SIG_A"],
    });
    expect(status).toBe(200);
    expect(body.skipped).toEqual([
      { signalId: "testcar/Fast_100h.SIG_A", reason: "no_states" },
      { signalId: "testcar/Nope.X", reason: "not_in_catalog" },
    ]);
    expect(body.total).toBe(18);
  });

  it("adds the state changes of listed signals", async () => {
    const { status, body } = await get({
      dataRef: "testcar",
      signal: [
        "testcar/Ign_A20h.MODE",
        "testcar/Tmp_A21h.TEMP",
        "testcar/DIAG.door",
        "testcar/DIAG.lock",
      ],
    });
    expect(status).toBe(200);
    const list = body as EventList;
    // DIAG.lock is a diag state of the events table already: no double marks.
    expect(list.skipped).toEqual([{ signalId: "testcar/DIAG.lock", reason: "in_events_table" }]);

    const of = (name: string) =>
      list.events
        .filter((e) => e.kind === "signal" && e.name === name)
        .map((e) => ({
          t: e.t,
          category: e.category,
          text: e.text,
          from: e.from,
          inferred: e.inferred === true,
          signalId: e.signalId,
          source: e.source,
        }));
    const ign = (
      t: string,
      category: string,
      text: string,
      from?: { text: string; t: string },
      inferred = false,
    ) => ({
      t,
      category,
      text,
      from,
      inferred,
      signalId: "testcar/Ign_A20h.MODE",
      source: "Ign_A20h.MODE",
    });
    // MODE: NONE, KEYON from 01:10, NONE from 02:00, KEYON again at 02:45 after a pause (the SNA run at
    // 01:40:00 is left out, so it is no change).
    expect(of("Ign_A20h.MODE")).toEqual([
      ign(ns(1, 0, 0), "snapshot", "NONE"),
      ign(ns(1, 10, 0), "change", "KEYON: Ignition on", { text: "NONE", t: ns(1, 9, 59, 900) }),
      ign(ns(2, 0, 0), "change", "NONE", { text: "KEYON: Ignition on", t: ns(1, 59, 59, 900) }),
      ign(
        ns(2, 45, 0),
        "change",
        "KEYON: Ignition on",
        { text: "NONE", t: ns(2, 29, 59, 900) },
        true,
      ),
    ]);

    const tmp = (
      t: string,
      category: string,
      text: string,
      from?: { text: string; t: string },
    ) => ({
      t,
      category,
      text,
      from,
      inferred: false,
      signalId: "testcar/Tmp_A21h.TEMP",
      source: "Tmp_A21h.TEMP",
    });
    // TEMP: only into and out of the named 254 count; 20..29 wobbling is no change.
    expect(of("Tmp_A21h.TEMP")).toEqual([
      tmp(ns(1, 0, 0), "snapshot", "20"),
      tmp(ns(1, 5, 0), "change", "SENSOR_DEF", { text: "29", t: ns(1, 4, 59) }),
      tmp(ns(1, 5, 10), "change", "25", { text: "SENSOR_DEF", t: ns(1, 5, 9) }),
    ]);

    const dg = (
      t: string,
      category: string,
      text: string,
      from?: { text: string; t: string },
      inferred = false,
    ) => ({
      t,
      category,
      text,
      from,
      inferred,
      signalId: "testcar/DIAG.door",
      source: "DIAG.door",
    });
    expect(of("DIAG.door")).toEqual([
      dg(ns(1, 0, 0), "snapshot", "closed"),
      dg(ns(1, 3, 0), "change", "open", { text: "closed", t: ns(1, 1, 30) }),
      dg(ns(2, 0, 0), "change", "closed", { text: "open", t: ns(1, 4, 30) }, true),
    ]);
    expect(of("DIAG.lock")).toEqual([]);

    // Table events are all still there, in one time order; all times after the base.
    expect(list.events.filter((e) => e.kind !== "signal")).toHaveLength(18);
    const times = list.events.map((e) => BigInt(e.t));
    expect([...times].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual(times);
    expect(times.every((t) => t >= B)).toBe(true);
    // A signal shows up as an ECU in the sources, under its shown name.
    expect(list.sources.map((s) => s.source)).toContain("Ign_A20h.MODE");

    // A filter reaches signal events too: the changes of the listed signals.
    const changes = await get({
      dataRef: "testcar",
      signal: ["testcar/Ign_A20h.MODE"],
      filter: "changes ecu:Ign_A20h.MODE",
    });
    expect(changes.body.events).toHaveLength(3);
  });
});

describe("GET /api/events without an events table", () => {
  const { app, catalog, warn } = appFor(
    testDataSource("signals", { ...testEventMapping, table: "nope" }),
  );
  beforeAll(async () => {
    await app.ready();
    await catalog.refresh();
  });
  afterAll(() => app.close());

  it("answers no events without an events table", async () => {
    for (let i = 0; i < 2; i++) {
      const { status, body } = await getEvents(app, { dataRef: "testcar" });
      expect(status).toBe(200);
      expect(body.total).toBe(0);
      expect(body.events).toEqual([]);
      expect(body.counts).toEqual({});
      expect(body.sources).toEqual([]);
    }
    // One warning per catalog load, naming the table.
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("sdlog.nope"));
    expect(lines).toHaveLength(1);
  });
});

describe("GET /api/events when the source fails", () => {
  const real = testDataSource();
  const source = Object.create(real) as DataSource;
  source.events = () => Promise.reject(new Error("connect ECONNREFUSED"));
  const { app, catalog } = appFor(source);
  beforeAll(async () => {
    await app.ready();
    await catalog.refresh();
  });
  afterAll(() => app.close());

  it("answers 502 source_error and keeps nothing", async () => {
    const { status, body } = await getEvents(app, { dataRef: "testcar" });
    expect(status).toBe(502);
    expect(body.error.code).toBe("source_error");
    // Once the source is back, the same request works (the failure was not cached).
    source.events = (...args) => real.events(...args);
    const retry = await getEvents(app, { dataRef: "testcar" });
    expect(retry.status).toBe(200);
    expect(retry.body.total).toBe(18);
  });
});

describe("GET /api/events with a signal that is recorded later", () => {
  const real = testDataSource();
  let loads = 0;
  const later = { dataRef: "testcar", name: "Later.X" };
  const source = Object.create(real) as DataSource;
  source.listSignals = async (scope, abort) => {
    const list = await real.listSignals(scope, abort);
    loads++;
    // From the second load on the list holds it, with text rows (the text flag of the list).
    return loads >= 2 ? [...list, { ...later, text: true }] : list;
  };
  const { app, catalog, warn } = appFor(source, ["testcar/Ign_A20h.MODE", "testcar/Later.X"]);
  beforeAll(async () => {
    await app.ready();
    await catalog.refresh();
  });
  afterAll(() => app.close());

  it("waits for a listed signal until it is recorded", async () => {
    // The project file's signals are in the workspace, in order, unchecked.
    const state = (await app.inject({ url: "/api/workspace" })).json();
    expect(state.workspace.eventSignals).toEqual(["testcar/Ign_A20h.MODE", "testcar/Later.X"]);

    const signals = ["testcar/Ign_A20h.MODE", "testcar/Later.X"];
    const first = await getEvents(app, { dataRef: "testcar", signal: signals });
    expect(first.status).toBe(200);
    expect(first.body.skipped).toEqual([{ signalId: "testcar/Later.X", reason: "not_in_catalog" }]);
    // Waiting is quiet: one log line for the load, naming the signal.
    const lines = () =>
      warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("testcar/Later.X"));
    expect(lines()).toHaveLength(1);
    await getEvents(app, { dataRef: "testcar", signal: signals });
    expect(lines()).toHaveLength(1);

    // The second load holds it: no longer skipped.
    await catalog.refresh();
    expect(catalog.get("testcar/Later.X")?.states).toBe("text");
    const second = await getEvents(app, { dataRef: "testcar", signal: signals });
    expect(second.status).toBe(200);
    expect(second.body.skipped).toEqual([]);
    expect(lines()).toHaveLength(1);
  });
});

describe("GET /api/events with a scope (add-scope)", () => {
  it("lists the events of a scope", async () => {
    const t = await scopeApp({ adapter: testSource(), dbc: true });
    try {
      // The unscoped answer for the same hour is the reference.
      const hour = await t.get(
        "/api/events?dataRef=testcar&from=2026-10-01T01:00:00Z&to=2026-10-01T02:00:00Z",
      );
      expect(hour.status).toBe(200);
      const set = await t.command({
        type: "scope.set",
        dataRef: "testcar",
        from: "2026-10-01T01:00:00Z",
        to: "2026-10-01T02:00:00Z",
      });
      expect(set.status).toBe(200);

      const scoped = await t.get("/api/events?dataRef=testcar");
      expect(scoped.status).toBe(200);
      // The four VCU.door rows at 01:00:00, 01:01:30, 01:03:00 and 01:04:30; DIAG.lock and the 02:00
      // door row lie at the open end, the DTCs and later events are outside.
      expect(scoped.body.total).toBe(4);
      expect(scoped.body.events).toEqual(hour.body.events);
      expect((scoped.body.events as EventList["events"]).map((e) => e.name)).toEqual([
        "VCU.door",
        "VCU.door",
        "VCU.door",
        "VCU.door",
      ]);

      // With the events-line signal: its first row in the scope is a snapshot, then its change.
      const withSignal = await t.get("/api/events?dataRef=testcar&signal=testcar/Ign_A20h.MODE");
      expect(withSignal.status).toBe(200);
      const list = withSignal.body as EventList;
      const of = list.events
        .filter((e) => e.kind === "signal" && e.name === "Ign_A20h.MODE")
        .map((e) => ({ t: e.t, category: e.category, text: e.text, from: e.from }));
      expect(of).toEqual([
        { t: ns(1, 0, 0), category: "snapshot", text: "NONE", from: undefined },
        {
          t: ns(1, 10, 0),
          category: "change",
          text: "KEYON: Ignition on",
          from: { text: "NONE", t: ns(1, 9, 59, 900) },
        },
      ]);
      // The change at 02:00:00 and later ones lie outside the scope.
      expect(list.events.some((e) => BigInt(e.t) >= BigInt(ns(2, 0, 0)))).toBe(false);
    } finally {
      await t.close();
    }
  });
});
