import { describe, expect, it } from "vitest";
import {
  isSidebarKey,
  loadSidebar,
  SIDEBAR_STORAGE_KEY,
  SIDEBAR_WIDTH_PX,
  saveSidebar,
} from "../src/layout/sidebar.ts";

/** No DOM in the tests: plain objects shaped like the element properties isTextField reads. */
const el = (tagName: string, props: { type?: string; isContentEditable?: boolean } = {}) =>
  ({ tagName, isContentEditable: false, ...props }) as unknown as Element;

const key = (k: string, mods: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
});

describe("sidebar state", () => {
  it("loads and saves the sidebar state, open by default and when storage fails", () => {
    expect(SIDEBAR_STORAGE_KEY).toBe("kipscope.sidebar");
    expect(SIDEBAR_WIDTH_PX).toBe(240);

    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
    // Nothing stored: open.
    expect(loadSidebar(storage)).toBe("open");
    // Round trip of both states, under the documented key and value.
    saveSidebar(storage, "collapsed");
    expect(data.get("kipscope.sidebar")).toBe("collapsed");
    expect(loadSidebar(storage)).toBe("collapsed");
    saveSidebar(storage, "open");
    expect(data.get("kipscope.sidebar")).toBe("open");
    expect(loadSidebar(storage)).toBe("open");
    // An unknown stored value falls back to open.
    for (const junk of ["", "closed", "OPEN", "1", "null"]) {
      data.set("kipscope.sidebar", junk);
      expect(loadSidebar(storage)).toBe("open");
    }
    // Missing storage and throwing storage: open, and saving never throws.
    expect(loadSidebar(undefined)).toBe("open");
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(loadSidebar(throwing)).toBe("open");
    expect(() => saveSidebar(throwing, "collapsed")).not.toThrow();
    expect(() => saveSidebar(undefined, "collapsed")).not.toThrow();
  });
});

describe("isSidebarKey", () => {
  it("toggles with s outside text fields and selects only", () => {
    // Page body, nothing focused, buttons and checkboxes: s toggles.
    expect(isSidebarKey(key("s"), null)).toBe(true);
    expect(isSidebarKey(key("s"), el("BODY"))).toBe(true);
    expect(isSidebarKey(key("s"), el("BUTTON"))).toBe(true);
    expect(isSidebarKey(key("s"), el("INPUT", { type: "checkbox" }))).toBe(true);
    // Text fields, selects and contenteditable keep the letter.
    expect(isSidebarKey(key("s"), el("INPUT", { type: "search" }))).toBe(false);
    expect(isSidebarKey(key("s"), el("INPUT", { type: "text" }))).toBe(false);
    expect(isSidebarKey(key("s"), el("TEXTAREA"))).toBe(false);
    expect(isSidebarKey(key("s"), el("SELECT"))).toBe(false);
    expect(isSidebarKey(key("s"), el("DIV", { isContentEditable: true }))).toBe(false);
    // Modifiers: Ctrl+S, Cmd+S and Alt+S are the browser's or the system's.
    expect(isSidebarKey(key("s", { ctrlKey: true }), null)).toBe(false);
    expect(isSidebarKey(key("s", { metaKey: true }), null)).toBe(false);
    expect(isSidebarKey(key("s", { altKey: true }), null)).toBe(false);
    // Only the lower-case s key.
    for (const other of ["a", "/", "t", "S2", "Escape"]) {
      expect(isSidebarKey(key(other), null)).toBe(false);
    }
  });
});
