import {
  type BucketSeries,
  encodeTimes,
  type RawSeries,
  type SignalGaps,
  type SignalInfo,
} from "@kipscope/shared";
import { describe, expect, it } from "vitest";
import { snapCursorTime } from "../src/chart/cursors.ts";
import {
  atLevel,
  chartValueAt,
  legendHeaders,
  readoutCell,
  readoutDelta,
  readoutSource,
  sourceCell,
  sourceDelta,
} from "../src/chart/readout.ts";
import { LOADING } from "../src/values/format.ts";
import { ValueLoader } from "../src/values/loader.ts";
import { apiError } from "./apiError.ts";

// 2026-10-13T13:08:00Z in ns; everything below is an offset from it.
const T0 = 1_791_896_880_000_000_000n;
const ms = (n: number) => BigInt(Math.round(n * 1_000_000));
const at = (offsetMs: number) => T0 + ms(offsetMs);

/** SPEED_DISP-like raw window 13:08:00 – 13:08:03: 23 at .093 s, 22 at .194 s, 18 at .995 s. */
function rawSeries(extra: Partial<RawSeries> = {}, omit: ("before" | "after")[] = []): RawSeries {
  const series: RawSeries = {
    kind: "raw",
    signalId: "c/SPEED_DISP",
    from: T0.toString(),
    to: at(3000).toString(),
    t: encodeTimes([at(93), at(194), at(995)]),
    v: [23, 22, 18],
    before: { t: at(-93).toString(), v: 25 },
    after: { t: at(3005).toString(), v: 17 },
    ...extra,
  };
  for (const key of omit) delete series[key];
  return series;
}

/** Buckets of 1 s on the grid; t = bucket starts, empty buckets omitted. */
function buckets(
  starts: number[],
  count: number[],
  sna: number[],
  mean: (number | null)[],
): BucketSeries {
  return {
    kind: "buckets",
    signalId: "c/SPEED_DISP",
    from: T0.toString(),
    to: at(3000).toString(),
    width: "1000000000",
    t: encodeTimes(starts.map(at)),
    count,
    sna,
    mean,
    min: mean,
    max: mean,
  };
}

describe("chartValueAt", () => {
  it("evaluates raw results like evaluateAt, with edge neighbours", () => {
    const r = rawSeries();
    // A point exactly at t.
    expect(chartValueAt(r, at(93), "line")).toEqual({ kind: "raw", value: 23 });
    expect(chartValueAt(r, at(995), "step")).toEqual({ kind: "raw", value: 18 });
    // Between 23 at .093 and 22 at .194: halfway is 22.5 (line, markers), held 23 (step).
    const line = chartValueAt(r, at(143.5), "line");
    expect(line).toMatchObject({ kind: "interpolated" });
    expect((line as { value: number }).value).toBeCloseTo(22.5, 9);
    const markers = chartValueAt(r, at(143.5), "markers");
    expect(markers).toMatchObject({ kind: "interpolated" });
    expect((markers as { value: number }).value).toBeCloseTo(22.5, 9);
    expect(chartValueAt(r, at(143.5), "step")).toEqual({ kind: "held", value: 23 });
    // At the left edge the point before the range is the neighbour: 25 at -93 ms, 23 at +93 ms.
    const left = chartValueAt(r, T0, "line");
    expect(left).toMatchObject({ kind: "interpolated" });
    expect((left as { value: number }).value).toBeCloseTo(24, 9);
    // At the right edge the point after the range is: 18 at .995 s, 17 at 3.005 s, t = 2 s.
    const right = chartValueAt(r, at(2000), "line");
    expect((right as { value: number }).value).toBeCloseTo(17.5, 9);
    expect(chartValueAt(r, at(2000), "step")).toEqual({ kind: "held", value: 18 });
    // No point before: before_first; none after: after_last; no points at all: no_data.
    expect(chartValueAt(rawSeries({}, ["before"]), T0, "line")).toEqual({
      kind: "none",
      reason: "before_first",
    });
    expect(chartValueAt(rawSeries({}, ["after"]), at(2000), "line")).toEqual({
      kind: "none",
      reason: "after_last",
    });
    expect(
      chartValueAt(rawSeries({ t: encodeTimes([]), v: [] }, ["before", "after"]), at(1000), "line"),
    ).toEqual({ kind: "none", reason: "no_data" });
    // SNA point at or before t: SNA (D-010); an SNA neighbour in line mode: next_sna.
    expect(chartValueAt(rawSeries({ v: [23, null, 18] }), at(194), "line")).toEqual({
      kind: "sna",
    });
    expect(chartValueAt(rawSeries({ v: [23, null, 18] }), at(500), "line")).toEqual({
      kind: "sna",
    });
    expect(chartValueAt(rawSeries({ v: [23, 22, null] }), at(500), "line")).toEqual({
      kind: "none",
      reason: "next_sna",
    });
    // Nothing loaded yet.
    expect(chartValueAt(undefined, at(93), "line")).toBeUndefined();
  });

  it("takes the bucket mean in aggregated views, marked avg", () => {
    const b = buckets([0, 1000, 2000], [10, 7, 5], [0, 0, 0], [20, 25.5, 30]);
    expect(chartValueAt(b, at(500), "line")).toEqual({ kind: "aggregated", value: 20 });
    // [start, start + width): the start belongs to the bucket, the last ns to the previous one.
    expect(chartValueAt(b, at(1000), "line")).toEqual({ kind: "aggregated", value: 25.5 });
    expect(chartValueAt(b, at(1000) - 1n, "line")).toEqual({ kind: "aggregated", value: 20 });
    expect(chartValueAt(b, at(2999), "step")).toEqual({ kind: "aggregated", value: 30 });
    // The kind `avg` is the cell's tooltip.
    expect(readoutCell(chartValueAt(b, at(1500), "line"), "km/h", 3)).toEqual({
      text: "25.5",
      title: "bucket mean (avg)",
    });
  });

  it("reads SNA, empty buckets and cursors outside the range without a number", () => {
    // Middle bucket has SNA points only (mean null), the one at 2 s is missing.
    const b = buckets([0, 1000], [10, 0], [0, 4], [20, null]);
    expect(chartValueAt(b, at(1500), "line")).toEqual({ kind: "sna" });
    expect(chartValueAt(b, at(2500), "line")).toEqual({ kind: "none", reason: "empty_bucket" });
    // Outside [from, to): before the range, and at `to` itself.
    expect(chartValueAt(b, T0 - 1n, "line")).toEqual({ kind: "none", reason: "outside_range" });
    expect(chartValueAt(b, at(3000), "line")).toEqual({ kind: "none", reason: "outside_range" });
    expect(chartValueAt(rawSeries(), at(3000), "line")).toEqual({
      kind: "none",
      reason: "outside_range",
    });
    expect(chartValueAt(rawSeries(), at(-1), "line")).toEqual({
      kind: "none",
      reason: "outside_range",
    });

    // Cells: SNA reads SNA, no value reads — with the reason as tooltip.
    expect(readoutCell({ kind: "sna" }, "km/h", 3)).toMatchObject({ text: "SNA", sna: true });
    expect(readoutCell({ kind: "none", reason: "empty_bucket" }, "km/h", 3)).toMatchObject({
      text: "—",
      title: "no points in this bucket",
    });
    expect(readoutCell({ kind: "none", reason: "outside_range" }, "km/h", 3)).toMatchObject({
      text: "—",
      title: "outside this window's range",
    });
    expect(readoutCell({ kind: "none", reason: "after_last" }, "km/h", 3)).toMatchObject({
      text: "—",
      title: "after the last point",
    });
  });
});

describe("readout cells", () => {
  it("formats cells without unit, with SI prefix and digits, the kind as tooltip", () => {
    expect(readoutCell({ kind: "raw", value: 23 }, "km/h", 3)).toEqual({ text: "23.0" });
    expect(readoutCell({ kind: "interpolated", value: 362.40000000000003 }, "V", 3)).toEqual({
      text: "362",
      title: "linear between points (lin)",
    });
    expect(readoutCell({ kind: "interpolated", value: 362.40000000000003 }, "V", 4)).toEqual({
      text: "362.4",
      title: "linear between points (lin)",
    });
    expect(readoutCell({ kind: "held", value: 23 }, "km/h", 3)).toEqual({
      text: "23.0",
      title: "held from the last point (hold)",
    });
    // The prefix stays: the legend row's [1/min] names the unit.
    expect(readoutCell({ kind: "raw", value: 13970 }, "1/min", 3)).toEqual({ text: "14.0 k" });
  });

  it("computes Δ only from numbers and marks it avg > lin > hold", () => {
    const raw = (value: number) => ({ kind: "raw" as const, value });
    const lin = (value: number) => ({ kind: "interpolated" as const, value });
    const hold = (value: number) => ({ kind: "held" as const, value });
    const avg = (value: number) => ({ kind: "aggregated" as const, value });

    const LIN = "linear between points (lin)";
    const HOLD = "held from the last point (hold)";
    const AVG = "bucket mean (avg)";
    expect(readoutDelta(raw(23), raw(18), "km/h", 3)).toEqual({ text: "-5.00" });
    expect(readoutDelta(lin(362.40000000000003), lin(362.9), "V", 3)).toEqual({
      text: "500 m",
      title: LIN,
    });
    expect(readoutDelta(raw(1), hold(3), "km/h", 3)).toEqual({ text: "2.00", title: HOLD });
    expect(readoutDelta(hold(1), lin(3), "km/h", 3).title).toBe(LIN);
    expect(readoutDelta(lin(1), raw(3), "km/h", 3).title).toBe(LIN);
    // avg beats lin and hold, on either side.
    expect(readoutDelta(avg(10), raw(15), "km/h", 3)).toEqual({ text: "5.00", title: AVG });
    expect(readoutDelta(lin(10), avg(15), "km/h", 3).title).toBe(AVG);
    expect(readoutDelta(hold(10), avg(15), "km/h", 3).title).toBe(AVG);
    expect(readoutDelta(raw(10), raw(10), "km/h", 3)).toEqual({ text: "0" });

    // Any non-number: "—" without kind.
    const none = { kind: "none" as const, reason: "outside_range" as const };
    for (const [a, b] of [
      [{ kind: "sna" as const }, raw(1)],
      [raw(1), { kind: "sna" as const }],
      [none, raw(1)],
      [raw(1), none],
    ] as const) {
      const cell = readoutDelta(a, b, "km/h", 3);
      expect(cell.text).toBe("—");
      expect(cell.tag).toBeUndefined();
      expect(cell.title).toBeUndefined();
    }
  });

  it("shows the loading state in Δ while a value is not loaded, like the A and B cells", () => {
    const loading = { text: LOADING, loading: true, title: "loading" };
    expect(readoutDelta(undefined, { kind: "raw", value: 1 }, "km/h", 3)).toEqual(loading);
    expect(readoutDelta({ kind: "raw", value: 1 }, undefined, "km/h", 3)).toEqual(loading);
    expect(readoutDelta(undefined, undefined, "km/h", 3)).toEqual(loading);
    expect(readoutCell(undefined, "km/h", 3)).toEqual(loading);
  });
});

describe("cursor at the range end", () => {
  it("a B cursor placed at the right edge snaps inside the range and reads a value", () => {
    const to = at(3000);
    const series = rawSeries();
    // Placed 100 ns before `to` on a 3 s view (1 ms grid): snapping alone would land on `to`.
    const raw = to - 100n;
    expect(snapCursorTime(raw, 3_000_000_000n)).toBe(to);
    const snapped = snapCursorTime(raw, 3_000_000_000n, { from: T0, to });
    expect(snapped).toBe(to - 1_000_000n);
    // The flag and the cell agree: a value (interpolated toward the point after), not "—".
    const v = chartValueAt(series, snapped, "line");
    expect(v?.kind).toBe("interpolated");
    expect(chartValueAt(series, to, "line")).toEqual({ kind: "none", reason: "outside_range" });
  });
});

describe("readout source (D-031)", () => {
  const exact = (status: "loading" | "complete" | "error", value?: number) => ({
    status,
    request: "r",
    ...(value === undefined
      ? {}
      : {
          result: {
            signalId: "c/V",
            t: "1",
            mode: "line" as const,
            value: { kind: "raw" as const, value },
          },
        }),
    ...(status === "error" ? { error: "boom" } : {}),
  });
  const avg = { kind: "aggregated" as const, value: 20 };
  const outside = { kind: "none" as const, reason: "outside_range" as const };

  it("shows the exact server value, inside or outside the zoom", () => {
    expect(readoutSource(exact("complete", 23), avg, false)).toEqual({
      value: { kind: "raw", value: 23 },
      loading: false,
    });
    expect(readoutSource(exact("complete", 23), outside, false).value).toEqual({
      kind: "raw",
      value: 23,
    });
    expect(sourceCell(readoutSource(exact("complete", 23), outside, false), "km/h", 3)).toEqual({
      text: "23.0",
    });
  });

  it("shows the drawn value, dimmed, while the exact one loads; outside the zoom the previous one", () => {
    expect(readoutSource(exact("loading"), avg, false)).toEqual({ value: avg, loading: true });
    expect(readoutSource(exact("loading", 18), outside, false)).toEqual({
      value: { kind: "raw", value: 18 },
      loading: true,
    });
    expect(sourceCell(readoutSource(exact("loading"), outside, false), "km/h", 3).text).toBe("…");
  });

  it("follows the drawn curve live while a line is dragged", () => {
    expect(readoutSource(exact("complete", 23), avg, true)).toEqual({ value: avg, loading: false });
  });

  it("shows a too-wide value as — with the server's message as its tooltip", () => {
    const message =
      "too wide: 2,000 rows, more than the 1,000 a query may read; choose a shorter range";
    const wide = readoutSource(
      { ...exact("error"), error: message, errorStatus: 422, errorCode: "too_wide" },
      avg,
      false,
    );
    // The message itself, not `failed: …`.
    expect(sourceCell(wide, "V", 3)).toEqual({ text: "—", title: message });
  });

  it("shows a failed request as — with the message, and Δ as —", () => {
    const failed = readoutSource(exact("error"), avg, false);
    expect(sourceCell(failed, "V", 3)).toEqual({ text: "—", title: "failed: boom" });
    const ok = readoutSource(exact("complete", 1), avg, false);
    expect(sourceDelta(ok, failed, "V", 3)).toEqual({ text: "—" });
    expect(sourceDelta(ok, readoutSource(exact("complete", 3), avg, false), "V", 3)).toEqual({
      text: "2.00",
    });
    expect(sourceDelta(ok, readoutSource(exact("loading"), avg, false), "V", 3).loading).toBe(true);
  });
});

describe("state names in readouts", () => {
  const mode: SignalInfo = {
    id: "testcar/Ign_A20h.MODE",
    dataRef: "testcar",
    name: "Ign_A20h.MODE",
    states: "labels",
    sna: [{ raw: 15, value: 15, sources: ["VAL_"] }],
    dbc: {
      message: "Ign_A20h",
      messageId: 2592,
      factor: 1,
      offset: 0,
      values: [
        { raw: 0, label: "NONE", value: 0 },
        { raw: 3, label: "KEYON: Ignition on", value: 3 },
        { raw: 15, label: "SNA", value: 15 },
      ],
    },
  };
  const door: SignalInfo = {
    id: "testcar/DIAG.door",
    dataRef: "testcar",
    name: "DIAG.door",
    states: "text",
  };

  it("shows state names in readout cells", () => {
    expect(
      readoutCell({ kind: "raw", value: 3, label: "KEYON: Ignition on" }, undefined, 3),
    ).toEqual({ text: "KEYON", title: "KEYON: Ignition on · 3" });
    expect(readoutCell({ kind: "raw", value: 254, label: "SENSOR_DEF" }, undefined, 3)).toEqual({
      text: "SENSOR_DEF",
      title: "SENSOR_DEF · 254",
    });
    expect(readoutCell({ kind: "raw", value: 20.5 }, undefined, 3)).toEqual({ text: "20.5" });
    // A held value keeps its name too.
    expect(readoutCell({ kind: "held", value: 0, label: "NONE" }, undefined, 3).text).toBe("NONE");

    // Diff: "=" for the same state, "≠" for another; either side named is enough.
    const keyon = { kind: "raw" as const, value: 3, label: "KEYON: Ignition on" };
    const none = { kind: "raw" as const, value: 0, label: "NONE" };
    expect(readoutDelta(keyon, { ...keyon }, undefined, 3, mode).text).toBe("=");
    expect(readoutDelta(keyon, none, undefined, 3, mode).text).toBe("≠");
    // Text signals compare the text.
    const open = { kind: "raw" as const, value: 0, label: "open" };
    const closed = { kind: "raw" as const, value: 0, label: "closed" };
    expect(readoutDelta(open, closed, undefined, 3, door).text).toBe("≠");
    expect(readoutDelta(open, { ...open }, undefined, 3, door).text).toBe("=");
    // Numbers keep the plain Δ.
    expect(
      readoutDelta({ kind: "raw", value: 23 }, { kind: "raw", value: 18 }, "km/h", 3).text,
    ).toBe("-5.00");
  });

  it("names raw points and single-name buckets (L from drawn data)", () => {
    const raw = rawSeries(
      {
        t: encodeTimes([at(100), at(200), at(300)]),
        v: [0, 3, 3],
      },
      ["before", "after"],
    );
    // A point exactly at t: raw with its name.
    expect(chartValueAt(raw, at(200), "line", mode)).toEqual({
      kind: "raw",
      value: 3,
      label: "KEYON: Ignition on",
    });
    // Between NONE and KEYON the line mode holds the earlier name instead of 1.5.
    expect(chartValueAt(raw, at(150), "line", mode)).toEqual({
      kind: "held",
      value: 0,
      label: "NONE",
    });
    // Without info the value is a plain number.
    expect(chartValueAt(raw, at(150), "line")).toEqual({ kind: "interpolated", value: 1.5 });
    // A text signal: the row's text names the point.
    const text = rawSeries(
      { t: encodeTimes([at(100), at(200)]), v: [0, 0], text: ["closed", "open"] },
      ["before", "after"],
    );
    expect(chartValueAt(text, at(150), "step", door)).toEqual({
      kind: "held",
      value: 0,
      label: "closed",
    });

    // A bucket whose minimum and maximum share a name is named; one with two names shows the number.
    const same = { ...buckets([0], [4], [0], [3]), min: [3], max: [3] };
    expect(chartValueAt(same, at(500), "line", mode)).toEqual({
      kind: "aggregated",
      value: 3,
      label: "KEYON: Ignition on",
    });
    const mixed = { ...buckets([0], [4], [0], [1.5]), min: [0], max: [3] };
    expect(chartValueAt(mixed, at(500), "line", mode)).toEqual({ kind: "aggregated", value: 1.5 });
  });
});

describe("atLevel (open=0, precharge=1, closed=2)", () => {
  const states = [
    { low: 0, high: 0, text: "open" },
    { low: 1, high: 1, text: "precharge" },
    { low: 2, high: 2, text: "closed" },
  ];

  it("moves a named text state to its drawn level", () => {
    expect(atLevel({ kind: "raw", value: 0, label: "closed" }, states)).toEqual({
      kind: "raw",
      value: 2,
      label: "closed",
    });
    expect(atLevel({ kind: "held", value: 0, label: "precharge" }, states)).toEqual({
      kind: "held",
      value: 1,
      label: "precharge",
    });
    expect(atLevel({ kind: "raw", value: 0, label: "open" }, states)?.kind).toBe("raw");
  });

  it("leaves unnamed values, unknown names and signals without states as they are", () => {
    const plain = { kind: "raw", value: 5 } as const;
    expect(atLevel(plain, states)).toBe(plain);
    const unknown = { kind: "raw", value: 4, label: "other" } as const;
    expect(atLevel(unknown, states)).toEqual(unknown);
    const named = { kind: "raw", value: 0, label: "closed" } as const;
    expect(atLevel(named, undefined)).toBe(named);
    expect(atLevel(undefined, states)).toBeUndefined();
  });
});

describe("readouts across gaps (add-gap-display)", () => {
  const cyc: SignalGaps = { period: ms(20), logger: [] };

  it("reads gaps from the drawn data", () => {
    // Period 20 ms: points 1 at 0, 2 at 20, 3 at 40 and 4 at 500 ms.
    const r = rawSeries({ t: encodeTimes([at(0), at(20), at(40), at(500)]), v: [1, 2, 3, 4] }, [
      "before",
      "after",
    ]);
    // Step at 50 ms: held up to the hold end (40 + 20 = 60 ms).
    expect(chartValueAt(r, at(50), "step", undefined, cyc)).toEqual({ kind: "held", value: 3 });
    // Line at 30 ms between 2 and 3: interpolated; at 100 ms between 3 and 4: no data, period gap.
    expect(chartValueAt(r, at(30), "line", undefined, cyc)).toEqual({
      kind: "interpolated",
      value: 2.5,
    });
    expect(chartValueAt(r, at(100), "line", undefined, cyc)).toEqual({
      kind: "none",
      reason: "period_gap",
    });
    // Step beyond the hold end, and without gap info the old behaviour.
    expect(chartValueAt(r, at(70), "step", undefined, cyc)).toEqual({
      kind: "none",
      reason: "period_gap",
    });
    expect(chartValueAt(r, at(100), "line")).toMatchObject({ kind: "interpolated" });

    // Buckets of 1 s at 0, 1, 6 and 7 s (means 1..4), no period, a logger gap 1.5 s - 5.5 s.
    const b = {
      ...buckets([0, 1000, 6000, 7000], [1, 1, 1, 1], [0, 0, 0, 0], [1, 2, 3, 4]),
      to: at(10_000).toString(),
    };
    const logger: SignalGaps = { logger: [{ from: at(1500), to: at(5500) }] };
    // Inside the logger gap, and in the empty stretch beside it (5.7 s, after the gap's end).
    expect(chartValueAt(b, at(3000), "line", undefined, logger)).toEqual({
      kind: "none",
      reason: "logger_gap",
    });
    expect(chartValueAt(b, at(5700), "line", undefined, logger)).toEqual({
      kind: "none",
      reason: "logger_gap",
    });
    // A bucket that merely contains the start of the gap is read as its mean at a time before the gap.
    expect(chartValueAt(b, at(1200), "line", undefined, logger)).toEqual({
      kind: "aggregated",
      value: 2,
    });
    // Without gap info the empty stretch is just an empty bucket.
    expect(chartValueAt(b, at(5700), "line")).toEqual({ kind: "none", reason: "empty_bucket" });

    // A 20 ms signal's buckets of 5 ms with an empty stretch of 100 ms (5 ms - 105 ms).
    const fine: BucketSeries = {
      ...buckets([0, 105], [1, 1], [0, 0], [1, 2]),
      width: "5000000",
    };
    expect(chartValueAt(fine, at(50), "line", undefined, cyc)).toEqual({
      kind: "none",
      reason: "period_gap",
    });
    expect(chartValueAt(fine, at(2), "line", undefined, cyc)).toEqual({
      kind: "aggregated",
      value: 1,
    });
  });

  it("reads drawn data inside a stale logger gap", () => {
    // G9 repro: the logger gap 18:51:11.171 - 18:52:43.235 UTC holds drawn samples; read at 18:51:15.000.
    const gapFrom = 1_792_176_671_171_000_000n;
    const gapTo = 1_792_176_763_235_000_000n;
    const viewFrom = 1_792_176_671_385_000_000n;
    const viewTo = 1_792_176_680_691_000_000n;
    const t = 1_792_176_675_000_000_000n;
    const MS = 1_000_000n;
    const stale: SignalGaps = { logger: [{ from: gapFrom, to: gapTo }] };

    // STEER_ANGLE: 500 buckets of 20 ms from 18:51:11.400 (means alternating -1400 / 1400, so 18:51:15.000
    // is bucket 180, even: -1400), period 10 ms.
    const starts = Array.from(
      { length: 500 },
      (_, i) => 1_792_176_671_400_000_000n + BigInt(i) * 20n * MS,
    );
    const mean = starts.map((_, i) => (i % 2 === 0 ? -1400 : 1400));
    const lws: BucketSeries = {
      kind: "buckets",
      signalId: "smart451/STR_0D4h.STEER_ANGLE",
      from: viewFrom.toString(),
      to: viewTo.toString(),
      width: (20n * MS).toString(),
      t: encodeTimes(starts),
      count: starts.map(() => 2),
      sna: starts.map(() => 0),
      mean,
      min: mean,
      max: mean,
    };
    expect(
      chartValueAt(lws, t, "line", undefined, { period: 10n * MS, logger: stale.logger }),
    ).toEqual({
      kind: "aggregated",
      value: -1400,
    });

    // HTR_HV_Volt: 95 points 100 ms apart from the view start; 18:51:15.000 lies 15 ms after point 36
    // (350) towards point 37 (351): 350.15, interpolated, not logger_gap.
    const times = Array.from({ length: 95 }, (_, i) => viewFrom + BigInt(i) * 100n * MS);
    const ptc: RawSeries = {
      kind: "raw",
      signalId: "smart451/DCU_2B8h.HTR_HV_Volt",
      from: viewFrom.toString(),
      to: viewTo.toString(),
      t: encodeTimes(times),
      v: times.map((_, i) => 350 + (i % 2)),
    };
    const read = chartValueAt(ptc, t, "line", undefined, {
      period: 100n * MS,
      logger: stale.logger,
    });
    expect(read).toMatchObject({ kind: "interpolated" });
    expect((read as { value: number }).value).toBeCloseTo(350.15, 9);

    // A result with no sample inside the gap still reads logger_gap there (a real gap, G4/G7).
    const sparse: RawSeries = {
      ...ptc,
      t: encodeTimes([gapFrom - 1_000n * MS, gapTo + 1_000n * MS]),
      v: [1, 2],
    };
    expect(chartValueAt(sparse, t, "line", undefined, stale)).toEqual({
      kind: "none",
      reason: "logger_gap",
    });
  });

  it("reads gaps as no data, and Δ as —", () => {
    const logger = { kind: "none" as const, reason: "logger_gap" as const };
    const period = { kind: "none" as const, reason: "period_gap" as const };
    expect(readoutCell(logger, "V", 3)).toEqual({
      text: "no data",
      title: "no data: the logger recorded nothing",
      gap: true,
    });
    expect(readoutCell(period, "V", 3)).toEqual({
      text: "no data",
      title: "no data: more than 3 periods without a point",
      gap: true,
    });
    // Other reasons keep the dash.
    expect(readoutCell({ kind: "none", reason: "empty_bucket" }, "V", 3).text).toBe("—");

    // Δ needs two numbers: a gap on either side gives a plain dash.
    for (const [a, b] of [
      [logger, { kind: "raw" as const, value: 1 }],
      [{ kind: "raw" as const, value: 1 }, period],
      [logger, period],
    ] as const) {
      const cell = readoutDelta(a, b, "V", 3);
      expect(cell).toEqual({ text: "—" });
    }

    // From the server's exact value (A and B legends) the same cell.
    const exact = readoutSource(
      {
        status: "complete",
        request: "r",
        result: { signalId: "c/V", t: "1", mode: "line", value: logger },
      },
      { kind: "aggregated", value: 20 },
      false,
    );
    expect(sourceCell(exact, "V", 3)).toMatchObject({ text: "no data", gap: true });
    const ok = readoutSource(
      {
        status: "complete",
        request: "r",
        result: { signalId: "c/V", t: "1", mode: "line", value: { kind: "raw", value: 3 } },
      },
      { kind: "aggregated", value: 20 },
      false,
    );
    expect(sourceDelta(exact, ok, "V", 3)).toEqual({ text: "—" });
  });
});

describe("legend header row", () => {
  // A = 15:08:00.093456789 local (13:08:00.093Z), B = A + 902 ms; the clock is cut, never rounded up.
  const A = 1791896880093456789n;
  const B = A + 902_000_000n;

  it("heads the legend columns with the cursor times", () => {
    // Both cursors with diff: A, B and Δt.
    const both = legendHeaders(A, B, true);
    expect(both?.a).toEqual({ text: "A 15:08:00.093", title: "2026-10-13 15:08:00.093456789" });
    expect(both?.b?.text).toBe("B 15:08:00.995");
    expect(both?.b?.title).toBe("2026-10-13 15:08:00.995456789");
    expect(both?.d?.text).toBe("Δt +902 ms");

    // A alone: only the A cell.
    const alone = legendHeaders(A, undefined, false);
    expect(alone?.a?.text).toBe("A 15:08:00.093");
    expect(alone?.b).toBeUndefined();
    expect(alone?.d).toBeUndefined();

    // B without diff: A and B, no Δt.
    const noDiff = legendHeaders(A, B, false);
    expect(noDiff?.a?.text).toBe("A 15:08:00.093");
    expect(noDiff?.b?.text).toBe("B 15:08:00.995");
    expect(noDiff?.d).toBeUndefined();

    // Diff on while B is off: `B off`, no Δt.
    const bOff = legendHeaders(A, undefined, true);
    expect(bOff?.a?.text).toBe("A 15:08:00.093");
    expect(bOff?.b?.text).toBe("B off");
    expect(bOff?.d).toBeUndefined();

    // No cursor: no header row.
    expect(legendHeaders(undefined, undefined, false)).toBeUndefined();

    // Next-step hints (guidance "Next-step hints at the cursors"): B after A, Diff after B.
    const both_ = { b: true, diff: true };
    expect(legendHeaders(A, undefined, false, both_)?.hint).toBe("Shift+click sets B");
    expect(legendHeaders(A, B, false, both_)?.hint).toBe("Diff shows Δ and Δt");
    expect(legendHeaders(A, B, true, both_)?.hint).toBeUndefined();
    // A hint that was learned stays away.
    expect(legendHeaders(A, undefined, false, { b: false, diff: true })?.hint).toBeUndefined();
    expect(legendHeaders(A, B, false, { b: true, diff: false })?.hint).toBeUndefined();
  });
});

describe("missing signal in the readout", () => {
  const info = { id: "othercar/X", dataRef: "othercar", name: "X" } as SignalInfo;
  const drawn = { kind: "aggregated" as const, value: 20 };

  /** The value state of a request that failed with `error`, as the values loader keeps it. */
  async function failed(error: Error) {
    const loader = new ValueLoader(
      () => Promise.reject(error),
      () => {},
    );
    loader.update([{ key: "r:a", signalId: "othercar/X", t: "1", mode: "line" }]);
    await new Promise((r) => setTimeout(r, 0));
    return loader.get("r:a");
  }

  it("reads an unknown signal as missing", async () => {
    const missing = readoutSource(
      await failed(await apiError(404, "unknown_signal", "unknown signal: othercar/X")),
      drawn,
      false,
    );
    expect(missing).toMatchObject({ errorStatus: 404, errorCode: "unknown_signal" });
    expect(sourceCell(missing, "V", 3, info)).toEqual({
      text: "—",
      title: "Missing: othercar has no signal X",
    });

    // Any other failure keeps its message.
    const down = readoutSource(
      await failed(await apiError(502, "source_error", "boom")),
      drawn,
      false,
    );
    expect(sourceCell(down, "V", 3, info)).toEqual({
      text: "—",
      title: "failed: source_error: boom",
    });
  });
});
