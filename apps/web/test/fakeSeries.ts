import {
  type BucketSeries,
  type EdgePoint,
  encodeTimes,
  floorDiv,
  type RawSeries,
  type SeriesResult,
} from "@letsview/shared";
import type { SeriesRequest } from "../src/chart/tiles.ts";

/** One stored point of a fake signal; `v` null is an SNA point. */
export interface FakePoint {
  t: bigint;
  v: number | null;
}

const inRange = (points: readonly FakePoint[], from: bigint, to: bigint) =>
  points
    .filter((p) => p.t >= from && p.t < to)
    .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));

const edge = (p: FakePoint | undefined): EdgePoint | undefined =>
  p && { t: p.t.toString(), v: p.v };

/** Raw answer of the series-query rules: points inside [from, to) plus the nearest points outside. */
export function fakeRaw(
  points: readonly FakePoint[],
  signalId: string,
  from: bigint,
  to: bigint,
): RawSeries {
  const inside = inRange(points, from, to);
  const sorted = [...points].sort((a, b) => (a.t < b.t ? -1 : 1));
  const before = sorted.filter((p) => p.t < from).at(-1);
  const after = sorted.find((p) => p.t >= to);
  const result: RawSeries = {
    kind: "raw",
    signalId,
    from: from.toString(),
    to: to.toString(),
    t: encodeTimes(inside.map((p) => p.t)),
    v: inside.map((p) => p.v),
  };
  const b = edge(before);
  const a = edge(after);
  if (b) result.before = b;
  if (a) result.after = a;
  return result;
}

/** Non-empty buckets of `width` on the grid k × width; only points inside [from, to) count. */
export function fakeBuckets(
  points: readonly FakePoint[],
  signalId: string,
  from: bigint,
  to: bigint,
  width: bigint,
): BucketSeries {
  const groups = new Map<bigint, FakePoint[]>();
  for (const p of inRange(points, from, to)) {
    const start = floorDiv(p.t, width) * width;
    groups.set(start, [...(groups.get(start) ?? []), p]);
  }
  const starts = [...groups.keys()].sort((a, b) => (a < b ? -1 : 1));
  const valid = (start: bigint) =>
    (groups.get(start) ?? []).flatMap((p) => (p.v === null ? [] : [p.v]));
  const stat = (start: bigint, f: (xs: number[]) => number) => {
    const xs = valid(start);
    return xs.length === 0 ? null : f(xs);
  };
  return {
    kind: "buckets",
    signalId,
    from: from.toString(),
    to: to.toString(),
    width: width.toString(),
    t: encodeTimes(starts),
    count: starts.map((s) => valid(s).length),
    sna: starts.map((s) => (groups.get(s) ?? []).length - valid(s).length),
    mean: starts.map((s) => stat(s, (xs) => xs.reduce((a, b) => a + b, 0) / xs.length)),
    min: starts.map((s) => stat(s, (xs) => Math.min(...xs))),
    max: starts.map((s) => stat(s, (xs) => Math.max(...xs))),
  };
}

/**
 * The series server in memory: raw (with `before`/`after`) when the range holds at most `target`
 * points, else buckets of width ceil((to − from) / (target − 1)) on the grid k × width.
 */
export function fakeAnswer(points: readonly FakePoint[], r: SeriesRequest): SeriesResult {
  const from = BigInt(r.from);
  const to = BigInt(r.to);
  if (inRange(points, from, to).length <= r.target) return fakeRaw(points, r.signalId, from, to);
  const n = BigInt(Math.max(r.target - 1, 1));
  const width = (to - from + n - 1n) / n;
  return fakeBuckets(points, r.signalId, from, to, width);
}

/** A request the fake fetch received; its response is resolved by hand. */
export interface FakeCall {
  request: SeriesRequest;
  abort: AbortSignal;
  /** Resolves with the fake server's answer (or the given result). */
  answer: (result?: SeriesResult) => void;
  fail: (error: Error) => void;
}

/** Counting fetch over a fake signal; `calls.length` is the number of requests sent. */
export function fakeFetch(points: readonly FakePoint[]) {
  const calls: FakeCall[] = [];
  const fetch = (request: SeriesRequest, abort: AbortSignal) =>
    new Promise<SeriesResult>((resolve, reject) => {
      calls.push({
        request,
        abort,
        answer: (result) => resolve(result ?? fakeAnswer(points, request)),
        fail: reject,
      });
    });
  return { fetch, calls };
}

/** Lets pending promise callbacks run. */
export const flush = () => new Promise<void>((r) => setTimeout(r, 0));
