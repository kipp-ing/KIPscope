import { describe, expect, it } from "vitest";
import { buildSearchIndex, searchSignals } from "../src/search.ts";
import type { SignalInfo } from "../src/signals.ts";

function sig(dataRef: string, name: string, extra: Partial<SignalInfo> = {}): SignalInfo {
  return { id: `${dataRef}/${name}`, dataRef, name, ...extra };
}

const search = (signals: SignalInfo[], query: string) =>
  searchSignals(buildSearchIndex(signals), query);
const names = (signals: SignalInfo[], query: string) =>
  search(signals, query).map((m) => m.signal.name);

describe("searchSignals", () => {
  it("matches parts of name, description and unit case-insensitively", () => {
    const catalog = [
      sig("c", "ICL_3A2h.SPEED_DISP", { unit: "km/h" }),
      sig("c", "Fast_100h.SIG_B", { description: "Öltemperatur Getriebe" }),
      sig("c", "Many_700h.S0001", { unit: "kPa", description: "Reifendruck vorn links" }),
    ];
    expect(names(catalog, "disp")).toEqual(["ICL_3A2h.SPEED_DISP"]);
    expect(names(catalog, "DISP")).toEqual(["ICL_3A2h.SPEED_DISP"]);
    expect(names(catalog, "ÖLTEMP")).toEqual(["Fast_100h.SIG_B"]);
    expect(names(catalog, "kpa")).toEqual(["Many_700h.S0001"]);
    expect(names(catalog, "druck vorn")).toEqual(["Many_700h.S0001"]);
    expect(names(catalog, "nothing")).toEqual([]);
  });

  it("requires every term to match", () => {
    const catalog = [
      sig("c", "Engine.MOT_X", { description: "temp of something" }),
      sig("c", "Other.OIL", { description: "temp only" }),
    ];
    expect(names(catalog, "temp mot")).toEqual(["Engine.MOT_X"]);
    expect(names(catalog, "  temp   ")).toEqual(["Engine.MOT_X", "Other.OIL"]);
  });

  it("ranks exact before prefix before name substring before other fields", () => {
    const catalog = [
      sig("c", "A_100h.DIFF_SPEED_DISP"),
      sig("c", "B_200h.SPEED", { description: "copy of SPEED_DISP" }),
      sig("c", "C_300h.SPEED_DISP_RAW"),
      sig("c", "ICL_3A2h.SPEED_DISP"),
    ];
    const result = search(catalog, "speed_disp");
    expect(result.map((m) => m.signal.name)).toEqual([
      "ICL_3A2h.SPEED_DISP",
      "C_300h.SPEED_DISP_RAW",
      "A_100h.DIFF_SPEED_DISP",
      "B_200h.SPEED",
    ]);
    expect(result.map((m) => m.tier)).toEqual([0, 1, 2, 3]);
  });

  it("treats the part after the first dot as the signal name", () => {
    const catalog = [sig("c", "ICL_3A2h.SPEED_DISP")];
    expect(search(catalog, "icl_3a2h.speed_disp")[0]?.tier).toBe(0);
    expect(search(catalog, "speed_disp")[0]?.tier).toBe(0);
    expect(search(catalog, "icl")[0]?.tier).toBe(1);
    expect(search(catalog, "spe")[0]?.tier).toBe(1);
    expect(search(catalog, "disp")[0]?.tier).toBe(2);
  });

  it("keeps catalog order within a tier and for an empty query", () => {
    const catalog = [
      sig("othercar", "Fast_100h.SIG_A"),
      sig("testcar", "Fast_100h.SIG_A"),
      sig("testcar", "Fast_100h.SIG_B"),
      sig("testcar", "Zeta_900h.OTHER"),
    ];
    expect(search(catalog, "sig_a").map((m) => m.signal.id)).toEqual([
      "othercar/Fast_100h.SIG_A",
      "testcar/Fast_100h.SIG_A",
    ]);
    const all = search(catalog, "");
    expect(all.map((m) => m.signal.id)).toEqual(catalog.map((s) => s.id));
    for (const m of all) {
      expect(m.tier).toBe(3);
      expect(m.name).toEqual([]);
      expect(m.unit).toEqual([]);
      expect(m.description).toEqual([]);
    }
    expect(search(catalog, "   ")).toHaveLength(4);
  });

  it("returns merged highlight ranges for name, unit and description", () => {
    const ptc = sig("smart451", "DCU_2B8h.HTR_HV_Volt", { unit: "V" });
    expect(search([ptc], "volt")[0]?.name).toEqual([[16, 20]]);
    // speed_d covers [9,16), d_disp covers [13,19): overlapping ranges merge.
    const disp = sig("smart451", "ICL_3A2h.SPEED_DISP");
    expect(search([disp], "speed_d d_disp")[0]?.name).toEqual([[9, 19]]);
    // Unit and description, every non-overlapping occurrence.
    const speed = sig("c", "X.VELOCITY", { unit: "km/h", description: "Indicated speed" });
    const m = search([speed], "km ed")[0];
    expect(m?.unit).toEqual([[0, 2]]);
    expect(m?.description).toEqual([
      [7, 9],
      [13, 15],
    ]);
    expect(m?.name).toEqual([]);
  });

  it("ranks 10,000 signals in under 50 ms", () => {
    const catalog: SignalInfo[] = [];
    for (let i = 0; i < 10_000; i++) {
      catalog.push(
        sig(
          "car",
          `Msg_${String(i % 100).padStart(3, "0")}h.SIGNAL_${String(i).padStart(5, "0")}`,
          {
            unit: i % 3 === 0 ? "°C" : "km/h",
            description: i % 4 === 0 ? `Sensor temperature number ${i}` : `Some description ${i}`,
          },
        ),
      );
    }
    const index = buildSearchIndex(catalog);
    const times: number[] = [];
    let count = 0;
    for (let run = 0; run < 5; run++) {
      const t0 = performance.now();
      count = searchSignals(index, "temp").length;
      times.push(performance.now() - t0);
    }
    expect(count).toBe(2500);
    times.sort((a, b) => a - b);
    expect(times[2]).toBeLessThan(50);
  });

  it("ranks the shown name like the name", () => {
    const catalog = [
      sig("c", "ICL_3A2h.SPEED_DISP", { displayName: "Speed" }),
      sig("c", "B_200h.SPEED_RAW"),
      sig("c", "C_300h.X", { displayName: "TORQUE (C)" }),
    ];
    const tiers = (q: string) =>
      Object.fromEntries(search(catalog, q).map((m) => [m.signal.name, m.tier]));
    expect(tiers("speed")).toEqual({ "ICL_3A2h.SPEED_DISP": 0, "B_200h.SPEED_RAW": 1 });
    expect(tiers("spe")).toEqual({ "ICL_3A2h.SPEED_DISP": 1, "B_200h.SPEED_RAW": 1 });
    expect(tiers("(c)")).toEqual({ "C_300h.X": 2 });
    // The full name still finds the renamed signal.
    expect(tiers("icl")).toEqual({ "ICL_3A2h.SPEED_DISP": 1 });
    expect(names(catalog, "icl")).toEqual(["ICL_3A2h.SPEED_DISP"]);
  });

  it("returns highlight ranges in the shown name", () => {
    const ptc = sig("smart451", "DCU_2B8h.HTR_HV_Volt", { displayName: "HTR_HV_Volt" });
    const m = search([ptc], "volt")[0];
    expect(m?.shown).toEqual([[7, 11]]);
    expect(m?.name).toEqual([[16, 20]]);
    // Without displayName the shown ranges equal the name ranges.
    const plain = sig("smart451", "DCU_2B8h.HTR_HV_Volt");
    const p = search([plain], "volt")[0];
    expect(p?.shown).toEqual(p?.name);
    // Empty query: no ranges.
    expect(search([ptc], "")[0]?.shown).toEqual([]);
  });
});
