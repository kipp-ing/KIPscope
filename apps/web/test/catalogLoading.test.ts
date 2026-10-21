import type { CursorValueResult, GapInfo } from "@kipscope/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Acknowledger } from "../src/ack.ts";
import { ApiRequestError, isCatalogLoading } from "../src/api.ts";
import { SeriesCache } from "../src/chart/cache.ts";
import { GAP_RETRY_MS, GapInfoStore } from "../src/chart/gaps.ts";
import {
  LOAD_INTERVAL_MS,
  type LoadRequest,
  loadStatusText,
  SeriesLoader,
} from "../src/chart/loader.ts";
import { ValueLoader, type ValueRequest } from "../src/values/loader.ts";
import { type FakeCall, type FakePoint, fakeFetch } from "./fakeSeries.ts";

// A server right after its start answers 503 catalog_unavailable until the catalog is loaded; the
// web treats that as "still loading", not as an error (add-multiuser follow-up).

const loading = () => new ApiRequestError(503, "catalog_unavailable", "still loading");
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

describe("isCatalogLoading", () => {
  it("is true only for 503 with code catalog_unavailable", () => {
    expect(isCatalogLoading(loading())).toBe(true);
    expect(isCatalogLoading(new ApiRequestError(503, "source_error", "down"))).toBe(false);
    expect(isCatalogLoading(new ApiRequestError(404, "catalog_unavailable", "x"))).toBe(false);
    expect(isCatalogLoading(new ApiRequestError(404, "unknown_signal", "x"))).toBe(false);
    expect(isCatalogLoading(new Error("catalog_unavailable"))).toBe(false);
    expect(isCatalogLoading(undefined)).toBe(false);
  });
});

describe("gap info while the catalog loads", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const CYC = "gapcar/Cyc_B10h.CYC";
  const INFO: GapInfo = {
    dataRef: "gapcar",
    through: "1790986199980000000",
    logger: [{ from: "1790985899980000000", to: "1790985960000000000" }],
    periods: { [CYC]: { ns: "20000000", source: "dbc" } },
  };
  type Fetch = (dataRef: string, signals: readonly string[]) => Promise<GapInfo>;

  it("catalog_unavailable is no error, not settled, and is retried well before the retry delay", async () => {
    const fetchInfo = vi.fn<Fetch>().mockRejectedValueOnce(loading()).mockResolvedValue(INFO);
    const store = new GapInfoStore(fetchInfo);
    store.ask([CYC], vi.fn());
    await tick(0);
    expect(fetchInfo).toHaveBeenCalledTimes(1);
    const during = store.state([CYC]);
    expect(during.errors).toEqual([]);
    expect(during.settled).toBe(false);
    expect(during.infos.size).toBe(0);

    // A short time later (far below GAP_RETRY_MS) the second request went out and succeeded.
    await tick(5_000);
    expect(5_000).toBeLessThan(GAP_RETRY_MS);
    expect(fetchInfo).toHaveBeenCalledTimes(2);
    const done = store.state([CYC]);
    expect(done.errors).toEqual([]);
    expect(done.infos.get("gapcar")).toEqual(INFO);
    expect(done.settled).toBe(true);
  });

  it("keeps retrying while the catalog stays unavailable", async () => {
    const fetchInfo = vi
      .fn<Fetch>()
      .mockRejectedValueOnce(loading())
      .mockRejectedValueOnce(loading())
      .mockResolvedValue(INFO);
    const store = new GapInfoStore(fetchInfo);
    store.ask([CYC], vi.fn());
    await tick(0);
    for (let s = 0; s < 25; s++) {
      await tick(1_000);
      expect(store.state([CYC]).errors).toEqual([]);
    }
    expect(fetchInfo).toHaveBeenCalledTimes(3);
    expect(store.state([CYC])).toMatchObject({ settled: true, errors: [] });
  });

  it("notifies the asking window when the info arrives", async () => {
    const fetchInfo = vi.fn<Fetch>().mockRejectedValueOnce(loading()).mockResolvedValue(INFO);
    const store = new GapInfoStore(fetchInfo);
    const listener = vi.fn();
    store.ask([CYC], listener);
    await tick(5_000);
    expect(listener).toHaveBeenCalled();
    expect(store.state([CYC]).infos.get("gapcar")).toEqual(INFO);
  });

  it("other failures still become errors", async () => {
    for (const error of [
      new ApiRequestError(500, "internal", "boom"),
      new ApiRequestError(503, "source_error", "down"),
      new ApiRequestError(403, "forbidden_data", "no"),
    ]) {
      const store = new GapInfoStore(vi.fn<Fetch>().mockRejectedValue(error));
      store.ask([CYC], vi.fn());
      await tick(0);
      const state = store.state([CYC]);
      expect(state.errors).toEqual([{ dataRef: "gapcar", message: error.message }]);
      expect(state.settled).toBe(true);
    }
  });
});

describe("series loader while the catalog loads", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const SIG = "c/s";
  const S10 = 262144n; // tile span of level 10 (width 1024 ns)
  const POINTS: FakePoint[] = Array.from({ length: 10 }, (_, i) => ({
    t: 1000n * BigInt(i) + 500n,
    v: i,
  }));
  const view: LoadRequest = {
    key: "a1",
    signalId: SIG,
    from: "0",
    to: S10.toString(),
    target: 257,
  };

  function setup() {
    const server = fakeFetch(POINTS);
    const cache = new SeriesCache(server.fetch, { now: () => 1_000_000_000_000_000 });
    const loader = new SeriesLoader(cache, () => {}, {
      loadIntervalMs: LOAD_INTERVAL_MS,
      retry: true,
    });
    return { loader, calls: server.calls };
  }
  const failCall = async (call: FakeCall | undefined, error: Error) => {
    call?.fail(error);
    await tick();
  };

  it("catalog_unavailable leaves no error, is retried and ends complete", async () => {
    const { loader, calls } = setup();
    loader.update([view]);
    await tick(LOAD_INTERVAL_MS);
    expect(calls).toHaveLength(1);
    await failCall(calls[0], loading());
    const state = loader.get("a1");
    expect(state?.status).not.toBe("error");
    expect(state?.error).toBeUndefined();
    expect(loadStatusText(state)).not.toMatch(/^failed:/);
    expect(loader.settled([view])).toBe(false);

    // Retried within a short time; its answer completes the window.
    await tick(5_000);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const retry = calls.at(-1);
    expect(retry?.request).toEqual(calls[0]?.request);
    retry?.answer();
    await tick();
    expect(loader.get("a1")).toMatchObject({ status: "complete" });
    expect(loader.get("a1")?.error).toBeUndefined();
    expect(loadStatusText(loader.get("a1"))).toBe("");
    expect(loader.settled([view])).toBe(true);
    loader.dispose();
  });

  it("retries a catalog_unavailable within 3 s on every consecutive failure, also the 4th and 5th", async () => {
    const { loader, calls } = setup();
    loader.update([view]);
    await tick(LOAD_INTERVAL_MS);
    for (let failure = 1; failure <= 6; failure++) {
      expect(calls, `request before failure ${failure}`).toHaveLength(failure);
      await failCall(calls[failure - 1], loading());
      expect(loader.get("a1")?.error, `failure ${failure}`).toBeUndefined();
      await tick(3_000);
      expect(calls, `retry after failure ${failure}`).toHaveLength(failure + 1);
    }
    calls.at(-1)?.answer();
    await tick();
    expect(loader.get("a1")).toMatchObject({ status: "complete" });
    loader.dispose();
  });

  it("a non-catalog failure keeps the longer backoff (1 s, 2 s, 4 s, 8 s)", async () => {
    const { loader, calls } = setup();
    loader.update([view]);
    await tick(LOAD_INTERVAL_MS);
    // [delay of the backoff after this failure, ms to wait before the retry must have gone out]
    const steps: [number, number][] = [
      [1_000, 3_000],
      [2_000, 3_000],
      [4_000, 5_000],
      [8_000, 9_000],
    ];
    for (const [index, [delay, within]] of steps.entries()) {
      const n = index + 1;
      expect(calls, `request before failure ${n}`).toHaveLength(n);
      await failCall(calls[index], new ApiRequestError(503, "source_error", "down"));
      expect(loader.get("a1")?.status).toBe("error");
      if (delay > 3_000) {
        await tick(3_000);
        expect(calls, `no retry yet after failure ${n}`).toHaveLength(n);
        await tick(within - 3_000);
      } else {
        await tick(within);
      }
      expect(calls, `retry after failure ${n}`).toHaveLength(n + 1);
    }
    loader.dispose();
  });

  it("a 4xx still stays an error", async () => {
    const { loader, calls } = setup();
    loader.update([view]);
    await tick(LOAD_INTERVAL_MS);
    await failCall(calls[0], new ApiRequestError(404, "not_found", "no such thing"));
    await tick(120_000);
    expect(calls).toHaveLength(1);
    expect(loader.get("a1")).toMatchObject({
      status: "error",
      error: "not_found: no such thing",
    });
    expect(loadStatusText(loader.get("a1"))).toBe("failed: not_found: no such thing");
    loader.dispose();
  });

  it("a 503 with another code is still an error", async () => {
    const { loader, calls } = setup();
    loader.update([view]);
    await tick(LOAD_INTERVAL_MS);
    await failCall(calls[0], new ApiRequestError(503, "source_error", "down"));
    expect(loader.get("a1")).toMatchObject({ status: "error", error: "source_error: down" });
    loader.dispose();
  });
});

describe("value loader while the catalog loads", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const request: ValueRequest = { key: "a1:a", signalId: "c/SPEED_DISP", t: "100", mode: "line" };
  const answer: CursorValueResult = {
    signalId: "c/SPEED_DISP",
    t: "100",
    mode: "line",
    value: { kind: "raw", value: 7 },
  };
  interface Pending {
    resolve: (r: CursorValueResult) => void;
    reject: (e: Error) => void;
  }
  function setup() {
    const pending: Pending[] = [];
    const fetch = () =>
      new Promise<CursorValueResult>((resolve, reject) => pending.push({ resolve, reject }));
    const changes = vi.fn();
    return { loader: new ValueLoader(fetch, changes), pending, changes };
  }

  it("catalog_unavailable keeps the request loading with no error, retries and ends complete", async () => {
    const { loader, pending } = setup();
    loader.update([request]);
    expect(pending).toHaveLength(1);
    pending[0]?.reject(loading());
    await tick();
    expect(loader.get("a1:a")).toMatchObject({ status: "loading" });
    expect(loader.get("a1:a")?.error).toBeUndefined();
    expect(loader.settled([request])).toBe(false);

    await tick(1_000);
    expect(pending).toHaveLength(2);
    expect(loader.get("a1:a")?.error).toBeUndefined();
    pending[1]?.resolve(answer);
    await tick();
    expect(loader.get("a1:a")).toMatchObject({ status: "complete", result: answer });
    expect(loader.get("a1:a")?.error).toBeUndefined();
    expect(loader.settled([request])).toBe(true);
    loader.dispose();
  });

  it("keeps retrying while the catalog stays unavailable", async () => {
    const { loader, pending } = setup();
    loader.update([request]);
    for (let n = 1; n <= 3; n++) {
      expect(pending).toHaveLength(n);
      pending[n - 1]?.reject(loading());
      await tick();
      expect(loader.get("a1:a")?.status).toBe("loading");
      await tick(30_000);
    }
    expect(pending).toHaveLength(4);
    pending[3]?.resolve(answer);
    await tick();
    expect(loader.get("a1:a")?.status).toBe("complete");
    loader.dispose();
  });

  it("a 503 with another code and a 404 still fail", async () => {
    for (const error of [
      new ApiRequestError(503, "source_error", "down"),
      new ApiRequestError(404, "unknown_signal", "no such signal"),
    ]) {
      const { loader, pending } = setup();
      loader.update([request]);
      pending[0]?.reject(error);
      await tick();
      expect(loader.get("a1:a")).toMatchObject({
        status: "error",
        error: error.message,
      });
      await tick(120_000);
      expect(pending).toHaveLength(1);
      loader.dispose();
    }
  });

  it("a changed request drops the wait of the old one", async () => {
    const { loader, pending } = setup();
    loader.update([request]);
    pending[0]?.reject(loading());
    await tick();
    loader.update([{ ...request, t: "200" }]);
    expect(pending).toHaveLength(2);
    await tick(60_000);
    expect(pending).toHaveLength(2);
    loader.dispose();
  });
});

describe("render acknowledgement while the catalog loads", () => {
  function setup() {
    const sent: unknown[] = [];
    const ack = new Acknowledger((m) => {
      sent.push(m);
      return true;
    });
    return { ack, sent };
  }

  it("a window that reports only after loading sends complete, never an error before", () => {
    const { ack, sent } = setup();
    ack.setState(4, ["w1"]);
    // The window is still loading (gap info or series pending): it does not report, nothing is sent.
    expect(sent).toEqual([]);
    ack.report("w1", 4, []);
    expect(sent).toEqual([{ type: "rendered", revision: 4, status: "complete", errors: [] }]);
  });

  it("two windows: the revision is acknowledged once, after the later one is ready", () => {
    const { ack, sent } = setup();
    ack.setState(4, ["w1", "w2"]);
    ack.report("w1", 4, []);
    expect(sent).toEqual([]);
    ack.report("w2", 4, []);
    expect(sent).toEqual([{ type: "rendered", revision: 4, status: "complete", errors: [] }]);
  });

  it("acknowledges again as complete when a window's error clears after loading", () => {
    const { ack, sent } = setup();
    ack.setState(4, ["w1"]);
    ack.report("w1", 4, [{ windowId: "w1", message: "boom" }]);
    ack.report("w1", 4, []);
    expect(sent).toEqual([
      {
        type: "rendered",
        revision: 4,
        status: "error",
        errors: [{ windowId: "w1", message: "boom" }],
      },
      { type: "rendered", revision: 4, status: "complete", errors: [] },
    ]);
  });
});
