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

/**
 * Wheel zoom: 2^(1/5) per wheel tick, so five ticks halve or double the span. A tick is 100 px
 * (deltaMode 0) or 3 lines (deltaMode 1); a page (deltaMode 2) is five ticks. Trackpads send
 * fractions of a tick and zoom smoothly.
 */
const WHEEL_TICK_FACTOR = 2 ** (1 / 5);
const WHEEL_TICK_PX = 100;
const WHEEL_TICK_LINES = 3;
/** One wheel event zooms at most this many ticks (fast flicks would otherwise jump). */
const WHEEL_MAX_TICKS = 5;
/** WheelEvent.DOM_DELTA_LINE and DOM_DELTA_PAGE; WheelEvent is absent outside a browser. */
const DELTA_LINE = 1;
const DELTA_PAGE = 2;

/** Span factor for one vertical wheel event: > 1 zooms out (deltaY > 0), < 1 zooms in. */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  const perTick =
    deltaMode === DELTA_LINE
      ? WHEEL_TICK_LINES
      : deltaMode === DELTA_PAGE
        ? 1 / WHEEL_MAX_TICKS
        : WHEEL_TICK_PX;
  const ticks = Math.max(-WHEEL_MAX_TICKS, Math.min(WHEEL_MAX_TICKS, deltaY / perTick));
  return WHEEL_TICK_FACTOR ** ticks;
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

/**
 * Local zoom/pan preview of one window: the plot shows the preview while a gesture runs and its
 * setRange command is on its way; the server range changes only after the command is accepted.
 */
export class RangePreview {
  /** Previewed range; undefined shows the server range. */
  range: Range | undefined;
  /** A setRange command is on its way. */
  inFlight = false;

  /** The range the plot shows. */
  view(server: Range): Range {
    return this.range ?? server;
  }

  /**
   * Sends the previewed range r. A command that throws (e.g. a network error) counts as rejected.
   * reapply: the preview was dropped and no new server range comes, so the plot must show the
   * server range again.
   */
  async commit(
    r: Range,
    send: () => Promise<{ ok: boolean }>,
  ): Promise<{ ok: boolean; reapply: boolean }> {
    this.inFlight = true;
    let ok = false;
    try {
      ok = (await send()).ok;
    } catch {
      ok = false;
    } finally {
      this.inFlight = false;
    }
    // The accepted range arrives with the next revision; drop the preview if nothing newer.
    if (this.range !== r) return { ok, reapply: false };
    this.range = undefined;
    // Rejected: no new range comes, so the plot goes back to the server range.
    return { ok, reapply: !ok };
  }

  /** Drops the preview without a command; true if there was one (the plot must show the server range again). */
  drop(): boolean {
    if (!this.range) return false;
    this.range = undefined;
    return true;
  }
}

/** History key: one shared history while linked ("*"), else per window ID. */
export function historyKey(linked: boolean, windowId: string): string {
  return linked ? "*" : windowId;
}
