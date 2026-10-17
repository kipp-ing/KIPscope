/**
 * The portable conformance fixture (design C7 of add-adx-source): the rows every source is seeded with
 * and the suite (`suite.ts`) reads its expectations from. Both seeds (`seed-test-db.ts`, `seed-adx.ts`)
 * and the suite import this file; the suite never reads an expectation back from a source.
 *
 * B = 2026-10-05T00:00:00Z. Every time is a multiple of 100 ns (ADX `datetime` resolution).
 *
 * | Data ref / signal | Rows |
 * | conf-a/Lin.RAMP   | n = 0 … 9,999 at B + n·10 ms, value n; plus one row with null time, value −1 |
 * | conf-a/Sna.CODE   | n = 0 … 99 at B + n s, value 7 for 40 ≤ n ≤ 49, else n mod 5 |
 * | conf-a/State.MODE | n = 0 … 599 at B + n·100 ms: 0 (n < 100), 3 (< 300), 15 (< 305), 3 (< 400), 0 |
 * | conf-a/Diag.door  | value 0, text closed, closed, open, open, closed at B + 0, 90, 180, 270, 360 s |
 * | conf-a/Fine.NS    | k = 0 … 999 at B + 123,456,700 + k·1,100 ns, value k |
 * | conf-a/Beat.HB    | k = 0 … 5,999 at B + k·100 ms, value k mod 2, none in (200 s, 260 s), (400 s, 401.9 s),
 * |                   | (500 s, 502 s): 5,364 rows |
 * | conf-b/Lin.RAMP   | n = 0 … 9 at B + n s, value 100 + n |
 * | conf-b/Span.FAR   | −1,500,000,000 ns value 1; 500,000,000 ns value 2 |
 *
 * conf-a: 17,069 timestamped rows (+ 1 without time); conf-b: 12 rows; 17,082 rows in all.
 */

/** 2026-10-05T00:00:00Z in ns. */
export const B = 1791158400000000000n;

const MS = 1_000_000n;
const S = 1_000_000_000n;

export interface FixtureRow {
  dataRef: string;
  signal: string;
  /** ns since 1970; null: a row without a time. */
  t: bigint | null;
  value: number;
  text: string;
}

export interface FixtureEvent {
  dataRef: string;
  t: bigint | null;
  source: string;
  kind: string;
  name: string;
  value: number;
  text: string;
  detail: string;
}

/** Counts of the fixture (design C7). */
export const FIXTURE_COUNTS = {
  confATimed: 17_069,
  confAUntimed: 1,
  confB: 12,
  total: 17_082,
} as const;

/** The 8 listed signals, ordered by data ref and name. */
export const FIXTURE_SIGNALS: { dataRef: string; name: string; text: boolean }[] = [
  { dataRef: "conf-a", name: "Beat.HB", text: false },
  { dataRef: "conf-a", name: "Diag.door", text: true },
  { dataRef: "conf-a", name: "Fine.NS", text: false },
  { dataRef: "conf-a", name: "Lin.RAMP", text: false },
  { dataRef: "conf-a", name: "Sna.CODE", text: false },
  { dataRef: "conf-a", name: "State.MODE", text: false },
  { dataRef: "conf-b", name: "Lin.RAMP", text: false },
  { dataRef: "conf-b", name: "Span.FAR", text: false },
];

/** All fixture rows (17,082). */
export function fixtureRows(): FixtureRow[] {
  const rows: FixtureRow[] = [];
  const add = (dataRef: string, signal: string, t: bigint | null, value: number, text = "") =>
    rows.push({ dataRef, signal, t, value, text });

  for (let n = 0; n < 10_000; n++) add("conf-a", "Lin.RAMP", B + BigInt(n) * 10n * MS, n);
  add("conf-a", "Lin.RAMP", null, -1);

  for (let n = 0; n < 100; n++)
    add("conf-a", "Sna.CODE", B + BigInt(n) * S, n >= 40 && n <= 49 ? 7 : n % 5);

  for (let n = 0; n < 600; n++) {
    const value = n < 100 ? 0 : n < 300 ? 3 : n < 305 ? 15 : n < 400 ? 3 : 0;
    add("conf-a", "State.MODE", B + BigInt(n) * 100n * MS, value);
  }

  const door = ["closed", "closed", "open", "open", "closed"];
  for (const [i, text] of door.entries())
    add("conf-a", "Diag.door", B + BigInt(i * 90) * S, 0, text);

  for (let k = 0; k < 1000; k++) add("conf-a", "Fine.NS", B + 123_456_700n + BigInt(k) * 1100n, k);

  for (let k = 0; k < 6000; k++) {
    // Silences in tenths of a second: (2000, 2600), (4000, 4019), (5000, 5020), all open.
    if ((k > 2000 && k < 2600) || (k > 4000 && k < 4019) || (k > 5000 && k < 5020)) continue;
    add("conf-a", "Beat.HB", B + BigInt(k) * 100n * MS, k % 2);
  }

  for (let n = 0; n < 10; n++) add("conf-b", "Lin.RAMP", B + BigInt(n) * S, 100 + n);
  add("conf-b", "Span.FAR", -1_500_000_000n, 1);
  add("conf-b", "Span.FAR", 500_000_000n, 2);
  return rows;
}

/** The events of `conf-a`, one of them without a time. */
export function fixtureEvents(): FixtureEvent[] {
  const ev = (
    t: bigint | null,
    source: string,
    kind: string,
    name: string,
    value: number,
    text: string,
    detail: string,
  ): FixtureEvent => ({ dataRef: "conf-a", t, source, kind, name, value, text, detail });
  return [
    ev(B, "VCU", "state", "Diag.door", 0, "closed", "initial"),
    ev(B + 180n * S, "VCU", "state", "Diag.door", 0, "open", "from closed"),
    ev(B + 300n * S, "BMS", "dtc", "P0CA700", 41, "Discharge current too high", "initial"),
    ev(B + 300n * S, "BMS", "dtc", "P0AA100", 64, "Positive contactor jammed closed", "initial"),
    ev(B + 300n * S, "BMS", "nrc", "SID 22", 49, "requestOutOfRange", ""),
    ev(null, "BMS", "dtc", "P0NULL0", 41, "", "initial"),
  ];
}

const floorDiv = (a: bigint, b: bigint) => (a % b === 0n || a >= 0n ? a / b : a / b - 1n);

/** `YYYY-MM-DD hh:mm:ss.fffffffff` (UTC) with `digits` fraction digits (nanoseconds cut, not rounded). */
export function formatTime(t: bigint, digits: number, separator = " "): string {
  const seconds = floorDiv(t, S);
  const nanos = t - seconds * S;
  const iso = new Date(Number(seconds) * 1000).toISOString(); // YYYY-MM-DDTHH:MM:SS.000Z
  const fraction = nanos.toString().padStart(9, "0").slice(0, digits);
  return `${iso.slice(0, 10)}${separator}${iso.slice(11, 19)}${digits > 0 ? `.${fraction}` : ""}`;
}
