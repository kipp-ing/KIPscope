import { describe, expect, it } from "vitest";
import { isSearchKey, isTextField, NavRepeat, navKey } from "../src/keys.ts";

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

describe("navKey", () => {
  const key = (
    k: string,
    mods: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean } = {},
  ) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

  it("maps navigation keys outside text fields", () => {
    for (const focused of [null, el("BUTTON"), el("DIV"), el("INPUT", { type: "checkbox" })]) {
      expect(navKey(key("+"), focused)).toBe("in");
      expect(navKey(key("=", {}), focused)).toBe("in");
      expect(navKey(key("-"), focused)).toBe("out");
      expect(navKey(key("ArrowLeft"), focused)).toBe("left");
      expect(navKey(key("ArrowRight"), focused)).toBe("right");
      expect(navKey(key("ArrowLeft", { shiftKey: true }), focused)).toBe("pageLeft");
      expect(navKey(key("ArrowRight", { shiftKey: true }), focused)).toBe("pageRight");
      expect(navKey(key("Home"), focused)).toBe("home");
      expect(navKey(key("t"), focused)).toBe("goTo");
    }
    // `+` is Shift+= on many layouts: Shift does not change zoom keys.
    expect(navKey(key("+", { shiftKey: true }), null)).toBe("in");

    // Nothing in fields that take typed text, and nothing in selects.
    for (const field of [
      el("INPUT", { type: "text" }),
      el("INPUT", { type: "search" }),
      el("TEXTAREA"),
      el("SELECT"),
      el("DIV", { isContentEditable: true }),
    ]) {
      for (const k of ["+", "=", "-", "ArrowLeft", "ArrowRight", "Home", "t"]) {
        expect(navKey(key(k), field), `${k} in ${field.tagName}`).toBeUndefined();
      }
    }

    // Ctrl, Meta or Alt turn every key into a browser or system shortcut.
    for (const mods of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      for (const k of ["+", "-", "ArrowLeft", "Home", "t"]) {
        expect(navKey(key(k, mods), null), k).toBeUndefined();
      }
    }

    // Other keys, including the ones reserved for other features, are not navigation.
    for (const k of ["s", "/", "Backspace", "a", "ArrowUp", "ArrowDown", "Enter", "Escape"]) {
      expect(navKey(key(k), null), k).toBeUndefined();
    }
  });
});

describe("NavRepeat", () => {
  it("joins auto-repeat steps to one history entry", () => {
    const r = new NavRepeat();
    // First press: a new history entry.
    expect(r.step(false, 1000)).toBe("push");
    // Auto-repeat events join that entry, at most one step per 100 ms.
    expect(r.step(true, 1030)).toBe("skip");
    expect(r.step(true, 1099)).toBe("skip");
    expect(r.step(true, 1100)).toBe("join");
    expect(r.step(true, 1150)).toBe("skip");
    expect(r.step(true, 1200)).toBe("join");
    expect(r.step(true, 1300)).toBe("join");
    // A new press starts a new entry, whatever happened before.
    expect(r.step(false, 1310)).toBe("push");
    expect(r.step(true, 1420)).toBe("join");
    // A press after a pause is a push as well.
    expect(r.step(false, 5000)).toBe("push");
  });
});
