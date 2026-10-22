import { describe, expect, it } from "vitest";
import { shouldClearOnAnswer } from "../src/explorer/starRequest.ts";

describe("shouldClearOnAnswer", () => {
  it("clears when the answer lists the same names as shown", () => {
    expect(shouldClearOnAnswer(["a", "b", "c"], ["a", "b", "c"])).toBe(true);
  });

  it("keeps the request when the answer adds a name", () => {
    expect(shouldClearOnAnswer(["a", "b", "c"], ["a", "b"])).toBe(false);
  });

  it("keeps the request when the answer drops a name", () => {
    expect(shouldClearOnAnswer(["a"], ["a", "b"])).toBe(false);
  });

  it("keeps the request when the same names come in another order", () => {
    expect(shouldClearOnAnswer(["b", "a"], ["a", "b"])).toBe(false);
  });

  it("clears when both lists are empty", () => {
    expect(shouldClearOnAnswer([], [])).toBe(true);
  });
});
