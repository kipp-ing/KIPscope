/**
 * Drives of a recording from its row density on a fine grid (spec time-strip "Drives of a
 * recording", D-057, design S2 of add-strip-navigation): drives are the real bursts, not the
 * trickle a parked vehicle logs, nor the short wake-ups of its ECUs (design Q1).
 */

/** Grid buckets per bar: the grid is width / 400 (9 s at 1 h bars). Exact for every DENSITY_WIDTHS member (all are multiples of 1 ms = 2^6·5^6 ns). */
export const DRIVE_GRID_PER_BAR = 400n;
/** A grid bucket is active when count * DRIVE_ACTIVE_DIVISOR >= the fullest bucket's count (a tenth of the peak). */
export const DRIVE_ACTIVE_DIVISOR = 10;
/** Active runs at most this far apart (end of one to start of the next) merge: 60 s. */
export const DRIVE_MERGE_GAP = 60_000_000_000n;
/** A merged run is a drive when to − from is strictly longer than this: 2 min (wake-ups are not drives, D-057 Q1). */
export const DRIVE_MIN = 120_000_000_000n;

export interface GridBucket {
  start: bigint;
  count: number;
}

/** width / DRIVE_GRID_PER_BAR. */
export function driveGrid(width: bigint): bigint {
  return width / DRIVE_GRID_PER_BAR;
}

/** Drives from the non-empty grid buckets of one data ref, in any order (spec time-strip "Drives of a recording"). */
export function findDrives(
  buckets: readonly GridBucket[],
  grid: bigint,
): { from: bigint; to: bigint; rows: number }[] {
  if (buckets.length === 0) return [];
  // Grid buckets are sorted, never rows: at most 48,000 of them (design S2).
  const sorted = [...buckets].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  let peak = 0;
  for (const b of sorted) if (b.count > peak) peak = b.count;
  const runs: { from: bigint; to: bigint }[] = [];
  let run: { from: bigint; to: bigint } | undefined;
  for (const b of sorted) {
    if (b.count * DRIVE_ACTIVE_DIVISOR < peak) continue;
    if (run && b.start - run.to <= DRIVE_MERGE_GAP) {
      run.to = b.start + grid;
    } else {
      run = { from: b.start, to: b.start + grid };
      runs.push(run);
    }
  }
  const drives: { from: bigint; to: bigint; rows: number }[] = [];
  let i = 0;
  for (const { from, to } of runs) {
    if (to - from <= DRIVE_MIN) continue;
    // Runs are in time order and disjoint, so one pass over the sorted buckets sums all of them.
    let rows = 0;
    for (; i < sorted.length; i++) {
      const b = sorted[i] as GridBucket;
      if (b.start >= to) break;
      if (b.start >= from) rows += b.count;
    }
    drives.push({ from, to, rows });
  }
  return drives;
}
