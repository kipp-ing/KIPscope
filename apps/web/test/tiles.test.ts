import { decodeTimes, TIME_MAX } from "@letsview/shared";
import { describe, expect, it } from "vitest";
import {
  aggregateRaw,
  deriveRaw,
  levelFor,
  runRequest,
  splitRun,
  stitch,
  tileable,
  tileSpan,
  tileWeight,
  touchedTiles,
} from "../src/chart/tiles.ts";
import { type FakePoint, fakeAnswer, fakeBuckets, fakeRaw } from "./fakeSeries.ts";

const SIG = "c/s";
const S10 = 262144n; // tile span at level 10: 256 × 1024 ns

describe("picks the power-of-two width and the touched tiles", () => {
  it("1000 × 2^20 ns at target 1001 is level 20 over tiles 0 to 3", () => {
    const to = 1000n * 2n ** 20n;
    const level = levelFor(0n, to, 1001);
    expect(level).toBe(20);
    expect(tileSpan(level)).toBe(2n ** 28n);
    expect(touchedTiles(0n, to, level)).toEqual({ first: 0n, last: 3n });
    expect(runRequest(SIG, level, 0n, 3n)).toEqual({
      signalId: SIG,
      from: "0",
      to: "1073741824",
      target: 1025,
    });
  });

  it("ten hours at target 2000 is level 34, not coarser than today", () => {
    const ten = 10n * 3600n * 1_000_000_000n;
    expect(levelFor(0n, ten, 2000)).toBe(34); // 2^34 = 17,179,869,184 <= 18,009,004,503
  });

  it("3 × 2^20 ns at target 2 is level 21", () => {
    expect(levelFor(0n, 3n * 2n ** 20n, 2)).toBe(21); // 2^21 <= 3 × 2^20 < 2^22
  });

  it("floors a negative from to the lower tile", () => {
    expect(touchedTiles(-1n, 1n, 0)).toEqual({ first: -1n, last: 0n }); // span 256
  });

  it("is not tileable beyond TIME_MAX", () => {
    expect(tileable(20, 0n, 3n)).toBe(true);
    expect(tileable(20, TIME_MAX / tileSpan(20), TIME_MAX / tileSpan(20))).toBe(false);
  });
});

describe("stitches raw tiles like one request", () => {
  // Points every 1000 ns from 500 up to 699,500; the 301st (t = 300,500) is SNA; one far point
  // before and one after the run so the outer tiles have neighbours.
  const points: FakePoint[] = [
    { t: -500n, v: -1 },
    ...Array.from({ length: 700 }, (_, i) => ({
      t: 500n + 1000n * BigInt(i),
      v: i === 300 ? null : i,
    })),
    { t: 800_500n, v: 800 },
  ];
  const run = fakeAnswer(points, runRequest(SIG, 10, 0n, 2n));
  const tiles = splitRun(run, 10, 0n, 2n);

  it("splits the run into three raw tiles", () => {
    expect(run.kind).toBe("raw");
    expect(tiles.map((t) => [t.level, t.index])).toEqual([
      [10, 0n],
      [10, 1n],
      [10, 2n],
    ]);
    expect(tiles.map((t) => t.data.from)).toEqual(["0", "262144", "524288"]);
  });

  it("a view inside the tiles equals the server's answer", () => {
    const r = stitch(tiles, 250_000n, 600_000n);
    expect(r).toEqual(fakeRaw(points, SIG, 250_000n, 600_000n));
    if (r.kind !== "raw") throw new Error("expected raw");
    // Hand-computed: points i = 250 … 599, the SNA point i = 300 at index 50.
    expect(r.v).toHaveLength(350);
    expect(r.v[50]).toBeNull();
    expect(r.v[0]).toBe(250);
    expect(decodeTimes(r.t)[0]).toBe(250_500n);
    expect(r.before).toEqual({ t: "249500", v: 249 });
    expect(r.after).toEqual({ t: "600500", v: 600 });
  });

  it("a view covering the run takes the outer tiles' neighbours", () => {
    const r = stitch(tiles, 0n, 3n * S10);
    expect(r).toEqual(fakeRaw(points, SIG, 0n, 3n * S10));
    if (r.kind !== "raw") throw new Error("expected raw");
    expect(r.before).toEqual({ t: "-500", v: -1 });
    expect(r.after).toEqual({ t: "800500", v: 800 });
  });
});

describe("derives a finer raw tile with its edge neighbours", () => {
  const spec = (name: string, points: FakePoint[], level: number, index: bigint) =>
    it(name, () => {
      const parent = splitRun(fakeAnswer(points, runRequest(SIG, 12, 0n, 0n)), 12, 0n, 0n)[0];
      if (!parent) throw new Error("no parent");
      expect(parent.data.kind).toBe("raw");
      const span = tileSpan(level);
      const derived = deriveRaw(parent, level, index);
      expect(derived.level).toBe(level);
      expect(derived.index).toBe(index);
      expect(derived.data).toEqual(fakeRaw(points, SIG, index * span, (index + 1n) * span));
    });

  // Level 12 tile 0 is [0, 1,048,576); level 10 tile 2 is [524,288, 786,432).
  const dense: FakePoint[] = [
    { t: -3000n, v: -1 },
    ...Array.from({ length: 200 }, (_, i) => ({ t: 1000n + 5000n * BigInt(i), v: i })),
    { t: 2_000_000n, v: 999 },
  ];
  spec("level-10 tile inside a level-12 tile", dense, 10, 2n);
  spec("level-10 tile at the parent's start", dense, 10, 0n);
  spec(
    "level-10 tile with no point inside",
    [
      { t: 1000n, v: 1 },
      { t: 900_000n, v: 2 },
    ],
    10,
    1n,
  );
});

describe("aggregates raw tiles to buckets in a mixed view", () => {
  // Tile 0 is dense (buckets of 1024 ns), tile 1 sparse (raw): 200 points at 262,644 + 1000 × i,
  // the one at i = 100 (t = 362,644) SNA and alone in its bucket [362,496, 363,520).
  const points: FakePoint[] = [
    ...Array.from({ length: 2621 }, (_, i) => ({ t: 50n + 100n * BigInt(i), v: i % 50 })),
    ...Array.from({ length: 200 }, (_, i) => ({
      t: S10 + 500n + 1000n * BigInt(i),
      v: i === 100 ? null : i,
    })),
  ];
  const answer0 = fakeAnswer(points, runRequest(SIG, 10, 0n, 0n));
  const answer1 = fakeAnswer(points, runRequest(SIG, 10, 1n, 1n));
  const tiles = [...splitRun(answer0, 10, 0n, 0n), ...splitRun(answer1, 10, 1n, 1n)];

  it("stitches buckets of the view's width on the snapped range", () => {
    expect(answer0.kind).toBe("buckets");
    expect(answer1.kind).toBe("raw");
    const r = stitch(tiles, 100_000n, 400_000n);
    if (r.kind !== "buckets") throw new Error("expected buckets");
    expect(r.width).toBe("1024");
    expect(r.from).toBe("99328"); // floor(100,000 / 1024) × 1024
    expect(r.to).toBe("400384"); // ceil(400,000 / 1024) × 1024
    const all = fakeBuckets(points, SIG, 0n, 2n * S10, 1024n);
    const starts = decodeTimes(all.t);
    const keep = starts.flatMap((s, i) => (s + 1024n > 100_000n && s < 400_000n ? [i] : []));
    const pick = <T>(xs: T[]) => keep.map((i) => xs[i] as T);
    expect(decodeTimes(r.t)).toEqual(keep.map((i) => starts[i]));
    expect(r.count).toEqual(pick(all.count));
    expect(r.sna).toEqual(pick(all.sna));
    expect(r.mean).toEqual(pick(all.mean));
    expect(r.min).toEqual(pick(all.min));
    expect(r.max).toEqual(pick(all.max));
  });

  it("an all-SNA bucket has no mean, min and max", () => {
    const r = stitch(tiles, 100_000n, 400_000n);
    if (r.kind !== "buckets") throw new Error("expected buckets");
    const i = decodeTimes(r.t).indexOf(362_496n);
    expect(i).toBeGreaterThan(-1);
    expect([r.count[i], r.sna[i], r.mean[i], r.min[i], r.max[i]]).toEqual([0, 1, null, null, null]);
  });

  it("aggregateRaw of the raw tile equals the server's buckets for its range", () => {
    const raw = tiles[1];
    if (!raw) throw new Error("no tile");
    const b = aggregateRaw(raw);
    expect(b.data).toMatchObject({ kind: "buckets", width: "1024" });
    const want = fakeBuckets(points, SIG, S10, 2n * S10, 1024n);
    expect(b.data).toMatchObject({
      t: want.t,
      count: want.count,
      sna: want.sna,
      mean: want.mean,
      min: want.min,
      max: want.max,
    });
  });
});

describe("tile weight", () => {
  it("counts 16 per tile, 2 per raw point and neighbour, 6 per bucket", () => {
    const points: FakePoint[] = [
      { t: 100n, v: 1 },
      { t: 356n, v: 2 },
      { t: 612n, v: 3 },
    ];
    // Level 0 tile 1 = [256, 512): one point, neighbours 100 and 612 → 16 + 2 × 3.
    const raw = splitRun(fakeAnswer(points, runRequest(SIG, 0, 1n, 1n)), 0, 1n, 1n)[0];
    if (!raw) throw new Error("no tile");
    expect(tileWeight(raw)).toBe(22);
    // Level 1 tile 0 = [0, 512) holds 512 points > 257: 256 buckets of width 2 → 16 + 6 × 256.
    const dense: FakePoint[] = Array.from({ length: 512 }, (_, i) => ({ t: BigInt(i), v: i }));
    const bucketTile = splitRun(fakeAnswer(dense, runRequest(SIG, 1, 0n, 0n)), 1, 0n, 0n)[0];
    if (!bucketTile) throw new Error("no tile");
    expect(bucketTile.data.kind).toBe("buckets");
    expect(tileWeight(bucketTile)).toBe(1552);
  });
});
