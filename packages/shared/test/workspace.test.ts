import { describe, expect, it } from "vitest";
import {
  Command,
  RenderedMessage,
  type TimeseriesWindow,
  type ValuesWindow,
  windowTitle,
} from "../src/workspace.ts";

const untitled = (id: string): TimeseriesWindow => ({
  id,
  kind: "timeseries",
  range: { from: "0", to: "1" },
  display: { mode: "line", envelope: false },
  signals: [],
});

describe("Command schema", () => {
  it("accepts valid commands and normalizes times to decimal nanoseconds", () => {
    const cmd = Command.parse({
      type: "window.create",
      from: "2026-10-13T09:00:00Z",
      to: "1791889200000000000",
    });
    expect(cmd).toEqual({
      type: "window.create",
      from: "1791882000000000000",
      to: "1791889200000000000",
    });
    expect(Command.parse({ type: "window.setDisplay", windowId: "w1", mode: "step" })).toEqual({
      type: "window.setDisplay",
      windowId: "w1",
      mode: "step",
    });
  });

  it("rejects malformed commands", () => {
    const bad = [
      {},
      { type: "window.explode" },
      { type: "window.remove" },
      { type: "window.remove", windowId: "" },
      { type: "window.addSignal", windowId: "w1" },
      { type: "window.setRange", windowId: "w1", from: "yesterday", to: "0" },
      { type: "window.setDisplay", windowId: "w1", mode: "bars" },
      { type: "window.setDisplay", windowId: "w1", envelope: "yes" },
    ];
    for (const input of bad) expect(Command.safeParse(input).success).toBe(false);
  });

  it("rejects times outside 1900 … 2262", () => {
    const bounds = {
      min: "-2208988800000000000", // 1900-01-01T00:00:00Z
      max: "9223286400000000000", // 2262-04-11T00:00:00Z
    };
    const setRange = (from: string, to: string) =>
      Command.safeParse({ type: "window.setRange", windowId: "w1", from, to });
    // The live bug: both values beyond int64 nanoseconds.
    const live = setRange("-29473328485867940608", "62083631947910636800");
    expect(live.success).toBe(false);
    expect(live.error?.issues.map((i) => i.message).join(" ")).toContain("1900-01-01T00:00:00Z");
    expect(live.error?.issues.map((i) => i.message).join(" ")).toContain("2262-04-11T00:00:00Z");
    // One nanosecond outside on each side.
    expect(setRange("-2208988800000000001", "0").success).toBe(false);
    expect(setRange("0", "9223286400000000001").success).toBe(false);
    expect(setRange("1899-12-31T23:59:59Z", "0").success).toBe(false);
    // The bounds themselves are inclusive.
    expect(setRange(bounds.min, bounds.max).success).toBe(true);
    expect(setRange("1900-01-01T00:00:00Z", "2262-04-11T00:00:00Z").success).toBe(true);
    expect(
      Command.safeParse({ type: "window.create", from: "-29473328485867940608", to: "0" }).success,
    ).toBe(false);
  });

  it("titles untitled windows by ID", () => {
    expect(windowTitle(untitled("w6"))).toBe("Window 6");
    expect(windowTitle(untitled("w12"))).toBe("Window 12");
    expect(windowTitle({ ...untitled("w6"), title: "HV voltages" })).toBe("HV voltages");
    const values: ValuesWindow = { id: "w7", kind: "values", mode: "line", signals: [] };
    expect(windowTitle(values)).toBe("Values 7");
    expect(windowTitle({ ...values, title: "Drive" })).toBe("Drive");
  });

  it("validates render acknowledgements", () => {
    expect(
      RenderedMessage.safeParse({ type: "rendered", revision: 3, status: "complete" }).success,
    ).toBe(true);
    expect(
      RenderedMessage.safeParse({ type: "rendered", revision: -1, status: "complete" }).success,
    ).toBe(false);
    expect(
      RenderedMessage.safeParse({ type: "rendered", revision: 1, status: "done" }).success,
    ).toBe(false);
  });
});
