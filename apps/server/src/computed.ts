import {
  type BucketSeries,
  bindFormula,
  type ComputedParams,
  computedRowValue,
  encodeTimes,
  type FormulaNode,
  parseFormula,
  type RawSeries,
  type SeriesResult,
  type Timestamp,
} from "@kipscope/shared";
import type { Catalog } from "./catalog.ts";
import type {
  ComputedInputRef,
  ComputedRef,
  DataSource,
  RawPoint,
  Scope,
  SeriesRef,
} from "./datasource.ts";
import { bucketWidth, edgePoint } from "./series.ts";

/** A computed input as a plain series ref: without seed and hold limit. */
export function inputSeries(input: ComputedInputRef): SeriesRef {
  const ref: SeriesRef = { dataRef: input.dataRef, name: input.name, sna: input.sna };
  if (input.text) ref.text = true;
  return ref;
}

/** The used inputs of a computed ref: a, then b. */
export const computedInputs = (ref: ComputedRef): ComputedInputRef[] =>
  ref.b ? [ref.a, ref.b] : [ref.a];

/** A computed input with its seed and hold limit, both optional. */
export function withSeed(
  input: SeriesRef,
  seed: RawPoint | undefined,
  holdNs: bigint | undefined,
): ComputedInputRef {
  const ref: ComputedInputRef = { ...input };
  if (seed) ref.seed = seed;
  if (holdNs !== undefined) ref.holdNs = holdNs;
  return ref;
}

/**
 * The computed point at `t` from each used input's current point there (design C2): none when an
 * input has none or holds it beyond its hold limit; SNA when one is SNA or the result not finite.
 */
export function computedPointAt(
  ast: FormulaNode,
  t: Timestamp,
  inputs: readonly { point: RawPoint | undefined; holdNs?: bigint | undefined }[],
): RawPoint | undefined {
  const points: RawPoint[] = [];
  for (const { point, holdNs } of inputs) {
    if (!point || (holdNs !== undefined && t - point.t > holdNs)) return undefined;
    points.push(point);
  }
  return { t, v: computedRowValue(ast, points[0] as RawPoint, points[1]) };
}

/**
 * A computed series for [from, to) (design C8), over any DataSource, so the conformance suite runs
 * it native and core only: the inputs' seeds, then `computedSeries`, and for a raw answer its edges.
 * `ref` comes without seeds; hold limits are the caller's. `before` is the computed point at the
 * latest seed time; `after` the one at the earliest time an input has a point at or after `to`,
 * from each input's current point there. `span` as in querySeries.
 */
export async function queryComputed(
  source: DataSource,
  ref: ComputedRef,
  signalId: string,
  from: Timestamp,
  to: Timestamp,
  target: number,
  scope?: Scope,
  abort?: AbortSignal,
  span: bigint = to - from,
): Promise<SeriesResult> {
  if (to <= from) throw new RangeError("empty time range: to must be after from");
  const head = { signalId, from: from.toString(), to: to.toString() };
  const width = bucketWidth(0n, span, target);
  const inputs = computedInputs(ref);
  const seeds = await Promise.all(
    inputs.map((input) => source.before(inputSeries(input), from, scope, abort)),
  );
  const seeded: ComputedRef = {
    dataRef: ref.dataRef,
    ast: ref.ast,
    a: withSeed(inputSeries(ref.a), seeds[0], ref.a.holdNs),
  };
  if (ref.b) seeded.b = withSeed(inputSeries(ref.b), seeds[1], ref.b.holdNs);
  const answer = await source.computedSeries(seeded, from, to, target, width, abort);

  if (answer.kind === "buckets") {
    const { buckets } = answer;
    const result: BucketSeries = {
      kind: "buckets",
      ...head,
      width: width.toString(),
      t: encodeTimes(buckets.map((b) => b.start)),
      count: buckets.map((b) => b.count),
      sna: buckets.map((b) => b.sna),
      mean: buckets.map((b) => b.mean),
      min: buckets.map((b) => b.min),
      max: buckets.map((b) => b.max),
    };
    return result;
  }

  const { points } = answer;
  const result: RawSeries = {
    kind: "raw",
    ...head,
    t: encodeTimes(points.map((p) => p.t)),
    v: points.map((p) => p.v),
  };
  const holds = inputs.map((input) => input.holdNs);
  const latest = seeds.reduce<Timestamp | undefined>(
    (t, s) => (s && (t === undefined || s.t > t) ? s.t : t),
    undefined,
  );
  if (latest !== undefined) {
    const before = computedPointAt(
      ref.ast,
      latest,
      seeds.map((point, i) => ({ point, holdNs: holds[i] })),
    );
    if (before) result.before = edgePoint(before, false);
  }
  const afters = await Promise.all(
    inputs.map((input) => source.after(inputSeries(input), to, scope, abort)),
  );
  const m = afters.reduce<Timestamp | undefined>(
    (t, p) => (p && (t === undefined || p.t < t) ? p.t : t),
    undefined,
  );
  if (m !== undefined) {
    // before(m + 1) is each input's last point at or before m: its current point there.
    const current = await Promise.all(
      inputs.map((input) => source.before(inputSeries(input), m + 1n, scope, abort)),
    );
    const after = computedPointAt(
      ref.ast,
      m,
      current.map((point, i) => ({ point, holdNs: holds[i] })),
    );
    if (after) result.after = edgePoint(after, false);
  }
  return result;
}

export type ResolvedComputed =
  | { ok: true; ast: FormulaNode; a: SeriesRef; b?: SeriesRef }
  | {
      ok: false;
      status: 400 | 404 | 422;
      code: "invalid_formula" | "unknown_signal" | "not_numeric_signal";
      message: string;
      signalId?: string;
    };

/**
 * The request checks of design C8: parses and binds the formula (never splices its text), then
 * resolves each used input `<dataRef>/<name>` in the catalog; numeric signals only.
 */
export function resolveComputed(
  params: ComputedParams,
  dataRef: string,
  catalog: Pick<Catalog, "get" | "snaRanges">,
): ResolvedComputed {
  const parsed = parseFormula(params.formula);
  if (!parsed.ok) {
    return { ok: false, status: 400, code: "invalid_formula", message: parsed.message };
  }
  const bound = bindFormula(parsed, params.b === undefined ? { a: params.a } : params);
  if (!bound.ok) {
    return { ok: false, status: 400, code: "invalid_formula", message: bound.message };
  }
  const refs: SeriesRef[] = [];
  for (const name of bound.b === undefined ? [bound.a] : [bound.a, bound.b]) {
    const id = `${dataRef}/${name}`;
    const info = catalog.get(id);
    if (!info) {
      return {
        ok: false,
        status: 404,
        code: "unknown_signal",
        message: `not in this list: ${id}`,
        signalId: id,
      };
    }
    if (info.states !== undefined) {
      return {
        ok: false,
        status: 422,
        code: "not_numeric_signal",
        message: `${id} has states: pick a numeric signal`,
        signalId: id,
      };
    }
    refs.push({ dataRef, name, sna: catalog.snaRanges(id) });
  }
  const [a, b] = refs as [SeriesRef, SeriesRef | undefined];
  return b ? { ok: true, ast: bound.ast, a, b } : { ok: true, ast: bound.ast, a };
}
