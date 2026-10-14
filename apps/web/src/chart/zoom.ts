import { NS_PER_MS, TIME_MAX, TIME_MIN } from "@letsview/shared";

export interface Range {
  from: bigint;
  to: bigint;
}

/** Shifts a range into [TIME_MIN, TIME_MAX] keeping its span; a span wider than the bounds becomes the bounds. */
export function clampRange(r: Range): Range {
  const span = r.to - r.from;
  if (span >= TIME_MAX - TIME_MIN) return { from: TIME_MIN, to: TIME_MAX };
  if (r.from < TIME_MIN) return { from: TIME_MIN, to: TIME_MIN + span };
  if (r.to > TIME_MAX) return { from: TIME_MAX - span, to: TIME_MAX };
  return r;
}

/** Union of signal extents: from = min first, to = (max last / 1 ms + 1) × 1 ms (half-open). Undefined for []. */
export function extentRange(extents: { first: string; last: string }[]): Range | undefined {
  if (extents.length === 0) return undefined;
  let first = BigInt(extents[0]?.first ?? 0);
  let last = BigInt(extents[0]?.last ?? 0);
  for (const e of extents) {
    const f = BigInt(e.first);
    const l = BigInt(e.last);
    if (f < first) first = f;
    if (l > last) last = l;
  }
  // Half-open range: end just after the last point, rounded up to the next millisecond.
  return { from: first, to: (last / NS_PER_MS + 1n) * NS_PER_MS };
}

export const ZOOM_HISTORY_LIMIT = 50;

/** Ranges shown before committed zoom gestures, most recent last. */
export class ZoomHistory {
  private readonly ranges: Range[] = [];
  private readonly limit: number;

  constructor(limit = ZOOM_HISTORY_LIMIT) {
    this.limit = limit;
  }

  /** Pushes the range shown before a committed gesture; ignored if equal to the top; drops the oldest beyond the limit. */
  push(r: Range): void {
    const top = this.ranges[this.ranges.length - 1];
    if (top && top.from === r.from && top.to === r.to) return;
    this.ranges.push({ from: r.from, to: r.to });
    if (this.ranges.length > this.limit) this.ranges.shift();
  }

  /** Pops the most recent range, undefined when empty. */
  back(): Range | undefined {
    return this.ranges.pop();
  }

  get size(): number {
    return this.ranges.length;
  }
}

/** History key: one shared history while linked ("*"), else per window ID. */
export function historyKey(linked: boolean, windowId: string): string {
  return linked ? "*" : windowId;
}
