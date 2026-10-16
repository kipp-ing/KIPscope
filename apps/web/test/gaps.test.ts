import type { GapInfo } from "@kipscope/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bandsIn, GAP_RETRY_MS, GapInfoStore } from "../src/chart/gaps.ts";

const S = 1_000_000_000n;
// gapcar: G = 2026-10-03T00:00:00Z.
const G = 1_790_985_600n * S;
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
      .fn<(dataRef: string) => Promise<GapInfo>>()
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED"))
      .mockResolvedValue(INFO);
    const store = new GapInfoStore(fetchInfo);
    const first = vi.fn();
    const second = vi.fn();
    // Two windows of one data ref ask: one request.
    const releaseFirst = store.ask(["gapcar"], first);
    const releaseSecond = store.ask(["gapcar"], second);
    expect(fetchInfo).toHaveBeenCalledTimes(1);
    expect(fetchInfo).toHaveBeenCalledWith("gapcar");
    expect(store.state(["gapcar"]).settled).toBe(false);

    await vi.advanceTimersByTimeAsync(0);
    // The failure is an error for both windows, and the data ref counts as settled.
    for (const listener of [first, second]) expect(listener).toHaveBeenCalled();
    const failed = store.state(["gapcar"]);
    expect(failed.errors).toEqual([{ dataRef: "gapcar", message: "connect ECONNREFUSED" }]);
    expect(failed.infos.size).toBe(0);
    expect(failed.settled).toBe(true);
    expect(fetchInfo).toHaveBeenCalledTimes(1);

    // 30 s later one more request; after its success there is no error.
    await vi.advanceTimersByTimeAsync(GAP_RETRY_MS - 1);
    expect(fetchInfo).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchInfo).toHaveBeenCalledTimes(2);
    const ok = store.state(["gapcar"]);
    expect(ok.errors).toEqual([]);
    expect(ok.infos.get("gapcar")).toEqual(INFO);
    expect(ok.settled).toBe(true);

    // A loaded info is kept for the tab: a third window asks, no request.
    const releaseThird = store.ask(["gapcar"], vi.fn());
    await vi.advanceTimersByTimeAsync(GAP_RETRY_MS * 2);
    expect(fetchInfo).toHaveBeenCalledTimes(2);
    releaseFirst();
    releaseSecond();
    releaseThird();
  });

  it("stops retrying when no window shows the data ref any more", async () => {
    const fetchInfo = vi
      .fn<(dataRef: string) => Promise<GapInfo>>()
      .mockRejectedValue(new Error("down"));
    const store = new GapInfoStore(fetchInfo);
    const release = store.ask(["gapcar"], vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchInfo).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(GAP_RETRY_MS * 3);
    expect(fetchInfo).toHaveBeenCalledTimes(1);

    // Still asked: it keeps retrying every 30 s.
    const again = new GapInfoStore(fetchInfo);
    fetchInfo.mockClear();
    again.ask(["gapcar", "othercar"], vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchInfo).toHaveBeenCalledTimes(2); // one per data ref
    await vi.advanceTimersByTimeAsync(GAP_RETRY_MS);
    expect(fetchInfo).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(GAP_RETRY_MS);
    expect(fetchInfo).toHaveBeenCalledTimes(6);
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
});
