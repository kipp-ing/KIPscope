import type { SignalInfo } from "./signals.ts";

/**
 * Half a factor step (|factor| / 2, 0.5 without factor): the tolerance of a value against a
 * `VAL_` or SNA code, the SNA rule's (D-012, design N2, E7).
 */
export function labelTolerance(info: Pick<SignalInfo, "dbc">): number {
  const factor = info.dbc?.factor;
  return factor ? Math.abs(factor) / 2 : 0.5;
}

/** Whether a value is one of the signal's SNA codes (within labelTolerance). */
export function isSnaValue(info: Pick<SignalInfo, "dbc" | "sna">, value: number): boolean {
  const tolerance = labelTolerance(info);
  return info.sna?.some((s) => Math.abs(value - s.value) <= tolerance) ?? false;
}

/**
 * The signal's non-SNA `VAL_` entries as { value (physical), label }; diag enums are not
 * included (they are named by row text, D-061). Pure (design N2, D-059).
 */
export function valueLabels(info: SignalInfo): { value: number; label: string }[] {
  const sna = info.sna ?? [];
  return (info.dbc?.values ?? [])
    .filter((l) => !sna.some((s) => s.raw === l.raw || s.value === l.value))
    .map((l) => ({ value: l.value, label: l.label }));
}

/**
 * The label (whole) from valueLabels of a valid value: |value − label.value| ≤ labelTolerance;
 * undefined when none (an SNA value never has one, D-010). Pure (design N2).
 */
export function stateLabel(info: SignalInfo, value: number): string | undefined {
  const tolerance = labelTolerance(info);
  return valueLabels(info).find((l) => Math.abs(value - l.value) <= tolerance)?.label;
}

/** "CODE: words" → "CODE" when CODE matches ^[A-Z0-9_]+$; else the label (design N2). */
export function shortLabel(label: string): string {
  return /^([A-Z0-9_]+):\s+\S/.exec(label)?.[1] ?? label;
}
