/**
 * Measures the queries of an object scope (add-case-open design K11, M1 … M7) on a large history,
 * through the server's own source and query code (not raw SQL): `ObjectExtents`, `DensityCache`,
 * `Catalog`, `querySeries`, `GapCache` and `EventsCache`, over `completeSource` of the real
 * adapter. Each query runs once as a warm-up and three times timed, on fresh caches; the median
 * is compared with its goal.
 *
 * Needs the history of `seed-long.ts` (data ref `longcar` by default):
 *   pnpm --filter @kipscope/server seed:long [-- --adx]
 *   pnpm --filter @kipscope/server measure:object -- --source clickhouse --ref longcar
 *   pnpm --filter @kipscope/server measure:object -- --source adx --ref longcar
 *
 * Prints the row count, then one line per query:
 *   M<n> <name> <median ms> goal <ms> <ok|over|2x over>
 * `over`: above the goal, `2x over`: above twice the goal (then the change reports it to Jan with
 * its named fallback F1 … F5, design K11). It always exits 0: goals are reported, not gates. A
 * query that fails prints `M<n> <name> failed: <message>` and the run goes on. Exit 2: bad flags.
 *
 * Only the test databases of seed-long.ts are read: ClickHouse is TEST_CLICKHOUSE_URL, the Kusto
 * emulator TEST_ADX_URL (loopback only).
 */
import { TIME_MAX, TIME_MIN, type TimeRange, workWindow } from "@kipscope/shared";
import { AdxSource } from "../src/adx.ts";
import { Catalog } from "../src/catalog.ts";
import { ClickHouseSource, createClickHouseClient } from "../src/clickhouse.ts";
import type { EventMapping, TableMapping } from "../src/config.ts";
import type { DataSource, SourceAdapter } from "../src/datasource.ts";
import { DensityCache } from "../src/density.ts";
import { EventsCache } from "../src/events.ts";
import { completeSource } from "../src/fallbacks.ts";
import { GapCache } from "../src/gaps.ts";
import { KustoClient } from "../src/kusto.ts";
import { ObjectExtents } from "../src/objectScope.ts";
import { querySeries } from "../src/series.ts";
import { adxEventMapping, adxMapping, TEST_ADX_DATABASE, testAdxUrl } from "../test/adxdb.ts";
import { testEventMapping, testMapping } from "../test/testdb.ts";

const usage = (message: string): never => {
  console.error(
    `measure-object: ${message}\nusage: measure:object -- --source clickhouse|adx [--ref longcar]`,
  );
  return process.exit(2);
};

const args = process.argv.slice(2).filter((a) => a !== "--");
const flag = (name: string): string | undefined => {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args[at + 1];
};
for (const a of args) {
  if (a.startsWith("--") && !["--source", "--ref"].includes(a)) usage(`unknown flag ${a}`);
}
const kind = flag("--source");
if (kind !== "clickhouse" && kind !== "adx") usage("--source must be clickhouse or adx");
const ref = flag("--ref") ?? "longcar";
if (!/^[A-Za-z0-9_.-]+$/.test(ref)) usage(`not a data ref: ${ref}`);

/** Seconds a query may run on the emulator or the test DB before it fails. */
const QUERY_TIMEOUT_S = 600;

function openSource(): SourceAdapter {
  if (kind === "adx") {
    const url = testAdxUrl();
    const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
    if (!loopback.has(new URL(url).hostname.toLowerCase())) {
      console.error(`measure-object: TEST_ADX_URL ${url} is not a loopback address`);
      process.exit(1);
    }
    const mapping: TableMapping = { ...adxMapping, table: "longsignals" };
    const events: EventMapping = { ...adxEventMapping, table: "longevents" };
    return new AdxSource(
      new KustoClient({
        cluster: url,
        database: TEST_ADX_DATABASE,
        timeoutSeconds: QUERY_TIMEOUT_S,
      }),
      mapping,
      events,
    );
  }
  const url = process.env.TEST_CLICKHOUSE_URL;
  if (!url) throw new Error("TEST_CLICKHOUSE_URL is not set (see .env.example)");
  const mapping: TableMapping = { ...testMapping, table: "long_signals" };
  const events: EventMapping = { ...testEventMapping, table: "long_events" };
  return new ClickHouseSource(
    createClickHouseClient({
      url,
      username: process.env.TEST_CLICKHOUSE_USER ?? "kipscope",
      password: process.env.TEST_CLICKHOUSE_PASSWORD ?? "",
    }),
    mapping,
    QUERY_TIMEOUT_S,
    events,
  );
}

const DAY = 86_400_000_000_000n;
const adapter = openSource();
const source: DataSource = completeSource(adapter);

/** The goals of design K11, ms. */
const GOALS = { M1: 2_000, M2: 5_000, M3: 3_000, M4: 10_000, M5: 5_000, M6: 5_000, M7: 2_000 };

interface Measure {
  id: keyof typeof GOALS;
  name: string;
  run: () => Promise<unknown>;
}

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] as number;

/** One warm-up and three timed runs of `run`; the median in ms. */
async function time(run: () => Promise<unknown>): Promise<number> {
  await run();
  const times: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    await run();
    times.push(performance.now() - t0);
  }
  return median(times);
}

const verdict = (ms: number, goal: number) =>
  ms <= goal ? "ok" : ms <= 2 * goal ? "over" : "2x over";

// The vehicle: its row count and extent (the extent is M1 itself, measured below).
const whole = await source.refExtent?.(ref, { dataRef: ref, from: TIME_MIN, to: TIME_MAX });
if (!whole) {
  console.log(
    `no rows for data ref ${ref} in ${kind}: run seed:long${kind === "adx" ? " -- --adx" : ""} first`,
  );
  process.exit(0);
}
console.log(
  `${ref} on ${kind}: ${whole.count} rows, ${new Date(Number(whole.first / 1_000_000n)).toISOString()} - ${new Date(Number(whole.last / 1_000_000n)).toISOString()}`,
);

const extent = { from: whole.first, to: whole.last + 1n };
const scope = { dataRef: ref, from: extent.from, to: extent.to, object: true as const };
// The work window of K11 at its widest: a 30-day view in the middle of the vehicle.
const middle = (extent.from + extent.to) / 2n;
const view: TimeRange = {
  from: (middle - 15n * DAY).toString(),
  to: (middle + 15n * DAY).toString(),
};
const wide = workWindow(view, {
  dataRef: ref,
  from: scope.from.toString(),
  to: scope.to.toString(),
  object: true,
});
const window = { dataRef: ref, from: BigInt(wide.from), to: BigInt(wide.to) };

// The vehicle's own signal list (M4) also serves the gap and events caches.
const listed = new Catalog(source, async () => new Map(), undefined, undefined, undefined, scope);
const firstSignal = () => listed.all()[0];

const measures: Measure[] = [
  {
    id: "M1",
    name: "object extent",
    run: () => new ObjectExtents(source).get(ref),
  },
  {
    id: "M2",
    name: "coarse density",
    run: () => new DensityCache(source, () => undefined).get(ref, scope, { coarse: true }),
  },
  {
    id: "M3",
    name: "detail density 32 d",
    run: () => new DensityCache(source, () => undefined).get(ref, scope, { window }),
  },
  {
    id: "M4",
    name: "vehicle signal list",
    run: async () => {
      await listed.refresh();
    },
  },
  {
    id: "M5",
    name: "series 2048 buckets",
    run: async () => {
      const signal = firstSignal();
      if (!signal) throw new Error("no signal in the vehicle's list (run M4 first)");
      return querySeries(
        source,
        { dataRef: ref, name: signal.name, sna: [] },
        signal.id,
        extent.from,
        extent.to,
        2048,
        scope,
      );
    },
  },
  {
    id: "M6",
    name: "gap info 32 d",
    run: async () => {
      const signal = firstSignal();
      return new GapCache(
        source,
        listed,
        () => [],
        () => undefined,
      ).get(ref, signal ? [signal.id] : [], scope, window);
    },
  },
  {
    id: "M7",
    name: "events 32 d",
    run: () => new EventsCache(source, listed, () => {}).table(ref, scope, window),
  },
];

for (const m of measures) {
  try {
    const ms = await time(m.run);
    const goal = GOALS[m.id];
    console.log(`${m.id} ${m.name} ${Math.round(ms)} ms goal ${goal} ms ${verdict(ms, goal)}`);
  } catch (error) {
    console.log(
      `${m.id} ${m.name} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
process.exit(0);
