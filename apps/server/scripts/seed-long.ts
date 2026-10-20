/**
 * Seeds the synthetic long history `longcar` of add-case-open (design K17) for the measurement of
 * the object scope (`measure-object.ts`, M1 … M7): one vehicle, 400 days ending 2026-10-01T00:00:00Z,
 * one drive a day 08:00 - 10:00 UTC, 20 signals `Long_900h.S00` … `S19` at 1 Hz (7,200 rows a day and
 * signal, 57.6 M rows in all), and one DTC a day at 09:00 in the events table.
 *
 * The rows are generated INSIDE the database (`INSERT … SELECT … FROM numbers()` on ClickHouse,
 * `.set-or-append … <| range` on the Kusto emulator), so no row crosses the network. Own tables
 * (`sdlog.long_signals` and `sdlog.long_events`; `longsignals` and `longevents` on the emulator),
 * so the counts of the other test data stay. Idempotent: drops and refills them.
 *
 * Only a test database: ClickHouse is `TEST_CLICKHOUSE_URL` (refused when it is the real
 * `CLICKHOUSE_URL`); the emulator is `TEST_ADX_URL` and must be a loopback address. Never carserver.
 *
 * Flags (the full size is the default; scale down when a database cannot hold it):
 *   --adx            seed the Kusto emulator instead of ClickHouse
 *   --days N         days of history (default 400)
 *   --signals N      signals (default 20, at most 100)
 *   --hz N           samples a second (default 1, at most 1000)
 *
 * Run: pnpm --filter @kipscope/server seed:long [-- --days 3]   (needs `docker compose up -d`)
 *      pnpm --filter @kipscope/server seed:long -- --adx        (needs `--profile adx`)
 * Prints the rows written; exits 1 when the database holds another count.
 */
import { createClient } from "@clickhouse/client";

const LONG_REF = "longcar";
/** The history ends here (exclusive) … */
const END_MS = Date.UTC(2026, 9, 1);
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** … and each day drives from 08:00 to 10:00 UTC; the DTC is read at 09:00. */
const DRIVE_START_H = 8;
const DRIVE_HOURS = 2;
const DTC_H = 9;

interface Plan {
  days: number;
  signals: number;
  hz: number;
  /** ms between two samples of a signal. */
  stepMs: number;
  /** Samples of one signal in one drive. */
  perDrive: number;
  /** Midnight (UTC, ms) of the first day. */
  firstDayMs: number;
  /** Rows the signals table must hold. */
  rows: number;
}

function intFlag(args: string[], name: string, fallback: number, max: number): number {
  const at = args.indexOf(name);
  if (at < 0) return fallback;
  const text = args[at + 1] ?? "";
  const value = Number(text);
  if (!/^\d+$/.test(text) || value < 1 || value > max) {
    console.error(`seed-long: ${name} takes an integer from 1 to ${max}, got "${text}"`);
    process.exit(2);
  }
  return value;
}

function plan(args: string[]): Plan {
  const days = intFlag(args, "--days", 400, 4000);
  const signals = intFlag(args, "--signals", 20, 100);
  const hz = intFlag(args, "--hz", 1, 1000);
  const stepMs = Math.max(1, Math.round(1000 / hz));
  const perDrive = Math.floor((DRIVE_HOURS * HOUR_MS) / stepMs);
  return {
    days,
    signals,
    hz,
    stepMs,
    perDrive,
    firstDayMs: END_MS - days * DAY_MS,
    rows: days * perDrive * signals,
  };
}

const args = process.argv.slice(2).filter((a) => a !== "--");
const known = new Set(["--adx", "--days", "--signals", "--hz"]);
for (const [i, a] of args.entries()) {
  if (a.startsWith("--") && !known.has(a)) {
    console.error(`seed-long: unknown flag ${a} (flags: --adx --days N --signals N --hz N)`);
    process.exit(2);
  }
  if (!a.startsWith("--") && !/^\d+$/.test(a)) {
    console.error(`seed-long: unexpected argument ${a} at ${i}`);
    process.exit(2);
  }
}
const p = plan(args);
const started = Date.now();

if (args.includes("--adx")) await seedAdx();
else await seedClickHouse();

// ClickHouse ---------------------------------------------------------------------------------

async function seedClickHouse() {
  const url = process.env.TEST_CLICKHOUSE_URL;
  if (!url) throw new Error("TEST_CLICKHOUSE_URL is not set (see .env.example)");
  const real = process.env.CLICKHOUSE_URL;
  if (
    real &&
    new URL(real).host.replace("127.0.0.1", "localhost") ===
      new URL(url).host.replace("127.0.0.1", "localhost")
  ) {
    throw new Error(
      "TEST_CLICKHOUSE_URL points at the same server as CLICKHOUSE_URL; refusing to seed the real database",
    );
  }
  const client = createClient({
    url,
    username: process.env.TEST_CLICKHOUSE_USER ?? "kipscope",
    password: process.env.TEST_CLICKHOUSE_PASSWORD ?? "",
    // One INSERT … SELECT of a chunk of days may take a while.
    request_timeout: 600_000,
    clickhouse_settings: {
      send_progress_in_http_headers: 1,
      http_headers_progress_interval_ms: "110000",
    },
  });
  const command = (query: string) =>
    client.command({ query, clickhouse_settings: { wait_end_of_query: 1 } });
  const scalar = async (query: string) =>
    (await (await client.query({ query, format: "TabSeparated" })).text()).trim();

  // The same layout as sdlog.signals and sdlog.events (seed-test-db.ts), own table names.
  await command("CREATE DATABASE IF NOT EXISTS sdlog");
  await command("DROP TABLE IF EXISTS sdlog.long_signals");
  await command("DROP TABLE IF EXISTS sdlog.long_events");
  await command(`
    CREATE TABLE sdlog.long_signals (
      vehicle LowCardinality(String),
      device LowCardinality(String),
      chunk String CODEC(ZSTD(3)),
      signal LowCardinality(String),
      utc Nullable(DateTime64(3, 'UTC')) CODEC(DoubleDelta, ZSTD(3)),
      value Float64 CODEC(Gorilla, ZSTD(3)),
      text LowCardinality(String) DEFAULT ''
    ) ENGINE = MergeTree PARTITION BY vehicle ORDER BY (vehicle, signal, utc)
    SETTINGS allow_nullable_key = 1`);
  await command(`
    CREATE TABLE sdlog.long_events (
      vehicle LowCardinality(String),
      device LowCardinality(String),
      chunk String CODEC(ZSTD(3)),
      utc Nullable(DateTime64(3, 'UTC')) CODEC(DoubleDelta, ZSTD(3)),
      source LowCardinality(String),
      kind LowCardinality(String),
      name String,
      value Float64,
      text String,
      detail String
    ) ENGINE = MergeTree PARTITION BY vehicle ORDER BY (vehicle, kind, source, name, utc)
    SETTINGS allow_nullable_key = 1`);

  // Chunks of days, so no statement needs memory for the whole history. Row n of a chunk:
  // signal n % S, then sample j and day d of k = n div S.
  const perDay = p.perDrive * p.signals;
  const chunkDays = Math.max(1, Math.min(p.days, Math.floor(20_000_000 / perDay) || 1));
  for (let day = 0; day < p.days; day += chunkDays) {
    const n = Math.min(chunkDays, p.days - day);
    const base = p.firstDayMs + day * DAY_MS + DRIVE_START_H * HOUR_MS;
    await command(`
      INSERT INTO sdlog.long_signals (vehicle, device, chunk, signal, utc, value)
      SELECT '${LONG_REF}', 'long-dev', 'l1',
             concat('Long_900h.S', leftPad(toString(number % ${p.signals}), 2, '0')),
             fromUnixTimestamp64Milli(toInt64(${base} + intDiv(intDiv(number, ${p.signals}), ${p.perDrive}) * ${DAY_MS}
               + (intDiv(number, ${p.signals}) % ${p.perDrive}) * ${p.stepMs}), 'UTC'),
             round(50 + 40 * sin((intDiv(number, ${p.signals}) % ${p.perDrive}) / 600.0 + number % ${p.signals}), 3)
      FROM numbers(${n * perDay})`);
  }
  await command(`
    INSERT INTO sdlog.long_events (vehicle, device, chunk, utc, source, kind, name, value, text, detail)
    SELECT '${LONG_REF}', 'long-diag', 'e1',
           fromUnixTimestamp64Milli(toInt64(${p.firstDayMs + DTC_H * HOUR_MS} + number * ${DAY_MS}), 'UTC'),
           'BMS', 'dtc', 'P0LONG0', 41, 'Long-run test fault', 'initial'
    FROM numbers(${p.days})`);

  const rows = Number(await scalar("SELECT count() FROM sdlog.long_signals"));
  const events = Number(await scalar("SELECT count() FROM sdlog.long_events"));
  await client.close();
  report("clickhouse", "sdlog.long_signals", rows, "sdlog.long_events", events);
}

// Kusto emulator -------------------------------------------------------------------------------

async function seedAdx() {
  const url = (process.env.TEST_ADX_URL || "http://127.0.0.1:8125").replace(/\/+$/, "");
  const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (!loopback.has(new URL(url).hostname.toLowerCase())) {
    console.error(
      `seed-long: TEST_ADX_URL ${url} is not a loopback address; seed-long seeds only a loopback emulator`,
    );
    process.exit(1);
  }
  const database = "kipscope_test";
  const post = async (path: string, csl: string): Promise<unknown[][]> => {
    const response = await fetch(`${url}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", Accept: "application/json" },
      body: JSON.stringify({ db: database, csl }),
    });
    const body = await response.text();
    if (!response.ok)
      throw new Error(`${csl.slice(0, 100)}: HTTP ${response.status} ${body.slice(0, 400)}`);
    return (JSON.parse(body) as { Tables: { Rows: unknown[][] }[] }).Tables[0]?.Rows ?? [];
  };
  const mgmt = (csl: string) => post("/v1/rest/mgmt", csl);
  const query = (csl: string) => post("/v1/rest/query", csl);

  const dbs = (await post("/v1/rest/mgmt", ".show databases | project DatabaseName")).map(
    (r) => r[0],
  );
  if (!dbs.includes(database)) {
    await fetch(`${url}/v1/rest/mgmt`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        db: "NetDefaultDB",
        csl: `.create database ${database} persist (@"/kustodata/dbs/${database}/md", @"/kustodata/dbs/${database}/data")`,
      }),
    });
  }
  for (const table of ["longsignals", "longevents"]) await mgmt(`.drop table ${table} ifexists`);
  await mgmt(
    ".create table longsignals (dataref: string, signal: string, timestamp: datetime, value: real, text: string)",
  );
  await mgmt(
    ".create table longevents (dataref: string, timestamp: datetime, source: string, ['kind']: string, name: string, value: real, text: string, detail: string)",
  );

  // Row n of the range: signal n % S, then sample j and day d of k = n div S (KQL: long / long is
  // integer division). Chunks of rows keep one statement within the emulator's memory.
  const first = new Date(p.firstDayMs).toISOString().slice(0, 10);
  const chunkRows = 2_000_000;
  const total = p.rows;
  for (let lo = 0; lo < total; lo += chunkRows) {
    const hi = Math.min(total, lo + chunkRows) - 1;
    await mgmt(`.set-or-append longsignals <|
      range n from ${lo} to ${hi} step 1
      | extend s = n % ${p.signals}, k = n / ${p.signals}
      | extend j = k % ${p.perDrive}, d = k / ${p.perDrive}
      | project dataref = '${LONG_REF}',
                signal = strcat('Long_900h.S', iff(s < 10, '0', ''), tostring(s)),
                timestamp = datetime(${first}) + 1d * d + ${DRIVE_START_H}h + 1ms * (j * ${p.stepMs}),
                value = round(50.0 + 40.0 * sin(todouble(j) / 600.0 + todouble(s)), 3),
                text = ''`);
  }
  await mgmt(`.set-or-append longevents <|
    range d from 0 to ${p.days - 1} step 1
    | project dataref = '${LONG_REF}', timestamp = datetime(${first}) + 1d * d + ${DTC_H}h,
              source = 'BMS', ['kind'] = 'dtc', name = 'P0LONG0', value = 41.0,
              text = 'Long-run test fault', detail = 'initial'`);

  const rows = Number((await query("longsignals | count"))[0]?.[0]);
  const events = Number((await query("longevents | count"))[0]?.[0]);
  report("adx", "longsignals", rows, "longevents", events);
}

function report(kind: string, signals: string, rows: number, events: string, eventRows: number) {
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `seeded ${LONG_REF} on ${kind} in ${seconds} s: ${rows} rows in ${signals} ` +
      `(${p.days} days x ${p.signals} signals x ${p.perDrive} samples a drive at ${p.hz} Hz), ` +
      `${eventRows} events in ${events}`,
  );
  const ok = rows === p.rows && eventRows === p.days;
  if (!ok) {
    console.error(
      `FAIL expected ${p.rows} rows and ${p.days} events, got ${rows} and ${eventRows}`,
    );
    process.exit(1);
  }
}
