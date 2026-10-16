import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";

const base = { CLICKHOUSE_URL: "http://localhost:18123" };

describe("loadConfig", () => {
  it("defaults to the carserver sdlog mapping", () => {
    const config = loadConfig(base, "/repo/kipscope");
    expect(config.mapping).toEqual({
      database: "sdlog",
      table: "signals",
      dataRef: "vehicle",
      signal: "signal",
      time: "utc",
      value: "value",
    });
    expect(config.dbcFiles).toEqual([
      "/repo/CarController/vehicles/smart451/dbc/h-can.dbc",
      "/repo/CarController/vehicles/smart451/dbc/hybrid-can.dbc",
    ]);
    expect(config.diagCatalogs).toEqual([
      "/repo/CarController/vehicles/smart451/uds/bms-live.manifest.json",
    ]);
    expect(config.queryConcurrency).toBe(4);
    expect(config.port).toBe(7310);
  });

  it("applies overrides", () => {
    const config = loadConfig(
      {
        ...base,
        KIPSCOPE_TABLE: "signals_ns",
        KIPSCOPE_COLUMN_TIME: "ts",
        KIPSCOPE_DBC_FILES: "/abs/a.dbc, rel/b.dbc",
        KIPSCOPE_DIAG_CATALOGS: "a.manifest.json, /abs/b.manifest.json",
        KIPSCOPE_QUERY_CONCURRENCY: "2",
      },
      "/repo/kipscope",
    );
    expect(config.mapping.table).toBe("signals_ns");
    expect(config.mapping.time).toBe("ts");
    expect(config.dbcFiles).toEqual(["/abs/a.dbc", "/repo/kipscope/rel/b.dbc"]);
    expect(config.diagCatalogs).toEqual(["/repo/kipscope/a.manifest.json", "/abs/b.manifest.json"]);
    expect(config.queryConcurrency).toBe(2);
  });

  it("rejects unsafe identifiers and bad numbers", () => {
    expect(() => loadConfig({ ...base, KIPSCOPE_TABLE: "x; DROP TABLE y" })).toThrow(/identifier/);
    expect(() => loadConfig({ ...base, KIPSCOPE_QUERY_CONCURRENCY: "0" })).toThrow(/positive/);
    expect(() => loadConfig({})).toThrow(/CLICKHOUSE_URL/);
  });

  it("resolves the project file path", () => {
    expect(loadConfig(base, "/repo/kipscope").projectFile).toEqual({
      path: "/repo/kipscope/kipscope.yaml",
      required: false,
    });
    expect(
      loadConfig({ ...base, KIPSCOPE_PROJECT_FILE: "conf/p.yaml" }, "/repo/kipscope").projectFile,
    ).toEqual({ path: "/repo/kipscope/conf/p.yaml", required: true });
    expect(
      loadConfig({ ...base, KIPSCOPE_PROJECT_FILE: "/abs/p.yaml" }, "/repo/kipscope").projectFile,
    ).toEqual({ path: "/abs/p.yaml", required: true });
    expect(
      loadConfig({ ...base, KIPSCOPE_PROJECT_FILE: "" }, "/repo/kipscope").projectFile,
    ).toEqual({ path: "/repo/kipscope/kipscope.yaml", required: false });
  });
});
