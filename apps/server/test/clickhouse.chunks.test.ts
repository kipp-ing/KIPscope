import { parseFormula } from "@kipscope/shared";
import { describe, expect, it } from "vitest";
import { ClickHouseSource } from "../src/clickhouse.ts";
import type { ComputedRef, SeriesRef } from "../src/datasource.ts";
import { B } from "./conformance/fixture.ts";
import { testClient, testEventMapping, testMapping } from "./testdb.ts";

// Chunked and unchunked bucket answers over the conformance tables (spec computed-signals "Chunks
// read a lookback, not seeds"). Both sources read the same rows; only the chunk threshold differs.
const S = 1_000_000_000n;
const MS = 1_000_000n;

const signals = { ...testMapping, table: "conf_signals" };
const events = { ...testEventMapping, table: "conf_events" };

interface Recorded {
  query: string;
  params: Record<string, unknown>;
}

/** The test client, recording every query's text and parameters before it runs. */
function recordingClient(queries: Recorded[]) {
  const base = testClient();
  return new Proxy(base, {
    get(target, prop) {
      if (prop === "query") {
        return (o: { query: string; query_params?: Record<string, unknown> }) => {
          queries.push({ query: o.query, params: o.query_params ?? {} });
          return (target.query as (x: typeof o) => unknown)(o);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

const chunked = (queries?: Recorded[]) =>
  new ClickHouseSource(queries ? recordingClient(queries) : testClient(), signals, 30, events, {
    computedChunkRows: 100,
  });
const plain = (queries?: Recorded[]) =>
  new ClickHouseSource(queries ? recordingClient(queries) : testClient(), signals, 30, events);

const ramp: SeriesRef = { dataRef: "conf-a", name: "Lin.RAMP", sna: [] };
/** 7 is SNA (fixture.ts): Sna.CODE is 7 for 40 <= n <= 49. */
const code: SeriesRef = { dataRef: "conf-a", name: "Sna.CODE", sna: [{ lo: 6.5, hi: 7.5 }] };

function diff(holdRamp: bigint, holdCode: bigint): ComputedRef {
  const parsed = parseFormula("Lin.RAMP - Sna.CODE");
  if (!parsed.ok) throw new Error(parsed.message);
  return {
    dataRef: "conf-a",
    ast: parsed.ast,
    inputs: [
      { ...ramp, holdNs: holdRamp },
      { ...code, holdNs: holdCode },
    ],
  };
}

async function buckets(
  source: ClickHouseSource,
  ref: ComputedRef,
  width: bigint,
  from = B,
  to = B + 100n * S,
  target = 100,
) {
  if (typeof source.computedSeries !== "function") throw new Error("no computedSeries");
  const answer = await source.computedSeries(ref, from, to, target, width);
  expect(answer.kind).toBe("buckets");
  if (answer.kind !== "buckets") throw new Error("expected buckets");
  return answer.buckets;
}

describe("chunked computed buckets", () => {
  it("chunked buckets equal unchunked ones", async () => {
    // (a) hold limits 30 ms and 3 s, width 10 s: chunks split at B + 30 s and B + 60 s. Lin.RAMP
    // has a row every 10 ms and Sna.CODE every 1 s, so every ramp row is held by both.
    {
      const ref = diff(30n * MS, 3n * S);
      const whole = await buckets(plain(), ref, 10n * S);
      const parts = await buckets(chunked(), ref, 10n * S);
      expect(parts).toEqual(whole);
      // The values of "Ten buckets of 10 s": bucket 4 is all SNA (Sna.CODE is 7 for 40..49 s).
      expect(parts).toHaveLength(10);
      expect(parts).toEqual(
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
    // (b) Sna.CODE held for 500 ms only, Lin.RAMP for 30 ms, width 1 s: chunks split at B + 33 s
    // and B + 66 s. A ramp row is held by Sna.CODE only in the first 500 ms of each second, so the
    // second half of each bucket gives no row, and the rows at a split depend on the lookback.
    {
      const ref = diff(30n * MS, 500n * MS);
      const whole = await buckets(plain(), ref, S);
      const parts = await buckets(chunked(), ref, S);
      expect(parts).toEqual(whole);
      const at = (s: bigint) => parts.find((b) => b.start === B + s * S);
      // 51 ramp rows in [0, 500 ms] of a second: the held range is closed at the hold limit.
      expect(at(33n)).toMatchObject({ count: 51, sna: 0 });
      // Sna.CODE is SNA in [B + 40 s, B + 50 s): the same 51 rows are SNA.
      expect(at(45n)).toMatchObject({ count: 0, sna: 51 });
    }
    // (c) the hold limits of (b), width 2.5 s: the first split is at B + 32.5 s, between the
    // Sna.CODE rows at B + 32 s and B + 33 s, and that chunk's lookback (500 ms) starts exactly at
    // the row at B + 32 s.
    {
      const ref = diff(30n * MS, 500n * MS);
      const whole = await buckets(plain(), ref, 2500n * MS);
      const parts = await buckets(chunked(), ref, 2500n * MS);
      expect(parts).toEqual(whole);
      // The row at B + 32.5 s is held exactly 500 ms (closed range), then 51 rows each from B + 33 s
      // and B + 34 s: 1 + 51 + 51 = 103.
      expect(parts.find((b) => b.start === B + 32_500n * MS)).toMatchObject({
        count: 103,
        sna: 0,
      });
    }
  });

  it("keeps the lookback inside the request", async () => {
    // As a scope starting at B + 20 s clamps the request: [B + 20 s, B + 50 s), width 1 s, Sna.CODE
    // held 15 s, Lin.RAMP 30 ms. 3 chunks split at B + 30 s and B + 40 s, so c_1 - L = B + 15 s
    // lies before `from`. Lin.RAMP is row n = 100 * s at B + s, so the seed is the row before.
    const from = B + 20n * S;
    const to = B + 50n * S;
    const parsed = parseFormula("Lin.RAMP - Sna.CODE");
    if (!parsed.ok) throw new Error(parsed.message);
    const ref: ComputedRef = {
      dataRef: "conf-a",
      ast: parsed.ast,
      inputs: [
        { ...ramp, holdNs: 30n * MS, seed: { t: from - 10n * MS, v: 1999 } },
        { ...code, holdNs: 15n * S },
      ],
    };
    const whole: Recorded[] = [];
    const parts: Recorded[] = [];
    const expected = await buckets(plain(whole), ref, S, from, to, 100);
    const actual = await buckets(chunked(parts), ref, S, from, to, 100);
    expect(actual).toEqual(expected);
    // Sna.CODE is SNA from B + 40 s on and held 15 s: all 100 rows of B + 45 s are SNA.
    expect(actual.find((b) => b.start === B + 45n * S)).toMatchObject({ count: 0, sna: 100 });
    // No scan reads before `from`, chunked or not.
    for (const q of [...whole, ...parts]) {
      if (q.params.from !== undefined)
        expect(BigInt(String(q.params.from))).toBeGreaterThanOrEqual(from);
    }
    // Three chunk scans at B + 20 s, B + 30 s, B + 40 s: from = max(cs - 15 s, from).
    const scans = parts
      .filter((q) => q.params.cs !== undefined && /\bOVER\b/.test(q.query))
      .sort((x, y) => (BigInt(String(x.params.cs)) < BigInt(String(y.params.cs)) ? -1 : 1));
    expect(scans.map((q) => BigInt(String(q.params.cs)))).toEqual([from, B + 30n * S, B + 40n * S]);
    const [first, second, third] = scans as [Recorded, Recorded, Recorded];
    expect(BigInt(String(first.params.from))).toBe(from);
    expect(BigInt(String(second.params.from))).toBe(B + 20n * S);
    expect(BigInt(String(third.params.from))).toBe(B + 25n * S);
    // Every chunk carries the request's seeds.
    expect(first.params.sv0).toBe(1999);
    for (const chunk of [second, third]) {
      for (const i of [0, 1]) {
        expect(chunk.params[`sv${i}`]).toEqual(first.params[`sv${i}`]);
        expect(chunk.params[`ss${i}`]).toEqual(first.params[`ss${i}`]);
        expect(chunk.params[`st${i}`]).toEqual(first.params[`st${i}`]);
      }
    }
  });
});
