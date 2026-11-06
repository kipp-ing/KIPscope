/**
 * The router over several ADX databases (add-adx-databases D1, D2, D4): fake Kusto clients, no
 * emulator, so `pnpm test` runs it. A fake client records every `query(csl, params)` with the
 * database it belongs to and answers by the shape of the query. Expected values are written by
 * hand from the spec scenarios, never taken from the code under test.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFormula } from "@kipscope/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdxSource } from "../src/adx.ts";
import { MultiDatabaseSource, qualifyDataRef, splitDataRef } from "../src/adxRouter.ts";
import { Catalog } from "../src/catalog.ts";
import { loadConfig } from "../src/config.ts";
import type { ComputedRef, Scope, SeriesRef, SourceAdapter } from "../src/datasource.ts";
import { completeSource } from "../src/fallbacks.ts";
import { KustoError, type KustoParam } from "../src/kusto.ts";
import { QueryQueue, queuedAdapter } from "../src/queue.ts";
import { createAdapter } from "../src/sources.ts";
import { adxEventMapping, adxMapping } from "./adxdb.ts";
import { B } from "./conformance/fixture.ts";
import { type Answer, scopeApp } from "./scopeApp.ts";

// One azCliToken call per cluster (task 2.3): the factory counts the clusters it was built for.
const { tokenCalls } = vi.hoisted(() => ({ tokenCalls: [] as string[] }));
vi.mock("../src/azcli.ts", () => ({
  azCliToken: (cluster: string) => {
    tokenCalls.push(cluster);
    return async () => "tok";
  },
}));

const S = 1_000_000_000n;

type Sent = { database: string; csl: string; params: Record<string, KustoParam> };

/** The string value of a query parameter, undefined when absent or not a string. */
const text = (sent: Sent, name: string) => {
  const p = sent.params[name];
  return p?.type === "string" ? p.value : undefined;
};

/** What a database holds for the fake: data ref → signal names. */
type Holdings = Record<string, string[]>;

/** The rows a fake database answers for `csl`: the shape of the query decides, the holdings fill it. */
function answer(csl: string, params: Record<string, KustoParam>, holdings: Holdings): unknown[][] {
  // listSignals: [dataRef, name, hasText]; a scope narrows it to its data ref (param `sref`).
  if (csl.includes("n_ = countif(isnotempty")) {
    const scoped = params.sref?.type === "string" ? params.sref.value : undefined;
    return Object.entries(holdings)
      .filter(([ref]) => scoped === undefined || ref === scoped)
      .flatMap(([ref, names]) => names.map((name) => [ref, name, false]));
  }
  // series: the count row alone (zero rows), so the answer is a raw series without points.
  if (csl.includes("let src_")) return [["n", "", null, "", 0, null, null, null]];
  // computedSeries: k_, t_, v_, c_, m_, lo_, hi_ with the count row alone.
  if (csl.includes("let in_")) return [["n", "", null, 0, null, null, null]];
  return [];
}

interface FakeOptions {
  holdings?: Holdings;
  /** Every query and the ping fail with this message. */
  failWith?: string;
  /** Shared in-flight gauge: each query holds a slot for `holdMs`. */
  gauge?: { inFlight: number; peak: number; total: number };
  holdMs?: number;
}

/** A Kusto client of `database` that records its queries into `sent` (shared or own). */
function fakeClient(database: string, sent: Sent[], options: FakeOptions = {}) {
  return {
    async query(csl: string, params: Record<string, KustoParam>) {
      sent.push({ database, csl, params });
      if (options.failWith) throw new KustoError(options.failWith);
      const { gauge } = options;
      if (gauge) {
        gauge.inFlight++;
        gauge.total++;
        gauge.peak = Math.max(gauge.peak, gauge.inFlight);
        await new Promise((resolve) => setTimeout(resolve, options.holdMs ?? 10));
        gauge.inFlight--;
      }
      return answer(csl, params, options.holdings ?? {});
    },
    async ping() {
      if (options.failWith) throw new KustoError(options.failWith);
    },
  };
}

/** An `AdxSource` of `database` over a fake client. */
function fakeSource(database: string, sent: Sent[], options: FakeOptions = {}) {
  return new AdxSource(
    fakeClient(database, sent, options) as never,
    { ...adxMapping, database },
    adxEventMapping,
  );
}

/** A router over fake databases, in the given order; `sent` collects every query. */
function routerOf(
  databases: Record<string, FakeOptions>,
  sent: Sent[] = [],
): { router: MultiDatabaseSource; sent: Sent[] } {
  const sources = new Map<string, AdxSource>();
  for (const [name, options] of Object.entries(databases))
    sources.set(name, fakeSource(name, sent, options));
  return { router: new MultiDatabaseSource(sources), sent };
}

const ref = (dataRef: string, name: string): SeriesRef => ({ dataRef, name, sna: [] });
const ids = (list: { dataRef: string; name: string }[]) =>
  list.map((s) => `${s.dataRef}/${s.name}`);

/** The rejection of a call, whether it throws at once or returns a rejected promise. */
async function rejection(call: () => unknown): Promise<Error & { code?: string }> {
  try {
    await call();
  } catch (error) {
    return error as Error & { code?: string };
  }
  throw new Error("expected the call to fail");
}

/** An optional method that must exist. */
function must<T>(method: T | undefined): T {
  if (method === undefined) throw new Error("the optional method is missing");
  return method;
}

describe("splitDataRef and qualifyDataRef", () => {
  const dbs = ["prod", "test"];

  it("splits at the first colon only", () => {
    expect(splitDataRef("prod:car1", dbs)).toEqual({ database: "prod", ref: "car1" });
    // 4.3: a ref with its own `:` keeps it.
    expect(splitDataRef("prod:a:b", dbs)).toEqual({ database: "prod", ref: "a:b" });
    expect(splitDataRef("test:", dbs)).toEqual({ database: "test", ref: "" });
    expect(qualifyDataRef("prod", "a:b")).toBe("prod:a:b");
    // The round trip of a ref with a colon.
    expect(splitDataRef(qualifyDataRef("test", "x:y:z"), dbs)).toEqual({
      database: "test",
      ref: "x:y:z",
    });
  });

  it("refuses a bare ref and an unknown database with unknown_database", () => {
    for (const bad of ["car1", "dev:car1", ":car1", "Prod:car1", "prod :car1"]) {
      let caught: (Error & { code?: string; statusCode?: number }) | undefined;
      try {
        splitDataRef(bad, dbs);
      } catch (error) {
        caught = error as typeof caught;
      }
      expect(caught, bad).toBeDefined();
      expect(caught?.code, bad).toBe("unknown_database");
      expect(caught?.statusCode, bad).toBe(400);
      // The message names the form and every configured database.
      expect(caught?.message, bad).toContain("<database>:<ref>");
      expect(caught?.message, bad).toContain("prod, test");
    }
  });

  it("handles a database name with a dot and a space", () => {
    // 4.3: KUSTO_ENTITY allows `.`, `-` and spaces, never `:`.
    const odd = ["my.db 1", "test-2"];
    expect(splitDataRef("my.db 1:car1", odd)).toEqual({ database: "my.db 1", ref: "car1" });
    expect(splitDataRef("test-2:a:b", odd)).toEqual({ database: "test-2", ref: "a:b" });
    expect(qualifyDataRef("my.db 1", "car1")).toBe("my.db 1:car1");
    expect(() => splitDataRef("my.db:car1", odd)).toThrow(/<database>:<ref>/);
  });
});

describe("MultiDatabaseSource", () => {
  it("qualifies data refs by database", async () => {
    const { router, sent } = routerOf({
      prod: { holdings: { car1: ["A", "B"], car2: ["C"] } },
      test: { holdings: { car1: ["A"], car3: ["D"] } },
    });

    // Unscoped: every database, IDs `<database>:<ref>/<name>`, databases in configuration order.
    expect(ids(await router.listSignals())).toEqual([
      "prod:car1/A",
      "prod:car1/B",
      "prod:car2/C",
      "test:car1/A",
      "test:car3/D",
    ]);

    // Scoped to `test:car1`: only its signals, and only `test` is asked, with the bare ref.
    sent.length = 0;
    const scope: Scope = { dataRef: "test:car1", from: B, to: B + 10n * S };
    expect(ids(await router.listSignals(scope))).toEqual(["test:car1/A"]);
    expect(sent.map((s) => s.database)).toEqual(["test"]);
    expect(text(sent[0] as Sent, "sref")).toBe("car1");

    // A bare ref and an unknown database fail with unknown_database; neither asks a database.
    sent.length = 0;
    const bare = await rejection(() => router.listSignals({ ...scope, dataRef: "car1" }));
    expect(bare.code).toBe("unknown_database");
    expect(bare.message).toContain("prod:car1");
    const unknown = await rejection(() => router.listSignals({ ...scope, dataRef: "dev:car1" }));
    expect(unknown.code).toBe("unknown_database");
    expect(unknown.message).toContain("prod, test");
    expect(sent).toEqual([]);
  });

  it("sends each call to the database of its data ref", async () => {
    const { router, sent } = routerOf({ prod: {}, test: {} });
    const to = B + 10n * S;

    await router.raw(ref("test:car1", "X"), B, to);
    await must(router.series)(ref("prod:car2", "Y"), B, to, 100, S);
    await must(router.events)("test:car1", 100, { dataRef: "test:car1", from: B, to });

    const of = (database: string) => sent.filter((s) => s.database === database);
    // The `test` client got the raw query and the events query, with the bare ref in `ref`
    // (the raw query) and in `ref` and `sref` (the scoped events query).
    expect(of("test")).toHaveLength(2);
    const [raw, events] = of("test") as [Sent, Sent];
    expect(raw.csl).toContain("['signals']");
    expect(text(raw, "ref")).toBe("car1");
    expect(events.csl).toContain("['events']");
    expect(text(events, "ref")).toBe("car1");
    expect(text(events, "sref")).toBe("car1");
    // The `prod` client got the series query alone, with `car2`.
    expect(of("prod")).toHaveLength(1);
    const series = of("prod")[0] as Sent;
    expect(series.csl).toContain("let src_");
    expect(text(series, "ref")).toBe("car2");
    // No query carries a qualifier: a qualified ref in a query would find no rows.
    for (const s of sent)
      for (const name of ["ref", "sref"]) expect(text(s, name)?.includes(":") ?? false).toBe(false);
  });

  it("routes every method by the data ref of its scope or parameter", async () => {
    const { router, sent } = routerOf({ prod: {}, test: {} });
    const to = B + 10n * S;
    const scope = (dataRef: string): Scope => ({ dataRef, from: B, to });
    const calls: [string, () => unknown][] = [
      ["before", () => router.before(ref("test:car1", "X"), B, scope("test:car1"))],
      ["after", () => router.after(ref("test:car1", "X"), B, scope("test:car1"))],
      ["buckets", () => router.buckets(ref("test:car1", "X"), B, to, S)],
      ["refBuckets", () => router.refBuckets("test:car1", S, false, scope("test:car1"))],
      ["extent", () => must(router.extent)(ref("test:car1", "X"), scope("test:car1"))],
      ["refCount", () => must(router.refCount)("test:car1", scope("test:car1"))],
      ["loggerGaps", () => must(router.loggerGaps)("test:car1", S, 10n * S, scope("test:car1"))],
      [
        "stateChanges",
        () =>
          must(router.stateChanges)(
            ref("test:car1", "X"),
            { kind: "text" },
            10,
            scope("test:car1"),
          ),
      ],
    ];
    // The methods AdxSource has no native version of come from the fallbacks over the routed ones.
    const complete = completeSource(router);
    calls.push(
      ["count (fallback)", () => complete.count(ref("test:car1", "X"), B, to)],
      ["refExtent (fallback)", () => complete.refExtent("test:car1", scope("test:car1"))],
      [
        "firstTimes (fallback)",
        () => complete.firstTimes("test:car1", ["X"], 3, scope("test:car1")),
      ],
    );
    for (const [name, call] of calls) {
      sent.length = 0;
      try {
        await call();
      } catch {
        // The fake answers no rows; a method may reject an empty answer, the routing is what counts.
      }
      expect(sent.length, `${name} sent a query`).toBeGreaterThan(0);
      expect(
        sent.every((s) => s.database === "test" && text(s, "ref") === "car1"),
        `${name} went to test with the bare ref`,
      ).toBe(true);
    }
  });

  it("does not qualify with one database", async () => {
    // Through loadConfig and createAdapter, with the cluster's HTTP answered by a fake fetch.
    const bodies: { db: string; params: Record<string, string> }[] = [];
    const rows = (csl: string) =>
      csl.includes("n_ = countif(isnotempty") ? [["car1", "A", false]] : [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      bodies.push({ db: body.db, params: body.properties.Parameters });
      const frames = [
        { FrameType: "DataTable", TableKind: "PrimaryResult", Rows: rows(body.csl) },
        { FrameType: "DataSetCompletion", HasErrors: false },
      ];
      return new Response(JSON.stringify(frames), { status: 200 });
    });
    const common = {
      KIPSCOPE_SOURCE: "adx",
      KIPSCOPE_ADX_CLUSTER: "http://127.0.0.1:8125",
      KIPSCOPE_ADX_AUTH: "none",
    };
    for (const one of [{ KIPSCOPE_ADX_DATABASE: "prod" }, { KIPSCOPE_ADX_DATABASES: "prod" }]) {
      bodies.length = 0;
      const adapter = createAdapter(loadConfig({ ...common, ...one }, "/repo/kipscope"));
      // No router for one database: the bare adapter, refs stay bare.
      expect(adapter).toBeInstanceOf(AdxSource);
      expect(adapter).not.toBeInstanceOf(MultiDatabaseSource);
      expect(ids(await adapter.listSignals())).toEqual(["car1/A"]);
      await adapter.raw(ref("car1", "A"), B, B + S);
      expect(bodies.at(-1)).toMatchObject({ db: "prod", params: { ref: "car1" } });
      // A qualified ref is a data ref like any other: asked for as written, found nowhere.
      expect(await adapter.raw(ref("prod:car1", "A"), B, B + S)).toEqual([]);
      expect(bodies.at(-1)?.params.ref).toBe("prod:car1");
    }
  });

  it("builds one client per database and one token provider per cluster", async () => {
    tokenCalls.length = 0;
    const seen: { db: string; authorization: string | undefined }[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      const headers = init.headers as Record<string, string>;
      seen.push({ db: body.db, authorization: headers.Authorization });
      const frames = [
        { FrameType: "DataTable", TableKind: "PrimaryResult", Rows: [] },
        { FrameType: "DataSetCompletion", HasErrors: false },
      ];
      return new Response(JSON.stringify(frames), { status: 200 });
    });
    const cluster = "https://help.kusto.windows.net";
    const env = {
      KIPSCOPE_SOURCE: "adx",
      KIPSCOPE_ADX_CLUSTER: cluster,
      KIPSCOPE_ADX_DATABASES: "prod,test,dev",
    };
    const adapter = createAdapter(loadConfig(env, "/repo/kipscope"));
    expect(adapter).toBeInstanceOf(MultiDatabaseSource);
    await adapter.listSignals();
    // Three databases, one token provider, so one cached token and one running `az` request.
    expect(tokenCalls).toEqual([cluster]);
    expect(seen.map((s) => s.db).sort()).toEqual(["dev", "prod", "test"]);
    expect(seen.every((s) => s.authorization === "Bearer tok")).toBe(true);

    // One database: still one call.
    tokenCalls.length = 0;
    createAdapter(loadConfig({ ...env, KIPSCOPE_ADX_DATABASES: "prod" }, "/repo/kipscope"));
    expect(tokenCalls).toEqual([cluster]);
  });

  it("merges unscoped lists", async () => {
    const { router } = routerOf({
      prod: { holdings: { car1: ["A", "B"] } },
      test: { holdings: { car1: ["A"] } },
    });
    // Through the catalog: the metadata of a signal is keyed by its bare name, so both `A` get it.
    const catalog = new Catalog(
      completeSource(router),
      async () =>
        new Map([["A", { file: "x.dbc", message: "M", messageId: 1, unit: "mA" }]]) as never,
    );
    await catalog.refresh();
    expect(catalog.all().map((s) => s.id)).toEqual(["prod:car1/A", "test:car1/A", "prod:car1/B"]);
    expect(catalog.get("prod:car1/A")).toMatchObject({
      name: "A",
      dataRef: "prod:car1",
      unit: "mA",
    });
    expect(catalog.get("test:car1/A")).toMatchObject({
      name: "A",
      dataRef: "test:car1",
      unit: "mA",
    });
    expect(catalog.get("prod:car1/B")?.unit).toBeUndefined();
    // The bare form is no entry.
    expect(catalog.get("car1/A")).toBeUndefined();
  });

  it("a failing database fails only its calls", async () => {
    const { router, sent } = routerOf({
      prod: { holdings: { car2: ["C"] } },
      test: { failWith: "boom: connection reset" },
    });
    // The unscoped list fails as a whole, and its message names the database.
    const failure = await rejection(() => router.listSignals());
    expect(failure.message).toContain("test");
    expect(failure.message).toContain("boom: connection reset");

    // A scope of the healthy database succeeds and sends nothing to the failing one.
    sent.length = 0;
    const scope: Scope = { dataRef: "prod:car2", from: B, to: B + S };
    expect(ids(await router.listSignals(scope))).toEqual(["prod:car2/C"]);
    expect(sent.map((s) => s.database)).toEqual(["prod"]);
    // A call of the failing database fails, and names it.
    const raw = await rejection(() => router.raw(ref("test:car1", "A"), B, B + S));
    expect(raw.message).toContain("boom: connection reset");
  });

  it("pings every database and names the first that fails", async () => {
    const ok = routerOf({ prod: {}, test: {} });
    await expect(ok.router.ping(new AbortController().signal)).resolves.toBeUndefined();
    expect(ok.router.info).toMatchObject({ database: "prod, test", databases: ["prod", "test"] });

    const down = routerOf({ prod: {}, test: { failWith: "unreachable" } });
    const failure = await rejection(() => down.router.ping(new AbortController().signal));
    expect(failure.message).toContain("test");
    expect(failure.message).toContain("unreachable");

    // Both down: the first in configuration order.
    const both = routerOf({ prod: { failWith: "p down" }, test: { failWith: "t down" } });
    const first = await rejection(() => both.router.ping(new AbortController().signal));
    expect(first.message).toContain("prod");
    expect(first.message).not.toContain("t down");
  });

  it("lists the databases in its info", () => {
    const { router } = routerOf({ prod: {}, test: {}, dev: {} });
    expect(router.info.databases).toEqual(["prod", "test", "dev"]);
    expect(router.info.database).toBe("prod, test, dev");
    expect(router.info.kind).toBe("adx");
    // Table and events table are those of the first database.
    expect(router.info.table).toBe("signals");
    expect(router.info.eventsTable).toBe("prod.events");
  });

  it("offers an optional method only when every database has it", () => {
    const sent: Sent[] = [];
    const lacking = fakeSource("test", sent);
    (lacking as { events?: unknown }).events = undefined;
    const router = new MultiDatabaseSource(
      new Map([
        ["prod", fakeSource("prod", sent)],
        ["test", lacking],
      ]),
    );
    expect(router.events).toBeUndefined();
    expect(typeof router.series).toBe("function");
    expect(typeof routerOf({ prod: {}, test: {} }).router.events).toBe("function");
  });

  describe("edge cases (4.3)", () => {
    it("routes a ref with its own colon", async () => {
      const { router, sent } = routerOf({
        prod: { holdings: { "a:b": ["A"] } },
        test: {},
      });
      // The list qualifies it, the qualified form routes back to the bare `a:b`.
      expect(ids(await router.listSignals())).toEqual(["prod:a:b/A"]);
      sent.length = 0;
      await router.raw(ref("prod:a:b", "A"), B, B + S);
      expect(sent.map((s) => [s.database, text(s, "ref")])).toEqual([["prod", "a:b"]]);
    });

    it("routes a database name with a dot and a space", async () => {
      const { router, sent } = routerOf({
        "my.db 1": { holdings: { car1: ["A"] } },
        "test-2": {},
      });
      expect(router.info.database).toBe("my.db 1, test-2");
      expect(ids(await router.listSignals())).toEqual(["my.db 1:car1/A"]);
      sent.length = 0;
      await router.raw(ref("my.db 1:car1", "A"), B, B + S);
      expect(sent.map((s) => [s.database, text(s, "ref")])).toEqual([["my.db 1", "car1"]]);
    });

    it("computes a signal across one database", async () => {
      const calls: string[] = [];
      const sent: Sent[] = [];
      // Two inputs rows at B and B + 1 s: computed values 3 and 4 (the fake's `p` rows).
      const prod = {
        ...fakeClient("prod", sent),
        async query(csl: string, params: Record<string, KustoParam>) {
          sent.push({ database: "prod", csl, params });
          return [
            ["n", "", null, 2, null, null, null],
            ["p", (B + S).toString(), 4, null, null, null, null],
            ["p", B.toString(), 3, null, null, null, null],
          ];
        },
      };
      const sources = new Map([
        [
          "prod",
          new AdxSource(prod as never, { ...adxMapping, database: "prod" }, adxEventMapping),
        ],
        ["test", fakeSource("test", sent)],
      ]);
      const router = new MultiDatabaseSource(sources);
      router.useQueue((task, abort) => {
        calls.push("run");
        return task(abort);
      });
      const parsed = parseFormula("A + B");
      if (!parsed.ok) throw new Error(parsed.message);
      const computed: ComputedRef = {
        dataRef: "prod:car1",
        ast: parsed.ast,
        inputs: [ref("prod:car1", "A"), ref("prod:car1", "B")],
      };
      const answerRows = await must(router.computedSeries)(computed, B, B + 10n * S, 100, S);
      expect(answerRows).toEqual({
        kind: "raw",
        points: [
          { t: B, v: 3 },
          { t: B + S, v: 4 },
        ],
      });
      // One query, to `prod`, with the bare ref and the bare input names; it took a queue slot.
      expect(sent.map((s) => s.database)).toEqual(["prod"]);
      expect(text(sent[0] as Sent, "ref")).toBe("car1");
      expect([text(sent[0] as Sent, "s0"), text(sent[0] as Sent, "s1")]).toEqual(["A", "B"]);
      expect(calls).toEqual(["run"]);
    });

    it("reads the events of one database only", async () => {
      const sent: Sent[] = [];
      const eventRow = [(B + 5n * S).toString(), "BMS", "dtc", "P0CA700", 41, "text", "initial"];
      const test = {
        async query(csl: string, params: Record<string, KustoParam>) {
          sent.push({ database: "test", csl, params });
          return [eventRow];
        },
        async ping() {},
      };
      // `prod` has no events table: Kusto's semantic error SEM0100 for the table.
      const prod = {
        async query(csl: string, params: Record<string, KustoParam>) {
          sent.push({ database: "prod", csl, params });
          throw new KustoError("ADX: SEM0100: Failed to resolve table or column named 'events'");
        },
        async ping() {},
      };
      const router = new MultiDatabaseSource(
        new Map([
          [
            "prod",
            new AdxSource(prod as never, { ...adxMapping, database: "prod" }, adxEventMapping),
          ],
          [
            "test",
            new AdxSource(test as never, { ...adxMapping, database: "test" }, adxEventMapping),
          ],
        ]),
      );
      const scope: Scope = { dataRef: "test:car1", from: B, to: B + 10n * S };
      const rows = await must(router.events)("test:car1", 100, scope);
      expect(rows).toEqual([
        {
          t: (B + 5n * S).toString(),
          source: "BMS",
          kind: "dtc",
          name: "P0CA700",
          value: 41,
          text: "text",
          detail: "initial",
        },
      ]);
      // Only `test` was asked; `prod` saw nothing.
      expect(sent.map((s) => s.database)).toEqual(["test"]);
      // A database without the table answers "no events table" for its own refs, not an error.
      expect(await must(router.events)("prod:car1", 100)).toBeUndefined();
    });
  });
});

describe("one queue for all databases (Shared queue, 2.4)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const setup = (limit: number) => {
    const gauge = { inFlight: 0, peak: 0, total: 0 };
    const { router, sent } = routerOf({
      prod: { gauge, holdMs: 15 },
      test: { gauge, holdMs: 15 },
    });
    const queue = new QueryQueue(limit);
    return { gauge, queue, sent, queued: queuedAdapter(router, queue) as Required<SourceAdapter> };
  };

  it("one queue for all databases", async () => {
    // KIPSCOPE_QUERY_CONCURRENCY=2; 3 signals of prod and 3 of test asked at once.
    const { gauge, queue, queued } = setup(2);
    const asks = ["prod", "test"].flatMap((db) =>
      ["S1", "S2", "S3"].map((name) =>
        queued.series(ref(`${db}:car1`, name), B, B + 10n * S, 100, S),
      ),
    );
    const answers = await Promise.all(asks);
    expect(answers).toHaveLength(6);
    expect(gauge.total).toBe(6);
    // At most 2 in flight across both clients, and the 2 slots were used.
    expect(gauge.peak).toBe(2);
    expect(queue.peak).toBe(2);
  });

  it("gives computed series of every database a slot of the same queue", async () => {
    const { gauge, queued } = setup(2);
    const parsed = parseFormula("A + B");
    if (!parsed.ok) throw new Error(parsed.message);
    const computed = (db: string): ComputedRef => ({
      dataRef: `${db}:car1`,
      ast: parsed.ast,
      inputs: [ref(`${db}:car1`, "A"), ref(`${db}:car1`, "B")],
    });
    const asks = ["prod", "test", "prod", "test"].map((db) =>
      queued.computedSeries(computed(db), B, B + 10n * S, 100, S),
    );
    await Promise.all(asks);
    expect(gauge.total).toBe(4);
    expect(gauge.peak).toBe(2);
  });
});

describe("through the HTTP routes", () => {
  const range = "from=2026-10-01T01:00:00Z&to=2026-10-01T01:10:00Z";
  const holdings = { car1: ["A"] };

  it("lists the signals of both databases under qualified IDs", async () => {
    const { router } = routerOf({ prod: { holdings }, test: { holdings } });
    const t = await scopeApp({ adapter: router });
    try {
      const res = await t.get("/api/signals?q=");
      expect(res.status).toBe(200);
      expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([
        "prod:car1/A",
        "test:car1/A",
      ]);
      // The two entries are distinct signals of two data refs, one name.
      expect(res.body.items.map((i: { dataRef: string }) => i.dataRef)).toEqual([
        "prod:car1",
        "test:car1",
      ]);
      // A scope in one database makes the workspace see that database's signals.
      const set = await t.command({
        type: "scope.set",
        dataRef: "test:car1",
        from: "2026-10-01T01:00:00Z",
        to: "2026-10-01T02:00:00Z",
      });
      expect(set.status, JSON.stringify(set.body)).toBe(200);
    } finally {
      await t.close();
    }
  });

  it("answers 400 unknown_database for a bare ref and an unknown database", async () => {
    const { router } = routerOf({ prod: { holdings }, test: { holdings } });
    const t = await scopeApp({ adapter: router });
    // Exactly the spec's refusal: 400, code unknown_database, the form and the configured databases.
    const refused = (answer: Answer, named: string) => {
      const label = `${named}: ${answer.text}`;
      expect(answer.status, label).toBe(400);
      expect(answer.body.error?.code ?? answer.body.code, label).toBe("unknown_database");
      expect(answer.text, label).toContain("<database>:<ref>");
      expect(answer.text, label).toContain("prod, test");
      expect(answer.text, label).toContain(named);
    };
    try {
      // /api/events: a bare ref, then a database that is not configured.
      refused(await t.get("/api/events?dataRef=car1"), "car1");
      refused(await t.get(`/api/events?dataRef=dev:car1&${range}`), "dev:car1");
      // The catalog-first routes (series, density, ...) are in the next test.
    } finally {
      await t.close();
    }
  });

  // Exactly the spec's refusal: 400, code unknown_database, the form, the configured databases and
  // the offending ref in the body (the error object of apiError or the command's flat form).
  const refusedWith = (answer: Answer, named: string) => {
    const label = `${named}: ${answer.status} ${answer.text}`;
    expect(answer.status, label).toBe(400);
    expect(answer.body.error?.code ?? answer.body.code, label).toBe("unknown_database");
    expect(answer.text, label).toContain("<database>:<ref>");
    expect(answer.text, label).toContain("prod, test");
    expect(answer.text, label).toContain(named);
  };
  const day = "from=2026-10-01T00:00:00Z&to=2026-10-02T00:00:00Z";
  /** Every catalog-first route with a data ref or signal that is no qualified ref of a configured database. */
  const routesOf = (dataRef: string, signal: string) =>
    [
      ["/api/series", `signal=${signal}&${range}`],
      ["/api/density", `dataRef=${dataRef}`],
      ["/api/calendar", `dataRef=${dataRef}&${day}`],
      ["/api/gaps", `dataRef=${dataRef}`],
      ["/api/extent", `signal=${signal}`],
      ["/api/value", `signal=${signal}&t=2026-10-01T01:05:00Z`],
    ] as const;

  it("answers 400 unknown_database on series, density, calendar, gaps, extent and value for a bare ref", async () => {
    const { router, sent } = routerOf({ prod: { holdings }, test: { holdings } });
    const t = await scopeApp({ adapter: router });
    try {
      sent.length = 0;
      for (const [path, query] of routesOf("car1", "car1/A"))
        refusedWith(await t.get(`${path}?${query}`), "car1");
      // None of them asked a database.
      expect(sent).toEqual([]);
    } finally {
      await t.close();
    }
  });

  it("answers 400 unknown_database on series, density, calendar, gaps, extent and value for an unknown database", async () => {
    const { router, sent } = routerOf({ prod: { holdings }, test: { holdings } });
    const t = await scopeApp({ adapter: router });
    try {
      sent.length = 0;
      for (const [path, query] of routesOf("dev:car1", "dev:car1/A"))
        refusedWith(await t.get(`${path}?${query}`), "dev:car1");
      expect(sent).toEqual([]);
    } finally {
      await t.close();
    }
  });

  it("still reaches the source with a qualified ref of a configured database", async () => {
    const { router, sent } = routerOf({ prod: { holdings }, test: { holdings } });
    const t = await scopeApp({ adapter: router });
    try {
      for (const [path, query] of routesOf("test:car1", "test:car1/A")) {
        sent.length = 0;
        const res = await t.get(`${path}?${query}`);
        // Neither the router's refusal nor the catalog's unknown_*: the request went on to the source
        // (the fake holds no points, so a later no_data 404 is fine).
        expect(res.status, `${path}: ${res.text}`).not.toBe(400);
        expect(res.text, path).not.toMatch(/unknown_(database|signal|data_ref)/);
        expect(
          sent.every((s) => s.database === "test"),
          `${path}: only test is asked`,
        ).toBe(true);
        // The calendar answers its zeros from the day store without asking a database; the rest ask.
        if (path === "/api/calendar") expect(res.status, res.text).toBe(200);
        else expect(sent.length, `${path}: a query reached test`).toBeGreaterThan(0);
      }
    } finally {
      await t.close();
    }
  });

  it("with one database keeps answering 404 for a bare unknown ref", async () => {
    // One database: the plain adapter, refs stay bare, no databaseRefusal.
    const t = await scopeApp({ adapter: fakeSource("prod", [], { holdings }) });
    try {
      for (const [path, query] of routesOf("nope", "nope/A")) {
        const res = await t.get(`${path}?${query}`);
        expect(res.status, `${path}: ${res.text}`).toBe(404);
        const code = res.body.error?.code ?? res.body.code;
        expect(code, `${path}: ${res.text}`).toMatch(/^unknown_(signal|data_ref)$/);
        expect(res.text).not.toContain("unknown_database");
      }
    } finally {
      await t.close();
    }
  });

  it("answers 400 unknown_database when a scope names a bare ref or an unknown database", async () => {
    const { router } = routerOf({ prod: { holdings }, test: { holdings } });
    const t = await scopeApp({ adapter: router });
    try {
      // The workspace route: a scope on a bare ref is refused and sets nothing.
      const bare = await t.command({
        type: "scope.set",
        dataRef: "car1",
        from: "2026-10-01T01:00:00Z",
        to: "2026-10-01T02:00:00Z",
      });
      expect(bare.status, bare.text).toBe(400);
      expect(bare.body.ok).toBe(false);
      expect(bare.body.code, bare.text).toBe("unknown_database");
      expect(bare.text).toContain("prod:car1");
      expect(bare.text).toContain("prod, test");
      const unknown = await t.command({
        type: "scope.set",
        dataRef: "dev:car1",
        from: "2026-10-01T01:00:00Z",
        to: "2026-10-01T02:00:00Z",
      });
      expect(unknown.status, unknown.text).toBe(400);
      expect(unknown.body.code, unknown.text).toBe("unknown_database");
      expect(unknown.text).toContain("dev:car1");
      expect(unknown.text).toContain("prod, test");
    } finally {
      await t.close();
    }
  });
});

describe("per-database mapping through createAdapter (Override)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the events query of a database with its own events table", async () => {
    // kipscope.yaml: adx.databases.test.eventsTable = TestEvents; prod keeps the shared `events`.
    const dir = mkdtempSync(join(tmpdir(), "kipscope-adxdb-"));
    try {
      writeFileSync(
        join(dir, "kipscope.yaml"),
        "adx:\n  databases:\n    test:\n      eventsTable: TestEvents\n",
      );
      const queries: { db: string; csl: string }[] = [];
      vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        queries.push({ db: body.db, csl: body.csl });
        const frames = [
          { FrameType: "DataTable", TableKind: "PrimaryResult", Rows: [] },
          { FrameType: "DataSetCompletion", HasErrors: false },
        ];
        return new Response(JSON.stringify(frames), { status: 200 });
      });
      const adapter = createAdapter(
        loadConfig(
          {
            KIPSCOPE_SOURCE: "adx",
            KIPSCOPE_ADX_CLUSTER: "http://127.0.0.1:8125",
            KIPSCOPE_ADX_AUTH: "none",
            KIPSCOPE_ADX_DATABASES: "prod,test",
          },
          dir,
        ),
      );
      const events = must(adapter.events);
      await events("test:car1", 100);
      await events("prod:car1", 100);
      const test = queries.filter((x) => x.db === "test");
      const prod = queries.filter((x) => x.db === "prod");
      expect(test).toHaveLength(1);
      expect(prod).toHaveLength(1);
      // The word boundary keeps `TestEvents` from matching inside another name.
      expect(test[0]?.csl).toMatch(/\bTestEvents\b/);
      expect(test[0]?.csl).not.toMatch(/\bevents\b/);
      expect(prod[0]?.csl).toMatch(/\bevents\b/);
      expect(prod[0]?.csl).not.toContain("TestEvents");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
