import { describe, expect, it } from "vitest";
import { isSearchKey, isTextField } from "../src/keys.ts";

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

describe("isSearchKey", () => {
  const key = (
    k: string,
    mods: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {},
  ) => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...mods,
  });

  it("focuses the search from a focused select", () => {
    expect(isSearchKey(key("/"), el("SELECT"))).toBe(true);
    // Nothing focused, a button or a checkbox: `/` goes to the search as well.
    expect(isSearchKey(key("/"), null)).toBe(true);
    expect(isSearchKey(key("/"), el("BUTTON"))).toBe(true);
    expect(isSearchKey(key("/"), el("INPUT", { type: "checkbox" }))).toBe(true);
  });

  it("leaves / to fields that take typed text, and ignores modified or other keys", () => {
    expect(isSearchKey(key("/"), el("INPUT", { type: "search" }))).toBe(false);
    expect(isSearchKey(key("/"), el("INPUT", { type: "text" }))).toBe(false);
    expect(isSearchKey(key("/"), el("TEXTAREA"))).toBe(false);
    expect(isSearchKey(key("/"), el("DIV", { isContentEditable: true }))).toBe(false);
    expect(isSearchKey(key("/", { metaKey: true }), null)).toBe(false);
    expect(isSearchKey(key("/", { ctrlKey: true }), null)).toBe(false);
    expect(isSearchKey(key("/", { altKey: true }), null)).toBe(false);
    expect(isSearchKey(key("a"), el("SELECT"))).toBe(false);
  });
});
