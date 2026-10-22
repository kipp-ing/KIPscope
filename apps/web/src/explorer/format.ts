import {
  type Digits,
  formatQuantity,
  type SignalInfo,
  type WorkspaceWindow,
  windowTitle,
} from "@kipscope/shared";

/** Rest time on a row (pointer or keyboard) before its card opens (design E7). */
export const HOVER_DELAY_MS = 350;
/** Time the card stays after the pointer left both row and card (design E7). */
export const HIDE_GRACE_MS = 150;
/** Rows rendered per chunk; "Show N more" renders the next one (design E6). */
export const CHUNK = 500;
/** "Add to" target value for a new window (design E10). */
export const NEW_WINDOW = "new";

/** Rows to render: all matches, at most `shown` (a multiple of CHUNK). */
export function visibleCount(total: number, shown: number): number {
  return Math.min(total, shown);
}

/** `shown` after "Show N more": one chunk more, at most all matches. */
export function nextShown(total: number, shown: number): number {
  return Math.min(total, shown + CHUNK);
}

/** `× 1 + 0`, `× 0.5 + 0`, `× 1 - 40`. */
export function formatScaling(factor: number, offset: number): string {
  return `× ${String(factor)} ${offset < 0 ? "-" : "+"} ${String(Math.abs(offset))}`;
}

/** Physical value of one raw step: `0.5 1/min`, `2` (no unit). */
export function formatRawStep(factor: number, unit: string | undefined): string {
  return withUnit(String(Math.abs(factor)), unit);
}

/**
 * `0 … 510 km/h`, `-40.0 … 214 °C` by number-format; the unit once when both ends share it (or
 * the minimum is 0), else after each end. `[0|0]` (no range given in the DBC) → `not set`.
 */
export function formatDbcRange(
  min: number,
  max: number,
  unit: string | undefined,
  digits: Digits,
): string {
  if (min === 0 && max === 0) return "not set";
  const low = formatQuantity(min, unit, digits);
  const high = formatQuantity(max, unit, digits);
  const [lowNumber, lowUnit] = splitQuantity(low);
  const [, highUnit] = splitQuantity(high);
  return min === 0 || lowUnit === highUnit ? `${lowNumber} … ${high}` : `${low} … ${high}`;
}

/** Physical value of an SNA code by number-format: `8.19 k1/min`, `511 km/h`. */
export function formatSnaPhysical(value: number, unit: string | undefined, digits: Digits): string {
  return formatQuantity(value, unit, digits);
}

/** CAN ID in hex: `0x3A2`; an extended ID (bit 31 set) without bit 31 plus `(ext)`. */
export function formatMessageId(id: number): string {
  if (id >= 0x80000000) return `${hex(id - 0x80000000)} (ext)`;
  return hex(id);
}

/**
 * `<dataRef> · <file>`, `<dataRef> · DBC` without file, a diag signal's catalog as
 * `<dataRef> · <manifest> (<ecu> diag)` (D-061); without either a unit can only come from the
 * table (D-100), so `<dataRef> · unit from the table`, and `<dataRef> · no DBC entry` without a unit.
 */
export function formatSource(signal: SignalInfo): string {
  const diag = signal.diag;
  if (!signal.dbc && diag)
    return `${signal.dataRef} · ${diag.file.replace(/\.manifest\.json$/, "")} (${diag.ecu} diag)`;
  if (!signal.dbc && signal.unit) return `${signal.dataRef} · unit from the table`;
  if (!signal.dbc) return `${signal.dataRef} · no DBC entry`;
  return `${signal.dataRef} · ${signal.dbc.file ?? "DBC"}`;
}

/** Titles of the windows showing the signal, in window order. */
export function windowsShowing(windows: WorkspaceWindow[], signalId: string): string[] {
  return windows.filter((w) => w.signals.some((s) => s.signalId === signalId)).map(windowTitle);
}

/** The "Add to" target after a window change: kept while its window exists, else NEW_WINDOW. */
export function resolveTarget(target: string, windows: WorkspaceWindow[]): string {
  if (target === NEW_WINDOW || windows.some((w) => w.id === target)) return target;
  return NEW_WINDOW;
}

function hex(n: number): string {
  return `0x${n.toString(16).toUpperCase()}`;
}

/** `"14.0 k1/min"` → `["14.0", "k1/min"]`; without unit `["14.0", ""]`. */
function splitQuantity(text: string): [string, string] {
  const space = text.indexOf(" ");
  return space < 0 ? [text, ""] : [text.slice(0, space), text.slice(space + 1)];
}

function withUnit(text: string, unit: string | undefined): string {
  return unit ? `${text} ${unit}` : text;
}
