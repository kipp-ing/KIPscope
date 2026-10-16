import { CATEGORY_TEXT, type DiagEvent, EVENT_CATEGORIES, type EventCategory } from "./events.ts";

/** The filter strip, windows, panel and CLI use when the workspace holds none (D-058 Q1). */
export const DEFAULT_EVENT_FILTER = "active changes";
export const MAX_FILTER_LENGTH = 200;
export const MAX_FILTER_TERMS = 20;

export type CategoryWord =
  | "faults"
  | "active"
  | "pending"
  | "stored"
  | "untested"
  | "passed"
  | "changes"
  | "snapshots"
  | "refused"
  | "transport"
  | "logger"
  | "other"
  | "all"
  | "none";

export type FilterTerm =
  | { neg: boolean; kind: "category"; word: CategoryWord }
  | { neg: boolean; kind: "ecu" | "name" | "text"; value: string };

/** One search-style filter string, parsed (D-058 Q3, design F1). */
export interface EventFilter {
  terms: FilterTerm[];
}

/** Keywords (lower case) → canonical word (design F1). */
const KEYWORDS: Record<string, CategoryWord> = {
  faults: "faults",
  fault: "faults",
  active: "active",
  pending: "pending",
  stored: "stored",
  untested: "untested",
  passed: "passed",
  changes: "changes",
  change: "changes",
  snapshots: "snapshots",
  snapshot: "snapshots",
  refused: "refused",
  nrc: "refused",
  transport: "transport",
  isotp: "transport",
  logger: "logger",
  other: "other",
  all: "all",
  everything: "all",
  none: "none",
};

/** Keys (lower case) → canonical kind. */
const KEYS: Record<string, "ecu" | "name" | "text"> = {
  ecu: "ecu",
  source: "ecu",
  name: "name",
  code: "name",
  text: "text",
};

/** Categories a word selects; presets: faults, logger, all, none. */
const WORD_CATEGORIES: Record<CategoryWord, readonly EventCategory[]> = {
  faults: ["active", "pending", "stored"],
  active: ["active"],
  pending: ["pending"],
  stored: ["stored"],
  untested: ["untested"],
  passed: ["passed"],
  changes: ["change"],
  snapshots: ["snapshot"],
  refused: ["refused"],
  transport: ["transport"],
  logger: ["refused", "transport"],
  other: ["other"],
  all: EVENT_CATEGORIES,
  none: [],
};

/** The word selecting exactly one category. */
const categoryWord = (c: EventCategory): CategoryWord =>
  c === "change" ? "changes" : c === "snapshot" ? "snapshots" : c;

const isKeyword = (s: string) => Object.hasOwn(KEYWORDS, s.toLowerCase());

type Parsed = { ok: true; filter: EventFilter } | { ok: false; message: string; at: number };

/** Parses the filter grammar of design F1; errors carry the character index. */
export function parseEventFilter(text: string): Parsed {
  const error = (message: string, at: number): Parsed => ({ ok: false, message, at });
  if (text.length > MAX_FILTER_LENGTH)
    return error(`filter longer than ${MAX_FILTER_LENGTH} characters`, MAX_FILTER_LENGTH);
  const space = (i: number) => i >= text.length || /\s/.test(text[i] ?? "");
  const terms: FilterTerm[] = [];
  let i = 0;
  for (;;) {
    while (i < text.length && space(i)) i++;
    if (i >= text.length) break;
    const start = i;
    if (terms.length >= MAX_FILTER_TERMS)
      return error(`more than ${MAX_FILTER_TERMS} terms`, start);
    const neg = text[i] === "-";
    if (neg) {
      i++;
      if (space(i)) return error('lone "-"', start);
    }
    // A quoted phrase starting at index `quote`, or the error.
    const quoted = (quote: number): { value: string; end: number } | Parsed => {
      const close = text.indexOf('"', quote + 1);
      if (close < 0) return error("unterminated quote", quote);
      if (!space(close + 1)) return error("quote inside a term", close);
      return { value: text.slice(quote + 1, close), end: close + 1 };
    };
    if (text[i] === '"') {
      const q = quoted(i);
      if ("ok" in q) return q;
      if (q.value === "") return error("empty phrase", i);
      terms.push({ neg, kind: "text", value: q.value });
      i = q.end;
      continue;
    }
    let j = i;
    while (!space(j) && text[j] !== '"') j++;
    const word = text.slice(i, j);
    const keyed = /^([A-Za-z]+):/.exec(word);
    if (text[j] === '"' && !(keyed && keyed[0] === word)) return error("quote inside a term", j);
    if (keyed) {
      const written = keyed[1]?.toLowerCase() ?? "";
      const kind = Object.hasOwn(KEYS, written) ? KEYS[written] : undefined;
      if (!kind) return error(`unknown key "${keyed[1]}" (keys: ecu, name, text)`, start);
      let value = word.slice(keyed[0].length);
      if (text[j] === '"') {
        const q = quoted(j);
        if ("ok" in q) return q;
        value = q.value;
        j = q.end;
      }
      if (value === "") return error(`empty value for ${written}`, start);
      terms.push({ neg, kind, value });
    } else {
      const canonical = isKeyword(word) ? KEYWORDS[word.toLowerCase()] : undefined;
      terms.push(
        canonical ? { neg, kind: "category", word: canonical } : { neg, kind: "text", value: word },
      );
    }
    i = j;
  }
  return { ok: true, filter: { terms } };
}

const quote = (v: string) => `"${v}"`;

/** One term in normal form (design F3). */
function formatTerm(t: FilterTerm): string {
  const sign = t.neg ? "-" : "";
  if (t.kind === "category") return sign + t.word;
  if (t.kind === "text") {
    const bare = /^[^\s"-][^\s":]*$/.test(t.value) && !isKeyword(t.value);
    return sign + (bare ? t.value : quote(t.value));
  }
  return `${sign}${t.kind}:${/\s/.test(t.value) ? quote(t.value) : t.value}`;
}

/** Terms without those whose normal form equals an earlier one's. */
function normalised(f: EventFilter): EventFilter {
  const seen = new Set<string>();
  return {
    terms: f.terms.filter((t) => {
      const s = formatTerm(t);
      if (seen.has(s)) return false;
      seen.add(s);
      return true;
    }),
  };
}

/** Normal form (design F3): terms in order, canonical words and keys, duplicates dropped. */
export function formatEventFilter(f: EventFilter): string {
  return normalised(f).terms.map(formatTerm).join(" ");
}

/** Union of the positive category terms (all without one) minus the negative ones (design F2). */
export function categoriesOf(f: EventFilter): Set<EventCategory> {
  const words = f.terms.filter((t) => t.kind === "category");
  const positive = words.filter((t) => !t.neg);
  const result = new Set<EventCategory>(
    positive.length > 0 ? positive.flatMap((t) => WORD_CATEGORIES[t.word]) : EVENT_CATEGORIES,
  );
  for (const t of words) if (t.neg) for (const c of WORD_CATEGORIES[t.word]) result.delete(c);
  return result;
}

/** Values of the terms of one kind and sign, lower case unless `asWritten`. */
function valuesOf(f: EventFilter, kind: "ecu" | "name" | "text", neg: boolean, asWritten = false) {
  return f.terms.flatMap((t) =>
    t.kind === kind && t.neg === neg ? [asWritten ? t.value : t.value.toLowerCase()] : [],
  );
}

/** Whether a source passes the ecu facet: no positive ecu or one equal, no negative equal. */
function passesEcu(f: EventFilter, source: string): boolean {
  const s = source.toLowerCase();
  const positive = valuesOf(f, "ecu", false);
  return (positive.length === 0 || positive.includes(s)) && !valuesOf(f, "ecu", true).includes(s);
}

/**
 * Predicate of a filter (design F2): category selected, the facets ecu (equals) and name (starts
 * with) widen within a kind and narrow across, every text term narrows; case-insensitive.
 */
export function compileEventFilter(f: EventFilter): (e: DiagEvent) => boolean {
  const cats = categoriesOf(f);
  const names = valuesOf(f, "name", false);
  const notNames = valuesOf(f, "name", true);
  const texts = valuesOf(f, "text", false);
  const notTexts = valuesOf(f, "text", true);
  return (e) => {
    if (!cats.has(e.category) || !passesEcu(f, e.source)) return false;
    const name = e.name.toLowerCase();
    if (names.length > 0 && !names.some((n) => name.startsWith(n))) return false;
    if (notNames.some((n) => name.startsWith(n))) return false;
    if (texts.length === 0 && notTexts.length === 0) return true;
    const hay = [e.source, e.name, e.text, e.detail, e.from?.text].join("\n").toLowerCase();
    return texts.every((x) => hay.includes(x)) && !notTexts.some((x) => hay.includes(x));
  };
}

/** `a`, `a and b`, `a, b and c`. */
function joinList(items: string[], last = "and"): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${last} ${items.at(-1)}`;
}

/** Categories in words: faults and logger errors for full presets, else the plural nouns. */
function listCategories(set: Set<EventCategory>): string {
  const faults = set.has("active") && set.has("pending") && set.has("stored");
  const logger = set.has("refused") && set.has("transport");
  const items: string[] = [];
  for (const c of EVENT_CATEGORIES) {
    if (!set.has(c)) continue;
    if (faults && (c === "pending" || c === "stored")) continue;
    if (logger && c === "transport") continue;
    if (faults && c === "active") items.push("faults");
    else if (logger && c === "refused") items.push("logger errors");
    else items.push(CATEGORY_TEXT[c].many);
  }
  return joinList(items);
}

/** The filter in words (design F4), e.g. `Active faults and state changes · from BMS`. */
export function describeEventFilter(f: EventFilter): string {
  const n = normalised(f);
  const set = categoriesOf(n);
  const complement = new Set(EVENT_CATEGORIES.filter((c) => !set.has(c)));
  let text: string;
  if (complement.size === 0) text = "All events";
  else if (set.size === 0) text = "No events";
  else if (complement.size <= 3) text = `All events except ${listCategories(complement)}`;
  else {
    const list = listCategories(set);
    text = list.charAt(0).toUpperCase() + list.slice(1);
  }
  const part = (label: string, values: string[], join: string) => {
    if (values.length > 0) text += ` · ${label}${values.join(join)}`;
  };
  const quoted = (vs: string[]) => vs.map((v) => `“${v}”`);
  part("from ", valuesOf(n, "ecu", false, true), " or ");
  part("not from ", valuesOf(n, "ecu", true, true), " or ");
  part("name starting ", valuesOf(n, "name", false, true), " or ");
  part("name not starting ", valuesOf(n, "name", true, true), " or ");
  part("mentioning ", quoted(valuesOf(n, "text", false, true)), " and ");
  part("not mentioning ", quoted(valuesOf(n, "text", true, true)), " or ");
  return text;
}

/** Preset buttons (design F5); pressed when the normal form equals `filter`. */
export const EVENT_PRESETS: readonly { label: string; filter: string }[] = [
  { label: "Active & changes", filter: "active changes" },
  { label: "Faults", filter: "faults" },
  { label: "Changes", filter: "changes" },
  { label: "Logger", filter: "logger" },
  { label: "Everything", filter: "all" },
  { label: "Off", filter: "none" },
];

/** Switches one category in the string by the toggle rule of design F5; normalised. */
export function toggleCategory(f: EventFilter, c: EventCategory, on: boolean): EventFilter {
  let terms: FilterTerm[] = [];
  if (on) {
    const appended: FilterTerm[] = [];
    for (const t of f.terms) {
      const set = t.kind === "category" ? WORD_CATEGORIES[t.word] : [];
      if (t.kind === "category" && t.neg && set.includes(c)) {
        for (const other of set) {
          if (other !== c)
            appended.push({ neg: true, kind: "category", word: categoryWord(other) });
        }
      } else terms.push(t);
    }
    terms.push(...appended);
    if (!categoriesOf({ terms }).has(c))
      terms.push({ neg: false, kind: "category", word: categoryWord(c) });
  } else {
    terms = f.terms.filter(
      (t) =>
        !(
          t.kind === "category" &&
          !t.neg &&
          WORD_CATEGORIES[t.word].length === 1 &&
          WORD_CATEGORIES[t.word][0] === c
        ),
    );
    if (categoriesOf({ terms }).has(c))
      terms.push({ neg: true, kind: "category", word: categoryWord(c) });
  }
  return normalised({ terms });
}

/** Switches one source in the ecu facet by the toggle rule of design F5; normalised. */
export function toggleSource(f: EventFilter, source: string, on: boolean): EventFilter {
  const s = source.toLowerCase();
  const terms = f.terms.filter(
    (t) => !(t.kind === "ecu" && t.neg === on && t.value.toLowerCase() === s),
  );
  if (passesEcu({ terms }, source) !== on) terms.push({ neg: !on, kind: "ecu", value: source });
  return normalised({ terms });
}
