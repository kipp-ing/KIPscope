import type { Digits } from "./workspace.ts";

/** SI prefixes from p (1e-12) to T (1e12); µ is U+00B5. */
const PREFIXES = ["p", "n", "µ", "m", "", "k", "M", "G", "T"] as const;
const MIN_E3 = -12;
const MAX_E3 = 12;

/** Units that never take a prefix (N7). */
const PREFIX_FREE = new Set(["%", "‰", "°", "°C", "°F", "dB", "h", "min", "d"]);
/**
 * A unit that already starts with an SI prefix of a base unit (km/h, kW, mA, ms, mbar, MΩ), also
 * of a compound one (mAh, kVA, Mvar); the bare compound units (Ah, VA) take a prefix.
 */
const PREFIXED =
  /^(p|n|µ|u|m|c|k|M|G|T)(m|g|s|A|Ah|V|VA|VAr|var|W|Wh|Hz|Pa|bar|N|Nm|J|l|L|Ω|F)(?![A-Za-z])/;

/** True when values of this unit may get an SI prefix (N7). undefined (no unit) → true. */
export function takesPrefix(unit: string | undefined): boolean {
  const trimmed = unit?.trim();
  if (!trimmed) return true;
  return !PREFIX_FREE.has(trimmed) && !PREFIXED.test(trimmed);
}

/** Decimal exponent of a finite, non-zero number. */
function exponent(value: number): number {
  return Number(value.toExponential().split("e")[1]);
}

/** Engineering exponent (multiple of 3) for `value`, clamped to p … T; 0 for 0. */
function prefixExponent(value: number): number {
  if (value === 0) return 0;
  return Math.min(MAX_E3, Math.max(MIN_E3, 3 * Math.floor(exponent(value) / 3)));
}

/**
 * `r` (already rounded to `digits` significant digits) as a decimal string with the point moved
 * left by `e3`, keeping exactly `digits` significant digits (trailing zeros kept).
 */
function shifted(r: number, digits: Digits, e3: number): string {
  const [mantissa = "", exp = "0"] = Math.abs(r)
    .toExponential(digits - 1)
    .split("e");
  const all = mantissa.replace(".", "");
  const intDigits = Number(exp) - e3 + 1;
  let text: string;
  if (intDigits >= all.length) text = all + "0".repeat(intDigits - all.length);
  else if (intDigits <= 0) text = `0.${"0".repeat(-intDigits)}${all}`;
  else text = `${all.slice(0, intDigits)}.${all.slice(intDigits)}`;
  return r < 0 ? `-${text}` : text;
}

const withUnit = (number: string, unit: string): string => (unit ? `${number} ${unit}` : number);

/** The number and the SI prefix it takes for `unit` (N7). */
function quantityParts(
  value: number,
  unit: string,
  digits: Digits,
): { number: string; prefix: string } {
  if (value === 0) return { number: "0", prefix: "" };
  if (!Number.isFinite(value)) return { number: String(value), prefix: "" };
  // Round on the unscaled value first: 8191.5 / 1000 is 8.1914999… and would print 8.191.
  const r = Number(value.toPrecision(digits));
  if (takesPrefix(unit)) {
    const e3 = prefixExponent(r);
    return { number: shifted(r, digits, e3), prefix: PREFIXES[(e3 - MIN_E3) / 3] ?? "" };
  }
  const magnitude = Math.abs(r);
  const number =
    magnitude < 0.001 || magnitude >= 1e6 ? r.toExponential(digits - 1) : shifted(r, digits, 0);
  return { number, prefix: "" };
}

/** "14.0 k1/min", "45.0 km/h", "1.23 mV", "-5.00 km/h", "0 km/h", "14.0 k" (N7). */
export function formatQuantity(value: number, unit: string | undefined, digits: Digits): string {
  const u = unit?.trim() ?? "";
  const { number, prefix } = quantityParts(value, u, digits);
  return withUnit(number, `${prefix}${u}`);
}

/**
 * formatQuantity without the unit, for places that name the unit once (the chart legend):
 * "14.0 k" for 14.0 k1/min, "45.0" for 45.0 km/h, "1.23 m" for 1.23 mV.
 */
export function formatQuantityBare(
  value: number,
  unit: string | undefined,
  digits: Digits,
): string {
  const { number, prefix } = quantityParts(value, unit?.trim() ?? "", digits);
  return withUnit(number, prefix);
}

export interface AxisLabels {
  /** "<prefix><unit>"; "" without unit. */
  title: string;
  labels: string[];
}

/** Largest decimal count used for axis labels (toFixed allows 100). */
const MAX_DECIMALS = 20;

/**
 * Axis tick labels (N8): one prefix per axis from the largest |tick| (none without unit or for a
 * prefix-free unit); every label gets the decimals the smallest step needs, raised while two
 * labels are equal.
 */
export function formatAxisTicks(
  ticks: number[],
  unit: string | undefined,
  digits: Digits,
): AxisLabels {
  const u = unit?.trim() ?? "";
  const finite = ticks.filter(Number.isFinite);
  const max = finite.reduce((m, t) => Math.max(m, Math.abs(t)), 0);
  const e3 = u && takesPrefix(u) ? prefixExponent(Number(max.toPrecision(digits))) : 0;
  const scale = 10 ** Math.abs(e3);
  const scaled = ticks.map((t) => (e3 >= 0 ? t / scale : t * scale));

  let step = Number.POSITIVE_INFINITY;
  for (let i = 1; i < scaled.length; i++) {
    const diff = Math.abs((scaled[i] as number) - (scaled[i - 1] as number));
    if (diff > 0 && diff < step) step = diff;
  }
  // Drop float noise (0.09999… must count as 0.1) before taking the logarithm.
  let decimals = Number.isFinite(step)
    ? Math.max(0, -Math.floor(Math.log10(Number(step.toPrecision(12)))))
    : 0;
  decimals = Math.min(decimals, MAX_DECIMALS);

  const render = (d: number) =>
    scaled.map((t) => {
      if (!Number.isFinite(t)) return String(t);
      const text = t.toFixed(d);
      return /^-0(\.0*)?$/.test(text) ? text.slice(1) : text;
    });
  let labels = render(decimals);
  while (new Set(labels).size < labels.length && decimals < MAX_DECIMALS) {
    labels = render(++decimals);
  }
  return { title: u ? `${PREFIXES[(e3 - MIN_E3) / 3]}${u}` : "", labels };
}
