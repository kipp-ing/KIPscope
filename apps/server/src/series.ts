import {
  type BucketSeries,
  type EdgePoint,
  encodeTimes,
  type RawSeries,
  type SeriesResult,
  type Timestamp,
} from "@letsview/shared";
import type { DataSource, RawPoint, SeriesRef } from "./datasource.ts";

export const MIN_TARGET = 2;
export const MAX_TARGET = 20_000;

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/**
 * Bucket width for [from, to) such that at most `target` grid buckets touch the range: a range of
 * length L meets at most ceil(L / w) + 1 buckets on the grid k * w, and w = ceil(L / (target - 1))
 * keeps that at `target`.
 */
export function bucketWidth(from: Timestamp, to: Timestamp, target: number): bigint {
  return ceilDiv(to - from, BigInt(Math.max(target - 1, 1)));
}

const edge = (p: RawPoint | undefined): EdgePoint | undefined => p && { t: p.t.toString(), v: p.v };

/**
 * Fetches a signal for [from, to) at a resolution of about `target` values (design D4): raw points
 * with edge neighbors if the range holds at most `target` points, aggregated buckets otherwise.
 * SNA points (design S4) count towards `target`; they come back as null values and as per-bucket
 * `sna` counts, and never enter mean, min or max.
 */
export async function querySeries(
  source: DataSource,
  ref: SeriesRef,
  signalId: string,
  from: Timestamp,
  to: Timestamp,
  target: number,
  abort?: AbortSignal,
): Promise<SeriesResult> {
  if (to <= from) throw new RangeError("empty time range: to must be after from");
  const head = { signalId, from: from.toString(), to: to.toString() };
  const count = await source.count(ref, from, to, abort);

  if (count <= target) {
    const [points, before, after] = await Promise.all([
      source.raw(ref, from, to, abort),
      source.before(ref, from, abort),
      source.after(ref, to, abort),
    ]);
    const result: RawSeries = {
      kind: "raw",
      ...head,
      t: encodeTimes(points.map((p) => p.t)),
      v: points.map((p) => p.v),
    };
    const b = edge(before);
    const a = edge(after);
    if (b) result.before = b;
    if (a) result.after = a;
    return result;
  }

  const width = bucketWidth(from, to, target);
  const buckets = await source.buckets(ref, from, to, width, abort);
  const result: BucketSeries = {
    kind: "buckets",
    ...head,
    width: width.toString(),
    t: encodeTimes(buckets.map((b) => b.start)),
    count: buckets.map((b) => b.count),
    sna: buckets.map((b) => b.sna),
    mean: buckets.map((b) => b.mean),
    min: buckets.map((b) => b.min),
    max: buckets.map((b) => b.max),
  };
  return result;
}
