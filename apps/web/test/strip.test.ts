import {
  type Density,
  EMPTY_WORKSPACE,
  type TimeseriesWindow,
  type ValuesWindow,
  type Workspace,
} from "@kipscope/shared";
import { describe, expect, it } from "vitest";
import {
  BAR_PX,
  formatSpan,
  RETRY_MS,
  stripBars,
  stripDataRef,
  stripLabel,
} from "../src/time/strip.ts";
import { stripDropText } from "../src/time/TimeStrip.tsx";

const S = 1_000_000_000n;
const MIN = 60n * S;
const H = 60n * MIN;
const D = 24n * H;

const density = (over: Partial<Density> = {}): Density => ({
  dataRef: "car",
  first: "0",
  last: (40n * S).toString(),
  width: (10n * S).toString(),
  start: "0",
  counts: [0, 10, 5, 0, 1],
  grid: ((10n * S) / 400n).toString(),
  drives: [],
  ...over,
});

describe("stripBars", () => {
  it("sizes and marks the bars", () => {
    expect(BAR_PX).toBe(24);
    expect(RETRY_MS).toBe(30_000);
    const bars = stripBars(density(), { from: 12n * S, to: 31n * S });
    // Empty 1 px; the largest count 24 px; 5 of 10 round(12) = 12; 1 of 10 is 2.4, floored up to 3.
    expect(bars.map((b) => b.height)).toEqual([1, 24, 12, 1, 3]);
    // [10 s, 20 s), [20 s, 30 s) and the empty [30 s, 40 s) meet [12 s, 31 s).
    expect(bars.map((b) => b.shown)).toEqual([false, true, true, true, false]);
  });

  it("treats the range as half-open and marks nothing without one", () => {
    // [10 s, 20 s) exactly: bucket 1 only; bucket 2 starts at the exclusive end, bucket 0 ends at the start.
    const exact = stripBars(density(), { from: 10n * S, to: 20n * S });
    expect(exact.map((b) => b.shown)).toEqual([false, true, false, false, false]);
    expect(stripBars(density()).map((b) => b.shown)).toEqual([false, false, false, false, false]);
  });

  it("counts buckets from a start before 1970", () => {
    const d = density({ start: (-20n * S).toString(), counts: [4, 4, 1] });
    const bars = stripBars(d, { from: -5n * S, to: 0n });
    expect(bars.map((b) => b.height)).toEqual([24, 24, 6]);
    expect(bars.map((b) => b.shown)).toEqual([false, true, false]);
  });
});

describe("formatSpan", () => {
  it("uses the largest unit it reaches, one decimal at most, no .0", () => {
    expect(formatSpan(20n * MIN)).toBe("20 min");
    expect(formatSpan(150n * MIN)).toBe("2.5 h");
    expect(formatSpan(45n * 1_000_000n)).toBe("45 ms");
    expect(formatSpan(5n * 365n * D)).toBe("5 y");
    expect(formatSpan(0n)).toBe("0 ms");
    expect(formatSpan(19n * S)).toBe("19 s");
    expect(formatSpan(6n * D)).toBe("6 d");
    expect(formatSpan(3n * H)).toBe("3 h");
    expect(formatSpan(364n * D)).toBe("364 d");
    expect(formatSpan(365n * D)).toBe("1 y");
    expect(formatSpan(90n * MIN)).toBe("1.5 h");
    // Below 1 ms the unit stays ms.
    expect(formatSpan(500_000n)).toBe("0.5 ms");
  });
});

describe("strip label and data ref with a scope (add-scope)", () => {
  // 2026-10-01T01:00:00Z and 02:00:00Z in ns, by hand.
  const T1 = 1790816400000000000n;
  const T2 = 1790820000000000000n;
  const scopeOf = (dataRef: string) => ({ dataRef, from: T1.toString(), to: T2.toString() });

  it("labels the shown span within the scope", () => {
    const d = density({
      first: T1.toString(),
      last: (T2 - 1n).toString(),
      width: (30n * S).toString(),
      start: T1.toString(),
      counts: [1],
      scope: { from: T1.toString(), to: T2.toString() },
    });
    expect(stripLabel(d, { from: T1 + 10n * MIN, to: T1 + 20n * MIN })).toBe(
      "10 min of 1 h in scope · 1 bar = 30 s",
    );
    expect(stripLabel(d)).toBe("1 h in scope · 1 bar = 30 s");
    // Without `scope` the label is the existing "recorded" text (last - first = 59 min 59.999999999 s).
    const { scope: _scope, ...plain } = d;
    expect(stripLabel(plain, { from: T1 + 10n * MIN, to: T1 + 20n * MIN })).toBe(
      "10 min of 60 min recorded · 1 bar = 30 s",
    );
  });

  it("takes the scope's data ref", () => {
    // The only window shows another data ref than the scope's.
    const windows = [ts("w1", ["othercar/Fast_100h.SIG_A"])];
    expect(stripDataRef(ws(windows, { scope: scopeOf("testcar") }))).toBe("testcar");
    expect(stripDataRef(ws(windows))).toBe("othercar");
    // A scope gives the data ref even with no window at all.
    expect(stripDataRef(ws([], { scope: scopeOf("testcar") }))).toBe("testcar");
  });
});

describe("stripLabel", () => {
  it("labels the shown and recorded spans", () => {
    const d = density({
      first: "0",
      last: (6n * D).toString(),
      width: (3n * H).toString(),
      start: "0",
      counts: [1],
    });
    expect(stripLabel(d, { from: 12n * S, to: 31n * S })).toBe(
      "19 s of 6 d recorded · 1 bar = 3 h",
    );
    expect(stripLabel(d)).toBe("6 d recorded · 1 bar = 3 h");
  });
});

const ts = (id: string, signals: string[]): TimeseriesWindow => ({
  id,
  kind: "timeseries",
  range: { from: "0", to: "10" },
  display: { mode: "line", envelope: false },
  signals: signals.map((signalId, i) => ({ id: `a${id}${i}`, signalId })),
});
const values = (id: string, signals: string[]): ValuesWindow => ({
  id,
  kind: "values",
  mode: "line",
  signals: signals.map((signalId, i) => ({ id: `a${id}${i}`, signalId })),
});
const ws = (windows: Workspace["windows"], extra: Partial<Workspace> = {}): Workspace => ({
  ...EMPTY_WORKSPACE,
  windows,
  ...extra,
});

describe("stripDataRef", () => {
  it("takes the data ref of the target window, else of any window", () => {
    // No window, no data ref.
    expect(stripDataRef(EMPTY_WORKSPACE)).toBeUndefined();
    // Only a values window: its first signal.
    expect(stripDataRef(ws([values("w1", ["carB/X", "carC/Y"])]))).toBe("carB");
    // The target is the first timeseries window, even behind a values window.
    const w = [values("w1", ["carB/X"]), ts("w2", ["carA/P", "carC/Q"]), ts("w3", ["carC/R"])];
    expect(stripDataRef(ws(w))).toBe("carA");
    // The window zoomed last wins.
    expect(stripDataRef(ws(w, { lastZoomed: "w3" }))).toBe("carC");
    // A target without signals: the first signal of any window in order.
    expect(stripDataRef(ws([ts("w1", []), values("w2", ["carB/X"]), ts("w3", ["carC/R"])]))).toBe(
      "carB",
    );
    // Signal names may contain a slash; the data ref ends at the first one.
    expect(stripDataRef(ws([ts("w1", ["smart451/A/B"])]))).toBe("smart451");
    // Windows without any signal.
    expect(stripDataRef(ws([ts("w1", []), values("w2", [])]))).toBeUndefined();
  });
});

describe("strip drop text for a selection", () => {
  it("names a selection that has no new state signals", () => {
    expect(stripDropText({ name: "4 signals", ok: false, reason: "none_new" })).toBe(
      "None of 4 signals has new named states",
    );
    // The one-signal wording stays as it was.
    expect(stripDropText({ name: "BRK_LMP", ok: true })).toBe(
      "Drop to mark state changes of BRK_LMP",
    );
    expect(stripDropText({ name: "3 signals", ok: true })).toBe(
      "Drop to mark state changes of 3 signals",
    );
  });
});
