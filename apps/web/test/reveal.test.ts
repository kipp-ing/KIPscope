import { describe, expect, it } from "vitest";
import { FLASH_MS, markTarget, revealDelta } from "../src/reveal.ts";

/** Fake element: only `closest` and `getAttribute`, as markTarget's parameter type allows. */
const fakeTarget = (found: string | null) => ({
  closest: (selector: string) =>
    selector === "[data-window-id]" && found !== null
      ? { getAttribute: (name: string) => (name === "data-window-id" ? found : null) }
      : null,
});

describe("markTarget", () => {
  it("finds the window of a click", () => {
    expect(markTarget(fakeTarget("w7"))).toBe("w7");
    expect(markTarget(fakeTarget(null))).toBeUndefined();
    expect(markTarget(null)).toBeUndefined();
  });
});

describe("revealDelta", () => {
  // The view starts below the sticky top row (100) and ends at the bottom of <main> (700).
  const view = { top: 100, bottom: 700 };

  it("scrolls a window fully into view below the top row", () => {
    // Fully inside: no scroll.
    expect(revealDelta({ top: 200, bottom: 300 }, view)).toBe(0);
    expect(revealDelta({ top: 100, bottom: 700 }, view)).toBe(0);
    // Below the view: bring its bottom to the view's bottom (bottom − 700).
    expect(revealDelta({ top: 650, bottom: 800 }, view)).toBe(100);
    expect(revealDelta({ top: 1000, bottom: 1200 }, view)).toBe(500);
    // Above the view, or partly under the top row: bring its top to the view's top (top − 100).
    expect(revealDelta({ top: 20, bottom: 150 }, view)).toBe(-80);
    expect(revealDelta({ top: 90, bottom: 200 }, view)).toBe(-10);
    // Taller than the view: header right below the top row (top − 100), wherever it lies.
    expect(revealDelta({ top: 50, bottom: 900 }, view)).toBe(-50);
    expect(revealDelta({ top: 300, bottom: 1000 }, view)).toBe(200);
  });

  it("flashes for 1200 ms", () => {
    expect(FLASH_MS).toBe(1200);
  });
});
