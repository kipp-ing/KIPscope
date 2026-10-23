/**
 * Query counts and answers of the ADX adapter's `extent` and `series` on a fake Kusto client
 * (speed-up-adx design A7): no emulator, so `pnpm test` runs it. The fake records each
 * `query(csl, params)` and answers the rows of design A1 (`extent`) or A3 (`series`).
 */
import { type BucketSeries, decodeTimes, parseFormula, type RawSeries } from "@kipscope/shared";
import { describe, expect, it, vi } from "vitest";
import { AdxSource } from "../src/adx.ts";
import type { TableMapping } from "../src/config.ts";
import type {
  ComputedInputRef,
  ComputedRef,
  Scope,
  SeriesRef,
  SourceAdapter,
  StateChangeRule,
} from "../src/datasource.ts";
import { completeSource, nativeMethods } from "../src/fallbacks.ts";
import { KustoError, type KustoParam } from "../src/kusto.ts";
import { QueryQueue, queuedAdapter } from "../src/queue.ts";
import { querySeries } from "../src/series.ts";
import { adxEventMapping, adxMapping } from "./adxdb.ts";
import { B } from "./conformance/fixture.ts";

const S = 1_000_000_000n;
const MS = 1_000_000n;

type Sent = { csl: string; params: Record<string, KustoParam> };

/** A Kusto client that records every query and answers `rows` (the same rows for each query). */
function fakeAdapter(rows: unknown[][]) {
  const sent: Sent[] = [];
  const fake = {
    query: async (csl: string, params: Record<string, KustoParam>) => {
      sent.push({ csl, params });
      return rows;
    },
    ping: async () => {},
  };
  return { adapter: new AdxSource(fake as never, adxMapping, adxEventMapping), sent };
}

const ramp: SeriesRef = { dataRef: "conf-a", name: "Lin.RAMP", sna: [] };
const door: SeriesRef = { dataRef: "conf-a", name: "Diag.door", sna: [], text: true };
const scope: Scope = { dataRef: "conf-a", from: B + 5n * S, to: B + 35n * S };
const ns = (t: bigint) => t.toString();

/**
 * Rows of design A3, columns `k_, t_, v_, x_, c_, m_, lo_, hi_`: a count row of 5 (raw path), points
 * in a shuffled order with their row numbers (the third is SNA: a null value), both edges.
 */
const RAW_AT = [100n, 200n, 300n, 400n, 500n].map((n) => B + n * MS);
const rawRows = (text: boolean): unknown[][] => {
  const x = (label: string) => (text ? label : "");
  return [
    ["a", ns(B + S), 60, x("after"), null, null, null, null],
    ["p", ns(RAW_AT[2] as bigint), null, x("c"), 3, null, null, null],
    ["p", ns(RAW_AT[0] as bigint), 10, x("a"), 1, null, null, null],
    ["n", null, null, null, 5, null, null, null],
    ["p", ns(RAW_AT[4] as bigint), 50, x("e"), 5, null, null, null],
    ["b", ns(B - 50n * MS), 7, x("before"), null, null, null, null],
    ["p", ns(RAW_AT[1] as bigint), 20, x("b"), 2, null, null, null],
    ["p", ns(RAW_AT[3] as bigint), 40, x("d"), 4, null, null, null],
  ];
};

/**
 * A count row of 50 (bucket path) and three buckets, listed out of order; the middle one holds SNA
 * points only (valid count 0: mean, min and max null).
 */
const bucketRows: unknown[][] = [
  ["k", ns(B + 22_222_222_224n), 9.5, null, 4, 0, 3, 14],
  ["n", null, null, null, 50, null, null, null],
  ["k", ns(B), 1.5, null, 20, 1, 0, 3],
  ["k", ns(B + 11_111_111_112n), null, null, 0, 3, null, null],
];

describe("ADX queries on a fake client (speed-up-adx A1, A3)", () => {
  it("sends one query per extent and series", async () => {
    for (const withScope of [undefined, scope]) {
      const label = withScope ? "with scope" : "without scope";
      const extent = fakeAdapter([[ns(B), ns(B + 10n * S)]]);
      expect(await extent.adapter.extent(ramp, withScope)).toEqual({
        first: B,
        last: B + 10n * S,
      });
      expect(extent.sent.length, `extent ${label}`).toBe(1);
      const extentText = (extent.sent[0] as Sent).csl.replace(/\s+/g, " ");
      expect(extentText).toContain("summarize");
      expect(extentText).toMatch(/min\(/);
      expect(extentText).toMatch(/max\(/);
      expect(extentText).not.toMatch(/\btop\b/);

      // 5 points against target 10: the raw path; 50 against 10: the bucket path.
      for (const rows of [rawRows(false), bucketRows]) {
        const series = fakeAdapter(rows);
        await series.adapter.series(ramp, B, B + S, 10, 125n * MS, withScope);
        expect(series.sent.length, `series ${label}`).toBe(1);
        const text = (series.sent[0] as Sent).csl.replace(/\s+/g, " ");
        expect(text).toContain("toscalar(");
        expect(text).toContain("union");
      }
    }
  });

  it("has no native count and answers empty extents as none", async () => {
    const { adapter } = fakeAdapter([]);
    expect((adapter as SourceAdapter).count).toBeUndefined();
    expect(await adapter.extent(ramp)).toBeUndefined();
    // A row of two empty strings (a summarize over no row) is no data either.
    expect(await fakeAdapter([["", ""]]).adapter.extent(ramp)).toBeUndefined();
  });

  it("builds the raw answer of a series from the A3 rows", async () => {
    const { adapter } = fakeAdapter(rawRows(false));
    const answer = await adapter.series(ramp, B, B + S, 10, 125n * MS);
    // Points in row-number order, the SNA point a null value, no text for a plain signal.
    expect(answer).toEqual({
      kind: "raw",
      points: [
        { t: RAW_AT[0], v: 10 },
        { t: RAW_AT[1], v: 20 },
        { t: RAW_AT[2], v: null },
        { t: RAW_AT[3], v: 40 },
        { t: RAW_AT[4], v: 50 },
      ],
      before: { t: B - 50n * MS, v: 7 },
      after: { t: B + S, v: 60 },
    });
    for (const p of answer.kind === "raw" ? answer.points : []) expect("text" in p).toBe(false);

    const text = await fakeAdapter(rawRows(true)).adapter.series(door, B, B + S, 10, 125n * MS);
    expect(text).toMatchObject({
      kind: "raw",
      points: [
        { t: RAW_AT[0], v: 10, text: "a" },
        { t: RAW_AT[1], v: 20, text: "b" },
        { t: RAW_AT[2], v: null, text: "c" },
        { t: RAW_AT[3], v: 40, text: "d" },
        { t: RAW_AT[4], v: 50, text: "e" },
      ],
      before: { t: B - 50n * MS, v: 7, text: "before" },
      after: { t: B + S, v: 60, text: "after" },
    });
  });

  it("leaves out edges the query did not return", async () => {
    const answer = await fakeAdapter([
      ["n", null, null, null, 1, null, null, null],
      ["p", ns(B + MS), 1, null, 1, null, null, null],
    ]).adapter.series(ramp, B, B + S, 10, 125n * MS);
    expect(answer).toEqual({ kind: "raw", points: [{ t: B + MS, v: 1 }] });
    expect(
      (await fakeAdapter([["n", null, null, null, 0, null, null, null]]).adapter.series(
        ramp,
        B,
        B + S,
        10,
        125n * MS,
      )) as unknown,
    ).toEqual({ kind: "raw", points: [] });
  });

  it("builds the bucket answer of a series from the A3 rows", async () => {
    const { adapter } = fakeAdapter(bucketRows);
    expect(await adapter.series(ramp, B, B + 100n * S, 10, 11_111_111_112n)).toEqual({
      kind: "buckets",
      buckets: [
        { start: B, count: 20, sna: 1, mean: 1.5, min: 0, max: 3 },
        { start: B + 11_111_111_112n, count: 0, sna: 3, mean: null, min: null, max: null },
        { start: B + 22_222_222_224n, count: 4, sna: 0, mean: 9.5, min: 3, max: 14 },
      ],
    });
  });

  it("decides the kind from the count row alone and fails without one", async () => {
    // Exactly the target counts as raw (as `count <= target`), one more as buckets.
    const atTarget = await fakeAdapter([
      ["n", null, null, null, 10, null, null, null],
    ]).adapter.series(ramp, B, B + S, 10, 125n * MS);
    expect(atTarget.kind).toBe("raw");
    const over = await fakeAdapter([["n", null, null, null, 11, null, null, null]]).adapter.series(
      ramp,
      B,
      B + S,
      10,
      125n * MS,
    );
    expect(over.kind).toBe("buckets");
    // A missing count row is an error, never a guess.
    await expect(
      fakeAdapter([["p", ns(B), 1, null, 1, null, null, null]]).adapter.series(
        ramp,
        B,
        B + S,
        10,
        125n * MS,
      ),
    ).rejects.toThrow(/no count/);
  });

  it("answers a series request with one query", async () => {
    const run = async (rows: unknown[][], ref: SeriesRef, target: number, to: bigint) => {
      const { adapter, sent } = fakeAdapter(rows);
      const queue = new QueryQueue(8);
      const source = completeSource(queuedAdapter(adapter, queue));
      const result = await querySeries(source, ref, `${ref.dataRef}/${ref.name}`, B, to, target);
      return { result, sent, queue };
    };

    // Raw path: count 5 against target 10.
    const raw = await run(rawRows(false), ramp, 10, B + S);
    expect(raw.sent.length).toBe(1);
    expect(raw.queue.peak).toBe(1);
    const series = raw.result as RawSeries;
    expect(series.kind).toBe("raw");
    expect(series.signalId).toBe("conf-a/Lin.RAMP");
    expect(series.from).toBe(ns(B));
    expect(series.to).toBe(ns(B + S));
    expect(decodeTimes(series.t)).toEqual(RAW_AT);
    expect(series.v).toEqual([10, 20, null, 40, 50]);
    expect(series.before).toEqual({ t: ns(B - 50n * MS), v: 7 });
    expect(series.after).toEqual({ t: ns(B + S), v: 60 });
    expect(series.text).toBeUndefined();

    // A text signal's raw answer also carries each point's text and the edges' labels.
    const textual = (await run(rawRows(true), door, 10, B + S)).result as RawSeries;
    expect(textual.text).toEqual(["a", "b", "c", "d", "e"]);
    expect(textual.before).toEqual({ t: ns(B - 50n * MS), v: 7, label: "before" });

    // Bucket path: count 50 against target 10 over 100 s, width ceil(100 s / 9).
    const wide = await run(bucketRows, ramp, 10, B + 100n * S);
    expect(wide.sent.length).toBe(1);
    expect(wide.queue.peak).toBe(1);
    expect((wide.sent[0] as Sent).params.w).toEqual({ type: "long", value: 11_111_111_112n });
    expect(Number(((wide.sent[0] as Sent).params.lim as { value: number }).value)).toBe(10);
    const buckets = wide.result as BucketSeries;
    expect(buckets.kind).toBe("buckets");
    expect(buckets.width).toBe("11111111112");
    expect(decodeTimes(buckets.t)).toEqual([B, B + 11_111_111_112n, B + 22_222_222_224n]);
    expect(buckets.count).toEqual([20, 0, 4]);
    expect(buckets.sna).toEqual([1, 3, 0]);
    expect(buckets.mean).toEqual([1.5, null, 9.5]);
    expect(buckets.min).toEqual([0, null, 3]);
    expect(buckets.max).toEqual([3, null, 14]);
  });

  it("lists the native methods", () => {
    const { adapter } = fakeAdapter([]);
    // In the order of the contract's optional methods (design A2); `count` and `refExtent`,
    // `firstTimes` stay on the fallback.
    expect(nativeMethods(adapter)).toEqual([
      "extent",
      "series",
      "refCount",
      "loggerGaps",
      "stateChanges",
      "computedSeries",
      "events",
    ]);
  });
});

/** A Kusto client that records every query and answers by `answer(csl, index)` (it may throw). */
function scriptedAdapter(
  mapping: Partial<TableMapping>,
  answer: (csl: string, index: number) => unknown[][] = (csl) =>
    // `series` needs its count row (design A3); every other query answers no rows.
    /toscalar\(/.test(csl) ? [["n", null, null, null, 0, null, null, null]] : [],
) {
  const sent: Sent[] = [];
  const fake = {
    query: async (csl: string, params: Record<string, KustoParam>) => {
      sent.push({ csl, params });
      return answer(csl, sent.length - 1);
    },
    ping: async () => {},
  };
  return {
    adapter: new AdxSource(fake as never, { ...adxMapping, ...mapping }, adxEventMapping),
    sent,
  };
}

const flat = (csl: string) => csl.replace(/\s+/g, " ");

describe("ADX row metadata on a fake client (add-adx-row-metadata)", () => {
  it("reads the unit in the signal list query", async () => {
    const unitCall =
      /summarize[^|]*countif\([^|]*take_anyif\(\['unit'\], isnotempty\(\['unit'\]\)\)[^|]* by /;
    for (const withScope of [undefined, scope]) {
      const label = withScope ? "scoped" : "unscoped";
      const withUnit = scriptedAdapter({ unit: "unit" });
      await withUnit.adapter.listSignals(...(withScope ? [withScope] : []));
      expect(withUnit.sent.length, `${label} with unit: one query`).toBe(1);
      const text = flat((withUnit.sent[0] as Sent).csl);
      // One summarize computes the text flag and the unit.
      expect(text, label).toMatch(unitCall);
      if (withScope) {
        // The scope filters come first, as parameters.
        expect(
          text.startsWith(
            "['signals'] | where ['dataref'] == sref and ['timestamp'] >= sfrom and ['timestamp'] < sto",
          ),
        ).toBe(true);
        expect((withUnit.sent[0] as Sent).params.sref).toEqual({ type: "string", value: "conf-a" });
      }

      const without = scriptedAdapter({});
      await without.adapter.listSignals(...(withScope ? [withScope] : []));
      expect(without.sent.length, `${label} without unit: one query`).toBe(1);
      expect((without.sent[0] as Sent).csl, label).not.toContain("take_anyif");
    }

    // The unit column of the answer (after the text flag): trimmed, empty or null gives no unit.
    const { adapter } = scriptedAdapter({ unit: "unit" }, () => [
      ["conf-a", "A.B", false, "km/h"],
      ["conf-a", "C.D", true, "  mph  "],
      ["conf-a", "E.F", true, ""],
      ["conf-a", "G.H", false, "   "],
      ["conf-a", "I.J", false, null],
    ]);
    const listed = await adapter.listSignals();
    expect(listed.map((x) => `${x.name}|${x.unit ?? "-"}|${x.text === true}`)).toEqual([
      "A.B|km/h|false",
      "C.D|mph|true",
      "E.F|-|true",
      "G.H|-|false",
      "I.J|-|false",
    ]);
    for (const x of listed.filter((y) => y.unit === undefined))
      expect(x).not.toHaveProperty("unit");
  });

  it("passes the SNA texts to every value query", async () => {
    const texts = ["SNA", "INVLD"];
    const mode: SeriesRef = {
      dataRef: "conf-a",
      name: "State.MODE",
      sna: [{ lo: 14.5, hi: 15.5 }],
    };
    const labels: StateChangeRule = { kind: "labels", values: [0, 3], tolerance: 0.5 };
    const calls: [string, (a: AdxSource, s?: Scope) => Promise<unknown>][] = [
      ["raw", (a) => a.raw(ramp, B, B + S)],
      ["raw text with limit", (a) => a.raw(door, B, B + S, 10)],
      ["before", (a, s) => a.before(ramp, B + S, s)],
      ["after", (a, s) => a.after(door, B, s)],
      ["series raw", (a, s) => a.series(ramp, B, B + S, 10, 125n * MS, s)],
      ["series with a range", (a, s) => a.series(mode, B, B + S, 10, 125n * MS, s)],
      ["buckets", (a) => a.buckets(ramp, B, B + 10n * S, S)],
      ["stateChanges labels", (a, s) => a.stateChanges(mode, labels, 100, s)],
      ["stateChanges text", (a, s) => a.stateChanges(door, { kind: "text" }, 100, s)],
      ["listSignals", (a, s) => a.listSignals(s)],
    ];
    for (const extra of [{}, { unit: "unit" }]) {
      for (const withScope of [undefined, scope]) {
        const run = scriptedAdapter({ snaTexts: texts, ...extra });
        const plain = scriptedAdapter({ ...extra });
        for (const [label, call] of calls) {
          const before = run.sent.length;
          await call(run.adapter, withScope);
          expect(run.sent.length, `${label} sent a query`).toBeGreaterThan(before);
          for (const { csl, params } of run.sent.slice(before)) {
            expect(flat(csl), label).toContain("tostring(['text']) in (snat)");
            expect(params.snat, label).toEqual({ type: "dynamic", value: texts });
          }
          const beforePlain = plain.sent.length;
          await call(plain.adapter, withScope);
          for (const { csl, params } of plain.sent.slice(beforePlain)) {
            expect(csl, `${label} without the list`).not.toContain("snat");
            expect(Object.keys(params), `${label} without the list`).not.toContain("snat");
          }
        }
      }
    }

    // Together with a DBC range: both parts, joined by `or`.
    const both = scriptedAdapter({ snaTexts: texts });
    await both.adapter.raw(mode, B, B + S);
    const text = flat((both.sent[0] as Sent).csl);
    expect(text).toContain("v_ >= real(14.5) and v_ <= real(15.5)");
    expect(text).toContain("tostring(['text']) in (snat)");
    expect(text).toMatch(
      /real\(15\.5\)\) or tostring\(\['text'\]\) in \(snat\)|tostring\(\['text'\]\) in \(snat\) or \(v_ >= real\(14\.5\)/,
    );
  });

  it("falls back without the text column", async () => {
    // The first query fails as Kusto does for an unknown column; later ones answer rows.
    const missing = (name: string) =>
      new KustoError(
        `Semantic error: SEM0100: 'summarize' operator: Failed to resolve scalar expression named '${name}'`,
        400,
      );
    const rowsAfter =
      (rows: unknown[][], column = "nope") =>
      (_csl: string, index: number) => {
        if (index === 0) throw missing(column);
        return rows;
      };

    // SNA texts need the text column: a clear error, no fallback query.
    for (const extra of [{}, { unit: "unit" }]) {
      const { adapter, sent } = scriptedAdapter(
        { text: "nope", snaTexts: ["SNA"], ...extra },
        rowsAfter([]),
      );
      await expect(adapter.listSignals()).rejects.toThrow(
        "KIPSCOPE_SNA_TEXTS needs the text column 'nope' (KIPSCOPE_COLUMN_TEXT), which does not exist",
      );
      expect(sent.length).toBe(1);
    }

    // Only a unit column: the units are still read, no text signals.
    const unitOnly = scriptedAdapter(
      { text: "nope", unit: "unit" },
      rowsAfter([
        ["a", "X.Y", "km/h"],
        ["b", "X.Y", " "],
      ]),
    );
    const listed = await unitOnly.adapter.listSignals();
    expect(unitOnly.sent.length).toBe(2);
    const second = flat((unitOnly.sent[1] as Sent).csl);
    expect(second).toContain("take_anyif(['unit'], isnotempty(['unit']))");
    expect(second).not.toContain("countif");
    expect(second).not.toContain("distinct");
    expect(listed.length).toBe(2);
    expect(listed.every((x) => x.text !== true)).toBe(true);
    expect(listed.map((x) => `${x.dataRef}/${x.name}|${x.unit ?? "-"}`)).toEqual([
      "a/X.Y|km/h",
      "b/X.Y|-",
    ]);

    // Neither: today's distinct query.
    const neither = scriptedAdapter({ text: "nope" }, rowsAfter([["a", "X.Y"]]));
    expect(await neither.adapter.listSignals()).toEqual([{ dataRef: "a", name: "X.Y" }]);
    expect(neither.sent.length).toBe(2);
    expect(flat((neither.sent[1] as Sent).csl)).toContain("distinct");

    // A missing unit column is no fallback: the error stands.
    const noUnit = scriptedAdapter({ unit: "nope" }, rowsAfter([], "nope"));
    await expect(noUnit.adapter.listSignals()).rejects.toThrow(/nope/);
    expect(noUnit.sent.length).toBe(1);
  });
});

// add-adx-computed: the computed series of the ADX adapter on a fake client. The fake answers the
// columns k_, t_, v_, c_, m_, lo_, hi_ of design K-9 and reads the parameters by the names of K-8.
const NO_HOLD = 9_223_372_036_854_775_807n;

const parsed = (formula: string) => {
  const result = parseFormula(formula);
  if (!result.ok) throw new Error(result.message);
  return result.ast;
};
const input = (name: string, extra: Partial<ComputedInputRef> = {}): ComputedInputRef => ({
  dataRef: "conf-a",
  name,
  sna: [],
  ...extra,
});
/** Inputs in `formulaInputs` order. */
const computedOf = (formula: string, ...inputs: ComputedInputRef[]): ComputedRef => ({
  dataRef: "conf-a",
  ast: parsed(formula),
  inputs,
});
/** A long (or datetime) parameter as a bigint, so 2^63 - 1 is compared exactly. */
const big = (param: KustoParam | undefined): bigint => {
  if (!param) throw new Error("missing parameter");
  if (param.type !== "long" && param.type !== "datetime")
    throw new Error(`not an integer parameter: ${param.type}`);
  return BigInt(param.value);
};

type Call = { csl: string; params: Record<string, KustoParam>; abort: AbortSignal | undefined };

/** A fake Kusto client `query(csl, params, abort)` that records every call; `answer` may throw or wait. */
function computedFake(
  answer: (call: Call, index: number) => Promise<unknown[][]> | unknown[][],
  options?: { computedChunkRows?: number },
) {
  const calls: Call[] = [];
  const fake = {
    query: async (csl: string, params: Record<string, KustoParam>, abort?: AbortSignal) => {
      const call = { csl, params, abort };
      calls.push(call);
      return answer(call, calls.length - 1);
    },
    ping: async () => {},
  };
  const adapter = new AdxSource(fake as never, adxMapping, adxEventMapping, options);
  const compute = (
    ref: ComputedRef,
    from: bigint,
    to: bigint,
    target: number,
    width: bigint,
    abort?: AbortSignal,
  ) => {
    if (typeof adapter.computedSeries !== "function") throw new Error("no computedSeries");
    return adapter.computedSeries(ref, from, to, target, width, abort);
  };
  return { adapter, calls, compute };
}

const countRow = (count: number): unknown[] => ["n", "", null, count, null, null, null];
/** Two buckets at `start` and `start + 1 s` (listed out of order); the mean is the start in seconds. */
const bucketPair = (start: bigint): unknown[][] =>
  [start + S, start].map((b) => {
    const mean = Number((b - B) / S);
    return ["k", ns(b), mean, 2, 1, mean - 1, mean + 1];
  });
const expectedPair = (start: bigint) =>
  [start, start + S].map((b) => {
    const mean = Number((b - B) / S);
    return { start: b, count: 2, sna: 1, mean, min: mean - 1, max: mean + 1 };
  });

describe("ADX computed series on a fake client (add-adx-computed)", () => {
  it("answers a computed series with one query", async () => {
    const ref = computedOf(
      "Lin.RAMP - Sna.CODE + Beat.HB",
      input("Lin.RAMP"),
      input("Sna.CODE"),
      input("Beat.HB"),
    );
    const at = (n: bigint) => B + n * MS;
    // Count 5 against target 10: the points arrive out of time order; a null value is SNA.
    const raw = computedFake(() => [
      ["p", ns(at(300n)), 3, null, null, null, null],
      countRow(5),
      ["p", ns(at(100n)), 1, null, null, null, null],
      ["p", ns(at(500n)), null, null, null, null, null],
      ["p", ns(at(200n)), 2, null, null, null, null],
      ["p", ns(at(400n)), 4, null, null, null, null],
    ]);
    const rawAnswer = await raw.compute(ref, B, B + S, 10, 125n * MS);
    expect(raw.calls.length).toBe(1);
    const text = flat((raw.calls[0] as Call).csl);
    for (const word of ["scan declare", "toscalar(", "next(", "s2"]) expect(text).toContain(word);
    for (const word of ["join", "lookup", "materialize"])
      expect(text.toLowerCase(), word).not.toContain(word);
    expect(rawAnswer).toEqual({
      kind: "raw",
      points: [
        { t: at(100n), v: 1 },
        { t: at(200n), v: 2 },
        { t: at(300n), v: 3 },
        { t: at(400n), v: 4 },
        { t: at(500n), v: null },
      ],
    });

    // Count 50 against target 10: three buckets out of start order; an SNA-only bucket has null stats.
    const buckets = computedFake(() => [
      ["k", ns(B + 22_222_222_224n), 9.5, 4, 0, 3, 14],
      countRow(50),
      ["k", ns(B), 1.5, 20, 1, 0, 3],
      ["k", ns(B + 11_111_111_112n), null, 0, 3, null, null],
    ]);
    const bucketAnswer = await buckets.compute(ref, B, B + 100n * S, 10, 11_111_111_112n);
    expect(buckets.calls.length).toBe(1);
    expect(bucketAnswer).toEqual({
      kind: "buckets",
      buckets: [
        { start: B, count: 20, sna: 1, mean: 1.5, min: 0, max: 3 },
        { start: B + 11_111_111_112n, count: 0, sna: 3, mean: null, min: null, max: null },
        { start: B + 22_222_222_224n, count: 4, sna: 0, mean: 9.5, min: 3, max: 14 },
      ],
    });

    // An answer without a count row is an error, never a guess.
    const none = computedFake(() => [["p", ns(at(100n)), 1, null, null, null, null]]);
    await expect(none.compute(ref, B, B + S, 10, 125n * MS)).rejects.toThrow(
      "the computed query returned no count",
    );
  });

  it("compiles constants, names and seeds as parameters", async () => {
    const first = computedOf(
      "Lin.RAMP * 2.5 + min(Sna.CODE, 1e3)",
      input("Lin.RAMP", { seed: { t: B - 10n * MS, v: 5 } }),
      input("Sna.CODE", { seed: { t: B - S, v: null }, holdNs: 500n * MS }),
    );
    const a = computedFake(() => [countRow(0)]);
    await a.compute(first, B, B + 100n * S, 100, S);
    expect(a.calls.length).toBe(1);
    const { csl, params } = a.calls[0] as Call;
    for (const word of ["k0", "k1", "s0", "s1"]) expect(csl, word).toContain(word);
    for (const word of ["2.5", "Lin.RAMP", "Sna.CODE", "conf-a"])
      expect(csl, word).not.toContain(word);
    expect(params.k0).toEqual({ type: "real", value: 2.5 });
    expect(params.k1).toEqual({ type: "real", value: 1000 });
    expect(params.s0).toEqual({ type: "string", value: "Lin.RAMP" });
    expect(params.s1).toEqual({ type: "string", value: "Sna.CODE" });
    expect(params.ref).toEqual({ type: "string", value: "conf-a" });
    // Seeds: a value seed gives sv/ss 0, an SNA seed ss 1; times in ns.
    expect(params.sv0).toEqual({ type: "real", value: 5 });
    expect(params.ss0?.type).toBe("long");
    expect(big(params.ss0)).toBe(0n);
    expect(big(params.st0)).toBe(B - 10n * MS);
    expect(params.sv1).toEqual({ type: "real", value: 0 });
    expect(big(params.ss1)).toBe(1n);
    expect(big(params.st1)).toBe(B - S);
    // Hold limits: NO_HOLD (2^63 - 1, exact) without one.
    expect(big(params.h0)).toBe(NO_HOLD);
    expect(params.h0?.type).toBe("long");
    expect(big(params.h1)).toBe(500_000_000n);
    // The range and the single-query defaults of K-8.
    expect(big(params.t0)).toBe(B);
    expect(big(params.t1)).toBe(B + 100n * S);
    expect(big(params.lim)).toBe(100n);
    expect(big(params.cs)).toBe(B);
    expect(big(params.w)).toBe(S);
    expect(big(params.cr)).toBe(NO_HOLD);
    expect(params.snat).toBeUndefined();

    // A name with quotes travels as a parameter; an input without a seed has no seed parameters.
    const quoted = computedOf('abs("it\'s \\"q\\"")', input(`it's "q"`));
    const b = computedFake(() => [countRow(0)]);
    await b.compute(quoted, B, B + S, 100, 10n * MS);
    const second = b.calls[0] as Call;
    expect(second.csl).not.toContain("it's");
    expect(second.params.s0).toEqual({ type: "string", value: `it's "q"` });
    for (const name of ["sv0", "ss0", "st0"]) expect(second.params, name).not.toHaveProperty(name);
  });
});

describe("ADX computed chunks on a fake client (add-adx-computed round 2)", () => {
  const hold = 15n * MS;
  /** Three inputs with seeds for all; `holdC` null: no hold limit on the third. */
  const three = (holdC: bigint | null = hold) =>
    computedOf(
      "Lin.RAMP - Sna.CODE + Beat.HB",
      input("Lin.RAMP", { holdNs: hold, seed: { t: B - 5n * MS, v: 1 } }),
      input("Sna.CODE", { holdNs: hold, seed: { t: B - 6n * MS, v: 2 } }),
      input("Beat.HB", {
        ...(holdC === null ? {} : { holdNs: holdC }),
        seed: { t: B - 7n * MS, v: 3 },
      }),
    );
  const TO = B + 100n * S;

  /**
   * The query as the engine decides it (K-6): a chunk query (lim < 0) answers buckets, else raw at
   * `lim`, else buckets up to `cr`, else the count only.
   */
  const engine =
    (count: number) =>
    ({ params }: Call): unknown[][] => {
      const lim = big(params.lim);
      const cs = big(params.cs);
      if (lim < 0n) return [countRow(count), ...bucketPair(cs)];
      if (BigInt(count) <= lim)
        return [
          countRow(count),
          ["p", ns(B + 2n * MS), 2, null, null, null, null],
          ["p", ns(B + MS), 1, null, null, null, null],
        ];
      if (BigInt(count) <= big(params.cr)) return [countRow(count), ...bucketPair(cs)];
      return [countRow(count)];
    };
  const byStart = (calls: Call[]) =>
    [...calls].sort((x, y) => (big(x.params.cs) < big(y.params.cs) ? -1 : 1));

  it("splits a large computed bucket scan into chunks", async () => {
    const run = computedFake(engine(5000), { computedChunkRows: 1000 });
    const answer = await run.compute(three(), B, TO, 100, S);
    // The count query and three chunks, one text.
    expect(run.calls.length).toBe(4);
    const [first, ...chunks] = run.calls as [Call, ...Call[]];
    for (const call of run.calls) expect(call.csl).toBe(first.csl);
    expect(big(first.params.lim)).toBe(100n);
    expect(big(first.params.cr)).toBe(1000n);
    expect(big(first.params.cs)).toBe(B);
    expect(chunks.length).toBe(3);
    const [c1, c2, c3] = byStart(chunks) as [Call, Call, Call];
    // 100 buckets of 1 s over 3 chunks: split at 33 s and 66 s.
    expect([c1, c2, c3].map((c) => big(c.params.cs))).toEqual([B, B + 33n * S, B + 66n * S]);
    for (const chunk of [c1, c2, c3]) {
      expect(big(chunk.params.lim)).toBe(-1n);
      expect(big(chunk.params.cr)).toBe(NO_HOLD);
      expect(big(chunk.params.w)).toBe(S);
    }
    // The first chunk reads from `from`, the others a lookback of the largest hold limit.
    expect([c1, c2, c3].map((c) => big(c.params.t0))).toEqual([
      B,
      B + 33n * S - hold,
      B + 66n * S - hold,
    ]);
    expect([c1, c2, c3].map((c) => big(c.params.t1))).toEqual([B + 33n * S, B + 66n * S, TO]);
    // Every chunk carries the request's seeds.
    expect(first.params.sv0).toEqual({ type: "real", value: 1 });
    expect(first.params.sv1).toEqual({ type: "real", value: 2 });
    expect(first.params.sv2).toEqual({ type: "real", value: 3 });
    for (const chunk of [c1, c2, c3])
      for (const i of [0, 1, 2])
        for (const kind of ["sv", "ss", "st"])
          expect(chunk.params[`${kind}${i}`], `${kind}${i}`).toEqual(first.params[`${kind}${i}`]);
    // The answer is the chunks' buckets in chunk order.
    expect(answer).toEqual({
      kind: "buckets",
      buckets: [B, B + 33n * S, B + 66n * S].flatMap(expectedPair),
    });

    // No hold limit on one input: no chunks, one query, cr unbounded.
    const noHold = computedFake(engine(5000), { computedChunkRows: 1000 });
    expect((await noHold.compute(three(null), B, TO, 100, S)).kind).toBe("buckets");
    expect(noHold.calls.length).toBe(1);
    expect(big((noHold.calls[0] as Call).params.cr)).toBe(NO_HOLD);

    // A raw answer (count 50): one query.
    const rawRun = computedFake(engine(50), { computedChunkRows: 1000 });
    expect((await rawRun.compute(three(), B, TO, 100, S)).kind).toBe("raw");
    expect(rawRun.calls.length).toBe(1);

    // The default threshold (1,000,000) is far above 5,000: one query that carries it.
    const small = computedFake(engine(5000));
    expect((await small.compute(three(), B, TO, 100, S)).kind).toBe("buckets");
    expect(small.calls.length).toBe(1);
    expect(big((small.calls[0] as Call).params.cr)).toBe(1_000_000n);

    // A hold limit of 40 s: the lookback is clamped to `from`.
    const longHold = computedFake(engine(5000), { computedChunkRows: 1000 });
    expect((await longHold.compute(three(40n * S), B, TO, 100, S)).kind).toBe("buckets");
    expect(longHold.calls.length).toBe(4);
    const [l1, l2, l3] = byStart(longHold.calls.slice(1)) as [Call, Call, Call];
    expect([l1, l2, l3].map((c) => big(c.params.t0))).toEqual([B, B, B + 26n * S]);
  });

  it("queues each computed ADX query, not the whole call", async () => {
    const run = computedFake(engine(5000), { computedChunkRows: 1000 });
    const queue = new QueryQueue(8);
    const spy = vi.spyOn(queue, "run");
    const queued = queuedAdapter(run.adapter, queue);
    if (typeof queued.computedSeries !== "function") throw new Error("no computedSeries");
    const answer = await queued.computedSeries(three(), B, TO, 100, S);
    expect(answer.kind).toBe("buckets");
    expect(run.calls.length).toBe(4);
    // The count query and the three chunks each took a slot; never one slot for the whole call.
    expect(spy).toHaveBeenCalledTimes(4);
  });

  /** Chunk queries wait until their signal fires; the chunk at `failAt` throws instead. */
  const hanging = (failAt: bigint | undefined, signals: Map<bigint, AbortSignal | undefined>) => {
    const count = engine(5000);
    return (call: Call): Promise<unknown[][]> | unknown[][] => {
      if (big(call.params.lim) >= 0n) return count(call);
      const cs = big(call.params.cs);
      signals.set(cs, call.abort);
      if (cs === failAt) throw new Error("chunk failed");
      const { abort } = call;
      if (!abort) throw new Error("a chunk query needs an abort signal");
      return new Promise((_, reject) => {
        if (abort.aborted) reject(abort.reason);
        abort.addEventListener("abort", () => reject(abort.reason), { once: true });
      });
    };
  };

  it("aborts the other chunks when one fails", async () => {
    const signals = new Map<bigint, AbortSignal | undefined>();
    const run = computedFake(hanging(B + 33n * S, signals), { computedChunkRows: 1000 });
    await expect(run.compute(three(), B, TO, 100, S)).rejects.toThrow("chunk failed");
    expect([...signals.keys()].sort((x, y) => (x < y ? -1 : 1))).toEqual([
      B,
      B + 33n * S,
      B + 66n * S,
    ]);
    expect(signals.get(B)?.aborted).toBe(true);
    expect(signals.get(B + 66n * S)?.aborted).toBe(true);
  });

  it("aborts the chunks on the caller's abort", async () => {
    // design K-12: one local controller, aborted on the caller's abort too.
    const signals = new Map<bigint, AbortSignal | undefined>();
    const run = computedFake(hanging(undefined, signals), { computedChunkRows: 1000 });
    const reason = new Error("caller aborted");
    const controller = new AbortController();
    const outcome = run.compute(three(), B, TO, 100, S, controller.signal).then(
      () => "resolved" as unknown,
      (error: unknown) => error,
    );
    for (let i = 0; i < 100 && run.calls.length < 4; i++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    expect(run.calls.length).toBe(4);
    controller.abort(reason);
    expect(await outcome).toBe(reason);
    expect([...signals.values()].every((s) => s?.aborted)).toBe(true);
  });
});
