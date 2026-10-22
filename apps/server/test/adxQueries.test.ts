/**
 * Query counts and answers of the ADX adapter's `extent` and `series` on a fake Kusto client
 * (speed-up-adx design A7): no emulator, so `pnpm test` runs it. The fake records each
 * `query(csl, params)` and answers the rows of design A1 (`extent`) or A3 (`series`).
 */
import { type BucketSeries, decodeTimes, type RawSeries } from "@kipscope/shared";
import { describe, expect, it } from "vitest";
import { AdxSource } from "../src/adx.ts";
import type { TableMapping } from "../src/config.ts";
import type { Scope, SeriesRef, SourceAdapter, StateChangeRule } from "../src/datasource.ts";
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
