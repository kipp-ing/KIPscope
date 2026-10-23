import { z } from "zod";
import type { ApplyContext } from "./apply.ts";
import { type CursorValue, evaluateAt, type Point } from "./cursor.ts";
import { FavouriteName } from "./favourites.ts";
import { evalFormula, type FormulaNode, formulaText, parseFormula } from "./formula.ts";
import { GAP_PERIODS, type GapInfo, NO_GAPS, type SignalGaps, signalGaps } from "./gaps.ts";
import { parseSignalId, type SignalInfo, signalId } from "./signals.ts";
import type { ValuesMode } from "./workspace.ts";

/** Definitions per workspace (design Numbers). */
export const MAX_COMPUTED = 20;
export const MAX_COMPUTED_NAME = 60;
export const MAX_COMPUTED_UNIT = 20;
/** Fallback bound per input (C8). */
export const COMPUTED_MAX_ROWS = 200_000;

/** A computed signal of the workspace (C6); `b` absent when the formula does not use it. */
export interface ComputedDef {
  /** `c<nextId>`; an edit gives a new one. Never shown in the UI. */
  id: string;
  name: string;
  formula: string;
  /** Signal names without data ref. */
  a: string;
  b?: string;
  /** Absent: none. */
  unit?: string;
}

/** What a series/value/extent request carries (C8); also the view entry without name/unit. */
export interface ComputedParams {
  formula: string;
  a: string;
  b?: string;
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

/** C6: a signal name as FavouriteName. */
export const ComputedInput: z.ZodType<string> = FavouriteName;

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

/** The used inputs' full IDs on a data ref (a, then b). */
export function computedInputIds(def: Pick<ComputedDef, "a" | "b">, dataRef: string): string[] {
  const ids = [signalId(dataRef, def.a)];
  if (def.b !== undefined) ids.push(signalId(dataRef, def.b));
  return ids;
}

export function computedParams(def: ComputedDef): ComputedParams {
  return { formula: def.formula, a: def.a, ...(def.b !== undefined && { b: def.b }) };
}

/**
 * C7: the context with computed IDs. A computed ID exists iff its definition exists and its used
 * inputs exist on the ID's data ref; its unit is the definition's; it has no states. Plain IDs go
 * to `ctx` unchanged.
 */
export function withComputed(
  ctx: ApplyContext,
  computed: readonly ComputedDef[] | undefined,
): ApplyContext {
  const defs = new Map((computed ?? []).map((d) => [d.id, d]));
  const defOf = (id: string) => {
    const ref = computedRef(id);
    return ref && { ref, def: defs.get(ref.id) };
  };
  const wrapped: ApplyContext = {
    signalExists(id) {
      if (!isComputedId(id)) return ctx.signalExists(id);
      const found = defOf(id);
      return (
        found?.def !== undefined &&
        computedInputIds(found.def, found.ref.dataRef).every((input) => ctx.signalExists(input))
      );
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

/** The formula with full input names, or the stored text when it does not parse. */
function describe(def: ComputedDef): string {
  const parsed = parseFormula(def.formula);
  return parsed.ok ? formulaText(parsed.ast, def.a, def.b) : def.formula;
}

/**
 * C11: one info per definition and data ref of `items` that holds all used inputs (data refs in
 * catalog order). A definition with none gives one info on the scope's data ref, else the list's
 * first, with `computed.unavailable` naming the missing inputs; none for an empty list.
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
      description: describe(def),
      ...(def.unit !== undefined && { unit: def.unit }),
      displayName: def.name,
      computed: {
        formula: def.formula,
        a: def.a,
        ...(def.b !== undefined && { b: def.b }),
        ...(unavailable !== undefined && { unavailable }),
      },
    });
    const holding = refs.filter((ref) => computedInputIds(def, ref).every((id) => ids.has(id)));
    if (holding.length > 0) {
      for (const ref of holding) out.push(info(ref));
      continue;
    }
    if (fallback === undefined) continue;
    const inputs = def.b !== undefined ? [def.a, def.b] : [def.a];
    const missing = inputs.filter((name) => !ids.has(signalId(fallback, name)));
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

/** The formula of the current points: null when one is SNA or the result is not finite (C2, Q-4). */
export function computedRowValue(ast: FormulaNode, a: Point, b: Point | undefined): number | null {
  if (a.v === null || (b !== undefined && b.v === null)) return null;
  const v = evalFormula(ast, a.v, b?.v ?? undefined);
  return Number.isFinite(v) ? v : null;
}

/** C2. Rows ascending, one per distinct time, v null = SNA or not finite. */
export function computeRows(
  ast: FormulaNode,
  a: ComputedSeriesInput,
  b?: ComputedSeriesInput,
): Point[] {
  const rows: Point[] = [];
  if (!b) {
    // One input: one row per point (the last one where a time repeats).
    a.points.forEach((p, i) => {
      if (a.points[i + 1]?.t === p.t) return;
      rows.push({ t: p.t, v: computedRowValue(ast, p, undefined) });
    });
    return rows;
  }
  let ia = 0;
  let ib = 0;
  let curA = a.seed;
  let curB = b.seed;
  const held = (cur: Point | undefined, hold: bigint | undefined, t: bigint) =>
    cur !== undefined && (hold === undefined || t - cur.t <= hold);
  while (ia < a.points.length || ib < b.points.length) {
    const ta = a.points[ia]?.t;
    const tb = b.points[ib]?.t;
    const t = (ta === undefined ? tb : tb === undefined || ta < tb ? ta : tb) as bigint;
    while (ia < a.points.length && (a.points[ia] as Point).t === t) curA = a.points[ia++];
    while (ib < b.points.length && (b.points[ib] as Point).t === t) curB = b.points[ib++];
    if (held(curA, a.holdNs, t) && held(curB, b.holdNs, t))
      rows.push({ t, v: computedRowValue(ast, curA as Point, curB) });
  }
  return rows;
}

/** C2: GAP_PERIODS × period, undefined without a period. */
export function holdLimit(period: bigint | undefined): bigint | undefined {
  return period === undefined ? undefined : BigInt(GAP_PERIODS) * period;
}

/** C3: the data ref's logger gaps and the smallest known period of the used inputs. */
export function computedSignalGaps(
  info: GapInfo | undefined,
  dataRef: string,
  def: Pick<ComputedDef, "a" | "b">,
): SignalGaps {
  if (!info) return NO_GAPS;
  let period: bigint | undefined;
  let logger: SignalGaps["logger"] = [];
  for (const id of computedInputIds(def, dataRef)) {
    const gaps = signalGaps(info, id);
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

/** C4; the result's at/next are the computed points. */
export function computedValueAt(
  t: bigint,
  mode: ValuesMode,
  ast: FormulaNode,
  a: ComputedNeighbours,
  b: ComputedNeighbours | undefined,
  gaps: SignalGaps,
): { value: CursorValue; at?: Point; next?: Point } {
  const inputs = b ? [a, b] : [a];
  for (const x of inputs) {
    if (!x.at) return { value: { kind: "none", reason: x.next ? "before_first" : "no_data" } };
  }
  for (const x of inputs) {
    if (x.holdNs !== undefined && t - (x.at as Point).t > x.holdNs)
      return { value: { kind: "none", reason: "period_gap" } };
  }
  const aAt = a.at as Point;
  const bAt = b?.at;
  const at: Point = {
    t: bAt !== undefined && bAt.t > aAt.t ? bAt.t : aAt.t,
    v: computedRowValue(ast, aAt, bAt),
  };
  let m: bigint | undefined;
  for (const x of inputs) {
    if (x.next && (m === undefined || x.next.t < m)) m = x.next.t;
  }
  let next: Point | undefined;
  if (m !== undefined) {
    const current = (x: ComputedNeighbours) => (x.next?.t === m ? x.next : x.at) as Point;
    next = { t: m, v: computedRowValue(ast, current(a), b && current(b)) };
  }
  const value = evaluateAt(t, mode, at, next, undefined, gaps);
  return { value, at, ...(next && { next }) };
}
