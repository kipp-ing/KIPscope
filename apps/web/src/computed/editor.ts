import {
  bindFormula,
  type ComputedDef,
  type FormulaNode,
  formulaName,
  freeName,
  inferUnit,
  MAX_COMPUTED_NAME,
  MAX_COMPUTED_UNIT,
  PRESETS,
  type PresetId,
  parseFormula,
  type SignalInfo,
  shortSignalName,
  shownName,
} from "@kipscope/shared";
import { HINTS } from "../help/hints.ts";

/**
 * The editor's fields (add-computed-signals C12): `a` and `b` are signal names (no data ref), as
 * a definition stores them; `b` stays in its field when the formula does not use it. `nameAuto`
 * and `unitAuto`: the field follows inputs and formula until the user types in it.
 */
export interface EditorState {
  a?: string;
  b?: string;
  formula: string;
  name: string;
  unit: string;
  nameAuto: boolean;
  unitAuto: boolean;
}

type InfoOf = (name: string) => SignalInfo | undefined;

const DIFFERENCE = "a - b";
const ABSOLUTE = "abs(a)";

/** A catalog signal the pickers accept: not computed, without states. */
const pickable = (s: SignalInfo) => s.computed === undefined && s.states === undefined;

/** The input's shown name after its first "." (C12 auto name). */
const shortOf = (name: string | undefined, infoOf: InfoOf) =>
  name === undefined ? undefined : shortSignalName(shownName(infoOf(name) ?? { name }));

/**
 * C12 prefill (lead pick 2): one or two selected catalog signals without states, in click order
 * (`selectedInClickOrder`, first clicked = `a`, L2), give `a` (and `b`) with Absolute or
 * Difference; anything else an empty editor with Difference. Name and unit follow (`withAuto`
 * against the other definitions refines the name).
 */
export function prefill(selected: readonly SignalInfo[]): EditorState {
  const empty: EditorState = {
    formula: DIFFERENCE,
    name: "",
    unit: "",
    nameAuto: true,
    unitAuto: true,
  };
  if (selected.length === 0 || selected.length > 2 || !selected.every(pickable)) return empty;
  const [a, b] = selected as [SignalInfo, SignalInfo | undefined];
  const s: EditorState = {
    ...empty,
    a: a.name,
    ...(b ? { b: b.name } : {}),
    formula: b ? DIFFERENCE : ABSOLUTE,
  };
  const infoOf: InfoOf = (name) => selected.find((x) => x.name === name);
  return withAuto(s, [], infoOf);
}

/** The bound formula of `s`, or undefined while it does not parse or bind. */
function bound(s: Pick<EditorState, "formula" | "a" | "b">): FormulaNode | undefined {
  const parsed = bindFormula(parseFormula(s.formula), {
    ...(s.a !== undefined ? { a: s.a } : {}),
    ...(s.b !== undefined ? { b: s.b } : {}),
  });
  return parsed.ok ? parsed.ast : undefined;
}

/** Auto name and unit of a bound formula, the name without the ` 2` suffix. */
function autoOf(
  ast: FormulaNode,
  s: Pick<EditorState, "a" | "b">,
  infoOf: InfoOf,
): { name: string; unit: string } {
  const aName = shortOf(s.a, infoOf) ?? "a";
  const name = formulaName(ast, aName, shortOf(s.b, infoOf));
  const aUnit = s.a === undefined ? undefined : infoOf(s.a)?.unit;
  const bUnit = s.b === undefined ? undefined : infoOf(s.b)?.unit;
  return { name, unit: inferUnit(ast, aUnit, bUnit) ?? "" };
}

const sameName = (x: string, y: string) => x.trim().toLowerCase() === y.trim().toLowerCase();

/** The editor state of a stored definition; a field follows only if it equals its auto value. */
export function fromDef(def: ComputedDef, infoOf: InfoOf): EditorState {
  const s = {
    a: def.a,
    ...(def.b !== undefined ? { b: def.b } : {}),
    formula: def.formula,
  };
  const ast = bound(s);
  const auto = ast ? autoOf(ast, s, infoOf) : undefined;
  const unit = def.unit ?? "";
  return {
    ...s,
    name: def.name,
    unit,
    // A stored auto name may carry the ` 2` it got when its base was taken.
    nameAuto:
      auto !== undefined &&
      (def.name === auto.name ||
        (def.name.startsWith(`${auto.name} `) &&
          /^\d+$/.test(def.name.slice(auto.name.length + 1)))),
    unitAuto: auto !== undefined && auto.unit === unit,
  };
}

/** Control characters are refused in names and units (C6), as the shared schema does. */
const CONTROL = /\p{Cc}/u;

/**
 * The first error of `s` (C12 live validation), undefined when Save may send it: the formula
 * (C1 messages), its inputs, then name and unit (C6). `others`: the other definitions.
 */
export function editorError(
  s: EditorState,
  others: readonly ComputedDef[],
  infoOf: InfoOf,
): string | undefined {
  const parsed = parseFormula(s.formula);
  if (!parsed.ok) return parsed.message;
  const b = bindFormula(parsed, {
    ...(s.a !== undefined ? { a: s.a } : {}),
    ...(s.b !== undefined ? { b: s.b } : {}),
  });
  if (!b.ok) return b.message;
  for (const input of [b.a, b.b]) {
    if (input === undefined) continue;
    const info = infoOf(input);
    if (info?.states !== undefined) return HINTS.computedNumericOnly(shortSignalName(input));
  }
  const name = s.name.trim();
  if (name === "") return "Enter a name";
  if (name.length > MAX_COMPUTED_NAME) return `At most ${MAX_COMPUTED_NAME} characters`;
  if (CONTROL.test(name)) return "No control characters in the name";
  if (others.some((d) => sameName(d.name, name))) return "Name already used";
  const unit = s.unit.trim();
  if (unit.length > MAX_COMPUTED_UNIT) return `Unit: at most ${MAX_COMPUTED_UNIT} characters`;
  if (CONTROL.test(unit)) return "No control characters in the unit";
  return undefined;
}

/**
 * Name and unit after a change of inputs or formula (C12): a field with its auto flag follows the
 * auto value (a taken name gets ` 2`, ` 3`, …); while the formula does not bind, both stay.
 */
export function withAuto(
  s: EditorState,
  others: readonly ComputedDef[],
  infoOf: InfoOf,
): EditorState {
  if (!s.nameAuto && !s.unitAuto) return s;
  const ast = bound(s);
  if (!ast) return s;
  const auto = autoOf(ast, s, infoOf);
  return {
    ...s,
    ...(s.nameAuto ? { name: freeName(auto.name, others) } : {}),
    ...(s.unitAuto ? { unit: auto.unit } : {}),
  };
}

/** Picking a preset writes its formula; Custom keeps the text (C12). */
export function withPreset(s: EditorState, id: PresetId): EditorState {
  const formula = PRESETS.find((p) => p.id === id)?.formula;
  return formula === undefined ? s : { ...s, formula };
}

/** Whether the formula of `s` uses `b` (picker b disabled otherwise, its value kept). */
export function usesB(formula: string): boolean {
  const parsed = parseFormula(formula);
  return parsed.ok ? parsed.vars.has("b") : /\bb\b/.test(formula);
}

/** The command body Save sends; `b` only when the formula uses it, `unit` only when set. */
export function commandBody(s: EditorState): {
  name: string;
  formula: string;
  a: string;
  b?: string;
  unit?: string;
} {
  const unit = s.unit.trim();
  return {
    name: s.name.trim(),
    formula: s.formula.trim(),
    a: s.a ?? "",
    ...(s.b !== undefined && usesB(s.formula) ? { b: s.b } : {}),
    ...(unit !== "" ? { unit } : {}),
  };
}
