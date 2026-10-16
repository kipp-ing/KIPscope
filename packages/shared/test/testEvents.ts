import type { DiagEvent, EventCategory } from "../src/events.ts";

/** 2026-10-01T00:00:00Z in ns (design T base B). */
export const BASE_NS = BigInt(Date.UTC(2026, 9, 1)) * 1_000_000n;

/** Decimal ns of B + h:m:s (+ ms). */
export function at(h: number, m: number, s: number, ms = 0): string {
  return String(BASE_NS + BigInt(((h * 60 + m) * 60 + s) * 1000 + ms) * 1_000_000n);
}

function ev(
  t: string,
  category: EventCategory,
  kind: string,
  source: string,
  name: string,
  value: number,
  text: string,
  detail: string,
  extra: Partial<DiagEvent> = {},
): DiagEvent {
  return { t, category, kind, source, name, text, detail, value, ...extra };
}

/**
 * The 18 testcar events of design T (row 19, null time, is never returned), in time order
 * (ties: kind, source, name), as the server derives them.
 */
export const TESTCAR_EVENTS: DiagEvent[] = [
  ev(at(1, 0, 0), "snapshot", "state", "VCU", "VCU.door", 0, "closed", "initial"),
  ev(at(1, 1, 30), "snapshot", "state", "VCU", "VCU.door", 0, "closed", "initial"),
  ev(at(1, 3, 0), "change", "state", "VCU", "VCU.door", 0, "open", "from closed", {
    from: { text: "closed", t: at(1, 1, 30) },
  }),
  ev(at(1, 4, 30), "snapshot", "state", "VCU", "VCU.door", 0, "open", "initial"),
  ev(at(2, 0, 0), "snapshot", "state", "VCU", "DIAG.lock", 0, "locked", "initial"),
  ev(at(2, 0, 0), "change", "state", "VCU", "VCU.door", 0, "closed", "initial", {
    from: { text: "open", t: at(1, 4, 30) },
    inferred: true,
  }),
  ev(at(3, 0, 0), "refused", "nrc", "BMS", "SID 22", 49, "requestOutOfRange", ""),
  ev(
    at(3, 0, 1),
    "transport",
    "isotp",
    "BMS",
    "incomplete",
    132,
    "",
    "132 of 403 bytes, then a new message",
  ),
  ev(at(4, 0, 0), "other", "note", "VCU", "boot", 0, "logger restarted", ""),
  ev(
    at(5, 0, 0),
    "untested",
    "dtc",
    "BMS",
    "P0AA100",
    64,
    "Positive contactor jammed closed",
    "initial",
    {
      status: "0x40 not tested this cycle",
    },
  ),
  ev(
    at(5, 0, 0),
    "untested",
    "dtc",
    "BMS",
    "P0C4600",
    80,
    "Coolant temperature sensor sporadic",
    "initial",
    {
      status: "0x50 not tested since clear · not tested this cycle",
    },
  ),
  ev(at(5, 0, 0), "active", "dtc", "BMS", "P0CA700", 41, "Discharge current too high", "initial", {
    status: "0x29 failing now · confirmed · failed since clear",
  }),
  ev(at(5, 0, 0), "pending", "dtc", "BMS", "P0C7800", 36, "Precharge too long", "initial", {
    status: "0x24 pending · failed since clear",
  }),
  ev(at(5, 0, 0), "passed", "dtc", "BMS", "P0E1A00", 0, "Coolant pump B open circuit", "initial", {
    status: "0x00",
  }),
  ev(at(5, 0, 0), "other", "dtc", "BMS", "P0FFF00", 3.5, "Odd status", "initial"),
  ev(
    at(5, 0, 0),
    "stored",
    "dtc",
    "BMS",
    "P1CA100",
    40,
    "Insulation fault, open contactors",
    "initial",
    {
      status: "0x28 confirmed · failed since clear",
    },
  ),
  ev(
    at(5, 0, 0),
    "active",
    "dtc",
    "BMS",
    "P180D13",
    105,
    "System shutoff. Circuit Open",
    "initial",
    {
      status: "0x69 failing now · confirmed · failed since clear · not tested this cycle",
    },
  ),
  ev(
    at(5, 0, 0),
    "stored",
    "dtc",
    "BMS",
    "U019B00",
    128,
    "Communication with on-board charger",
    "initial",
    {
      status: "0x80 warning lamp",
    },
  ),
];
