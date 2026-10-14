import { describe, expect, it } from "vitest";
import { type Insets, mergeInsets } from "../src/chart/insets.ts";

describe("mergeInsets", () => {
  it("takes the largest axis width per side across windows", () => {
    const natural = new Map<string, Insets>([
      ["a", { left: 60, right: 25 }],
      ["b", { left: 40, right: 90 }],
      ["c", { left: 120, right: 10 }],
    ]);
    expect(mergeInsets(["a", "b"], natural)).toEqual({ left: 60, right: 90 });
    expect(mergeInsets(["a", "b", "c"], natural)).toEqual({ left: 120, right: 90 });
    // Only listed windows count: a removed window's stale inset is ignored.
    expect(mergeInsets(["b"], natural)).toEqual({ left: 40, right: 90 });
    // A window that has not reported yet is skipped.
    expect(mergeInsets(["a", "new"], natural)).toEqual({ left: 60, right: 25 });
    expect(mergeInsets([], natural)).toEqual({ left: 0, right: 0 });
  });
});
