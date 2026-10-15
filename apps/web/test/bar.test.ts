import {
  EMPTY_WORKSPACE,
  fromIso,
  type TimeseriesWindow,
  type ValuesWindow,
  type Workspace,
} from "@letsview/shared";
import { describe, expect, it } from "vitest";
import { barTarget, defaultCursorTime, resetSignals } from "../src/bar/bar.ts";

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

describe("barTarget", () => {
  it("targets the window zoomed last, else the first timeseries window", () => {
    const w = [values("w1", ["c/DVL"]), ts("w2", ["c/V_ANZ"]), ts("w3", ["c/PTC"])];
    // The window zoomed last wins.
    expect(barTarget(ws(w, { lastZoomed: "w3" }))?.id).toBe("w3");
    // No lastZoomed: the first timeseries window, skipping the values window before it.
    expect(barTarget(ws(w))?.id).toBe("w2");
    // lastZoomed names a window that no longer exists.
    expect(barTarget(ws(w, { lastZoomed: "w9" }))?.id).toBe("w2");
    // lastZoomed names a values window (not possible in the workspace, but must not be a target).
    expect(barTarget(ws(w, { lastZoomed: "w1" }))?.id).toBe("w2");
    // Without a timeseries window there is no target.
    expect(barTarget(ws([values("w1", [])]))).toBeUndefined();
    expect(barTarget(EMPTY_WORKSPACE)).toBeUndefined();
  });
});

describe("resetSignals", () => {
  it("resets to the union of all timeseries extents while linked", () => {
    const w = [ts("w1", ["c/V_ANZ"]), values("w2", ["c/DVL"]), ts("w3", ["c/PTC"])];
    // Linked: the signals of all timeseries windows, never those of a values window.
    const linked = resetSignals(ws(w, { linkTime: true, lastZoomed: "w1" }));
    expect([...linked].sort()).toEqual(["c/PTC", "c/V_ANZ"]);
    // Unlinked: the target's signals only.
    expect(resetSignals(ws(w, { linkTime: false, lastZoomed: "w3" }))).toEqual(["c/PTC"]);
    expect(resetSignals(ws(w, { linkTime: false }))).toEqual(["c/V_ANZ"]);
    // Nothing to reset.
    expect(resetSignals(ws([values("w1", ["c/DVL"])]))).toEqual([]);
  });
});

describe("defaultCursorTime", () => {
  it("places new cursors at a third and two thirds of the reference range", () => {
    const range = {
      from: fromIso("2026-10-13T13:08:00Z"),
      to: fromIso("2026-10-13T13:08:03Z"),
    };
    expect(defaultCursorTime(range, "a")).toBe(fromIso("2026-10-13T13:08:01Z"));
    expect(defaultCursorTime(range, "b")).toBe(fromIso("2026-10-13T13:08:02Z"));
    // Snapped to the grid of the span (span / 1000 = 3 ms → 1 ms): 1/3 of 3.000000100 s.
    const odd = { from: 0n, to: 3_000_000_100n };
    expect(defaultCursorTime(odd, "a")).toBe(1_000_000_000n);
    expect(defaultCursorTime(odd, "b")).toBe(2_000_000_000n);
  });
});
