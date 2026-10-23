import { type BucketSeries, encodeTimes, type GapInfo, type RawSeries } from "@kipscope/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setComputedDefs } from "../src/api.ts";
import { bandsIn, GAP_RETRY_MS, GapInfoStore } from "../src/chart/gaps.ts";

/** 5 min (design G9 (c)); a literal so that the test does not depend on the product constant. */
const REFRESH_MS = 300_000;

const S = 1_000_000_000n;
// gapcar: G = 2026-10-03T00:00:00Z.
const G = 1_790_985_600n * S;
const CYC = "gapcar/Cyc_B10h.CYC";
const INFO: GapInfo = {
  dataRef: "gapcar",
  through: "1790986199980000000",
  logger: [
    { from: "1790985899980000000", to: "1790985960000000000" },
    { from: "1790986180000000000", to: "1790986182000000000" },
  ],
  periods: { "gapcar/Cyc_B10h.CYC": { ns: "20000000", source: "dbc" } },
};

describe("gap info in the tab", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fetches gap info once per data ref and retries a failure", async () => {
    const fetchInfo = vi
      .fn<(dataRef: string, signals: readonly string[]) => Promise<GapInfo>>()
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED"))
      .mockResolvedValue(INFO);
    const store = new GapInfoStore(fetchInfo);
    const first = vi.fn();
    const second = vi.fn();
    // Two windows of one data ref ask: one request.
    const releaseFirst = store.ask([CYC], first);
    const releaseSecond = store.ask([CYC], second);
    expect(fetchInfo).toHaveBeenCalledTimes(1);
    expect(fetchInfo).toHaveBeenCalledWith("gapcar", [CYC]);
    expect(store.state([CYC]).settled).toBe(false);

    await vi.advanceTimersByTimeAsync(0);
    // The failure is an error for both windows, and the data ref counts as settled.
    for (const listener of [first, second]) expect(listener).toHaveBeenCalled();
    const failed = store.state([CYC]);
    expect(failed.errors).toEqual([{ dataRef: "gapcar", message: "connect ECONNREFUSED" }]);
    expect(failed.infos.size).toBe(0);
    expect(failed.settled).toBe(true);
    expect(fetchInfo).toHaveBeenCalledTimes(1);

    // 30 s later one more request; after its success there is no error.
    await vi.advanceTimersByTimeAsync(GAP_RETRY_MS - 1);
    expect(fetchInfo).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchInfo).toHaveBeenCalledTimes(2);
    const ok = store.state([CYC]);
    expect(ok.errors).toEqual([]);
    expect(ok.infos.get("gapcar")).toEqual(INFO);
    expect(ok.settled).toBe(true);

    // A loaded info is kept for the tab: a third window asks, no request.
    const releaseThird = store.ask([CYC], vi.fn());
    await vi.advanceTimersByTimeAsync(GAP_RETRY_MS * 2);
    expect(fetchInfo).toHaveBeenCalledTimes(2);
    releaseFirst();
    releaseSecond();
    releaseThird();
  });

  it("stops retrying when no window shows the data ref any more", async () => {
    const fetchInfo = vi
      .fn<(dataRef: string, signals: readonly string[]) => Promise<GapInfo>>()
      .mockRejectedValue(new Error("down"));
    const store = new GapInfoStore(fetchInfo);
    const release = store.ask([CYC], vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchInfo).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(GAP_RETRY_MS * 3);
    expect(fetchInfo).toHaveBeenCalledTimes(1);

    // Still asked: it keeps retrying every 30 s.
    const again = new GapInfoStore(fetchInfo);
    fetchInfo.mockClear();
    again.ask([CYC, "othercar/Other"], vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchInfo).toHaveBeenCalledTimes(2); // one per data ref
    expect(fetchInfo).toHaveBeenCalledWith("gapcar", [CYC]);
    expect(fetchInfo).toHaveBeenCalledWith("othercar", ["othercar/Other"]);
    await vi.advanceTimersByTimeAsync(GAP_RETRY_MS);
    expect(fetchInfo).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(GAP_RETRY_MS);
    expect(fetchInfo).toHaveBeenCalledTimes(6);
  });

  it("asks for the windows' signals and fetches again for a new one", async () => {
    const answer: GapInfo = { dataRef: "car", logger: [], periods: {} };
    const asked: string[][] = [];
    let finishThird: () => void = () => {};
    // The second fetch (for car/z) is held open so that the test sees the state meanwhile.
    const fetchInfo = vi.fn(async (_dataRef: string, signals: readonly string[]) => {
      asked.push([...signals]);
      if (asked.length === 2) await new Promise<void>((resolve) => (finishThird = resolve));
      return structuredClone(answer);
    });
    const store = new GapInfoStore(fetchInfo);

    // Window A asks for car/x and car/y: one fetch naming both.
    const releaseA = store.ask(["car/x", "car/y"], vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toEqual([["car/x", "car/y"]]);
    expect(store.state(["car/x", "car/y"]).settled).toBe(true);

    // Window B asks for car/y: the last fetch named it, so nothing is fetched.
    const releaseB1 = store.ask(["car/y"], vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toHaveLength(1);
    expect(store.state(["car/y"]).settled).toBe(true);

    // B now shows car/y and car/z (React drops the old ask, then asks anew): one fetch with all
    // three, and B is not settled until its answer is in, even though the answer will be equal.
    releaseB1();
    const listenerB = vi.fn();
    const releaseB2 = store.ask(["car/y", "car/z"], listenerB);
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toEqual([
      ["car/x", "car/y"],
      ["car/x", "car/y", "car/z"],
    ]);
    expect(store.state(["car/y", "car/z"]).settled).toBe(false);
    listenerB.mockClear();
    finishThird();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.state(["car/y", "car/z"]).settled).toBe(true);
    expect(listenerB).toHaveBeenCalled();

    // 5 min later the refetch names the three signals asked at that time, once.
    await vi.advanceTimersByTimeAsync(REFRESH_MS);
    expect(asked).toHaveLength(3);
    expect(asked[2]).toEqual(["car/x", "car/y", "car/z"]);

    // A releases its ask: the next refetch no longer names car/x.
    releaseA();
    await vi.advanceTimersByTimeAsync(REFRESH_MS);
    expect(asked).toHaveLength(4);
    expect(asked[3]).toEqual(["car/y", "car/z"]);
    releaseB2();
  });

  it("names at most 100 signals per data ref", async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `car/S${String(i).padStart(3, "0")}`);
    const fetchInfo = vi.fn(
      async (_dataRef: string, _signals: readonly string[]): Promise<GapInfo> => ({
        dataRef: "car",
        logger: [],
        periods: {},
      }),
    );
    const store = new GapInfoStore(fetchInfo);
    const release = store.ask(ids, vi.fn());
    expect(store.state(ids).settled).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    // One fetch naming the first 100 in the window's order.
    expect(fetchInfo).toHaveBeenCalledTimes(1);
    expect(fetchInfo).toHaveBeenCalledWith("car", ids.slice(0, 100));
    expect(store.state(ids).settled).toBe(true);

    // The 20 signals beyond the limit cannot be named: another window asking for them fetches nothing.
    const releaseOther = store.ask(ids, vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchInfo).toHaveBeenCalledTimes(1);
    release();
    releaseOther();
  });
});

describe("bands of a view", () => {
  const logger = INFO.logger.map((g) => ({ from: BigInt(g.from), to: BigInt(g.to) }));

  it("lists the logger gaps a view shows", () => {
    // 00:04:00 - 00:09:41: the first gap whole, the second clipped to the view's end.
    expect(bandsIn(logger, G + 240n * S, G + 581n * S)).toEqual([
      { from: G + 299_980_000_000n, to: G + 360n * S },
      { from: G + 580n * S, to: G + 581n * S },
    ]);
    // A view that starts inside a gap is clipped at the start; one between the gaps shows none.
    expect(bandsIn(logger, G + 330n * S, G + 400n * S)).toEqual([
      { from: G + 330n * S, to: G + 360n * S },
    ]);
    expect(bandsIn(logger, G + 400n * S, G + 500n * S)).toEqual([]);
    // Touching the view's edge is not meeting it.
    expect(bandsIn(logger, G + 360n * S, G + 400n * S)).toEqual([]);
    expect(bandsIn([], 0n, 10n)).toEqual([]);
  });

  it("leaves out a band that holds samples", () => {
    // G9 repro: the logger gap 18:51:11.171 - 18:52:43.235 UTC holds drawn samples of the view.
    const gap = { from: 1_792_176_671_171_000_000n, to: 1_792_176_763_235_000_000n };
    const from = 1_792_176_671_385_000_000n;
    const to = 1_792_176_680_691_000_000n;
    const MS = 1_000_000n;
    const times = Array.from({ length: 95 }, (_, i) => from + BigInt(i) * 100n * MS);
    const rawResult: RawSeries = {
      kind: "raw",
      signalId: "smart451/DCU_2B8h.HTR_HV_Volt",
      from: from.toString(),
      to: to.toString(),
      t: encodeTimes(times),
      v: times.map(() => 350),
    };
    const bucketResult: BucketSeries = {
      kind: "buckets",
      signalId: "smart451/STR_0D4h.STEER_ANGLE",
      from: from.toString(),
      to: to.toString(),
      width: "20000000",
      t: encodeTimes([from + 15n * MS, from + 35n * MS]),
      count: [2, 2],
      sna: [0, 0],
      mean: [1, 2],
      min: [1, 2],
      max: [1, 2],
    };
    // Without results the one gap shows, clipped to the view; with a result that holds a sample, none.
    expect(bandsIn([gap], from, to)).toEqual([{ from, to }]);
    expect(bandsIn([gap], from, to, [])).toEqual([{ from, to }]);
    expect(bandsIn([gap], from, to, [rawResult])).toEqual([]);
    expect(bandsIn([gap], from, to, [bucketResult])).toEqual([]);
    expect(bandsIn([gap], from, to, [bucketResult, rawResult])).toEqual([]);
    // A result without a sample inside the gap (here: its only point lies before it) voids nothing.
    const outside: RawSeries = {
      ...rawResult,
      t: encodeTimes([gap.from - 5_000_000_000n]),
      v: [1],
    };
    expect(bandsIn([gap], from, to, [outside])).toEqual([{ from, to }]);
    // Per gap: of two gaps only the one that holds a sample drops out.
    const real = { from: to + 10n * MS * 1000n, to: to + 20n * MS * 1000n };
    expect(bandsIn([gap, real], from, real.to + 1n, [rawResult])).toEqual([
      { from: real.from, to: real.to },
    ]);
  });
});

describe("gap info refetch", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("refetches gap info every 5 min and keeps it on failure", async () => {
    const fewer: GapInfo = { ...INFO, logger: INFO.logger.slice(0, 1) };
    const fetchInfo = vi
      .fn<(dataRef: string, signals: readonly string[]) => Promise<GapInfo>>()
      .mockResolvedValueOnce(INFO)
      // The same answer again (a new object with equal content), then one logger gap less, then a failure.
      .mockResolvedValueOnce(structuredClone(INFO))
      .mockResolvedValueOnce(fewer)
      .mockRejectedValue(new Error("connect ECONNREFUSED"));
    const store = new GapInfoStore(fetchInfo);
    const listener = vi.fn();
    const release = store.ask([CYC], listener);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchInfo).toHaveBeenCalledTimes(1);
    const first = store.state([CYC]);
    expect(first.settled).toBe(true);
    const loaded = first.infos.get("gapcar");
    expect(loaded).toEqual(INFO);

    // Nothing before the 5 min mark, one request at it; the same answer replaces nothing.
    await vi.advanceTimersByTimeAsync(REFRESH_MS - 1);
    expect(fetchInfo).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchInfo).toHaveBeenCalledTimes(2);
    const same = store.state([CYC]);
    expect(same.infos.get("gapcar")).toBe(loaded);
    expect(same.settled).toBe(true);
    expect(same.errors).toEqual([]);

    // 5 min more, one logger gap less: the info is replaced.
    const calls = listener.mock.calls.length;
    await vi.advanceTimersByTimeAsync(REFRESH_MS);
    expect(fetchInfo).toHaveBeenCalledTimes(3);
    const changed = store.state([CYC]);
    expect(changed.infos.get("gapcar")).toEqual(fewer);
    expect(changed.infos.get("gapcar")).not.toBe(loaded);
    expect(listener.mock.calls.length).toBeGreaterThan(calls);

    // 5 min more, the fetch fails: the old info stays, no error, the window stays settled.
    await vi.advanceTimersByTimeAsync(REFRESH_MS);
    expect(fetchInfo).toHaveBeenCalledTimes(4);
    const kept = store.state([CYC]);
    expect(kept.infos.get("gapcar")).toEqual(fewer);
    expect(kept.errors).toEqual([]);
    expect(kept.settled).toBe(true);

    // It is tried again at the next interval, and not at the 30 s retry of a first failure.
    await vi.advanceTimersByTimeAsync(GAP_RETRY_MS * 2);
    expect(fetchInfo).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(REFRESH_MS);
    expect(fetchInfo).toHaveBeenCalledTimes(5);
    expect(store.state([CYC]).errors).toEqual([]);

    // Released: no more requests.
    release();
    await vi.advanceTimersByTimeAsync(REFRESH_MS * 3);
    expect(fetchInfo).toHaveBeenCalledTimes(5);
  });
});

describe("gap info of computed signals (add-computed-signals)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    setComputedDefs([]);
  });

  // spec computed-signals "Parameters and gap signals"
  it("asks gap info for a computed signal's inputs", async () => {
    setComputedDefs([{ id: "c7", name: "Diff", formula: "a - b", a: "A.X", b: "B.Y" }]);
    const fetchInfo = vi
      .fn<(dataRef: string, signals: readonly string[]) => Promise<GapInfo>>()
      .mockResolvedValue({ dataRef: "car", logger: [], periods: {} });
    const store = new GapInfoStore(fetchInfo);
    const release = store.ask(["car/=c7", "car/C.Z"], vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    // The inputs stand in for the computed ID; the computed ID itself is never asked.
    expect(fetchInfo).toHaveBeenCalledTimes(1);
    expect(fetchInfo).toHaveBeenCalledWith("car", ["car/A.X", "car/B.Y", "car/C.Z"]);
    expect(fetchInfo.mock.calls.flatMap((c) => c[1]).some((id) => id.includes("=c7"))).toBe(false);
    // The state is read by the same IDs the window asks with.
    expect(store.state(["car/=c7", "car/C.Z"]).settled).toBe(true);
    // The same data ref of another session names the inputs there.
    release();
    const other = store.ask(["other/=c7"], vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchInfo).toHaveBeenCalledWith("other", ["other/A.X", "other/B.Y"]);
    other();
  });
});
