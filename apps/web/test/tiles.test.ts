import {
  type BucketSeries,
  decodeTimes,
  encodeTimes,
  type RawSeries,
  type SeriesResult,
  TIME_MAX,
} from "@kipscope/shared";
import { describe, expect, it } from "vitest";
import {
  aggregateRaw,
  deriveRaw,
  emptyTile,
  levelFor,
  MAX_LEVEL,
  MERGE_DEPTH,
  mergeUp,
  OVERVIEW_TARGET,
  overviewLevel,
  overviewTiles,
  PLACEHOLDER_SEARCH,
  placeholder,
  prefetchPlan,
  runRequest,
  splitRun,
  stitch,
  type Tile,
  tileable,
  tileSpan,
  tileWeight,
  touchedTiles,
} from "../src/chart/tiles.ts";
import { densePoints, type FakePoint, fakeAnswer, fakeBuckets, fakeRaw } from "./fakeSeries.ts";

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

  it("views longer than 2^53 ns are tileable within the time bounds", () => {
    const day = 86_400n * 1_000_000_000n;
    const to = 200n * day;
    expect(to).toBeGreaterThan(2n ** 53n);
    const level = levelFor(0n, to, 2000);
    const { first, last } = touchedTiles(0n, to, level);
    expect(tileable(level, first, last)).toBe(true);
    // A range whose last tile ends after TIME_MAX is not.
    const out = touchedTiles(TIME_MAX - day, TIME_MAX, level);
    expect(out.last * tileSpan(level) + tileSpan(level)).toBeGreaterThan(TIME_MAX);
    expect(tileable(level, out.first, out.last)).toBe(false);
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

describe("zoom-speed constants", () => {
  it("pins the numbers of design Z2, Z3, Z4", () => {
    expect([OVERVIEW_TARGET, MERGE_DEPTH, PLACEHOLDER_SEARCH]).toEqual([1025, 2, 6]);
  });
});

/** Bucket result equals the fake server's: count, sna, min, max exactly, mean within 1e-12 relative. */
function expectBucketsLikeServer(got: SeriesResult, want: BucketSeries) {
  if (got.kind !== "buckets") throw new Error("expected buckets");
  expect([got.from, got.to, got.width]).toEqual([want.from, want.to, want.width]);
  expect(got.t).toEqual(want.t);
  expect(got.count).toEqual(want.count);
  expect(got.sna).toEqual(want.sna);
  expect(got.min).toEqual(want.min);
  expect(got.max).toEqual(want.max);
  expect(got.mean).toHaveLength(want.mean.length);
  want.mean.forEach((w, i) => {
    const m = got.mean[i];
    if (w === null) {
      expect(m).toBeNull();
      return;
    }
    expect(Math.abs((m as number) - w)).toBeLessThanOrEqual(1e-12 * Math.abs(w));
  });
}

describe("merges two child tiles into their parent like the server", () => {
  const tilesOf = (points: FakePoint[], level: number, first: bigint, last: bigint) =>
    splitRun(fakeAnswer(points, runRequest(SIG, level, first, last)), level, first, last);
  const two = (tiles: Tile[], i: number): [Tile, Tile] => {
    const a = tiles[i];
    const b = tiles[i + 1];
    if (!a || !b) throw new Error("no tiles");
    return [a, b];
  };

  // 3,400 points every 300 ns from 50 (up to 1,020,050): values 0.5 … 12.5; every 97th point and
  // the run i = 100 … 110 are SNA (the run empties the buckets in [30,720, 33,792)).
  const dense = densePoints(3400, 300n, 50n, (i) =>
    i % 97 === 0 || (i >= 100 && i <= 110) ? null : ((i * 7) % 13) + 0.5,
  );

  it("buckets: level-10 tiles 0+1 and 2+3 become level-11 tiles 0 and 1", () => {
    const tiles = tilesOf(dense, 10, 0n, 3n);
    expect(tiles[0]?.data.kind).toBe("buckets");
    const want = fakeBuckets(dense, SIG, 0n, 4n * S10, 2048n);
    for (const [i, index] of [
      [0, 0n],
      [2, 1n],
    ] as const) {
      const parent = mergeUp(...two(tiles, i));
      expect([parent.signalId, parent.level, parent.index]).toEqual([SIG, 11, index]);
      const span = 2n * S10;
      expectBucketsLikeServer(
        parent.data,
        fakeBuckets(dense, SIG, index * span, (index + 1n) * span, 2048n),
      );
    }
    // The SNA run really yields a bucket without valid points, so the all-SNA rule is exercised.
    expect(want.count.includes(0)).toBe(true);
    const parent = mergeUp(...two(tiles, 0));
    if (parent.data.kind !== "buckets") throw new Error("expected buckets");
    const k = parent.data.count.indexOf(0);
    expect(k).toBeGreaterThan(-1);
    expect([parent.data.mean[k], parent.data.min[k], parent.data.max[k]]).toEqual([
      null,
      null,
      null,
    ]);
    expect((parent.data.sna[k] ?? 0) > 0).toBe(true);
  });

  it("raw + raw: concatenated points, neighbours from the outer sides", () => {
    // 60 points in tile 0 and tile 1 (some SNA), one point before and one after the pair.
    const sparse: FakePoint[] = [
      { t: -1000n, v: -5 },
      ...densePoints(60, 8000n, 100n, (i) => (i % 11 === 0 ? null : i)),
      { t: 600_000n, v: 99 },
    ];
    const tiles = tilesOf(sparse, 10, 0n, 1n);
    expect(tiles[0]?.data.kind).toBe("raw");
    const parent = mergeUp(...two(tiles, 0));
    expect([parent.level, parent.index]).toEqual([11, 0n]);
    expect(parent.data).toEqual(fakeRaw(sparse, SIG, 0n, 2n * S10));
    if (parent.data.kind !== "raw") throw new Error("expected raw");
    expect(parent.data.before).toEqual({ t: "-1000", v: -5 });
    expect(parent.data.after).toEqual({ t: "600000", v: 99 });
  });

  it("raw + buckets: the raw child is aggregated first", () => {
    // Tile 0 sparse (50 points, raw), tile 1 dense (600 points, buckets of 1024 ns).
    const mixed: FakePoint[] = [
      ...densePoints(50, 5000n, 100n, (i) => (i % 7 === 0 ? null : i)),
      ...densePoints(600, 300n, S10 + 50n, (i) => ((i * 5) % 11) + 0.25),
    ];
    const left = tilesOf(mixed, 10, 0n, 0n);
    const right = tilesOf(mixed, 10, 1n, 1n);
    expect(left[0]?.data.kind).toBe("raw");
    expect(right[0]?.data.kind).toBe("buckets");
    const parent = mergeUp(...two([...left, ...right], 0));
    expectBucketsLikeServer(parent.data, fakeBuckets(mixed, SIG, 0n, 2n * S10, 2048n));
  });
});

describe("finds the finest coarser level for a placeholder", () => {
  // 300 points every 5 × 10^6 ns from 10^6 (up to 1.4960 × 10^9): one level-23 tile (2^31 ns) of buckets.
  const points = densePoints(300, 5_000_000n, 1_000_000n);
  const tile23 = splitRun(fakeAnswer(points, runRequest(SIG, 23, 0n, 0n)), 23, 0n, 0n)[0];
  const to = 1000n * 2n ** 20n; // view [0, 1000 × 2^20) at level 20 touches level-21 tiles 0, 1 and level-23 tile 0

  it("takes level 23 when levels 21 and 22 have nothing", () => {
    if (!tile23) throw new Error("no tile");
    const asked: number[] = [];
    const r = placeholder(0n, to, 20, 26, (level, index) => {
      asked.push(level);
      return level === 23 && index === 0n ? tile23 : undefined;
    });
    expect(asked[0]).toBe(21); // finest first
    expect(r).toEqual(stitch([tile23], 0n, to));
    if (r?.kind !== "buckets") throw new Error("expected buckets");
    expect(r.width).toBe("8388608"); // 2^23
    // 210 points (i = 0 … 209) lie below 1,048,576,000; 125 buckets of 2^23 cover the view.
    expect(r.count.reduce((a, b) => a + b, 0)).toBe(210);
  });

  it("skips a level that provides only some of the touched tiles", () => {
    if (!tile23) throw new Error("no tile");
    const part = splitRun(fakeAnswer(points, runRequest(SIG, 21, 0n, 0n)), 21, 0n, 0n)[0];
    if (!part) throw new Error("no tile");
    const r = placeholder(0n, to, 20, 26, (level, index) =>
      level === 21 ? (index === 0n ? part : undefined) : level === 23 ? tile23 : undefined,
    );
    if (r?.kind !== "buckets") throw new Error("expected buckets");
    expect(r.width).toBe("8388608");
  });

  it("is undefined when no level up to maxLevel is complete", () => {
    expect(placeholder(0n, to, 20, 26, () => undefined)).toBeUndefined();
    expect(placeholder(0n, to, 20, 20, () => tile23)).toBeUndefined(); // nothing coarser to search
  });
});

describe("plans the overview and the prefetch", () => {
  it("overview of 0 … 4294967295 is level 22 over tiles 0 to 3", () => {
    expect(overviewLevel(0n, 4294967295n)).toBe(22); // 2^32 / 1024 = 2^22
    expect(overviewTiles(0n, 4294967295n)).toEqual({ level: 22, first: 0n, last: 3n });
  });

  it("overview of three days is level 37 over 8 tiles", () => {
    const last = 3n * 86_400n * 1_000_000_000n; // 2.592 × 10^14 ns, width ceil(… / 1024) = 253,125,000,000
    expect(overviewLevel(0n, last)).toBe(37); // 2^37 = 137,438,953,472 <= width < 2^38
    expect(overviewTiles(0n, last)).toEqual({ level: 37, first: 0n, last: 7n });
  });

  it("an empty tile is a bucket tile without buckets", () => {
    const t = emptyTile(SIG, 22, 5n);
    expect([t.signalId, t.level, t.index]).toEqual([SIG, 22, 5n]);
    expect(t.data).toMatchObject({
      kind: "buckets",
      signalId: SIG,
      from: "5368709120", // 5 × 2^30
      to: "6442450944", // 6 × 2^30
      width: "4194304",
      count: [],
      sna: [],
      mean: [],
      min: [],
      max: [],
    });
    if (t.data.kind !== "buckets") throw new Error("expected buckets");
    expect(t.data.t).toEqual(encodeTimes([]));
  });

  it("plans the prefetch: next coarser level three views wide, one view each side", () => {
    // View [0, 1000 × 2^20) at level 20: span 1,048,576,000 ns.
    expect(prefetchPlan(0n, 1000n * 2n ** 20n, 20)).toEqual([
      { level: 21, first: -2n, last: 3n }, // [-span, 2 span) over tiles of 2^29 ns
      { level: 20, first: -4n, last: -1n }, // [-span, 0) over tiles of 2^28 ns
      { level: 20, first: 3n, last: 7n }, // [span, 2 span)
    ]);
  });

  it("caps the coarser level at MAX_LEVEL", () => {
    expect(prefetchPlan(0n, 1000n, MAX_LEVEL)[0]?.level).toBe(MAX_LEVEL);
  });
});

describe("text signals keep row text and edge labels through tiles", () => {
  const R = (tile: Tile | undefined) => (tile as Tile).data as RawSeries;
  const TS = "c/Bms.CONTACTOR";
  // Points every 100,000 ns; tile span at level 10 is 262,144 ns: the third point is in tile 1.
  const rawText = (): SeriesResult => ({
    kind: "raw",
    signalId: TS,
    from: "0",
    to: (2n * S10).toString(),
    t: encodeTimes([100_000n, 200_000n, 300_000n, 400_000n]),
    v: [0, 0, 0, 0],
    text: ["open", "precharge", "closed", "closed"],
    before: { t: "-1000", v: 0, label: "open" },
    after: { t: (3n * S10).toString(), v: 0, label: "closed" },
  });

  it("splitRun cuts text with the points and labels the edges", () => {
    const [t0, t1] = splitRun(rawText(), 10, 0n, 1n);
    expect(R(t0).text).toEqual(["open", "precharge"]);
    expect(R(t1).text).toEqual(["closed", "closed"]);
    // Neighbours across the tile border come from the adjacent points, with their text.
    expect(R(t0).after).toEqual({ t: "300000", v: 0, label: "closed" });
    expect(R(t1).before).toEqual({ t: "200000", v: 0, label: "precharge" });
    expect(R(t0).before?.label).toBe("open");
    expect(R(t1).after?.label).toBe("closed");
  });

  it("stitch and mergeUp keep text and labels", () => {
    const tiles = splitRun(rawText(), 10, 0n, 1n);
    const stitched = stitch(tiles, 150_000n, 350_000n) as RawSeries;
    expect(stitched.text).toEqual(["precharge", "closed"]);
    expect(stitched.before).toEqual({ t: "100000", v: 0, label: "open" });
    expect(stitched.after).toEqual({ t: "400000", v: 0, label: "closed" });

    const merged = mergeUp(tiles[0] as Tile, tiles[1] as Tile).data as RawSeries;
    expect(merged.text).toEqual(["open", "precharge", "closed", "closed"]);
    expect(merged.before?.label).toBe("open");
    expect(merged.after?.label).toBe("closed");
  });

  it("a numeric series gains no text", () => {
    const tiles = splitRun(fakeAnswer([{ t: 5n, v: 1 }], runRequest(SIG, 10, 0n, 1n)), 10, 0n, 1n);
    expect(R(tiles[0]).text).toBeUndefined();
  });
});
