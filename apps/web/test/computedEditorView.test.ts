import {
  buildSearchIndex,
  type CommandInput,
  type CommandResult,
  type ComputedDef,
  type SignalInfo,
} from "@kipscope/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ComputedEditor, type ComputedEditorProps } from "../src/computed/ComputedEditor.tsx";
import { type EditorContext, formulaNames, fromDef, prefill } from "../src/computed/editor.ts";

/**
 * A minimal hook runtime in place of React's (the web tests have no DOM): the component function is
 * called again after every event, its returned element tree is searched and its handlers are called
 * by hand. Effects do not run; refs stay empty (the component reaches them with `?.`).
 */
const rt = vi.hoisted(() => ({ slots: [] as unknown[], at: 0 }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const useState = (init: unknown) => {
    const k = rt.at++;
    if (!(k in rt.slots))
      rt.slots[k] = typeof init === "function" ? (init as () => unknown)() : init;
    const set = (v: unknown) => {
      rt.slots[k] = typeof v === "function" ? (v as (p: unknown) => unknown)(rt.slots[k]) : v;
    };
    return [rt.slots[k], set];
  };
  const useRef = (init: unknown) => {
    const k = rt.at++;
    if (!(k in rt.slots)) rt.slots[k] = { current: init };
    return rt.slots[k];
  };
  const useMemo = (fn: () => unknown) => {
    rt.at++;
    return fn();
  };
  const noop = () => {
    rt.at++;
  };
  const patched = { ...actual, useState, useRef, useMemo, useEffect: noop, useLayoutEffect: noop };
  return { ...patched, useId: () => "id", default: patched };
});

const info = (name: string, extra: Partial<SignalInfo> = {}): SignalInfo => ({
  id: `smart451/${name}`,
  dataRef: "smart451",
  name,
  ...extra,
});
const DNMOT = info("MS_312h.DNMOT", { unit: "rpm" });
const CURR = info("CPC_508h.PNHV_SupBat_Curr", { unit: "A" });
const ALL = [DNMOT, CURR];

const D = "DNMOT − PNHV_SupBat_Curr";
const C1: ComputedDef = {
  id: "c1",
  name: D,
  formula: "MS_312h.DNMOT - CPC_508h.PNHV_SupBat_Curr",
  unit: "A",
};
const C2: ComputedDef = { id: "c2", name: `abs(${D})`, formula: `abs("${D}")`, unit: "A" };
const DEFS = [C1, C2];
const IN_USE = `used by: "abs(${D})"`;

interface El {
  type: unknown;
  props: {
    children?: unknown;
    className?: string;
    disabled?: boolean;
    "aria-label"?: string;
    "aria-live"?: string;
    onClick: () => void;
    onKeyDown: (e: unknown) => void;
    onChange: (e: unknown) => void;
  };
}
const isEl = (n: unknown): n is El => typeof n === "object" && n !== null && "props" in n;

function find(node: unknown, pred: (e: El) => boolean): El | undefined {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = find(n, pred);
      if (hit) return hit;
    }
    return undefined;
  }
  if (!isEl(node)) return undefined;
  return pred(node) ? node : find(node.props.children, pred);
}
const need = (node: unknown, pred: (e: El) => boolean, what: string): El => {
  const hit = find(node, pred);
  if (!hit) throw new Error(`no ${what} in the editor`);
  return hit;
};

/** The editor mounted on the hook runtime. */
function mount(def: ComputedDef | undefined, send: (i: CommandInput) => Promise<CommandResult>) {
  rt.slots = [];
  const ctx: EditorContext = {
    names: formulaNames(ALL, DEFS),
    defs: DEFS,
    ...(def && { selfId: def.id }),
  };
  const props: ComputedEditorProps = {
    def,
    initial: def ? fromDef(def, ctx) : { ...prefill([]) },
    defs: DEFS,
    catalog: ALL,
    index: buildSearchIndex(ALL),
    position: { left: 0, top: 0 },
    sendCommand: send,
    onClose: () => {},
  };
  const draw = () => {
    rt.at = 0;
    return ComputedEditor(props) as unknown as El;
  };
  let tree = draw();
  const view = {
    redraw: () => {
      tree = draw();
    },
    save: () => need(tree, (e) => e.type === "button" && e.props.className === "primary", "Save"),
    del: () =>
      need(tree, (e) => e.type === "button" && e.props.className === "computed-delete", "Delete"),
    status: () => need(tree, (e) => e.type === "p" && e.props["aria-live"] === "polite", "status"),
    field: (label: string) => need(tree, (e) => e.props["aria-label"] === label, label),
    key: (key: string) => {
      tree.props.onKeyDown({
        key,
        target: { tagName: "TEXTAREA" },
        nativeEvent: { isComposing: false },
        stopPropagation() {},
        preventDefault() {},
      });
      view.redraw();
    },
    /** Lets a pending sendCommand settle, then draws again. */
    settle: async () => {
      await new Promise((r) => setTimeout(r, 0));
      view.redraw();
    },
  };
  return view;
}

const text = (e: El) => (typeof e.props.children === "string" ? e.props.children : "");
const tokens = (e: El) => String(e.props.className).split(/\s+/);

beforeEach(() => {
  rt.slots = [];
});

describe("computed editor view (improve-formula-editor round 1 findings)", () => {
  it("keeps Save enabled after a computed_in_use refusal and clears the message on the next key", async () => {
    const sent: CommandInput[] = [];
    const v = mount(C1, async (input) => {
      sent.push(input);
      return { ok: false, code: "computed_in_use", message: IN_USE };
    });
    // A valid edit of c1: Save is enabled, the line is empty.
    expect(v.save().props.disabled).toBe(false);
    expect(text(v.status())).toBe("");

    // Delete needs a second click; the refusal names the user, in the error line.
    v.del().props.onClick();
    v.redraw();
    expect(text(v.del())).toBe("Click again to delete");
    v.del().props.onClick();
    v.redraw();
    await v.settle();
    expect(sent).toEqual([{ type: "computed.remove", id: "c1" }]);
    expect(text(v.status())).toBe(IN_USE);
    expect(tokens(v.status())).not.toContain("quiet");
    // The refusal is about Delete only: the valid edit can still be saved.
    expect(v.save().props.disabled).toBe(false);

    // The next keystroke clears the message.
    v.key("ArrowRight");
    expect(text(v.status())).toBe("");
    expect(v.save().props.disabled).toBe(false);
  });

  it("clears a Delete refusal when the formula changes, too", async () => {
    const v = mount(C1, async () => ({ ok: false, code: "computed_in_use", message: IN_USE }));
    v.del().props.onClick();
    v.redraw();
    v.del().props.onClick();
    v.redraw();
    await v.settle();
    expect(text(v.status())).toBe(IN_USE);
    const formula = "MS_312h.DNMOT * 2";
    v.field("Formula").props.onChange({
      currentTarget: { value: formula, selectionStart: formula.length },
    });
    v.redraw();
    expect(text(v.status())).toBe("");
    expect(v.save().props.disabled).toBe(false);
  });

  it("blocks Save after a refused Save until something is changed", async () => {
    const v = mount(C1, async () => ({
      ok: false,
      code: "duplicate_name",
      message: "Name already used: Mine",
    }));
    v.save().props.onClick();
    v.redraw();
    await v.settle();
    expect(text(v.status())).toBe("Name already used: Mine");
    expect(v.save().props.disabled).toBe(true);
    v.field("Name").props.onChange({ target: { value: "Other" } });
    v.redraw();
    expect(text(v.status())).toBe("");
    expect(v.save().props.disabled).toBe(false);
  });

  it("shows the neutral line, not the error style, in an empty new editor", () => {
    const v = mount(undefined, async () => ({ ok: true, revision: 1 }));
    // Nothing to save yet, but nothing is shouted either: the line is muted until a key goes down.
    expect(v.save().props.disabled).toBe(true);
    expect(tokens(v.status())).toContain("quiet");
    expect(text(v.status())).toBe("Enter a formula");
    v.key("a");
    // From the first keystroke on, an empty formula reads as the error it is.
    expect(tokens(v.status())).not.toContain("quiet");
    expect(tokens(v.status())).toContain("computed-error");
  });

  it("styles a real error as an error even in a new editor", () => {
    const v = mount(undefined, async () => ({ ok: true, revision: 1 }));
    const formula = "DNMOX";
    v.field("Formula").props.onChange({
      currentTarget: { value: formula, selectionStart: formula.length },
    });
    v.redraw();
    expect(text(v.status())).toBe('Unknown signal "DNMOX" at 1');
    expect(tokens(v.status())).not.toContain("quiet");
  });
});
