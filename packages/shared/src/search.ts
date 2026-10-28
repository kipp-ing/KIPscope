import { type SignalInfo, shownName } from "./signals.ts";

/** 0 exact, 1 prefix, 2 name or shown-name substring, 3 description/alias/unit (design E2). */
export type MatchTier = 0 | 1 | 2 | 3;
/** Half-open [start, end) in UTF-16 indices of the original string. */
export type MatchRange = readonly [start: number, end: number];

export interface SignalMatch {
  signal: SignalInfo;
  tier: MatchTier;
  /** Sorted, merged; [] when nothing matched in that field. */
  name: MatchRange[];
  /** Ranges in `shownName(signal)`. */
  shown: MatchRange[];
  unit: MatchRange[];
  description: MatchRange[];
}

declare const indexBrand: unique symbol;

/** Opaque precomputed lower-case fields; only `buildSearchIndex` makes one, build once per catalog. */
export interface SearchIndex {
  readonly signals: readonly SignalInfo[];
  readonly [indexBrand]: true;
}

/**
 * Lower-cased fields of one signal; `short` is the name after the first `.` (whole name if none),
 * `shown` the shown name (D-035).
 */
interface Fields {
  name: string;
  short: string;
  shown: string;
  description: string;
  alias: string;
  unit: string;
}

/** What a `SearchIndex` really is; the brand only keeps callers from building one by hand. */
interface Index {
  readonly signals: readonly SignalInfo[];
  readonly fields: readonly Fields[];
}

export function buildSearchIndex(signals: readonly SignalInfo[]): SearchIndex {
  const fields = signals.map((s): Fields => {
    const name = lowerOf(s.name);
    const dot = name.indexOf(".");
    return {
      name,
      short: dot < 0 ? name : name.slice(dot + 1),
      shown: lowerOf(shownName(s)),
      description: lowerOf(s.description ?? ""),
      alias: lowerOf(s.alias ?? ""),
      unit: lowerOf(s.unit ?? ""),
    };
  });
  const index: Index = { signals, fields };
  return index as unknown as SearchIndex;
}

/** Lower case of `text` per code point; from[j] / to[j]: the UTF-16 span in `text` of the code point that lower unit j came from. */
function foldCase(text: string): { lower: string; from: number[]; to: number[] } {
  const from: number[] = [];
  const to: number[] = [];
  let lower = "";
  let i = 0;
  for (const cp of text) {
    const l = cp.toLowerCase();
    for (let k = 0; k < l.length; k++) {
      from.push(i);
      to.push(i + cp.length);
    }
    lower += l;
    i += cp.length;
  }
  return { lower, from, to };
}

function lowerOf(text: string): string {
  return foldCase(text).lower;
}

/** Tier of one term for one signal, or undefined when it matches no field. */
function termTier(f: Fields, t: string): MatchTier | undefined {
  if (t === f.name || t === f.short || t === f.shown) return 0;
  if (f.name.startsWith(t) || f.short.startsWith(t) || f.shown.startsWith(t)) return 1;
  if (f.name.includes(t) || f.shown.includes(t)) return 2;
  if (f.description.includes(t) || f.alias.includes(t) || f.unit.includes(t)) return 3;
  return undefined;
}

/**
 * Every occurrence (overlapping too) of each term in the folded `original`, as ranges of
 * `original`, sorted, overlapping/touching merged.
 */
function ranges(original: string, terms: readonly string[]): MatchRange[] {
  if (original === "") return [];
  const { lower, from, to } = foldCase(original);
  const found: [number, number][] = [];
  for (const t of terms) {
    for (let i = lower.indexOf(t); i >= 0; i = lower.indexOf(t, i + 1)) {
      found.push([from[i] as number, to[i + t.length - 1] as number]);
    }
  }
  if (found.length === 0) return [];
  found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const r of found) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push(r);
  }
  return merged;
}

/** Ranked matches, best first; empty query → all signals in input order, tier 3, no ranges. */
export function searchSignals(index: SearchIndex, query: string): SignalMatch[] {
  const { signals, fields } = index as unknown as Index;
  const terms = lowerOf(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return signals.map((signal) => ({
      signal,
      tier: 3,
      name: [],
      shown: [],
      unit: [],
      description: [],
    }));
  }
  // Buckets per tier keep catalog order within a tier (stable).
  const buckets: SignalMatch[][] = [[], [], [], []];
  for (let i = 0; i < signals.length; i++) {
    const f = fields[i] as Fields;
    let tier: MatchTier = 0;
    let matched = true;
    for (const t of terms) {
      const tt = termTier(f, t);
      if (tt === undefined) {
        matched = false;
        break;
      }
      if (tt > tier) tier = tt;
    }
    if (!matched) continue;
    const signal = signals[i] as SignalInfo;
    buckets[tier]?.push({
      signal,
      tier,
      name: ranges(signal.name, terms),
      shown: ranges(shownName(signal), terms),
      unit: ranges(signal.unit ?? "", terms),
      description: ranges(signal.description ?? "", terms),
    });
  }
  return buckets.flat();
}
