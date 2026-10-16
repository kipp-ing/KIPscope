import { fromIso } from "@kipscope/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { Catalog } from "../src/catalog.ts";
import { loadDbcFiles } from "../src/dbc.ts";
import { WorkspaceStore } from "../src/workspace.ts";
import { testDbcFiles, testSource } from "./testdb.ts";

const SIGNAL = "testcar/Sna_800h.SPEED";
// SPEED: point n at 2026-10-01T02:00:00Z + n * 100 ms, value n mod 100;
// 511 (SNA) for n in [300, 499] and 600, 602, 999; 42 at n = 601.
const S = fromIso("2026-10-01T02:00:00Z");
const point = (n: number) => (S + BigInt(n) * 100_000_000n).toString();

function appFor() {
  const source = testSource();
  const catalog = new Catalog(source, () => loadDbcFiles(testDbcFiles));
  const app = buildApp({
    catalog,
    source,
    workspace: new WorkspaceStore({ signalExists: () => true }),
  });
  return { app, catalog };
}

describe("GET /api/value", () => {
  const { app, catalog } = appFor();
  beforeAll(() => catalog.refresh());
  afterAll(() => app.close());

  const get = async (t: string, mode?: string) => {
    const res = await app.inject({
      url: "/api/value",
      query: { signal: SIGNAL, t, ...(mode ? { mode } : {}) },
    });
    return { status: res.statusCode, body: res.json() };
  };

  it("evaluates SPEED at points, between points and in SNA runs", async () => {
    // At a point: raw. at = point n = 10, next = n = 11.
    const raw = await get("2026-10-01T02:00:01Z");
    expect(raw.status).toBe(200);
    expect(raw.body).toEqual({
      signalId: SIGNAL,
      t: fromIso("2026-10-01T02:00:01Z").toString(),
      mode: "line",
      at: { t: point(10), v: 10 },
      next: { t: point(11), v: 11 },
      value: { kind: "raw", value: 10 },
    });

    // Between points: linear (default and explicit) and hold.
    const lin = await get("2026-10-01T02:00:01.05Z");
    expect(lin.body.value).toEqual({ kind: "interpolated", value: 10.5 });
    expect(lin.body.at).toEqual({ t: point(10), v: 10 });
    expect(lin.body.next).toEqual({ t: point(11), v: 11 });
    expect((await get("2026-10-01T02:00:01.05Z", "line")).body.value).toEqual(lin.body.value);
    const step = await get("2026-10-01T02:00:01.05Z", "step");
    expect(step.body.mode).toBe("step");
    expect(step.body.value).toEqual({ kind: "held", value: 10 });
    expect(step.body.at).toEqual({ t: point(10), v: 10 });
    expect(step.body.next).toEqual({ t: point(11), v: 11 });

    // Inside the SNA run (n = 350, then between 350 and 351): SNA, never a number, in both modes.
    const sna = await get("2026-10-01T02:00:35Z");
    expect(sna.body.value).toEqual({ kind: "sna" });
    expect(sna.body.at).toEqual({ t: point(350), v: null });
    expect((await get("2026-10-01T02:00:35.05Z")).body.value).toEqual({ kind: "sna" });
    expect((await get("2026-10-01T02:00:35.05Z", "step")).body.value).toEqual({ kind: "sna" });

    // The isolated valid point n = 601 (42) between the SNA points 600 and 602.
    const iso = await get("2026-10-01T02:01:00.1Z");
    expect(iso.body.value).toEqual({ kind: "raw", value: 42 });
    expect(iso.body.at).toEqual({ t: point(601), v: 42 });
    expect(iso.body.next).toEqual({ t: point(602), v: null });
    expect((await get("2026-10-01T02:01:00.15Z")).body.value).toEqual({
      kind: "none",
      reason: "next_sna",
    });
    expect((await get("2026-10-01T02:01:00.15Z", "step")).body.value).toEqual({
      kind: "held",
      value: 42,
    });

    // Outside the data: before n = 0, after n = 999.
    const before = await get("2026-10-01T01:59:59Z");
    expect(before.body.value).toEqual({ kind: "none", reason: "before_first" });
    expect(before.body.at).toBeUndefined();
    expect(before.body.next).toEqual({ t: point(0), v: 0 });
    const after = await get("2026-10-01T02:01:40Z");
    expect(after.body.value).toEqual({ kind: "none", reason: "after_last" });
    expect(after.body.at).toEqual({ t: point(999), v: null });
    expect(after.body.next).toBeUndefined();

    // Decimal nanoseconds are accepted as t as well.
    expect((await get(point(10))).body.value).toEqual({ kind: "raw", value: 10 });
  });

  it("answers errors like the series route", async () => {
    const bad = [
      { signal: SIGNAL, t: "-29473328485867940608" }, // beyond the time bounds
      { signal: SIGNAL, t: "2026-10-13T13:08:00Z", mode: "markers" },
      { signal: SIGNAL, t: "9223286400000000001" },
      { signal: SIGNAL, t: "x" },
      { signal: SIGNAL },
    ];
    for (const query of bad) {
      const res = await app.inject({ url: "/api/value", query });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("invalid_request");
    }
    const oob = await app.inject({
      url: "/api/value",
      query: { signal: SIGNAL, t: "-29473328485867940608" },
    });
    expect(oob.json().error.message).toContain("1900-01-01T00:00:00Z");

    const unknown = await app.inject({
      url: "/api/value",
      query: { signal: "smart451/NOPE.X", t: "2026-10-13T13:08:00Z" },
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error).toMatchObject({
      code: "unknown_signal",
      signalId: "smart451/NOPE.X",
    });

    // Before the catalog was ever loaded: 503, checked first (as for series).
    const source = testSource();
    const cold = buildApp({
      catalog: new Catalog(source, async () => new Map()),
      source,
      workspace: new WorkspaceStore({ signalExists: () => true }),
    });
    try {
      const res = await cold.inject({
        url: "/api/value",
        query: { signal: SIGNAL, t: "2026-10-01T02:00:01Z" },
      });
      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(Object.keys(body)).toEqual(["error"]);
      expect(body.error).toMatchObject({ code: "catalog_unavailable", signalId: SIGNAL });
      expect(body.error.message).toBeTruthy();
    } finally {
      await cold.close();
    }
  });
});
