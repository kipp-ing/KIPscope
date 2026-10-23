import {
  bindFormula,
  type CommandInput,
  type ComputedDef,
  computedParams,
  computedRef,
  formulaName,
  freeName,
  inferUnit,
  parseFormula,
  parseSignalId,
  type SignalInfo,
  shortSignalName,
} from "@kipscope/shared";
import { CliError } from "./output.ts";
import { type Lookups, NAME_LIMIT, nameMatches } from "./refs.ts";

/**
 * The `calc …` forms (add-computed-signals C13); SIGNALs and ID|NAME as given, resolved when the
 * call runs. `noB`: `--no-b`, the edit drops b.
 */
export type CalcInvocation =
  | { kind: "calc"; action: "list" }
  | {
      kind: "calc";
      action: "add";
      formula: string;
      a: string;
      b?: string;
      name?: string;
      unit?: string;
    }
  | {
      kind: "calc";
      action: "edit";
      target: string;
      formula?: string;
      a?: string;
      b?: string;
      noB?: true;
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
  switch (invocation.action) {
    case "add": {
      const parsed = parseFormula(invocation.formula);
      if (!parsed.ok) throw new CliError("rejected", "invalid_formula", parsed.message);
      const bound = bindFormula(parsed, {
        a: invocation.a,
        ...(invocation.b !== undefined && { b: invocation.b }),
      });
      if (!bound.ok) throw new CliError("rejected", "invalid_formula", bound.message);
      const a = await input(bound.a, l);
      const b = bound.b === undefined ? undefined : await input(bound.b, l);
      const name =
        invocation.name ??
        freeName(formulaName(bound.ast, short(a), b && short(b)), await computedDefs(l));
      const unit = invocation.unit ?? inferUnit(bound.ast, a.info?.unit, b?.info?.unit);
      return {
        type: "computed.add",
        name,
        formula: invocation.formula,
        a: a.name,
        ...(b !== undefined && { b: b.name }),
        ...(unit !== undefined && { unit }),
      };
    }
    case "edit": {
      // The stored definition with the given parts replaced; name and unit are not re-derived.
      const def = target(invocation.target, await computedDefs(l));
      const a = invocation.a === undefined ? def.a : (await input(invocation.a, l)).name;
      const b = invocation.noB
        ? undefined
        : invocation.b === undefined
          ? def.b
          : (await input(invocation.b, l)).name;
      const unit = invocation.unit ?? def.unit;
      return {
        type: "computed.update",
        id: def.id,
        name: invocation.name ?? def.name,
        formula: invocation.formula ?? def.formula,
        a,
        ...(b !== undefined && { b }),
        ...(unit !== undefined && { unit }),
      };
    }
    case "rm":
      return {
        type: "computed.remove",
        id: target(invocation.target, await computedDefs(l)).id,
      };
  }
}

/**
 * The `formula`, `a`, `b` query parameters of a computed signal ID (`smart451/=c7`) from the
 * workspace's definition; none for any other ID. A computed ID without definition is refused with
 * unknown_computed, nothing sent.
 */
export async function computedQuery(signal: string, l: Lookups): Promise<Record<string, string>> {
  const ref = computedRef(signal);
  if (ref === undefined) return {};
  const def = (await computedDefs(l)).find((d) => d.id === ref.id);
  if (def === undefined) {
    throw new CliError(
      "rejected",
      "unknown_computed",
      `no computed signal ${ref.id} in this workspace`,
    );
  }
  const { formula, a, b } = computedParams(def);
  return { formula, a, ...(b !== undefined && { b }) };
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

/**
 * A SIGNAL as an input name (C13 after "Signal references"): a full ID's name part; a bare name's
 * one listed name (several: ambiguous_signal; none: unknown_signal). `info`: the catalog entry the
 * defaults of name and unit come from, absent when the list does not hold it.
 */
async function input(text: string, l: Lookups): Promise<{ name: string; info?: SignalInfo }> {
  const id = parseSignalId(text);
  if (id !== undefined) {
    const info = (await l.search(id.name, NAME_LIMIT)).items.find((s) => s.id === text);
    return { name: id.name, ...(info !== undefined && { info }) };
  }
  const items = (await l.search(text, NAME_LIMIT)).items.filter((s) => nameMatches(s.name, text));
  const names = [...new Set(items.map((s) => s.name))];
  if (names.length === 0) {
    throw new CliError("rejected", "unknown_signal", `no signal named "${text}"`);
  }
  if (names.length > 1) {
    const candidates = names.sort();
    throw new CliError(
      "rejected",
      "ambiguous_signal",
      `"${text}" names ${candidates.length} signals: ${candidates.join(", ")}`,
      candidates,
    );
  }
  return { name: names[0] as string, info: items[0] as SignalInfo };
}

/** The input's shown name after its first "." (C12 auto name). */
function short(input: { name: string; info?: SignalInfo }): string {
  return shortSignalName(input.info?.displayName ?? input.name);
}
