/**
 * Seeds the Kusto emulator (docker compose profile `adx`, design C8 of add-adx-source) with the
 * conformance fixture of test/conformance/fixture.ts, the same rows as `sdlog.conf_signals` and
 * `sdlog.conf_events` in the test ClickHouse. Idempotent: drops and refills the tables.
 *
 * Database `kipscope_test` (persistent, created once), default layout of design C5:
 * - `signals`   dataref, signal, timestamp (datetime), value (real), text      17,082 rows
 * - `events`    dataref, timestamp, source, kind, name, value, text, detail     6 rows
 * - `KRenamed`  the signal rows under other column names (Device, Name, EventTime, Val, Txt) and the
 *               function `KSignals()` that renames them back to the default layout, for the test
 *               "reads through a stored function".
 * - `KMeta`     dataref, signal, timestamp (datetime), value (real), text, unit      22 rows
 *               row metadata (units per data ref, SNA texts) of add-adx-row-metadata R7, outside the
 *               conformance fixture.
 *
 * Seeds only a loopback emulator: a non-loopback TEST_ADX_URL stops the script before anything is sent.
 * Run: docker compose --profile adx up -d && pnpm --filter @kipscope/server seed:adx
 */
import {
  B,
  FIXTURE_COUNTS,
  fixtureEvents,
  fixtureRows,
  formatTime,
} from "../test/conformance/fixture.ts";

const url = (process.env.TEST_ADX_URL || "http://127.0.0.1:8125").replace(/\/+$/, "");
const DATABASE = "kipscope_test";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
if (!LOOPBACK.has(new URL(url).hostname.toLowerCase())) {
  console.error(
    `seed-adx: TEST_ADX_URL ${url} is not a loopback address; seed-adx seeds only a loopback emulator (localhost, 127.0.0.1, [::1])`,
  );
  process.exit(1);
}

async function post(path: string, db: string, csl: string): Promise<unknown> {
  const response = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", Accept: "application/json" },
    body: JSON.stringify({ db, csl }),
  });
  const body = await response.text();
  if (!response.ok)
    throw new Error(`${csl.slice(0, 80)}: HTTP ${response.status} ${body.slice(0, 400)}`);
  return JSON.parse(body);
}

/** Rows of the first table of a v1 management answer. */
async function mgmt(db: string, csl: string): Promise<unknown[][]> {
  const answer = (await post("/v1/rest/mgmt", db, csl)) as { Tables: { Rows: unknown[][] }[] };
  return answer.Tables[0]?.Rows ?? [];
}

/** Rows of the first table of a v1 query answer. */
async function query(db: string, csl: string): Promise<unknown[][]> {
  const answer = (await post("/v1/rest/query", db, csl)) as { Tables: { Rows: unknown[][] }[] };
  return answer.Tables[0]?.Rows ?? [];
}

const csvField = (text: string) =>
  /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
const adxTime = (t: bigint | null) => (t === null ? "" : `${formatTime(t, 7, "T")}Z`);

async function ingest(table: string, lines: string[]) {
  const chunk = 2500;
  for (let i = 0; i < lines.length; i += chunk) {
    await mgmt(
      DATABASE,
      `.ingest inline into table ${table} <|\n${lines.slice(i, i + chunk).join("\n")}`,
    );
  }
}

/**
 * The 22 rows of `KMeta` (design R7 of add-adx-row-metadata), S = 1 s:
 * - meta-a/Spd.V    n = 0 … 9 at B + n·S, value 10·n; n = 3, 4: value 255, text SNA; n = 7: value 254,
 *                   text INVLD; unit km/h for n <= 4, empty after
 * - meta-a/Gear.POS k = 0 … 3 at B + 10·k·S, value k, text P, D, SNA, R, no unit
 * - meta-a/Flag.ERR k = 0 … 4 at B + k·S, value k mod 2, text SNA at k = 2, no unit
 * - meta-b/Spd.V    k = 0 … 2 at B + k·S, value 1, no text, unit mph
 * CSV fields: dataref, signal, timestamp, value, text, unit.
 */
function metaRows(): string[][] {
  const S = 1_000_000_000n;
  const row = (
    ref: string,
    signal: string,
    t: bigint,
    value: number,
    text: string,
    unit: string,
  ) => [ref, signal, adxTime(t), String(value), text, unit];
  const rows: string[][] = [];
  for (let n = 0; n < 10; n++) {
    const sentinel = n === 3 || n === 4 ? "SNA" : n === 7 ? "INVLD" : "";
    const value = n === 3 || n === 4 ? 255 : n === 7 ? 254 : 10 * n;
    rows.push(row("meta-a", "Spd.V", B + BigInt(n) * S, value, sentinel, n <= 4 ? "km/h" : ""));
  }
  const gear = ["P", "D", "SNA", "R"];
  for (const [k, text] of gear.entries())
    rows.push(row("meta-a", "Gear.POS", B + BigInt(10 * k) * S, k, text, ""));
  for (let k = 0; k < 5; k++)
    rows.push(row("meta-a", "Flag.ERR", B + BigInt(k) * S, k % 2, k === 2 ? "SNA" : "", ""));
  for (let k = 0; k < 3; k++) rows.push(row("meta-b", "Spd.V", B + BigInt(k) * S, 1, "", "mph"));
  return rows;
}

const started = Date.now();
const databases = (await mgmt("NetDefaultDB", ".show databases | project DatabaseName")).map(
  (row) => row[0],
);
if (!databases.includes(DATABASE)) {
  await mgmt(
    "NetDefaultDB",
    `.create database ${DATABASE} persist (@"/kustodata/dbs/${DATABASE}/md", @"/kustodata/dbs/${DATABASE}/data")`,
  );
}

for (const table of ["signals", "events", "KRenamed", "KMeta"]) {
  await mgmt(DATABASE, `.drop table ${table} ifexists`);
}
await mgmt(
  DATABASE,
  ".create table signals (dataref: string, signal: string, timestamp: datetime, value: real, text: string)",
);
await mgmt(
  DATABASE,
  ".create table events (dataref: string, timestamp: datetime, source: string, ['kind']: string, name: string, value: real, text: string, detail: string)",
);
await mgmt(
  DATABASE,
  ".create table KRenamed (Device: string, Name: string, EventTime: datetime, Val: real, Txt: string)",
);

await mgmt(
  DATABASE,
  ".create table KMeta (dataref: string, signal: string, timestamp: datetime, value: real, text: string, unit: string)",
);

const rows = fixtureRows();
const signalLines = rows.map((r) =>
  [r.dataRef, r.signal, adxTime(r.t), String(r.value), r.text].map(csvField).join(","),
);
await ingest("signals", signalLines);
await ingest("KRenamed", signalLines);
await ingest(
  "events",
  fixtureEvents().map((e) =>
    [e.dataRef, adxTime(e.t), e.source, e.kind, e.name, String(e.value), e.text, e.detail]
      .map(csvField)
      .join(","),
  ),
);
await ingest(
  "KMeta",
  metaRows().map((r) => r.map(csvField).join(",")),
);
await mgmt(
  DATABASE,
  `.create-or-alter function KSignals() {
    KRenamed | project dataref = Device, signal = Name, timestamp = EventTime, value = Val, text = Txt
  }`,
);
console.log(`seeded ${DATABASE} on ${url} in ${((Date.now() - started) / 1000).toFixed(1)} s`);

/** Spot checks: query → expected single value. */
const checks: [string, string][] = [
  ["signals | count", String(FIXTURE_COUNTS.total)],
  ["KSignals() | count", String(FIXTURE_COUNTS.total)],
  ["signals | where dataref == 'conf-a' and isnotnull(timestamp) | count", "17069"],
  ["signals | where dataref == 'conf-b' | count", "12"],
  ["signals | distinct dataref, signal | count", "8"],
  [
    "signals | where signal == 'Fine.NS' | summarize tostring(tolong(min(timestamp) - datetime(1970-01-01)) * 100)",
    "1791158400123456700",
  ],
  ["events | count", "6"],
  ["events | where isnotnull(timestamp) | count", "5"],
  ["KMeta | count", "22"],
  // Spd.V 3 (n = 3, 4 SNA, n = 7 INVLD) + Gear.POS 1 + Flag.ERR 1 = 5 (design R7 says 4: it misses Flag.ERR).
  ["KMeta | where text in ('SNA','INVLD') | count", "5"],
];
let failed = 0;
for (const [csl, expected] of checks) {
  const actual = String((await query(DATABASE, csl))[0]?.[0]);
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${csl}\n     expected ${expected}, got ${actual}`);
}
if (failed) process.exit(1);
