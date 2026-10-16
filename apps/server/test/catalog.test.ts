import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Catalog, keepCatalogLoaded } from "../src/catalog.ts";
import type { DataSource } from "../src/datasource.ts";
import { loadDbcFiles } from "../src/dbc.ts";
import { loadProjectFile } from "../src/project.ts";
import { fixture, testDbcFiles, testSource } from "./testdb.ts";

describe("Catalog (test DB)", () => {
  const catalog = new Catalog(testSource(), () => loadDbcFiles(testDbcFiles));
  beforeAll(() => catalog.refresh());

  it("lists exactly the signals with data, per data reference", () => {
    expect(catalog.size).toBe(1014);
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
      dbc: {
        file: "test-a.dbc",
        message: "Fast_100h",
        messageId: 256,
        factor: 0.1,
        offset: 0,
        min: 0,
        max: 6553.5,
      },
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

  it("ranks search results like the explorer", () => {
    const ids = catalog.search("rpm").items.map((s) => s.id);
    expect(ids[0]).toBe("testcar/Sna_800h.RPM");
    expect(ids.slice(1, 3)).toEqual(["othercar/Fast_100h.SIG_A", "testcar/Fast_100h.SIG_A"]);
  });

  it("keeps the same IDs after a refresh", async () => {
    const before = catalog.search("", 0, 200).items.map((s) => s.id);
    await catalog.refresh();
    expect(catalog.search("", 0, 200).items.map((s) => s.id)).toEqual(before);
  });

  it("reports SNA values and ranges of a signal, none for signals without SNA", () => {
    expect(catalog.get("testcar/Sna_800h.SPEED")?.sna).toEqual([
      { raw: 511, value: 511, sources: ["GenSigSNA", "VAL_"] },
    ]);
    expect(catalog.get("testcar/Sna_800h.COUNTER")?.sna).toBeUndefined();
    expect(catalog.get("testcar/Nodbc_500h.RAW")).not.toHaveProperty("sna");
    expect(catalog.snaRanges("testcar/Sna_800h.SPEED")).toEqual([{ lo: 510.5, hi: 511.5 }]);
    expect(catalog.snaRanges("testcar/Sna_800h.RPM")).toEqual([{ lo: 8191.25, hi: 8191.75 }]);
    expect(catalog.snaRanges("testcar/Sna_800h.TEMP")).toEqual([{ lo: -128.5, hi: -127.5 }]);
    expect(catalog.snaRanges("testcar/Nodbc_500h.RAW")).toEqual([]);
    expect(catalog.snaRanges("testcar/Nope.NOPE")).toEqual([]);
  });
});

describe("Catalog display names (test DB, test project file)", () => {
  const rules = loadProjectFile({ path: fixture("letsview.test.yaml"), required: true });
  const catalog = new Catalog(testSource(), () => loadDbcFiles(testDbcFiles), rules);
  beforeAll(() => catalog.refresh());

  it("sets display names from the test project file", () => {
    const shown = (id: string) => {
      const s = catalog.get(id);
      expect(s, id).toBeDefined();
      return s?.displayName;
    };
    expect(shown("testcar/Irr_200h.JITTER")).toBe("SPEED");
    expect(shown("testcar/Sna_800h.SPEED")).toBe("SPEED (Sna)");
    expect(shown("testcar/Sna_800h.RPM")).toBe("RPM");
    expect(shown("testcar/Sna_800h.TEMP")).toBe("TEMP");
    expect(shown("testcar/Many_700h.S0001")).toBe("S0001");
    expect(shown("testcar/Nodbc_500h.RAW")).toBe("RAW");
    expect(shown("testcar/Sparse_300h.SLOW")).toBe("SLOW");

    // SIG_A/B/C collide twice and show their full names; both data references alike.
    for (const id of [
      "testcar/Fast_100h.SIG_A",
      "othercar/Fast_100h.SIG_A",
      "testcar/Fast_100h.SIG_B",
      "testcar/Fast_100h.SIG_C",
    ]) {
      expect(catalog.get(id), id).not.toHaveProperty("displayName");
    }
    expect(catalog.displayFallbacks).toEqual([
      "Fast_100h.SIG_A",
      "Fast_100h.SIG_B",
      "Fast_100h.SIG_C",
    ]);
    // Identity unchanged.
    expect(catalog.get("testcar/Sna_800h.RPM")?.name).toBe("Sna_800h.RPM");
    expect(catalog.size).toBe(1014);
  });
});

describe("Catalog background load and warnings (stubbed source)", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps loading the catalog with backoff until it succeeds", async () => {
    vi.useFakeTimers();
    const starts: number[] = [];
    const t0 = Date.now();
    const source = {
      listSignals: async () => {
        starts.push(Date.now() - t0);
        if (starts.length <= 4) throw new Error("connect ECONNREFUSED");
        return [{ dataRef: "car", name: "S" }];
      },
    } as unknown as DataSource;
    const catalog = new Catalog(source, async () => new Map());
    const failed: number[] = [];
    let loaded = 0;
    const stop = keepCatalogLoaded(catalog, {
      loaded: () => loaded++,
      failed: (_error, retryInMs) => failed.push(retryInMs),
    });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(starts).toEqual([0, 1000, 3000, 7000, 15000]);
    expect(failed).toEqual([1000, 2000, 4000, 8000]);
    expect(loaded).toBe(1);
    expect(catalog.loadedAt).toBeDefined();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(starts).toHaveLength(5);
    stop();
  });

  it("shares one load between concurrent refreshes", async () => {
    let calls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const source = {
      listSignals: async () => {
        calls++;
        await gate;
        return [{ dataRef: "car", name: "S" }];
      },
    } as unknown as DataSource;
    const catalog = new Catalog(source, async () => new Map());
    const first = catalog.refresh();
    const second = catalog.refresh();
    release();
    await Promise.all([first, second]);
    expect(calls).toBe(1);
    expect(catalog.size).toBe(1);
  });

  it("logs DBC warnings once per load", async () => {
    const source = {
      listSignals: async () => [{ dataRef: "car", name: "S" }],
    } as unknown as DataSource;
    const warnings: string[] = [];
    const catalog = new Catalog(
      source,
      async (warn) => {
        warn("bad.dbc: broken");
        return new Map();
      },
      undefined,
      { warn: (message) => warnings.push(message) },
    );
    await catalog.refresh();
    await catalog.refresh();
    expect(warnings).toEqual([
      "DBC file skipped: bad.dbc: broken",
      "DBC file skipped: bad.dbc: broken",
    ]);
  });
});
