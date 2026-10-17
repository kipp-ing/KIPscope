import { describe, expect, it } from "vitest";
import { evaluateAt } from "../src/cursor.ts";
import {
  type GapInfo,
  loggerGapAt,
  loggerGapBetween,
  measurePeriod,
  NO_GAPS,
  type SignalGaps,
  signalGaps,
  splitBuckets,
  splitPoints,
  staticPeriod,
} from "../src/gaps.ts";
import type { SignalInfo } from "../src/signals.ts";

const MS = 1_000_000n;
const S = 1_000_000_000n;

/** n + 1 times from 0, spacing `spacing(i)` ns between time i and i + 1. */
function times(n: number, spacing: (i: number) => bigint): bigint[] {
  const out: bigint[] = [];
  let t = 0n;
  out.push(t);
  for (let i = 0; i < n; i++) {
    t += spacing(i);
    out.push(t);
  }
  return out;
}

describe("measurePeriod", () => {
  it("measures a period only from cyclic samples", () => {
    // 1,001 times 100 ms apart: 1,000 spacings, median 100 ms.
    expect(measurePeriod(times(1000, () => 100n * MS))).toBe(100n * MS);
    // 50 of the 1,000 spacings 1 s long = 5 % (not more than 5 %): accepted, the median stays 100 ms.
    expect(measurePeriod(times(1000, (i) => (i % 20 === 0 ? S : 100n * MS)))).toBe(100n * MS);
    // 51 long spacings = 5.1 %: refused.
    const fiftyOne = new Set(Array.from({ length: 51 }, (_, k) => k * 19));
    expect(measurePeriod(times(1000, (i) => (fiftyOne.has(i) ? S : 100n * MS)))).toBeUndefined();
    // 100 times = 99 spacings: too few.
    expect(measurePeriod(times(99, () => 100n * MS))).toBeUndefined();
    // Bursts of 2 ms spacings with every eighth spacing 333 ms: 12.5 % longer than 3 medians (6 ms).
    expect(measurePeriod(times(1000, (i) => (i % 8 === 7 ? 333n * MS : 2n * MS)))).toBeUndefined();
  });

  it("sorts a copy and counts duplicate times as spacings", () => {
    const shuffled = times(1000, () => 100n * MS).reverse();
    const copy = [...shuffled];
    expect(measurePeriod(shuffled)).toBe(100n * MS);
    expect(shuffled).toEqual(copy);
    // Zero spacings are spacings but not part of the median: 1,000 spacings of which 100 are 0 → median 100 ms.
    expect(measurePeriod(times(1000, (i) => (i % 10 === 0 ? 0n : 100n * MS)))).toBe(100n * MS);
    // Nothing to measure.
    expect(measurePeriod([])).toBeUndefined();
    expect(measurePeriod([5n])).toBeUndefined();
  });
});

describe("staticPeriod", () => {
  const base = { id: "car/X.Y", dataRef: "car", name: "X.Y" } as unknown as SignalInfo;
  it("takes the DBC cycle time, else the diag interval, else none", () => {
    expect(
      staticPeriod({ ...base, dbc: { cycleMs: 20 }, diag: { intervalMs: 10000 } } as never),
    ).toEqual({
      ns: 20n * MS,
      source: "dbc",
    });
    expect(staticPeriod({ ...base, diag: { intervalMs: 10000 } } as never)).toEqual({
      ns: 10n * S,
      source: "diag",
    });
    expect(staticPeriod(base)).toBeUndefined();
    expect(staticPeriod({ ...base, dbc: {} } as never)).toBeUndefined();
  });
});

describe("splitPoints", () => {
  const cyc: SignalGaps = { period: 20n * MS, logger: [] };
  const pause = [{ from: 1n * S, to: 61n * S }];

  it("splits points by period and by logger gaps", () => {
    // 60 ms = exactly 3 periods: not a gap; 61 ms is.
    expect(splitPoints(0n, 60n * MS, cyc)).toBeUndefined();
    expect(splitPoints(0n, 61n * MS, cyc)).toEqual({ kind: "period", holdEnd: 20n * MS });
    // Without a period only logger gaps split.
    expect(splitPoints(0n, 10n * S, { logger: [] })).toBeUndefined();
    expect(splitPoints(0n, 70n * S, { logger: pause })).toEqual({
      kind: "logger",
      holdEnd: 1n * S,
    });
    // Both: the kind is logger, the hold ends at the earlier end (the period).
    expect(splitPoints(0n, 70n * S, { period: 20n * MS, logger: pause })).toEqual({
      kind: "logger",
      holdEnd: 20n * MS,
    });
    // A logger gap between two points splits them even when they are close in periods.
    expect(
      splitPoints(0n, 10n * S, { period: 20n * S, logger: [{ from: 2n * S, to: 4n * S }] }),
    ).toEqual({
      kind: "logger",
      holdEnd: 2n * S,
    });
    // NO_GAPS never splits.
    expect(splitPoints(0n, 1000n * S, NO_GAPS)).toBeUndefined();
  });
});

describe("splitBuckets", () => {
  it("splits buckets only where a gap is certain", () => {
    // 30 s apart, 5 ms wide, period 30 s: the empty stretch (30 s - 5 ms) is under 3 periods: joined.
    expect(splitBuckets(0n, 30n * S, 5n * MS, { period: 30n * S, logger: [] })).toBeUndefined();
    // Empty stretch of 61 ms (> 3 x 20 ms): split by period.
    expect(splitBuckets(0n, 62n * MS, 1n * MS, { period: 20n * MS, logger: [] })).toBe("period");
    // Adjacent buckets (no empty stretch) are joined whatever the period.
    expect(splitBuckets(0n, 60n * S, 60n * S, { period: 20n * MS, logger: [] })).toBeUndefined();
    // Adjacent 1 min buckets, no period, a logger gap in the second half of the first bucket (between the centres).
    expect(splitBuckets(0n, 60n * S, 60n * S, { logger: [{ from: 45n * S, to: 55n * S }] })).toBe(
      "logger",
    );
    // A logger gap before the first centre does not split.
    expect(
      splitBuckets(0n, 60n * S, 60n * S, { logger: [{ from: 5n * S, to: 10n * S }] }),
    ).toBeUndefined();
  });
});

describe("logger gap lookup", () => {
  const logger = [
    { from: 10n, to: 20n },
    { from: 50n, to: 80n },
    { from: 100n, to: 120n },
  ];
  it("finds the earliest gap between two times and the gap at a time", () => {
    expect(loggerGapBetween(0n, 5n, logger)).toBeUndefined();
    expect(loggerGapBetween(0n, 200n, logger)).toEqual(logger[0]);
    expect(loggerGapBetween(25n, 60n, logger)).toEqual(logger[1]);
    // Touching is not overlapping: from < q and to > p.
    expect(loggerGapBetween(20n, 50n, logger)).toBeUndefined();
    expect(loggerGapBetween(0n, 10n, logger)).toBeUndefined();
    expect(loggerGapAt(15n, logger)).toEqual(logger[0]);
    expect(loggerGapAt(10n, logger)).toBeUndefined();
    expect(loggerGapAt(20n, logger)).toBeUndefined();
    expect(loggerGapAt(90n, logger)).toBeUndefined();
    expect(loggerGapAt(5n, [])).toBeUndefined();
  });
});

describe("signalGaps", () => {
  const info: GapInfo = {
    dataRef: "gapcar",
    through: "1790986199980000000",
    logger: [{ from: "1790985899980000000", to: "1790985960000000000" }],
    periods: { "gapcar/Cyc_B10h.CYC": { ns: "20000000", source: "dbc" } },
  };
  it("decodes the period and the logger gaps of one signal", () => {
    expect(signalGaps(info, "gapcar/Cyc_B10h.CYC")).toEqual({
      period: 20000000n,
      logger: [{ from: 1790985899980000000n, to: 1790985960000000000n }],
    });
    // No period for a signal without one; the logger gaps are the data ref's.
    expect(signalGaps(info, "gapcar/Evt_B11h.EVT").period).toBeUndefined();
    expect(signalGaps(info, "gapcar/Evt_B11h.EVT").logger).toHaveLength(1);
    expect(signalGaps(info, "gapcar/Cyc_B10h.CYC").logger).toBe(
      signalGaps(info, "gapcar/Evt_B11h.EVT").logger,
    );
    expect(signalGaps(undefined, "gapcar/Cyc_B10h.CYC")).toBe(NO_GAPS);
    expect(NO_GAPS).toEqual({ logger: [] });
  });
});

describe("a sample voids a logger gap", () => {
  // Scenario "Points and buckets inside a stale gap" (design G9 (a)): the logger gap 1 s - 61 s.
  const pause = [{ from: 1n * S, to: 61n * S }];
  const noPeriod: SignalGaps = { logger: pause };

  it("ignores a logger gap that holds a sample", () => {
    // Points inside the gap: it holds them, so it is stale for these pairs.
    expect(splitPoints(10n * S, 20n * S, noPeriod)).toBeUndefined();
    // A point on or before the gap's start with the next one inside it: the gap holds q.
    expect(splitPoints(0n, 10n * S, noPeriod)).toBeUndefined();
    // p inside the gap, q after it: the gap holds p.
    expect(splitPoints(20n * S, 70n * S, noPeriod)).toBeUndefined();
    // The gap lies within both points (p <= from, to <= q): a real split, hold ends at the gap's start.
    expect(splitPoints(0n, 70n * S, noPeriod)).toEqual({ kind: "logger", holdEnd: 1n * S });
    // The period rule still applies inside a stale gap: 50 ms > 3 x 10 ms.
    expect(splitPoints(10n * S, 10n * S + 50n * MS, { period: 10n * MS, logger: pause })).toEqual({
      kind: "period",
      holdEnd: 10n * S + 10n * MS,
    });
    // Buckets of 1 s at 10 s and 11 s both lie entirely inside the gap: joined.
    expect(splitBuckets(10n * S, 11n * S, 1n * S, noPeriod)).toBeUndefined();
    // Buckets at 0 s and 61 s straddle the gap's edges, neither lies inside: split by the logger gap.
    expect(splitBuckets(0n, 61n * S, 1n * S, noPeriod)).toBe("logger");
    // A reading across the stale gap interpolates: (1 + 3) / 2 at the middle of 10 s and 20 s.
    expect(
      evaluateAt(15n * S, "line", { t: 10n * S, v: 1 }, { t: 20n * S, v: 3 }, undefined, noPeriod),
    ).toEqual({ kind: "interpolated", value: 2 });
  });
});
