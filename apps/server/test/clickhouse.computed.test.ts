import { parseFormula } from "@kipscope/shared";
import { describe, expect, it } from "vitest";
import { ClickHouseSource } from "../src/clickhouse.ts";
import type { EventMapping, TableMapping } from "../src/config.ts";
import type { ComputedInputRef, ComputedRef } from "../src/datasource.ts";

// A client that records every query text and its parameters and answers a canned row count, so
// the compiled SQL is checked without a database (the conformance cases run the real queries).
const mapping: TableMapping = {
  database: "sdlog",
  table: "conf_signals",
  dataRef: "vehicle",
  signal: "signal",
  time: "utc",
  value: "value",
  text: "text",
};
const events: EventMapping = {
  table: "conf_events",
  source: "source",
  kind: "kind",
  name: "name",
  value: "value",
  text: "text",
  detail: "detail",
};

interface Recorded {
  query: string;
  params: Record<string, unknown>;
}

/**
 * `count` answers the row count of the count query; the scan answers no rows. `options` are the
 * constructor options of the source (`computedChunkRows`).
 */
function counting(count: number, options?: { computedChunkRows?: number }) {
  const queries: Recorded[] = [];
  const client = {
    query: async (o: { query: string; query_params?: Record<string, unknown> }) => {
      queries.push({ query: o.query, params: o.query_params ?? {} });
      const isCount = /\bcount\s*\(/i.test(o.query) && !/\bOVER\b/i.test(o.query);
      return { json: async () => (isCount ? [[String(count)]] : []) };
    },
  };
  const source = new ClickHouseSource(client as never, mapping, 30, events, options);
  return { source, queries };
}

const ast = (text: string) => {
  const parsed = parseFormula(text);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.ast;
};

const SIG_A = "Fast_100h.SIG_A";
const SIG_B = "Fast_100h.SIG_B";
const SIG_C = "Fast_100h.SIG_C";
const SPEED = "Sna_800h.SPEED";
const input = (name: string, extra: Partial<ComputedInputRef> = {}): ComputedInputRef => ({
  dataRef: "testcar",
  name,
  sna: [],
  ...extra,
});
/** Inputs in formulaInputs order. */
const refOf = (formula: string, ...inputs: ComputedInputRef[]): ComputedRef => ({
  dataRef: "testcar",
  ast: ast(formula),
  inputs,
});

const FROM = 1_791_158_400_000_000_000n;
const TO = FROM + 100_000_000_000n;

async function run(source: ClickHouseSource, ref: ComputedRef, target: number) {
  if (typeof source.computedSeries !== "function")
    throw new Error("ClickHouseSource has no computedSeries yet");
  return source.computedSeries(ref, FROM, TO, target, 1_000_000_000n);
}

/** The scan of a several-input computed series is a ROWS-framed window query (spec "Query count"). */
function expectRowsFrameScan(query: string) {
  expect(query).toContain("ROWS BETWEEN");
  expect(query).toContain("IGNORE NULLS OVER");
  expect(query).not.toContain("RANGE BETWEEN");
  expect(query).not.toContain("LIMIT 1 BY");
}
const occurrences = (text: string, word: string) =>
  text.match(new RegExp(`\\b${word}\\b`, "g"))?.length ?? 0;

const S = 1_000_000_000n;
const MS = 1_000_000n;

const everything = (queries: Recorded[]) => queries.map((q) => q.query).join("\n;\n");
const paramValues = (queries: Recorded[]) =>
  queries.flatMap((q) => Object.values(q.params).map((v) => String(v)));

describe("ClickHouse computed series compile (computed signals C9, F9)", () => {
  // spec computed-signals "Constants and names as parameters"
  it("compiles constants and names as parameters", async () => {
    const { source, queries } = counting(5000);
    const ref = refOf(
      `${SIG_A} * 2.5 + ${SPEED}`,
      input(SIG_A, { seed: { t: FROM - 5_000_000n, v: 0.25 }, holdNs: 15_000_000n }),
      input(SPEED, {
        sna: [{ lo: 510.5, hi: 511.5 }],
        seed: { t: FROM - 100_000_000n, v: 7 },
        holdNs: 300_000_000n,
      }),
    );
    await run(source, ref, 100);
    expect(queries.length).toBeGreaterThan(0);
    const sql = everything(queries);
    // The constant is a bound parameter.
    expect(sql).toContain("{k0:Float64}");
    expect(sql).not.toContain("2.5");
    // Neither signal name, nor the data ref, SNA bound, seed or hold limit is in the text.
    expect(sql).not.toContain(SIG_A);
    expect(sql).not.toContain(SPEED);
    expect(sql).not.toContain("testcar");
    expect(sql).not.toContain("510.5");
    expect(sql).not.toContain("511.5");
    expect(sql).not.toContain("15000000");
    expect(sql).not.toContain("300000000");
    // The parameters hold them.
    const scan = queries.find((q) => "k0" in q.params);
    expect(scan, "a query with parameter k0").toBeDefined();
    expect(Number(scan?.params.k0)).toBe(2.5);
    // Names come as s0, s1 in the order of the formula, in the text as parameters only.
    expect(sql).toContain("{s0:String}");
    expect(sql).toContain("{s1:String}");
    expect(scan?.params.s0).toBe(SIG_A);
    expect(scan?.params.s1).toBe(SPEED);
    const values = paramValues(queries);
    expect(values).toContain(SIG_A);
    expect(values).toContain(SPEED);
    expect(values).toContain("testcar");
    expect(values.some((v) => v.includes("510.5"))).toBe(true);
    expect(values).toContain("15000000");
    expect(values).toContain("300000000");
  });

  it("binds every constant of a formula on its own", async () => {
    const { source, queries } = counting(5000);
    await run(source, refOf(`${SIG_A} * 2.5 + ${SPEED} * 7`, input(SIG_A), input(SPEED)), 100);
    const sql = everything(queries);
    expect(sql).toContain("{k0:Float64}");
    expect(sql).toContain("{k1:Float64}");
    expect(sql).not.toMatch(/\b2\.5\b/);
    const scan = queries.find((q) => "k0" in q.params);
    expect(new Set([Number(scan?.params.k0), Number(scan?.params.k1)])).toEqual(new Set([2.5, 7]));
  });

  // spec computed-signals "Query count"
  it("computes in one scan", async () => {
    const { source, queries } = counting(5000);
    await run(source, refOf(`${SIG_A} - ${SPEED}`, input(SIG_A), input(SPEED)), 100);
    // The count and the scan, nothing else.
    expect(queries).toHaveLength(2);
    const [count, scan] = queries as [Recorded, Recorded];
    expect(count.query).toMatch(/count\s*\(/i);
    expect(count.query).not.toMatch(/\bOVER\b/i);
    expectRowsFrameScan(scan.query);
    for (const { query } of queries) {
      expect(query).not.toMatch(/\bJOIN\b/i);
      expect(query).not.toMatch(/\bUNION\b/i);
    }
  });

  it("sends the same two queries for a raw answer", async () => {
    const { source, queries } = counting(50);
    const answer = await run(source, refOf(`${SIG_A} - ${SPEED}`, input(SIG_A), input(SPEED)), 100);
    expect(queries).toHaveLength(2);
    expectRowsFrameScan(queries[1]?.query ?? "");
    expect(answer.kind).toBe("raw");
  });

  it("reads one input without a window", async () => {
    const { source, queries } = counting(5000);
    await run(source, refOf(`abs(${SIG_A})`, input(SIG_A)), 100);
    expect(queries).toHaveLength(2);
    expect(queries[1]?.query).not.toMatch(/\bOVER\b/i);
    expect(queries[1]?.query).toMatch(/\babs\(/);
  });

  // spec computed-signals "Query count" with three inputs
  it("computes three inputs in one scan", async () => {
    const { source, queries } = counting(5000);
    await run(
      source,
      refOf(
        `${SIG_A} - ${SIG_B} + ${SIG_C}`,
        input(SIG_A, { holdNs: 15_000_000n }),
        input(SIG_B, { holdNs: 15_000_000n }),
        input(SIG_C, { holdNs: 15_000_000n }),
      ),
      100,
    );
    expect(queries).toHaveLength(2);
    const [count, scan] = queries as [Recorded, Recorded];
    expect(count.query).not.toMatch(/\bOVER\b/i);
    expect(scan.query).toContain("{s0:String}");
    expect(scan.query).toContain("{s1:String}");
    expect(scan.query).toContain("{s2:String}");
    expect(scan.query).not.toContain("{s3:String}");
    expectRowsFrameScan(scan.query);
    for (const { query } of queries) {
      expect(query).not.toMatch(/\bJOIN\b/i);
      expect(query).not.toMatch(/\bUNION\b/i);
    }
    // One scan of all three signals, the names only as parameters in formula order.
    expect(scan.query).toMatch(/\bIN\b/);
    expect([scan.params.s0, scan.params.s1, scan.params.s2]).toEqual([SIG_A, SIG_B, SIG_C]);
    expect(scan.query).not.toContain("Fast_100h");
  });

  it("orders the name parameters by the formula, not by the input list", async () => {
    const { source, queries } = counting(5000);
    await run(source, refOf(`${SPEED} - ${SIG_A}`, input(SPEED), input(SIG_A)), 100);
    const scan = queries[1] as Recorded;
    expect([scan.params.s0, scan.params.s1]).toEqual([SPEED, SIG_A]);
  });

  // spec computed-signals "SNA and NaN inside min and max" (design S-4)
  it("keeps NaN through min and max in the SQL", async () => {
    const { source, queries } = counting(5000);
    await run(source, refOf(`min(min(${SIG_A}, 1), ${SPEED})`, input(SIG_A), input(SPEED)), 100);
    const scan = queries[1] as Recorded;
    expect(scan.query).toContain("isNaN(");
    // Each argument appears once: its definition and one use, however deeply min is nested.
    expect(occurrences(scan.query, "i0_v")).toBe(2);
    expect(occurrences(scan.query, "i1_v")).toBe(2);
  });

  it("compiles n-ary min and max", async () => {
    const { source, queries } = counting(5000);
    await run(
      source,
      refOf(
        `max(${SIG_A}, ${SIG_B}, ${SIG_C}, 4) + min(${SIG_A}, 2, ${SPEED})`,
        input(SIG_A),
        input(SIG_B),
        input(SIG_C),
        input(SPEED),
      ),
      100,
    );
    const sql = everything(queries);
    expect(sql).toMatch(/\bgreatest\s*\(/i);
    expect(sql).toMatch(/\bleast\s*\(/i);
    expect(sql).toContain("{k0:Float64}");
    expect(sql).toContain("{k1:Float64}");
    const scan = queries.find((q) => "k0" in q.params);
    expect(new Set([Number(scan?.params.k0), Number(scan?.params.k1)])).toEqual(new Set([4, 2]));
    expect(sql).not.toMatch(/\b4\b/);
  });
  // spec computed-signals "Chunk queries"
  describe("chunked bucket scan (D-110)", () => {
    const hold = 15n * MS;
    const three = (holdC: bigint | null = hold) =>
      refOf(
        `${SIG_A} - ${SIG_B} + ${SIG_C}`,
        input(SIG_A, { holdNs: hold, seed: { t: FROM - 5n * MS, v: 1 } }),
        input(SIG_B, { holdNs: hold, seed: { t: FROM - 6n * MS, v: 2 } }),
        input(SIG_C, {
          ...(holdC === null ? {} : { holdNs: holdC }),
          seed: { t: FROM - 7n * MS, v: 3 },
        }),
      );

    it("splits a large bucket scan into chunks", async () => {
      const { source, queries } = counting(5000, { computedChunkRows: 1000 });
      const answer = await run(source, three(), 100);
      expect(answer.kind).toBe("buckets");
      // The count and three scans.
      expect(queries).toHaveLength(4);
      const [count, ...scans] = queries as [Recorded, ...Recorded[]];
      expect(count.query).toMatch(/count\s*\(/i);
      expect(count.query).not.toMatch(/\bOVER\b/i);
      expect(scans).toHaveLength(3);
      for (const scan of scans) {
        expect(scan.query).toContain("{cs:Int64}");
        expectRowsFrameScan(scan.query);
        expect(scan.query).not.toMatch(/\bJOIN\b/i);
        expect(scan.query).not.toMatch(/\bUNION\b/i);
      }
      // Chunks start at bucket starts: 100 buckets of 1 s over 3 chunks split at 33 and 66.
      const byStart = [...scans].sort((x, y) =>
        BigInt(String(x.params.cs)) < BigInt(String(y.params.cs)) ? -1 : 1,
      );
      expect(byStart.map((q) => BigInt(String(q.params.cs)))).toEqual([
        FROM,
        FROM + 33n * S,
        FROM + 66n * S,
      ]);
      // The first chunk keeps its seeds and its range start; the others read the lookback and carry
      // the request's seeds too (design C-3).
      const [first, second, third] = byStart as [Recorded, Recorded, Recorded];
      expect(BigInt(String(first.params.from))).toBe(FROM);
      expect(first.params.sv0).toBe(1);
      expect(first.params.sv1).toBe(2);
      expect(first.params.sv2).toBe(3);
      for (const [chunk, cs] of [
        [second, FROM + 33n * S],
        [third, FROM + 66n * S],
      ] as const) {
        expect(BigInt(String(chunk.params.from))).toBe(cs - hold);
        for (const i of [0, 1, 2]) {
          expect(chunk.params[`sv${i}`]).toEqual(first.params[`sv${i}`]);
          expect(chunk.params[`ss${i}`]).toEqual(first.params[`ss${i}`]);
          expect(chunk.params[`st${i}`]).toEqual(first.params[`st${i}`]);
        }
      }
      // The chunks cover the range: the last one ends at the range end, the others at the next start.
      expect(BigInt(String(first.params.to))).toBe(FROM + 33n * S);
      expect(BigInt(String(second.params.to))).toBe(FROM + 66n * S);
      expect(BigInt(String(third.params.to))).toBe(TO);
      // The 40 s hold case (spec "Lookback stays inside the request"): c_1 - L lies before `from`.
      {
        const { source: bigHold, queries: bigQueries } = counting(5000, {
          computedChunkRows: 1000,
        });
        const bigAnswer = await run(bigHold, three(40n * S), 100);
        expect(bigAnswer.kind).toBe("buckets");
        expect(bigQueries).toHaveLength(4);
        const scans = bigQueries.slice(1);
        const byStart = [...scans].sort((x, y) =>
          BigInt(String(x.params.cs)) < BigInt(String(y.params.cs)) ? -1 : 1,
        ) as [Recorded, Recorded, Recorded];
        const [first, second, third] = byStart;
        expect(byStart.map((q) => BigInt(String(q.params.cs)))).toEqual([
          FROM,
          FROM + 33n * S,
          FROM + 66n * S,
        ]);
        // L = 40 s: the 2nd chunk's start minus L (FROM - 7 s) is clamped to FROM, the 3rd reads from
        // FROM + 26 s.
        expect(BigInt(String(first.params.from))).toBe(FROM);
        expect(BigInt(String(second.params.from))).toBe(FROM);
        expect(BigInt(String(third.params.from))).toBe(FROM + 26n * S);
        for (const chunk of [second, third]) {
          for (const i of [0, 1, 2]) {
            expect(chunk.params[`sv${i}`]).toEqual(first.params[`sv${i}`]);
            expect(chunk.params[`ss${i}`]).toEqual(first.params[`ss${i}`]);
            expect(chunk.params[`st${i}`]).toEqual(first.params[`st${i}`]);
          }
        }
        expect(first.params.sv0).toBe(1);
      }
    });

    it("does not chunk without hold limits, raw or small", async () => {
      // No hold limit on SIG_C.
      const noHold = counting(5000, { computedChunkRows: 1000 });
      const a = await run(noHold.source, three(null), 100);
      expect(a.kind).toBe("buckets");
      expect(noHold.queries).toHaveLength(2);
      // A raw answer (count 50 is below the target).
      const raw = counting(50, { computedChunkRows: 1000 });
      const b = await run(raw.source, three(), 100);
      expect(b.kind).toBe("raw");
      expect(raw.queries).toHaveLength(2);
      // The default threshold of 1,000,000 rows is far above 5,000.
      const small = counting(5000);
      const c = await run(small.source, three(), 100);
      expect(c.kind).toBe("buckets");
      expect(small.queries).toHaveLength(2);
      // The unchunked scan still reads from `from` with its seeds.
      const scan = small.queries[1] as Recorded;
      expect(BigInt(String(scan.params.from))).toBe(FROM);
      expect(scan.params.sv0).toBe(1);
      expectRowsFrameScan(scan.query);
    });
  });
});
