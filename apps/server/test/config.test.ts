import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";

const base = { CLICKHOUSE_URL: "http://localhost:18123" };

describe("loadConfig", () => {
  it("defaults to the carserver sdlog mapping", () => {
    const config = loadConfig(base, "/repo/letsview");
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
    expect(config.queryConcurrency).toBe(4);
    expect(config.port).toBe(7310);
  });

  it("applies overrides", () => {
    const config = loadConfig(
      {
        ...base,
        LETSVIEW_TABLE: "signals_ns",
        LETSVIEW_COLUMN_TIME: "ts",
        LETSVIEW_DBC_FILES: "/abs/a.dbc, rel/b.dbc",
        LETSVIEW_QUERY_CONCURRENCY: "2",
      },
      "/repo/letsview",
    );
    expect(config.mapping.table).toBe("signals_ns");
    expect(config.mapping.time).toBe("ts");
    expect(config.dbcFiles).toEqual(["/abs/a.dbc", "/repo/letsview/rel/b.dbc"]);
    expect(config.queryConcurrency).toBe(2);
  });

  it("rejects unsafe identifiers and bad numbers", () => {
    expect(() => loadConfig({ ...base, LETSVIEW_TABLE: "x; DROP TABLE y" })).toThrow(/identifier/);
    expect(() => loadConfig({ ...base, LETSVIEW_QUERY_CONCURRENCY: "0" })).toThrow(/positive/);
    expect(() => loadConfig({})).toThrow(/CLICKHOUSE_URL/);
  });

  it("resolves the project file path", () => {
    expect(loadConfig(base, "/repo/letsview").projectFile).toEqual({
      path: "/repo/letsview/letsview.yaml",
      required: false,
    });
    expect(
      loadConfig({ ...base, LETSVIEW_PROJECT_FILE: "conf/p.yaml" }, "/repo/letsview").projectFile,
    ).toEqual({ path: "/repo/letsview/conf/p.yaml", required: true });
    expect(
      loadConfig({ ...base, LETSVIEW_PROJECT_FILE: "/abs/p.yaml" }, "/repo/letsview").projectFile,
    ).toEqual({ path: "/abs/p.yaml", required: true });
    expect(
      loadConfig({ ...base, LETSVIEW_PROJECT_FILE: "" }, "/repo/letsview").projectFile,
    ).toEqual({ path: "/repo/letsview/letsview.yaml", required: false });
  });
});
