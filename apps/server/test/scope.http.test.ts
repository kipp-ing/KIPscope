import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type BucketSeries,
  decodeTimes,
  EMPTY_WORKSPACE,
  type RawSeries,
  type WorkspaceScope,
} from "@kipscope/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Scope, SourceAdapter } from "../src/datasource.ts";
import { loadState, StatePersister } from "../src/persist.ts";
import { SessionStore } from "../src/sessions.ts";
import { WorkspaceStore } from "../src/workspace.ts";
import { multiApp, realSleep } from "./identityApp.ts";
import {
  type Call,
  codeOf,
  type MemorySignal,
  memoryAdapter,
  type ScopeApp,
  scopeApp,
} from "./scopeApp.ts";
import { testSource } from "./testdb.ts";

/** 2026-10-01T01:00:00Z and 02:00:00Z in ns, by hand (1790816400 s and 1790820000 s). */
const T1 = 1790816400000000000n;
const T2 = 1790820000000000000n;
const S = 1_000_000_000n;
const MIN = 60n * S;
const SCOPE: WorkspaceScope = { dataRef: "testcar", from: T1.toString(), to: T2.toString() };
const SCOPE_CMD = { type: "scope.set", dataRef: "testcar", from: SCOPE.from, to: SCOPE.to };

const apps: ScopeApp[] = [];
async function open(options: Parameters<typeof scopeApp>[0]) {
  const app = await scopeApp(options);
  apps.push(app);
  return app;
}
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

/** Waits until the adapter has received no new call for `quietMs` (the scope's background prefetches). */
async function settle(calls: Call[], quietMs = 400) {
  let seen = -1;
  while (seen !== calls.length) {
    seen = calls.length;
    await new Promise((resolve) => setTimeout(resolve, quietMs));
  }
}

/** Resolves with the answer, or rejects when it takes longer than `ms`. */
const within = <T>(promise: Promise<T>, ms: number, what: string) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${what} waited more than ${ms} ms`)), ms),
    ),
  ]);

/** Where each method takes its `scope` argument (design Z1). */
const SCOPE_AT: Record<string, number> = {
  listSignals: 0,
  extent: 1,
  refExtent: 1,
  refCount: 1,
  before: 2,
  after: 2,
  events: 2,
  refBuckets: 3,
  loggerGaps: 3,
  firstTimes: 3,
  stateChanges: 3,
};

/** Every recorded call but `ping` is bounded: it carries `scope`, or its range lies inside it. */
function expectBounded(calls: Call[], scope: Scope) {
  expect(calls.length).toBeGreaterThan(0);
  for (const { method, args } of calls) {
    if (method === "ping") continue;
    const at = SCOPE_AT[method];
    if (at !== undefined) {
      expect(args[at], `${method} carries the scope`).toEqual(scope);
    } else if (method === "raw" || method === "buckets" || method === "count") {
      const [, from, to] = args as [unknown, bigint, bigint];
      expect(from >= scope.from, `${method} from ${from} inside the scope`).toBe(true);
      expect(to <= scope.to, `${method} to ${to} inside the scope`).toBe(true);
    } else {
      throw new Error(`unexpected adapter call: ${method}`);
    }
  }
}

describe("scope over HTTP, full mode, on the test DB", () => {
  it("sets the scope over HTTP", async () => {
    const t = await open({ adapter: testSource() });
    const before = t.store.revision;
    const set = await t.command({
      type: "scope.set",
      dataRef: "testcar",
      from: "2026-10-01T01:00:00Z",
      to: "2026-10-01T02:00:00Z",
    });
    expect(set.status).toBe(200);
    expect(set.body.ok).toBe(true);
    expect(set.body.revision).toBe(before + 1);
    const state = await t.get("/api/workspace");
    expect(state.body.workspace.scope).toEqual({
      dataRef: "testcar",
      from: "1790816400000000000",
      to: "1790820000000000000",
    });

    // A new store built from the same state dir holds the same scope.
    mkdirSync(t.stateDir, { recursive: true });
    const file = join(t.stateDir, "state.json");
    const persister = new StatePersister(file);
    persister.subscribe(t.store);
    expect((await t.command({ type: "scope.clear" })).status).toBe(200);
    expect((await t.command(SCOPE_CMD)).status).toBe(200);
    persister.flush();
    const restored = loadState(file, () => {});
    expect(restored?.workspace.scope).toEqual(SCOPE);
    expect(restored?.revision).toBe(t.store.revision);
    expect(
      new WorkspaceStore(
        { signalExists: () => true, hasStates: () => false },
        restored ? { initial: restored } : {},
      ).workspace.scope,
    ).toEqual(SCOPE);
  });

  it("loads the scope's signal list before applying scope.set", async () => {
    const real = testSource();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The scope's list is held back until the test lets it go.
    const gated: SourceAdapter = {
      ...real,
      info: real.info,
      ping: (abort) => real.ping(abort),
      raw: (...a) => real.raw(...a),
      before: (...a) => real.before(...a),
      after: (...a) => real.after(...a),
      buckets: (...a) => real.buckets(...a),
      refBuckets: (...a) => real.refBuckets(...a),
      count: (...a) => real.count(...a),
      extent: (...a) => real.extent(...a),
      refExtent: (...a) => real.refExtent(...a),
      refCount: (...a) => real.refCount(...a),
      loggerGaps: (...a) => real.loggerGaps(...a),
      firstTimes: (...a) => real.firstTimes(...a),
      stateChanges: (...a) => real.stateChanges(...a),
      events: (...a) => real.events(...a),
      listSignals: async (scope, abort) => {
        if (scope) await gate;
        return real.listSignals(scope, abort);
      },
    };
    const t = await open({ adapter: gated });
    const revision = t.store.revision;
    const pending = t.command(SCOPE_CMD);
    await vi.waitFor(() =>
      expect(t.calls.some((c) => c.method === "listSignals" && c.args[0] !== undefined)).toBe(true),
    );
    // The list is still loading: the command has not been applied.
    expect(t.store.revision).toBe(revision);
    expect(t.store.workspace.scope).toBeUndefined();
    release();
    const set = await pending;
    expect(set.status).toBe(200);
    expect(t.store.revision).toBe(revision + 1);
    const scoped = t.calls.find((c) => c.method === "listSignals" && c.args[0] !== undefined);
    expect(scoped?.args[0]).toEqual({ dataRef: "testcar", from: T1, to: T2 });

    // The catalog is the scope's list and says so.
    const catalog = await t.get("/api/catalog");
    expect(catalog.status).toBe(200);
    expect(catalog.body.scope).toEqual(SCOPE);
    const refs = new Set((catalog.body.items as { dataRef: string }[]).map((i) => i.dataRef));
    expect([...refs]).toEqual(["testcar"]);

    // Signals are checked against that list: testcar's is accepted, othercar's is not listed.
    const created = await t.command({ type: "window.create", from: SCOPE.from, to: SCOPE.to });
    const windowId = created.body.created as string;
    const added = await t.command({
      type: "window.addSignal",
      windowId,
      signalId: "testcar/Fast_100h.SIG_A",
    });
    expect(added.status).toBe(200);
    const other = await t.command({
      type: "window.addSignal",
      windowId,
      signalId: "othercar/Fast_100h.SIG_A",
    });
    expect(other.status).toBe(422);
    expect(codeOf(other.body)).toBe("unknown_signal");
  });

  for (const queue of [undefined, 3]) {
    it(`bounds the routes by the scope${queue === undefined ? "" : ", behind the query queue"}`, async () => {
      const t = await open({ adapter: testSource(), ...(queue === undefined ? {} : { queue }) });
      expect((await t.command(SCOPE_CMD)).status).toBe(200);
      const signal = "testcar/Fast_100h.SIG_A";

      const series = await t.get(
        `/api/series?signal=${signal}&from=2026-10-01T00:00:00Z&to=2026-10-01T10:00:00Z&target=300`,
      );
      expect(series.status).toBe(200);
      // The 10 h request is cut to the scope. Buckets lie on the absolute grid, so the first one may
      // start before T1 (it aggregates only points from T1 on); none reaches outside [T1, T2).
      const buckets = series.body as BucketSeries;
      expect(buckets.kind).toBe("buckets");
      expect(buckets.from).toBe(SCOPE.from);
      expect(buckets.to).toBe(SCOPE.to);
      const width = BigInt(buckets.width);
      const starts = decodeTimes(buckets.t);
      expect(starts.length).toBeGreaterThan(0);
      for (const start of starts) expect(start + width > T1 && start < T2).toBe(true);
      // SIG_A has one point every 5 ms: 720,000 in the hour, and not one from the other 9 hours.
      expect(buckets.count.reduce((a, b) => a + b, 0)).toBe(720_000);

      // A range that starts before the scope gives raw points from T1 on, and no earlier neighbour.
      const raw = await t.get(
        `/api/series?signal=${signal}&from=${T1 - 10n * S}&to=${T1 + 10n * S}&target=20000`,
      );
      expect(raw.status).toBe(200);
      expect(raw.body.kind).toBe("raw");
      const points = decodeTimes((raw.body as RawSeries).t);
      expect(points.length).toBe(2000);
      for (const time of points) expect(time >= T1 && time < T1 + 10n * S).toBe(true);
      expect(raw.body.before).toBeUndefined();

      const extent = await t.get(`/api/extent?signal=${signal}`);
      expect(extent.status).toBe(200);
      expect(BigInt(extent.body.first) >= T1).toBe(true);
      expect(BigInt(extent.body.last) < T2).toBe(true);

      const value = await t.get(`/api/value?signal=${signal}&t=2026-10-01T03:00:00Z`);
      expect(value.status).toBe(409);
      expect(codeOf(value.body)).toBe("out_of_scope");

      const density = await t.get("/api/density?dataRef=othercar");
      expect(density.status).toBe(409);
      expect(codeOf(density.body)).toBe("out_of_scope");

      const other = await t.get(
        "/api/series?signal=othercar/Fast_100h.SIG_A&from=2026-10-01T00:00:00Z&to=2026-10-01T10:00:00Z",
      );
      expect(other.status).toBe(409);
      expect(codeOf(other.body)).toBe("out_of_scope");

      // A range that misses the scope is out of scope as well.
      const outside = await t.get(
        `/api/series?signal=${signal}&from=2026-10-01T05:00:00Z&to=2026-10-01T06:00:00Z`,
      );
      expect(outside.status).toBe(409);
      expect(codeOf(outside.body)).toBe("out_of_scope");
    });
  }

  // Behind a query queue of 3 slots, like main.ts: the wrappers must pass the scope on (queue.ts).
  for (const queue of [undefined, 3]) {
    it(`keeps every call inside the scope in full mode${queue === undefined ? "" : ", behind the query queue"}`, async () => {
      const t = await open({ adapter: testSource(), ...(queue === undefined ? {} : { queue }) });
      // The full catalog loaded before the app started; only what the scope causes is checked.
      const start = t.calls.length;
      expect((await t.command(SCOPE_CMD)).status).toBe(200);
      const signal = "testcar/Fast_100h.SIG_A";
      expect(
        (
          await t.get(
            `/api/series?signal=${signal}&from=2026-10-01T00:00:00Z&to=2026-10-01T10:00:00Z&target=300`,
          )
        ).status,
      ).toBe(200);
      expect((await t.get(`/api/value?signal=${signal}&t=2026-10-01T01:00:01Z`)).status).toBe(200);
      expect((await t.get(`/api/extent?signal=${signal}`)).status).toBe(200);
      expect((await t.get("/api/density?dataRef=testcar")).status).toBe(200);
      expect((await t.get("/api/gaps?dataRef=testcar")).status).toBe(200);
      expect((await t.get("/api/events?dataRef=testcar")).status).toBe(200);
      await settle(t.calls);
      expectBounded(t.calls.slice(start), { dataRef: "testcar", from: T1, to: T2 });
    });
  }
});

/** Signals of the in-memory source: rows inside [T1, T2) and one far outside. */
const MEMORY: MemorySignal[] = [
  {
    dataRef: "testcar",
    name: "Fast_100h.SIG_A",
    rows: [0n, 1n, 2n, 3n, 4n, 5n].map((n) => [T1 + n * MIN, Number(n)]),
  },
  {
    dataRef: "testcar",
    name: "Fast_100h.SIG_B",
    rows: [0n, 1n, 2n, 3n].map((n) => [T1 + n * MIN + S, Number(n) * 2]),
  },
  {
    dataRef: "testcar",
    name: "Ign_A20h.MODE",
    rows: [
      [T1, 0],
      [T1 + 10n * MIN, 3],
    ],
  },
  { dataRef: "testcar", name: "Early.X", rows: [[T1 - 10n * MIN, 1]] },
  { dataRef: "othercar", name: "Fast_100h.SIG_A", rows: [[T1 + MIN, 1]] },
];

describe("scoped mode", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }));

  it("loads nothing at start in scoped mode", async () => {
    vi.useRealTimers();
    const t = await open({ adapter: memoryAdapter(MEMORY), mode: "scoped", startup: true });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(t.calls).toEqual([]);

    const catalog = await t.get("/api/catalog");
    expect(catalog.status).toBe(409);
    expect(codeOf(catalog.body)).toBe("scope_required");
    const density = await t.get("/api/density?dataRef=testcar");
    expect(density.status).toBe(409);
    expect(codeOf(density.body)).toBe("scope_required");
    const meta = await t.get("/api/meta");
    expect(meta.status).toBe(200);
    expect(meta.body.catalog).toEqual({ mode: "scoped", state: "no_scope", size: 0 });
    const clear = await t.command({ type: "scope.clear" });
    expect(clear.status).toBe(422);
    expect(codeOf(clear.body)).toBe("scope_required");
    // The adapter received only pings (the meta route's).
    expect(t.calls.length).toBeGreaterThan(0);
    expect(t.calls.every((c) => c.method === "ping")).toBe(true);
  });

  // The last two runs sit behind a query queue of 3 slots, as main.ts builds the source: every
  // queue wrapper has to pass the scope on, or the scoped-mode guard refuses the call.
  const RUNS = [
    { coreOnlyRun: false, queue: undefined },
    { coreOnlyRun: true, queue: undefined },
    { coreOnlyRun: false, queue: 3 },
    { coreOnlyRun: true, queue: 3 },
  ];
  for (const { coreOnlyRun, queue } of RUNS) {
    const queued = queue === undefined ? "" : ", behind the query queue";
    it(`sends no query without a data ref and a time range in scoped mode (${coreOnlyRun ? "required methods only" : "every method"}${queued})`, async () => {
      const t = await open({
        adapter: memoryAdapter(MEMORY),
        mode: "scoped",
        coreOnly: coreOnlyRun,
        dbc: true,
        ...(queue === undefined ? {} : { queue }),
      });
      const flush = async () => {
        for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(0);
      };
      const ok = (status: number, what: string) => expect(status, what).toBeLessThan(300);

      ok((await t.command(SCOPE_CMD)).status, "scope.set");
      await flush();
      const view = {
        kipscope: "view",
        version: 1,
        title: "Scoped",
        data: ["testcar"],
        linkTime: true,
        cursors: { diff: false },
        digits: 3,
        windows: [
          {
            kind: "timeseries",
            from: "2026-10-01T01:10:00Z",
            to: "2026-10-01T01:20:00Z",
            mode: "line",
            envelope: false,
            signals: ["testcar/Fast_100h.SIG_A", "testcar/Fast_100h.SIG_B"],
          },
        ],
        events: { signals: ["testcar/Ign_A20h.MODE"] },
        // The view carries the scope, so the open keeps it (no pad is added to an explicit scope).
        scope: { dataRef: "testcar", from: "2026-10-01T01:00:00Z", to: "2026-10-01T02:00:00Z" },
      };
      const opened = await t.command({ type: "view.open", view });
      ok(opened.status, "view.open");
      await flush();
      const signal = "testcar/Fast_100h.SIG_A";
      const from = "2026-10-01T00:00:00Z";
      const to = "2026-10-01T10:00:00Z";
      ok((await t.get("/api/catalog")).status, "catalog");
      ok((await t.get("/api/signals?q=sig")).status, "signals");
      ok(
        (await t.get(`/api/series?signal=${signal}&from=${from}&to=${to}&target=300`)).status,
        "series",
      );
      ok((await t.get(`/api/value?signal=${signal}&t=2026-10-01T01:02:00Z`)).status, "value");
      ok((await t.get(`/api/extent?signal=${signal}`)).status, "extent");
      ok((await t.get("/api/density?dataRef=testcar")).status, "density");
      ok((await t.get("/api/gaps?dataRef=testcar")).status, "gaps");
      ok(
        (await t.get("/api/events?dataRef=testcar&signal=testcar/Ign_A20h.MODE")).status,
        "events",
      );
      ok((await t.post("/api/catalog/refresh", {})).status, "catalog refresh");
      await flush();
      // One gap-info poll (every 5 min): it counts only the active scope's rows.
      const beforePoll = t.calls.length;
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 1000);
      await flush();
      const polled = t.calls.slice(beforePoll);
      expect(polled.some((c) => c.method === "refCount" || c.method === "refBuckets")).toBe(true);

      expect(t.guardLog).toEqual([]);
      expectBounded(t.calls, { dataRef: "testcar", from: T1, to: T2 });
    });
  }

  it("keeps an open session's scope list loaded", async () => {
    // Two stored sessions, one on testcar and one on othercar, both of alice.
    const dir = mkdtempSync(join(tmpdir(), "kipscope-scope-sessions-"));
    const store = new SessionStore({
      dir,
      seed: () => EMPTY_WORKSPACE,
      idleDays: 30,
      now: () => Date.now(),
      log: { info() {}, warn() {} },
    });
    store.start();
    const first = store.create("alice", { ...EMPTY_WORKSPACE, scope: SCOPE });
    store.create("alice", { ...EMPTY_WORKSPACE, scope: { ...SCOPE, dataRef: "othercar" } });
    store.flush();
    store.stop();

    const loads: { at: number; scope: Scope | undefined }[] = [];
    let failures = 2;
    const memory = memoryAdapter(MEMORY);
    const adapter: SourceAdapter = {
      ...memory,
      info: memory.info,
      ping: (abort) => memory.ping(abort),
      raw: (...a) => memory.raw(...a),
      before: (...a) => memory.before(...a),
      after: (...a) => memory.after(...a),
      buckets: (...a) => memory.buckets(...a),
      refBuckets: (...a) => memory.refBuckets(...a),
      listSignals: async (scope, abort) => {
        loads.push({ at: Date.now(), scope });
        if (failures-- > 0) throw new Error("connect ECONNREFUSED");
        return memory.listSignals(scope, abort);
      },
    };
    const t = await multiApp({ adapter, mode: "scoped", stateDir: dir });
    try {
      // Nothing loads at start, however many sessions are stored.
      await vi.advanceTimersByTimeAsync(5_000);
      expect(loads).toEqual([]);

      // A live client connects to the first session: its scope's list loads, retried until it does.
      const alice = t.as("alice", ["all"]);
      const connectedAt = Date.now();
      const live = await alice.live(first.record.id);
      for (let i = 0; i < 200 && loads.length === 0; i++) await realSleep(10);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(loads.map((l) => l.at - connectedAt)).toEqual([0, 1000, 3000]);
      // Always with the first session's scope: never without one, never othercar's.
      for (const load of loads)
        expect(load.scope).toEqual({ dataRef: "testcar", from: T1, to: T2 });

      const catalog = await alice.get(`/api/s/${first.record.id}/catalog`);
      expect(catalog.status).toBe(200);
      expect(catalog.body.scope).toEqual(SCOPE);
      // Nothing else loads afterwards.
      await vi.advanceTimersByTimeAsync(120_000);
      expect(loads).toHaveLength(3);
      live.close();
    } finally {
      await t.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("gap info never delays the first draw (Jan, add-scope)", () => {
  it("does not make a series answer wait for gap info", async () => {
    const memory = memoryAdapter(MEMORY);
    // The gap info's three queries never answer: a slow carserver scan.
    const hang = () => new Promise<never>(() => {});
    const adapter: SourceAdapter = {
      ...memory,
      info: memory.info,
      ping: (abort) => memory.ping(abort),
      listSignals: (...a) => memory.listSignals(...a),
      raw: (...a) => memory.raw(...a),
      before: (...a) => memory.before(...a),
      after: (...a) => memory.after(...a),
      buckets: (...a) => memory.buckets(...a),
      refBuckets: (...a) => memory.refBuckets(...a),
      extent: (...a) => memory.extent(...a),
      refExtent: (...a) => memory.refExtent(...a),
      count: (...a) => memory.count(...a),
      stateChanges: (...a) => memory.stateChanges(...a),
      events: (...a) => memory.events(...a),
      refCount: hang,
      loggerGaps: hang,
      firstTimes: hang,
    };
    // Behind a query queue of 3 slots, like main.ts (design: one slot kept for interactive queries).
    const t = await open({ adapter, queue: 3 });
    const set = await within(t.command(SCOPE_CMD), 3000, "scope.set");
    expect(set.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 200));
    // The scope's gap prefetch is running (and stuck); the first draw does not wait for it. (A cursor
    // readout, /api/value, still waits for the gap info of its signal: that is not the first draw.)
    expect(t.calls.some((c) => c.method === "loggerGaps" || c.method === "refCount")).toBe(true);

    const signal = "testcar/Fast_100h.SIG_A";
    const range = "from=2026-10-01T01:00:00Z&to=2026-10-01T02:00:00Z";
    const series = await within(
      t.get(`/api/series?signal=${signal}&${range}&target=300`),
      2000,
      "series",
    );
    expect(series.status).toBe(200);
    expect((await within(t.get(`/api/density?dataRef=testcar`), 2000, "density")).status).toBe(200);
    expect((await within(t.get(`/api/extent?signal=${signal}`), 2000, "extent")).status).toBe(200);
    // Opening a view is not held up either.
    const view = {
      kipscope: "view",
      version: 1,
      title: "Open",
      data: ["testcar"],
      linkTime: true,
      cursors: { diff: false },
      digits: 3,
      windows: [
        {
          kind: "timeseries",
          from: "2026-10-01T01:10:00Z",
          to: "2026-10-01T01:20:00Z",
          mode: "line",
          envelope: false,
          signals: [signal],
        },
      ],
    };
    const opened = await within(t.command({ type: "view.open", view }), 3000, "view.open");
    expect(opened.status).toBe(200);
  });
});

describe("a scope's list that fails", () => {
  it("leaves the workspace unchanged when the scope's list fails", async () => {
    const adapter = memoryAdapter(MEMORY, { failListSignals: (scope) => scope !== undefined });
    const t = await open({ adapter });
    const revision = t.store.revision;
    const answer = await t.command(SCOPE_CMD);
    expect(answer.status).toBe(503);
    expect(codeOf(answer.body)).toBe("catalog_unavailable");
    expect(typeof answer.body.reason).toBe("string");
    expect(answer.body.reason.length).toBeGreaterThan(0);
    expect(t.store.revision).toBe(revision);
    expect(t.store.workspace.scope).toBeUndefined();
  });
});

describe("scope pad (KIPSCOPE_SCOPE_PAD) at the app level", () => {
  /** A view without a scope: one window 01:10-01:20 of testcar, so the scope is derived (Z8). */
  const VIEW = {
    kipscope: "view",
    version: 1,
    title: "Derived",
    data: ["testcar"],
    linkTime: true,
    cursors: { diff: false },
    digits: 3,
    windows: [
      {
        kind: "timeseries",
        from: "2026-10-01T01:10:00Z",
        to: "2026-10-01T01:20:00Z",
        mode: "line",
        envelope: false,
        signals: ["testcar/Fast_100h.SIG_A"],
      },
    ],
  };

  it("derives the scope of a view with the configured pad", async () => {
    const t = await open({ adapter: memoryAdapter(MEMORY), scopePad: 10n * MIN });
    const opened = await t.command({ type: "view.open", view: VIEW });
    expect(opened.status).toBe(200);
    // 01:10 - 10 min = 01:00 and 01:20 + 10 min = 01:30, by hand.
    expect(t.store.workspace.scope).toEqual({
      dataRef: "testcar",
      from: T1.toString(),
      to: (T1 + 30n * MIN).toString(),
    });
  });

  it("pads by 1 h when no pad is configured", async () => {
    const t = await open({ adapter: memoryAdapter(MEMORY) });
    expect((await t.command({ type: "view.open", view: VIEW })).status).toBe(200);
    // 01:10 - 1 h = 00:10 and 01:20 + 1 h = 02:20.
    expect(t.store.workspace.scope).toEqual({
      dataRef: "testcar",
      from: (T1 - 50n * MIN).toString(),
      to: (T1 + 80n * MIN).toString(),
    });
  });
});

describe("commands that do not change the scope never wait for a scope list", () => {
  /** The memory adapter with every scoped `listSignals` held back until `release()`. */
  function gatedMemory() {
    const memory = memoryAdapter(MEMORY);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const adapter: SourceAdapter = {
      ...memory,
      listSignals: async (scope, abort) => {
        if (scope) await gate;
        return memory.listSignals(scope, abort);
      },
    };
    return { adapter, release };
  }
  const CURSOR = { type: "cursor.set", cursor: "a", t: "2026-10-01T01:30:00Z" };

  it("answers cursor.set while a scope.set waits for its list (full mode)", async () => {
    const { adapter, release } = gatedMemory();
    const t = await open({ adapter });
    const pending = t.command(SCOPE_CMD);
    await vi.waitFor(() =>
      expect(t.calls.some((c) => c.method === "listSignals" && c.args[0] !== undefined)).toBe(true),
    );
    const cursor = await within(t.command(CURSOR), 2000, "cursor.set");
    expect(cursor.status).toBe(200);
    expect(t.store.workspace.cursors.a).toBe((T1 + 30n * MIN).toString());
    // The scope.set is still waiting for its list and is applied once the list is there.
    expect(t.store.workspace.scope).toBeUndefined();
    release();
    expect((await pending).status).toBe(200);
    expect(t.store.workspace.scope).toEqual(SCOPE);
  });

  it("answers cursor.set while an open session's scope list is still loading (scoped mode)", async () => {
    vi.useRealTimers();
    const { adapter, release } = gatedMemory();
    const dir = mkdtempSync(join(tmpdir(), "kipscope-scope-sessions-"));
    const store = new SessionStore({
      dir,
      seed: () => EMPTY_WORKSPACE,
      idleDays: 30,
      log: { info() {}, warn() {} },
    });
    store.start();
    const session = store.create("alice", { ...EMPTY_WORKSPACE, scope: SCOPE });
    store.flush();
    store.stop();
    const t = await multiApp({ adapter, mode: "scoped", stateDir: dir });
    try {
      const alice = t.as("alice", ["all"]);
      const live = await alice.live(session.record.id);
      await vi.waitFor(() =>
        expect(t.calls.some((c) => c.method === "listSignals" && c.args[0] !== undefined)).toBe(
          true,
        ),
      );
      const cursor = await within(alice.command(CURSOR, session.record.id), 2000, "cursor.set");
      expect(cursor.status).toBe(200);
      expect(cursor.body.ok).toBe(true);
      release();
      live.close();
    } finally {
      release();
      await t.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("scope changes", () => {
  it("applies scope changes in the order they were accepted", async () => {
    // Each scope's list is held back separately, keyed by the scope's end.
    const memory = memoryAdapter(MEMORY);
    const T_B = T1 + 30n * MIN;
    const gates = new Map<bigint, () => void>();
    const adapter: SourceAdapter = {
      ...memory,
      listSignals: async (scope, abort) => {
        if (scope) {
          await new Promise<void>((resolve) => {
            gates.set(scope.to, resolve);
          });
        }
        return memory.listSignals(scope, abort);
      },
    };
    const t = await open({ adapter });
    const revision = t.store.revision;
    const scopeB = { dataRef: "testcar", from: T1.toString(), to: T_B.toString() };
    const listed = (to: bigint) => () =>
      expect(
        t.calls.some(
          (c) => c.method === "listSignals" && (c.args[0] as Scope | undefined)?.to === to,
        ),
      ).toBe(true);

    // A is accepted first and waits for its list; B is accepted second.
    const a = t.command(SCOPE_CMD);
    await vi.waitFor(listed(T2));
    const b = t.command({ type: "scope.set", ...scopeB });
    await vi.waitFor(listed(T_B));

    // B's list is there first: B still waits for A, so nothing is applied yet.
    gates.get(T_B)?.();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(t.store.workspace.scope).toBeUndefined();
    expect(t.store.revision).toBe(revision);

    // A's list arrives: A is applied, then B. The workspace ends on B.
    gates.get(T2)?.();
    expect((await a).status).toBe(200);
    expect((await b).status).toBe(200);
    expect(t.store.workspace.scope).toEqual(scopeB);
    expect(t.store.revision).toBe(revision + 2);
  });
});
