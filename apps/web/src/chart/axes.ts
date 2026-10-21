export interface AxisInput {
  key: string;
  label: string;
  unit?: string;
  color: string;
  /** The shown data ref lacks the signal (DW13): no scale, no side, no axis title. */
  missing?: true;
}

export type Side = "L" | "R" | "L2" | "R2";

export interface AxisSpec {
  scale: string;
  side: Side;
  title: string;
  color?: string;
}

export interface AxisLayout {
  /** Scale key per signal key: "u:<unit>" or "s:<key>" for signals without unit; none if missing. */
  scaleOf: Map<string, string>;
  /** Drawn axes, one per scale, at most four: "L", "R", "L2", "R2" in scale order. */
  axes: AxisSpec[];
  /** Per signal key: its axis side; undefined beyond four scales (guard, see design D3) or if missing. */
  sideOf: Map<string, Side | undefined>;
}

/** At most four drawn y axes, two per side (= MAX_UNITS). */
export const MAX_AXES = 4;

/** Inner left, inner right, outer left, outer right. */
const SIDES: Side[] = ["L", "R", "L2", "R2"];

/**
 * One y scale per unit (trimmed; empty counts as none), one per unit-less signal. Scales are
 * ordered by first appearance, so sides do not depend on which signals have loaded. A missing
 * signal gets no scale and no side.
 */
export function layoutAxes(inputs: AxisInput[]): AxisLayout {
  const scaleOf = new Map<string, string>();
  const scales = new Map<string, { title: string; colors: string[] }>();
  for (const input of inputs) {
    if (input.missing) continue;
    const unit = input.unit?.trim();
    const scale = unit ? `u:${unit}` : `s:${input.key}`;
    scaleOf.set(input.key, scale);
    const entry = scales.get(scale);
    if (entry) entry.colors.push(input.color);
    else scales.set(scale, { title: unit || input.label, colors: [input.color] });
  }
  const axes: AxisSpec[] = [];
  const sideByScale = new Map<string, Side>();
  [...scales.entries()].slice(0, MAX_AXES).forEach(([scale, { title, colors }], i) => {
    const side = SIDES[i] as Side;
    sideByScale.set(scale, side);
    axes.push({ scale, side, title, ...(colors.length === 1 ? { color: colors[0] } : {}) });
  });
  const sideOf = new Map<string, Side | undefined>();
  for (const [key, scale] of scaleOf) sideOf.set(key, sideByScale.get(scale));
  return { scaleOf, axes, sideOf };
}
