import type { DiagEvent, EventCategory } from "@kipscope/shared";

/** Test events (design T names) at ns offsets; the real server derives these (see the server tests). */
export function fakeEvent(
  t: bigint,
  category: EventCategory,
  over: Partial<DiagEvent> = {},
): DiagEvent {
  return {
    t: t.toString(),
    category,
    kind: "dtc",
    source: "BMS",
    name: "P0000",
    text: "",
    detail: "initial",
    value: 0,
    ...over,
  };
}

/** 2026-10-01T00:00:00Z in ns (design T base B). */
export const BASE_NS = BigInt(Date.UTC(2026, 9, 1)) * 1_000_000n;

/** Decimal-ns offset of B + h:m:s (+ ms). */
export function atB(h: number, m: number, s: number, ms = 0): bigint {
  return BASE_NS + BigInt(((h * 60 + m) * 60 + s) * 1000 + ms) * 1_000_000n;
}

/** The nine DTCs of testcar (design T rows 1-9), all at 05:00:00, in server order (by name). */
export const TESTCAR_DTCS: DiagEvent[] = [
  ["P0AA100", "untested", 64, "Positive contactor jammed closed", "0x40 not tested this cycle"],
  [
    "P0C4600",
    "untested",
    80,
    "Coolant temperature sensor sporadic",
    "0x50 not tested since clear · not tested this cycle",
  ],
  ["P0C7800", "pending", 36, "Precharge too long", "0x24 pending · failed since clear"],
  [
    "P0CA700",
    "active",
    41,
    "Discharge current too high",
    "0x29 failing now · confirmed · failed since clear",
  ],
  ["P0E1A00", "passed", 0, "Coolant pump B open circuit", "0x00"],
  ["P0FFF00", "other", 3.5, "Odd status", undefined],
  [
    "P180D13",
    "active",
    105,
    "System shutoff. Circuit Open",
    "0x69 failing now · confirmed · failed since clear · not tested this cycle",
  ],
  [
    "P1CA100",
    "stored",
    40,
    "Insulation fault, open contactors",
    "0x28 confirmed · failed since clear",
  ],
  ["U019B00", "stored", 128, "Communication with on-board charger", "0x80 warning lamp"],
].map(([name, category, value, text, status]) =>
  fakeEvent(atB(5, 0, 0), category as EventCategory, {
    name: name as string,
    value: value as number,
    text: text as string,
    ...(status ? { status: status as string } : {}),
  }),
);
