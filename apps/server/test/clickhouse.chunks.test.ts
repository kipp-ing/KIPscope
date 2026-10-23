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
const chunked = () =>
  new ClickHouseSource(testClient(), signals, 30, events, { computedChunkRows: 100 });
const plain = () => new ClickHouseSource(testClient(), signals, 30, events);

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

async function buckets(source: ClickHouseSource, ref: ComputedRef, width: bigint) {
  if (typeof source.computedSeries !== "function") throw new Error("no computedSeries");
  const answer = await source.computedSeries(ref, B, B + 100n * S, 100, width);
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
  });
});
