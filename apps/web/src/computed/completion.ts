import {
  FORMULA_FUNCTIONS,
  type FormulaNames,
  quoteName,
  resolveName,
  type SearchIndex,
  type SignalInfo,
  searchSignals,
  shortSignalName,
  shownName,
  tokenizeFormula,
} from "@kipscope/shared";
import { HINTS } from "../help/hints.ts";

/** Suggestions the formula field lists at most (F11). */
export const SUGGESTION_ROWS = 8;

/** The name being typed at the caret (F11); 0-based, end exclusive. */
export interface CompletionToken {
  start: number;
  end: number;
  query: string;
  quoted: boolean;
}

export type Suggestion =
  | { kind: "function"; name: "abs" | "min" | "max" }
  | { kind: "signal"; info: SignalInfo; disabled?: string };

const NAME_CHAR = /[A-Za-z0-9_.]/;
const NAME_START = /[A-Za-z_]/;

/** `\"` → `"`, `\\` → `\`; a lone `\` at the end (the caret inside an escape) is dropped. */
const unquote = (s: string) => s.replace(/\\(.)/g, "$1").replace(/\\$/, "");

/**
 * The token at the caret (F11): inside a quoted name from its opening quote to its closing quote
 * (the caret when unclosed), else the run of name characters around the caret when it starts with
 * a letter or `_`. None when the query (the part before the caret) is empty.
 */
export function tokenAt(text: string, caret: number): CompletionToken | undefined {
  // Quote pairs up to the caret: is the caret after an opening quote and not past its closing one?
  for (let i = 0; i < caret; i++) {
    if (text[i] !== '"') continue;
    let j = i + 1;
    while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
    const closed = j < text.length;
    if (caret <= j || !closed) {
      const query = unquote(text.slice(i + 1, caret));
      if (query === "") return undefined;
      return { start: i, end: closed ? j + 1 : caret, query, quoted: true };
    }
    i = j;
  }
  let start = caret;
  while (start > 0 && NAME_CHAR.test(text[start - 1] as string)) start--;
  let end = caret;
  while (end < text.length && NAME_CHAR.test(text[end] as string)) end++;
  if (start === caret || !NAME_START.test(text[start] as string)) return undefined;
  return { start, end, query: text.slice(start, caret), quoted: false };
}

/** The name a signal suggestion writes: a catalog signal's full name, a computed one's name. */
const nameOf = (info: SignalInfo) =>
  info.computed !== undefined ? (info.displayName ?? info.name) : info.name;

/**
 * At most SUGGESTION_ROWS rows (F11): the functions starting with the query (not in quotes), then the
 * explorer search's matches without the `exclude`d signal IDs, each name once. A signal with states
 * comes with `disabled` (its title) and is not accepted.
 */
export function suggestions(
  token: CompletionToken,
  index: SearchIndex,
  exclude: ReadonlySet<string>,
): Suggestion[] {
  const out: Suggestion[] = [];
  if (!token.quoted) {
    const q = token.query.toLowerCase();
    for (const name of FORMULA_FUNCTIONS)
      if (name.startsWith(q)) out.push({ kind: "function", name });
  }
  // A name listed on several data refs (or a computed one on each) is one row.
  const seen = new Set<string>();
  for (const m of searchSignals(index, token.query)) {
    if (out.length >= SUGGESTION_ROWS) break;
    const info = m.signal;
    if (exclude.has(info.id)) continue;
    const key = `${info.computed !== undefined ? "=" : ""}${nameOf(info)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(
      info.states !== undefined
        ? {
            kind: "signal",
            info,
            disabled: HINTS.computedNumericOnly(shortSignalName(shownName(info))),
          }
        : { kind: "signal", info },
    );
  }
  return out.slice(0, SUGGESTION_ROWS);
}

/**
 * The text and caret after accepting `s` for `token` (F11): a signal replaces the token by its quoted
 * name, the caret after it; a function writes `abs(` with the caret after `(`, or only moves the
 * caret past a `(` that already follows. A disabled row changes nothing.
 */
export function accept(
  text: string,
  token: CompletionToken,
  s: Suggestion,
): { text: string; caret: number } {
  if (s.kind === "signal" && s.disabled !== undefined) return { text, caret: token.end };
  const before = text.slice(0, token.start);
  const after = text.slice(token.end);
  if (s.kind === "function") {
    const open = after.startsWith("(");
    const next = `${before}${s.name}${open ? "" : "("}${after}`;
    return { text: next, caret: before.length + s.name.length + 1 };
  }
  const name = quoteName(nameOf(s.info));
  return { text: `${before}${name}${after}`, caret: before.length + name.length };
}

/**
 * The tints of the formula field (F11), whole name tokens incl. quotes: resolved signal and computed
 * names, unresolved names `bad`; `bad` (the current error's 1-based `at`) marks its token too.
 */
export function highlightSpans(
  text: string,
  names: FormulaNames,
  bad?: number,
): { start: number; end: number; kind: "signal" | "computed" | "bad" }[] {
  const out: { start: number; end: number; kind: "signal" | "computed" | "bad" }[] = [];
  const badAt = bad === undefined ? undefined : bad - 1;
  for (const t of tokenizeFormula(text)) {
    const marked = badAt !== undefined && t.start <= badAt && badAt < t.end && t.kind !== "space";
    if (t.kind === "name") {
      const r = resolveName(t.name, names);
      const kind = marked || !r.ok ? "bad" : r.kind;
      out.push({ start: t.start, end: t.end, kind });
    } else if (marked) {
      out.push({ start: t.start, end: t.end, kind: "bad" });
    }
  }
  return out;
}
