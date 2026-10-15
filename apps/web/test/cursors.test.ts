import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ClickGate,
  CURSOR_HIT_PX,
  DOUBLE_CLICK_MS,
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
