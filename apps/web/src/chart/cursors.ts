import type { CursorName } from "@kipscope/shared";

/** Half width in CSS px of a cursor line's hit strip (design C3). */
export const CURSOR_HIT_PX = 6;
/** A click is committed only after this delay, so the first click of a double-click is dropped. */
export const DOUBLE_CLICK_MS = 500;

/**
 * Rounds a placed time to the largest power of ten in ns that is at most span / 1000: about one
 * pixel at 1000 px, and the time reads short (…:01.512 instead of …:01.512345678). With `range`,
 * the result stays inside the half-open [from, to): a click at the plot's right edge would else
 * land on `to`, which the window does not contain (no line, "outside this window's range").
 */
export function snapCursorTime(
  t: bigint,
  span: bigint,
  range?: { from: bigint; to: bigint },
): bigint {
  const limit = span / 1000n;
  let step = 1n;
  while (step * 10n <= limit) step *= 10n;
  const floor = (x: bigint) => x - (((x % step) + step) % step);
  const down = floor(t);
  let snapped = step > 1n && t - down >= step / 2n ? down + step : down;
  if (!range) return snapped;
  if (snapped >= range.to) snapped = floor(range.to - 1n);
  if (snapped < range.from) snapped = floor(range.from - 1n) + step;
  // A range narrower than one step: no grid time inside, so the raw time clamped into it.
  if (snapped < range.from || snapped >= range.to) {
    snapped = t < range.from ? range.from : t >= range.to ? range.to - 1n : t;
  }
  return snapped;
}

/** The cursor line within CURSOR_HIT_PX of x, the nearer one if both are; B on a tie (drawn above A). */
export function hitCursor(x: number, lines: { a?: number; b?: number }): CursorName | undefined {
  const da = lines.a === undefined ? Number.POSITIVE_INFINITY : Math.abs(x - lines.a);
  const db = lines.b === undefined ? Number.POSITIVE_INFINITY : Math.abs(x - lines.b);
  if (db <= CURSOR_HIT_PX && db <= da) return "b";
  if (da <= CURSOR_HIT_PX) return "a";
  return undefined;
}

/** Width in CSS px of a cursor flag right of its line ("A" or "B" with padding). */
export const CURSOR_FLAG_PX = 16;

/**
 * True when both lines are shown and closer than a flag's width or 1 % of the plot width: B's
 * flag would cover A's, so it moves one row down.
 */
export function stackFlags(lines: { a?: number; b?: number }, width: number): boolean {
  if (lines.a === undefined || lines.b === undefined) return false;
  return Math.abs(lines.a - lines.b) < Math.max(CURSOR_FLAG_PX, width / 100);
}

/**
 * x of the Δt label's left edge: centred between the lines when it fits there without covering
 * the left-hand line's flag (flags sit right of their line), else right of the right-hand flag.
 */
export function deltaLabelX(xa: number, xb: number, labelWidth: number, flagWidth: number): number {
  const left = Math.min(xa, xb);
  const right = Math.max(xa, xb);
  const x = (left + right - labelWidth) / 2;
  if (x >= left + flagWidth && x + labelWidth <= right) return x;
  return right + flagWidth;
}

/** Commits the last click after delayMs unless doubleClick() came first. */
export class ClickGate {
  private readonly delayMs: number;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (id: unknown) => void;
  private pending: unknown;
  private active = false;

  constructor(
    delayMs: number,
    schedule: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms),
    cancel: (id: unknown) => void = (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  ) {
    this.delayMs = delayMs;
    this.schedule = schedule;
    this.cancel = cancel;
  }

  click(commit: () => void): void {
    this.drop();
    this.active = true;
    this.pending = this.schedule(() => {
      this.active = false;
      this.pending = undefined;
      commit();
    }, this.delayMs);
  }

  /** Drops the pending click. */
  doubleClick(): void {
    this.drop();
  }

  dispose(): void {
    this.drop();
  }

  private drop() {
    if (this.active) this.cancel(this.pending);
    this.active = false;
    this.pending = undefined;
  }
}
