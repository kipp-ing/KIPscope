import { describe, expect, it } from "vitest";
import type { SignalInfo } from "../src/signals.ts";
import { shortLabel, stateLabel, valueLabels } from "../src/states.ts";

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
      { raw: 1, label: "CHARGE", value: 1 },
      { raw: 3, label: "KEYON: Ignition on", value: 3 },
      { raw: 15, label: "SNA", value: 15 },
    ],
  },
};

/** Factor 0.1: label 25 is the physical value 2.5, half a step is 0.05. */
const hot: SignalInfo = {
  id: "testcar/Tmp.HOT",
  dataRef: "testcar",
  name: "Tmp.HOT",
  states: "labels",
  dbc: {
    message: "Tmp",
    messageId: 1,
    factor: 0.1,
    offset: 0,
    values: [{ raw: 25, label: "HOT", value: 2.5 }],
  },
};

describe("stateLabel", () => {
  it("finds the state name of a value", () => {
    expect(stateLabel(mode, 3)).toBe("KEYON: Ignition on");
    expect(stateLabel(mode, 3.4)).toBe("KEYON: Ignition on");
    expect(stateLabel(mode, 0)).toBe("NONE");
    expect(stateLabel(mode, 2)).toBeUndefined();
    // An SNA code has no name (D-010).
    expect(stateLabel(mode, 15)).toBeUndefined();
    expect(stateLabel(hot, 2.54)).toBe("HOT");
    expect(stateLabel(hot, 2.56)).toBeUndefined();
    // No DBC, no names.
    expect(stateLabel({ id: "a/b", dataRef: "a", name: "b" }, 0)).toBeUndefined();
  });

  it("lists the non-SNA labels with their physical values", () => {
    expect(valueLabels(mode)).toEqual([
      { value: 0, label: "NONE" },
      { value: 1, label: "CHARGE" },
      { value: 3, label: "KEYON: Ignition on" },
    ]);
    expect(valueLabels(hot)).toEqual([{ value: 2.5, label: "HOT" }]);
    expect(valueLabels({ id: "a/b", dataRef: "a", name: "b" })).toEqual([]);
  });
});

describe("shortLabel", () => {
  it("shortens CODE: labels", () => {
    expect(shortLabel("KEYON: Ignition on")).toBe("KEYON");
    expect(shortLabel("CLS: Close")).toBe("CLS");
    expect(shortLabel("NO_TEMP_SENSOR")).toBe("NO_TEMP_SENSOR");
    expect(shortLabel("Contactor open")).toBe("Contactor open");
    // The code is upper case, digits and underscores only.
    expect(shortLabel("Open: door")).toBe("Open: door");
    expect(shortLabel("K2_1: two")).toBe("K2_1");
  });
});
