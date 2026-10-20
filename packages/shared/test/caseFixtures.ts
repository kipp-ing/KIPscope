import type { CaseCatalog, CaseEntry } from "../src/case.ts";

/**
 * Catalog C4 of add-case-open design "Test fixtures" (times 2026-10-01 UTC, pad 60 s), by hand:
 * 2026-10-01T00:00:00Z = 1790812800 s, so 01:00:00 = 1790816400 s, 04:50:00 = 1790830200 s.
 */
export const NS = 1_000_000_000n;
export const MIN = 60n * NS;
export const DAY = 24n * 60n * MIN;
export const PAD = 60n * NS;
/** Seconds of 2026-10-01T00:00:00Z. */
export const B = 1790812800n;
/** Decimal ns of 2026-10-01 + h:m:s. */
export const at = (h: number, m: number, s = 0): string =>
  String((B + BigInt(h * 3600 + m * 60 + s)) * NS);

/** The document as a search tool would send it (ISO times, unknown key `extra`). */
export const C4_DOC = {
  kipscope: "cases",
  version: 1,
  extra: "dropped",
  cases: [
    {
      id: "testcar|driving|2026-10-01T01:00:00Z",
      object: "testcar",
      kind: "driving",
      from: "2026-10-01T01:00:00Z",
      to: "2026-10-01T01:10:00Z",
      meta: { distance_km: 6.2 },
    },
    {
      id: "othercar|driving|2026-10-01T00:00:00Z",
      object: "othercar",
      kind: "driving",
      from: "2026-10-01T00:00:00Z",
      to: "2026-10-01T00:00:01Z",
    },
    {
      id: "testcar|charging|2026-10-01T04:50:00Z",
      object: "testcar",
      kind: "charging",
      from: "2026-10-01T04:50:00Z",
      to: "2026-10-01T05:10:00Z",
      anchor: "2026-10-01T04:55:00Z",
    },
    {
      id: "testcar|idle|2026-10-01T04:58:00Z",
      object: "testcar",
      kind: "idle",
      from: "2026-10-01T04:58:00Z",
      to: "2026-10-01T05:02:00Z",
    },
  ],
};

/** C4 after the server normalised it (K2 CaseEntry; decimal ns; data ref = object). */
export const C4_ENTRIES: CaseEntry[] = [
  {
    id: "testcar|driving|2026-10-01T01:00:00Z",
    object: "testcar",
    dataRef: "testcar",
    kind: "driving",
    from: "1790816400000000000",
    to: "1790817000000000000",
    meta: { distance_km: 6.2 },
  },
  {
    id: "othercar|driving|2026-10-01T00:00:00Z",
    object: "othercar",
    dataRef: "othercar",
    kind: "driving",
    from: "1790812800000000000",
    to: "1790812801000000000",
  },
  {
    id: "testcar|charging|2026-10-01T04:50:00Z",
    object: "testcar",
    dataRef: "testcar",
    kind: "charging",
    from: "1790830200000000000",
    to: "1790831400000000000",
    anchor: "1790830500000000000",
  },
  {
    id: "testcar|idle|2026-10-01T04:58:00Z",
    object: "testcar",
    dataRef: "testcar",
    kind: "idle",
    from: "1790830680000000000",
    to: "1790830920000000000",
  },
];

export const C4: CaseCatalog = { catalogId: "c4c4c4c4c4", entries: C4_ENTRIES };

export const entryAt = (index: number): CaseEntry => C4_ENTRIES[index] as CaseEntry;
