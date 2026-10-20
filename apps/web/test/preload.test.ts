import {
  applyCommand,
  Command,
  encodeTimes,
  type RawSeries,
  type SeriesResult,
  type Workspace,
  type WorkspaceScope,
} from "@kipscope/shared";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
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
function server(log: string[], data = points()) {
  const sent: Sent[] = [];
  const aborts: AbortSignal[] = [];
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

  /**
   * C4 at entry 2 with two windows on SIG_A that keep their own ranges: w1 [04:52:00, 04:54:00)
   * inside the session, w2 [04:50:00, 05:10:00) as wide as the session. Entry 3's scope is
   * [04:57:00, 05:03:00): after `case.go {index: 3}` w1 shows [05:00:00, 05:02:00) and w2 the whole
   * scope. Known target widths: 257 for w1, 700 for w2.
   */
  function twoWindows() {
    const workspace = caseWorkspace({
      current: 2,
      unlinkedTime: true,
      windows: [
        { from: at(4, 52), to: at(4, 54), signals: [SIG_A] },
        { from: at(4, 50), to: at(5, 10), signals: [SIG_A] },
      ],
    });
    const [w1, w2] = workspace.windows.map((w) => w.id) as [string, string];
    const widths: Record<string, number> = { [w1]: 257, [w2]: 700 };
    return { workspace, w1, w2, targetOf: (id: string) => widths[id] };
  }

  /**
   * What the tab then asks for: the cache enters the new scope and each timeseries window, with its
   * own loader, loads its view at its target width (a window without one has not drawn yet).
   */
  function draw(
    cache: SeriesCache,
    workspace: Workspace,
    targetOf: (windowId: string) => number | undefined = () => 257,
  ) {
    cache.setScope(workspace.scope);
    const drawn = workspace.windows.flatMap((w) => {
      const target = targetOf(w.id);
      if (w.kind !== "timeseries" || target === undefined) return [];
      const loader = new SeriesLoader(cache, () => {});
      const requests = w.signals.map((signal) => ({
        key: `${w.id}|${signal.signalId}`,
        signalId: signal.signalId,
        from: w.range.from,
        to: w.range.to,
        target,
      }));
      loader.update(requests);
      return [{ loader, requests }];
    });
    return {
      statuses: () => drawn.flatMap((d) => d.requests.map((r) => d.loader.get(r.key)?.status)),
      dispose: () => {
        for (const d of drawn) d.loader.dispose();
      },
    };
  }

  /** Every tile (signal|level|index) the cache was asked to load, in order, optionally for one case index. */
  function loadedTiles(load: MockInstance<SeriesCache["load"]>, caseIndex?: number): string[] {
    return load.mock.calls
      .filter(
        ([, , , , priority, target]) =>
          caseIndex === undefined || (priority === "preload" && target?.case === caseIndex),
      )
      .flatMap(([, signalId, level, indices]) => indices.map((i) => `${signalId}|${level}|${i}`));
  }

  const keyOf = (r: Sent) => `${r.case}|${r.signalId}|${r.from}|${r.to}`;

  /** Preloads entry 3 from entry 2 (to its end), steps there, draws; returns what was sent after. */
  async function stepAfterPreload(
    workspace: Workspace,
    targetOf: (windowId: string) => number | undefined,
  ) {
    const log: string[] = [];
    const s = server(log);
    const cache = new SeriesCache(s.fetch, { now: NOW });
    const preload = new NeighbourPreload({ cache, preview: previewLog(log), targetOf });
    preload.state(5);
    preload.rendered(5, workspace, "complete");
    await vi.advanceTimersByTimeAsync(PRELOAD_DELAY_MS);
    await settle();
    expect(s.sent.filter((r) => r.case === 3).length).toBeGreaterThan(0);
    const before = s.sent.length;

    // The user presses `]`: case.go to the preloaded entry 3, then its windows draw.
    preload.cancel();
    const stepped = goTo(workspace, 3);
    expect(stepped.case?.current).toBe(3);
    const drawn = draw(cache, stepped, targetOf);
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    const asked = s.sent.slice(before);
    const statuses = drawn.statuses();
    drawn.dispose();
    preload.dispose();
    return { statuses, asked };
  }

  it("plans the tiles the step asks for", async () => {
    const { workspace, targetOf } = twoWindows();
    // A third window has no known target width: the preload skips it (no guess).
    const withThird = {
      ...workspace,
      windows: [
        ...workspace.windows,
        {
          ...(workspace.windows[0] as (typeof workspace.windows)[number]),
          id: "w9",
          signals: [{ id: "s9", signalId: "testcar/Fast_100h.SIG_B" }],
        },
      ],
    };
    const known = (id: string) => (id === "w9" ? undefined : targetOf(id));

    // The preload for entry 3, run to its end.
    const log: string[] = [];
    const s = server(log);
    const cache = new SeriesCache(s.fetch, { now: NOW });
    const planned = vi.spyOn(cache, "load");
    const preload = new NeighbourPreload({ cache, preview: previewLog(log), targetOf: known });
    preload.state(5);
    preload.rendered(5, withThird, "complete");
    await vi.advanceTimersByTimeAsync(PRELOAD_DELAY_MS);
    await settle();
    preload.dispose();
    const plan = loadedTiles(planned, 3);

    // What the two windows' loaders ask for after the step, on a cache that holds nothing.
    const reference = new SeriesCache(fakeFetch([]).fetch, { now: NOW });
    const asked = vi.spyOn(reference, "load");
    const stepped = goTo(withThird, 3);
    const drawn = draw(reference, stepped, known);
    drawn.dispose();
    const step = loadedTiles(asked);

    // By hand: entry 3's scope is [04:57:00, 05:03:00) = [1790830620, 1790830980) s. w1 shows
    // [05:00:00, 05:02:00): 120 s / 256 buckets = 0.47 s, so level 28 (bucket 2^28 ns = 0.27 s,
    // tile 2^36 ns = 68.7 s); w2 shows the whole scope: 360 s / 699 = 0.51 s, level 28 too. The
    // scope spans tiles 26060015 (starts 04:56:34, cut by the scope's start) to 26060020 (ends
    // 05:03:26, cut by its end); w1 lies in 26060017 to 26060019.
    const tiles = [15, 16, 17, 18, 19, 20].map((k) => `${SIG_A}|28|${26060000 + k}`);
    expect([...plan].sort()).toEqual(tiles);
    expect([...new Set(step)].sort()).toEqual(tiles);
    // The plan is the step's set, each tile once, edge tiles and the skipped window included.
    expect(new Set(plan)).toEqual(new Set(step));
    expect(plan.length).toBe(new Set(plan).size);
    expect(plan.some((t) => t.includes("SIG_B"))).toBe(false);
  });

  it("draws the stepped-to session from the cache", async () => {
    const { workspace, targetOf } = twoWindows();
    const { statuses, asked } = await stepAfterPreload(workspace, targetOf);
    // Both windows drew their tiles, edge tiles included, from the cache: no /api/series request
    // at all (none without `case=`) after the step.
    expect(asked.map(keyOf)).toEqual([]);
    expect(statuses).toEqual(["complete", "complete"]);
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

describe("the step after a preload, on windows like smart451's", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const SIG_B = "testcar/Fast_100h.SIG_B";
  /** Plot widths in px: the bucket targets the windows load with. */
  const WIDTHS = { narrow: 257, wide: 400, full: 1233 };

  /**
   * C4 at entry 2 with five timeseries windows that keep their own ranges, like a smart451
   * workspace of several plots: `a` [04:52:00, 04:54:00) on two signals (257 px), `b` as wide as
   * the session [04:50:00, 05:10:00) (400 px: a coarser level, and its first and last tiles are cut
   * by entry 3's scope), `c` the range of `a` at the full 1233 px (a finer level), `d` the range and
   * width of `a` on SIG_A again (the same tiles as `a`), `e` without a width (not drawn yet).
   */
  function plots(alignAt?: string) {
    const workspace = caseWorkspace({
      current: 2,
      ...(alignAt ? { alignAt } : {}),
      unlinkedTime: true,
      windows: [
        { from: at(4, 52), to: at(4, 54), signals: [SIG_A, SIG_B] },
        { from: at(4, 50), to: at(5, 10), signals: [SIG_A] },
        { from: at(4, 52), to: at(4, 54), signals: [SIG_A] },
        { from: at(4, 52), to: at(4, 54), signals: [SIG_A] },
        { from: at(4, 52), to: at(4, 54), signals: [SIG_B] },
      ],
    });
    const [a, b, c, d, e] = workspace.windows.map((w) => w.id) as [
      string,
      string,
      string,
      string,
      string,
    ];
    const widths: Record<string, number | undefined> = {
      [a]: WIDTHS.narrow,
      [b]: WIDTHS.wide,
      [c]: WIDTHS.full,
      [d]: WIDTHS.narrow,
      [e]: undefined,
    };
    return { workspace, widths };
  }

  /**
   * One point every 20 ms from 04:40:00 to 05:10:00 (90,000 points): dense enough that every tile
   * of every level the windows use is answered in buckets, never raw, like smart451's signals, so no
   * tile is cut from a coarser one.
   */
  const data = densePoints(90_000, 20_000_000n, BigInt(at(4, 40)));
  /** The data's extent, as `/api/extent` answers it: what the loaders' overviews are built from. */
  const extent = async (signalId: string) => ({
    signalId,
    first: String(data[0]?.t),
    last: String(data[data.length - 1]?.t),
  });

  /**
   * The tab's windows: one loader each, like the real ones (overview from the extent, prefetch at
   * rest). `show` is what a state push does: the cache enters the scope, each window's loader gets
   * its requests and reloads what it kept.
   */
  function tab(cache: SeriesCache) {
    const loaders = new Map<string, SeriesLoader>();
    const keys: { loader: SeriesLoader; key: string }[] = [];
    return {
      show(workspace: Workspace, widths: Record<string, number | undefined>) {
        cache.setScope(workspace.scope);
        for (const w of workspace.windows) {
          const target = widths[w.id];
          if (w.kind !== "timeseries" || target === undefined) continue;
          let loader = loaders.get(w.id);
          if (!loader) {
            loader = new SeriesLoader(cache, () => {}, { extent, prefetch: true });
            loaders.set(w.id, loader);
          }
          const requests = w.signals.map((signal) => ({
            key: `${w.id}|${signal.signalId}`,
            signalId: signal.signalId,
            from: w.range.from,
            to: w.range.to,
            target,
          }));
          for (const { key } of requests)
            if (!keys.some((k) => k.loader === loader && k.key === key)) keys.push({ loader, key });
          loader.update(requests);
          loader.rescope();
        }
      },
      statuses: () => keys.map(({ loader, key }) => loader.get(key)?.status),
      dispose: () => {
        for (const loader of loaders.values()) loader.dispose();
      },
    };
  }

  /** `signal|level|index` of every tile the calls asked the cache for. */
  const tilesOf = (calls: Parameters<SeriesCache["load"]>[]): string[] =>
    calls.flatMap(([, signalId, level, indices]) =>
      indices.map((i) => `${signalId}|${level}|${i}`),
    );

  /** The tiles the windows' loaders ask for visibly, on a cache that holds nothing, after `workspace` is shown. */
  async function visibleAsks(workspace: Workspace, widths: Record<string, number | undefined>) {
    const cache = new SeriesCache(fakeFetch([]).fetch, { now: NOW });
    const load = vi.spyOn(cache, "load");
    const shown = tab(cache);
    shown.show(workspace, widths);
    await vi.advanceTimersByTimeAsync(0);
    const visible = load.mock.calls.filter(([, , , , priority]) => priority === undefined);
    shown.dispose();
    return tilesOf(visible);
  }

  /** Draws entry 2, lets the preload run to its end for entry 3, steps, and reports what then went out. */
  async function stepOnSmart() {
    const { workspace, widths } = plots();
    const log: string[] = [];
    const s = server(log, data);
    const cache = new SeriesCache(s.fetch, { now: NOW });
    const load = vi.spyOn(cache, "load");
    const shown = tab(cache);
    const preload = new NeighbourPreload({
      cache,
      preview: previewLog(log),
      targetOf: (id) => widths[id],
    });
    // The user is on entry 2: its windows draw and come to rest, then the tab says so.
    shown.show(workspace, widths);
    await vi.advanceTimersByTimeAsync(2000);
    await settle();
    // Entry 2's own tiles may be entry 3's too (the cache is keyed by time): the step finds them.
    const stepped = goTo(workspace, 3);
    const asked = await visibleAsks(stepped, widths);
    const scope = stepped.scope as WorkspaceScope;
    const answers = (id: string) => {
      const [signalId, level, index] = id.split("|") as [string, string, string];
      return cache.hasTile(signalId, Number(level), BigInt(index), scope);
    };
    const warm = asked.filter(answers);
    preload.state(5);
    preload.rendered(5, workspace, "complete");
    await vi.advanceTimersByTimeAsync(PRELOAD_DELAY_MS);
    await settle();
    const preloaded = load.mock.calls.filter(
      ([, , , , priority, target]) => priority === "preload" && target?.case === 3,
    );
    const plan = tilesOf(preloaded);
    // Tiles the step asks and the preload left out must be answerable now (stored by entry 2's
    // draws, or merged from planned children), else the step waits for them.
    const unanswered = asked.filter((id) => !plan.includes(id) && !answers(id));
    const sentBefore = s.sent.length;
    const loadsBefore = load.mock.calls.length;

    // The step: `]`, the server's case.go, the windows get their ranges.
    preload.cancel();
    shown.show(stepped, widths);
    await vi.advanceTimersByTimeAsync(2000);
    await settle();
    const after = load.mock.calls.slice(loadsBefore);
    const result = {
      asked,
      warm,
      plan,
      unanswered,
      afterTiles: tilesOf(after),
      sentBefore: s.sent.slice(0, sentBefore),
      sentAfter: s.sent.slice(sentBefore),
      visible: tilesOf(after.filter(([, , , , priority]) => priority === undefined)),
      statuses: shown.statuses(),
    };
    shown.dispose();
    preload.dispose();
    return result;
  }

  it("plans exactly the tiles the loaders ask for after the step", async () => {
    const { asked, warm, ...step } = await stepOnSmart();

    // By hand: entry 3 shows [05:00:00, 05:02:00) in `a`, `c` and `d`: 120 s over 256 buckets is
    // 0.47 s, level 28 (2^28 ns = 0.27 s); over 1232 buckets 0.097 s, level 26 (2^26 ns = 0.067 s).
    // `b` shows 300 to 360 s over 399 buckets: at least 0.75 s, level 29 (2^29 ns = 0.54 s). `e` has
    // no width and asks nothing. So these signal and level pairs, and no other:
    const levels = (tiles: string[]) =>
      [...new Set(tiles.map((t) => t.split("|").slice(0, 2).join("|")))].sort();
    expect(levels(asked)).toEqual([`${SIG_A}|26`, `${SIG_A}|28`, `${SIG_A}|29`, `${SIG_B}|28`]);

    // The plan is the set the loaders ask for, edge tiles included, less what the cache answers
    // already (tiles entry 2's own draws stored, tiles it merges from planned children): nothing
    // else is planned, nothing the step asks is left unanswered, each tile is planned once although
    // `a` and `d` touch the same range.
    expect(
      step.plan.filter((t) => !asked.includes(t)),
      "a tile the step does not ask",
    ).toEqual([]);
    expect(step.unanswered, "a tile the step has to wait for").toEqual([]);
    expect(
      step.plan.filter((t) => warm.includes(t)),
      "a stored tile planned",
    ).toEqual([]);
    expect(levels(step.plan)).toEqual(levels(asked));
    expect(step.plan.length, "a tile planned twice").toBe(new Set(step.plan).size);
  });

  it("answers the step from memory and asks nothing twice", async () => {
    const step = await stepOnSmart();
    // No window waits for a tile: every visible load is satisfied by the cache.
    expect(step.visible).toEqual([]);
    expect(step.statuses.length).toBeGreaterThan(0);
    expect(step.statuses.every((status) => status === "complete")).toBe(true);

    // What goes out after the step (overview tiles, prefetch at rest) is new: no plain request for
    // a tile the preload fetched, and no request of any class twice.
    expect(step.plan.length).toBeGreaterThan(0);
    expect(
      step.afterTiles.filter((t) => step.plan.includes(t)),
      "a plain request for a preloaded tile",
    ).toEqual([]);
    expect(step.sentAfter.every((r) => r.case === undefined)).toBe(true);
    // The same range at the same width (a level and its tiles) twice would be a repeated request.
    const key = (r: Sent) => `${r.case}|${r.signalId}|${r.from}|${r.to}|${r.target}`;
    const sent = [...step.sentBefore, ...step.sentAfter].map(key);
    expect(
      sent.filter((k, i) => sent.indexOf(k) !== i),
      "a request twice",
    ).toEqual([]);
  });

  it("plans again when a window's width changed before the step", async () => {
    // `a` and `d` get wider (a resized pane) while the tab rests on entry 2: the plan follows the
    // widths the windows have now, so the step still draws from memory.
    const { workspace, widths } = plots();
    const [a, , , d] = workspace.windows.map((w) => w.id) as [string, string, string, string];
    const wider = { ...widths, [a]: 700, [d]: 700 };
    const log: string[] = [];
    const s = server(log, data);
    const cache = new SeriesCache(s.fetch, { now: NOW });
    const load = vi.spyOn(cache, "load");
    const shown = tab(cache);
    let current = widths;
    const preload = new NeighbourPreload({
      cache,
      preview: previewLog(log),
      targetOf: (id) => current[id],
    });
    shown.show(workspace, widths);
    await vi.advanceTimersByTimeAsync(2000);
    await settle();
    preload.state(5);
    preload.rendered(5, workspace, "complete");
    await vi.advanceTimersByTimeAsync(PRELOAD_DELAY_MS);
    await settle();

    current = wider;
    shown.show(workspace, wider);
    await vi.advanceTimersByTimeAsync(2000);
    await settle();
    preload.rendered(5, workspace, "complete");
    await vi.advanceTimersByTimeAsync(PRELOAD_DELAY_MS);
    await settle();

    const loadsBefore = load.mock.calls.length;
    preload.cancel();
    const stepped = goTo(workspace, 3);
    shown.show(stepped, wider);
    await vi.advanceTimersByTimeAsync(2000);
    await settle();
    const visible = tilesOf(
      load.mock.calls.slice(loadsBefore).filter(([, , , , priority]) => priority === undefined),
    );
    expect(visible).toEqual([]);
    // No request went out twice, over both plans.
    const keys = s.sent.map((r) => `${r.case}|${r.signalId}|${r.from}|${r.to}|${r.target}`);
    expect(
      keys.filter((k, i) => keys.indexOf(k) !== i),
      "a request twice",
    ).toEqual([]);
    shown.dispose();
    preload.dispose();
  });

  it("checks what is stored without marking it used", async () => {
    const { workspace, widths } = plots();
    // The same windows one nanosecond later in the session: another plan with the same tiles.
    const later = plots(String(BigInt(at(4, 50)) + 1n)).workspace;
    const log: string[] = [];
    const s = server(log, data);
    const cache = new SeriesCache(s.fetch, { now: NOW });
    const preload = new NeighbourPreload({
      cache,
      preview: previewLog(log),
      targetOf: (id) => widths[id],
    });
    preload.state(5);
    preload.rendered(5, workspace, "complete");
    await vi.advanceTimersByTimeAsync(PRELOAD_DELAY_MS);
    await settle();
    const stored = s.sent.length;
    expect(stored).toBeGreaterThan(0);

    // A new revision plans again: every tile is stored by now, so the check finds each one. The
    // cache's LRU must stay as it was: `find` marks a tile as most recently used, `hasTile` does not.
    const find = vi.spyOn(cache, "find");
    const has = vi.spyOn(cache, "hasTile");
    preload.state(6);
    preload.rendered(6, later, "complete");
    await vi.advanceTimersByTimeAsync(PRELOAD_DELAY_MS);
    await settle();
    expect(s.sent.length, "stored tiles asked again").toBe(stored);
    expect(has).toHaveBeenCalled();
    expect(find, "the stored-check marks tiles as used").not.toHaveBeenCalled();
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
