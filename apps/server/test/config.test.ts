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
      text: "text",
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

  it("reads the events mapping", () => {
    expect(loadConfig(base, "/repo/kipscope").events).toEqual({
      table: "events",
      source: "source",
      kind: "kind",
      name: "name",
      value: "value",
      text: "text",
      detail: "detail",
    });
    const custom = loadConfig(
      {
        ...base,
        KIPSCOPE_EVENTS_TABLE: "diag_events",
        KIPSCOPE_EVENT_COLUMN_TEXT: "label",
        KIPSCOPE_COLUMN_TEXT: "state",
      },
      "/repo/kipscope",
    );
    expect(custom.events.table).toBe("diag_events");
    expect(custom.events.text).toBe("label");
    expect(custom.events.detail).toBe("detail");
    expect(custom.mapping.text).toBe("state");
    // Invalid identifiers name their variable.
    expect(() => loadConfig({ ...base, KIPSCOPE_EVENTS_TABLE: "a-b" })).toThrow(
      /KIPSCOPE_EVENTS_TABLE/,
    );
    expect(() => loadConfig({ ...base, KIPSCOPE_EVENT_COLUMN_KIND: "a-b" })).toThrow(
      /KIPSCOPE_EVENT_COLUMN_KIND/,
    );
    expect(() => loadConfig({ ...base, KIPSCOPE_COLUMN_TEXT: "a b" })).toThrow(
      /KIPSCOPE_COLUMN_TEXT/,
    );
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

  it("selects the source", () => {
    // No KIPSCOPE_SOURCE: ClickHouse with today's variables and defaults.
    const clickhouse = loadConfig(
      { ...base, CLICKHOUSE_USER: "kip", CLICKHOUSE_PASSWORD: "pw" },
      "/repo/kipscope",
    );
    expect(clickhouse.source).toEqual({
      kind: "clickhouse",
      url: "http://localhost:18123",
      username: "kip",
      password: "pw",
    });
    // Only CLICKHOUSE_URL set: the mapping of before this change.
    const plain = loadConfig(base, "/repo/kipscope");
    expect(plain.source).toEqual({
      kind: "clickhouse",
      url: "http://localhost:18123",
      username: "default",
      password: "",
    });
    expect(plain.mapping).toEqual({
      database: "sdlog",
      table: "signals",
      dataRef: "vehicle",
      signal: "signal",
      time: "utc",
      value: "value",
      text: "text",
    });
    expect(plain.events.table).toBe("events");
    expect(loadConfig({ ...base, KIPSCOPE_SOURCE: "clickhouse" }).source.kind).toBe("clickhouse");

    // ADX with cluster and database, no CLICKHOUSE_URL; ClickHouse variables are ignored.
    const adx = loadConfig(
      {
        KIPSCOPE_SOURCE: "adx",
        KIPSCOPE_ADX_CLUSTER: "https://help.kusto.windows.net",
        KIPSCOPE_ADX_DATABASE: "Samples",
        CLICKHOUSE_DATABASE: "ignored; DROP",
      },
      "/repo/kipscope",
    );
    expect(adx.source).toEqual({
      kind: "adx",
      cluster: "https://help.kusto.windows.net",
      auth: "azcli",
    });
    expect(adx.mapping.database).toBe("Samples");

    // The other source's variables are ignored: an ADX cluster that would be invalid changes nothing.
    expect(loadConfig({ ...base, KIPSCOPE_ADX_CLUSTER: "not a url" }).source.kind).toBe(
      "clickhouse",
    );

    // Missing required variables name themselves.
    expect(() => loadConfig({ KIPSCOPE_SOURCE: "adx", KIPSCOPE_ADX_DATABASE: "Samples" })).toThrow(
      /KIPSCOPE_ADX_CLUSTER/,
    );
    expect(() =>
      loadConfig({
        KIPSCOPE_SOURCE: "adx",
        KIPSCOPE_ADX_CLUSTER: "https://help.kusto.windows.net",
      }),
    ).toThrow(/KIPSCOPE_ADX_DATABASE/);
    expect(() => loadConfig({ KIPSCOPE_SOURCE: "clickhouse" })).toThrow(/CLICKHOUSE_URL/);

    // An unknown value names the variable and both allowed values.
    expect(() => loadConfig({ ...base, KIPSCOPE_SOURCE: "postgres" })).toThrow(
      /KIPSCOPE_SOURCE.*clickhouse.*adx/,
    );
  });

  it("reads the ADX settings", () => {
    const adxEnv = {
      KIPSCOPE_SOURCE: "adx",
      KIPSCOPE_ADX_CLUSTER: "https://help.kusto.windows.net",
      KIPSCOPE_ADX_DATABASE: "Samples",
    };
    // Defaults: azcli, the neutral layout, the events table of the same layout.
    const config = loadConfig(adxEnv, "/repo/kipscope");
    expect(config.source).toMatchObject({ kind: "adx", auth: "azcli" });
    expect(config.mapping).toEqual({
      database: "Samples",
      table: "signals",
      dataRef: "dataref",
      signal: "signal",
      time: "timestamp",
      value: "value",
      text: "text",
    });
    expect(config.events).toEqual({
      table: "events",
      source: "source",
      kind: "kind",
      name: "name",
      value: "value",
      text: "text",
      detail: "detail",
    });

    // http:// only for a loopback host.
    expect(() => loadConfig({ ...adxEnv, KIPSCOPE_ADX_CLUSTER: "http://10.0.0.5:8080" })).toThrow(
      /KIPSCOPE_ADX_CLUSTER/,
    );
    // auth none only for a loopback cluster.
    expect(() => loadConfig({ ...adxEnv, KIPSCOPE_ADX_AUTH: "none" })).toThrow(/KIPSCOPE_ADX_AUTH/);
    const emulator = loadConfig({
      ...adxEnv,
      KIPSCOPE_ADX_CLUSTER: "http://127.0.0.1:8125",
      KIPSCOPE_ADX_AUTH: "none",
    });
    expect(emulator.source).toEqual({
      kind: "adx",
      cluster: "http://127.0.0.1:8125",
      auth: "none",
    });
    for (const host of ["http://localhost:8125", "http://[::1]:8125"]) {
      expect(loadConfig({ ...adxEnv, KIPSCOPE_ADX_CLUSTER: host }).source).toMatchObject({
        kind: "adx",
        cluster: host,
      });
    }

    // The cluster is an origin: a trailing slash is dropped, a path, query or user is refused.
    expect(
      loadConfig({ ...adxEnv, KIPSCOPE_ADX_CLUSTER: "https://help.kusto.windows.net/" }).source,
    ).toMatchObject({ cluster: "https://help.kusto.windows.net" });
    for (const bad of [
      "https://help.kusto.windows.net/v2",
      "https://help.kusto.windows.net/?a=1",
      "https://user:pw@help.kusto.windows.net",
      "help.kusto.windows.net",
    ]) {
      expect(() => loadConfig({ ...adxEnv, KIPSCOPE_ADX_CLUSTER: bad }), bad).toThrow(
        /KIPSCOPE_ADX_CLUSTER/,
      );
    }

    // An unknown auth value names its variable; so does a database that is no KQL entity name.
    expect(() => loadConfig({ ...adxEnv, KIPSCOPE_ADX_AUTH: "key" })).toThrow(/KIPSCOPE_ADX_AUTH/);
    expect(() => loadConfig({ ...adxEnv, KIPSCOPE_ADX_DATABASE: "a;b" })).toThrow(
      /KIPSCOPE_ADX_DATABASE/,
    );
    expect(loadConfig({ ...adxEnv, KIPSCOPE_ADX_DATABASE: "My db-1.test" }).mapping.database).toBe(
      "My db-1.test",
    );

    // The mapping variables still apply: a stored function instead of the table.
    const mapped = loadConfig({
      ...adxEnv,
      KIPSCOPE_TABLE: "KIPscopeSignals",
      KIPSCOPE_COLUMN_TIME: "EventTime",
      KIPSCOPE_EVENTS_TABLE: "KIPscopeEvents",
    });
    expect(mapped.mapping.table).toBe("KIPscopeSignals");
    expect(mapped.mapping.time).toBe("EventTime");
    expect(mapped.events.table).toBe("KIPscopeEvents");
  });
});
