import { type BucketSeries, encodeTimes, type RawSeries, type SignalGaps } from "@kipscope/shared";
import { describe, expect, it, vi } from "vitest";
import {
  LiveStore,
  labelPosition,
  liveCandidates,
  liveCell,
  liveLabelText,
  liveTime,
  NEAR_PX,
  nearestSignal,
  shouldRepublishLive,
} from "../src/chart/live.ts";
import { chartValueAt } from "../src/chart/readout.ts";

// 2026-10-13T13:08:00Z in ns; everything below is an offset from it.
const T0 = 1_791_896_880_000_000_000n;
const ms = (n: number) => BigInt(Math.round(n * 1_000_000));
const at = (offsetMs: number) => T0 + ms(offsetMs);

/** A raw window 13:08:00 – 13:08:03 with the given points (offsets in ms). */
function raw(
  signalId: string,
  points: [number, number | null][],
  extra: Partial<RawSeries> = {},
): RawSeries {
  return {
    kind: "raw",
    signalId,
    from: T0.toString(),
    to: at(3000).toString(),
    t: encodeTimes(points.map(([t]) => at(t))),
    v: points.map(([, v]) => v),
    ...extra,
  };
}

// V_ANZ 23 at .093 s; DVL 179.5 at .083 s and 180 at .103 s (L = .093 s is halfway: 179.75);
// PTC_HV_Volt 362.6 at .083 s and 363.0 at .103 s (halfway: 362.8).
const vAnz = raw("c/V_ANZ", [
  [93, 23],
  [194, 22],
]);
const dvl = raw("c/DVL", [
  [83, 179.5],
  [103, 180],
]);
const ptc = raw("c/PTC_HV_Volt", [
  [83, 362.6],
  [103, 363.0],
]);

describe("live time", () => {
  it("snaps the live time like a click, inside the shown range", () => {
    // 2 s over 1000 px: the grid is span/1000 = 2 ms, i.e. 1 ms steps.
    const shown = { from: T0, to: at(2000) };
    // Pointer at 13:08:00.0934567: offset 93_456_700 ns from the origin.
    expect(liveTime(93_456_700, T0, shown)).toBe(at(93));
    // Rounding of the fractional pixel offset: .0936 rounds to the .094 grid time.
    expect(liveTime(93_600_000.4, T0, shown)).toBe(at(94));
    // At the plot's right edge (offset = span) L stays inside the half-open range.
    expect(liveTime(2_000_000_000, T0, shown)).toBe(at(1999));
    expect(liveTime(2_000_000_000, T0, shown)).toBeLessThan(shown.to);
    // At the left edge it is the range start.
    expect(liveTime(0, T0, shown)).toBe(T0);
  });
});

describe("live value", () => {
  it("evaluates L from the drawn data: raw zoomed in, bucket mean zoomed out", () => {
    const L = at(93);
    const cell = (r: RawSeries | BucketSeries, unit: string, digits: 3 | 4 = 3) =>
      liveCell(chartValueAt(r, L, "line"), true, unit, digits);
    // Zoomed in: V_ANZ is a raw point (no tooltip), DVL and PTC are interpolated (lin).
    expect(cell(vAnz, "km/h")).toEqual({ text: "23.0" });
    expect(cell(dvl, "1/min")).toEqual({ text: "180", title: "linear between points (lin)" });
    expect(cell(ptc, "V")).toEqual({ text: "363", title: "linear between points (lin)" });
    // With four digits the interpolated 362.8 V shows its decimal.
    expect(cell(ptc, "V", 4).text).toBe("362.8");

    // Zoomed out: buckets of 1 s, mean 23 in the first one.
    const buckets: BucketSeries = {
      kind: "buckets",
      signalId: "c/V_ANZ",
      from: T0.toString(),
      to: at(3000).toString(),
      width: "1000000000",
      t: encodeTimes([at(0), at(1000)]),
      count: [10, 7],
      sna: [0, 0],
      mean: [23, 25.5],
      min: [20, 24],
      max: [26, 27],
    };
    expect(cell(buckets, "km/h")).toEqual({ text: "23.0", title: "bucket mean (avg)" });
    expect(liveCell(chartValueAt(buckets, at(1500), "line"), true, "km/h", 3)).toEqual({
      text: "25.5",
      title: "bucket mean (avg)",
    });

    // Without L the cell is empty (column kept), whatever value is loaded.
    expect(liveCell(chartValueAt(vAnz, L, "line"), false, "km/h", 3)).toEqual({ text: "" });
    expect(liveCell(undefined, false, "km/h", 3)).toEqual({ text: "" });
    // L set but nothing loaded yet: loading cell, not empty and not a number.
    expect(liveCell(undefined, true, "km/h", 3).loading).toBe(true);
  });

  it("reads SNA and gaps without a number and never highlights them", () => {
    // V_ANZ 09:56:59 – 09:57:01 with an SNA point exactly at L = 09:57:00.
    const sna = raw(
      "c/V_ANZ",
      [
        [500, 20],
        [1000, null],
        [1500, 21],
      ],
      {},
    );
    const vSna = chartValueAt(sna, at(1000), "line");
    const snaCell = liveCell(vSna, true, "km/h", 3);
    expect(snaCell.text).toBe("SNA");
    expect(snaCell.sna).toBe(true);
    expect(snaCell.text).not.toMatch(/\d/);
    expect(liveLabelText(vSna, "km/h", 3)).toBeUndefined();

    // Next point SNA in line mode: no value, with the reason.
    const next = chartValueAt(sna, at(750), "line");
    expect(liveCell(next, true, "km/h", 3)).toMatchObject({
      text: "—",
      title: "next point is SNA",
    });
    expect(liveLabelText(next, "km/h", 3)).toBeUndefined();

    // Before the first point, no data, empty bucket: dash with a tooltip, no label.
    const early = chartValueAt(raw("c/V_ANZ", [[500, 20]]), at(100), "line");
    expect(liveCell(early, true, "km/h", 3).text).toBe("—");
    expect(liveLabelText(early, "km/h", 3)).toBeUndefined();

    // Outside the window's range (another window, 13:09:00 – 13:09:10, L = 13:08:01).
    const other = raw("c/DVL", [[60_000, 180]], {
      from: at(60_000).toString(),
      to: at(70_000).toString(),
    });
    const outside = chartValueAt(other, at(1000), "line");
    expect(liveCell(outside, true, "1/min", 3)).toEqual({
      text: "—",
      title: "outside this window's range",
    });
    expect(liveLabelText(outside, "1/min", 3)).toBeUndefined();

    // Inside a logger gap (add-gap-display): "no data" in the gap style, no label, never a candidate.
    const paused = raw("c/PTC", [
      [500, 360],
      [2500, 361],
    ]);
    const gaps: SignalGaps = { logger: [{ from: at(1000), to: at(2000) }] };
    const vGap = chartValueAt(paused, at(1500), "line", undefined, gaps);
    expect(vGap).toEqual({ kind: "none", reason: "logger_gap" });
    expect(liveCell(vGap, true, "V", 3)).toEqual({
      text: "no data",
      title: "no data: the logger recorded nothing",
      gap: true,
    });
    expect(liveLabelText(vGap, "V", 3)).toBeUndefined();
    expect(liveCandidates([{ key: "s1", scale: "u:V", value: vGap }], () => 50, 100)).toEqual([]);
    // More than 3 periods without a point: the same, with the period reason.
    const vPeriod = chartValueAt(paused, at(1500), "line", undefined, {
      period: ms(100),
      logger: [],
    });
    expect(liveCell(vPeriod, true, "V", 3)).toMatchObject({ text: "no data", gap: true });
    expect(liveCandidates([{ key: "s1", scale: "u:V", value: vPeriod }], () => 50, 100)).toEqual(
      [],
    );
  });
});

describe("nearest curve", () => {
  const key = (ds: number[], pointerY = 100) =>
    nearestSignal(
      ds.map((d, i) => ({ key: `s${i + 1}`, y: pointerY + d })),
      pointerY,
    );

  it("picks the nearest curve within 16 px, on a tie the later one", () => {
    expect(NEAR_PX).toBe(16);
    // 17 px, 3 px, 5 px: the second.
    expect(key([17, 3, 5])).toBe("s2");
    // 3 px above and 3 px below: equal distance, the later in the legend.
    expect(
      nearestSignal(
        [
          { key: "s1", y: 97 },
          { key: "s2", y: 103 },
        ],
        100,
      ),
    ).toBe("s2");
    expect(
      nearestSignal(
        [
          { key: "s1", y: 103 },
          { key: "s2", y: 97 },
        ],
        100,
      ),
    ).toBe("s2");
    // Exactly 16 px is a hit, 16.5 px is not.
    expect(key([16])).toBe("s1");
    expect(key([-16])).toBe("s1");
    expect(key([16.5])).toBeUndefined();
    // No candidates, none near.
    expect(nearestSignal([], 100)).toBeUndefined();
    expect(key([20, -30])).toBeUndefined();
    // The maximum is a parameter.
    expect(nearestSignal([{ key: "s1", y: 112 }], 100, 12)).toBe("s1");
  });
});

describe("label", () => {
  it("places the label beside the curve point, inside the plot", () => {
    // Text: unit with SI prefix; 23 km/h with 3 digits, 362.8 V with 4.
    expect(liveLabelText({ kind: "raw", value: 23 }, "km/h", 3)).toBe("23.0 km/h");
    expect(liveLabelText({ kind: "interpolated", value: 362.8 }, "V", 4)).toBe("362.8 V");
    expect(liveLabelText({ kind: "aggregated", value: 23 }, "km/h", 3)).toBe("23.0 km/h");
    expect(liveLabelText({ kind: "held", value: 23 }, "km/h", 3)).toBe("23.0 km/h");

    const plot = { width: 400, height: 200 };
    const size = { width: 60, height: 16 };
    // Gap 6 px: right of and above the point.
    expect(labelPosition({ x: 100, y: 100 }, size, plot, 6)).toEqual({ left: 106, top: 78 });
    // Default gap is LABEL_GAP_PX = 6.
    expect(labelPosition({ x: 100, y: 100 }, size, plot)).toEqual({ left: 106, top: 78 });
    // Would cross the right edge: left of the point.
    expect(labelPosition({ x: 380, y: 100 }, size, plot, 6)).toEqual({ left: 314, top: 78 });
    // Would cross the top: below the point.
    expect(labelPosition({ x: 100, y: 10 }, size, plot, 6)).toEqual({ left: 106, top: 16 });
    // Both: left of and below.
    expect(labelPosition({ x: 380, y: 10 }, size, plot, 6)).toEqual({ left: 314, top: 16 });
    // Never covers the curve point, and stays inside the plot, for points all over the plot.
    for (const x of [0, 5, 100, 340, 399, 400]) {
      for (const y of [0, 5, 20, 100, 195, 200]) {
        const p = labelPosition({ x, y }, size, plot, 6);
        expect(p.left).toBeGreaterThanOrEqual(0);
        expect(p.top).toBeGreaterThanOrEqual(0);
        expect(p.left + size.width).toBeLessThanOrEqual(plot.width);
        expect(p.top + size.height).toBeLessThanOrEqual(plot.height);
        const covers =
          x >= p.left && x <= p.left + size.width && y >= p.top && y <= p.top + size.height;
        expect(covers).toBe(false);
      }
    }
    // A label wider than the room on either side is clamped into the plot.
    const narrow = { width: 50, height: 200 };
    expect(labelPosition({ x: 30, y: 100 }, size, narrow, 6).left).toBe(0);
  });
});

describe("LiveStore", () => {
  /** Manual animation frames. */
  function frames() {
    let next = 1;
    const queue = new Map<number, () => void>();
    return {
      raf: (fn: () => void) => {
        queue.set(next, fn);
        return next++;
      },
      caf: (id: number) => void queue.delete(id),
      pending: () => queue.size,
      run: () => {
        const fns = [...queue.values()];
        queue.clear();
        for (const fn of fns) fn();
      },
    };
  }
  const make = () => {
    const f = frames();
    const store = new LiveStore(f.raf, f.caf);
    const listener = vi.fn();
    store.subscribe(listener);
    return { f, store, listener };
  };

  it("publishes at most one live time per animation frame", () => {
    const { f, store, listener } = make();
    expect(store.get()).toBeUndefined();
    for (let i = 1; i <= 10; i++) store.set({ windowId: "w1", t: BigInt(i) });
    // Nothing published before the frame.
    expect(listener).not.toHaveBeenCalled();
    expect(store.get()).toBeUndefined();
    f.run();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.get()).toEqual({ windowId: "w1", t: 10n });
    // Same value again: the snapshot stays the same object.
    const snapshot = store.get();
    store.set({ windowId: "w1", t: 10n });
    f.run();
    expect(store.get()).toBe(snapshot);
    // A new frame, a new notification; near is part of the value.
    store.set({ windowId: "w1", t: 11n, near: "a1" });
    f.run();
    expect(store.get()).toEqual({ windowId: "w1", t: 11n, near: "a1" });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("stops notifying after unsubscribe", () => {
    const { f, store, listener } = make();
    const other = vi.fn();
    const off = store.subscribe(other);
    off();
    store.set({ windowId: "w1", t: 1n });
    f.run();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });

  it("clears at once and drops a queued set of that owner only", () => {
    const { f, store, listener } = make();
    store.set({ windowId: "w1", t: 1n });
    f.run();
    expect(store.get()?.t).toBe(1n);
    // clear() without id clears at once and notifies.
    store.clear();
    expect(store.get()).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(2);

    // A queued set of w1 is dropped by clear("w1") ...
    store.set({ windowId: "w1", t: 2n });
    store.clear("w1");
    f.run();
    expect(store.get()).toBeUndefined();
    // ... but not by clear("w2").
    store.set({ windowId: "w1", t: 3n });
    store.clear("w2");
    f.run();
    expect(store.get()).toEqual({ windowId: "w1", t: 3n });
    // clear(owner) clears the current L; clear(other) leaves it.
    store.clear("w2");
    expect(store.get()?.t).toBe(3n);
    store.clear("w1");
    expect(store.get()).toBeUndefined();
  });

  it("ignores sets while suspended, counted, until every release has run", () => {
    const { f, store } = make();
    store.set({ windowId: "w1", t: 1n });
    f.run();
    const releaseA = store.suspend();
    // Suspending clears.
    expect(store.get()).toBeUndefined();
    const releaseB = store.suspend();
    store.set({ windowId: "w1", t: 2n });
    f.run();
    expect(store.get()).toBeUndefined();
    releaseA();
    releaseA(); // idempotent: the second call does not release B
    store.set({ windowId: "w1", t: 3n });
    f.run();
    expect(store.get()).toBeUndefined();
    releaseB();
    store.set({ windowId: "w1", t: 4n });
    f.run();
    expect(store.get()).toEqual({ windowId: "w1", t: 4n });
  });

  it("hides L during a drag: suspend drops a queued set and the release restores the next one", () => {
    const { f, store, listener } = make();
    store.set({ windowId: "w1", t: 1n });
    f.run();
    expect(listener).toHaveBeenCalledTimes(1);
    // A set is queued in the frame in which a cursor-line or height drag starts.
    store.set({ windowId: "w1", t: 2n });
    expect(f.pending()).toBe(1);
    const release = store.suspend();
    // The queued set is dropped (no frame left) and L is cleared at once: 1 publish + 1 clear.
    expect(f.pending()).toBe(0);
    expect(store.get()).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(2);
    // Moves during the drag change nothing and notify nobody.
    store.set({ windowId: "w1", t: 3n });
    store.set({ windowId: "w2", t: 4n });
    expect(f.pending()).toBe(0);
    f.run();
    expect(store.get()).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(2);
    // Release does not bring the old L back; only the next set after it publishes.
    release();
    expect(store.get()).toBeUndefined();
    f.run();
    expect(store.get()).toBeUndefined();
    store.set({ windowId: "w1", t: 5n });
    f.run();
    expect(store.get()).toEqual({ windowId: "w1", t: 5n });
    expect(listener).toHaveBeenCalledTimes(3);
  });
});

describe("near candidates", () => {
  it("builds near candidates only from numbers inside the plot", () => {
    const num = (value: number) => ({ kind: "raw" as const, value });
    // toY maps a value to its y per scale; here the value is the y itself (scale "y" or "y2").
    const toY = (value: number) => value;
    const signals = [
      { key: "sna", scale: "y", value: { kind: "sna" as const } },
      { key: "gap", scale: "y", value: { kind: "none" as const, reason: "empty_bucket" as const } },
      {
        key: "out",
        scale: "y",
        value: { kind: "none" as const, reason: "outside_range" as const },
      },
      { key: "loading", scale: "y", value: undefined },
      { key: "noscale", scale: undefined, value: num(40) },
      { key: "above", scale: "y", value: num(-2) },
      { key: "a", scale: "y", value: num(40) },
      { key: "b", scale: "y2", value: num(40) },
    ];
    const candidates = liveCandidates(signals, toY, 100);
    expect(candidates).toEqual([
      { key: "a", y: 40 },
      { key: "b", y: 40 },
    ]);
    // Equal distance at pointer y 40: the later one in legend order.
    expect(nearestSignal(candidates, 40)).toBe("b");
  });
});

describe("republish on mouse up", () => {
  it("republishes L on mouse up without movement", () => {
    const up = { x: 100, y: 50 };
    // No press on the plot (e.g. the press started elsewhere): never republish.
    expect(shouldRepublishLive(undefined, up, 4)).toBe(false);
    // No movement and a move of 3 px (below 4): a click, republish.
    expect(shouldRepublishLive({ x: 100, y: 50 }, up, 4)).toBe(true);
    expect(shouldRepublishLive({ x: 97, y: 50 }, up, 4)).toBe(true);
    // Exactly the threshold (4 px; 3-4-5 diagonal = 5 px) and beyond: a drag, stay cleared.
    expect(shouldRepublishLive({ x: 96, y: 50 }, up, 4)).toBe(false);
    expect(shouldRepublishLive({ x: 100, y: 20 }, up, 4)).toBe(false);
    expect(shouldRepublishLive({ x: 97, y: 46 }, up, 5)).toBe(false);
    expect(shouldRepublishLive({ x: 97, y: 47 }, up, 5)).toBe(true); // 4.24 px < 5
  });
});
