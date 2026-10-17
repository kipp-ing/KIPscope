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
 * - drivecar / Drv_A10h.TRICKLE|FAST|WAKE  drives for the time strip (design S4 of add-strip-navigation), base
 *                         2026-10-02T00:00:00Z: TRICKLE 2,161 points 10 s apart over 6 h; FAST every 10 ms in
 *                         [01:00:00, 01:20:00), [01:20:30, 01:30:00), [03:00:00, 03:05:00), [03:06:30, 03:10:00)
 *                         (120,000 + 57,000 + 30,000 + 21,000 rows); WAKE 3,000 points 20 ms apart in
 *                         [02:00:00, 02:01:00). Total 233,161 rows; expected drives [01:00, 01:30) with 177,180 rows,
 *                         [03:00, 03:05) with 30,030 and [03:06:30, 03:10) with 21,021 (WAKE is under 2 min)
 * - sdlog.signals_ns: Ns_600h.FINE  1,000 points from 2026-10-14T08:00:00.123456789Z, 1,001 ns apart
 * - State signals (design T of add-events, testcar, chunk c11, 63,607 rows; both tables gain a `text` column):
 *                         Ign_A20h.MODE  every 100 ms in [01:00, 02:30) and [02:45, 03:00) (63,000): 0 in [01:00, 01:10),
 *                         3 in [01:10, 01:40), 15 (SNA) in [01:40:00, 01:40:01), 3 in [01:40:01, 02:00), 0 in [02:00, 02:30),
 *                         3 in [02:45, 03:00); VAL_ in test-a.dbc
 *                         Tmp_A21h.TEMP  every 1 s in [01:00:00, 01:10:00) (600): 20 + n % 10 for n < 300, 254 for
 *                         300 <= n < 310, 25 after; 254 named SENSOR_DEF in test-a.dbc
 *                         DIAG.door  5 rows (value 0, text closed, closed, open, open, closed) at 01:00:00, 01:01:30,
 *                         01:03:00, 01:04:30, 02:00:00; DIAG.lock  2 rows (text locked) at 02:00:00, 02:01:30
 *                         (not in the DBC: the state is in the row text). Catalog 1,017 -> 1,021 signals.
 * - sdlog.events (carserver's schema; testcar, device test-diag, chunk e1): 19 rows, 18 with a time. 9 DTCs at 05:00:00
 *                         (BMS: P0CA700 41, P180D13 105, P0C7800 36, P1CA100 40, U019B00 128, P0C4600 80, P0AA100 64,
 *                         P0E1A00 0, P0FFF00 3.5), VCU.door states at 01:00:00, 01:01:30, 01:03:00 (`from closed`),
 *                         01:04:30 and 02:00:00, DIAG.lock locked at 02:00:00, NRC SID 22 at 03:00:00, ISO-TP at 03:00:01,
 *                         note boot at 04:00:00, and DTC P0NULL0 without a time (never returned).
 *                         Categories: active 2, pending 1, stored 2, untested 2, passed 1, change 2, snapshot 4,
 *                         refused 1, transport 1, other 2; BMS 11, VCU 7.
 * - gapcar (design T of add-gap-display, device test-gap, chunk g1, 32,187 rows), base G = 2026-10-03T00:00:00Z, all rows in
 *                         [G, G + 10 min). No gapcar row lies in [00:05:00, 00:06:00) (logger pause P1), in (00:09:30.000,
 *                         00:09:31.900) (silence S1, 1.9 s, not a logger gap) or in (00:09:40.000, 00:09:42.000) (pause P2, 2.0 s).
 *                         Cyc_B10h.CYC  every 20 ms (DBC cycle 20 ms), value n mod 100, except P1, S1, P2, the open interval
 *                         (00:02:00.100, 00:02:00.600) (dropout, 24 rows) and 00:03:00.120 and 00:03:00.140 (spacing of exactly
 *                         3 periods): 26,781 rows
 *                         Evt_B11h.EVT  1, 2, 3, 4 at 00:00:30, 00:04:00, 00:07:00, 00:09:00 (DBC cycle 0)
 *                         Msr_B12h.MSR  every 100 ms (not in any DBC), value n mod 10, except P1, S1, P2 and the open interval
 *                         (00:08:00.000, 00:08:01.000) (9 rows): 5,354 rows
 *                         TBMS.current  every 10 s from 00:00:00 to 00:09:50 (diag group DT_Pack, 10s), 12.5, except P1 and
 *                         00:01:10, :20, :30, :50, 00:02:00, :10: 48 rows
 *                         Logger gaps 00:04:59.980-00:06:00.000 and 00:09:40.000-00:09:42.000; last row 00:09:59.980.
 *                         Catalog 1,021 -> 1,025 signals.
 * - sdlog.conf_signals / sdlog.conf_events: the portable conformance fixture of add-adx-source (design C7), schemas of
 *                         `signals_ns` and `events` with DateTime64(9); rows from test/conformance/fixture.ts (the
 *                         same file seeds the Kusto emulator): `conf-a` 17,069 timestamped rows + 1 without time,
 *                         `conf-b` 12 rows (17,082 in all), 8 signals; 6 events of `conf-a`, one without time.
 *                         Own tables, so the counts above (1,025 signals) stay.
 *
 * Run: pnpm --filter @kipscope/server seed:test   (needs `docker compose up -d`)
 */
import { createClient } from "@clickhouse/client";
import { fixtureEvents, fixtureRows, formatTime } from "../test/conformance/fixture.ts";

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
  username: process.env.TEST_CLICKHOUSE_USER ?? "kipscope",
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
/** drivecar starts one day after testcar: 2026-10-02T00:00:00Z. */
const DRIVE_BASE_MS = Date.UTC(2026, 9, 2);
const driveMs = (offsetExpr: string) =>
  `fromUnixTimestamp64Milli(toInt64(${DRIVE_BASE_MS} + ${offsetExpr}), 'UTC')`;
/** FAST bursts of drivecar: [start s, end s) after the base, one row every 10 ms. */
const DRIVE_BURSTS: [number, number][] = [
  [3600, 4800],
  [4830, 5400],
  [10800, 11100],
  [11190, 11400],
];
/** gapcar starts two days after testcar: 2026-10-03T00:00:00Z. */
const GAP_BASE_MS = Date.UTC(2026, 9, 3);
const gapMs = (offsetExpr: string) =>
  `fromUnixTimestamp64Milli(toInt64(${GAP_BASE_MS} + ${offsetExpr}), 'UTC')`;
const insertGap = (
  signal: string,
  offsetExpr: string,
  value: string,
  count: number,
  where: string,
) =>
  insert(
    "signals",
    `SELECT 'gapcar', 'test-gap', 'g1', '${signal}', ${gapMs(offsetExpr)}, ${value} FROM numbers(${count}) WHERE ${where}`,
  );
const NS_BASE = 1791964800123456789n; // 2026-10-14T08:00:00.123456789Z

const schema = (table: string, precision: number) => `
  CREATE TABLE sdlog.${table} (
    vehicle LowCardinality(String),
    device LowCardinality(String),
    chunk String CODEC(ZSTD(3)),
    signal LowCardinality(String),
    utc Nullable(DateTime64(${precision}, 'UTC')) CODEC(DoubleDelta, ZSTD(3)),
    value Float64 CODEC(Gorilla, ZSTD(3)),
    text LowCardinality(String) DEFAULT ''
  ) ENGINE = MergeTree PARTITION BY vehicle ORDER BY (vehicle, signal, utc)
  SETTINGS allow_nullable_key = 1`;

const eventsSchema = (table: string, precision: number) => `
  CREATE TABLE sdlog.${table} (
    vehicle LowCardinality(String),
    device LowCardinality(String),
    chunk String CODEC(ZSTD(3)),
    utc Nullable(DateTime64(${precision}, 'UTC')) CODEC(DoubleDelta, ZSTD(3)),
    source LowCardinality(String),
    kind LowCardinality(String),
    name String,
    value Float64,
    text String,
    detail String
  ) ENGINE = MergeTree PARTITION BY vehicle ORDER BY (vehicle, kind, source, name, utc)
  SETTINGS allow_nullable_key = 1`;

/** Seconds after the base (2026-10-01T00:00:00Z) of h:m:s. */
const hms = (h: number, m: number, s: number) => (h * 3600 + m * 60 + s) * 1000;

/** The events of design T: [offset ms or null, source, kind, name, value, text, detail]. */
const EVENT_ROWS: [number | null, string, string, string, number, string, string][] = [
  [hms(5, 0, 0), "BMS", "dtc", "P0CA700", 41, "Discharge current too high", "initial"],
  [hms(5, 0, 0), "BMS", "dtc", "P180D13", 105, "System shutoff. Circuit Open", "initial"],
  [hms(5, 0, 0), "BMS", "dtc", "P0C7800", 36, "Precharge too long", "initial"],
  [hms(5, 0, 0), "BMS", "dtc", "P1CA100", 40, "Insulation fault, open contactors", "initial"],
  [hms(5, 0, 0), "BMS", "dtc", "U019B00", 128, "Communication with on-board charger", "initial"],
  [hms(5, 0, 0), "BMS", "dtc", "P0C4600", 80, "Coolant temperature sensor sporadic", "initial"],
  [hms(5, 0, 0), "BMS", "dtc", "P0AA100", 64, "Positive contactor jammed closed", "initial"],
  [hms(5, 0, 0), "BMS", "dtc", "P0E1A00", 0, "Coolant pump B open circuit", "initial"],
  [hms(5, 0, 0), "BMS", "dtc", "P0FFF00", 3.5, "Odd status", "initial"],
  [hms(1, 0, 0), "VCU", "state", "VCU.door", 0, "closed", "initial"],
  [hms(1, 1, 30), "VCU", "state", "VCU.door", 0, "closed", "initial"],
  [hms(1, 3, 0), "VCU", "state", "VCU.door", 0, "open", "from closed"],
  [hms(1, 4, 30), "VCU", "state", "VCU.door", 0, "open", "initial"],
  [hms(2, 0, 0), "VCU", "state", "VCU.door", 0, "closed", "initial"],
  [hms(2, 0, 0), "VCU", "state", "DIAG.lock", 0, "locked", "initial"],
  [hms(3, 0, 0), "BMS", "nrc", "SID 22", 49, "requestOutOfRange", ""],
  [hms(3, 0, 1), "BMS", "isotp", "incomplete", 132, "", "132 of 403 bytes, then a new message"],
  [hms(4, 0, 0), "VCU", "note", "boot", 0, "logger restarted", ""],
  [null, "BMS", "dtc", "P0NULL0", 41, "", "initial"],
];
const quote = (text: string) => `'${text.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
const eventValues = EVENT_ROWS.map(
  ([offset, source, kind, name, value, text, detail]) =>
    `('testcar', 'test-diag', 'e1', ${offset === null ? "NULL" : `fromUnixTimestamp64Milli(toInt64(${BASE_MS + offset}), 'UTC')`}, ${quote(source)}, ${quote(kind)}, ${quote(name)}, ${value}, ${quote(text)}, ${quote(detail)})`,
).join(", ");

/** Rows of a text signal: [offset ms, text], value 0. */
const textSignal = (name: string, rows: [number, string][]) =>
  `INSERT INTO sdlog.signals (vehicle, device, chunk, signal, utc, value, text) VALUES ${rows
    .map(
      ([offset, text]) =>
        `('testcar', 'test-dev', 'c11', ${quote(name)}, fromUnixTimestamp64Milli(toInt64(${BASE_MS + offset}), 'UTC'), 0, ${quote(text)})`,
    )
    .join(", ")}`;

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
  "DROP TABLE IF EXISTS sdlog.events",
  "DROP TABLE IF EXISTS sdlog.conf_signals",
  "DROP TABLE IF EXISTS sdlog.conf_events",
  schema("signals", 3),
  schema("signals_ns", 9),
  schema("conf_signals", 9),
  eventsSchema("events", 3),
  eventsSchema("conf_events", 9),
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
    "signals",
    `SELECT 'drivecar', 'drive-dev', 'c10', 'Drv_A10h.TRICKLE', ${driveMs("number * 10000")}, number % 100
     FROM numbers(2161)`,
  ),
  ...DRIVE_BURSTS.map(([from, to]) =>
    insert(
      "signals",
      `SELECT 'drivecar', 'drive-dev', 'c10', 'Drv_A10h.FAST', ${driveMs(`${from * 1000} + number * 10`)}, number % 100
       FROM numbers(${(to - from) * 100})`,
    ),
  ),
  insert(
    "signals",
    `SELECT 'drivecar', 'drive-dev', 'c10', 'Drv_A10h.WAKE', ${driveMs(`${7200 * 1000} + number * 20`)}, number % 100
     FROM numbers(3000)`,
  ),
  // State signals (design T of add-events): MODE 0/3/15(SNA)/3/0 and 3 after a pause, TEMP with 254 = SENSOR_DEF.
  insert(
    "signals",
    `SELECT 'testcar', 'test-dev', 'c11', 'Ign_A20h.MODE', ${ms("3600000 + number * 100")},
       multiIf(number < 6000, 0, number < 24000, 3, number < 24010, 15, number < 36000, 3, 0)
     FROM numbers(54000)`,
  ),
  insert(
    "signals",
    `SELECT 'testcar', 'test-dev', 'c11', 'Ign_A20h.MODE', ${ms("9900000 + number * 100")}, 3
     FROM numbers(9000)`,
  ),
  insert(
    "signals",
    `SELECT 'testcar', 'test-dev', 'c11', 'Tmp_A21h.TEMP', ${ms("3600000 + number * 1000")},
       multiIf(number < 300, 20 + number % 10, number < 310, 254, 25)
     FROM numbers(600)`,
  ),
  textSignal("DIAG.door", [
    [hms(1, 0, 0), "closed"],
    [hms(1, 1, 30), "closed"],
    [hms(1, 3, 0), "open"],
    [hms(1, 4, 30), "open"],
    [hms(2, 0, 0), "closed"],
  ]),
  textSignal("DIAG.lock", [
    [hms(2, 0, 0), "locked"],
    [hms(2, 1, 30), "locked"],
  ]),
  `INSERT INTO sdlog.events (vehicle, device, chunk, utc, source, kind, name, value, text, detail) VALUES ${eventValues}`,
  // gapcar (design T of add-gap-display): n = row index; P1 pause, S1 silence of 1.9 s, P2 pause of 2.0 s, dropouts.
  insertGap(
    "Cyc_B10h.CYC",
    "number * 20",
    "number % 100",
    30000,
    `NOT (number >= 15000 AND number < 18000) AND NOT (number > 28500 AND number < 28595)
     AND NOT (number > 29000 AND number < 29100) AND NOT (number > 6005 AND number < 6030)
     AND number NOT IN (9006, 9007)`,
  ),
  `INSERT INTO sdlog.signals (vehicle, device, chunk, signal, utc, value) VALUES ${(
    [
      [30, 1],
      [240, 2],
      [420, 3],
      [540, 4],
    ] satisfies [number, number][]
  )
    .map(
      ([s, v]) =>
        `('gapcar', 'test-gap', 'g1', 'Evt_B11h.EVT', fromUnixTimestamp64Milli(toInt64(${GAP_BASE_MS + s * 1000}), 'UTC'), ${v})`,
    )
    .join(", ")}`,
  insertGap(
    "Msr_B12h.MSR",
    "number * 100",
    "number % 10",
    6000,
    `NOT (number >= 3000 AND number < 3600) AND NOT (number > 5700 AND number < 5719)
     AND NOT (number > 5800 AND number < 5820) AND NOT (number > 4800 AND number < 4810)`,
  ),
  insertGap(
    "TBMS.current",
    "number * 10000",
    "12.5",
    60,
    "NOT (number >= 30 AND number <= 35) AND number NOT IN (7, 8, 9, 11, 12, 13)",
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
  ["SELECT count() FROM sdlog.signals", "21942817"],
  [
    "SELECT count() FROM (SELECT DISTINCT vehicle, signal FROM sdlog.signals WHERE utc IS NOT NULL)",
    "1025",
  ],
  ["SELECT count() FROM sdlog.signals WHERE vehicle = 'gapcar'", "32187"],
  [
    "SELECT arrayStringConcat(arrayMap(s -> concat(s.1, ':', toString(s.2)), arraySort(groupArray((signal, n)))), ',') FROM (SELECT signal, count() AS n FROM sdlog.signals WHERE vehicle = 'gapcar' GROUP BY signal)",
    "Cyc_B10h.CYC:26781,Evt_B11h.EVT:4,Msr_B12h.MSR:5354,TBMS.current:48",
  ],
  [
    "SELECT toString(min(utc)) || ' ' || toString(max(utc)) FROM sdlog.signals WHERE vehicle = 'gapcar'",
    "2026-10-03 00:00:00.000 2026-10-03 00:09:59.980",
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
  ["SELECT count() FROM sdlog.signals WHERE vehicle = 'drivecar'", "233161"],
  [
    "SELECT toString(max(utc)) FROM sdlog.signals WHERE vehicle = 'drivecar'",
    "2026-10-02 06:00:00.000",
  ],
  ["SELECT toString(toUnixTimestamp64Nano(min(utc))) FROM sdlog.signals_ns", NS_BASE.toString()],
  ["SELECT count() FROM sdlog.events", "19"],
  ["SELECT count() FROM sdlog.conf_signals", "17082"],
  ["SELECT countIf(utc IS NOT NULL) FROM sdlog.conf_signals WHERE vehicle = 'conf-a'", "17069"],
  ["SELECT count() FROM sdlog.conf_signals WHERE vehicle = 'conf-b'", "12"],
  ["SELECT count() FROM (SELECT DISTINCT vehicle, signal FROM sdlog.conf_signals)", "8"],
  [
    "SELECT toString(toUnixTimestamp64Nano(min(utc))) FROM sdlog.conf_signals WHERE signal = 'Fine.NS'",
    "1791158400123456700",
  ],
  [
    "SELECT toString(toUnixTimestamp64Nano(min(utc))) FROM sdlog.conf_signals WHERE signal = 'Span.FAR'",
    "-1500000000",
  ],
  ["SELECT count() FROM sdlog.conf_events", "6"],
  ["SELECT count() FROM sdlog.conf_events WHERE utc IS NOT NULL", "5"],
  ["SELECT count() FROM sdlog.events WHERE utc IS NOT NULL", "18"],
  [
    "SELECT count() FROM sdlog.signals WHERE signal IN ('Ign_A20h.MODE', 'Tmp_A21h.TEMP', 'DIAG.door', 'DIAG.lock')",
    "63607",
  ],
  ["SELECT count() FROM sdlog.signals WHERE signal = 'Ign_A20h.MODE' AND value = 15", "10"],
  ["SELECT countIf(value = 254) FROM sdlog.signals WHERE signal = 'Tmp_A21h.TEMP'", "10"],
  [
    "SELECT arrayStringConcat(groupArray(text), ',') FROM (SELECT text FROM sdlog.signals WHERE signal = 'DIAG.door' ORDER BY utc)",
    "closed,closed,open,open,closed",
  ],
  [
    "SELECT arrayStringConcat(arraySort(groupArray(concat(kind, ':', toString(n)))), ',') FROM (SELECT kind, count() AS n FROM sdlog.events WHERE utc IS NOT NULL GROUP BY kind)",
    "dtc:9,isotp:1,note:1,nrc:1,state:6",
  ],
];

const started = Date.now();
for (const query of statements) {
  await client.command({ query, clickhouse_settings: { wait_end_of_query: 1 } });
}
// The conformance fixture (design C7 of add-adx-source), from the file the emulator seed uses too.
const confTime = (t: bigint | null) => (t === null ? null : formatTime(t, 9));
await client.insert({
  table: "sdlog.conf_signals",
  format: "JSONEachRow",
  values: fixtureRows().map((r) => ({
    vehicle: r.dataRef,
    device: "conf-dev",
    chunk: "conf1",
    signal: r.signal,
    utc: confTime(r.t),
    value: r.value,
    text: r.text,
  })),
});
await client.insert({
  table: "sdlog.conf_events",
  format: "JSONEachRow",
  values: fixtureEvents().map((e) => ({
    vehicle: e.dataRef,
    device: "conf-dev",
    chunk: "conf1",
    utc: confTime(e.t),
    source: e.source,
    kind: e.kind,
    name: e.name,
    value: e.value,
    text: e.text,
    detail: e.detail,
  })),
});
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
