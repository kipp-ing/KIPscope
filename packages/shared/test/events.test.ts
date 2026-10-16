import { describe, expect, it } from "vitest";
import {
  deriveEvents,
  dtcCategory,
  dtcStatusText,
  type EventRow,
  mergeEvents,
  type StateRow,
  signalEvents,
} from "../src/events.ts";
import type { SignalInfo } from "../src/signals.ts";
import { at } from "./testEvents.ts";

describe("dtcCategory", () => {
  it("maps DTC status bytes to categories", () => {
    // Bit order of the design: 0x01 active; 0x06 pending; 0xA8 stored; 0x50 untested; else passed.
    const cases: [number, string][] = [
      [0x29, "active"],
      [0x69, "active"],
      [0x09, "active"],
      [0x24, "pending"],
      [0x02, "pending"],
      [0x28, "stored"],
      [0x20, "stored"],
      [0x80, "stored"],
      [0x50, "untested"],
      [0x40, "untested"],
      [0x10, "untested"],
      [0x00, "passed"],
      [3.5, "other"],
      [256, "other"],
      [-1, "other"],
    ];
    for (const [value, category] of cases)
      expect([value, dtcCategory(value)]).toEqual([value, category]);
  });
});

describe("dtcStatusText", () => {
  it("decodes the status byte for people", () => {
    expect(dtcStatusText(41)).toBe("0x29 failing now · confirmed · failed since clear");
    expect(dtcStatusText(80)).toBe("0x50 not tested since clear · not tested this cycle");
    expect(dtcStatusText(0)).toBe("0x00");
    // Every bit once, in bit order.
    expect(dtcStatusText(0xff)).toBe(
      "0xFF failing now · failed this cycle · pending · confirmed · not tested since clear · failed since clear · not tested this cycle · warning lamp",
    );
    expect(dtcStatusText(0x80)).toBe("0x80 warning lamp");
    expect(dtcStatusText(256)).toBeUndefined();
    expect(dtcStatusText(-1)).toBeUndefined();
    expect(dtcStatusText(3.5)).toBeUndefined();
  });
});

describe("deriveEvents", () => {
  const row = (t: string, name: string, text: string, detail: string): EventRow => ({
    t,
    source: "VCU",
    kind: "state",
    name,
    value: 0,
    text,
    detail,
  });

  it("derives changes and snapshots per state name", () => {
    const rows = [
      row(at(1, 0, 0), "VCU.door", "closed", "initial"),
      row(at(1, 1, 30), "VCU.door", "closed", "initial"),
      row(at(1, 3, 0), "VCU.door", "open", "from closed"),
      row(at(1, 4, 30), "VCU.door", "open", "initial"),
      row(at(2, 0, 0), "DIAG.lock", "locked", "initial"),
      row(at(2, 0, 0), "VCU.door", "closed", "initial"),
    ];
    const events = deriveEvents(rows);
    expect(events.map((e) => [e.name, e.category, e.text])).toEqual([
      ["VCU.door", "snapshot", "closed"],
      ["VCU.door", "snapshot", "closed"],
      ["VCU.door", "change", "open"],
      ["VCU.door", "snapshot", "open"],
      ["DIAG.lock", "snapshot", "locked"],
      ["VCU.door", "change", "closed"],
    ]);
    // change from closed, last seen 01:01:30, not inferred
    expect(events[2]?.from).toEqual({ text: "closed", t: at(1, 1, 30) });
    expect(events[2]?.inferred).toBeUndefined();
    // change from open, last seen 01:04:30, inferred: seen after a gap
    expect(events[5]?.from).toEqual({ text: "open", t: at(1, 4, 30) });
    expect(events[5]?.inferred).toBe(true);
    // Snapshots carry neither.
    expect(events[0]?.from).toBeUndefined();
    expect(events[4]?.from).toBeUndefined();
    expect(events[4]?.kind).toBe("state");
    expect(events[4]?.source).toBe("VCU");
    expect(events[4]?.detail).toBe("initial");
  });

  it("derives the other kinds from the row", () => {
    const events = deriveEvents([
      {
        t: at(3, 0, 0),
        source: "BMS",
        kind: "nrc",
        name: "SID 22",
        value: 49,
        text: "requestOutOfRange",
        detail: "",
      },
      {
        t: at(3, 0, 1),
        source: "BMS",
        kind: "isotp",
        name: "incomplete",
        value: 132,
        text: "",
        detail: "x",
      },
      {
        t: at(4, 0, 0),
        source: "VCU",
        kind: "note",
        name: "boot",
        value: 0,
        text: "logger restarted",
        detail: "",
      },
      {
        t: at(5, 0, 0),
        source: "BMS",
        kind: "dtc",
        name: "P0CA700",
        value: 41,
        text: "Discharge current too high",
        detail: "initial",
      },
    ]);
    expect(events.map((e) => e.category)).toEqual(["refused", "transport", "other", "active"]);
    expect(events[3]?.status).toBe("0x29 failing now · confirmed · failed since clear");
    expect(events[0]?.status).toBeUndefined();
    expect(events[3]?.t).toBe(at(5, 0, 0));
  });
});

describe("signalEvents", () => {
  const s = (n: number) => String(BigInt(n) * 1_000_000_000n);
  const label = (raw: number, text: string) => ({ raw, label: text, value: raw });

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
      values: [label(0, "NONE"), label(3, "KEYON"), label(15, "SNA")],
    },
  };
  const temp: SignalInfo = {
    id: "testcar/Tmp_A21h.TEMP",
    dataRef: "testcar",
    name: "Tmp_A21h.TEMP",
    states: "labels",
    dbc: {
      message: "Tmp_A21h",
      messageId: 2593,
      factor: 1,
      offset: 0,
      values: [label(254, "SENSOR_DEF"), label(255, "SNA")],
    },
    sna: [{ raw: 255, value: 255, sources: ["VAL_"] }],
  };

  it("derives state changes of a signal", () => {
    // Rows 0: 0, 1: 0, 2: SNA, 3: 3, 4: 3, 400: 3, 1000: 0; the source returns the first row and the
    // changed ones (SNA left out, so the row at 3 follows the one at 1).
    const rows: StateRow[] = [
      { t: s(0), value: 0, text: "" },
      { t: s(3), value: 3, text: "", prev: { t: s(1), value: 0, text: "" } },
      { t: s(1000), value: 0, text: "", prev: { t: s(400), value: 3, text: "" } },
    ];
    const events = signalEvents(mode, rows);
    expect(events.map((e) => [e.t, e.category, e.text])).toEqual([
      [s(0), "snapshot", "NONE"],
      [s(3), "change", "KEYON"],
      [s(1000), "change", "NONE"],
    ]);
    expect(events[1]?.from).toEqual({ text: "NONE", t: s(1) });
    expect(events[1]?.inferred).toBeUndefined();
    expect(events[2]?.from).toEqual({ text: "KEYON", t: s(400) });
    expect(events[2]?.inferred).toBe(true);
    for (const e of events) {
      expect(e.kind).toBe("signal");
      expect(e.name).toBe("Ign_A20h.MODE");
      expect(e.source).toBe("Ign_A20h.MODE");
      expect(e.signalId).toBe("testcar/Ign_A20h.MODE");
    }
    expect(events.map((e) => e.value)).toEqual([0, 3, 0]);

    // Rows 0: 20, 1: 21, 2: 254, 3: 25 with only 254 named: a name changes the state, the numbers
    // are their own text.
    const numbers = signalEvents(temp, [
      { t: s(0), value: 20, text: "" },
      { t: s(2), value: 254, text: "", prev: { t: s(1), value: 21, text: "" } },
      { t: s(3), value: 25, text: "", prev: { t: s(2), value: 254, text: "" } },
    ]);
    expect(numbers.map((e) => [e.t, e.category, e.text])).toEqual([
      [s(0), "snapshot", "20"],
      [s(2), "change", "SENSOR_DEF"],
      [s(3), "change", "25"],
    ]);
    expect(numbers[1]?.from).toEqual({ text: "21", t: s(1) });
    expect(numbers[2]?.from).toEqual({ text: "SENSOR_DEF", t: s(2) });
    expect(numbers.some((e) => e.inferred)).toBe(false);
  });

  it("takes the state name of a text signal from the row", () => {
    const door: SignalInfo = {
      id: "testcar/DIAG.door",
      dataRef: "testcar",
      name: "DIAG.door",
      states: "text",
    };
    const events = signalEvents(door, [
      { t: at(1, 0, 0), value: 0, text: "closed" },
      {
        t: at(1, 3, 0),
        value: 0,
        text: "open",
        prev: { t: at(1, 1, 30), value: 0, text: "closed" },
      },
      {
        t: at(2, 0, 0),
        value: 0,
        text: "closed",
        prev: { t: at(1, 4, 30), value: 0, text: "open" },
      },
    ]);
    expect(events.map((e) => [e.category, e.text, e.inferred === true])).toEqual([
      ["snapshot", "closed", false],
      ["change", "open", false],
      ["change", "closed", true],
    ]);
    expect(events[1]?.from).toEqual({ text: "closed", t: at(1, 1, 30) });
  });
});

describe("mergeEvents", () => {
  it("merges lists in time order and breaks ties by kind, source and name", () => {
    const e = (t: string, kind: string, source: string, name: string) => ({
      t,
      category: "other" as const,
      kind,
      source,
      name,
      text: "",
      detail: "",
      value: 0,
    });
    const merged = mergeEvents(
      [e(at(1, 0, 0), "state", "VCU", "b"), e(at(3, 0, 0), "dtc", "BMS", "a")],
      [
        e(at(1, 0, 0), "state", "VCU", "a"),
        e(at(1, 0, 0), "dtc", "VCU", "z"),
        e(at(2, 0, 0), "signal", "X", "x"),
      ],
    );
    expect(
      merged.map(
        (m) => `${m.t === at(1, 0, 0) ? "1" : m.t === at(2, 0, 0) ? "2" : "3"} ${m.kind} ${m.name}`,
      ),
    ).toEqual(["1 dtc z", "1 state a", "1 state b", "2 signal x", "3 dtc a"]);
  });
});
