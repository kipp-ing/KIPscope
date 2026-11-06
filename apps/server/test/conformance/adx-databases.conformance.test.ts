/**
 * The conformance suite through the router over two databases (add-adx-databases, "Conformance over
 * two databases"): the Kusto emulator holds the fixture twice, in `kipscope_test` and
 * `kipscope_test2` (`seed:adx`). Each database is read through `MultiDatabaseSource` under its
 * qualified refs (`<database>:conf-a`); a bare-ref view of that database runs the unchanged suite, so
 * every answer must equal the one-database answer after the qualifier is stripped.
 *
 * Variant: two real emulator databases (4.1: the emulator hosts a second database). Without the
 * emulator the file is skipped, never passed. Like the other emulator tests it belongs to
 * `pnpm --filter @kipscope/server test:adx`.
 */
import { describe, expect, it } from "vitest";
import { AdxSource } from "../../src/adx.ts";
import { MultiDatabaseSource, qualifyDataRef } from "../../src/adxRouter.ts";
import type { EventMapping } from "../../src/config.ts";
import type { SourceAdapter, SourceSignal } from "../../src/datasource.ts";
import { KustoClient } from "../../src/kusto.ts";
import { adxEventMapping, adxMapping, TEST_ADX_DATABASE, testAdxUrl } from "../adxdb.ts";
import { B, FIXTURE_SIGNALS } from "./fixture.ts";
import { describeConformance } from "./suite.ts";

const SECOND_ADX_DATABASE = "kipscope_test2";
const DATABASES = [TEST_ADX_DATABASE, SECOND_ADX_DATABASE];

/** Both databases seeded and answering? Probed once; false skips the file (the emulator part is not run). */
async function emulatorHoldsBoth(): Promise<boolean> {
  try {
    for (const db of DATABASES) {
      const response = await fetch(`${testAdxUrl()}/v1/rest/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8", Accept: "application/json" },
        body: JSON.stringify({ db, csl: "signals | count" }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return false;
      const answer = (await response.json()) as { Tables: { Rows: unknown[][] }[] };
      if (Number(answer.Tables[0]?.Rows[0]?.[0]) !== 17_082) return false;
    }
    return true;
  } catch {
    return false;
  }
}
const available = await emulatorHoldsBoth();

/** A router over the two emulator databases, in order, each with its own client and mapping. */
function router(events: EventMapping = adxEventMapping): MultiDatabaseSource {
  return new MultiDatabaseSource(
    new Map(
      DATABASES.map((database) => [
        database,
        new AdxSource(
          new KustoClient({ cluster: testAdxUrl(), database, timeoutSeconds: 30 }),
          { ...adxMapping, database },
          events,
        ),
      ]),
    ),
  );
}

const qualify = (database: string) => (dataRef: string) => qualifyDataRef(database, dataRef);
const stripped = (database: string, signal: SourceSignal): SourceSignal => ({
  ...signal,
  dataRef: signal.dataRef.slice(database.length + 1),
});

/**
 * The router seen as one database with bare refs: every ref goes in qualified, every ref that comes
 * out is stripped. Nothing else changes, so the suite's expectations are those of one database.
 */
function bareView(through: SourceAdapter, database: string): SourceAdapter {
  const q = qualify(database);
  const scopeOf = <S extends { dataRef: string } | undefined>(scope: S): S =>
    (scope && { ...scope, dataRef: q(scope.dataRef) }) as S;
  const refOf = <R extends { dataRef: string }>(ref: R): R => ({ ...ref, dataRef: q(ref.dataRef) });
  const view: SourceAdapter = {
    info: through.info,
    ping: (abort) => through.ping(abort),
    listSignals: async (scope, abort) => {
      const listed = await through.listSignals(scopeOf(scope), abort);
      // Unscoped: both databases come back; this view shows its own.
      return listed
        .filter((s) => s.dataRef.startsWith(`${database}:`))
        .map((s) => stripped(database, s));
    },
    raw: (ref, from, to, limit, abort) => through.raw(refOf(ref), from, to, limit, abort),
    before: (ref, t, scope, abort) => through.before(refOf(ref), t, scopeOf(scope), abort),
    after: (ref, t, scope, abort) => through.after(refOf(ref), t, scopeOf(scope), abort),
    buckets: (ref, from, to, width, abort) => through.buckets(refOf(ref), from, to, width, abort),
    refBuckets: (dataRef, width, times, scope, abort) =>
      through.refBuckets(q(dataRef), width, times, scopeOf(scope), abort),
  };
  // The optional methods the router has, the same ones.
  const t = through;
  if (t.count)
    view.count = (ref, from, to, abort) => t.count?.(refOf(ref), from, to, abort) as never;
  if (t.extent)
    view.extent = (ref, scope, abort) => t.extent?.(refOf(ref), scopeOf(scope), abort) as never;
  if (t.series)
    view.series = (ref, from, to, target, width, scope, abort) =>
      t.series?.(refOf(ref), from, to, target, width, scopeOf(scope), abort) as never;
  if (t.refExtent)
    view.refExtent = (d, scope, abort) => t.refExtent?.(q(d), scopeOf(scope), abort) as never;
  if (t.refCount)
    view.refCount = (d, scope, abort) => t.refCount?.(q(d), scopeOf(scope), abort) as never;
  if (t.loggerGaps)
    view.loggerGaps = (d, grid, minGap, scope, abort) =>
      t.loggerGaps?.(q(d), grid, minGap, scopeOf(scope), abort) as never;
  if (t.firstTimes)
    view.firstTimes = (d, names, rows, scope, abort) =>
      t.firstTimes?.(q(d), names, rows, scopeOf(scope), abort) as never;
  if (t.computedSeries)
    view.computedSeries = (ref, from, to, target, width, abort) =>
      t.computedSeries?.(
        { ...ref, dataRef: q(ref.dataRef), inputs: ref.inputs.map(refOf) },
        from,
        to,
        target,
        width,
        abort,
      ) as never;
  if (t.stateChanges)
    view.stateChanges = (ref, by, limit, scope, abort) =>
      t.stateChanges?.(refOf(ref), by, limit, scopeOf(scope), abort) as never;
  if (t.events)
    view.events = (d, limit, scope, abort) =>
      t.events?.(q(d), limit, scopeOf(scope), abort) as never;
  return view;
}

// The unchanged suite, once per database: every case passes for `kipscope_test:conf-a` and for
// `kipscope_test2:conf-a` (native and core only, as for one database).
describe.skipIf(!available)("adx router over two databases", () => {
  for (const database of DATABASES) {
    describeConformance({
      name: `adx router, ${database}`,
      adapter: () => bareView(router(), database),
      eventsMissing: () => bareView(router({ ...adxEventMapping, table: "nope" }), database),
    });
  }

  it("lists both databases' signals under qualified IDs, in configuration order", async () => {
    const listed = await router().listSignals();
    const ids = listed.map((s) => `${s.dataRef}/${s.name}`);
    const expected = DATABASES.flatMap((db) =>
      FIXTURE_SIGNALS.map((s) => `${db}:${s.dataRef}/${s.name}`),
    );
    expect(ids).toEqual(expected);
    expect(ids).toHaveLength(16);
  });

  it("answers the same for the same ref in either database", async () => {
    const source = router();
    const [first, second] = DATABASES.map(qualify) as [
      (r: string) => string,
      (r: string) => string,
    ];
    const ref = (q: (r: string) => string) => ({ dataRef: q("conf-a"), name: "Lin.RAMP", sna: [] });
    const a = await source.raw(ref(first), B, B + 2n * 1_000_000_000n);
    const b = await source.raw(ref(second), B, B + 2n * 1_000_000_000n);
    // 200 points at 10 ms in [B, B + 2 s), values 0 … 199.
    expect(a).toHaveLength(200);
    expect(b).toEqual(a);
    expect(a[199]).toEqual({ t: B + 1_990_000_000n, v: 199 });
    // The scoped list of one database holds that database's conf-a signals only.
    const scope = { dataRef: first("conf-a"), from: B, to: B + 1_000_000_000n };
    const scoped = await source.listSignals(scope);
    expect(scoped.every((s) => s.dataRef === first("conf-a"))).toBe(true);
    expect(scoped.map((s) => s.name)).toContain("Lin.RAMP");
  });

  it("refuses a bare ref and an unknown database before any query", async () => {
    const source = router();
    const scope = { from: B, to: B + 1_000_000_000n };
    for (const dataRef of ["conf-a", "nodb:conf-a"]) {
      await expect(source.listSignals({ dataRef, ...scope })).rejects.toMatchObject({
        code: "unknown_database",
      });
    }
  });
});

// When the file is skipped, say so in the report.
describe.skipIf(available)(
  "adx router over two databases (emulator not reachable or not seeded)",
  () => {
    it.skip("not_run: needs `docker compose --profile adx up -d` and `pnpm --filter @kipscope/server seed:adx`", () => {});
  },
);
