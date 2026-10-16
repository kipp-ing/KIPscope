import { describe, expect, it } from "vitest";
import { driveGrid, findDrives, type GridBucket } from "../src/drives.ts";

const S = 1_000_000_000n;
const HOUR = 3600n * S;

describe("driveGrid", () => {
  it("derives the drive grid from the bar width", () => {
    expect(driveGrid(HOUR)).toBe(9n * S); // 9 s
    expect(driveGrid(600n * S)).toBe(1_500_000_000n); // 10 min -> 1.5 s
    expect(driveGrid(1_000_000n)).toBe(2500n); // 1 ms -> 2.5 us
    expect(driveGrid(180n * 86_400n * S)).toBe(38_880_000_000_000n); // 180 d -> 10.8 h
  });
});

/** Buckets from seconds: start s, count; every 10 s from `from` to `to` inclusive. */
function run(from: number, to: number, count: number, step = 10): GridBucket[] {
  const out: GridBucket[] = [];
  for (let s = from; s <= to; s += step) out.push({ start: BigInt(s) * S, count });
  return out;
}

/** Deterministic shuffle (the order must not matter). */
function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  let seed = 12345;
  for (let i = out.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const j = seed % (i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

describe("findDrives", () => {
  const grid = 10n * S;

  it("finds drives: threshold, merge gap, minimum length, rows", () => {
    const buckets = shuffled([
      ...run(0, 290, 100),
      { start: 310n * S, count: 5 },
      ...run(360, 410, 100),
      ...run(490, 600, 100),
      { start: 1000n * S, count: 9 },
      ...run(2000, 2120, 10),
    ]);
    expect(findDrives(buckets, grid)).toEqual([
      // 60 s pause merges (gap 300 -> 360 is exactly 60 s); the bucket of 5 is inside and counts as rows.
      { from: 0n, to: 420n * S, rows: 30 * 100 + 5 + 6 * 100 },
      // [490 s, 610 s) is exactly 2 min: dropped. 9 (below a tenth of 100) is no drive.
      // 10 * 10 >= 100: a tenth of the peak is active.
      { from: 2000n * S, to: 2130n * S, rows: 13 * 10 },
    ]);
  });

  it("gives no drives without buckets", () => {
    expect(findDrives([], grid)).toEqual([]);
  });

  it("merges at exactly 60 s and splits just beyond; keeps only runs longer than 2 min", () => {
    const first = run(0, 100, 50); // [0, 110)
    // next run starts 60 s after the first ends: merges
    const merged = findDrives([...first, ...run(170, 200, 50)], grid);
    expect(merged).toEqual([{ from: 0n, to: 210n * S, rows: 15 * 50 }]);
    // 1 ns more splits them: both runs (110 s and 40 s) are then too short
    const split = findDrives(
      [...first, ...run(170, 200, 50).map((b) => ({ ...b, start: b.start + 1n }))],
      grid,
    );
    expect(split).toEqual([]);
    // 12 buckets of 10 s = 120 s exactly: dropped; 13 buckets: kept
    expect(findDrives(run(0, 110, 7), grid)).toEqual([]);
    expect(findDrives(run(0, 120, 7), grid)).toEqual([{ from: 0n, to: 130n * S, rows: 13 * 7 }]);
  });

  it("counts negative start times and a single bucket peak", () => {
    expect(findDrives([{ start: -10n * S, count: 3 }], grid)).toEqual([]);
    const pre = findDrives(run(-100, 100, 4), grid);
    expect(pre).toEqual([{ from: -100n * S, to: 110n * S, rows: 21 * 4 }]);
  });
});
