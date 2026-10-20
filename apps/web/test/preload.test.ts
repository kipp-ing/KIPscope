import {
  applyCommand,
  Command,
  encodeTimes,
  type RawSeries,
  type SeriesResult,
  type Workspace,
  type WorkspaceScope,
} from "@kipscope/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CACHE_LIMIT, PREFETCH_IN_FLIGHT, SeriesCache } from "../src/chart/cache.ts";
import { SeriesLoader } from "../src/chart/loader.ts";
import type { SeriesRequest } from "../src/chart/tiles.ts";
import { NeighbourPreload, PRELOAD_BUDGET, PRELOAD_DELAY_MS } from "../src/preload/preload.ts";
import { at, C4, caseWorkspace, previewOf } from "./caseFixtures.ts";
import { densePoints, fakeAnswer, fakeFetch, flush } from "./fakeSeries.ts";

const NOW = () => 1_000_000_000_000_000; // ms: every tile of these tests lies long before it
const SIG_A = "testcar/Fast_100h.SIG_A";
const OTHER_A = "othercar/Fast_100h.SIG_A";

/** What the cache sent: the series request plus the case index and the preload class. */
type Sent = SeriesRequest & { case?: number; preload?: boolean };

/** One point every 10 s over the whole day around the catalog's sessions. */
const points = () =>
  densePoints(10_000, 10n * 1_000_000_000n, BigInt(at(0, 0)) - 3_600n * 1_000_000_000n);

/** A fetch that answers at once from the fake server and logs what it received. */
function server(log: string[]) {
  const sent: Sent[] = [];
  const aborts: AbortSignal[] = [];
  const data = points();
  const fetch = async (request: Sent, abort: AbortSignal) => {
    sent.push(request);
    aborts.push(abort);
    log.push(`tiles ${request.case} ${request.signalId}`);
    return fakeAnswer(data, request);
  };
  return { fetch, sent, aborts };
}

/** Lets the preload's chain of promises run. */
async function settle() {
  for (let i = 0; i < 60; i++) await vi.advanceTimersByTimeAsync(0);
}

/** The request the cache sent as call `i`, with the case index and the preload class. */
const sentAt = (calls: { request: SeriesRequest }[], i: number): Sent =>
  (calls[i]?.request ?? {}) as Sent;

const previewLog = (log: string[]) => async (index: number) => {
  log.push(`preview ${index}`);
  return previewOf(index);
};

describe("NeighbourPreload", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** C4 at entry 2 with one window at [04:52:00, 04:54:00), 2 min after the session start. */
  const atTwo = () =>
    caseWorkspace({
      current: 2,
      windows: [{ from: at(4, 52), to: at(4, 54), signals: [SIG_A] }],
    });

  it("preloads the next and then the previous session", async () => {
    const log: string[] = [];
    const s = server(log);
    const cache = new SeriesCache(s.fetch, { now: NOW });
    const preload = new NeighbourPreload({ cache, preview: previewLog(log), targetOf: () => 257 });
    preload.state(5);
    preload.rendered(5, atTwo(), "complete");

    // Nothing before the quiet time of 500 ms.
    await vi.advanceTimersByTimeAsync(PRELOAD_DELAY_MS - 1);
    expect(log).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await settle();

    // The preview of index 3 comes first, then its tiles, then the preview of index 1 and its tiles.
    expect(log[0]).toBe("preview 3");
    const firstTiles = log.indexOf("preview 1");
    expect(firstTiles).toBeGreaterThan(1);
    expect(log.slice(1, firstTiles).every((l) => l === `tiles 3 ${SIG_A}`)).toBe(true);
    expect(log.slice(firstTiles + 1).every((l) => l === `tiles 1 ${OTHER_A}`)).toBe(true);
    expect(log.length).toBeGreaterThan(firstTiles + 1);

    // The tiles cover the window as the step would set it, with the case index and the header.
    const covers = (index: number, from: string, to: string) => {
      const mine = s.sent.filter((r) => r.case === index);
      expect(mine.length).toBeGreaterThan(0);
      expect(mine.every((r) => r.preload === true)).toBe(true);
      const lo = mine.reduce(
        (m, r) => (BigInt(r.from) < m ? BigInt(r.from) : m),
        BigInt(mine[0]?.from ?? 0),
      );
      const hi = mine.reduce(
        (m, r) => (BigInt(r.to) > m ? BigInt(r.to) : m),
        BigInt(mine[0]?.to ?? 0),
      );
      expect(lo <= BigInt(from) && hi >= BigInt(to), `case ${index}`).toBe(true);
    };
    // Entry 3 starts 04:58:00 (align start): [05:00:00, 05:02:00).
    covers(3, at(5, 0), at(5, 2));
    // Entry 1 (othercar, 00:00:00 – 00:00:01, scope [23:59:00, 00:01:01)): clamped to [23:59:01, 00:01:01).
    covers(1, String(BigInt(at(0, 0)) - 59n * 1_000_000_000n), at(0, 1, 1));
    expect(s.sent.filter((r) => r.case === 3).every((r) => r.signalId === SIG_A)).toBe(true);
    expect(s.sent.filter((r) => r.case === 1).every((r) => r.signalId === OTHER_A)).toBe(true);
    // Only the next and the previous one: no case 0 or 2.
    expect(new Set(s.sent.map((r) => r.case))).toEqual(new Set([3, 1]));
    preload.dispose();
  });

  it("starts only for a linked case after a complete render", async () => {
    const log: string[] = [];
    const s = server(log);
    const cache = new SeriesCache(s.fetch, { now: NOW });
    const preload = new NeighbourPreload({ cache, preview: previewLog(log), targetOf: () => 257 });
    preload.state(1);
    preload.rendered(1, atTwo(), "error");
    await vi.advanceTimersByTimeAsync(2000);
    expect(log).toEqual([]);

    const unlinked = atTwo();
    if (unlinked.case) unlinked.case = { ...unlinked.case, linked: false };
    preload.state(2);
    preload.rendered(2, unlinked, "complete");
    await vi.advanceTimersByTimeAsync(2000);
    expect(log).toEqual([]);
    preload.dispose();
  });

  it("cancels the preload on a gesture", async () => {
    const calls: { abort: AbortSignal; answer: () => void }[] = [];
    const log: string[] = [];
    const data = points();
    const fetch = (request: Sent, abort: AbortSignal) =>
      new Promise<SeriesResult>((resolve) => {
        log.push(`tiles ${request.case}`);
        calls.push({ abort, answer: () => resolve(fakeAnswer(data, request)) });
      });
    const cache = new SeriesCache(fetch, { now: NOW });
    const preload = new NeighbourPreload({ cache, preview: previewLog(log), targetOf: () => 257 });
    const page = new EventTarget();
    const detach = preload.listen(page);
    const key = (name: string) => Object.assign(new Event("keydown"), { key: name });

    preload.state(5);
    preload.rendered(5, atTwo(), "complete");
    await vi.advanceTimersByTimeAsync(PRELOAD_DELAY_MS);
    await settle();
    // Entry 3's window [05:00:00, 05:02:00) fits in one run, still unanswered: only it is in flight.
    expect(log).toEqual(["preview 3", "tiles 3"]);
    expect(calls).toHaveLength(1);

    // It answers: its tiles are stored, and the preload goes on with entry 1 (preview, one run).
    calls[0]?.answer();
    await settle();
    const stored = cache.size;
    expect(stored).toBeGreaterThan(0);
    expect(log).toEqual(["preview 3", "tiles 3", "preview 1", "tiles 1"]);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.abort.aborted).toBe(false);

    // A lone modifier is no gesture.
    page.dispatchEvent(key("Shift"));
    expect(calls[1]?.abort.aborted).toBe(false);

    // A key press in a window aborts every preload request in flight; stored tiles stay.
    page.dispatchEvent(key("a"));
    expect(calls[1]?.abort.aborted).toBe(true);
    expect(cache.size).toBe(stored);

    // It starts again only after the next settle plus 500 ms.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(log).toEqual(["preview 3", "tiles 3", "preview 1", "tiles 1"]);
    preload.rendered(5, atTwo(), "complete");
    await vi.advanceTimersByTimeAsync(PRELOAD_DELAY_MS - 1);
    expect(log).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    // The stored tiles of entry 3 are not asked again; the preview and entry 1's open run are.
    expect(log.slice(4)[0]).toBe("preview 3");
    expect(log.slice(4).filter((l) => l === "tiles 3")).toEqual([]);
    detach();
    preload.dispose();
  });

  it("cancels the preload on a pointer press, a wheel turn, a command and a new revision", async () => {
    for (const how of ["pointerdown", "wheel", "command", "revision"]) {
      const aborts: AbortSignal[] = [];
      const fetch = (_request: Sent, abort: AbortSignal) =>
        new Promise<SeriesResult>(() => {
          aborts.push(abort);
        });
      const cache = new SeriesCache(fetch, { now: NOW });
      const preload = new NeighbourPreload({
        cache,
        preview: async (index) => previewOf(index),
        targetOf: () => 257,
      });
      const page = new EventTarget();
      const detach = preload.listen(page);
      preload.state(1);
      preload.rendered(1, atTwo(), "complete");
      await vi.advanceTimersByTimeAsync(PRELOAD_DELAY_MS);
      await settle();
      expect(aborts.length, how).toBeGreaterThan(0);
      if (how === "command") preload.cancel();
      else if (how === "revision") preload.state(2);
      else page.dispatchEvent(new Event(how));
      expect(
        aborts.every((a) => a.aborted),
        how,
      ).toBe(true);
      detach();
      preload.dispose();
    }
  });

  it("stops at a quarter of the cache", async () => {
    expect(PRELOAD_BUDGET).toBe(1_000_000);
    expect(PRELOAD_BUDGET).toBe(CACHE_LIMIT / 4);
    // Five signals in one window: ten runs (five per neighbour) of about 150,000 units each, 1.5 M in all.
    const signals = ["A", "B", "C", "D", "E"].map((n) => `testcar/Fast_100h.SIG_${n}`);
    const workspace = caseWorkspace({
      current: 2,
      windows: [{ from: at(4, 52), to: at(4, 54), signals }],
    });
    const POINTS_PER_RUN = 75_000; // weight 2 per point: about 150,000 per run
    let runs = 0;
    const fetch = async (request: Sent): Promise<SeriesResult> => {
      runs++;
      const from = BigInt(request.from);
      const to = BigInt(request.to);
      const step = (to - from) / BigInt(POINTS_PER_RUN);
      const times = Array.from({ length: POINTS_PER_RUN }, (_, i) => from + step * BigInt(i));
      const raw: RawSeries = {
        kind: "raw",
        signalId: request.signalId,
        from: request.from,
        to: request.to,
        t: encodeTimes(times),
        v: times.map(() => 1),
      };
      return raw;
    };
    const cache = new SeriesCache(fetch, { now: NOW, limit: CACHE_LIMIT });
    const preload = new NeighbourPreload({
      cache,
      preview: async (index) => previewOf(index),
      targetOf: () => 257,
    });
    preload.state(1);
    preload.rendered(1, workspace, "complete");
    await vi.advanceTimersByTimeAsync(PRELOAD_DELAY_MS);
    await settle();

    // Each run weighs about 150,000 units: it stops before the run that would pass 1,000,000.
    expect(runs).toBeGreaterThan(0);
    expect(runs).toBeLessThan(10);
    expect(runs * 150_000).toBeLessThanOrEqual(1_000_000);
    expect((runs + 1) * 150_100).toBeGreaterThan(1_000_000);
    preload.dispose();
  });
});

describe("the step after a preload", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** C4 at entry 2 with one window [04:52:00, 04:54:00) on SIG_A (2 min after the session start). */
  const atTwo = (range = { from: at(4, 52), to: at(4, 54) }) =>
    caseWorkspace({ current: 2, windows: [{ ...range, signals: [SIG_A] }] });

  /** `case.go {index}` applied as the server would, with the preview's alignment point. */
  function goTo(workspace: Workspace, index: number): Workspace {
    const result = applyCommand(workspace, Command.parse({ type: "case.go", index }), {
      signalExists: (id) => id.startsWith("testcar/") || id.startsWith("othercar/"),
      hasStates: () => false,
      case: { entry: (i: number) => C4.entries[i], alignAt: previewOf(index).alignAt },
    });
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    return result.workspace;
  }

  /** What the tab then asks for: the cache enters the new scope and the windows load their view. */
  function draw(cache: SeriesCache, workspace: Workspace) {
    cache.setScope(workspace.scope);
    const loader = new SeriesLoader(cache, () => {});
    const requests = workspace.windows.flatMap((w) =>
      w.kind === "timeseries"
        ? w.signals.map((signal) => ({
            key: `${w.id}|${signal.signalId}`,
            signalId: signal.signalId,
            from: w.range.from,
            to: w.range.to,
            target: 257,
          }))
        : [],
    );
    loader.update(requests);
    return { loader, requests };
  }

  const keyOf = (r: Sent) => `${r.case}|${r.signalId}|${r.from}|${r.to}`;

  /** The neighbour's tiles the workspace stored: [from, to) of a request lies inside the scope. */
  const inside = (r: Sent, scope: WorkspaceScope) =>
    BigInt(r.from) >= BigInt(scope.from) && BigInt(r.to) <= BigInt(scope.to);

  /** Preloads entry 3 from entry 2, steps there, draws; returns what was sent before and after. */
  async function stepAfterPreload(range: { from: string; to: string }) {
    const log: string[] = [];
    const s = server(log);
    const cache = new SeriesCache(s.fetch, { now: NOW });
    const preload = new NeighbourPreload({ cache, preview: previewLog(log), targetOf: () => 257 });
    const workspace = atTwo(range);
    preload.state(5);
    preload.rendered(5, workspace, "complete");
    await vi.advanceTimersByTimeAsync(PRELOAD_DELAY_MS);
    await settle();
    const preloaded = s.sent.filter((r) => r.case === 3);
    expect(preloaded.length).toBeGreaterThan(0);
    const before = s.sent.length;

    // The user presses `]`: case.go to the preloaded entry 3, then its windows draw.
    preload.cancel();
    const stepped = goTo(workspace, 3);
    expect(stepped.case?.current).toBe(3);
    const drawn = draw(cache, stepped);
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    const scope = stepped.scope as WorkspaceScope;
    const asked = s.sent.slice(before);
    const statuses = drawn.requests.map((r) => drawn.loader.get(r.key)?.status);
    drawn.loader.dispose();
    preload.dispose();
    return { statuses, scope, preloaded, asked };
  }

  it("draws the stepped-to session from the cache", async () => {
    const { statuses, asked } = await stepAfterPreload({ from: at(4, 52), to: at(4, 54) });
    // Every window drew its tiles from the cache: no /api/series request at all after the step.
    expect(asked.map(keyOf)).toEqual([]);
    expect(statuses).toEqual(["complete"]);
  });

  it("asks again after a step only for tiles the scope cannot store", async () => {
    // A window wider than the session: bucket tiles, of which the first and last straddle the scope.
    const { statuses, scope, preloaded, asked } = await stepAfterPreload({
      from: at(4, 50),
      to: at(5, 10),
    });
    // Whatever the preload fetched and the scope can hold is not asked again: a request after the
    // step reaches outside the scope (an edge tile, stored by no scope) and carries no case index.
    expect(asked.length).toBeGreaterThan(0);
    for (const r of asked) expect(inside(r, scope), `after the step: ${keyOf(r)}`).toBe(false);
    expect(statuses).toEqual(["complete"]);
    // The preload does not fetch what it cannot keep: every run lies inside the neighbour's scope.
    for (const r of preloaded) expect(inside(r, scope), `preloaded: ${keyOf(r)}`).toBe(true);
  });

  it("asks for the same plan once", async () => {
    const log: string[] = [];
    const s = server(log);
    const cache = new SeriesCache(s.fetch, { now: NOW });
    const preload = new NeighbourPreload({ cache, preview: previewLog(log), targetOf: () => 257 });
    preload.state(5);
    // The tab acknowledges the same revision again and again (a new workspace object each time),
    // while the first run is in flight and long after it ended.
    for (let i = 0; i < 4; i++) {
      preload.rendered(5, atTwo(), "complete");
      await vi.advanceTimersByTimeAsync(200);
    }
    await vi.advanceTimersByTimeAsync(PRELOAD_DELAY_MS);
    await settle();
    for (let i = 0; i < 4; i++) {
      preload.rendered(5, atTwo(), "complete");
      await vi.advanceTimersByTimeAsync(PRELOAD_DELAY_MS + 100);
      await settle();
    }
    await vi.advanceTimersByTimeAsync(10_000);
    await settle();

    const tiles = s.sent.map(keyOf);
    expect(tiles.length).toBeGreaterThan(0);
    expect(
      tiles.filter((k, i) => tiles.indexOf(k) !== i),
      "tile requests repeated",
    ).toEqual([]);
    const previews = log.filter((l) => l.startsWith("preview"));
    expect(
      previews.filter((k, i) => previews.indexOf(k) !== i),
      "previews repeated",
    ).toEqual([]);

    // A new revision is a new plan: it may ask again, but stored tiles are not fetched twice.
    const stored = s.sent.length;
    preload.state(6);
    preload.rendered(6, atTwo(), "complete");
    await vi.advanceTimersByTimeAsync(PRELOAD_DELAY_MS);
    await settle();
    expect(s.sent.length).toBe(stored);
    preload.dispose();
  });
});

describe("the cache's preload class", () => {
  const scope: WorkspaceScope = { dataRef: "testcar", from: at(4, 49), to: at(5, 11) };
  const target = (index: number) => ({ case: index, scope });
  const quiet = (p: Promise<unknown>[]) => p.map((x) => x.catch(() => {}));

  it("never delays a visible load", async () => {
    const { fetch, calls } = fakeFetch(densePoints(10, 1000n));
    const cache = new SeriesCache(fetch, { now: NOW });
    // Two preload runs hold both slots.
    quiet(cache.load("p", "testcar/S", 10, [0n], "preload", target(3)));
    quiet(cache.load("p", "testcar/S", 10, [2n], "preload", target(3)));
    expect(PREFETCH_IN_FLIGHT).toBe(2);
    expect(calls).toHaveLength(2);
    // A third preload run waits for a slot.
    quiet(cache.load("p", "testcar/S", 10, [4n], "preload", target(3)));
    expect(calls).toHaveLength(2);
    // A visible load for a tile not in flight starts at once.
    quiet(cache.load("v", "testcar/S", 10, [9n]));
    expect(calls).toHaveLength(3);
    expect(calls[2]?.request.from).toBe((9n * 262144n).toString());
    // A visible load of the waiting preload's tile takes it over and starts it at once.
    quiet(cache.load("v", "testcar/S", 10, [4n]));
    expect(calls).toHaveLength(4);
    expect(sentAt(calls, 3).preload).toBeUndefined();
    expect(sentAt(calls, 3).case).toBeUndefined();
  });

  it("ranks below prefetch and shares its slots", async () => {
    const { fetch, calls } = fakeFetch(densePoints(10, 1000n));
    const cache = new SeriesCache(fetch, { now: NOW });
    quiet(cache.load("p", "testcar/S", 10, [0n], "preload", target(3)));
    quiet(cache.load("p", "testcar/S", 10, [2n], "preload", target(3)));
    expect(calls).toHaveLength(2);
    // Waiting: a preload run first, then a prefetch run; the prefetch run starts first.
    quiet(cache.load("p", "testcar/S", 10, [4n], "preload", target(3)));
    quiet(cache.load("q", "testcar/S", 10, [6n], "prefetch"));
    expect(calls).toHaveLength(2);
    calls[0]?.answer();
    await flush();
    await flush();
    expect(calls).toHaveLength(3);
    expect(calls[2]?.request.from).toBe((6n * 262144n).toString());
    expect(sentAt(calls, 2).preload).toBeUndefined();
    calls[1]?.answer();
    await flush();
    await flush();
    expect(calls).toHaveLength(4);
    expect(sentAt(calls, 3).case).toBe(3);
    expect(sentAt(calls, 3).preload).toBe(true);
  });
});
