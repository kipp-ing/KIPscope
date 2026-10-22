import { decodeTimes, fromIso, TIME_MAX, TIME_MIN } from "@kipscope/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { Catalog } from "../src/catalog.ts";
import { ClickHouseSource, createClickHouseClient } from "../src/clickhouse.ts";
import type { DataSource } from "../src/datasource.ts";
import { completeSource } from "../src/fallbacks.ts";
import { WorkspaceStore } from "../src/workspace.ts";
import { testDataSource, testMapping } from "./testdb.ts";

function appFor(table = "signals") {
  const source = testDataSource(table);
  const catalog = new Catalog(source, async () => new Map());
  return {
    app: buildApp({
      catalog,
      source,
      workspace: new WorkspaceStore({ signalExists: () => true, hasStates: () => false }),
    }),
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

  it("rejects times outside the bounds with 400", async () => {
    const signal = "testcar/Nodbc_500h.RAW";
    const outside = [
      // The live bug: both values beyond int64 nanoseconds.
      { from: "-29473328485867940608", to: "62083631947910636800" },
      { from: "-2208988800000000001", to: "0" },
      { from: "0", to: "9223286400000000001" },
      { from: "1899-12-31T23:59:59Z", to: "2026-10-01T00:00:00Z" },
    ];
    for (const range of outside) {
      const res = await app.inject({ url: "/api/series", query: { signal, ...range } });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("invalid_request");
      expect(res.json().error.message).toContain("1900-01-01T00:00:00Z");
    }
    // The bounds themselves are accepted.
    const edge = await app.inject({
      url: "/api/series",
      query: { signal, from: "-2208988800000000000", to: "9223286400000000000", target: "100" },
    });
    expect(edge.statusCode).toBe(200);
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
  const source = testDataSource();
  const app = buildApp({
    catalog: new Catalog(source, async () => new Map()),
    source,
    workspace: new WorkspaceStore({ signalExists: () => true, hasStates: () => false }),
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
  const catalog = new Catalog(testDataSource(), async () => new Map());
  const source = completeSource(
    new ClickHouseSource(
      createClickHouseClient({ url: "http://127.0.0.1:1", username: "x", password: "" }),
      testMapping,
      5,
    ),
  );
  const app = buildApp({
    catalog,
    source,
    workspace: new WorkspaceStore({ signalExists: () => true, hasStates: () => false }),
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

describe("GET /api/series beyond 104 days and at the bounds (harden-robustness)", () => {
  const { app, catalog } = appFor();
  beforeAll(() => catalog.refresh());
  afterAll(() => app.close());

  it("answers raw points more than 104 days apart exactly", async () => {
    const res = await app.inject({
      url: "/api/series",
      query: {
        signal: "spancar/Span_910h.FAR",
        from: "1969-12-31T00:00:00Z",
        to: "2026-12-01T00:00:00Z",
        target: "2000",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.kind).toBe("raw");
    const expected = [
      "1969-12-31T23:59:58.5Z",
      "1969-12-31T23:59:59.5Z",
      "1970-01-01T00:00:00.5Z",
      "2026-01-01T00:00:00Z",
      "2026-10-01T00:00:00Z",
    ].map(fromIso);
    expect(decodeTimes(body.t)).toEqual(expected);
    expect(body.v).toEqual([1, 2, 3, 4, 5]);
    // Offsets beyond 2^53 ns travel as strings.
    expect(typeof body.t.dt.at(-1)).toBe("string");
    expect(typeof body.t.dt[1]).toBe("number");
  });

  it("answers the full time bounds", async () => {
    const signal = "testcar/Fast_100h.SIG_A";
    const res = await app.inject({
      url: "/api/series",
      query: { signal, from: TIME_MIN.toString(), to: TIME_MAX.toString(), target: "2" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.kind).toBe("buckets");
    expect(body.width).toBe("4611686018427387904");
    expect(body.count.length).toBeLessThanOrEqual(3);
    const sum = (b: { count: number[]; sna: number[] }) =>
      b.count.reduce((a, c) => a + c, 0) + b.sna.reduce((a, c) => a + c, 0);
    // SIG_A has 7,200,000 timed rows; the 1,000 extra rows have no time.
    expect(sum(body)).toBe(7_200_000);

    const extent = (await app.inject({ url: "/api/extent", query: { signal } })).json();
    const detailed = await app.inject({
      url: "/api/series",
      query: {
        signal,
        from: extent.first,
        to: (BigInt(extent.last) + 1n).toString(),
        target: "20000",
      },
    });
    expect(sum(detailed.json())).toBe(sum(body));
  });
});

describe("GET /api/series when the server cannot compute (harden-robustness)", () => {
  const source = {
    listSignals: async () => [{ dataRef: "car", name: "S" }],
    // `querySeries` asks the source for the whole answer in one call (speed-up-adx A2).
    series: async () => {
      throw new RangeError("cannot compute");
    },
  } as unknown as DataSource;
  const catalog = new Catalog(source, async () => new Map());
  const app = buildApp({
    catalog,
    source,
    workspace: new WorkspaceStore({ signalExists: () => true, hasStates: () => false }),
  });
  beforeAll(() => catalog.refresh());
  afterAll(() => app.close());

  it("answers 400, not 502, when the server cannot compute a result", async () => {
    const res = await app.inject({
      url: "/api/series",
      query: { signal: "car/S", from: "0", to: "1000" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("invalid_request");
  });
});

describe("GET /api/series text signals (add-events)", () => {
  const { app, catalog } = appFor();
  beforeAll(() => catalog.refresh());
  afterAll(() => app.close());

  it("carries the text of a text signal", async () => {
    const res = await app.inject({
      url: "/api/series",
      query: {
        signal: "testcar/DIAG.door",
        from: "2026-10-01T01:00:00Z",
        to: "2026-10-01T03:00:00Z",
        target: "100",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.kind).toBe("raw");
    expect(body.v).toEqual([0, 0, 0, 0, 0]);
    expect(body.text).toEqual(["closed", "closed", "open", "open", "closed"]);
    // The edge points name their state too: nothing before, the lock-free door has no row after.
    expect(body.before).toBeUndefined();
    expect(body.after).toBeUndefined();

    // A window inside: the neighbours carry their text.
    const inner = await app.inject({
      url: "/api/series",
      query: {
        signal: "testcar/DIAG.door",
        from: "2026-10-01T01:02:00Z",
        to: "2026-10-01T01:04:00Z",
        target: "100",
      },
    });
    const part = inner.json();
    expect(part.text).toEqual(["open"]);
    expect(part.before).toMatchObject({ v: 0, label: "closed" });
    expect(part.after).toMatchObject({ v: 0, label: "open" });
  });

  it("leaves numeric signals without text", async () => {
    const res = await app.inject({
      url: "/api/series",
      query: {
        signal: "testcar/Tmp_A21h.TEMP",
        from: "2026-10-01T01:00:00Z",
        to: "2026-10-01T01:00:05Z",
        target: "100",
      },
    });
    const body = res.json();
    expect(body.kind).toBe("raw");
    expect(body.v).toEqual([20, 21, 22, 23, 24]);
    expect(body).not.toHaveProperty("text");
  });
});
