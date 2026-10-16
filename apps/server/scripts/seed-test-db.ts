/**
 * Creates the test database (design D10): the `sdlog.signals` schema as on carserver plus a
 * nanosecond variant, filled with synthetic data. Idempotent: drops and recreates both tables.
 *
 * Data (vehicle `testcar` unless noted, start 2026-10-01T00:00:00Z):
 * - Fast_100h.SIG_A/B/C   5 ms over 10 h = 7,200,000 points each (concept load case)
 *                         SIG_A: spike value 1000 at 05:00:00.615; 1,000 extra rows with null utc, value 9999
 * - Irr_200h.JITTER       10,000 points, 10 ms ± 0..6 ms jitter, from 01:00
 * - Sparse_300h.SLOW      one point per minute over 10 h = 601 points, value = minute index
 * - Nodbc_500h.RAW        100 points, 1 s apart; not in the test DBC
 * - Many_700h.S0000-0999  one point each; for catalog size and paging
 * - Sna_800h.SPEED/RPM/TEMP/COUNTER/STATE/MODE  SNA test series from 02:00 (design S8 of add-sna-handling):
 *                         SPEED 1000 x 100 ms, 511 = SNA for n in [300, 499] and 600, 602, 999 (203 SNA), 42 at 601
 *                         RPM 100 x 1 s (11 SNA, incl. 8191.500000001; 8191.0 stays valid), TEMP 10 (2 SNA),
 *                         COUNTER 16 (0 SNA), STATE 10 (4 SNA), MODE 10 (2 SNA)
 * - othercar / Fast_100h.SIG_A  10 points; same signal name, other vehicle
 * - spancar / Span_910h.FAR  5 points far apart (span and epoch tests of harden-robustness): values 1..5 at
 *                         1969-12-31T23:59:58.5Z, 23:59:59.5Z, 1970-01-01T00:00:00.5Z, 2026-01-01T00:00:00Z,
 *                         2026-10-01T00:00:00Z
 * - sdlog.signals_ns: Ns_600h.FINE  1,000 points from 2026-10-14T08:00:00.123456789Z, 1,001 ns apart
 *
 * Run: pnpm --filter @letsview/server seed:test   (needs `docker compose up -d`)
 */
import { createClient } from "@clickhouse/client";

const url = process.env.TEST_CLICKHOUSE_URL;
if (!url) throw new Error("TEST_CLICKHOUSE_URL is not set (see .env.example)");

/** Same server: equal port and equal host, where localhost, 127.0.0.1 and [::1] are one host. */
function sameServer(a: string, b: string): boolean {
  const key = (text: string) => {
    const u = new URL(text);
    const host = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(u.hostname.toLowerCase())
      ? "loopback"
      : u.hostname.toLowerCase();
    return `${host}:${u.port || (u.protocol === "https:" ? "443" : "80")}`;
  };
  return key(a) === key(b);
}
if (process.env.CLICKHOUSE_URL && sameServer(url, process.env.CLICKHOUSE_URL)) {
  throw new Error(
    "TEST_CLICKHOUSE_URL points at the same server as CLICKHOUSE_URL; refusing to seed the real database",
  );
}

const client = createClient({
  url,
  username: process.env.TEST_CLICKHOUSE_USER ?? "letsview",
  password: process.env.TEST_CLICKHOUSE_PASSWORD ?? "",
});

const BASE_MS = Date.UTC(2026, 9, 1);
/** Span_910h.FAR: [epoch ms, value]; exercises times more than 104 days apart and around 1970. */
const SPAN_POINTS: [number, number][] = [
  [Date.UTC(1969, 11, 31, 23, 59, 58, 500), 1],
  [Date.UTC(1969, 11, 31, 23, 59, 59, 500), 2],
  [Date.UTC(1970, 0, 1, 0, 0, 0, 500), 3],
  [Date.UTC(2026, 0, 1), 4],
  [Date.UTC(2026, 9, 1), 5],
];
const NS_BASE = 1791964800123456789n; // 2026-10-14T08:00:00.123456789Z

const schema = (table: string, precision: number) => `
  CREATE TABLE sdlog.${table} (
    vehicle LowCardinality(String),
    device LowCardinality(String),
    chunk String CODEC(ZSTD(3)),
    signal LowCardinality(String),
    utc Nullable(DateTime64(${precision}, 'UTC')) CODEC(DoubleDelta, ZSTD(3)),
    value Float64 CODEC(Gorilla, ZSTD(3))
  ) ENGINE = MergeTree PARTITION BY vehicle ORDER BY (vehicle, signal, utc)
  SETTINGS allow_nullable_key = 1`;

const insert = (table: string, select: string) =>
  `INSERT INTO sdlog.${table} (vehicle, device, chunk, signal, utc, value) ${select}`;

const ms = (offsetExpr: string) =>
  `fromUnixTimestamp64Milli(toInt64(${BASE_MS} + ${offsetExpr}), 'UTC')`;

/** SNA series start at 2026-10-01T02:00:00Z. */
const sna = (offsetExpr: string) => ms(`7200000 + ${offsetExpr}`);

const statements = [
  "CREATE DATABASE IF NOT EXISTS sdlog",
  "DROP TABLE IF EXISTS sdlog.signals",
  "DROP TABLE IF EXISTS sdlog.signals_ns",
  schema("signals", 3),
  schema("signals_ns", 9),
  ...["A", "B", "C"].map((s, i) =>
    insert(
      "signals",
      `SELECT 'testcar', 'test-dev', 'c1', 'Fast_100h.SIG_${s}', ${ms("number * 5")},
         if('${s}' = 'A' AND number = 3600123, 1000, sin(number / ${1000 * (i + 1)}) * ${i + 1})
       FROM numbers(7200000)`,
    ),
  ),
  insert(
    "signals",
    "SELECT 'testcar', 'test-dev', 'c1', 'Fast_100h.SIG_A', NULL, 9999 FROM numbers(1000)",
  ),
  insert(
    "signals",
    `SELECT 'testcar', 'test-dev', 'c2', 'Irr_200h.JITTER', ${ms("3600000 + number * 10 + cityHash64(number) % 7")},
       cos(number / 100) FROM numbers(10000)`,
  ),
  insert(
    "signals",
    `SELECT 'testcar', 'test-dev', 'c3', 'Sparse_300h.SLOW', ${ms("number * 60000")}, number
     FROM numbers(601)`,
  ),
  insert(
    "signals",
    `SELECT 'testcar', 'test-dev', 'c4', 'Nodbc_500h.RAW', ${ms("number * 1000")}, number % 2
     FROM numbers(100)`,
  ),
  insert(
    "signals",
    `SELECT 'testcar', 'test-dev', 'c5', concat('Many_700h.S', leftPad(toString(number), 4, '0')),
       ${ms("0")}, number FROM numbers(1000)`,
  ),
  insert(
    "signals",
    `SELECT 'othercar', 'other-dev', 'c6', 'Fast_100h.SIG_A', ${ms("number * 5")}, -number
     FROM numbers(10)`,
  ),
  insert(
    "signals",
    `SELECT 'testcar', 'test-dev', 'c8', 'Sna_800h.SPEED', ${sna("number * 100")},
       multiIf((number >= 300 AND number <= 499) OR number IN (600, 602, 999), 511,
               number = 601, 42, number % 100)
     FROM numbers(1000)`,
  ),
  insert(
    "signals",
    `SELECT 'testcar', 'test-dev', 'c8', 'Sna_800h.RPM', ${sna("number * 1000")},
       multiIf(number = 50, 8191.0, number = 51, 8191.500000001, number % 10 = 9, 8191.5,
               number * 10)
     FROM numbers(100)`,
  ),
  insert(
    "signals",
    `SELECT 'testcar', 'test-dev', 'c8', 'Sna_800h.TEMP', ${sna("number * 1000")},
       if(number % 5 = 0, -128, number * 10 - 40)
     FROM numbers(10)`,
  ),
  insert(
    "signals",
    `SELECT 'testcar', 'test-dev', 'c8', 'Sna_800h.COUNTER', ${sna("number * 1000")}, number
     FROM numbers(16)`,
  ),
  insert(
    "signals",
    `SELECT 'testcar', 'test-dev', 'c8', 'Sna_800h.STATE', ${sna("number * 1000")}, number % 3
     FROM numbers(10)`,
  ),
  insert(
    "signals",
    `SELECT 'testcar', 'test-dev', 'c8', 'Sna_800h.MODE', ${sna("number * 1000")}, number % 8
     FROM numbers(10)`,
  ),
  insert(
    "signals",
    `SELECT 'spancar', 'span-dev', 'c9', 'Span_910h.FAR', fromUnixTimestamp64Milli(toInt64(t.1), 'UTC'), t.2
     FROM (SELECT arrayJoin([${SPAN_POINTS.map(([ms, v]) => `(${ms}, ${v})`).join(", ")}]) AS t)`,
  ),
  insert(
    "signals_ns",
    `SELECT 'testcar', 'test-dev', 'c7', 'Ns_600h.FINE',
       fromUnixTimestamp64Nano(toInt64(${NS_BASE}) + toInt64(number * 1001), 'UTC'), number
     FROM numbers(1000)`,
  ),
];

/** Spot checks: query → expected single value. */
const checks: [string, string][] = [
  ["SELECT count() FROM sdlog.signals", "21613862"],
  [
    "SELECT count() FROM (SELECT DISTINCT vehicle, signal FROM sdlog.signals WHERE utc IS NOT NULL)",
    "1014",
  ],
  [
    "SELECT max(value) FROM sdlog.signals WHERE signal = 'Fast_100h.SIG_A' AND vehicle = 'testcar' AND utc IS NOT NULL",
    "1000",
  ],
  [
    "SELECT toString(utc) FROM sdlog.signals WHERE signal = 'Fast_100h.SIG_A' AND value = 1000",
    "2026-10-01 05:00:00.615",
  ],
  ["SELECT countIf(utc IS NULL) FROM sdlog.signals", "1000"],
  [
    "SELECT toString(min(utc)) FROM sdlog.signals WHERE signal = 'Fast_100h.SIG_C'",
    "2026-10-01 00:00:00.000",
  ],
  [
    "SELECT toString(max(utc)) FROM sdlog.signals WHERE signal = 'Fast_100h.SIG_C'",
    "2026-10-01 09:59:59.995",
  ],
  [
    "SELECT countIf(value = 511) FROM sdlog.signals WHERE signal = 'Sna_800h.SPEED' AND vehicle = 'testcar'",
    "203",
  ],
  [
    "SELECT arrayStringConcat(arrayMap(x -> toString(toUnixTimestamp64Milli(x)), groupArray(utc)), ',') FROM (SELECT utc FROM sdlog.signals WHERE vehicle = 'spancar' ORDER BY utc)",
    SPAN_POINTS.map(([ms]) => ms).join(","),
  ],
  ["SELECT toString(toUnixTimestamp64Nano(min(utc))) FROM sdlog.signals_ns", NS_BASE.toString()],
];

const started = Date.now();
for (const query of statements) {
  await client.command({ query, clickhouse_settings: { wait_end_of_query: 1 } });
}
console.log(`seeded in ${((Date.now() - started) / 1000).toFixed(1)} s`);

let failed = 0;
for (const [query, expected] of checks) {
  const result = await client.query({ query, format: "TabSeparated" });
  const actual = (await result.text()).trim();
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${query}\n     expected ${expected}, got ${actual}`);
}
await client.close();
if (failed) process.exit(1);
