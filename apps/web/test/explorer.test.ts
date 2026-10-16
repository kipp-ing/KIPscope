import type { SignalInfo, TimeseriesWindow } from "@kipscope/shared";
import { describe, expect, it } from "vitest";
import {
  CHUNK,
  formatDbcRange,
  formatMessageId,
  formatRawStep,
  formatScaling,
  formatSnaPhysical,
  formatSource,
  HIDE_GRACE_MS,
  HOVER_DELAY_MS,
  NEW_WINDOW,
  nextShown,
  resolveTarget,
  visibleCount,
  windowsShowing,
} from "../src/explorer/format.ts";

function win(id: string, signalIds: string[], title?: string): TimeseriesWindow {
  return {
    id,
    kind: "timeseries",
    ...(title ? { title } : {}),
    range: { from: "0", to: "10" },
    display: { mode: "line", envelope: false },
    signals: signalIds.map((signalId, i) => ({ id: `a${id}${i}`, signalId })),
  };
}

describe("explorer formatting", () => {
  it("pins the timing and chunk constants", () => {
    expect(HOVER_DELAY_MS).toBe(350);
    expect(HIDE_GRACE_MS).toBe(150);
    expect(CHUNK).toBe(500);
    expect(NEW_WINDOW).toBe("new");
  });

  it("formats scaling, raw step and DBC range", () => {
    expect(formatScaling(1, 0)).toBe("× 1 + 0");
    expect(formatScaling(0.5, 0)).toBe("× 0.5 + 0");
    expect(formatScaling(1, -40)).toBe("× 1 - 40");
    expect(formatRawStep(1, "km/h")).toBe("1 km/h");
    expect(formatRawStep(0.5, "1/min")).toBe("0.5 1/min");
    expect(formatRawStep(-2, undefined)).toBe("2");
    expect(formatDbcRange(0, 510, "km/h", 3)).toBe("0 … 510 km/h");
    expect(formatDbcRange(-40, 214, "°C", 3)).toBe("-40.0 … 214 °C");
    expect(formatDbcRange(-40, 214, "°C", 4)).toBe("-40.00 … 214.0 °C");
    expect(formatDbcRange(0, 0, "km/h", 3)).toBe("not set");
    // SNA physical values: DVL raw 3FFFh = 8191.5 1/min (rounded before scaling, N7).
    expect(formatSnaPhysical(8191.5, "1/min", 3)).toBe("8.19 k1/min");
    expect(formatSnaPhysical(8191.5, "1/min", 4)).toBe("8.192 k1/min");
    expect(formatSnaPhysical(511, "km/h", 3)).toBe("511 km/h");
  });

  it("formats message IDs as hex", () => {
    expect(formatMessageId(1042)).toBe("0x412");
    expect(formatMessageId(1544)).toBe("0x608");
    expect(formatMessageId(0x98ff1234)).toBe("0x18FF1234 (ext)");
  });

  it("formats the source line", () => {
    const base: SignalInfo = {
      id: "smart451/COMBI_412h.V_ANZ",
      dataRef: "smart451",
      name: "COMBI_412h.V_ANZ",
    };
    const dbc = { message: "COMBI_412h", messageId: 1042 };
    expect(formatSource({ ...base, dbc: { ...dbc, file: "h-can.dbc" } })).toBe(
      "smart451 · h-can.dbc",
    );
    expect(formatSource({ ...base, dbc })).toBe("smart451 · DBC");
    expect(formatSource(base)).toBe("smart451 · no DBC entry");
  });

  it("lists the windows showing a signal", () => {
    const windows = [
      win("w1", ["c/V_ANZ", "c/DVL"], "Speeds"),
      win("w2", ["c/PTC"]),
      win("w3", ["c/V_ANZ"]),
    ];
    expect(windowsShowing(windows, "c/V_ANZ")).toEqual(["Speeds", "Window 3"]);
    expect(windowsShowing(windows, "c/T_MOT")).toEqual([]);
  });

  it("returns Window <n> for an untitled window", () => {
    expect(windowsShowing([win("w6", ["c/X"])], "c/X")).toEqual(["Window 6"]);
  });

  it("renders matches in chunks until all are visible", () => {
    expect(visibleCount(1013, CHUNK)).toBe(500);
    let shown = nextShown(1013, CHUNK);
    expect(shown).toBe(1000);
    expect(visibleCount(1013, shown)).toBe(1000);
    shown = nextShown(1013, shown);
    expect(shown).toBe(1013);
    expect(visibleCount(1013, shown)).toBe(1013);
    expect(nextShown(1013, shown)).toBe(1013);
    // The real catalog fits in one chunk.
    expect(visibleCount(428, CHUNK)).toBe(428);
  });

  it("keeps the Add to target by window ID while windows change", () => {
    const w1 = win("w1", []);
    const w2 = win("w2", []);
    expect(resolveTarget("w2", [w1, w2])).toBe("w2");
    // Created, renamed, reordered: still w2.
    expect(resolveTarget("w2", [w1, w2, win("w3", [])])).toBe("w2");
    expect(resolveTarget("w2", [{ ...w1, title: "Renamed" }, w2])).toBe("w2");
    expect(resolveTarget("w2", [w2, w1])).toBe("w2");
    // Removed: falls back to a new window.
    expect(resolveTarget("w2", [w1])).toBe(NEW_WINDOW);
    expect(resolveTarget("w2", [])).toBe(NEW_WINDOW);
    // New window stays, even when windows exist.
    expect(resolveTarget(NEW_WINDOW, [w1, w2])).toBe(NEW_WINDOW);
  });
});
