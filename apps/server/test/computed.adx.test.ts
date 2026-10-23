/**
 * Computed series on the ADX emulator (add-adx-computed): SNA from row texts, chunked buckets
 * equal unchunked ones, and a lookback that stays inside the request. Runs in `test:adx`
 * (`docker compose --profile adx up -d`, `seed:adx`). Expected values are computed by hand from
 * the seeded rows (seed-adx.ts), never from the code under test.
 */
import { parseFormula } from "@kipscope/shared";
import { describe, expect, it } from "vitest";
import { AdxSource } from "../src/adx.ts";
import type { TableMapping } from "../src/config.ts";
import type { Bucket, ComputedRef, SeriesRef, SourceAdapter } from "../src/datasource.ts";
import { completeSource, coreOnly } from "../src/fallbacks.ts";
import { KustoClient, type KustoParam } from "../src/kusto.ts";
import { adxEventMapping, adxMapping, TEST_ADX_DATABASE, testAdxUrl } from "./adxdb.ts";
import { B } from "./conformance/fixture.ts";

const S = 1_000_000_000n;
const MS = 1_000_000n;

const options = {
  cluster: testAdxUrl(),
  database: TEST_ADX_DATABASE,
  timeoutSeconds: 60,
};

const ast = (formula: string) => {
  const parsed = parseFormula(formula);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.ast;
};

describe("ADX computed series: row metadata (add-adx-computed)", () => {
  /** KMeta of add-adx-row-metadata R7 (seed-adx.ts), the SNA texts configured. */
  const meta = (extra: Partial<TableMapping> = {}) =>
    new AdxSource(
      new KustoClient(options),
      { ...adxMapping, table: "KMeta", snaTexts: ["SNA", "INVLD"], ...extra },
      adxEventMapping,
    );
  const input = (name: string): SeriesRef => ({ dataRef: "meta-a", name, sna: [] });

  it("computes SNA from row texts natively", async () => {
    // Spd.V - Flag.ERR over [B, B + 10 s), no seeds, no hold limits (held for ever). Spd.V n = 3, 4
    // (text SNA) and n = 7 (INVLD) are SNA, Flag.ERR k = 2 (text SNA) is SNA and held until k = 3.
    const ref: ComputedRef = {
      dataRef: "meta-a",
      ast: ast("Spd.V - Flag.ERR"),
      inputs: [input("Spd.V"), input("Flag.ERR")],
    };
    const native = completeSource(meta());
    const core = completeSource(coreOnly(meta()));
    expect(typeof meta().computedSeries).toBe("function");

    const at = (n: number) => B + BigInt(n) * S;
    // n: 0 -> 0 - 0; 1 -> 10 - 1; 2 -> 20 - SNA; 3, 4 -> SNA; 5 -> 50 - 0 (Flag k = 4 held);
    // 6 -> 60; 7 -> SNA; 8 -> 80; 9 -> 90.
    const values = [0, 9, null, null, null, 50, 60, null, 80, 90];
    const raw = {
      kind: "raw",
      points: values.map((v, n) => ({ t: at(n), v })),
    };
    // Two buckets of 5 s: {0, 9, SNA, SNA, SNA} and {50, 60, SNA, 80, 90}.
    const buckets = {
      kind: "buckets",
      buckets: [
        { start: B, count: 2, sna: 3, mean: 4.5, min: 0, max: 9 },
        { start: at(5), count: 4, sna: 1, mean: 70, min: 50, max: 90 },
      ],
    };
    for (const [label, source] of [
      ["native", native],
      ["core only", core],
    ] as const) {
      expect(await source.computedSeries(ref, B, at(10), 1000, S), `${label} raw`).toEqual(raw);
      expect(await source.computedSeries(ref, B, at(10), 5, 5n * S), `${label} buckets`).toEqual(
        buckets,
      );
    }
  });
});

describe("ADX computed series: chunks (add-adx-computed round 2)", () => {
  type Sent = { csl: string; params: Record<string, KustoParam> };

  /** The Kusto client, recording every query's text and parameters before it runs. */
  class RecordingClient extends KustoClient {
    readonly sent: Sent[] = [];
    override query(csl: string, params: Record<string, KustoParam>, abort?: AbortSignal) {
      this.sent.push({ csl, params });
      return super.query(csl, params, abort);
    }
  }

  const recording = (computedChunkRows?: number) => {
    const client = new RecordingClient(options);
    const source = new AdxSource(
      client,
      adxMapping,
      adxEventMapping,
      computedChunkRows === undefined ? {} : { computedChunkRows },
    );
    return { source, sent: client.sent };
  };
  /** Chunked (threshold 100 rows) and unchunked (default 1,000,000) over the conformance rows. */
  const chunked = () => recording(100);
  const plain = () => recording();

  const ramp: SeriesRef = { dataRef: "conf-a", name: "Lin.RAMP", sna: [] };
  /** 7 is SNA (fixture.ts): Sna.CODE is 7 for 40 <= n <= 49. */
  const code: SeriesRef = { dataRef: "conf-a", name: "Sna.CODE", sna: [{ lo: 6.5, hi: 7.5 }] };

  function diff(holdRamp: bigint, holdCode: bigint, seed?: { t: bigint; v: number }): ComputedRef {
    return {
      dataRef: "conf-a",
      ast: ast("Lin.RAMP - Sna.CODE"),
      inputs: [
        { ...ramp, holdNs: holdRamp, ...(seed ? { seed } : {}) },
        { ...code, holdNs: holdCode },
      ],
    };
  }

  async function buckets(
    source: SourceAdapter,
    ref: ComputedRef,
    width: bigint,
    from = B,
    to = B + 100n * S,
    target = 100,
  ): Promise<Bucket[]> {
    if (typeof source.computedSeries !== "function") throw new Error("no computedSeries");
    const answer = await source.computedSeries(ref, from, to, target, width);
    expect(answer.kind).toBe("buckets");
    if (answer.kind !== "buckets") throw new Error("expected buckets");
    return answer.buckets;
  }

  it("chunked buckets equal unchunked ones", async () => {
    // (a) hold limits 30 ms and 3 s, width 10 s: chunks split at B + 30 s and B + 60 s. Lin.RAMP
    // has a row every 10 ms and Sna.CODE every 1 s, so every ramp row is held by both.
    {
      const ref = diff(30n * MS, 3n * S);
      const parts = chunked();
      const whole = await buckets(plain().source, ref, 10n * S);
      const split = await buckets(parts.source, ref, 10n * S);
      expect(split).toEqual(whole);
      // The query really chunked: the count query and three chunks.
      expect(parts.sent.length).toBe(4);
      // The values of "Ten buckets of 10 s": bucket 4 is all SNA (Sna.CODE is 7 for 40..49 s).
      expect(split).toHaveLength(10);
      expect(split).toEqual(
        Array.from({ length: 10 }, (_, i) =>
          i === 4
            ? { start: B + 40n * S, count: 0, sna: 1000, mean: null, min: null, max: null }
            : {
                start: B + BigInt(i) * 10n * S,
                count: 1000,
                sna: 0,
                mean: 1000 * i + 497.5,
                min: 1000 * i,
                max: 1000 * i + 995,
              },
        ),
      );
    }
    // (b) Sna.CODE held 500 ms only, Lin.RAMP 30 ms, width 1 s: split at B + 33 s and B + 66 s. A
    // ramp row is held by Sna.CODE only in the first 500 ms of each second (closed range: 51 rows).
    {
      const ref = diff(30n * MS, 500n * MS);
      const parts = chunked();
      const whole = await buckets(plain().source, ref, S);
      const split = await buckets(parts.source, ref, S);
      expect(split).toEqual(whole);
      expect(parts.sent.length).toBe(4);
      const at = (s: bigint) => split.find((b) => b.start === B + s * S);
      expect(at(33n)).toMatchObject({ count: 51, sna: 0 });
      // Sna.CODE is SNA in [B + 40 s, B + 50 s): the same 51 rows are SNA.
      expect(at(45n)).toMatchObject({ count: 0, sna: 51 });
    }
    // (c) the hold limits of (b), width 2.5 s: the first split is at B + 32.5 s, between the
    // Sna.CODE rows at B + 32 s and B + 33 s; that chunk's lookback (500 ms) starts exactly at the
    // row at B + 32 s.
    {
      const ref = diff(30n * MS, 500n * MS);
      const parts = chunked();
      const whole = await buckets(plain().source, ref, 2500n * MS);
      const split = await buckets(parts.source, ref, 2500n * MS);
      expect(split).toEqual(whole);
      expect(parts.sent.length).toBe(4);
      // The ramp row at B + 32.5 s is held exactly 500 ms (closed), then 51 rows each from
      // B + 33 s and B + 34 s: 1 + 51 + 51 = 103.
      expect(split.find((b) => b.start === B + 32_500n * MS)).toMatchObject({
        count: 103,
        sna: 0,
      });
    }
  });

  it("keeps the lookback inside the request", async () => {
    // [B + 20 s, B + 50 s), width 1 s, Sna.CODE held 15 s, Lin.RAMP 30 ms: 3 chunks split at
    // B + 30 s and B + 40 s, so c_1 - L = B + 15 s lies before `from`. Lin.RAMP is row n = 100 * s
    // at B + s, so the seed is the row 10 ms before `from`.
    const from = B + 20n * S;
    const to = B + 50n * S;
    const ref = diff(30n * MS, 15n * S, { t: from - 10n * MS, v: 1999 });
    const whole = plain();
    const parts = chunked();
    const expected = await buckets(whole.source, ref, S, from, to);
    const actual = await buckets(parts.source, ref, S, from, to);
    expect(actual).toEqual(expected);
    // Sna.CODE is SNA from B + 40 s on and held 15 s: all 100 rows of B + 45 s are SNA.
    expect(actual.find((b) => b.start === B + 45n * S)).toMatchObject({ count: 0, sna: 100 });
    // No query reads before `from`, chunked or not.
    const time = (p: KustoParam | undefined) => {
      if (p?.type !== "datetime") throw new Error("t0 is not a datetime");
      return p.value;
    };
    for (const q of [...whole.sent, ...parts.sent])
      expect(time(q.params.t0), "t0").toBeGreaterThanOrEqual(from);
    // Count query + three chunks: t0 = max(cs - 15 s, from).
    expect(parts.sent.length).toBe(4);
    const chunks = parts.sent
      .slice(1)
      .sort((x, y) =>
        BigInt(x.params.cs?.value as bigint) < BigInt(y.params.cs?.value as bigint) ? -1 : 1,
      );
    expect(chunks.map((q) => BigInt(q.params.cs?.value as bigint))).toEqual([
      from,
      B + 30n * S,
      B + 40n * S,
    ]);
    expect(chunks.map((q) => time(q.params.t0))).toEqual([from, B + 20n * S, B + 25n * S]);
    // Every chunk carries the request's seed.
    const [first, ...others] = chunks as [Sent, ...Sent[]];
    expect(first.params.sv0).toEqual({ type: "real", value: 1999 });
    for (const chunk of others)
      for (const i of [0, 1])
        for (const kind of ["sv", "ss", "st"])
          expect(chunk.params[`${kind}${i}`], `${kind}${i}`).toEqual(first.params[`${kind}${i}`]);
  });
});
