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
