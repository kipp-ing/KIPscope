import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDbcFiles, parseDbc } from "../src/dbc.ts";

const fixture = (name: string) => resolve(import.meta.dirname, "fixtures", name);

describe("parseDbc / loadDbcFiles", () => {
  it("reads units and comments keyed by message.signal, decoding ISO-8859-1", async () => {
    const meta = await loadDbcFiles([fixture("test-a.dbc")]);
    expect(meta.get("Fast_100h.SIG_A")).toMatchObject({
      unit: "rpm",
      description: "Motordrehzahl hinten",
    });
    expect(meta.get("Fast_100h.SIG_B")).toMatchObject({
      unit: "°C",
      description: "Öltemperatur Getriebe",
    });
    expect(meta.get("Fast_100h.SIG_D")?.unit).toBe("bar");
    expect(meta.get("Fast_100h.SIG_D")).not.toHaveProperty("description");
  });

  it("leaves an empty unit absent", async () => {
    const meta = await loadDbcFiles([fixture("test-a.dbc")]);
    expect(meta.get("Fast_100h.SIG_C")).toBeDefined();
    expect(meta.get("Fast_100h.SIG_C")).not.toHaveProperty("unit");
  });

  it("handles multi-line comments, escaped quotes and multiplexed signals", async () => {
    const meta = await loadDbcFiles([fixture("test-a.dbc")]);
    expect(meta.get("Irr_200h.JITTER")?.description).toBe("Torque with a comment over two lines");
    expect(meta.get("Sparse_300h.SLOW")).toMatchObject({
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
    expect(meta.get("M.S")).toBeDefined();
    expect(meta.get("M.S")).not.toHaveProperty("description");
  });

  it("lets the first file win for keys defined twice", async () => {
    const meta = await loadDbcFiles([fixture("test-a.dbc"), fixture("test-b.dbc")]);
    expect(meta.get("Fast_100h.SIG_A")?.unit).toBe("rpm");
    expect(meta.get("Many_700h.S0001")).toMatchObject({
      unit: "kPa",
      description: "Reifendruck vorn links",
    });
  });

  it("reads message, scaling, range, value table and file", async () => {
    const meta = await loadDbcFiles([fixture("test-a.dbc"), fixture("test-b.dbc")]);
    expect(meta.get("Fast_100h.SIG_C")).toMatchObject({
      message: "Fast_100h",
      messageId: 256,
      factor: 1,
      offset: 0,
      min: -100,
      max: 100,
      file: "test-a.dbc",
      sender: "TEST",
    });
    expect(meta.get("Sparse_300h.MODE")?.values).toEqual(
      new Map([
        [0, "off"],
        [1, "on"],
      ]),
    );
    // [0|0] is passed through as written.
    expect(meta.get("Irr_200h.JITTER")).toMatchObject({ min: 0, max: 0 });
    expect(meta.get("Many_700h.S0001")?.file).toBe("test-b.dbc");
    // Without a file argument, parseDbc sets no file.
    const noFile = parseDbc('BO_ 1 M: 8 X\n SG_ S : 0|8@1+ (2,3) [1|9] ""  X\n').get("M.S");
    expect(noFile).not.toHaveProperty("file");
    expect(noFile).toMatchObject({
      message: "M",
      messageId: 1,
      factor: 2,
      offset: 3,
      min: 1,
      max: 9,
    });
  });

  it("reads the sender of each message, none for Vector__XXX", () => {
    const text = [
      "BO_ 348 IMU_15Ch: 8 YRG",
      ' SG_ A : 0|8@1+ (1,0) [0|0] ""  X',
      "",
      "BO_ 163 GWX_A2: 8 Vector__XXX",
      ' SG_ B : 0|8@1+ (1,0) [0|0] ""  X',
      "",
      "BO_ 7 Bare_7h:",
      ' SG_ C : 0|8@1+ (1,0) [0|0] ""  X',
      "",
    ].join("\r\n");
    const meta = parseDbc(text);
    expect(meta.get("IMU_15Ch.A")?.sender).toBe("YRG");
    expect(meta.get("GWX_A2.B")).toBeDefined();
    expect(meta.get("GWX_A2.B")).not.toHaveProperty("sender");
    expect(meta.get("Bare_7h.C")).toBeDefined();
    expect(meta.get("Bare_7h.C")).not.toHaveProperty("sender");
  });

  it("skips unreadable files and reports them", async () => {
    const errors: string[] = [];
    const meta = await loadDbcFiles(["/nonexistent.dbc", fixture("test-b.dbc")], (p) =>
      errors.push(p),
    );
    expect(errors).toEqual(["/nonexistent.dbc"]);
    expect(meta.has("Many_700h.S0001")).toBe(true);
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
        ' SG_ STEER_CHKSUM : 0|8@1+ (1,0) [0|0] ""  X',
        ' SG_ CRC_X : 8|8@1+ (1,0) [0|0] ""  X',
        ' SG_ STS_Enbl_Rq : 16|8@1+ (1,0) [0|0] ""  X',
        "",
        'BA_ "GenSigSNA" SG_ 1 STEER_CHKSUM "FFh";',
        'BA_ "GenSigSNA" SG_ 1 CRC_X "FFh";',
        'BA_ "GenSigSNA" SG_ 1 STS_Enbl_Rq "FFh";',
        'VAL_ 1 CRC_X 254 "SNA" ;',
        "",
      ].join("\n"),
    );
    expect(meta.get("M.STEER_CHKSUM")?.sna).toBeUndefined();
    expect(meta.get("M.CRC_X")?.sna?.values.map((v) => v.raw)).toEqual([254]);
    expect(meta.get("M.STS_Enbl_Rq")?.sna?.values.map((v) => v.raw)).toEqual([255]);
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
});

describe("GenMsgCycleTime (add-gap-display)", () => {
  it("reads GenMsgCycleTime per message", async () => {
    const meta = await loadDbcFiles([fixture("test-a.dbc")]);
    // BA_ "GenMsgCycleTime" BO_ 2832 20; the default is 0, message 2833 says 0 itself.
    expect(meta.get("Cyc_B10h.CYC")?.cycleMs).toBe(20);
    expect(meta.get("Evt_B11h.EVT")).toBeDefined();
    expect(meta.get("Evt_B11h.EVT")).not.toHaveProperty("cycleMs");
    expect(meta.get("Fast_100h.SIG_A")).not.toHaveProperty("cycleMs");

    // A default of 100: a message without its own value gets it, one with its own value keeps that,
    // 0 means none even against the default. GenMsgCycleTimeActive is another attribute.
    const text = [
      'BO_ 1 A: 8 X\n SG_ S : 0|8@1+ (1,0) [0|0] ""  X\n',
      'BO_ 2 B: 8 X\n SG_ S : 0|8@1+ (1,0) [0|0] ""  X\n SG_ T : 8|8@1+ (1,0) [0|0] ""  X\n',
      'BO_ 3 C: 8 X\n SG_ S : 0|8@1+ (1,0) [0|0] ""  X\n',
      'BO_ 4 D: 8 X\n SG_ S : 0|8@1+ (1,0) [0|0] ""  X\n',
      'BA_DEF_ BO_  "GenMsgCycleTime" INT 0 65535;',
      'BA_DEF_DEF_  "GenMsgCycleTime" 100;',
      'BA_ "GenMsgCycleTime" BO_ 2 250;',
      'BA_ "GenMsgCycleTime" BO_ 3 0;',
      'BA_ "GenMsgCycleTimeActive" BO_ 4 5;',
      "",
    ].join("\n");
    const inline = parseDbc(text);
    expect(inline.get("A.S")?.cycleMs).toBe(100);
    expect(inline.get("B.S")?.cycleMs).toBe(250);
    expect(inline.get("B.T")?.cycleMs).toBe(250);
    expect(inline.get("C.S")).not.toHaveProperty("cycleMs");
    expect(inline.get("D.S")?.cycleMs).toBe(100);
  });
});
