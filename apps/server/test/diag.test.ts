import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDiagCatalogs, parseDiagCatalog } from "../src/diag.ts";
import { fixture } from "./testdb.ts";

const manifestText = readFileSync(fixture("test-diag.manifest.json"), "utf8");
const namesText = readFileSync(fixture("test-diag.names.toml"), "utf8");
const FILE = "test-diag.manifest.json";

const pad = (n: number) => String(n).padStart(2, "0");
const cells = (base: string) => Array.from({ length: 12 }, (_, i) => `${base}.${pad(i + 1)}`);

function parse(names: string | undefined) {
  const warnings: string[] = [];
  const map = parseDiagCatalog(manifestText, names, FILE, (m) => warnings.push(m), "names.toml");
  return { map, warnings };
}

describe("parseDiagCatalog / loadDiagCatalogs", () => {
  it("names fields like the decoder", () => {
    const { map, warnings } = parse(namesText);
    expect([...map.keys()].sort()).toEqual(
      [
        ...cells("TBMS.cell_voltage"),
        "TBMS.current",
        "TBMS.contactor",
        "TBMS.vin",
        "TBMS.DT_Pack.PRES_Temp_2Byte",
        "TBMS.DT_Pack.PRES_Flag",
        "TBMS.DT_Ident_B.PRES_VIN_17Byte",
      ].sort(),
    );
    expect(map.size).toBe(18);
    expect(warnings).toEqual([]);

    const only = parse(
      `[fields]\n"DT_Pack/PRES_Temp_2Byte" = "temp"\n"DT_Cell_Voltage_Cell/PRES_Cell_2Byte" = "cell"\n`,
    );
    expect(only.warnings).toEqual([]);
    expect(only.map.has("TBMS.temp")).toBe(true);
    for (const n of cells("TBMS.cell")) expect(only.map.has(n), n).toBe(true);
  });

  it("carries unit, kind, states and invalid rows", () => {
    const { map } = parse(namesText);
    const cell = map.get("TBMS.cell_voltage.03");
    expect(cell?.unit).toBe("V");
    expect(cell?.diag).toEqual({
      file: FILE,
      ecu: "TBMS",
      group: "DT_Cell",
      did: 520,
      field: "PRES_Cell_2Byte",
      element: 3,
      kind: "number",
      invalid: [{ low: 65535, high: 65535, text: "Signal not available" }],
    });
    const contactor = map.get("TBMS.contactor");
    expect(contactor?.unit).toBeUndefined();
    expect(contactor?.diag.kind).toBe("enum");
    expect(contactor?.diag.states).toEqual([
      { low: 0, high: 0, text: "open" },
      { low: 1, high: 1, text: "precharge" },
      { low: 2, high: 2, text: "closed" },
    ]);
    expect(contactor?.diag.invalid?.map((r) => r.low)).toEqual([3, 255]);
    const vin = map.get("TBMS.vin");
    expect(vin?.diag.kind).toBe("text");
    expect(vin?.unit).toBeUndefined();
    expect(vin?.diag).not.toHaveProperty("states");
    expect(vin?.diag).not.toHaveProperty("invalid");
    const temp = map.get("TBMS.DT_Pack.PRES_Temp_2Byte");
    expect(temp?.unit).toBe("°C");
    expect(temp?.diag).not.toHaveProperty("invalid");
    expect(map.get("TBMS.DT_Pack.PRES_Flag")?.unit).toBeUndefined();
  });

  it("keeps the earlier catalog's signals", async () => {
    const path = fixture(FILE);
    const warnings: string[] = [];
    const map = await loadDiagCatalogs([path, path], (m) => warnings.push(m));
    expect(map.size).toBe(18);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(
      `${FILE}: 18 signals already named by an earlier catalog, the earlier wins: `,
    );
  });

  it("ignores bad names entries with a warning", () => {
    const names = `[fields]
PRES_VIN_17Byte = "a"
Nope = "b"
"0x0999/PRES_Flag" = "c"
DT_Pack_Current = "current"
"0x0204/PRES_Temp_2Byte" = "9x"
"DT_Pack/PRES_Flag" = "current"
"0x0204/DT_Pack_Current" = "amps"
`;
    const { map, warnings } = parse(names);
    expect(map.has("TBMS.current")).toBe(true);
    expect(map.has("TBMS.a")).toBe(false);
    expect(map.has("TBMS.amps")).toBe(false);
    expect(warnings).toHaveLength(6);
    const expected: Array<[string, RegExp]> = [
      ["PRES_VIN_17Byte", /ambiguous/],
      ["Nope", /no such field/],
      ["0x0999/PRES_Flag", /no group/],
      ["0x0204/PRES_Temp_2Byte", /not a name/],
      ["DT_Pack/PRES_Flag", /name already given/],
      ["0x0204/DT_Pack_Current", /field already named/],
    ];
    expected.forEach(([key, re], i) => {
      expect(warnings[i]).toContain(key);
      expect(warnings[i]).toMatch(re);
      expect(warnings[i]).toMatch(/entry ignored$/);
    });
  });

  it("skips missing and foreign manifests, falls back without names file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "diag-"));
    const copy = join(dir, "copy.manifest.json");
    copyFileSync(fixture(FILE), copy);
    const foreign = join(dir, "foreign.manifest.json");
    writeFileSync(
      foreign,
      JSON.stringify({ format: "uds-catalog-manifest/2", ecu: { name: "X" }, groups: [] }),
    );
    const missing = join(dir, "missing.manifest.json");
    const warnings: string[] = [];
    const map = await loadDiagCatalogs([fixture(FILE), copy, missing, foreign], (m) =>
      warnings.push(m),
    );
    expect(map.size).toBe(33);
    for (const n of [
      ...cells("TBMS.DT_Cell.PRES_Cell_2Byte"),
      "TBMS.DT_Pack.DT_Pack_Current",
      "TBMS.DT_Contactor.PRES_Contactor_State",
      "TBMS.DT_Ident_A.PRES_VIN_17Byte",
    ])
      expect(map.has(n), n).toBe(true);
    expect(warnings).toHaveLength(4);
    expect(warnings[0]).toContain("copy.names.toml");
    expect(warnings[0]).toContain("fields keep their catalog names");
    expect(warnings[1]).toContain(
      "copy.manifest.json: 3 signals already named by an earlier catalog",
    );
    for (const n of [
      "TBMS.DT_Pack.PRES_Temp_2Byte",
      "TBMS.DT_Pack.PRES_Flag",
      "TBMS.DT_Ident_B.PRES_VIN_17Byte",
    ])
      expect(warnings[1]).toContain(n);
    expect(warnings[2]).toContain(`${missing} skipped`);
    expect(warnings[3]).toContain(`${foreign} skipped`);
  });

  const real = resolve(
    import.meta.dirname,
    "../../../../CarController/vehicles/smart451/uds/bms-live.manifest.json",
  );
  it.skipIf(!existsSync(real) || !existsSync(real.replace(/\.manifest\.json$/, ".names.toml")))(
    "reads the real bms-live catalog",
    async () => {
      const warnings: string[] = [];
      const map = await loadDiagCatalogs([real], (m) => warnings.push(m));
      expect(map.size).toBe(498);
      for (const n of [
        "BMS.cell_voltage.001",
        "BMS.cell_voltage.200",
        "BMS.contactor",
        "BMS.soc",
        "BMS.vin",
      ])
        expect(map.has(n), n).toBe(true);
      expect(warnings).toEqual([]);
    },
  );
});
