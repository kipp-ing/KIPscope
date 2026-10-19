import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { Catalog } from "../src/catalog.ts";
import { WorkspaceStore } from "../src/workspace.ts";
import { testCatalog, testSource } from "./testdb.ts";

const workspace = () => new WorkspaceStore({ signalExists: () => true, hasStates: () => false });

describe("GET /api/gaps (test DB)", () => {
  const source = testSource();
  const catalog = testCatalog(source);
  const app = buildApp({ catalog, source, workspace: workspace() });
  beforeAll(() => catalog.refresh());
  afterAll(() => app.close());
  const gaps = (dataRef?: string, signals: string[] = []) =>
    app.inject({
      url: "/api/gaps",
      query: {
        ...(dataRef === undefined ? {} : { dataRef }),
        ...(signals.length > 0 ? { signal: signals } : {}),
      },
    });

  it("lists the logger gaps and periods of gapcar", async () => {
    const res = await gaps("gapcar", ["gapcar/Msr_B12h.MSR", "gapcar/Evt_B11h.EVT"]);
    expect(res.statusCode).toBe(200);
    // G = 2026-10-03T00:00:00Z = 1790985600 s: gaps 00:04:59.980-00:06:00.000 (60.02 s) and
    // 00:09:40.000-00:09:42.000 (2.0 s); not the 1.9 s silence at 00:09:30. Last row 00:09:59.980.
    expect(res.json()).toEqual({
      dataRef: "gapcar",
      through: "1790986199980000000",
      logger: [
        { from: "1790985899980000000", to: "1790985960000000000" },
        { from: "1790986180000000000", to: "1790986182000000000" },
      ],
      periods: {
        "gapcar/Cyc_B10h.CYC": { ns: "20000000", source: "dbc" },
        "gapcar/Msr_B12h.MSR": { ns: "100000000", source: "measured" },
        "gapcar/TBMS.current": { ns: "10000000000", source: "diag" },
      },
    });
    // Evt_B11h.EVT: cycle time 0 and four rows: no period.
    expect(res.json().periods).not.toHaveProperty("gapcar/Evt_B11h.EVT");
  });

  it("finds no logger gap where the logger never paused", async () => {
    // The two signals are named, so their periods are measured and listed.
    const res = await gaps("testcar", ["testcar/Fast_100h.SIG_A", "testcar/Many_700h.S0001"]);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.dataRef).toBe("testcar");
    expect(body.logger).toEqual([]);
    expect(body.through).toBeTypeOf("string");
    // Fast_100h comes from the DBC without a cycle time and is every 5 ms: measured.
    expect(body.periods["testcar/Fast_100h.SIG_A"]).toEqual({ ns: "5000000", source: "measured" });
    // A single-row signal cannot be measured.
    expect(body.periods).not.toHaveProperty("testcar/Many_700h.S0001");
    expect((await gaps("othercar")).json().logger).toEqual([]);
  });

  it("lists measured periods only for named signals", async () => {
    // Static periods (DBC, diag) are listed for every signal; measured ones only when named.
    const plain = await gaps("gapcar");
    expect(plain.statusCode).toBe(200);
    expect(plain.json().periods).toEqual({
      "gapcar/Cyc_B10h.CYC": { ns: "20000000", source: "dbc" },
      "gapcar/TBMS.current": { ns: "10000000000", source: "diag" },
    });
    // A signal of another data ref and one not in the catalog are ignored silently.
    const named = await gaps("gapcar", [
      "gapcar/Msr_B12h.MSR",
      "testcar/Cyc_B10h.CYC",
      "gapcar/Nope",
    ]);
    expect(named.statusCode).toBe(200);
    expect(named.json().periods).toEqual({
      "gapcar/Cyc_B10h.CYC": { ns: "20000000", source: "dbc" },
      "gapcar/Msr_B12h.MSR": { ns: "100000000", source: "measured" },
      "gapcar/TBMS.current": { ns: "10000000000", source: "diag" },
    });
    const { logger, through } = plain.json();
    expect(named.json().logger).toEqual(logger);
    expect(named.json().through).toBe(through);
  });

  it("answers gap info errors like the density route", async () => {
    const missing = await gaps();
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe("invalid_request");
    expect((await gaps("")).statusCode).toBe(400);
    const unknown = await gaps("nocar");
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe("unknown_data_ref");

    // At most 100 signal parameters: 101 are refused before anything is computed, 100 are fine.
    const signalIds = (n: number) => Array.from({ length: n }, (_, i) => `gapcar/S${i}`);
    const tooMany = await gaps("gapcar", signalIds(101));
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json().error.code).toBe("invalid_request");
    expect((await gaps("gapcar", signalIds(100))).statusCode).toBe(200);

    // A catalog that never loaded: 503, checked before the data ref.
    const coldSource = testSource();
    const cold = buildApp({
      catalog: new Catalog(coldSource, async () => new Map()),
      source: coldSource,
      workspace: workspace(),
    });
    try {
      const res = await cold.inject({ url: "/api/gaps", query: { dataRef: "gapcar" } });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe("catalog_unavailable");
    } finally {
      await cold.close();
    }
  });
});
