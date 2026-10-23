import {
  type CommandInput,
  type ComputedDef,
  PRESETS,
  presetOf,
  type SignalInfo,
} from "@kipscope/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type EditorState,
  editorError,
  fromDef,
  prefill,
  usesB,
  withAuto,
} from "../src/computed/editor.ts";
import { HINTS } from "../src/help/hints.ts";

const info = (name: string, extra: Partial<SignalInfo> = {}): SignalInfo => ({
  id: `smart451/${name}`,
  dataRef: "smart451",
  name,
  ...extra,
});
const DNMOT = info("MS_312h.DNMOT", { unit: "rpm" });
const SPEED = info("MS_312h.SPEED", { unit: "rpm" });
const CURR = info("CPC_508h.PNHV_SupBat_Curr", { unit: "A" });
const CURR2 = info("CPC_508h.PNHV_Curr2", { unit: "A" });
const MODE = info("DRV_100h.MODE", { states: "labels" });
const ALL = [DNMOT, SPEED, CURR, CURR2, MODE];
const infoOf = (name: string) => ALL.find((s) => s.name === name);

const def = (id: string, name: string, extra: Partial<ComputedDef> = {}): ComputedDef => ({
  id,
  name,
  formula: "a - b",
  a: DNMOT.name,
  b: CURR.name,
  ...extra,
});

describe("computed editor state", () => {
  // spec computed-signals "Prefill from the selection"
  it("prefills from the selection", () => {
    const two = prefill([DNMOT, CURR]);
    expect(two).toMatchObject({ a: DNMOT.name, b: CURR.name, formula: "a - b" });
    const one = prefill([DNMOT]);
    expect(one).toMatchObject({ a: DNMOT.name, formula: "abs(a)" });
    expect(one.b).toBeUndefined();
    // Click order (L2): the first clicked signal is a, whatever its place in the list.
    const swapped = prefill([CURR, DNMOT]);
    expect(swapped).toMatchObject({ a: CURR.name, b: DNMOT.name, formula: "a - b" });
    expect(swapped.name).toBe("PNHV_SupBat_Curr \u2212 DNMOT");
    // A signal with states, or three or none: empty with Difference.
    for (const selected of [[MODE], [DNMOT, MODE], [DNMOT, SPEED, CURR], []]) {
      const empty = prefill(selected);
      expect(empty.formula, selected.map((s) => s.name).join()).toBe("a - b");
      expect(empty.a).toBeUndefined();
      expect(empty.b).toBeUndefined();
    }
    // Name and unit follow right away: the short names, the unit when both agree.
    expect(two.name).toBe("DNMOT − PNHV_SupBat_Curr");
    expect(two.unit).toBe("");
    expect(two.nameAuto && two.unitAuto).toBe(true);
    expect(prefill([DNMOT, SPEED]).unit).toBe("rpm");
    expect(one.name).toBe("abs(DNMOT)");
    expect(one.unit).toBe("rpm");
  });

  // spec computed-signals "Presets and formula both ways"
  it("maps preset and formula both ways", () => {
    const minimum = PRESETS.find((p) => p.id === "minimum");
    expect(minimum?.formula).toBe("min(a, b)");
    // Picking a preset writes its formula; typing a formula shows the preset it equals.
    expect(presetOf(minimum?.formula ?? "")).toBe("minimum");
    expect(presetOf("min( a,b )")).toBe("minimum");
    expect(presetOf("min(a, b) + 1")).toBe("custom");
    // The b picker is used by the formula, not by the one-input presets.
    expect(usesB("min(a, b)")).toBe(true);
    expect(usesB("abs(a)")).toBe(false);
  });

  // spec computed-signals "Live error blocks Save"
  it("shows the first error and blocks Save", () => {
    const valid: EditorState = {
      a: DNMOT.name,
      b: CURR.name,
      formula: "a - b",
      name: "Mine",
      unit: "",
      nameAuto: false,
      unitAuto: false,
    };
    expect(editorError(valid, [], infoOf)).toBeUndefined();
    // No b for a formula that uses it.
    const { b: _b, ...noB } = valid;
    expect(editorError(noB, [], infoOf)).toBe("Pick a signal for b");
    // The formula's own message.
    expect(editorError({ ...valid, formula: "a -" }, [], infoOf)).toBe("Unexpected end at 4");
    expect(editorError({ ...valid, formula: "a - c" }, [], infoOf)).toMatch(/^Unknown name "c"/);
    expect(editorError({ ...valid, formula: "" }, [], infoOf)).toBe("Enter a formula");
    // No a.
    const { a: _a, ...noA } = valid;
    expect(editorError(noA, [], infoOf)).toBe("Pick a signal for a");
    // The name of another definition, ignoring case; without another one the name is free.
    const others = [def("c1", "Diff")];
    expect(editorError({ ...valid, name: "Diff" }, others, infoOf)).toBe("Name already used");
    expect(editorError({ ...valid, name: "diff" }, others, infoOf)).toBe("Name already used");
    expect(editorError({ ...valid, name: "Diff" }, [], infoOf)).toBeUndefined();
    // Name rules of C6.
    expect(editorError({ ...valid, name: "" }, [], infoOf)).toBeDefined();
    expect(editorError({ ...valid, name: "x".repeat(61) }, [], infoOf)).toBe(
      "At most 60 characters",
    );
    expect(editorError({ ...valid, name: "x".repeat(60) }, [], infoOf)).toBeUndefined();
    // The formula comes first when several things are wrong.
    expect(editorError({ ...noB, formula: "a -", name: "Diff" }, others, infoOf)).toBe(
      "Unexpected end at 4",
    );
  });

  // spec computed-signals "Auto name and unit" (editor part)
  it("follows the formula with name and unit until typed", () => {
    const s = prefill([DNMOT, SPEED]);
    expect(s.name).toBe("DNMOT − SPEED");
    expect(s.unit).toBe("rpm");
    // A new formula: both follow.
    const scaled = withAuto({ ...s, formula: "a * 1" }, [], infoOf);
    expect(scaled.name).toBe("DNMOT × 1");
    expect(scaled.unit).toBe("");
    const min = withAuto({ ...s, formula: "min(a, b)" }, [], infoOf);
    expect(min.name).toBe("min(DNMOT, SPEED)");
    expect(min.unit).toBe("rpm");
    // New inputs: both follow.
    const swapped = withAuto({ ...s, b: CURR.name }, [], infoOf);
    expect(swapped.name).toBe("DNMOT − PNHV_SupBat_Curr");
    expect(swapped.unit).toBe("");
    // A typed name stays, the unit still follows; and the other way round.
    const typedName = withAuto(
      { ...s, name: "Mine", nameAuto: false, formula: "a * 1" },
      [],
      infoOf,
    );
    expect(typedName.name).toBe("Mine");
    expect(typedName.unit).toBe("");
    const typedUnit = withAuto(
      { ...s, unit: "rev", unitAuto: false, formula: "a * 1" },
      [],
      infoOf,
    );
    expect(typedUnit.unit).toBe("rev");
    expect(typedUnit.name).toBe("DNMOT × 1");
    // A taken auto name gets a number.
    const taken = [def("c1", "DNMOT − SPEED", { b: SPEED.name })];
    expect(withAuto(s, taken, infoOf).name).toBe("DNMOT − SPEED 2");
    const taken2 = [...taken, def("c2", "DNMOT − SPEED 2", { b: SPEED.name })];
    expect(withAuto(s, taken2, infoOf).name).toBe("DNMOT − SPEED 3");
    // While the formula does not parse, name and unit stay.
    const broken = withAuto({ ...s, formula: "a -" }, [], infoOf);
    expect(broken.name).toBe(s.name);
    expect(broken.unit).toBe(s.unit);
  });

  it("follows only where an edited definition still has the auto value", () => {
    const auto = fromDef(def("c1", "DNMOT − PNHV_SupBat_Curr"), infoOf);
    expect(auto).toMatchObject({
      a: DNMOT.name,
      b: CURR.name,
      formula: "a - b",
      name: "DNMOT − PNHV_SupBat_Curr",
      unit: "",
      nameAuto: true,
      unitAuto: true,
    });
    const typed = fromDef(def("c1", "My difference", { unit: "rpm" }), infoOf);
    expect(typed.name).toBe("My difference");
    expect(typed.nameAuto).toBe(false);
    expect(typed.unit).toBe("rpm");
    expect(typed.unitAuto).toBe(false);
    // The stored unit equals the auto unit (both inputs in A): the field follows.
    const same = fromDef(def("c2", "Currents", { a: CURR.name, b: CURR2.name, unit: "A" }), infoOf);
    expect(same.unitAuto).toBe(true);
    expect(same.nameAuto).toBe(false);
  });
});

describe("computed editor markup", () => {
  afterEach(() => {
    vi.doUnmock("react");
    vi.resetModules();
  });

  /** The picker with its list open: SSR runs no effects, so the first `false` state is forced to `true`. */
  async function openPicker(signals: SignalInfo[]) {
    vi.resetModules();
    vi.doMock("react", async (importOriginal) => {
      const actual = await importOriginal<typeof import("react")>();
      const real = actual.useState;
      // Always the real hook (same order); only the first `false` state starts as `true`.
      const useState = ((init: unknown) => {
        const state = real(init as never);
        return init === false ? [true, state[1]] : state;
      }) as unknown as typeof actual.useState;
      return { ...actual, useState };
    });
    const { SignalPicker } = await import("../src/computed/ComputedEditor.tsx");
    return renderToStaticMarkup(
      createElement(SignalPicker, {
        label: "a",
        value: undefined,
        signals,
        infoOf: (name: string) => signals.find((s) => s.name === name),
        onPick: () => {},
      }),
    );
  }

  // spec computed-signals "State signals not pickable"
  it("refuses state signals in the picker", async () => {
    const html = await openPicker([DNMOT, MODE]);
    const options = [...html.matchAll(/<div\b([^>]*\brole="option"[^>]*)>(.*?)<\/div>/gs)].map(
      (m) => ({ tag: m[1] ?? "", inner: m[2] ?? "" }),
    );
    expect(options).toHaveLength(2);
    const numeric = options.find((o) => o.inner.includes("DNMOT"));
    const states = options.find((o) => o.inner.includes("MODE"));
    expect(states?.tag).toMatch(/class="[^"]*\bdisabled\b/);
    expect(states?.tag).toContain('aria-disabled="true"');
    expect(states?.tag).toContain(`title="${HINTS.computedNumericOnly("MODE")}"`);
    expect(HINTS.computedNumericOnly("MODE")).toBe("MODE has states: pick a numeric signal");
    expect(numeric?.tag).not.toMatch(/\bdisabled\b/);
    expect(numeric?.tag).not.toContain("aria-disabled");
  });

  it("lists at most eight rows", async () => {
    const many = Array.from({ length: 12 }, (_, i) => info(`ECU_${100 + i}h.SIG${i}`));
    const html = await openPicker(many);
    expect(html.match(/role="option"/g)).toHaveLength(8);
  });
});

describe("computed editor panel", () => {
  async function panel(props: { def?: ComputedDef; initial: EditorState }) {
    const { ComputedEditor } = await import("../src/computed/ComputedEditor.tsx");
    const sendCommand = async (_: CommandInput) => ({
      ok: false as const,
      code: "x",
      message: "y",
    });
    return renderToStaticMarkup(
      createElement(ComputedEditor, {
        ...props,
        defs: props.def ? [props.def] : [],
        catalog: ALL,
        position: { left: 240, top: 120 },
        sendCommand,
        onClose: () => {},
      } as never),
    );
  }

  it("renders a dialog with the one primary button, Delete only when editing", async () => {
    const created = await panel({ initial: prefill([DNMOT, CURR]) });
    expect(created).toMatch(/role="dialog"/);
    expect(created).toContain("New computed signal");
    // Exactly one primary: Save; no Delete for a new definition.
    expect(created.match(/class="primary"/g)).toHaveLength(1);
    expect(created).not.toContain("Delete");
    expect(created).toContain("Cancel");
    // The error line is there with its height reserved, also when empty.
    expect(created).toMatch(/class="computed-error"/);

    const d = def("c1", "Diff");
    const edited = await panel({ def: d, initial: fromDef(d, infoOf) });
    expect(edited).toContain("Edit computed signal");
    expect(edited).toContain("Delete");
    expect(edited.match(/class="primary"/g)).toHaveLength(1);
  });

  it("disables Save while there is an error and b while the formula has none", async () => {
    const broken = await panel({ initial: { ...prefill([DNMOT, CURR]), formula: "a -" } });
    expect(broken).toContain("Unexpected end at 4");
    expect(broken).toMatch(/<button\b[^>]*class="primary"[^>]*disabled/);
    const abs = await panel({ initial: prefill([DNMOT]) });
    // One-input formula: the picker for b is disabled.
    const pickerB = /<input\b[^>]*aria-label="Signal for b"[^>]*>/.exec(abs);
    expect(pickerB?.[0]).toMatch(/\bdisabled\b/);
  });
});
