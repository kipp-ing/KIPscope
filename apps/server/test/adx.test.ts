import { randomUUID } from "node:crypto";
import type { BucketSeries, RawSeries } from "@kipscope/shared";
import { describe, expect, it } from "vitest";
import { AdxSource } from "../src/adx.ts";
import { buildApp } from "../src/app.ts";
import { Catalog } from "../src/catalog.ts";
import type { TableMapping } from "../src/config.ts";
import type { Scope, SeriesRef, SourceAdapter } from "../src/datasource.ts";
import { completeSource, coreOnly, nativeMethods } from "../src/fallbacks.ts";
import { KustoClient } from "../src/kusto.ts";
import { querySeries, textLabel } from "../src/series.ts";
import { WorkspaceStore } from "../src/workspace.ts";
import { adxEventMapping, adxMapping, adxMgmt, TEST_ADX_DATABASE, testAdxUrl } from "./adxdb.ts";
import { B, FIXTURE_SIGNALS } from "./conformance/fixture.ts";
import { SCOPE_S2, SCOPED_CALLS } from "./scopeCalls.ts";

const S = 1_000_000_000n;

const client = () =>
  new KustoClient({ cluster: testAdxUrl(), database: TEST_ADX_DATABASE, timeoutSeconds: 30 });
const adapter = (mapping = adxMapping, events = adxEventMapping) =>
  new AdxSource(client(), mapping, events);

describe("ADX adapter on the emulator", () => {
  it("reads through a stored function", async () => {
    // KSignals() renames the columns of another table to the default layout (seed-adx.ts).
    const source = adapter({ ...adxMapping, table: "KSignals" });
    const listed = await source.listSignals();
    expect(listed.length).toBe(8);
    expect(listed.map((s) => `${s.dataRef}/${s.name}`).sort()).toEqual(
      FIXTURE_SIGNALS.map((s) => `${s.dataRef}/${s.name}`),
    );
    const points = await source.raw(
      { dataRef: "conf-a", name: "Lin.RAMP", sna: [] },
      B + S,
      B + 2n * S,
    );
    expect(points.length).toBe(100);
    expect(points[0]).toEqual({ t: B + S, v: 100 });
    expect(points[99]).toEqual({ t: B + S + 990_000_000n, v: 199 });
  });

  it("fails on a truncated answer", async () => {
    // The emulator cuts the answer at 500,000 rows and reports LimitsExceeded in the completion frame.
    await expect(client().query("range i from 1 to 600000 step 1", {})).rejects.toThrow(
      /LimitsExceeded/,
    );
  });

  it("treats a missing events table and text column as none", async () => {
    const noEvents = adapter(adxMapping, { ...adxEventMapping, table: "nope" });
    expect(await noEvents.events("conf-a", 100)).toBeUndefined();
    const noText = adapter({ ...adxMapping, text: "nope" });
    const listed = await noText.listSignals();
    expect(listed.length).toBe(8);
    expect(listed.every((s) => s.text !== true)).toBe(true);
    // Any other error fails: a missing signals table is no "none".
    await expect(adapter({ ...adxMapping, table: "nope" }).listSignals()).rejects.toThrow(/nope/);
  });

  it("cancels a query on abort", async () => {
    // A cancelled query still unwinding from an earlier run slows the next one down: start idle.
    for (let attempt = 0; attempt < 120; attempt++) {
      const busy = await adxMgmt(`.show queries | where State == "InProgress" | count`);
      if (Number(busy[0]?.[0]) <= 1) break; // this very command is the one in progress
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const id = `KIPscope.test;${randomUUID()}`;
    const withId: typeof fetch = (input, init) =>
      fetch(input, {
        ...init,
        headers: { ...(init?.headers as Record<string, string>), "x-ms-client-request-id": id },
      });
    const slow = new KustoClient({
      cluster: testAdxUrl(),
      database: TEST_ADX_DATABASE,
      timeoutSeconds: 60,
      fetch: withId,
    });
    const reason = new Error("aborted by the test");
    const controller = new AbortController();
    const outcome = slow
      .query("range i from 1 to 3000000000 step 1 | summarize sum(i % 7)", {}, controller.signal)
      .then(
        () => "resolved" as unknown,
        (error: unknown) => error,
      );
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const abortedAt = performance.now();
    controller.abort(reason);
    expect(await outcome).toBe(reason);
    expect(performance.now() - abortedAt).toBeLessThan(100);

    // The emulator lists the cancelled query once it has stopped it; under load that can take a while.
    let state = "";
    let duration = "";
    for (let attempt = 0; attempt < 120 && state === ""; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const rows = await adxMgmt(
        `.show queries | where ClientActivityId == "${id}" | project State, Duration`,
      );
      [state, duration] = (rows[0] ?? ["", ""]) as [string, string];
    }
    expect(state).toBe("Cancelled");
    const [h, m, s] = duration.split(":").map(Number) as [number, number, number];
    expect(h * 3600 + m * 60 + s).toBeLessThan(2);
  }, 150_000);

  it("reports the ADX source in meta", async () => {
    const source = completeSource(adapter());
    const app = buildApp({
      catalog: new Catalog(source, async () => new Map()),
      source,
      workspace: new WorkspaceStore({ signalExists: () => true, hasStates: () => false }),
      meta: {
        build: { commit: "7c1e2a9", dirty: false, startedAt: new Date("2026-10-17T10:00:00Z") },
        source: source.info,
        ping: (signal) => source.ping(signal),
      },
    });
    try {
      const res = await app.inject({ url: "/api/meta" });
      expect(res.statusCode).toBe(200);
      expect(res.json().source).toMatchObject({
        kind: "adx",
        database: "kipscope_test",
        table: "signals",
        reachable: true,
      });
      expect(res.body).not.toContain(testAdxUrl());
      expect(res.body).not.toContain("127.0.0.1");
      expect(res.body).not.toContain("8125");
    } finally {
      await app.close();
    }
  });

  it("answers series requests as the fallback does", async () => {
    // The seven requests (a)-(g) of data-source "Series natively and from the core", through
    // querySeries over the native adapter and over the adapter reduced to its required methods.
    const native = completeSource(adapter());
    const core = completeSource(coreOnly(adapter()));
    const SC2 = { dataRef: "conf-a", from: B + 5n * S, to: B + 35n * S };
    const ref = (name: string, sna: { lo: number; hi: number }[] = [], text?: boolean) =>
      text === undefined
        ? { dataRef: "conf-a", name, sna }
        : { dataRef: "conf-a", name, sna, text };
    const requests = [
      { id: "a", kind: "raw", ref: ref("Lin.RAMP"), from: B + S, to: B + 2n * S, target: 100 },
      { id: "b", kind: "buckets", ref: ref("Lin.RAMP"), from: B + S, to: B + 2n * S, target: 99 },
      { id: "c", kind: "buckets", ref: ref("Lin.RAMP"), from: B, to: B + 100n * S, target: 11 },
      {
        id: "d",
        kind: "raw",
        ref: ref("Sna.CODE", [{ lo: 6.5, hi: 7.5 }]),
        from: B + 40n * S,
        to: B + 50n * S,
        target: 20,
      },
      {
        id: "e",
        kind: "raw",
        ref: ref("Diag.door", [], true),
        from: B + 100n * S,
        to: B + 200n * S,
        target: 10,
      },
      {
        id: "f",
        kind: "raw",
        ref: ref("Lin.RAMP"),
        from: B + 5n * S,
        to: B + 6n * S,
        target: 100,
        scope: SC2,
      },
      { id: "g", kind: "raw", ref: ref("Nope.X"), from: B, to: B + 100n * S, target: 100 },
    ] as const;
    for (const r of requests) {
      const run = (source: typeof native) =>
        querySeries(
          source,
          r.ref,
          `${r.ref.dataRef}/${r.ref.name}`,
          r.from,
          r.to,
          r.target,
          "scope" in r ? r.scope : undefined,
        );
      const [fast, slow] = await Promise.all([run(native), run(core)]);
      expect(fast.kind, r.id).toBe(r.kind);
      expect(JSON.stringify(fast), r.id).toBe(JSON.stringify(slow));
    }
  });

  it("implements the measured fast paths only", () => {
    const source: SourceAdapter = adapter();
    expect(nativeMethods(source).sort()).toEqual(
      ["events", "extent", "loggerGaps", "refCount", "series", "stateChanges"].sort(),
    );
    for (const name of [
      "ping",
      "listSignals",
      "raw",
      "before",
      "after",
      "buckets",
      "refBuckets",
      "extent",
      "series",
      "refCount",
      "loggerGaps",
      "stateChanges",
      "events",
    ] as const) {
      expect(typeof source[name], name).toBe("function");
    }
    for (const name of ["count", "refExtent", "firstTimes"] as const) {
      expect(source[name], name).toBeUndefined();
    }
    expect(source.info).toEqual({
      kind: "adx",
      database: "kipscope_test",
      table: "signals",
      eventsTable: "kipscope_test.events",
    });
  });
});

/** Row metadata table `KMeta` of add-adx-row-metadata R7 (seed-adx.ts): units and SNA texts. */
describe("ADX row metadata on the emulator (add-adx-row-metadata)", () => {
  const meta = (extra: Partial<TableMapping> = {}) =>
    adapter({ ...adxMapping, table: "KMeta", ...extra }, adxEventMapping);
  const withBoth = { unit: "unit", snaTexts: ["SNA", "INVLD"] };
  const ref = (dataRef: string, name: string, text?: boolean): SeriesRef =>
    text === undefined ? { dataRef, name, sna: [] } : { dataRef, name, sna: [], text };
  const spd = ref("meta-a", "Spd.V");
  const gear = ref("meta-a", "Gear.POS", true);
  const line = (s: { dataRef: string; name: string; unit?: string; text?: boolean }) =>
    `${s.dataRef}/${s.name}|${s.unit ?? "-"}|${s.text === true ? "text" : "-"}`;

  it("reads units from the table per data ref", async () => {
    const source = meta(withBoth);
    expect((await source.listSignals()).map(line)).toEqual([
      "meta-a/Flag.ERR|-|-",
      "meta-a/Gear.POS|-|text",
      "meta-a/Spd.V|km/h|-",
      "meta-b/Spd.V|mph|-",
    ]);
    // In [B + 5 s, B + 10 s) only Spd.V n = 5 … 9 lies, whose unit rows (n <= 4) are outside.
    const scope: Scope = { dataRef: "meta-a", from: B + 5n * S, to: B + 10n * S };
    const scoped = await source.listSignals(scope);
    expect(scoped.map(line)).toEqual(["meta-a/Spd.V|-|-"]);
    expect(scoped[0]).not.toHaveProperty("unit");
    // A unit column that does not exist fails the list, naming it.
    await expect(meta({ unit: "nope" }).listSignals()).rejects.toThrow(/nope/);
  });

  it("treats SNA texts as SNA in every value query", async () => {
    const source = meta(withBoth);
    const at = (n: number) => B + BigInt(n) * S;
    const ten = [0, 10, 20, null, null, 50, 60, null, 80, 90];

    const plain = await source.raw(spd, B, at(10));
    expect(plain.map((p) => p.v)).toEqual(ten);
    expect(plain.map((p) => p.t)).toEqual(Array.from({ length: 10 }, (_, n) => at(n)));
    // Together with a DBC range: n = 8 (value 80) is SNA too.
    const ranged = await source.raw({ ...spd, sna: [{ lo: 79.5, hi: 80.5 }] }, B, at(10));
    expect(ranged.map((p) => p.v)).toEqual([0, 10, 20, null, null, 50, 60, null, null, 90]);

    expect(await source.buckets(spd, B, at(10), 5n * S)).toEqual([
      { start: B, count: 3, sna: 2, mean: 10, min: 0, max: 20 },
      { start: at(5), count: 4, sna: 1, mean: 70, min: 50, max: 90 },
    ]);
    // The edge neighbours are SNA rows too, returned as null values.
    expect(await source.before(spd, B + 4_500_000_000n)).toEqual({ t: at(4), v: null });
    expect(await source.after(spd, B + 6_500_000_000n)).toEqual({ t: at(7), v: null });

    // State changes leave the SNA row (B + 20 s) out: P, D, R.
    const t = (ns: bigint) => ns.toString();
    expect(await source.stateChanges(gear, { kind: "text" }, 100)).toEqual([
      { t: t(B), value: 0, text: "P" },
      { t: t(at(10)), value: 1, text: "D", prev: { t: t(B), value: 0, text: "P" } },
      { t: t(at(30)), value: 3, text: "R", prev: { t: t(at(10)), value: 1, text: "D" } },
    ]);

    // No state name on a sentinel row (state-names): the SNA point has a null value and no label.
    const points = await source.raw(gear, B, at(40));
    expect(points.map((p) => p.t)).toEqual([B, at(10), at(20), at(30)]);
    expect(points.map((p) => p.v)).toEqual([0, 1, null, 3]);
    expect(points.map(textLabel)).toEqual(["P", "D", undefined, "R"]);

    // Without the list the sentinels are plain values.
    const without = await meta({ unit: "unit" }).raw(spd, B, at(10));
    expect(without.map((p) => p.v)).toEqual([0, 10, 20, 255, 255, 50, 60, 254, 80, 90]);
  });

  it("answers KMeta series requests as the fallback does", async () => {
    const native = completeSource(meta(withBoth));
    const core = completeSource(coreOnly(meta(withBoth)));
    const run = (source: typeof native, ref: SeriesRef, target: number) =>
      querySeries(source, ref, `${ref.dataRef}/${ref.name}`, B, B + 10n * S, target);
    for (const [label, signal, target] of [
      ["raw", spd, 100],
      ["buckets", spd, 4],
      ["raw text", gear, 100],
    ] as const) {
      const [fast, slow] = await Promise.all([
        run(native, signal, target),
        run(core, signal, target),
      ]);
      expect(JSON.stringify(fast), label).toBe(JSON.stringify(slow));
    }
    const raw = (await run(native, spd, 100)) as RawSeries;
    expect(raw.kind).toBe("raw");
    expect(raw.v).toEqual([0, 10, 20, null, null, 50, 60, null, 80, 90]);
    const buckets = (await run(native, spd, 4)) as BucketSeries;
    expect(buckets.kind).toBe("buckets");
    expect(buckets.sna.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("treats a missing text column with row metadata", async () => {
    await expect(meta({ text: "nope", snaTexts: ["SNA"] }).listSignals()).rejects.toThrow(
      "KIPSCOPE_SNA_TEXTS needs the text column 'nope' (KIPSCOPE_COLUMN_TEXT), which does not exist",
    );
    const listed = await meta({ text: "nope", unit: "unit" }).listSignals();
    expect(listed.map(line)).toEqual([
      "meta-a/Flag.ERR|-|-",
      "meta-a/Gear.POS|-|-",
      "meta-a/Spd.V|km/h|-",
      "meta-b/Spd.V|mph|-",
    ]);
    expect(listed.every((x) => !("text" in x))).toBe(true);
  });

  it("builds the catalog from the table's units and sentinels", async () => {
    const load = async (extra: Partial<TableMapping>) => {
      const catalog = new Catalog(completeSource(meta(extra)), async () => new Map());
      await catalog.refresh();
      return catalog;
    };
    const withList = await load(withBoth);
    expect(withList.get("meta-a/Gear.POS")?.states).toBe("text");
    expect(withList.get("meta-a/Flag.ERR")).not.toHaveProperty("states");
    expect(withList.get("meta-a/Spd.V")).not.toHaveProperty("states");
    expect(withList.get("meta-a/Spd.V")?.unit).toBe("km/h");
    expect(withList.get("meta-b/Spd.V")?.unit).toBe("mph");
    expect(withList.get("meta-a/Flag.ERR")).not.toHaveProperty("unit");
    expect(withList.get("meta-a/Gear.POS")).not.toHaveProperty("unit");

    const withoutList = await load({ unit: "unit" });
    for (const id of ["meta-a/Flag.ERR", "meta-a/Gear.POS", "meta-a/Spd.V"])
      expect(withoutList.get(id)?.states, id).toBe("text");
    expect(withoutList.get("meta-b/Spd.V")).not.toHaveProperty("states");
  });
});

describe("ADX queries with a scope (add-scope Z3)", () => {
  /** A client that records each query text and its parameters and answers no rows. */
  function recordingAdapter() {
    const sent: { csl: string; params: Record<string, { type: string; value: unknown }> }[] = [];
    const fake = {
      query: async (csl: string, params: Record<string, { type: string; value: unknown }>) => {
        sent.push({ csl, params });
        // `series` needs its count row (design A3): 0 points, so the raw path with no rows.
        return /toscalar\(/.test(csl) ? [["n", null, null, null, 0, null, null, null]] : [];
      },
      ping: async () => {},
    };
    return { source: new AdxSource(fake as never, adxMapping, adxEventMapping), sent };
  }

  it("scopes every query by data ref and time", async () => {
    const { source, sent } = recordingAdapter();
    // The adapter's own methods, `extent` and `series` among them: refExtent and firstTimes are the
    // server's fallbacks (scoped by "passes the scope to every core call"), so the adapter sends
    // nothing for them.
    const fallbacks = ["refExtent", "firstTimes"];
    let covered = 0;
    for (const [method, call] of Object.entries(SCOPED_CALLS)) {
      const before = sent.length;
      await call(source, SCOPE_S2);
      if (fallbacks.includes(method)) {
        expect(sent.length, `${method} is no native method`).toBe(before);
        continue;
      }
      covered++;
      expect(sent.length, `${method} sent a query`).toBeGreaterThan(before);
      for (const { csl, params } of sent.slice(before)) {
        const text = csl.replace(/\s+/g, " ");
        // Both filters are the first operator on the table (signals or events), as parameters, at
        // every reference to the table (`series` reads it in several branches).
        const references = text.match(/(signals|events)'\]/g) ?? [];
        expect(references.length, `${method} reads the table: ${text}`).toBeGreaterThan(0);
        const filtered =
          text.match(
            /(signals|events)'\] \| where \['dataref'\] == sref and \['timestamp'\] >= sfrom and \['timestamp'\] < sto\b/g,
          ) ?? [];
        expect(filtered.length, `${method}: ${text}`).toBe(references.length);
        expect(params.sref, method).toEqual({ type: "string", value: "conf-a" });
        expect(params.sfrom, method).toEqual({ type: "datetime", value: B + 5n * S });
        expect(params.sto, method).toEqual({ type: "datetime", value: B + 35n * S });
        // No other operator sits between the table and the filter.
        const first = text.search(/(signals|events)'\]/);
        expect(text.slice(first), method).toMatch(
          /^(signals|events)'\] \| where \['dataref'\] == sref/,
        );
      }
    }
    expect(covered).toBe(Object.keys(SCOPED_CALLS).length - fallbacks.length);
  });

  it("leaves unscoped queries without the scope parameters", async () => {
    const { source, sent } = recordingAdapter();
    for (const call of Object.values(SCOPED_CALLS)) await call(source, undefined);
    expect(sent.length).toBeGreaterThan(0);
    for (const { csl, params } of sent) {
      expect(csl).not.toMatch(/\b(sref|sfrom|sto)\b/);
      expect(Object.keys(params)).not.toContain("sref");
    }
  });
});
