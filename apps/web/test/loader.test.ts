import { encodeTimes, type RawSeries } from "@letsview/shared";
import { describe, expect, it } from "vitest";
import { type LoadRequest, SeriesLoader } from "../src/chart/loader.ts";

/** Fetch stub whose responses are resolved by hand, in any order. */
function controllableFetch() {
  const pending: {
    request: LoadRequest;
    abort: AbortSignal;
    resolve: (r: RawSeries) => void;
    reject: (e: unknown) => void;
  }[] = [];
  const fetch = (request: LoadRequest, abort: AbortSignal) =>
    new Promise<RawSeries>((resolve, reject) => pending.push({ request, abort, resolve, reject }));
  return { fetch, pending };
}

const result = (from: string): RawSeries => ({
  kind: "raw",
  signalId: "c/s",
  from,
  to: "x",
  t: encodeTimes([]),
  v: [],
});

const req = (from: string, key = "a1"): LoadRequest => ({
  key,
  signalId: "c/s",
  from,
  to: "1000",
  target: 100,
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("SeriesLoader", () => {
  it("ignores a response that arrives after a newer request's response", async () => {
    const { fetch, pending } = controllableFetch();
    const loader = new SeriesLoader(fetch, () => {});
    loader.update([req("1")]);
    loader.update([req("2")]);
    expect(pending[0]?.abort.aborted).toBe(true);
    pending[1]?.resolve(result("2"));
    await flush();
    pending[0]?.resolve(result("1")); // late answer for the old zoom
    await flush();
    expect(loader.get("a1")).toMatchObject({ status: "complete", result: { from: "2" } });
  });

  it("keeps showing the previous data while the next range loads", async () => {
    const { fetch, pending } = controllableFetch();
    const loader = new SeriesLoader(fetch, () => {});
    loader.update([req("1")]);
    pending[0]?.resolve(result("1"));
    await flush();
    loader.update([req("2")]);
    expect(loader.get("a1")).toMatchObject({ status: "loading", result: { from: "1" } });
  });

  it("marks a failed signal and leaves the others alone", async () => {
    const { fetch, pending } = controllableFetch();
    const loader = new SeriesLoader(fetch, () => {});
    const requests = [req("1", "a1"), req("1", "a2")];
    loader.update(requests);
    pending[0]?.reject(new Error("source_error: timeout"));
    pending[1]?.resolve(result("1"));
    await flush();
    expect(loader.get("a1")).toEqual({
      status: "error",
      request: "c/s|1|1000|100",
      error: "source_error: timeout",
    });
    expect(loader.get("a2")?.status).toBe("complete");
    expect(loader.settled(requests)).toBe(true);
  });

  it("does not refetch an unchanged request and aborts removed signals", async () => {
    const { fetch, pending } = controllableFetch();
    let changes = 0;
    const loader = new SeriesLoader(fetch, () => changes++);
    loader.update([req("1", "a1"), req("1", "a2")]);
    loader.update([req("1", "a1"), req("1", "a2")]);
    expect(pending).toHaveLength(2);
    expect(changes).toBe(1);
    loader.update([req("1", "a1")]);
    expect(pending[1]?.abort.aborted).toBe(true);
    expect(loader.get("a2")).toBeUndefined();
  });

  it("is settled only when every current request has finished", async () => {
    const { fetch, pending } = controllableFetch();
    const loader = new SeriesLoader(fetch, () => {});
    loader.update([req("1")]);
    expect(loader.settled([req("1")])).toBe(false);
    pending[0]?.resolve(result("1"));
    await flush();
    expect(loader.settled([req("1")])).toBe(true);
    expect(loader.settled([req("2")])).toBe(false);
  });
});
