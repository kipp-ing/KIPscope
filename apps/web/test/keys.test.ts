import { describe, expect, it } from "vitest";
import {
  isEditKey,
  isHelpKey,
  isSearchKey,
  isStarKey,
  isTextField,
  NavRepeat,
  navKey,
} from "../src/keys.ts";

/** No DOM in the tests: plain objects shaped like the element properties isTextField reads. */
const el = (
  tagName: string,
  props: { type?: string; isContentEditable?: boolean; inRadiogroup?: boolean } = {},
) => {
  const { inRadiogroup = false, ...rest } = props;
  return {
    tagName,
    isContentEditable: false,
    // Like Element.closest: the radiogroup ancestor when there is one, else null.
    closest: (selector: string) => (inRadiogroup && selector.includes("radiogroup") ? {} : null),
    ...rest,
  } as unknown as Element;
};

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
      expect(navKey(key("n"), focused)).toBe("nextEvent");
      expect(navKey(key("p"), focused)).toBe("prevEvent");
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
      for (const k of ["+", "=", "-", "ArrowLeft", "ArrowRight", "Home", "t", "n", "p"]) {
        expect(navKey(key(k), field), `${k} in ${field.tagName}`).toBeUndefined();
      }
    }

    // Ctrl, Meta or Alt turn every key into a browser or system shortcut.
    for (const mods of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      for (const k of ["+", "-", "ArrowLeft", "Home", "t", "n", "p"]) {
        expect(navKey(key(k, mods), null), k).toBeUndefined();
      }
    }

    // Other keys, including the ones reserved for other features, are not navigation.
    for (const k of ["s", "/", "Backspace", "a", "ArrowUp", "ArrowDown", "Enter", "Escape"]) {
      expect(navKey(key(k), null), k).toBeUndefined();
    }
  });

  it("maps Shift+A and Shift+B to bring a cursor into view", () => {
    // D-095, design DW23: the key of a strip flag; `A` and `B` with Shift, nothing else.
    for (const focused of [null, el("BUTTON"), el("DIV"), el("INPUT", { type: "checkbox" })]) {
      expect(navKey(key("A", { shiftKey: true }), focused)).toBe("cursorA");
      expect(navKey(key("B", { shiftKey: true }), focused)).toBe("cursorB");
    }
    // Without Shift the letters are no navigation keys.
    for (const k of ["a", "b", "A", "B"]) expect(navKey(key(k), null), k).toBeUndefined();
    // Not in fields that take typed text, not with Ctrl, Meta or Alt, not while the picker is open.
    for (const field of [
      el("INPUT", { type: "text" }),
      el("INPUT", { type: "search" }),
      el("TEXTAREA"),
      el("SELECT"),
      el("DIV", { isContentEditable: true }),
    ]) {
      expect(navKey(key("A", { shiftKey: true }), field), field.tagName).toBeUndefined();
      expect(navKey(key("B", { shiftKey: true }), field), field.tagName).toBeUndefined();
    }
    for (const mods of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      expect(navKey(key("A", { shiftKey: true, ...mods }), null)).toBeUndefined();
      expect(navKey(key("B", { shiftKey: true, ...mods }), null)).toBeUndefined();
    }
    expect(navKey(key("A", { shiftKey: true }), null, true)).toBeUndefined();
    expect(navKey(key("B", { shiftKey: true }), null, true)).toBeUndefined();
  });

  it("maps Shift+A and Shift+B with Caps Lock on", () => {
    // Caps Lock on, Shift held: the browser reports `a` and `b`; without Shift it reports `A`/`B`.
    for (const focused of [null, el("BUTTON"), el("DIV")]) {
      expect(navKey(key("a", { shiftKey: true }), focused)).toBe("cursorA");
      expect(navKey(key("b", { shiftKey: true }), focused)).toBe("cursorB");
    }
    expect(navKey(key("A"), null)).toBeUndefined();
    expect(navKey(key("B"), null)).toBeUndefined();
    expect(navKey(key("a", { shiftKey: true, metaKey: true }), null)).toBeUndefined();
    expect(navKey(key("b", { shiftKey: true }), null, true)).toBeUndefined();
  });
});

describe("navKey in a radiogroup", () => {
  const key = (k: string, mods: { shiftKey?: boolean } = {}) => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  });

  it("leaves ArrowLeft and ArrowRight to a focused radiogroup (D-112, Digits control)", () => {
    // The Digits buttons move the checked value with the arrows; the plot must not pan as well.
    const radio = el("BUTTON", { inRadiogroup: true });
    expect(navKey(key("ArrowLeft"), radio)).toBeUndefined();
    expect(navKey(key("ArrowRight"), radio)).toBeUndefined();
    // Same for a nested element inside the group.
    const inner = el("SPAN", { inRadiogroup: true });
    expect(navKey(key("ArrowLeft"), inner)).toBeUndefined();
    expect(navKey(key("ArrowRight"), inner)).toBeUndefined();
  });

  it("still pans from a plain button, a div or no focus", () => {
    for (const focused of [el("BUTTON"), el("DIV"), null]) {
      expect(navKey(key("ArrowLeft"), focused)).toBe("left");
      expect(navKey(key("ArrowRight"), focused)).toBe("right");
    }
  });
});

describe("navKey with the range picker", () => {
  const key = (
    k: string,
    mods: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean } = {},
  ) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

  it("ignores navigation keys while the range picker is open", () => {
    const keys = ["+", "=", "-", "ArrowLeft", "ArrowRight", "Home", "t", ",", ".", "n", "p"];
    // The picker's day cells are buttons, so the focused element alone does not tell: the open
    // state does. No key maps to an action, whatever has focus.
    for (const focused of [null, el("BUTTON"), el("DIV"), el("INPUT", { type: "checkbox" })]) {
      for (const k of keys) {
        expect(navKey(key(k), focused, true), `${k} in ${focused?.tagName}`).toBeUndefined();
      }
      expect(navKey(key("ArrowLeft", { shiftKey: true }), focused, true)).toBeUndefined();
      expect(navKey(key("ArrowRight", { shiftKey: true }), focused, true)).toBeUndefined();
    }
    // The same keys work again with the picker closed (explicitly or by default).
    expect(navKey(key("+"), el("BUTTON"), false)).toBe("in");
    expect(navKey(key("-"), el("BUTTON"))).toBe("out");
    expect(navKey(key("Home"), null, false)).toBe("home");
    expect(navKey(key("t"), null, false)).toBe("goTo");
  });
});

describe("drive keys", () => {
  const key = (
    k: string,
    mods: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean } = {},
  ) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

  it("maps the drive keys outside text fields", () => {
    for (const focused of [null, el("BUTTON"), el("DIV"), el("INPUT", { type: "checkbox" })]) {
      expect(navKey(key(","), focused)).toBe("prevDrive");
      expect(navKey(key("."), focused)).toBe("nextDrive");
    }
    // Nothing in fields that take typed text, and nothing in selects.
    for (const field of [
      el("INPUT", { type: "text" }),
      el("INPUT", { type: "search" }),
      el("TEXTAREA"),
      el("SELECT"),
      el("DIV", { isContentEditable: true }),
    ]) {
      expect(navKey(key(","), field), field.tagName).toBeUndefined();
      expect(navKey(key("."), field), field.tagName).toBeUndefined();
    }
    // Ctrl, Meta or Alt make them shortcuts of the browser or system.
    for (const mods of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      expect(navKey(key(",", mods), null)).toBeUndefined();
      expect(navKey(key(".", mods), null)).toBeUndefined();
    }
    // The shifted characters of these keys on US layouts are other keys.
    expect(navKey(key("<", { shiftKey: true }), null)).toBeUndefined();
    expect(navKey(key(">", { shiftKey: true }), null)).toBeUndefined();
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

describe("isHelpKey", () => {
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

  it("opens help with ? outside text fields", () => {
    expect(isHelpKey(key("?"), null)).toBe(true);
    expect(isHelpKey(key("?"), el("INPUT", { type: "search" }))).toBe(false);
    expect(isHelpKey(key("?"), el("TEXTAREA"))).toBe(false);
    expect(isHelpKey(key("?", { ctrlKey: true }), null)).toBe(false);
    expect(isHelpKey(key("?", { metaKey: true }), null)).toBe(false);
    expect(isHelpKey(key("?", { altKey: true }), null)).toBe(false);
    expect(isHelpKey(key("/"), null)).toBe(false);
    // A button or checkbox takes no typed text, so ? still opens help there.
    expect(isHelpKey(key("?"), el("BUTTON"))).toBe(true);
    expect(isHelpKey(key("?"), el("INPUT", { type: "checkbox" }))).toBe(true);
  });
});

describe("isStarKey", () => {
  const key = (
    k: string,
    mods: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean } = {},
  ) => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  });

  it("maps Ctrl/Cmd+D to the star", () => {
    // The platform modifier: Ctrl elsewhere, Cmd on macOS; `d` or `D` (caps lock).
    expect(isStarKey(key("d", { ctrlKey: true }), false)).toBe(true);
    expect(isStarKey(key("D", { metaKey: true }), true)).toBe(true);
    expect(isStarKey(key("D", { ctrlKey: true }), false)).toBe(true);
    expect(isStarKey(key("d", { metaKey: true }), true)).toBe(true);
    // The other platform's modifier does not star.
    expect(isStarKey(key("d", { metaKey: true }), false)).toBe(false);
    expect(isStarKey(key("d", { ctrlKey: true }), true)).toBe(false);
    // Alt or Shift in the chord, no modifier, or another key.
    expect(isStarKey(key("d", { ctrlKey: true, altKey: true }), false)).toBe(false);
    expect(isStarKey(key("d", { ctrlKey: true, shiftKey: true }), false)).toBe(false);
    expect(isStarKey(key("d"), false)).toBe(false);
    expect(isStarKey(key("d"), true)).toBe(false);
    expect(isStarKey(key("s", { ctrlKey: true }), false)).toBe(false);
    expect(isStarKey(key("Enter", { ctrlKey: true }), false)).toBe(false);
  });
});

describe("isEditKey", () => {
  const key = (
    k: string,
    mods: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean } = {},
  ) => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  });

  // add-computed-signals: F2 on the active computed row opens its editor.
  it("maps F2 to edit", () => {
    expect(isEditKey(key("F2"))).toBe(true);
    // Any modifier, or another key, is not the edit key.
    for (const mods of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }])
      expect(isEditKey(key("F2", mods))).toBe(false);
    for (const other of ["F1", "F3", "Enter", "e", "E", "f2", " "])
      expect(isEditKey(key(other))).toBe(false);
  });
});
