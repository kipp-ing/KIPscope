import {
  type CommandInput,
  type ComputedDef,
  checkFormula,
  computedParams,
  computedRef,
  type FormulaNames,
  type FormulaNode,
  formulaName,
  freeName,
  inferUnit,
  resolveFormula,
  type SignalInfo,
  shortSignalName,
  tokenizeFormula,
} from "@kipscope/shared";
import { CliError } from "./output.ts";
import { type Lookups, NAME_LIMIT } from "./refs.ts";

/**
 * The `calc …` forms (improve-formula-editor F13); FORMULA and ID|NAME as given, resolved when the
 * call runs.
 */
export type CalcInvocation =
  | { kind: "calc"; action: "list" }
  | { kind: "calc"; action: "add"; formula: string; name?: string; unit?: string }
  | {
      kind: "calc";
      action: "edit";
      target: string;
      formula?: string;
      name?: string;
      unit?: string;
    }
  | { kind: "calc"; action: "rm"; target: string };

/** The workspace's definitions in creation order (C6). */
export async function computedDefs(l: Lookups): Promise<ComputedDef[]> {
  return (await l.workspace()).workspace.computed ?? [];
}

/** The command of `calc add|edit|rm`; refusals throw CliError before anything is sent. */
export async function calcCommand(
  invocation: Exclude<CalcInvocation, { action: "list" }>,
  l: Lookups,
): Promise<CommandInput> {
  const defs = await computedDefs(l);
  switch (invocation.action) {
    case "add": {
      const typed = await formula(invocation.formula, defs, l);
      const name =
        invocation.name ??
        freeName(
          formulaName(typed.ast, (n) => typed.label.get(n) ?? shortSignalName(n)),
          defs,
        );
      checked(typed.formula, defs, { name });
      const unit = invocation.unit ?? inferUnit(typed.ast, (n) => typed.unit.get(n));
      return {
        type: "computed.add",
        name,
        formula: typed.formula,
        ...(unit !== undefined && { unit }),
      };
    }
    case "edit": {
      // The stored definition with the given parts replaced; name and unit are not re-derived.
      const def = target(invocation.target, defs);
      const name = invocation.name ?? def.name;
      let text = def.formula;
      if (invocation.formula !== undefined) {
        text = (await formula(invocation.formula, defs, l)).formula;
        checked(text, defs, { id: def.id, name });
      }
      const unit = invocation.unit ?? def.unit;
      return {
        type: "computed.update",
        id: def.id,
        name,
        formula: text,
        ...(unit !== undefined && { unit }),
      };
    }
    case "rm":
      return { type: "computed.remove", id: target(invocation.target, defs).id };
  }
}

/**
 * The `formula` query parameter of a computed signal ID (`smart451/=c7`): the flattened formula of
 * the workspace's definition (F13); none for any other ID. A computed ID without a definition, or
 * one that does not flatten, is refused with unknown_computed, nothing sent.
 */
export async function computedQuery(signal: string, l: Lookups): Promise<Record<string, string>> {
  const ref = computedRef(signal);
  if (ref === undefined) return {};
  const defs = await computedDefs(l);
  const def = defs.find((d) => d.id === ref.id);
  if (def === undefined) {
    throw new CliError(
      "rejected",
      "unknown_computed",
      `no computed signal ${ref.id} in this workspace`,
    );
  }
  const params = computedParams(def, defs);
  if (params === undefined) {
    throw new CliError(
      "rejected",
      "unknown_computed",
      `computed signal "${def.name}" uses a computed signal that is missing or a cycle`,
    );
  }
  return { formula: params.formula };
}

/**
 * A typed FORMULA (F2, F13) resolved over the workspace's signal list and definitions: every name
 * token is looked up through the search (exact and short-name matches come first, D-022), then
 * `resolveFormula` gives the canonical text. `label` and `unit` per canonical name feed the
 * defaults of name and unit (F7). Refusals throw with resolveFormula's code and candidates.
 */
async function formula(
  text: string,
  defs: readonly ComputedDef[],
  l: Lookups,
): Promise<{
  formula: string;
  ast: FormulaNode;
  label: Map<string, string>;
  unit: Map<string, string>;
}> {
  const queries = new Set<string>();
  for (const token of tokenizeFormula(text)) {
    if (token.kind !== "name" || token.name === "") continue;
    const lower = token.name.toLowerCase();
    if (!defs.some((d) => d.name.toLowerCase() === lower)) queries.add(token.name);
  }
  const found = new Map<string, SignalInfo>();
  const pages = await Promise.all([...queries].map((q) => l.search(q, NAME_LIMIT)));
  for (const item of pages.flatMap((p) => p.items)) {
    if (!found.has(item.name)) found.set(item.name, item);
  }
  const names: FormulaNames = {
    signals: [...found.values()].map((s) => ({
      name: s.name,
      states: s.states !== undefined,
      ...(s.unit !== undefined && { unit: s.unit }),
    })),
    computed: defs.map((d) => ({ name: d.name, ...(d.unit !== undefined && { unit: d.unit }) })),
  };
  const resolved = resolveFormula(text, names);
  if (!resolved.ok) {
    throw new CliError("rejected", resolved.code, resolved.message, resolved.candidates);
  }
  const label = new Map<string, string>();
  const unit = new Map<string, string>();
  for (const s of found.values()) {
    label.set(s.name, shortSignalName(s.name));
    if (s.unit !== undefined) unit.set(s.name, s.unit);
  }
  for (const d of defs) {
    label.set(d.name, d.name);
    if (d.unit !== undefined) unit.set(d.name, d.unit);
  }
  return { formula: resolved.formula, ast: resolved.ast, label, unit };
}

/** The F4 checks (cycle, nesting limits) of a canonical formula; its names are resolved already. */
function checked(text: string, defs: readonly ComputedDef[], self: { id?: string; name: string }) {
  const result = checkFormula(text, defs, self, () => "unchecked");
  if (!result.ok) throw new CliError("rejected", result.code, result.message);
}

/** ID|NAME of `calc edit|rm`: an ID, else a name ignoring case (unknown_computed). */
function target(text: string, defs: readonly ComputedDef[]): ComputedDef {
  const lower = text.toLowerCase();
  const def = defs.find((d) => d.id === text) ?? defs.find((d) => d.name.toLowerCase() === lower);
  if (def === undefined) {
    throw new CliError("rejected", "unknown_computed", `no computed signal "${text}"`);
  }
  return def;
}
