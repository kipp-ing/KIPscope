import {
  type ComputedDef,
  checkFormula,
  type FormulaNames,
  type FormulaNode,
  formulaName,
  freeName,
  inferUnit,
  MAX_COMPUTED_NAME,
  MAX_COMPUTED_UNIT,
  MAX_FORMULA_SIGNALS,
  parseFormula,
  quoteName,
  resolveFormula,
  type SignalInfo,
  shortSignalName,
} from "@kipscope/shared";

/**
 * The editor's fields (F11): the formula as typed (names typed, F2), name and unit. `nameAuto` and
 * `unitAuto`: the field follows the formula until the user types in it (F7).
 */
export interface EditorState {
  formula: string;
  name: string;
  unit: string;
  nameAuto: boolean;
  unitAuto: boolean;
}

/** What typed names resolve against and the definitions a formula is checked with (F2, F5). */
export interface EditorContext {
  names: FormulaNames;
  defs: readonly ComputedDef[];
  /** The definition being edited; absent for a new one. */
  selfId?: string;
}

/**
 * The names of the list in use (F2): its catalog signals once per name (computed infos left out)
 * and the workspace's definitions.
 */
export function formulaNames(
  items: readonly SignalInfo[],
  defs: readonly ComputedDef[],
): FormulaNames {
  const seen = new Set<string>();
  const signals: { name: string; unit?: string; states: boolean }[] = [];
  for (const s of items) {
    if (s.computed !== undefined || seen.has(s.name)) continue;
    seen.add(s.name);
    signals.push({
      name: s.name,
      ...(s.unit !== undefined && { unit: s.unit }),
      states: s.states !== undefined,
    });
  }
  const computed = defs.map((d) => ({
    name: d.name,
    ...(d.unit !== undefined && { unit: d.unit }),
  }));
  return { signals, computed };
}

/**
 * F12 prefill from the selection in click order (L2): numeric catalog signals and available computed
 * signals, at most MAX_FORMULA_SIGNALS; 1 → `abs(X)`, 2 → `X - Y`, more → `X + Y + Z …`; the caret
 * at the end. Name and unit follow (`withAuto`).
 */
export function prefill(selected: readonly SignalInfo[]): EditorState & { caret: number } {
  const names = selected
    .filter((s) =>
      s.computed !== undefined ? s.computed.unavailable === undefined : s.states === undefined,
    )
    .slice(0, MAX_FORMULA_SIGNALS)
    .map((s) => quoteName(s.computed !== undefined ? (s.displayName ?? s.name) : s.name));
  const formula =
    names.length === 0
      ? ""
      : names.length === 1
        ? `abs(${names[0]})`
        : names.length === 2
          ? `${names[0]} - ${names[1]}`
          : names.join(" + ");
  return { formula, name: "", unit: "", nameAuto: true, unitAuto: true, caret: formula.length };
}

/** The other definitions (the edited one left out). */
const othersOf = (ctx: EditorContext) => ctx.defs.filter((d) => d.id !== ctx.selfId);

/** Auto name (without the ` 2` suffix) and unit of a canonical AST (F7). */
function autoOf(ast: FormulaNode, ctx: EditorContext): { name: string; unit: string } {
  const defOf = (name: string) => ctx.defs.find((d) => d.name === name);
  const signalOf = (name: string) => ctx.names.signals.find((s) => s.name === name);
  const name = formulaName(ast, (n) => (defOf(n) ? n : shortSignalName(n)));
  const unit = inferUnit(ast, (n) => {
    const def = defOf(n);
    return def ? def.unit : signalOf(n)?.unit;
  });
  return {
    name: name.length > MAX_COMPUTED_NAME ? `${name.slice(0, MAX_COMPUTED_NAME - 1)}…` : name,
    unit: unit ?? "",
  };
}

/** The editor state of a stored definition; a field follows only if it equals its auto value. */
export function fromDef(def: ComputedDef, ctx: EditorContext): EditorState {
  const parsed = parseFormula(def.formula);
  const auto = parsed.ok ? autoOf(parsed.ast, ctx) : undefined;
  const unit = def.unit ?? "";
  return {
    formula: def.formula,
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

const sameName = (x: string, y: string) => x.trim().toLowerCase() === y.trim().toLowerCase();

/** Control characters are refused in names and units (C6), as the shared schema does. */
const CONTROL = /\p{Cc}/u;

/** The listed signal a definition name would hide (F2 guard), case ignored. */
const signalNamed = (name: string, ctx: EditorContext) =>
  ctx.names.signals.find((x) => sameName(x.name, name));

/**
 * The canonical formula of `s` checked with the definitions (F11 live validation): typed names
 * resolved (F2), then `checkFormula` with the edited definition replaced by the editor's state
 * (cycles, limits with nested ones, a user pushed past a limit, a rename reaching its users).
 */
function checked(
  s: EditorState,
  ctx: EditorContext,
): { ok: true; formula: string; ast: FormulaNode } | { ok: false; message: string } {
  const resolved = resolveFormula(s.formula, ctx.names);
  if (!resolved.ok) return resolved;
  const self = ctx.defs.find((d) => d.id === ctx.selfId);
  // A name the name rules refuse anyway keeps the stored one, so it reads as no cycle here.
  const typed = s.name.trim();
  const name = typed === "" || signalNamed(typed, ctx) ? (self?.name ?? "") : typed;
  const signal = (n: string) => {
    const found = ctx.names.signals.find((x) => x.name === n);
    return found === undefined ? "unknown" : found.states ? "states" : "numeric";
  };
  const result = checkFormula(
    resolved.formula,
    ctx.defs,
    self ? { id: self.id, name } : { name },
    signal,
  );
  return result.ok ? { ok: true, formula: result.formula, ast: resolved.ast } : result;
}

/**
 * The first error of `s` (F11), undefined when Save may send it: the formula (F1, F2, F4 messages),
 * then name (C6, F2 guard) and unit.
 */
export function editorError(s: EditorState, ctx: EditorContext): string | undefined {
  const formula = checked(s, ctx);
  if (!formula.ok) return formula.message;
  const name = s.name.trim();
  if (name === "") return "Enter a name";
  if (name.length > MAX_COMPUTED_NAME) return `At most ${MAX_COMPUTED_NAME} characters`;
  if (CONTROL.test(name)) return "No control characters in the name";
  if (othersOf(ctx).some((d) => sameName(d.name, name))) return "Name already used";
  const signal = signalNamed(name, ctx);
  if (signal) return `Name used by a signal: ${signal.name}`;
  const unit = s.unit.trim();
  if (unit.length > MAX_COMPUTED_UNIT) return `Unit: at most ${MAX_COMPUTED_UNIT} characters`;
  if (CONTROL.test(unit)) return "No control characters in the unit";
  return undefined;
}

/**
 * Name and unit after a change of the formula (F7): a field with its auto flag follows the auto
 * value (a taken name gets ` 2`, ` 3`, …); while the formula does not resolve, both stay.
 */
export function withAuto(s: EditorState, ctx: EditorContext): EditorState {
  if (!s.nameAuto && !s.unitAuto) return s;
  const resolved = resolveFormula(s.formula, ctx.names);
  if (!resolved.ok) return s;
  const auto = autoOf(resolved.ast, ctx);
  return {
    ...s,
    ...(s.nameAuto ? { name: freeName(auto.name, othersOf(ctx)) } : {}),
    ...(s.unitAuto ? { unit: auto.unit } : {}),
  };
}

/** The canonical formula Save sends (F11), undefined while the formula does not check. */
export function canonicalFormula(s: EditorState, ctx: EditorContext): string | undefined {
  const formula = checked(s, ctx);
  return formula.ok ? formula.formula : undefined;
}
