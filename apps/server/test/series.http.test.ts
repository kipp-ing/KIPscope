import { decodeTimes, fromIso } from "@letsview/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { Catalog } from "../src/catalog.ts";
import { ClickHouseSource, createClickHouseClient } from "../src/clickhouse.ts";
import { WorkspaceStore } from "../src/workspace.ts";
import { testMapping, testSource } from "./testdb.ts";

function appFor(table = "signals") {
  const source = testSource(table);
  const catalog = new Catalog(source, async () => new Map());
  return {
    app: buildApp({ catalog, source, workspace: new WorkspaceStore({ signalExists: () => true }) }),
    catalog,
  };
}

describe("GET /api/series", () => {
  const { app, catalog } = appFor();
  beforeAll(() => catalog.refresh());
  afterAll(() => app.close());

  it("returns raw points for a short range, accepting ISO and decimal times", async () => {
    const from = fromIso("2026-10-01T00:00:00Z");
    const res = await app.inject({
      url: "/api/series",
      query: {
        signal: "testcar/Nodbc_500h.RAW",
        from: "2026-10-01T00:00:00Z",
        to: (from + 10_000_000_000n).toString(),
        target: "100",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.kind).toBe("raw");
    expect(body.v).toEqual([0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);
    expect(body.from).toBe(from.toString());
    expect(body.after).toEqual({ t: (from + 10_000_000_000n).toString(), v: 0 });
  });

  it("returns buckets for the 10-hour overview", async () => {
    const res = await app.inject({
      url: "/api/series",
      query: {
        signal: "testcar/Fast_100h.SIG_A",
        from: "2026-10-01T00:00:00Z",
        to: "2026-10-01T10:00:00Z",
        target: "2000",
      },
    });
    const body = res.json();
    expect(body.kind).toBe("buckets");
    expect(body.count.length).toBeLessThanOrEqual(2000);
    expect(Math.max(...body.max)).toBe(1000);
  });

  it("rejects bad parameters with 400 and unknown signals with 404", async () => {
    const bad = [
      { signal: "testcar/Nodbc_500h.RAW", from: "x", to: "2026-10-01T00:00:00Z" },
      {
        signal: "testcar/Nodbc_500h.RAW",
        from: "2026-10-01T01:00:00Z",
        to: "2026-10-01T00:00:00Z",
      },
      { signal: "testcar/Nodbc_500h.RAW", from: "0", to: "1", target: "1" },
    ];
    for (const query of bad) {
      const res = await app.inject({ url: "/api/series", query });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("invalid_request");
    }
    const unknown = await app.inject({
      url: "/api/series",
      query: { signal: "testcar/Nope.NOPE", from: "0", to: "1" },
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error).toMatchObject({
      code: "unknown_signal",
      signalId: "testcar/Nope.NOPE",
    });
  });
});

describe("GET /api/extent", () => {
  const { app, catalog } = appFor();
  beforeAll(() => catalog.refresh());
  afterAll(() => app.close());

  it("returns first and last timestamp of a signal", async () => {
    const res = await app.inject({
      url: "/api/extent",
      query: { signal: "testcar/Fast_100h.SIG_C" },
    });
    expect(res.json()).toEqual({
      signalId: "testcar/Fast_100h.SIG_C",
      first: fromIso("2026-10-01T00:00:00Z").toString(),
      last: fromIso("2026-10-01T09:59:59.995Z").toString(),
    });
  });

  it("ignores rows without timestamp and rejects unknown signals", async () => {
    const res = await app.inject({
      url: "/api/extent",
      query: { signal: "testcar/Fast_100h.SIG_A" },
    });
    expect(res.json().first).toBe(fromIso("2026-10-01T00:00:00Z").toString());
    const unknown = await app.inject({ url: "/api/extent", query: { signal: "testcar/X.Y" } });
    expect(unknown.statusCode).toBe(404);
  });
});

describe("GET /api/series before the catalog was ever loaded", () => {
  const source = testSource();
  const app = buildApp({
    catalog: new Catalog(source, async () => new Map()),
    source,
    workspace: new WorkspaceStore({ signalExists: () => true }),
  });
  afterAll(() => app.close());

  it("answers 503 for series before the catalog was ever loaded", async () => {
    const res = await app.inject({
      url: "/api/series",
      query: { signal: "testcar/Nodbc_500h.RAW", from: "1000", to: "2000" },
    });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(Object.keys(body)).toEqual(["error"]);
    expect(body.error).toMatchObject({
      code: "catalog_unavailable",
      signalId: "testcar/Nodbc_500h.RAW",
      from: "1000",
      to: "2000",
    });
    expect(body.error.message).toBeTruthy();
  });
});

describe("GET /api/series with the database unavailable", () => {
  // The catalog is loaded from the test DB; only the series source is unreachable.
  const catalog = new Catalog(testSource(), async () => new Map());
  const source = new ClickHouseSource(
    createClickHouseClient({ url: "http://127.0.0.1:1", username: "x", password: "" }),
    testMapping,
    5,
  );
  const app = buildApp({
    catalog,
    source,
    workspace: new WorkspaceStore({ signalExists: () => true }),
  });
  beforeAll(() => catalog.refresh());
  afterAll(() => app.close());

  it("returns an error naming signal and range, and no data", async () => {
    const res = await app.inject({
      url: "/api/series",
      query: { signal: "testcar/Fast_100h.SIG_A", from: "1000", to: "2000" },
    });
    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(Object.keys(body)).toEqual(["error"]);
    expect(body.error).toMatchObject({
      code: "source_error",
      signalId: "testcar/Fast_100h.SIG_A",
      from: "1000",
      to: "2000",
    });
    expect(body.error.message).toBeTruthy();
  });
});

describe("timestamp precision end to end", () => {
  it("returns a millisecond timestamp exactly", async () => {
    const { app, catalog } = appFor();
    await catalog.refresh();
    const t = fromIso("2026-10-01T09:59:59.995Z");
    const res = await app.inject({
      url: "/api/series",
      query: { signal: "testcar/Fast_100h.SIG_C", from: t.toString(), to: (t + 1n).toString() },
    });
    expect(decodeTimes(res.json().t)).toEqual([t]);
    await app.close();
  });

  it("returns a nanosecond timestamp exactly", async () => {
    const { app, catalog } = appFor("signals_ns");
    await catalog.refresh();
    const t = fromIso("2026-10-14T08:00:00.123456789Z");
    const res = await app.inject({
      url: "/api/series",
      query: { signal: "testcar/Ns_600h.FINE", from: t.toString(), to: (t + 2002n).toString() },
    });
    const body = res.json();
    expect(decodeTimes(body.t)).toEqual([t, t + 1001n]);
    expect(body.t.t0).toBe("1791964800123456789");
    await app.close();
  });
});
