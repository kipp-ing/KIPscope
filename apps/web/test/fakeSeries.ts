import {
  type BucketSeries,
  type EdgePoint,
  encodeTimes,
  floorDiv,
  type RawSeries,
  type SeriesResult,
} from "@kipscope/shared";
import { expect } from "vitest";
import type { SeriesRequest, Tile } from "../src/chart/tiles.ts";

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

/** `count` points at start + step × i, value `value(i)` (null = SNA); a dense signal for bucket answers. */
export function densePoints(
  count: number,
  step: bigint,
  start = 0n,
  value: (i: number) => number | null = (i) => i,
): FakePoint[] {
  return Array.from({ length: count }, (_, i) => ({ t: start + step * BigInt(i), v: value(i) }));
}

/** A fake signal and the extent a test gives it (decimal ns, as `Extent.first`/`Extent.last`). */
export interface Fixture {
  points: FakePoint[];
  first: string;
  last: string;
}

/** 4,295 points every 10^6 ns from 500: extent 0 … 4294967295 → overview level 22, tiles 0…3 (design W9). */
export const DENSE_FIXTURE: Fixture = {
  points: densePoints(4295, 1_000_000n, 500n),
  first: "0",
  last: "4294967295",
};

/**
 * 1,000 points at t = 4,294,967 × i, value i, every 7th (i % 7 = 6) SNA: extent 0 … 4290672033 →
 * overview level 21, tiles 0…7, raw overview (1,000 ≤ 2,049) (design W9).
 */
export const SPARSE_FIXTURE: Fixture = {
  points: densePoints(1000, 4_294_967n, 0n, (i) => (i % 7 === 6 ? null : i)),
  first: "0",
  last: "4290672033",
};

/** DENSE + 2^29 ns: extent 536870912 … 4831838207 → overview level 22, tiles 0…4 (design W9). */
export const SHIFTED_FIXTURE: Fixture = {
  points: densePoints(4295, 1_000_000n, 500n + 2n ** 29n),
  first: "536870912",
  last: "4831838207",
};

/**
 * DENSE ∪ (DENSE + 2^33 ns): extent 0 … 4294967295, after a step `second` (design W9). The extent
 * a test sets after `rescope()` is `{ first, last }` of `second`.
 */
export const STEP_FIXTURE: Fixture & { second: { first: string; last: string } } = {
  points: [
    ...densePoints(4295, 1_000_000n, 500n),
    ...densePoints(4295, 1_000_000n, 500n + 2n ** 33n),
  ],
  first: "0",
  last: "4294967295",
  second: { first: "8589934592", last: "12884901887" },
};

const RELATIVE_MEAN = 1e-12;

/**
 * Two results are the same drawn data: raw exactly (points, text, edge neighbours), buckets with
 * `count`, `sna`, `min`, `max` exactly and `mean` within 1e-12 relative (float summation order).
 */
export function expectSameSeries(
  actual: SeriesResult | undefined,
  expected: SeriesResult | undefined,
  label = "series",
): void {
  expect(actual, `${label}: result present`).toBeDefined();
  expect(expected, `${label}: expected present`).toBeDefined();
  if (!actual || !expected) return;
  expect(actual.kind, `${label}: kind`).toBe(expected.kind);
  if (actual.kind !== "buckets" || expected.kind !== "buckets") {
    expect(actual, label).toEqual(expected);
    return;
  }
  const { mean: actualMean, ...actualRest } = actual;
  const { mean: expectedMean, ...expectedRest } = expected;
  expect(actualRest, label).toEqual(expectedRest);
  expect(actualMean.length, `${label}: bucket count`).toBe(expectedMean.length);
  actualMean.forEach((m, i) => {
    const e = expectedMean[i] ?? null;
    if (m === null || e === null) {
      expect(m, `${label}: mean ${i}`).toBe(e);
      return;
    }
    const close = Math.abs(m - e) <= RELATIVE_MEAN * Math.max(Math.abs(m), Math.abs(e));
    expect(close, `${label}: mean ${i} is ${m}, expected ${e}`).toBe(true);
  });
}

/** Two tile lists hold the same tiles (same IDs, `expectSameSeries` per tile). */
export function expectSameTiles(
  actual: readonly Tile[],
  expected: readonly Tile[],
  label = "tiles",
) {
  expect(
    actual.map((t) => `${t.signalId}|${t.level}|${t.index}`),
    `${label}: tile IDs`,
  ).toEqual(expected.map((t) => `${t.signalId}|${t.level}|${t.index}`));
  expected.forEach((tile, i) => {
    expectSameSeries(actual[i]?.data, tile.data, `${label}: tile ${tile.index}`);
  });
}
