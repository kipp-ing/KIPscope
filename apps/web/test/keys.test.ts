import { describe, expect, it } from "vitest";
import { isTextField } from "../src/keys.ts";

/** No DOM in the tests: plain objects shaped like the element properties isTextField reads. */
const el = (tagName: string, props: { type?: string; isContentEditable?: boolean } = {}) =>
  ({ tagName, isContentEditable: false, ...props }) as unknown as Element;

describe("isTextField", () => {
  it("treats input, textarea, select and contenteditable as text fields", () => {
    expect(isTextField(el("INPUT", { type: "text" }))).toBe(true);
    expect(isTextField(el("INPUT", { type: "search" }))).toBe(true);
    expect(isTextField(el("INPUT", { type: "number" }))).toBe(true);
    expect(isTextField(el("TEXTAREA"))).toBe(true);
    expect(isTextField(el("SELECT"))).toBe(true);
    expect(isTextField(el("DIV", { isContentEditable: true }))).toBe(true);
    // Inputs that take no typed text leave Backspace to the app.
    for (const type of ["checkbox", "radio", "button", "range"]) {
      expect(isTextField(el("INPUT", { type }))).toBe(false);
    }
    expect(isTextField(el("DIV"))).toBe(false);
    expect(isTextField(el("BUTTON"))).toBe(false);
    expect(isTextField(null)).toBe(false);
  });
});
