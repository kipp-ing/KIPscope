import type { SignalInfo } from "./signals.ts";

/** 0 exact, 1 prefix, 2 name substring, 3 description/alias/unit (design E2). */
export type MatchTier = 0 | 1 | 2 | 3;
/** Half-open [start, end) in UTF-16 indices of the original string. */
export type MatchRange = readonly [start: number, end: number];

export interface SignalMatch {
  signal: SignalInfo;
  tier: MatchTier;
  /** Sorted, merged; [] when nothing matched in that field. */
  name: MatchRange[];
  unit: MatchRange[];
  description: MatchRange[];
}

/** Opaque precomputed lower-case fields; build once per catalog. */
export interface SearchIndex {
  readonly signals: readonly SignalInfo[];
}

/** Lower-cased fields of one signal; `short` is the name after the first `.` (whole name if none). */
interface Fields {
  name: string;
  short: string;
  description: string;
  alias: string;
  unit: string;
}

interface Index extends SearchIndex {
  readonly fields: readonly Fields[];
}

export function buildSearchIndex(signals: readonly SignalInfo[]): SearchIndex {
  const fields = signals.map((s): Fields => {
    const name = s.name.toLowerCase();
    const dot = name.indexOf(".");
    return {
      name,
      short: dot < 0 ? name : name.slice(dot + 1),
      description: s.description?.toLowerCase() ?? "",
      alias: s.alias?.toLowerCase() ?? "",
      unit: s.unit?.toLowerCase() ?? "",
    };
  });
  const index: Index = { signals, fields };
  return index;
}

/** Tier of one term for one signal, or undefined when it matches no field. */
function termTier(f: Fields, t: string): MatchTier | undefined {
  if (t === f.name || t === f.short) return 0;
  if (f.name.startsWith(t) || f.short.startsWith(t)) return 1;
  if (f.name.includes(t)) return 2;
  if (f.description.includes(t) || f.alias.includes(t) || f.unit.includes(t)) return 3;
  return undefined;
}

/** Every non-overlapping occurrence of each term in `text`, sorted, overlapping/touching merged. */
function ranges(text: string, terms: readonly string[]): MatchRange[] {
  if (text === "") return [];
  const found: [number, number][] = [];
  for (const t of terms) {
    for (let i = text.indexOf(t); i >= 0; i = text.indexOf(t, i + t.length)) {
      found.push([i, i + t.length]);
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
  const { signals, fields } =
    "fields" in index ? (index as Index) : (buildSearchIndex(index.signals) as Index);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return signals.map((signal) => ({ signal, tier: 3, name: [], unit: [], description: [] }));
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
      name: ranges(f.name, terms),
      unit: ranges(f.unit, terms),
      description: ranges(f.description, terms),
    });
  }
  return buckets.flat();
}
