import { describe, expect, it } from "vitest";
import { ghostPosition } from "../src/chart/drag.ts";

// Viewport 1280 x 779, ghost 120 x 22.
const W = 1280;
const H = 779;

describe("ghostPosition", () => {
  it("sits 12 px right of and below the pointer by default", () => {
    expect(ghostPosition({ x: 100, y: 200 }, 120, 22, W, H)).toEqual({ left: 112, top: 212 });
  });

  it("flips to 12 px above the pointer when it would cross the bottom edge", () => {
    // 758 + 12 + 22 = 792 > 779, so top = 758 - 12 - 22 = 724
    expect(ghostPosition({ x: 100, y: 758 }, 120, 22, W, H)).toEqual({ left: 112, top: 724 });
  });

  it("stays below when it fits exactly at the bottom edge", () => {
    // 745 + 12 + 22 = 779, not over
    expect(ghostPosition({ x: 100, y: 745 }, 120, 22, W, H).top).toBe(757);
  });

  it("stays inside the right edge", () => {
    expect(ghostPosition({ x: 1270, y: 200 }, 120, 22, W, H).left).toBe(1160);
  });

  it("stays inside the top edge when flipping would leave the viewport", () => {
    // tiny viewport: below does not fit, above would be negative
    expect(ghostPosition({ x: 10, y: 15 }, 50, 22, 300, 30).top).toBe(0);
  });

  it("never goes left of the viewport", () => {
    expect(ghostPosition({ x: 0, y: 0 }, 500, 22, 300, 779).left).toBe(0);
  });
});
