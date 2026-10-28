import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ClickGate,
  CURSOR_HIT_PX,
  CursorClick,
  DOUBLE_CLICK_MS,
  deltaLabelX,
  hitCursor,
  snapCursorTime,
} from "../src/chart/cursors.ts";

describe("snapCursorTime", () => {
  it("snaps cursor times to a power of ten below a thousandth of the span", () => {
    // Span 3 s: span / 1000 = 3 ms; the largest power of ten at most that is 1 ms.
    expect(snapCursorTime(1791896881512345678n, 3_000_000_000n)).toBe(1791896881512000000n);
    // Span 2 days: span / 1000 ≈ 172.8 s; the step is 100 s.
    expect(snapCursorTime(1791896881512345678n, 172_800_000_000_000n)).toBe(1791896900000000000n);
    // Span 5 µs: span / 1000 = 5 ns; the step is 1 ns, so nothing is lost.
    expect(snapCursorTime(1791896881512345678n, 5_000n)).toBe(1791896881512345678n);
    // Already on the grid.
    expect(snapCursorTime(1791896881000000000n, 3_000_000_000n)).toBe(1791896881000000000n);
  });
});

describe("deltaLabelX", () => {
  it("places the Δt label between the flags or beside the right one", () => {
    // Flags sit right of their lines and are 14 px wide; the label is 80 px wide.
    // Wide gap (lines at 100 and 300): centred between the lines, (400 - 80) / 2.
    expect(deltaLabelX(100, 300, 80, 14)).toBe(160);
    // The order of the lines does not matter.
    expect(deltaLabelX(300, 100, 80, 14)).toBe(160);
    // Narrow gap (8 px): right of the right-hand flag, 108 + 14.
    expect(deltaLabelX(100, 108, 80, 14)).toBe(122);
    expect(deltaLabelX(108, 100, 80, 14)).toBe(122);
    // The gap holds the label but not clear of the left flag (centred x = 105 < 100 + 14).
    expect(deltaLabelX(100, 200, 90, 14)).toBe(214);
    // Never covers either flag: the result is clear of both flags in every case.
    for (const [xa, xb] of [
      [100, 300],
      [100, 108],
      [100, 200],
      [50, 51],
    ] as const) {
      const x = deltaLabelX(xa, xb, 80, 14);
      const left = Math.min(xa, xb);
      const right = Math.max(xa, xb);
      expect(x >= left + 14).toBe(true);
      expect(x + 80 <= right || x >= right + 14).toBe(true);
    }
  });
});

describe("hitCursor", () => {
  it("hits the nearer cursor line within 6 px, B on a tie", () => {
    expect(CURSOR_HIT_PX).toBe(6);
    const lines = { a: 100, b: 104 };
    expect(hitCursor(102, lines)).toBe("b"); // equally far from both: B is drawn above A
    expect(hitCursor(107, lines)).toBe("b");
    expect(hitCursor(111, lines)).toBeUndefined();
    expect(hitCursor(98, lines)).toBe("a"); // nearer to A
    expect(hitCursor(100, lines)).toBe("a");
    expect(hitCursor(93, lines)).toBeUndefined();
    // Single and absent lines.
    expect(hitCursor(103, { a: 100 })).toBe("a");
    expect(hitCursor(103, { b: 100 })).toBe("b");
    expect(hitCursor(120, { a: 100 })).toBeUndefined();
    expect(hitCursor(100, {})).toBeUndefined();
  });
});

describe("ClickGate", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("commits a click only after the double-click interval", () => {
    expect(DOUBLE_CLICK_MS).toBe(500);
    // A click followed by a double-click within 500 ms commits nothing.
    const gate = new ClickGate(DOUBLE_CLICK_MS);
    const commit = vi.fn();
    gate.click(commit);
    vi.advanceTimersByTime(499);
    expect(commit).not.toHaveBeenCalled();
    gate.doubleClick();
    vi.advanceTimersByTime(5_000);
    expect(commit).not.toHaveBeenCalled();

    // A lone click commits after 500 ms, exactly once.
    gate.click(commit);
    vi.advanceTimersByTime(499);
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(commit).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5_000);
    expect(commit).toHaveBeenCalledTimes(1);

    // Only the last click commits when clicks follow each other.
    const first = vi.fn();
    const second = vi.fn();
    gate.click(first);
    vi.advanceTimersByTime(300);
    gate.click(second);
    vi.advanceTimersByTime(500);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    // dispose drops a pending click.
    const late = vi.fn();
    gate.click(late);
    gate.dispose();
    vi.advanceTimersByTime(5_000);
    expect(late).not.toHaveBeenCalled();
  });
});

describe("CursorClick", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** A click helper over a fake-timer gate, recording what it calls, in order. */
  function helper() {
    const events: string[] = [];
    const preview = vi.fn((name: string, t: bigint | undefined) =>
      events.push(`preview ${name} ${t === undefined ? "-" : t}`),
    );
    const commit = vi.fn((name: string, t: bigint) => events.push(`commit ${name} ${t}`));
    const click = new CursorClick(new ClickGate(DOUBLE_CLICK_MS), { preview, commit });
    return { click, preview, commit, events };
  }

  it("drops a waiting click and its line when the window closes", () => {
    // A click for A at 10, the window closes before 500 ms, the timer runs on.
    const one = helper();
    one.click.place("a", 10n);
    vi.advanceTimersByTime(499);
    one.click.dispose();
    vi.advanceTimersByTime(5_000);
    expect(one.events).toEqual(["preview a 10", "preview a -"]);
    expect(one.commit).not.toHaveBeenCalled();

    // A at 10, then B at 20 within the interval, then the window closes.
    const two = helper();
    two.click.place("a", 10n);
    vi.advanceTimersByTime(100);
    two.click.place("b", 20n);
    expect(two.commit).toHaveBeenCalledTimes(1);
    expect(two.commit).toHaveBeenCalledWith("a", 10n); // committed at once by B's click
    two.click.dispose();
    vi.advanceTimersByTime(5_000);
    expect(two.events).toEqual(["preview a 10", "commit a 10", "preview b 20", "preview b -"]);
    expect(two.commit).toHaveBeenCalledTimes(1); // B is never committed

    // A at 10 followed by a double-click: the line goes, nothing is committed.
    const three = helper();
    three.click.place("a", 10n);
    three.click.doubleClick();
    vi.advanceTimersByTime(5_000);
    expect(three.events).toEqual(["preview a 10", "preview a -"]);
    expect(three.commit).not.toHaveBeenCalled();
  });

  it("commits a lone click once after the interval and keeps its line", () => {
    const lone = helper();
    lone.click.place("b", 7n);
    vi.advanceTimersByTime(499);
    expect(lone.commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(lone.events).toEqual(["preview b 7", "commit b 7"]);
    // Nothing waits any more: closing the window ends no preview.
    lone.click.dispose();
    expect(lone.events).toEqual(["preview b 7", "commit b 7"]);
  });
});

describe("snapCursorTime inside a range", () => {
  const T = 1_791_896_880_000_000_000n;
  const span = 1_000_000_000n; // 1 s: 1 ms grid
  const to = T + span;

  it("stays inside the half-open [from, to)", () => {
    // Rounds up to `to` without a range, to the last grid time before it with one.
    expect(snapCursorTime(to - 100n, span)).toBe(to);
    expect(snapCursorTime(to - 100n, span, { from: T, to })).toBe(to - 1_000_000n);
    expect(snapCursorTime(to + 5n, span, { from: T, to })).toBe(to - 1_000_000n);
    // Inside and before: unchanged or rounded up to `from`.
    expect(snapCursorTime(T + 100n, span, { from: T, to })).toBe(T);
    expect(snapCursorTime(T - 100n, span, { from: T, to })).toBe(T);
  });

  it("takes the next grid time when the range starts off the grid", () => {
    expect(snapCursorTime(T + 300_010n, span, { from: T + 300_000n, to: to + 300_000n })).toBe(
      T + 1_000_000n,
    );
  });

  it("returns the raw time in a range narrower than one grid step", () => {
    expect(snapCursorTime(T + 150n, span, { from: T + 100n, to: T + 200n })).toBe(T + 150n);
  });
});
