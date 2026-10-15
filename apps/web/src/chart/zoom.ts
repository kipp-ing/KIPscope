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

/** Span factor for one wheel delta: > 1 zooms out (delta > 0), < 1 zooms in. */
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

/** Largest span factor of one wheel step (WHEEL_MAX_TICKS ticks); its inverse is the smallest. */
const WHEEL_MAX_FACTOR = WHEEL_TICK_FACTOR ** WHEEL_MAX_TICKS;

/**
 * Wheel actions of one animation frame joined into one zoom/pan step, so a burst of events (a
 * fast wheel, a trackpad) costs one preview and one range per frame. Zoom factors multiply, up to
 * one event's limit; pan deltas add up; the zoom is anchored at the latest pointer x.
 */
export class WheelFrame {
  factor = 1;
  px = 0;
  /** Pointer x in CSS px of the latest zoom event. */
  x = 0;

  add(action: WheelAction, x: number): void {
    if (action.kind === "zoom") {
      this.factor = Math.min(
        WHEEL_MAX_FACTOR,
        Math.max(1 / WHEEL_MAX_FACTOR, this.factor * action.factor),
      );
      this.x = x;
    } else if (action.kind === "pan") this.px += action.px;
  }

  /** The joined step, and resets for the next frame. */
  take(): { factor: number; px: number; x: number } {
    const step = { factor: this.factor, px: this.px, x: this.x };
    this.factor = 1;
    this.px = 0;
    return step;
  }
}

export type WheelAction =
  | { kind: "zoom"; factor: number }
  | { kind: "pan"; px: number }
  | { kind: "none" };

/** A swipe pans only when its horizontal delta is more than this times the vertical one (design N5). */
const PAN_RATIO = 2;

/**
 * What a wheel event over a plot does (design N1): Ctrl or Shift (a pinch sets Ctrl) zooms at
 * the pointer, by the horizontal delta when it is the larger one (macOS turns Shift+wheel into
 * one); a mostly horizontal swipe pans; anything else is left to the page. Meta is no modifier.
 */
export function wheelAction(e: {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  shiftKey: boolean;
}): WheelAction {
  if (e.ctrlKey || e.shiftKey) {
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    return { kind: "zoom", factor: wheelZoomFactor(delta, e.deltaMode) };
  }
  if (Math.abs(e.deltaX) > PAN_RATIO * Math.abs(e.deltaY)) return { kind: "pan", px: e.deltaX };
  return { kind: "none" };
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

const sameRange = (a: Range, b: Range) => a.from === b.from && a.to === b.to;

/**
 * Local zoom/pan preview of one window: the plot and the header show the preview while a gesture
 * runs, its setRange command is on its way and, once accepted, until the new server range arrives.
 */
export class RangePreview {
  /** Previewed range; undefined shows the server range. */
  range: Range | undefined;
  /** A setRange command is on its way. */
  inFlight = false;
  /** Server range at the last settle. */
  private seen: Range | undefined;
  /** The server range changed since the last command was sent. */
  private moved = false;

  /** The range the plot and the header show. */
  view(server: Range): Range {
    return this.range ?? server;
  }

  /**
   * Called on each render with the server range; pending: a commit is scheduled but not sent.
   * While no command is pending or on its way, an accepted preview is dropped once the server
   * range equals it or changed since the command was sent (the accepted range, or another
   * client's, which wins). The accept may arrive before the revision that carries the range.
   */
  settle(server: Range, pending: boolean): void {
    if (this.seen && !sameRange(this.seen, server)) this.moved = true;
    this.seen = server;
    if (!this.range || pending || this.inFlight) return;
    if (this.moved || sameRange(this.range, server)) this.range = undefined;
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
    this.moved = false;
    let ok = false;
    try {
      ok = (await send()).ok;
    } catch {
      ok = false;
    } finally {
      this.inFlight = false;
    }
    // Accepted, or a newer preview: settle drops the preview once the server range arrives.
    if (ok || this.range !== r) return { ok, reapply: false };
    // Rejected: no new range comes, so the plot goes back to the server range.
    this.range = undefined;
    return { ok, reapply: true };
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
