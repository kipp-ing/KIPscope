import {
  buildSearchIndex,
  type FormulaNames,
  type SignalInfo,
  searchSignals,
} from "@kipscope/shared";
import { describe, expect, it } from "vitest";
import {
  accept,
  type CompletionToken,
  highlightSpans,
  type Suggestion,
  suggestions,
  tokenAt,
} from "../src/computed/completion.ts";
import { HINTS } from "../src/help/hints.ts";

const info = (name: string, extra: Partial<SignalInfo> = {}): SignalInfo => ({
  id: `smart451/${name}`,
  dataRef: "smart451",
  name,
  ...extra,
});
const DNMOT = info("MS_312h.DNMOT", { unit: "rpm" });
const MODE = info("MS_1h.MODE", { states: "labels" });
const CURR = info("CPC_508h.PNHV_SupBat_Curr", { unit: "A" });
const D = "DNMOT − PNHV_SupBat_Curr"; // U+2212
/** The computed signal's info as `computedInfos` gives it. */
const COMPUTED = info("=c1", {
  displayName: D,
  unit: "A",
  description: "MS_312h.DNMOT - CPC_508h.PNHV_SupBat_Curr",
  computed: { formula: "MS_312h.DNMOT - CPC_508h.PNHV_SupBat_Curr" },
});
const index = () => buildSearchIndex([DNMOT, MODE, CURR, COMPUTED]);

describe("formula field completion", () => {
  // spec computed-signals "Token at the caret"
  it("finds the token at the caret", () => {
    expect(tokenAt("abs(DNM", 7)).toEqual({ start: 4, end: 7, query: "DNM", quoted: false });
    expect(tokenAt('X.A + "DNMOT − P', 16)).toEqual({
      start: 6,
      end: 16,
      query: "DNMOT − P",
      quoted: true,
    });
    // The run reaches past the caret; the query is the part before it.
    expect(tokenAt("MS_312h.DNMOT", 4)).toEqual({
      start: 0,
      end: 13,
      query: "MS_3",
      quoted: false,
    });
    expect(tokenAt("2.5", 3)).toBeUndefined();
    expect(tokenAt("X.A + ", 6)).toBeUndefined();
    // More places: after an operator, a bracket or a comma, nothing is being typed.
    expect(tokenAt("abs(", 4)).toBeUndefined();
    expect(tokenAt("min(X.A, ", 9)).toBeUndefined();
    expect(tokenAt("", 0)).toBeUndefined();
    // A run starting with a digit is a number, not a name.
    expect(tokenAt("2X.A", 4)).toBeUndefined();
    expect(tokenAt("1e3", 2)).toBeUndefined();
    // A name after a number-free operator.
    expect(tokenAt("2 * DNMOT", 9)).toEqual({ start: 4, end: 9, query: "DNMOT", quoted: false });
    // A closed quote: from the opening to the closing quote; the query ends at the caret.
    expect(tokenAt('"Bat Curr" + 1', 8)).toEqual({
      start: 0,
      end: 10,
      query: "Bat Cur",
      quoted: true,
    });
    // Directly after the opening quote nothing is typed yet; after the closing quote nothing either.
    expect(tokenAt('"', 1)).toBeUndefined();
    expect(tokenAt('"Bat Curr" + 1', 10)).toBeUndefined();
    // An escaped quote stays inside the name; the query is unescaped.
    expect(tokenAt('"say \\"h', 8)).toEqual({ start: 0, end: 8, query: 'say "h', quoted: true });
    // Underscore starts a name.
    expect(tokenAt("_x", 2)).toEqual({ start: 0, end: 2, query: "_x", quoted: false });
  });

  // spec computed-signals "Suggestions"
  it("suggests functions and signals", () => {
    const idx = index();
    const bare = (query: string): CompletionToken => ({
      start: 0,
      end: query.length,
      query,
      quoted: false,
    });
    const rowsOf = (query: string) =>
      searchSignals(idx, query).map((m) => ({ kind: "signal", id: m.signal.id }));
    const compact = (list: Suggestion[]) =>
      list.map((s) =>
        s.kind === "function"
          ? { kind: "function", name: s.name }
          : { kind: "signal", id: s.info.id },
      );

    // `m`: min, max, then the search rows in the explorer's order, at most 8 in all.
    const m = suggestions(bare("m"), idx, new Set());
    expect(m.slice(0, 2)).toEqual([
      { kind: "function", name: "min" },
      { kind: "function", name: "max" },
    ]);
    expect(compact(m)).toEqual([
      { kind: "function", name: "min" },
      { kind: "function", name: "max" },
      ...rowsOf("m"),
    ]);
    expect(m.length).toBeLessThanOrEqual(8);

    // `DNMO`: no function, exactly the rows of the explorer search; the computed one is marked.
    const dnmo = suggestions(bare("DNMO"), idx, new Set());
    expect(compact(dnmo)).toEqual(rowsOf("DNMO"));
    const ids = dnmo.flatMap((s) => (s.kind === "signal" ? [s.info.id] : []));
    expect(ids).toContain("smart451/MS_312h.DNMOT");
    expect(ids).toContain("smart451/=c1");
    const computed = dnmo.find((s) => s.kind === "signal" && s.info.id === "smart451/=c1");
    expect(computed).toMatchObject({
      kind: "signal",
      info: { computed: { formula: COMPUTED.computed?.formula } },
    });

    // With the computed signal excluded (it would close a cycle) it is gone.
    const without = suggestions(bare("DNMO"), idx, new Set(["smart451/=c1"]));
    expect(compact(without)).not.toContainEqual({ kind: "signal", id: "smart451/=c1" });
    expect(compact(without)).toContainEqual({ kind: "signal", id: "smart451/MS_312h.DNMOT" });

    // A quoted token offers no function.
    const quoted = suggestions({ start: 0, end: 3, query: "ab", quoted: true }, idx, new Set());
    expect(quoted.some((s) => s.kind === "function")).toBe(false);
    // An unquoted `ab` offers abs first.
    expect(suggestions(bare("ab"), idx, new Set())[0]).toEqual({ kind: "function", name: "abs" });
    // A function name is matched ignoring case.
    expect(suggestions(bare("MA"), idx, new Set())[0]).toEqual({ kind: "function", name: "max" });

    // A signal with states carries the title and is not accepted.
    const mode = suggestions(bare("MODE"), idx, new Set()).find(
      (s) => s.kind === "signal" && s.info.id === "smart451/MS_1h.MODE",
    );
    expect(mode).toMatchObject({
      kind: "signal",
      disabled: "MODE has states: pick a numeric signal",
    });
    expect(HINTS.computedNumericOnly("MODE")).toBe("MODE has states: pick a numeric signal");
    // Numeric rows carry none.
    const numeric = suggestions(bare("DNMOT"), idx, new Set()).find(
      (s) => s.kind === "signal" && s.info.id === "smart451/MS_312h.DNMOT",
    );
    expect(numeric).toBeDefined();
    expect(numeric && "disabled" in numeric).toBe(false);
  });

  it("lists at most eight rows", () => {
    const many = Array.from({ length: 30 }, (_, i) => info(`ECU_${100 + i}h.TEMP${i}`));
    const idx = buildSearchIndex(many);
    const rows = suggestions({ start: 0, end: 3, query: "ECU", quoted: false }, idx, new Set());
    expect(rows).toHaveLength(8);
    // The same top rows as the explorer search.
    expect(rows.map((s) => (s.kind === "signal" ? s.info.id : s.name))).toEqual(
      searchSignals(idx, "ECU")
        .slice(0, 8)
        .map((m) => m.signal.id),
    );
  });

  // spec computed-signals "Accept"
  it("accepts a suggestion", () => {
    const signal = (s: SignalInfo): Suggestion => ({ kind: "signal", info: s });
    const run = (text: string, caret: number, s: Suggestion) => {
      const token = tokenAt(text, caret);
      if (!token) throw new Error(`no token in ${text}`);
      return accept(text, token, s);
    };
    expect(run("abs(DNM", 7, signal(DNMOT))).toEqual({ text: "abs(MS_312h.DNMOT", caret: 17 });
    expect(run('X.A + "DNMOT − P', 16, signal(COMPUTED))).toEqual({
      text: `X.A + "${D}"`,
      caret: 32,
    });
    expect(run("ab", 2, { kind: "function", name: "abs" })).toEqual({ text: "abs(", caret: 4 });
    // A "(" already follows: only the caret moves past it.
    expect(run("ab(X.A)", 2, { kind: "function", name: "abs" })).toEqual({
      text: "abs(X.A)",
      caret: 4,
    });
    // Text after the token stays; the caret sits after the inserted name.
    expect(run("DNM + 2", 3, signal(DNMOT))).toEqual({ text: "MS_312h.DNMOT + 2", caret: 13 });
    // A name that is no identifier is quoted.
    const odd = tokenAt("ab", 2) as CompletionToken;
    expect(accept("ab", odd, signal(info("1st.X")))).toEqual({ text: '"1st.X"', caret: 7 });
    // Min and max become functions too.
    expect(run("mi", 2, { kind: "function", name: "min" })).toEqual({ text: "min(", caret: 4 });
    // A row with states is not accepted: the field stays as it is.
    const disabled: Suggestion = {
      kind: "signal",
      info: MODE,
      disabled: "MODE has states: pick a numeric signal",
    };
    expect(run("MOD", 3, disabled).text).toBe("MOD");
  });

  // spec computed-signals "Spans"
  it("tints signal names", () => {
    const names: FormulaNames = {
      signals: [
        { name: "MS_312h.DNMOT", unit: "rpm", states: false },
        { name: "CPC_508h.PNHV_SupBat_Curr", unit: "A", states: false },
        { name: "Eng_1h.TEMP", states: false },
        { name: "Bat_2h.TEMP", states: false },
        { name: "MS_1h.MODE", states: true },
      ],
      computed: [{ name: D, unit: "A" }],
    };
    expect(highlightSpans(`abs("${D}") + MS_312h.DNMOT - DNMOX`, names)).toEqual([
      { start: 4, end: 30, kind: "computed" },
      { start: 34, end: 47, kind: "signal" },
      { start: 50, end: 55, kind: "bad" },
    ]);
    // The error's 1-based position marks its token even when the name resolves.
    expect(highlightSpans("MS_312h.DNMOT + 1", names, 1)).toEqual([
      { start: 0, end: 13, kind: "bad" },
    ]);
    // Short names resolve too; no names, no spans.
    expect(highlightSpans("dnmot * 2", names)).toEqual([{ start: 0, end: 5, kind: "signal" }]);
    expect(highlightSpans("1 + 2", names)).toEqual([]);
    expect(highlightSpans("", names)).toEqual([]);
    // An ambiguous or state name is not tinted as resolved.
    expect(highlightSpans("TEMP + 1", names)).toEqual([{ start: 0, end: 4, kind: "bad" }]);
  });
});
