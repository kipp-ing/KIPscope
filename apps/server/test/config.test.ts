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

  it("reads the catalog mode and the scope pad", () => {
    // KIPSCOPE_CATALOG: full by default, scoped on request, anything else stops the server.
    expect(loadConfig(base, "/repo/kipscope").catalogMode).toBe("full");
    expect(loadConfig({ ...base, KIPSCOPE_CATALOG: "scoped" }, "/repo/kipscope").catalogMode).toBe(
      "scoped",
    );
    expect(loadConfig({ ...base, KIPSCOPE_CATALOG: "full" }, "/repo/kipscope").catalogMode).toBe(
      "full",
    );
    expect(() => loadConfig({ ...base, KIPSCOPE_CATALOG: "lazy" }, "/repo/kipscope")).toThrow(
      /KIPSCOPE_CATALOG.*full.*scoped|KIPSCOPE_CATALOG.*scoped.*full/,
    );

    // KIPSCOPE_SCOPE_PAD: a CLI duration of at least 0, 1 h by default.
    const pad = (value?: string) =>
      loadConfig(
        value === undefined ? base : { ...base, KIPSCOPE_SCOPE_PAD: value },
        "/repo/kipscope",
      ).scopePad;
    expect(pad()).toBe(3_600_000_000_000n);
    expect(pad("30min")).toBe(1_800_000_000_000n);
    expect(pad("0s")).toBe(0n);
    for (const bad of ["-1h", "1d"]) {
      expect(() => pad(bad), bad).toThrow(/KIPSCOPE_SCOPE_PAD/);
    }
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

  // add-multiuser M2: the identity adapter, the origins, the share switch, the idle days, the web dir.
  const corp = {
    ...base,
    KIPSCOPE_ORIGINS: "https://kipscope.example.org",
  };
  const oidcEnv = {
    ...corp,
    KIPSCOPE_IDENTITY: "oidc",
    KIPSCOPE_OIDC_ISSUER: "https://idp.example.org",
    KIPSCOPE_OIDC_AUDIENCE: "kipscope",
  };

  it("reads the identity settings", () => {
    // Without the variable: no login.
    expect(loadConfig(base, "/repo/kipscope").identity).toEqual({ kind: "none" });

    const oidc = loadConfig(oidcEnv, "/repo/kipscope");
    expect(oidc.identity).toMatchObject({
      kind: "oidc",
      oidc: {
        issuer: "https://idp.example.org",
        audience: "kipscope",
        userClaim: "sub",
        rolesClaim: "roles",
        header: "authorization",
      },
    });
    // The default algorithms, in the order of the contract.
    const algs = (oidc.identity as { oidc: { algs: string[] | string } }).oidc.algs;
    expect(Array.isArray(algs) ? algs.join(",") : algs).toBe("RS256,PS256,ES256");
    // No rules file any more (D-085): the config has no such field.
    expect(oidc).not.toHaveProperty("rulesFile");

    const module_ = loadConfig(
      { ...corp, KIPSCOPE_IDENTITY: "module:apps/server/examples/forward-header.mjs" },
      "/repo/kipscope",
    );
    expect(module_.identity.kind).toBe("module");
    expect((module_.identity as { path: string }).path).toMatch(
      /apps\/server\/examples\/forward-header\.mjs$/,
    );

    // Overrides of the oidc claims, header and algorithms.
    const custom = loadConfig(
      {
        ...oidcEnv,
        KIPSCOPE_OIDC_USER_CLAIM: "preferred_username",
        KIPSCOPE_OIDC_ROLES_CLAIM: "realm_access.roles",
        KIPSCOPE_OIDC_HEADER: "x-forwarded-access-token",
        KIPSCOPE_OIDC_ALGS: "ES256",
        KIPSCOPE_OIDC_JWKS_URL: "https://idp.example.org/keys",
      },
      "/repo/kipscope",
    );
    expect(custom.identity).toMatchObject({
      kind: "oidc",
      oidc: {
        userClaim: "preferred_username",
        rolesClaim: "realm_access.roles",
        header: "x-forwarded-access-token",
        jwksUrl: "https://idp.example.org/keys",
      },
    });

    // Missing audience, forbidden algorithms, no origins, an unknown kind: each names its variable.
    const { KIPSCOPE_OIDC_AUDIENCE: _a, ...noAudience } = oidcEnv;
    expect(() => loadConfig(noAudience, "/repo/kipscope")).toThrow(/KIPSCOPE_OIDC_AUDIENCE/);
    const { KIPSCOPE_OIDC_ISSUER: _i, ...noIssuer } = oidcEnv;
    expect(() => loadConfig(noIssuer, "/repo/kipscope")).toThrow(/KIPSCOPE_OIDC_ISSUER/);
    for (const bad of ["HS256", "none", "RS256,HS384", "RS256,PS999"]) {
      expect(
        () => loadConfig({ ...oidcEnv, KIPSCOPE_OIDC_ALGS: bad }, "/repo/kipscope"),
        bad,
      ).toThrow(/KIPSCOPE_OIDC_ALGS/);
    }
    const { KIPSCOPE_ORIGINS: _o, ...moduleNoOrigins } = { ...corp, KIPSCOPE_IDENTITY: "module:x" };
    expect(() => loadConfig(moduleNoOrigins, "/repo/kipscope")).toThrow(/KIPSCOPE_ORIGINS/);
    const ping = () => loadConfig({ ...corp, KIPSCOPE_IDENTITY: "ping" }, "/repo/kipscope");
    expect(ping).toThrow(/KIPSCOPE_IDENTITY/);
    expect(ping).toThrow(/none/);
    expect(ping).toThrow(/oidc/);
    expect(ping).toThrow(/module:/);

    // KIPSCOPE_RULES is not read: setting it to a missing path changes none of the results.
    for (const env of [base, oidcEnv, { ...corp, KIPSCOPE_IDENTITY: "module:x" }]) {
      const rules = { ...env, KIPSCOPE_RULES: "/does/not/exist.yaml" };
      expect(loadConfig(rules, "/repo/kipscope")).toEqual(loadConfig(env, "/repo/kipscope"));
    }
  });

  it("refuses an insecure or malformed oidc issuer", () => {
    for (const bad of [
      "http://idp.example.org",
      "idp.example.org",
      "ftp://idp.example.org",
      "https://",
    ]) {
      expect(
        () => loadConfig({ ...oidcEnv, KIPSCOPE_OIDC_ISSUER: bad }, "/repo/kipscope"),
        bad,
      ).toThrow(/KIPSCOPE_OIDC_ISSUER/);
    }
    // http only for a loopback host (tests with a local JWKS server).
    for (const ok of ["http://127.0.0.1:41234", "http://localhost:41234/as"]) {
      expect(
        loadConfig({ ...oidcEnv, KIPSCOPE_OIDC_ISSUER: ok }, "/repo/kipscope").identity.kind,
        ok,
      ).toBe("oidc");
    }
  });

  it("needs no origins with identity none", () => {
    const config = loadConfig(base, "/repo/kipscope");
    expect(config.identity).toEqual({ kind: "none" });
    expect(config.origins).toEqual([]);
  });

  it("reads the auth settings", () => {
    // Origins: a comma list of http(s) origins without a path, trimmed.
    const origins = (value: string) =>
      loadConfig({ ...oidcEnv, KIPSCOPE_ORIGINS: value }, "/repo/kipscope").origins;
    expect(origins("https://a.example, http://b.example:8080")).toEqual([
      "https://a.example",
      "http://b.example:8080",
    ]);
    for (const bad of [
      "https://a.example/app",
      "ftp://a.example",
      "a.example",
      "https://a.example, x",
    ]) {
      expect(() => origins(bad), bad).toThrow(/KIPSCOPE_ORIGINS/);
    }
    expect(() => origins("https://a.example/app")).toThrow(/https:\/\/a\.example\/app/);
    // Required unless none.
    const { KIPSCOPE_ORIGINS: _o, ...noOrigins } = oidcEnv;
    expect(() => loadConfig(noOrigins, "/repo/kipscope")).toThrow(/KIPSCOPE_ORIGINS/);
    expect(() => origins("")).toThrow(/KIPSCOPE_ORIGINS/);
    // With none they may be set (the Origin guard then also admits them) or left out.
    expect(
      loadConfig({ ...base, KIPSCOPE_ORIGINS: "https://a.example" }, "/repo/kipscope").origins,
    ).toEqual(["https://a.example"]);

    // Idle days of a workspace: 30 by default, an integer of at least 1.
    const idle = (value?: string) =>
      loadConfig(
        value === undefined ? base : { ...base, KIPSCOPE_WORKSPACE_IDLE_DAYS: value },
        "/repo/kipscope",
      ).workspaceIdleDays;
    expect(idle()).toBe(30);
    expect(idle("7")).toBe(7);
    for (const bad of ["0", "x", "-3", "1.5"]) {
      expect(() => idle(bad), bad).toThrow(/KIPSCOPE_WORKSPACE_IDLE_DAYS/);
    }
    // The old name is not read any more.
    expect(
      loadConfig({ ...base, KIPSCOPE_SESSION_IDLE_DAYS: "7" }, "/repo/kipscope").workspaceIdleDays,
    ).toBe(30);

    // The share switch (data-access "Share switch"): on by default, on|off only.
    const share = (value?: string, env = oidcEnv) =>
      loadConfig(value === undefined ? env : { ...env, KIPSCOPE_SHARE: value }, "/repo/kipscope")
        .share;
    expect(share()).toBe(true);
    expect(share("on")).toBe(true);
    expect(share("off")).toBe(false);
    for (const bad of ["maybe", "true", "1"]) {
      expect(() => share(bad), bad).toThrow(/KIPSCOPE_SHARE/);
    }
    // With none the setting is ignored by the guard; the config still reads it.
    expect(loadConfig(base, "/repo/kipscope").share).toBe(true);
  });

  it("reads the web directory", () => {
    expect(loadConfig(base, "/repo/kipscope").webDir).toBeUndefined();
    expect(
      loadConfig({ ...base, KIPSCOPE_WEB_DIR: "/srv/kipscope/web" }, "/repo/kipscope").webDir,
    ).toBe("/srv/kipscope/web");
    expect(
      loadConfig({ ...base, KIPSCOPE_WEB_DIR: "apps/web/dist" }, "/repo/kipscope").webDir,
    ).toBe("/repo/kipscope/apps/web/dist");
  });
});
