import { beforeAll, describe, expect, it } from "vitest";
import { Catalog } from "../src/catalog.ts";
import { loadDbcFiles } from "../src/dbc.ts";
import { testDbcFiles, testSource } from "./testdb.ts";

describe("Catalog (test DB)", () => {
  const catalog = new Catalog(testSource(), () => loadDbcFiles(testDbcFiles));
  beforeAll(() => catalog.refresh());

  it("lists exactly the signals with data, per data reference", () => {
    expect(catalog.size).toBe(1007);
    expect(catalog.get("testcar/Fast_100h.SIG_A")).toBeDefined();
    expect(catalog.get("othercar/Fast_100h.SIG_A")).toBeDefined();
  });

  it("does not list signals that exist only in the DBC", () => {
    expect(catalog.get("testcar/Fast_100h.SIG_D")).toBeUndefined();
    expect(catalog.search("SIG_D").total).toBe(0);
  });

  it("merges DBC unit and comment as description", () => {
    expect(catalog.get("testcar/Fast_100h.SIG_A")).toEqual({
      id: "testcar/Fast_100h.SIG_A",
      dataRef: "testcar",
      name: "Fast_100h.SIG_A",
      unit: "rpm",
      description: "Motordrehzahl hinten",
    });
  });

  it("lists a signal without DBC entry with its name only", () => {
    expect(catalog.get("testcar/Nodbc_500h.RAW")).toEqual({
      id: "testcar/Nodbc_500h.RAW",
      dataRef: "testcar",
      name: "Nodbc_500h.RAW",
    });
  });

  it("matches case-insensitively by description, unit and name", () => {
    expect(catalog.search("ÖLTEMPERATUR").items.map((s) => s.name)).toEqual(["Fast_100h.SIG_B"]);
    expect(catalog.search("kpa").items.map((s) => s.name)).toEqual(["Many_700h.S0001"]);
    expect(catalog.search("jitter").items.map((s) => s.name)).toEqual(["Irr_200h.JITTER"]);
  });

  it("requires every term to match", () => {
    expect(catalog.search("fast motordrehzahl").items.map((s) => s.id)).toEqual([
      "othercar/Fast_100h.SIG_A",
      "testcar/Fast_100h.SIG_A",
    ]);
  });

  it("pages large results and flags more matches", () => {
    const first = catalog.search("Many_700h", 0, 50);
    expect(first.items).toHaveLength(50);
    expect(first.total).toBe(1000);
    expect(first.more).toBe(true);
    const last = catalog.search("Many_700h", 950, 50);
    expect(last.items).toHaveLength(50);
    expect(last.more).toBe(false);
    expect(catalog.search("", 0, 10_000).items).toHaveLength(200);
  });

  it("keeps the same IDs after a refresh", async () => {
    const before = catalog.search("", 0, 200).items.map((s) => s.id);
    await catalog.refresh();
    expect(catalog.search("", 0, 200).items.map((s) => s.id)).toEqual(before);
  });
});
