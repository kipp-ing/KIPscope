import { z } from "zod";
import type { ApplyContext } from "./apply.ts";
import { type CursorValue, evaluateAt, type Point } from "./cursor.ts";
import {
  compileFormula,
  type FormulaNode,
  formulaInputs,
  formulaText,
  MAX_FLAT_LENGTH,
  MAX_FLAT_NODES,
  MAX_FORMULA_SIGNALS,
  parseFormula,
  renameInFormula,
} from "./formula.ts";
import { GAP_PERIODS, type GapInfo, NO_GAPS, type SignalGaps, signalGaps } from "./gaps.ts";
import { parseSignalId, type SignalInfo, signalId } from "./signals.ts";
import type { ValuesMode } from "./workspace.ts";

/** Definitions per workspace (design Numbers). */
export const MAX_COMPUTED = 20;
export const MAX_COMPUTED_NAME = 60;
export const MAX_COMPUTED_UNIT = 20;
/** Fallback bound for all inputs of one request together (C8, D-107). */
export const COMPUTED_MAX_ROWS = 200_000;

/** A computed signal of the workspace (C6, F5); its formula is canonical (F2). */
export interface ComputedDef {
  /** `c<nextId>`; an edit gives a new one. Never shown in the UI. */
  id: string;
  name: string;
  /** Canonical: names are definitions of the workspace (exact) or source signals without data ref. */
  formula: string;
  /** Absent: none. */
  unit?: string;
}

/** What a series/value/extent request carries (F8): the formula flattened over source signals. */
export interface ComputedParams {
  formula: string;
}

const noControl = (s: string) => !/\p{Cc}/u.test(s);

/** C6: 1–60 characters, trimmed, no control characters. */
export const ComputedName: z.ZodType<string> = z
  .string()
  .trim()
  .min(1)
  .max(MAX_COMPUTED_NAME)
  .refine(noControl, { message: "no line breaks or control characters" });
/** C6: at most 20 characters, trimmed, no control characters; "" allowed (clears). */
export const ComputedUnit: z.ZodType<string> = z
  .string()
  .trim()
  .max(MAX_COMPUTED_UNIT)
  .refine(noControl, { message: "no line breaks or control characters" });
const sameName = (x: string, y: string) => x.trim().toLowerCase() === y.trim().toLowerCase();

/**
 * C12: `base`, else `base 2`, `base 3`, … not taken by `others` (trimmed, case-insensitive); the
 * head cut with "…" so a suffixed name fits MAX_COMPUTED_NAME.
 */
export function freeName(base: string, others: readonly { name: string }[]): string {
  const taken = (n: string) => others.some((d) => sameName(d.name, n));
  if (!taken(base)) return base;
  for (let i = 2; ; i++) {
    const suffix = ` ${i}`;
    const room = MAX_COMPUTED_NAME - suffix.length;
    const head = base.length <= room ? base : `${base.slice(0, room - 1)}…`;
    if (!taken(head + suffix)) return head + suffix;
  }
}

/** Whether the ID's name part starts with "=". */
export const isComputedId = (id: string): boolean =>
  parseSignalId(id)?.name.startsWith("=") ?? false;

/** "smart451/=c7" → {dataRef: "smart451", id: "c7"}; undefined for a plain or malformed ID. */
export function computedRef(id: string): { dataRef: string; id: string } | undefined {
  const parsed = parseSignalId(id);
  if (!parsed?.name.startsWith("=") || parsed.name.length < 2) return undefined;
  return { dataRef: parsed.dataRef, id: parsed.name.slice(1) };
}

export const computedSignalId = (dataRef: string, id: string): string => `${dataRef}/=${id}`;

/** Why a formula does not flatten (F4); `user` names a definition pushed over by an edit. */
type FlatFailure =
  | { kind: "cycle"; chain: string[] }
  | { kind: "parse"; name: string; message: string }
  | { kind: "nodes" }
  | { kind: "signals"; count: number }
  | { kind: "length" };
type Flat = { ok: true; ast: FormulaNode; sources: string[] } | { ok: false; failure: FlatFailure };

function flatMessage(f: FlatFailure, user?: string): string {
  const inUser = user === undefined ? "" : ` in "${user}"`;
  switch (f.kind) {
    case "cycle":
      return `Cycle: ${f.chain.map((n) => `"${n}"`).join(" → ")}`;
    case "parse":
      return `${f.message} in "${f.name}"`;
    case "nodes":
      return `Too complex with nested signals${inUser}: at most ${MAX_FLAT_NODES} parts`;
    case "signals":
      return `At most ${MAX_FORMULA_SIGNALS} signals${inUser} (with nested ones): ${f.count}`;
    case "length":
      return `Too long with nested signals${inUser}: at most ${MAX_FLAT_LENGTH.toLocaleString("en-US")} characters`;
  }
}

/** Thrown inside flatten only. */
class FlatStop {
  readonly failure: FlatFailure;
  constructor(failure: FlatFailure) {
    this.failure = failure;
  }
}

/** F4 with a structured failure; definitions expand once each (memo), counting nodes as they grow. */
function flatten(ast: FormulaNode, defs: readonly ComputedDef[], self?: string): Flat {
  const byName = new Map(defs.map((d) => [d.name, d]));
  const memo = new Map<string, { ast: FormulaNode; nodes: number }>();
  const stack: string[] = self === undefined ? [] : [self];
  const counted = (n: FormulaNode, nodes: number) => {
    if (nodes > MAX_FLAT_NODES) throw new FlatStop({ kind: "nodes" });
    return { ast: n, nodes };
  };
  const expand = (n: FormulaNode): { ast: FormulaNode; nodes: number } => {
    switch (n.op) {
      case "num":
        return { ast: n, nodes: 1 };
      case "sig": {
        const i = stack.indexOf(n.name);
        if (i >= 0) throw new FlatStop({ kind: "cycle", chain: [...stack.slice(i), n.name] });
        const def = byName.get(n.name);
        if (!def) return { ast: n, nodes: 1 };
        const known = memo.get(n.name);
        if (known) return known;
        const parsed = parseFormula(def.formula);
        if (!parsed.ok)
          throw new FlatStop({ kind: "parse", name: def.name, message: parsed.message });
        stack.push(n.name);
        const out = expand(parsed.ast);
        stack.pop();
        memo.set(n.name, out);
        return out;
      }
      case "neg":
      case "abs": {
        const arg = expand(n.arg);
        return counted({ ...n, arg: arg.ast }, arg.nodes + 1);
      }
      case "min":
      case "max": {
        const args = n.args.map(expand);
        const nodes = args.reduce((sum, a) => sum + a.nodes, 1);
        return counted({ ...n, args: args.map((a) => a.ast) }, nodes);
      }
      default: {
        const left = expand(n.left);
        const right = expand(n.right);
        return counted({ ...n, left: left.ast, right: right.ast }, left.nodes + right.nodes + 1);
      }
    }
  };
  try {
    const flat = expand(ast).ast;
    const sources = formulaInputs(flat);
    if (sources.length > MAX_FORMULA_SIGNALS)
      return { ok: false, failure: { kind: "signals", count: sources.length } };
    if (formulaText(flat).length > MAX_FLAT_LENGTH)
      return { ok: false, failure: { kind: "length" } };
    return { ok: true, ast: flat, sources };
  } catch (error) {
    if (error instanceof FlatStop) return { ok: false, failure: error.failure };
    throw error;
  }
}

/**
 * F4: each name that is a definition (exact) replaced by its flattened AST, recursively; refused on
 * a cycle (the chain from `self`, the name of the definition checked) or over a limit.
 */
export function flattenFormula(
  ast: FormulaNode,
  defs: readonly ComputedDef[],
  self?: string,
): { ok: true; ast: FormulaNode; sources: string[] } | { ok: false; message: string } {
  const flat = flatten(ast, defs, self);
  return flat.ok ? flat : { ok: false, message: flatMessage(flat.failure) };
}

/** A stored definition flattened, or why not. */
function flattenDef(def: ComputedDef, defs: readonly ComputedDef[]) {
  const parsed = parseFormula(def.formula);
  if (!parsed.ok) return { ok: false as const, message: parsed.message };
  return flattenFormula(parsed.ast, defs, def.name);
}

/** Sources of a stored definition; undefined when it does not flatten. */
export function computedSources(
  def: ComputedDef,
  defs: readonly ComputedDef[],
): string[] | undefined {
  const flat = flattenDef(def, defs);
  return flat.ok ? flat.sources : undefined;
}

/** F8: the flattened canonical text; undefined when the definition does not flatten. */
export function computedParams(
  def: ComputedDef,
  defs: readonly ComputedDef[],
): ComputedParams | undefined {
  const flat = flattenDef(def, defs);
  return flat.ok ? { formula: formulaText(flat.ast) } : undefined;
}

/** The sources' full IDs on a data ref (formulaInputs order of the flattened formula); [] when it does not flatten. */
export function computedInputIds(
  def: ComputedDef,
  defs: readonly ComputedDef[],
  dataRef: string,
): string[] {
  return (computedSources(def, defs) ?? []).map((name) => signalId(dataRef, name));
}

/** No limits: a user is found by its names even when a rename pushed its text past a limit. */
const NO_LIMITS = { length: Number.POSITIVE_INFINITY, nodes: Number.POSITIVE_INFINITY };

/** Direct users (creation order). */
export function computedUsers(name: string, defs: readonly ComputedDef[]): ComputedDef[] {
  return defs.filter((d) => {
    const parsed = parseFormula(d.formula, NO_LIMITS);
    return parsed.ok && parsed.names.includes(name);
  });
}

export type SignalCheck = (name: string) => "numeric" | "states" | "unknown" | "unchecked";

/**
 * F5: a canonical formula checked as the definition `self` (an update: `self.id` names the stored
 * one, which `defs` may hold old or already replaced; its direct users are renamed when the name
 * changes). Order: parse, the name taken by another definition (case ignored), flatten (cycle,
 * limits), every transitive user still flattens, then each name that is no definition through
 * `signal`. `users` = the IDs that get new IDs on an update.
 */
export function checkFormula(
  formula: string,
  defs: readonly ComputedDef[],
  self: { id?: string; name: string },
  signal: SignalCheck,
):
  | { ok: true; formula: string; sources: string[]; users: string[] }
  | {
      ok: false;
      code: "invalid_formula" | "duplicate_name" | "unknown_signal" | "not_numeric_signal";
      message: string;
    } {
  const invalid = (message: string) => ({
    ok: false as const,
    code: "invalid_formula" as const,
    message,
  });
  const parsed = parseFormula(formula);
  if (!parsed.ok) return invalid(parsed.message);
  // The name rule before the cycle check: a name taken by a definition the formula uses would
  // otherwise read as a cycle onto itself.
  const lower = self.name.trim().toLowerCase();
  if (defs.some((d) => d.id !== self.id && d.name.toLowerCase() === lower))
    return { ok: false, code: "duplicate_name", message: "Name already used" };
  const canonical = formulaText(parsed.ast);
  const old = self.id === undefined ? undefined : defs.find((d) => d.id === self.id);
  const renamed = old !== undefined && old.name !== self.name ? old.name : undefined;
  const next = old
    ? defs.map((d): ComputedDef => {
        if (d.id === old.id) return { ...d, name: self.name, formula: canonical };
        return renamed === undefined
          ? d
          : { ...d, formula: renameInFormula(d.formula, renamed, self.name) };
      })
    : defs;

  const flat = flatten(parsed.ast, next, self.name);
  if (!flat.ok) return invalid(flatMessage(flat.failure));

  const users = new Set<string>();
  if (old) {
    const queue = [self.name];
    for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
      for (const u of computedUsers(name, next)) {
        if (u.id === old.id || users.has(u.id)) continue;
        users.add(u.id);
        queue.push(u.name);
      }
    }
  }
  const userDefs = next.filter((d) => users.has(d.id));
  for (const u of userDefs) {
    const p = parseFormula(u.formula);
    if (!p.ok) return invalid(`${p.message} in "${u.name}"`);
    const f = flatten(p.ast, next, u.name);
    if (!f.ok) return invalid(flatMessage(f.failure, u.name));
  }

  const defNames = new Set(next.map((d) => d.name));
  for (const name of parsed.names) {
    if (defNames.has(name)) continue;
    const kind = signal(name);
    if (kind === "unknown")
      return { ok: false, code: "unknown_signal", message: `not in this list: ${name}` };
    if (kind === "states")
      return {
        ok: false,
        code: "not_numeric_signal",
        message: `${name} has states: pick a numeric signal`,
      };
  }
  return { ok: true, formula: canonical, sources: flat.sources, users: userDefs.map((d) => d.id) };
}

/**
 * F5: the context with computed IDs. A computed ID exists iff its definition exists, flattens, and
 * every source exists on the ID's data ref; its unit is the definition's; it has no states. Plain
 * IDs go to `ctx` unchanged.
 */
export function withComputed(
  ctx: ApplyContext,
  computed: readonly ComputedDef[] | undefined,
): ApplyContext {
  const all = computed ?? [];
  const defs = new Map(all.map((d) => [d.id, d]));
  const defOf = (id: string) => {
    const ref = computedRef(id);
    return ref && { ref, def: defs.get(ref.id) };
  };
  const wrapped: ApplyContext = {
    signalExists(id) {
      if (!isComputedId(id)) return ctx.signalExists(id);
      const found = defOf(id);
      if (found?.def === undefined) return false;
      const sources = computedSources(found.def, all);
      return sources?.every((name) => ctx.signalExists(signalId(found.ref.dataRef, name))) ?? false;
    },
    hasStates: (id) => (isComputedId(id) ? false : ctx.hasStates(id)),
  };
  if (ctx.unitOf)
    wrapped.unitOf = (id) => (isComputedId(id) ? defOf(id)?.def?.unit : ctx.unitOf?.(id));
  if (ctx.catalogReady) wrapped.catalogReady = () => ctx.catalogReady?.() ?? true;
  if (ctx.inputInfo) wrapped.inputInfo = (name) => ctx.inputInfo?.(name);
  if (ctx.scopeRequired !== undefined) wrapped.scopeRequired = ctx.scopeRequired;
  if (ctx.case !== undefined) wrapped.case = ctx.case;
  return wrapped;
}

/**
 * F10: one info per definition and data ref of `items` that holds all its (flattened) sources (data
 * refs in catalog order); `description` the stored formula. A definition with none gives one info
 * on the scope's data ref, else the list's first, with `computed.unavailable` naming the missing
 * sources (or why it does not flatten); none for an empty list.
 */
export function computedInfos(
  defs: readonly ComputedDef[],
  items: readonly SignalInfo[],
  scopeDataRef?: string,
): SignalInfo[] {
  const ids = new Set(items.map((s) => s.id));
  const refs = [...new Set(items.map((s) => s.dataRef))];
  const fallback = scopeDataRef ?? refs[0];
  const out: SignalInfo[] = [];
  for (const def of defs) {
    const info = (dataRef: string, unavailable?: string): SignalInfo => ({
      id: computedSignalId(dataRef, def.id),
      dataRef,
      name: `=${def.id}`,
      description: def.formula,
      ...(def.unit !== undefined && { unit: def.unit }),
      displayName: def.name,
      computed: { formula: def.formula, ...(unavailable !== undefined && { unavailable }) },
    });
    const flat = flattenDef(def, defs);
    const sources = flat.ok ? flat.sources : [];
    const holding = flat.ok
      ? refs.filter((ref) => sources.every((name) => ids.has(signalId(ref, name))))
      : [];
    if (holding.length > 0) {
      for (const ref of holding) out.push(info(ref));
      continue;
    }
    if (fallback === undefined) continue;
    if (!flat.ok) {
      out.push(info(fallback, flat.message));
      continue;
    }
    const missing = sources.filter((name) => !ids.has(signalId(fallback, name)));
    out.push(info(fallback, `not in this list: ${missing.join(", ")}`));
  }
  return out;
}

export interface ComputedSeriesInput {
  /** Ascending, inside the range; v null = SNA. */
  points: readonly Point[];
  /** Last point before the range. */
  seed?: Point;
  /** C2; undefined = no limit. */
  holdNs?: bigint;
}

const compiled = new WeakMap<FormulaNode, (values: readonly number[]) => number>();

/** The formula over current points (formulaInputs order): null when one is SNA or the result is not finite (C2, Q-4). */
export function computedRowValue(ast: FormulaNode, current: readonly Point[]): number | null {
  let fn = compiled.get(ast);
  if (!fn) {
    fn = compileFormula(ast);
    compiled.set(ast, fn);
  }
  const values: number[] = [];
  for (const p of current) {
    if (p.v === null) return null;
    values.push(p.v);
  }
  const v = fn(values);
  return Number.isFinite(v) ? v : null;
}

/**
 * C2 over N inputs (F3), in formulaInputs order. Rows ascending, one per distinct time of all
 * inputs' points, a row iff every input holds a point within its hold limit; v null = SNA or not
 * finite. One input: one row per point.
 */
export function computeRows(ast: FormulaNode, inputs: readonly ComputedSeriesInput[]): Point[] {
  const rows: Point[] = [];
  if (inputs.length === 1) {
    // One input: one row per point (the last one where a time repeats).
    const points = (inputs[0] as ComputedSeriesInput).points;
    points.forEach((p, i) => {
      if (points[i + 1]?.t === p.t) return;
      rows.push({ t: p.t, v: computedRowValue(ast, [p]) });
    });
    return rows;
  }
  const next = inputs.map(() => 0);
  const current = inputs.map((x) => x.seed);
  for (;;) {
    let t: bigint | undefined;
    inputs.forEach((x, i) => {
      const p = x.points[next[i] as number];
      if (p && (t === undefined || p.t < t)) t = p.t;
    });
    if (t === undefined) return rows;
    const at = t;
    inputs.forEach((x, i) => {
      let j = next[i] as number;
      while (j < x.points.length && (x.points[j] as Point).t === at) current[i] = x.points[j++];
      next[i] = j;
    });
    const held = inputs.every((x, i) => {
      const cur = current[i];
      return cur !== undefined && (x.holdNs === undefined || at - cur.t <= x.holdNs);
    });
    if (held) rows.push({ t: at, v: computedRowValue(ast, current as Point[]) });
  }
}

/** C2: GAP_PERIODS × period, undefined without a period. */
export function holdLimit(period: bigint | undefined): bigint | undefined {
  return period === undefined ? undefined : BigInt(GAP_PERIODS) * period;
}

/** C3, F3: the data ref's logger gaps and the smallest known period of the sources. */
export function computedSignalGaps(
  info: GapInfo | undefined,
  dataRef: string,
  sources: readonly string[],
): SignalGaps {
  if (!info) return NO_GAPS;
  let period: bigint | undefined;
  let logger: SignalGaps["logger"] = [];
  for (const name of sources) {
    const gaps = signalGaps(info, signalId(dataRef, name));
    logger = gaps.logger;
    if (gaps.period !== undefined && (period === undefined || gaps.period < period))
      period = gaps.period;
  }
  return period === undefined ? { logger } : { period, logger };
}

export interface ComputedNeighbours {
  at?: Point;
  next?: Point;
  holdNs?: bigint;
}

/** C4 over N inputs (F3, formulaInputs order); the result's at/next are the computed points. */
export function computedValueAt(
  t: bigint,
  mode: ValuesMode,
  ast: FormulaNode,
  inputs: readonly ComputedNeighbours[],
  gaps: SignalGaps,
): { value: CursorValue; at?: Point; next?: Point } {
  for (const x of inputs) {
    if (!x.at) return { value: { kind: "none", reason: x.next ? "before_first" : "no_data" } };
  }
  for (const x of inputs) {
    if (x.holdNs !== undefined && t - (x.at as Point).t > x.holdNs)
      return { value: { kind: "none", reason: "period_gap" } };
  }
  const ats = inputs.map((x) => x.at as Point);
  let atT = (ats[0] as Point).t;
  for (const p of ats) if (p.t > atT) atT = p.t;
  const at: Point = { t: atT, v: computedRowValue(ast, ats) };
  let m: bigint | undefined;
  for (const x of inputs) {
    if (x.next && (m === undefined || x.next.t < m)) m = x.next.t;
  }
  let next: Point | undefined;
  if (m !== undefined) {
    const current = inputs.map((x) => (x.next?.t === m ? x.next : x.at) as Point);
    next = { t: m, v: computedRowValue(ast, current) };
  }
  const value = evaluateAt(t, mode, at, next, undefined, gaps);
  return { value, at, ...(next && { next }) };
}
