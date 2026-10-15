import { decodeTimes, type RawSeries, type SeriesResult } from "@letsview/shared";
import { describe, expect, it } from "vitest";
import { SeriesCache } from "../src/chart/cache.ts";
import { type LoadRequest, SeriesLoader } from "../src/chart/loader.ts";
import { type FakePoint, fakeFetch, flush } from "./fakeSeries.ts";

const SIG = "c/s";
const S10 = 262144n; // tile span of level 10 (width 1024 ns)

/**
 * A tile-aligned view of one level-10 tile: [j × S10, (j + 1) × S10) at target 257 has bucket
 * width exactly 1024 ns. The fake signal holds ten raw points per tile: t = j × S10 + 1000 × i + 500,
 * value 100 × j + i.
 */
const POINTS: FakePoint[] = [0n, 1n].flatMap((j) =>
  Array.from({ length: 10 }, (_, i) => ({
    t: j * S10 + 1000n * BigInt(i) + 500n,
    v: Number(100n * j) + i,
  })),
);

const view = (j: bigint, key = "a1", signalId = SIG): LoadRequest => ({
  key,
  signalId,
  from: (j * S10).toString(),
  to: ((j + 1n) * S10).toString(),
  target: 257,
});

const NOW = () => 1_000_000_000_000_000;

function setup(options: { limit?: number } = {}) {
  const server = fakeFetch(POINTS);
  const cache = new SeriesCache(server.fetch, { now: NOW, ...options });
  return { ...server, cache };
}

const raw = (r: SeriesResult | undefined): RawSeries => {
  if (r?.kind !== "raw") throw new Error("expected raw");
  return r;
};

describe("SeriesLoader", () => {
  it("ignores a response that arrives after a newer request's response", async () => {
    const { cache, calls } = setup();
    const loader = new SeriesLoader(cache, () => {});
    loader.update([view(0n)]);
    loader.update([view(1n)]);
    expect(calls[0]?.abort.aborted).toBe(true);
    calls[1]?.answer();
    await flush();
    calls[0]?.answer(); // late answer for the old zoom
    await flush();
    const state = loader.get("a1");
    expect(state).toMatchObject({ status: "complete", result: { from: S10.toString() } });
    expect(raw(state?.result).v).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108, 109]);
  });

  it("keeps showing the previous data while the next range loads", async () => {
    const { cache, calls } = setup();
    const loader = new SeriesLoader(cache, () => {});
    loader.update([view(0n)]);
    calls[0]?.answer();
    await flush();
    loader.update([view(1n)]);
    expect(loader.get("a1")).toMatchObject({ status: "loading", result: { from: "0" } });
  });

  it("marks a failed signal and leaves the others alone", async () => {
    const { cache, calls } = setup();
    const loader = new SeriesLoader(cache, () => {});
    const requests = [view(0n, "a1"), view(1n, "a2")];
    loader.update(requests);
    calls[0]?.fail(new Error("source_error: timeout"));
    calls[1]?.answer();
    await flush();
    expect(loader.get("a1")).toEqual({
      status: "error",
      request: `c/s|0|${S10}|257`,
      error: "source_error: timeout",
    });
    expect(loader.get("a2")?.status).toBe("complete");
    expect(loader.settled(requests)).toBe(true);
  });

  it("does not refetch an unchanged request and aborts removed signals", async () => {
    const { cache, calls } = setup();
    let changes = 0;
    const loader = new SeriesLoader(cache, () => changes++);
    loader.update([view(0n, "a1"), view(1n, "a2")]);
    loader.update([view(0n, "a1"), view(1n, "a2")]);
    expect(calls).toHaveLength(2);
    expect(changes).toBe(1);
    loader.update([view(0n, "a1")]);
    expect(calls[1]?.abort.aborted).toBe(true);
    expect(loader.get("a2")).toBeUndefined();
  });

  it("is settled only when every current request has finished", async () => {
    const { cache, calls } = setup();
    const loader = new SeriesLoader(cache, () => {});
    loader.update([view(0n)]);
    expect(loader.settled([view(0n)])).toBe(false);
    calls[0]?.answer();
    await flush();
    expect(loader.settled([view(0n)])).toBe(true);
    expect(loader.settled([view(1n)])).toBe(false);
  });

  it("restarts every request after dispose", async () => {
    const { cache, calls } = setup();
    const loader = new SeriesLoader(cache, () => {});
    loader.update([view(0n)]);
    loader.dispose(); // StrictMode: dispose, then remount with the same requests
    expect(calls[0]?.abort.aborted).toBe(true);
    loader.update([view(0n)]);
    expect(calls).toHaveLength(2);
    calls[0]?.answer(); // late answer of the disposed request
    await flush();
    expect(loader.get("a1")?.status).toBe("loading");
    calls[1]?.answer();
    await flush();
    expect(loader.get("a1")).toMatchObject({ status: "complete", result: { from: "0" } });
    expect(loader.settled([view(0n)])).toBe(true);
  });
});

describe("SeriesLoader on the tab cache", () => {
  it("draws a previous view again without a request", async () => {
    const { cache, calls } = setup();
    const loader = new SeriesLoader(cache, () => {});
    loader.update([view(0n)]);
    calls[0]?.answer();
    await flush();
    const first = loader.get("a1")?.result;
    loader.update([view(1n)]);
    calls[1]?.answer();
    await flush();
    loader.update([view(0n)]); // back to the first view
    expect(calls).toHaveLength(2);
    expect(loader.get("a1")).toMatchObject({ status: "complete" }); // no flush: at once
    expect(loader.settled([view(0n)])).toBe(true);
    expect(loader.get("a1")?.result).toEqual(first);
  });

  it("serves a re-added signal from the cache", async () => {
    const { cache, calls } = setup();
    const loader = new SeriesLoader(cache, () => {});
    loader.update([view(0n)]);
    calls[0]?.answer();
    await flush();
    loader.update([]); // signal removed
    loader.update([view(0n)]); // dropped back in
    expect(calls).toHaveLength(1);
    expect(loader.get("a1")?.status).toBe("complete");
  });

  // Level 20 (width 2^20 ns, span 2^28 ns): seven points spread over six tiles, values 0 to 6.
  const WIDE: FakePoint[] = [
    100_000_000n,
    300_000_000n,
    400_000_000n,
    500_000_000n,
    900_000_000n,
    1_200_000_000n,
    1_500_000_000n,
  ].map((t, v) => ({ t, v }));
  const wideView = (from: string, to: string): LoadRequest => ({
    key: "a1",
    signalId: SIG,
    from,
    to,
    target: 1001,
  });
  const wideSetup = () => {
    const server = fakeFetch(WIDE);
    return {
      ...server,
      loader: new SeriesLoader(new SeriesCache(server.fetch, { now: NOW }), () => {}),
    };
  };
  const FIRST = wideView("0", String(1000n * 2n ** 20n));

  it("requests only the tiles a pan uncovers", async () => {
    const { calls, loader } = wideSetup();
    loader.update([FIRST]);
    expect(calls.map((c) => c.request)).toEqual([
      { signalId: SIG, from: "0", to: "1073741824", target: 1025 },
    ]);
    calls[0]?.answer();
    await flush();
    loader.update([wideView("524288000", "1572864000")]);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.request).toEqual({
      signalId: SIG,
      from: "1073741824",
      to: "1610612736",
      target: 513,
    });
  });

  it("zooms into raw tiles without a request", async () => {
    const { calls, loader } = wideSetup();
    loader.update([FIRST]);
    calls[0]?.answer();
    await flush();
    expect(raw(loader.get("a1")?.result).v).toEqual([0, 1, 2, 3, 4]); // points before 2^30
    // Zoom in by 4: 250 × 2^20 ns from 200,000,000 is level 18, inside the raw level-20 tiles.
    const from = 200_000_000n;
    const zoom = wideView(from.toString(), (from + 250n * 2n ** 20n).toString());
    loader.update([zoom]);
    expect(calls).toHaveLength(1);
    expect(loader.settled([zoom])).toBe(true);
    const r = raw(loader.get("a1")?.result);
    expect(decodeTimes(r.t)).toEqual([300_000_000n, 400_000_000n]);
    expect(r.v).toEqual([1, 2]);
    expect(r.before).toEqual({ t: "100000000", v: 0 });
    expect(r.after).toEqual({ t: "500000000", v: 3 });
  });

  it("keeps drawing a view whose tiles were dropped", async () => {
    const { cache, calls } = setup({ limit: 1 }); // no tile fits
    const loader = new SeriesLoader(cache, () => {});
    loader.update([view(0n)]);
    calls[0]?.answer();
    await flush();
    expect(cache.size).toBe(0);
    expect(cache.peek(SIG, 10, 0n)).toBeUndefined();
    expect(loader.get("a1")).toMatchObject({ status: "complete", result: { from: "0" } });
    expect(raw(loader.get("a1")?.result).v).toHaveLength(10);
  });

  it("shares one request between two windows", async () => {
    const { cache, calls } = setup();
    const w1 = new SeriesLoader(cache, () => {});
    const w2 = new SeriesLoader(cache, () => {});
    w1.update([view(0n)]);
    w2.update([view(0n)]);
    expect(calls).toHaveLength(1);
    calls[0]?.answer();
    await flush();
    expect(w1.get("a1")?.status).toBe("complete");
    expect(w2.get("a1")?.status).toBe("complete");
  });

  it("lets a late response fill the cache only", async () => {
    const { cache, calls } = setup();
    const w1 = new SeriesLoader(cache, () => {});
    const w2 = new SeriesLoader(cache, () => {});
    w1.update([view(0n)]);
    w2.update([view(0n)]); // wants the first view's tile too
    w1.update([view(1n)]); // w1 moves on
    expect(calls).toHaveLength(2);
    expect(calls[0]?.abort.aborted).toBe(false);
    calls[1]?.answer(); // the second view arrives first
    await flush();
    calls[0]?.answer(); // then the first view's request
    await flush();
    expect(w1.get("a1")).toMatchObject({ status: "complete", result: { from: S10.toString() } });
    expect(w2.get("a1")).toMatchObject({ status: "complete", result: { from: "0" } });
    expect(cache.peek(SIG, 10, 0n)).toBeDefined();
  });

  it("requests failed tiles again for the next view", async () => {
    const { cache, calls } = setup();
    const loader = new SeriesLoader(cache, () => {});
    loader.update([view(0n)]);
    calls[0]?.fail(new Error("source_error: timeout"));
    await flush();
    expect(loader.get("a1")?.status).toBe("error");
    // Another view over the same tile (slightly shorter, still level 10).
    loader.update([{ ...view(0n), to: String(S10 - 1n) }]);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.request).toEqual(calls[0]?.request);
    calls[1]?.answer();
    await flush();
    expect(loader.get("a1")?.status).toBe("complete");
  });
});
