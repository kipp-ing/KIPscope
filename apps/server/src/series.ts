import {
  type BucketSeries,
  type EdgePoint,
  encodeTimes,
  type RawSeries,
  type SeriesResult,
  type Timestamp,
} from "@kipscope/shared";
import type { DataSource, RawPoint, Scope, SeriesRef } from "./datasource.ts";

export const MIN_TARGET = 2;
export const MAX_TARGET = 20_000;

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/**
 * Largest bucket width (design H2): it and every bucket start `t - pmod(t, w)` fit in int64 for
 * any range within the time bounds, and such a range touches at most 3 buckets.
 */
export const MAX_BUCKET_WIDTH = 2n ** 62n;

/**
 * Bucket width for [from, to) such that at most `target` grid buckets touch the range: a range of
 * length L meets at most ceil(L / w) + 1 buckets on the grid k * w, and w = ceil(L / (target - 1))
 * keeps that at `target`. Capped at MAX_BUCKET_WIDTH.
 */
export function bucketWidth(from: Timestamp, to: Timestamp, target: number): bigint {
  const width = ceilDiv(to - from, BigInt(Math.max(target - 1, 1)));
  return width < MAX_BUCKET_WIDTH ? width : MAX_BUCKET_WIDTH;
}

/** State name of a text signal's point (add-events N2): its row text; none for SNA or empty text. */
export const textLabel = (p: RawPoint): string | undefined =>
  p.v !== null && p.text ? p.text : undefined;

/** Edge point; a text signal's carries the row text as `label` (add-events N3). */
export function edgePoint(p: RawPoint, text: boolean): EdgePoint {
  const point: EdgePoint = { t: p.t.toString(), v: p.v };
  const label = text ? textLabel(p) : undefined;
  if (label !== undefined) point.label = label;
  return point;
}

/**
 * Fetches a signal for [from, to) at a resolution of about `target` values (design D4): raw points
 * with edge neighbors if the range holds at most `target` points, aggregated buckets otherwise.
 * SNA points (design S4) count towards `target`; they come back as null values and as per-bucket
 * `sna` counts, and never enter mean, min or max. Raw series of a text signal (`ref.text`) carry
 * each point's text (add-events N3); buckets are unchanged. With a scope (add-scope Z10), whose
 * data ref is `ref`'s and which holds [from, to), the edge neighbours stay inside it. `span` is the
 * length of the range asked for before it was cut to the scope: the bucket width follows it, so a
 * cut range keeps the grid the caller asked for.
 */
export async function querySeries(
  source: DataSource,
  ref: SeriesRef,
  signalId: string,
  from: Timestamp,
  to: Timestamp,
  target: number,
  scope?: Scope,
  abort?: AbortSignal,
  span: bigint = to - from,
): Promise<SeriesResult> {
  if (to <= from) throw new RangeError("empty time range: to must be after from");
  const head = { signalId, from: from.toString(), to: to.toString() };
  const count = await source.count(ref, from, to, abort);

  if (count <= target) {
    const [points, before, after] = await Promise.all([
      source.raw(ref, from, to, undefined, abort),
      source.before(ref, from, scope, abort),
      source.after(ref, to, scope, abort),
    ]);
    const result: RawSeries = {
      kind: "raw",
      ...head,
      t: encodeTimes(points.map((p) => p.t)),
      v: points.map((p) => p.v),
    };
    const text = ref.text === true;
    if (text) result.text = points.map((p) => p.text ?? "");
    if (before) result.before = edgePoint(before, text);
    if (after) result.after = edgePoint(after, text);
    return result;
  }

  const width = bucketWidth(0n, span, target);
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
