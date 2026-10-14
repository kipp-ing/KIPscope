import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../src/config.ts";
import { loadDbcFiles, parseDbc } from "../src/dbc.ts";

const fixture = (name: string) => resolve(import.meta.dirname, "fixtures", name);
const REAL_HCAN = resolve(REPO_ROOT, "../CarController/vehicles/smart451/dbc/h-can.dbc");

describe("parseDbc / loadDbcFiles", () => {
  it("reads units and comments keyed by message.signal, decoding ISO-8859-1", async () => {
    const meta = await loadDbcFiles([fixture("test-a.dbc")]);
    expect(meta.get("Fast_100h.SIG_A")).toEqual({
      unit: "rpm",
      description: "Motordrehzahl hinten",
    });
    expect(meta.get("Fast_100h.SIG_B")).toEqual({
      unit: "°C",
      description: "Öltemperatur Getriebe",
    });
    expect(meta.get("Fast_100h.SIG_D")).toEqual({ unit: "bar" });
  });

  it("leaves an empty unit absent", async () => {
    const meta = await loadDbcFiles([fixture("test-a.dbc")]);
    expect(meta.get("Fast_100h.SIG_C")).toEqual({});
  });

  it("handles multi-line comments, escaped quotes and multiplexed signals", async () => {
    const meta = await loadDbcFiles([fixture("test-a.dbc")]);
    expect(meta.get("Irr_200h.JITTER")?.description).toBe("Torque with a comment over two lines");
    expect(meta.get("Sparse_300h.SLOW")).toEqual({
      unit: "min",
      description: 'Minute counter; contains "quotes"',
    });
    expect(meta.get("Sparse_300h.MODE")?.values).toEqual(
      new Map([
        [0, "off"],
        [1, "on"],
      ]),
    );
  });

  it("ignores message comments", () => {
    const meta = parseDbc('BO_ 1 M: 8 X\n SG_ S : 0|8@1+ (1,0) [0|0] ""  X\n\nCM_ BO_ 1 "msg";\n');
    expect(meta.get("M.S")).toEqual({});
  });

  it("lets the first file win for keys defined twice", async () => {
    const meta = await loadDbcFiles([fixture("test-a.dbc"), fixture("test-b.dbc")]);
    expect(meta.get("Fast_100h.SIG_A")?.unit).toBe("rpm");
    expect(meta.get("Many_700h.S0001")).toEqual({
      unit: "kPa",
      description: "Reifendruck vorn links",
    });
  });

  it("skips unreadable files and reports them", async () => {
    const errors: string[] = [];
    const meta = await loadDbcFiles(["/nonexistent.dbc", fixture("test-b.dbc")], (p) =>
      errors.push(p),
    );
    expect(errors).toEqual(["/nonexistent.dbc"]);
    expect(meta.has("Many_700h.S0001")).toBe(true);
  });

  it.runIf(existsSync(REAL_HCAN))("parses the real h-can.dbc and finds MS_312h", async () => {
    const meta = await loadDbcFiles([REAL_HCAN]);
    expect(meta.size).toBeGreaterThan(500);
    expect([...meta.keys()].some((k) => k.startsWith("MS_312h."))).toBe(true);
    expect(meta.has("MS_312h.DNMOT")).toBe(true);
  });
});

describe("SNA derivation (design S1)", () => {
  const snaOf = async (key: string) => {
    const meta = await loadDbcFiles([fixture("test-a.dbc")]);
    return meta.get(key)?.sna;
  };
  const raws = (sna: { values: { raw: number }[] } | undefined) => sna?.values.map((v) => v.raw);

  it("unites GenSigSNA and VAL_ SNA/SNV labels", async () => {
    // MODE: "7h" names 7, the label `6 "SNV"` names 6; `1 "ON"` is no SNA.
    const mode = await snaOf("Sna_800h.MODE");
    expect(mode?.values).toEqual([
      { raw: 6, value: 6, sources: ["VAL_"] },
      { raw: 7, value: 7, sources: ["GenSigSNA"] },
    ]);
    // SPEED: attribute and label agree, the code is reported once with both sources.
    const speed = await snaOf("Sna_800h.SPEED");
    expect(speed?.values).toEqual([{ raw: 511, value: 511, sources: ["GenSigSNA", "VAL_"] }]);
    expect(speed?.tolerance).toBe(0.5);
    // RPM: 14 bit, factor 0.5: raw 16383 is 8191.5, tolerance a quarter of 1 (half a raw step).
    const rpm = await snaOf("Sna_800h.RPM");
    expect(rpm?.values).toEqual([{ raw: 16383, value: 8191.5, sources: ["GenSigSNA"] }]);
    expect(rpm?.tolerance).toBe(0.25);
  });

  it("lets a valid VAL_ label beat GenSigSNA", async () => {
    // LEVEL: GenSigSNA "1h" but `1 "OK"`; only `7 "SNV"` stays SNA.
    expect((await snaOf("Sna_800h.LEVEL"))?.values).toEqual([
      { raw: 7, value: 7, sources: ["VAL_"] },
    ]);
    // A valid label on the only attribute code leaves no SNA at all.
    const meta = parseDbc(
      'BO_ 1 M: 8 X\n SG_ S : 0|8@1+ (1,0) [0|0] ""  X\n\nBA_ "GenSigSNA" SG_ 1 S "FFh";\nVAL_ 1 S 255 "OK" ;\n',
    );
    expect(meta.get("M.S")?.sna).toBeUndefined();
  });

  it("keeps GenSigSNA when the VAL_ label means no value", () => {
    for (const label of ["--", "NO_TEMP_SENSOR", "RES"]) {
      const meta = parseDbc(
        `BO_ 1 M: 8 X\n SG_ S : 0|8@1+ (1,0) [0|0] ""  X\n\nBA_ "GenSigSNA" SG_ 1 S "FFh";\nVAL_ 1 S 255 "${label}" 254 "NO_DISPLAY" ;\n`,
      );
      expect(meta.get("M.S")?.sna?.values, label).toEqual([
        { raw: 255, value: 255, sources: ["GenSigSNA"] },
      ]);
    }
  });

  it("ignores GenSigSNA on 1-bit and checksum signals", async () => {
    expect((await snaOf("Sna_800h.FLAG")) === undefined).toBe(true);
    expect((await snaOf("Sna_800h.CRC_800h")) === undefined).toBe(true);
    // The name pattern also covers *_CHKSUM; VAL_ SNA labels still apply to such signals.
    const meta = parseDbc(
      [
        "BO_ 1 M: 8 X",
        ' SG_ LWS_CHKSUM : 0|8@1+ (1,0) [0|0] ""  X',
        ' SG_ CRC_X : 8|8@1+ (1,0) [0|0] ""  X',
        ' SG_ SSA_Enbl_Rq_CRCM : 16|8@1+ (1,0) [0|0] ""  X',
        "",
        'BA_ "GenSigSNA" SG_ 1 LWS_CHKSUM "FFh";',
        'BA_ "GenSigSNA" SG_ 1 CRC_X "FFh";',
        'BA_ "GenSigSNA" SG_ 1 SSA_Enbl_Rq_CRCM "FFh";',
        'VAL_ 1 CRC_X 254 "SNA" ;',
        "",
      ].join("\n"),
    );
    expect(meta.get("M.LWS_CHKSUM")?.sna).toBeUndefined();
    expect(meta.get("M.CRC_X")?.sna?.values.map((v) => v.raw)).toEqual([254]);
    expect(meta.get("M.SSA_Enbl_Rq_CRCM")?.sna?.values.map((v) => v.raw)).toEqual([255]);
  });

  it("treats GenSigSNA 0h as no SNA", async () => {
    // COUNTER: "0h", no VAL_: raw 0 is a valid value.
    expect(await snaOf("Sna_800h.COUNTER")).toBeUndefined();
    // STATE: "0h" plus `0 "SNA"`: only the label makes 0 an SNA value.
    const state = await snaOf("Sna_800h.STATE");
    expect(raws(state)).toEqual([0]);
    expect(state?.values[0]?.sources).toEqual(["VAL_"]);
  });

  it("converts signed SNA codes with two's complement", async () => {
    // TEMP: 8 bit signed, "80h" = raw 128 = -128, not 128.
    const temp = await snaOf("Sna_800h.TEMP");
    expect(temp?.values).toEqual([{ raw: 128, value: -128, sources: ["GenSigSNA"] }]);
    // A negative VAL_ value is the same bit pattern: -1 on 8 bit is raw 255.
    const meta = parseDbc(
      'BO_ 1 M: 8 X\n SG_ S : 0|8@1- (1,0) [0|0] ""  X\n\nVAL_ 1 S -1 "SNA" ;\n',
    );
    expect(meta.get("M.S")?.sna?.values).toEqual([{ raw: 255, value: -1, sources: ["VAL_"] }]);
  });

  it.runIf(existsSync(REAL_HCAN))("derives SNA values from the real h-can.dbc", async () => {
    const meta = await loadDbcFiles([REAL_HCAN]);
    const rawsOf = (key: string) => meta.get(key)?.sna?.values.map((v) => v.raw);
    expect(meta.get("COMBI_412h.V_ANZ")?.sna?.values).toEqual([
      { raw: 511, value: 511, sources: ["GenSigSNA", "VAL_"] },
    ]);
    expect(meta.get("BS_200h.DVL")?.sna?.values).toEqual([
      { raw: 16383, value: 8191.5, sources: ["GenSigSNA", "VAL_"] },
    ]);
    expect(meta.get("MS_312h.DNMOT")?.sna?.values.map((v) => [v.raw, v.value])).toEqual([
      [255, 128],
    ]);
    expect(rawsOf("SRS_1E1h.OC_P_Fast_SRS")).toEqual([0]);
    expect(rawsOf("BS_328h.ESP_DSPL")).toEqual([30, 31]);
    expect(rawsOf("YRG_156h.CLU_TYPE")).toEqual([15]);
    // No-value labels do not beat GenSigSNA (D-015).
    for (const key of [
      "TPM_A1.TirePress_FL",
      "TPM_A1.TirePress_FR",
      "TPM_A1.TirePress_RL",
      "TPM_A1.TirePress_RR",
      "TPM_A1.TirePress_Spr",
      "COMBI_408h.T_AUSSEN",
    ]) {
      expect(rawsOf(key), key).toContain(255);
    }
    // Valid label, 1-bit and checksum exemptions (D-014).
    for (const key of [
      "YRG_156h.MSG_CNT_7",
      "BS_208h.SZS",
      "BS_328h.BS",
      "SAS_0C2h.LWS_CHKSUM",
      "BS_119h.CRC_0",
    ]) {
      expect(meta.has(key), `${key} exists`).toBe(true);
      expect(meta.get(key)?.sna, key).toBeUndefined();
    }
    // Number of signals with SNA codes (script count, D-014 + D-015; not derived from parseDbc).
    expect([...meta.values()].filter((e) => e.sna).length).toBe(171);
  });
});
