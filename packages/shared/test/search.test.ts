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
      sig("c", "COMBI_412h.V_ANZ", { unit: "km/h" }),
      sig("c", "Fast_100h.SIG_B", { description: "Öltemperatur Getriebe" }),
      sig("c", "Many_700h.S0001", { unit: "kPa", description: "Reifendruck vorn links" }),
    ];
    expect(names(catalog, "anz")).toEqual(["COMBI_412h.V_ANZ"]);
    expect(names(catalog, "ANZ")).toEqual(["COMBI_412h.V_ANZ"]);
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
      sig("c", "A_100h.DIFF_V_ANZ"),
      sig("c", "B_200h.SPEED", { description: "copy of V_ANZ" }),
      sig("c", "C_300h.V_ANZ_RAW"),
      sig("c", "COMBI_412h.V_ANZ"),
    ];
    const result = search(catalog, "v_anz");
    expect(result.map((m) => m.signal.name)).toEqual([
      "COMBI_412h.V_ANZ",
      "C_300h.V_ANZ_RAW",
      "A_100h.DIFF_V_ANZ",
      "B_200h.SPEED",
    ]);
    expect(result.map((m) => m.tier)).toEqual([0, 1, 2, 3]);
  });

  it("treats the part after the first dot as the signal name", () => {
    const catalog = [sig("c", "COMBI_412h.V_ANZ")];
    expect(search(catalog, "combi_412h.v_anz")[0]?.tier).toBe(0);
    expect(search(catalog, "v_anz")[0]?.tier).toBe(0);
    expect(search(catalog, "combi")[0]?.tier).toBe(1);
    expect(search(catalog, "v_a")[0]?.tier).toBe(1);
    expect(search(catalog, "anz")[0]?.tier).toBe(2);
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
    const ptc = sig("smart451", "CPC_448h.PTC_HV_Volt", { unit: "V" });
    expect(search([ptc], "volt")[0]?.name).toEqual([[16, 20]]);
    // v_a covers [11,14), anz covers [13,16): overlapping ranges merge.
    const anz = sig("smart451", "COMBI_412h.V_ANZ");
    expect(search([anz], "v_a anz")[0]?.name).toEqual([[11, 16]]);
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
});
