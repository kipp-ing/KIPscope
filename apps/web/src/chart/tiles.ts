import {
  type BucketSeries,
  decodeTimes,
  type EdgePoint,
  encodeTimes,
  floorDiv,
  type RawSeries,
  type SeriesResult,
  TIME_MAX,
  TIME_MIN,
  type Timestamp,
} from "@letsview/shared";

export const TILE_BUCKETS = 256;
export const MAX_RUN_TILES = 64;
export const MAX_LEVEL = 62;
export const FRESH_MARGIN_NS = 3_600_000_000_000n; // 1 h (C6)
export const TILE_OVERHEAD = 16; // weight units per tile (C5)
export const RAW_POINT_WEIGHT = 2;
export const BUCKET_WEIGHT = 6;

/** Largest span one result may cover: `encodeTimes` offsets are exact below 2^53 ns. */
const MAX_SPAN = 2n ** 53n;

/** One series request; LoadRequest (loader.ts) extends it with `key`. */
export interface SeriesRequest {
  signalId: string;
  from: string; // decimal ns
  to: string;
  target: number;
}

export interface Tile {
  signalId: string;
  level: number;
  index: bigint;
  /**
   * from/to = the tile's bounds (decimal ns). Raw: the points inside, `before`/`after` the nearest
   * points outside the tile (absent when none exists). Buckets: width 2^level, complete buckets only.
   */
  data: SeriesResult;
}

export const tileId = (signalId: string, level: number, index: bigint) =>
  `${signalId}|${level}|${index}`;

export function bucketWidthOf(level: number): bigint {
  return 2n ** BigInt(level);
}

export function tileSpan(level: number): bigint {
  return BigInt(TILE_BUCKETS) * bucketWidthOf(level);
}

const ceilDiv = (a: bigint, b: bigint) => -floorDiv(-a, b);

/**
 * The largest level whose width 2^k is at or below today's width ceil((to − from) / (target − 1)),
 * at least 0 (C1, D-038: snap down, never coarser than without the cache).
 */
export function levelFor(from: bigint, to: bigint, target: number): number {
  const width = ceilDiv(to - from, BigInt(Math.max(target - 1, 1)));
  if (width <= 1n) return 0;
  return Math.min(width.toString(2).length - 1, MAX_LEVEL);
}

export function touchedTiles(
  from: bigint,
  to: bigint,
  level: number,
): { first: bigint; last: bigint } {
  const span = tileSpan(level);
  return { first: floorDiv(from, span), last: floorDiv(to - 1n, span) };
}

/** False → fallback to an exact, uncached request (time bounds or 2^53 ns span). */
export function tileable(level: number, first: bigint, last: bigint): boolean {
  const span = tileSpan(level);
  const start = first * span;
  const end = (last + 1n) * span;
  return start >= TIME_MIN && end <= TIME_MAX && end - start <= MAX_SPAN;
}

/** The request for one run (last − first + 1 ≤ MAX_RUN_TILES; the cache splits longer ones). */
export function runRequest(
  signalId: string,
  level: number,
  first: bigint,
  last: bigint,
): SeriesRequest {
  const span = tileSpan(level);
  return {
    signalId,
    from: (first * span).toString(),
    to: ((last + 1n) * span).toString(),
    target: Number(last - first + 1n) * TILE_BUCKETS + 1,
  };
}

interface Point {
  t: Timestamp;
  v: number | null;
}

const rawPoints = (data: RawSeries): Point[] =>
  decodeTimes(data.t).map((t, i) => ({ t, v: data.v[i] ?? null }));

const edge = (p: Point): EdgePoint => ({ t: p.t.toString(), v: p.v });

/** First index whose time is at or after `t` (points in time order). */
function lowerBound(points: readonly Point[], t: Timestamp): number {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((points[mid] as Point).t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Raw series for [from, to) from points in time order: the points inside, `before` the last point
 * before `from` (else `outerBefore`), `after` the first point at or after `to` (else `outerAfter`).
 */
function cutRaw(
  signalId: string,
  points: readonly Point[],
  from: Timestamp,
  to: Timestamp,
  outerBefore: EdgePoint | undefined,
  outerAfter: EdgePoint | undefined,
): RawSeries {
  const lo = lowerBound(points, from);
  const hi = lowerBound(points, to);
  const inside = points.slice(lo, hi);
  const result: RawSeries = {
    kind: "raw",
    signalId,
    from: from.toString(),
    to: to.toString(),
    t: encodeTimes(inside.map((p) => p.t)),
    v: inside.map((p) => p.v),
  };
  const before = lo > 0 ? edge(points[lo - 1] as Point) : outerBefore;
  const after = hi < points.length ? edge(points[hi] as Point) : outerAfter;
  if (before) result.before = before;
  if (after) result.after = after;
  return result;
}

interface Bucket {
  start: Timestamp;
  count: number;
  sna: number;
  mean: number | null;
  min: number | null;
  max: number | null;
}

const buckets = (data: BucketSeries): Bucket[] =>
  decodeTimes(data.t).map((start, i) => ({
    start,
    count: data.count[i] ?? 0,
    sna: data.sna[i] ?? 0,
    mean: data.mean[i] ?? null,
    min: data.min[i] ?? null,
    max: data.max[i] ?? null,
  }));

function bucketSeries(
  signalId: string,
  from: Timestamp,
  to: Timestamp,
  width: bigint,
  list: readonly Bucket[],
): BucketSeries {
  return {
    kind: "buckets",
    signalId,
    from: from.toString(),
    to: to.toString(),
    width: width.toString(),
    t: encodeTimes(list.map((b) => b.start)),
    count: list.map((b) => b.count),
    sna: list.map((b) => b.sna),
    mean: list.map((b) => b.mean),
    min: list.map((b) => b.min),
    max: list.map((b) => b.max),
  };
}

/** Splits a run's response into its tiles (raw neighbours per tile from adjacent points or the run's). */
export function splitRun(result: SeriesResult, level: number, first: bigint, last: bigint): Tile[] {
  const span = tileSpan(level);
  const tiles: Tile[] = [];
  if (result.kind === "raw") {
    const points = rawPoints(result);
    for (let index = first; index <= last; index++) {
      const data = cutRaw(
        result.signalId,
        points,
        index * span,
        (index + 1n) * span,
        result.before,
        result.after,
      );
      tiles.push({ signalId: result.signalId, level, index, data });
    }
    return tiles;
  }
  const width = bucketWidthOf(level);
  if (BigInt(result.width) !== width) {
    throw new RangeError(`run answered with width ${result.width}, expected ${width}`);
  }
  const all = buckets(result);
  let i = 0;
  for (let index = first; index <= last; index++) {
    const end = (index + 1n) * span;
    const start = i;
    while (i < all.length && (all[i] as Bucket).start < end) i++;
    const data = bucketSeries(result.signalId, index * span, end, width, all.slice(start, i));
    tiles.push({ signalId: result.signalId, level, index, data });
  }
  return tiles;
}

/** A finer raw tile cut from a coarser raw tile that contains it (C3). */
export function deriveRaw(parent: Tile, level: number, index: bigint): Tile {
  if (parent.data.kind !== "raw") throw new RangeError("only a raw tile serves finer levels");
  const span = tileSpan(level);
  const data = cutRaw(
    parent.signalId,
    rawPoints(parent.data),
    index * span,
    (index + 1n) * span,
    parent.data.before,
    parent.data.after,
  );
  return { signalId: parent.signalId, level, index, data };
}

/** Points in time order → non-empty buckets of `width` (series-query rules: SNA kept out of mean/min/max). */
function aggregate(points: readonly Point[], width: bigint): Bucket[] {
  const list: Bucket[] = [];
  let current: (Bucket & { sum: number }) | undefined;
  const close = () => {
    if (!current) return;
    const { sum, ...bucket } = current;
    list.push({ ...bucket, mean: bucket.count > 0 ? sum / bucket.count : null });
  };
  for (const p of points) {
    const start = floorDiv(p.t, width) * width;
    if (!current || current.start !== start) {
      close();
      current = { start, count: 0, sna: 0, mean: null, min: null, max: null, sum: 0 };
    }
    if (p.v === null) {
      current.sna++;
      continue;
    }
    current.count++;
    current.sum += p.v;
    current.min = current.min === null ? p.v : Math.min(current.min, p.v);
    current.max = current.max === null ? p.v : Math.max(current.max, p.v);
  }
  close();
  return list;
}

/** Raw tile → bucket tile of its own level (series-query bucket rules, SNA = null kept out of mean/min/max). */
export function aggregateRaw(tile: Tile): Tile {
  if (tile.data.kind !== "raw") return tile;
  const width = bucketWidthOf(tile.level);
  const data = bucketSeries(
    tile.signalId,
    BigInt(tile.data.from),
    BigInt(tile.data.to),
    width,
    aggregate(rawPoints(tile.data), width),
  );
  return { ...tile, data };
}

/** View result from its touched tiles in index order (C4). */
export function stitch(tiles: readonly Tile[], from: bigint, to: bigint): SeriesResult {
  const head = tiles[0];
  if (!head) throw new RangeError("stitch needs at least one tile");
  const raws: RawSeries[] = [];
  for (const tile of tiles) if (tile.data.kind === "raw") raws.push(tile.data);
  if (raws.length === tiles.length) {
    const points = raws.flatMap(rawPoints);
    return cutRaw(head.signalId, points, from, to, raws[0]?.before, raws[raws.length - 1]?.after);
  }
  const width = bucketWidthOf(head.level);
  const list = tiles
    .flatMap((tile) => buckets(aggregateRaw(tile).data as BucketSeries))
    .filter((b) => b.start + width > from && b.start < to);
  return bucketSeries(
    head.signalId,
    floorDiv(from, width) * width,
    ceilDiv(to, width) * width,
    width,
    list,
  );
}

export function tileWeight(tile: Tile): number {
  const data = tile.data;
  if (data.kind === "raw") {
    const neighbours = (data.before ? 1 : 0) + (data.after ? 1 : 0);
    return TILE_OVERHEAD + RAW_POINT_WEIGHT * (data.v.length + neighbours);
  }
  return TILE_OVERHEAD + BUCKET_WEIGHT * data.count.length;
}
