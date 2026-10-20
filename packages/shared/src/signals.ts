import type { WorkspaceScope } from "./workspace.ts";

/** Where an SNA code is defined (D-010). */
export type SnaSource = "GenSigSNA" | "VAL_";

/** One "signal not available" code of a signal (D-010, D-012). */
export interface SnaValue {
  /** Raw code as unsigned bit pattern, e.g. 511 for "1FFh". */
  raw: number;
  /** Physical value as stored: raw (two's complement if signed) × factor + offset. */
  value: number;
  /** Definitions naming this code; "GenSigSNA" before "VAL_". Never empty. */
  sources: SnaSource[];
}

/** One `VAL_` entry. */
export interface DbcValueLabel {
  raw: number;
  label: string;
  /** Physical value: raw (two's complement if the signal is signed) × factor + offset, as SnaValue.value (D-012). */
  value: number;
}

/** DBC metadata of a signal (design E4). Fields absent when the DBC line could not be parsed. */
export interface DbcInfo {
  /** Basename of the DBC file the entry came from (first file wins), e.g. `h-can.dbc`. */
  file?: string;
  /** `BO_` message name, e.g. `ICL_3A2h`. */
  message: string;
  /** `BO_` ID as written (decimal; extended IDs keep bit 31), e.g. 930. */
  messageId: number;
  /** `BO_` transmitter (last token), e.g. `CGW`; absent for `Vector__XXX` or none written (D-053). */
  sender?: string;
  /** physical = raw × factor + offset. */
  factor?: number;
  offset?: number;
  /** `SG_` `[min|max]` as written, physical; `[0|0]` passed through. */
  min?: number;
  max?: number;
  /** `VAL_` table sorted by raw ascending; absent (never empty) when none. */
  values?: DbcValueLabel[];
  /** `GenMsgCycleTime` of the signal's message in ms, > 0; absent for 0 or none (D-062). */
  cycleMs?: number;
}

/** One scale row of a diagnostic catalog field (raw bounds inclusive), D-061. */
export interface DiagScaleRow {
  low: number;
  high: number;
  text: string;
}

/** Diagnostic catalog metadata of a signal (D-061, design M1). */
export interface DiagInfo {
  /** Basename of the manifest, e.g. `bms-live.manifest.json`. */
  file: string;
  /** `ecu.name`, the signal's prefix, e.g. `BMS`. */
  ecu: string;
  /** Group (canonical name) and its DID, e.g. `DT_Contactor_Contactor_State`, 53248. */
  group: string;
  did: number;
  /** Field name in the catalog, e.g. `PRES_Contactor_State`. */
  field: string;
  /** Array fields only: 1-based element, as in the name suffix. */
  element?: number;
  /** `enum` field; `text` for ASCII or hexdump (value NaN, text in the row); else `number`. */
  kind: "number" | "enum" | "text";
  /**
   * Enum fields: the valid rows with a text, table order; absent when none. The decoder stores
   * value 0 for these rows (factor 0) and the state in the row's text: match by text, not value.
   */
  states?: DiagScaleRow[];
  /** Rows marked invalid, table order; absent when none. Never stored (the decoder drops them), not SNA codes. */
  invalid?: DiagScaleRow[];
  /** The group's `interval` in ms, > 0; absent for `never` or none (D-062). */
  intervalMs?: number;
}

/** A signal in the catalog. Optional fields are absent (not empty) when the metadata is unknown. */
export interface SignalInfo {
  /** Stable ID: `<dataRef>/<name>`, e.g. `smart451/ENG_2E8h.MOT_SPD_D`. */
  id: string;
  /** Data reference the signal belongs to (for vehicle data: the vehicle). */
  dataRef: string;
  /** Name as stored in the source. */
  name: string;
  description?: string;
  alias?: string;
  unit?: string;
  /** SNA codes sorted by raw ascending; absent (never empty) when none is defined. */
  sna?: SnaValue[];
  /** Absent when the signal has no DBC entry. */
  dbc?: DbcInfo;
  /** Absent when the signal has no diagnostic catalog field, or a DBC entry won (design M5). */
  diag?: DiagInfo;
  /** Name the UI shows (D-035); absent when it equals `name`. Never used as identity. */
  displayName?: string;
  /** Explorer group from `display.groups` (D-053); absent means OTHER_GROUP. Never "Other", never blank. */
  group?: string;
  /**
   * "labels": a VAL_ name on a code that is not SNA; "text": the state is in the row text (rows
   * carry text, or diag.kind "enum", D-061; not diag.kind "text"). Absent: no states (D-059, design N1).
   */
  states?: "labels" | "text";
}

/** `displayName ?? name`. */
export function shownName(s: Pick<SignalInfo, "name" | "displayName">): string {
  return s.displayName ?? s.name;
}

/** Group of signals without a group (D-053); always last. */
export const OTHER_GROUP = "Other";

/** `group ?? OTHER_GROUP`. */
export function groupOf(s: Pick<SignalInfo, "group">): string {
  return s.group ?? OTHER_GROUP;
}

/** `GET /api/catalog` (design E3). */
export interface CatalogSnapshot {
  /** Every signal, catalog order (name, then dataRef). */
  items: SignalInfo[];
  /** ISO time of the catalog load. */
  loadedAt: string;
  /** The scope this list belongs to; absent for the full catalog. */
  scope?: WorkspaceScope;
  /** Object scope only: the list is the last linked session's while the vehicle's own list loads (add-case-open K11). */
  partial?: true;
}

export interface SignalPage {
  items: SignalInfo[];
  /** Number of all matches, of which `items` is one page. */
  total: number;
  /** True when matches exist beyond this page. */
  more: boolean;
}

export function signalId(dataRef: string, name: string): string {
  return `${dataRef}/${name}`;
}

/** Splits at the first `/`; data references never contain one, signal names may. */
export function parseSignalId(id: string): { dataRef: string; name: string } | undefined {
  const slash = id.indexOf("/");
  if (slash <= 0 || slash === id.length - 1) return undefined;
  return { dataRef: id.slice(0, slash), name: id.slice(slash + 1) };
}
