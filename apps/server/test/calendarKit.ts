/**
 * Shared bits of the vehicle-day tests (speed-up-whole-scans B6, range-picker "Calendar days
 * counted at the lowest priority"): hand-computed day constants, a small in-memory vehicle, and
 * waiting for the idle fill to finish.
 */
import { expect } from "vitest";
import type { MemorySignal } from "./scopeApp.ts";

export const S = 1_000_000_000n;
export const HOUR = 3_600n * S;
export const DAY = 86_400n * S;
/** 2026-10-01T00:00:00Z = 1790812800 s, by hand. */
export const OCT1 = 1790812800n * S;
export const OCT2 = OCT1 + DAY;
/** 2026-09-30T00:00:00Z. */
export const SEP30 = OCT1 - DAY;
/** Width of the calendar's grid. */
export const WIDTH_60S = 60n * S;

/** The UTC day start of an ISO date `YYYY-MM-DD`, in ns. */
export const dayNs = (date: string): bigint => BigInt(Date.parse(`${date}T00:00:00Z`)) * 1_000_000n;

/** Lets promise callbacks and the queue's follow-up picks run; not a timer wait. */
export const settle = async () => {
  for (let i = 0; i < 30; i++) await new Promise((resolve) => setImmediate(resolve));
};

/**
 * testcar with three rows at 2026-10-01 01:00:00, :01 and :02 and two at 2026-10-02 02:00:00 and
 * :01 (all UTC), as the in-memory adapter holds them. The calendar's `hours` from 2026-10-01T00:00Z
 * are therefore 3 at index 1 and 2 at index 26.
 */
export const TESTCAR_ROWS: MemorySignal[] = [
  {
    dataRef: "testcar",
    name: "S",
    rows: [
      [OCT1 + HOUR, 1],
      [OCT1 + HOUR + S, 2],
      [OCT1 + HOUR + 2n * S, 3],
      [OCT2 + 2n * HOUR, 4],
      [OCT2 + 2n * HOUR + S, 5],
    ],
  },
];

/** Query string of a calendar request for an ISO window. */
export const calendarUrl = (from: string, to: string, dataRef = "testcar") =>
  `/api/calendar?dataRef=${dataRef}&from=${from}&to=${to}`;

/** A short wait on real timers, between two asks of a source that does real I/O. */
export const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 15));

/**
 * Asks `get` again (time moves through `step`: real by default, `settle` under fake timers) until
 * the answer has no `pending`; returns that answer. Fails after `rounds` asks.
 */
export async function untilCounted<T extends { status: number; body: { pending?: unknown } }>(
  get: () => Promise<T>,
  step: () => Promise<void> = pause,
  rounds = 600,
): Promise<T> {
  for (let i = 0; i < rounds; i++) {
    const answer = await get();
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    if (answer.body.pending === undefined) return answer;
    await step();
  }
  throw new Error("calendar days were still pending");
}
