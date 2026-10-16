import { describe, expect, it } from "vitest";
import {
  categoriesOf,
  compileEventFilter,
  DEFAULT_EVENT_FILTER,
  describeEventFilter,
  EVENT_PRESETS,
  type EventFilter,
  formatEventFilter,
  parseEventFilter,
  toggleCategory,
  toggleSource,
} from "../src/eventFilter.ts";
import { TESTCAR_EVENTS } from "./testEvents.ts";

function parse(text: string): EventFilter {
  const r = parseEventFilter(text);
  if (!r.ok) throw new Error(`${text}: ${r.message} at ${r.at}`);
  return r.filter;
}

function failure(text: string) {
  const r = parseEventFilter(text);
  if (r.ok) throw new Error(`${text}: expected an error`);
  return r;
}

const normal = (text: string) => formatEventFilter(parse(text));

describe("parseEventFilter", () => {
  it("parses words, keys, phrases and exclusions", () => {
    expect(parse("Faults  BMS").terms).toEqual([
      { neg: false, kind: "category", word: "faults" },
      { neg: false, kind: "text", value: "BMS" },
    ]);
    expect(parse("all -snapshots -untested").terms).toEqual([
      { neg: false, kind: "category", word: "all" },
      { neg: true, kind: "category", word: "snapshots" },
      { neg: true, kind: "category", word: "untested" },
    ]);
    expect(parse('changes "circuit open" code:P0AA').terms).toEqual([
      { neg: false, kind: "category", word: "changes" },
      { neg: false, kind: "text", value: "circuit open" },
      { neg: false, kind: "name", value: "P0AA" },
    ]);
    expect(parse("-ecu:VCU text:active").terms).toEqual([
      { neg: true, kind: "ecu", value: "VCU" },
      { neg: false, kind: "text", value: "active" },
    ]);
    // The part before the first colon is not letters only: a plain word.
    expect(parse("12:30").terms).toEqual([{ neg: false, kind: "text", value: "12:30" }]);
    expect(parse("").terms).toEqual([]);
    expect(parse("   ").terms).toEqual([]);
  });

  it("reports errors with their position", () => {
    const quote = failure('faults "open');
    expect(quote.message).toMatch(/unterminated quote/);
    expect(quote.at).toBe(7);

    const key = failure("colour:red");
    expect(key.message).toContain("colour");
    expect(key.message).toContain("ecu, name, text");
    expect(key.at).toBe(0);

    const empty = failure("ecu:");
    expect(empty.message).toMatch(/empty value for ecu/);
    expect(empty.at).toBe(0);

    const lone = failure("faults - bms");
    expect(lone.message).toMatch(/lone "-"/);
    expect(lone.at).toBe(7);

    const inside = failure('ab"c');
    expect(inside.message).toMatch(/quote inside a term/);
    expect(inside.at).toBe(2);

    const long = failure("a".repeat(201));
    expect(long.message).toMatch(/200/);
    expect(long.at).toBe(200);
    // 200 characters are fine.
    expect(parseEventFilter("a".repeat(200)).ok).toBe(true);

    const words = Array.from({ length: 21 }, (_, i) => `w${i + 1}`);
    const many = failure(words.join(" "));
    expect(many.message).toMatch(/more than 20 terms/);
    // The 21st term starts after "w1 … w20 ".
    expect(many.at).toBe(words.slice(0, 20).join(" ").length + 1);
    expect(parseEventFilter(words.slice(0, 20).join(" ")).ok).toBe(true);
  });
});

describe("compileEventFilter", () => {
  it("matches events by categories, facets and text", () => {
    expect(TESTCAR_EVENTS).toHaveLength(18);
    const count = (text: string) => TESTCAR_EVENTS.filter(compileEventFilter(parse(text))).length;
    expect(count("faults")).toBe(5);
    expect(count("faults ecu:bms")).toBe(5);
    expect(count("changes")).toBe(2);
    expect(count("all -snapshots -untested")).toBe(12);
    expect(count("logger")).toBe(2);
    // The VCU.door rows; text terms search source, name, text, detail and the previous state.
    expect(count("door")).toBe(5);
    expect(count("name:P0C")).toBe(3);
    expect(count("ecu:bms ecu:vcu -faults")).toBe(13);
    expect(count('"circuit open"')).toBe(1);
    expect(count("none")).toBe(0);
    expect(count("")).toBe(18);
    // The names behind the numbers.
    const names = (text: string) =>
      TESTCAR_EVENTS.filter(compileEventFilter(parse(text))).map((e) => e.name);
    expect(names("name:P0C").sort()).toEqual(["P0C4600", "P0C7800", "P0CA700"]);
    expect(names('"circuit open"')).toEqual(["P180D13"]);
    // The previous state is searched too: "closed → open" matches on "closed" in `from`.
    expect(names("changes closed")).toEqual(["VCU.door", "VCU.door"]);
  });

  it("selects categories by union minus exclusions", () => {
    expect([...categoriesOf(parse("faults"))].sort()).toEqual(["active", "pending", "stored"]);
    expect(categoriesOf(parse("")).size).toBe(10);
    expect(categoriesOf(parse("all -logger")).has("refused")).toBe(false);
    expect(categoriesOf(parse("all -logger")).size).toBe(8);
    expect(categoriesOf(parse("none")).size).toBe(0);
    expect(categoriesOf(parse("ecu:bms")).size).toBe(10);
  });
});

describe("formatEventFilter", () => {
  it("normalises and round-trips", () => {
    expect(normal("FAULTS  Fault code:P0AA")).toBe("faults name:P0AA");
    expect(normal('text:active Source:"My ECU"')).toBe('"active" ecu:"My ECU"');
    expect(normal("-Snapshot change change")).toBe("-snapshots changes");
    for (const text of ["faults name:P0AA", '"active" ecu:"My ECU"', "-snapshots changes"]) {
      expect(normal(text)).toBe(text);
    }
    // Every filter of the parsing scenarios keeps its terms across one round trip.
    for (const text of [
      "Faults  BMS",
      "all -snapshots -untested",
      'changes "circuit open" code:P0AA',
      "-ecu:VCU text:active",
      "12:30",
      "",
    ]) {
      const first = parse(text);
      const second = parse(formatEventFilter(first));
      expect(second.terms).toEqual(first.terms);
      expect(normal(formatEventFilter(first))).toBe(formatEventFilter(first));
    }
    expect(normal("")).toBe("");
  });
});

describe("describeEventFilter", () => {
  it("describes a filter in words", () => {
    const d = (text: string) => describeEventFilter(parse(text));
    expect(d("faults changes")).toBe("Faults and state changes");
    expect(d("")).toBe("All events");
    expect(d("all -snapshots -untested")).toBe(
      "All events except untested DTCs and state snapshots",
    );
    expect(d("changes ecu:BMS text:contactor")).toBe(
      "State changes · from BMS · mentioning “contactor”",
    );
    expect(d("active name:P0AA name:U -coolant")).toBe(
      "Active faults · name starting P0AA or U · not mentioning “coolant”",
    );
    expect(d("none")).toBe("No events");
    expect(d(DEFAULT_EVENT_FILTER)).toBe("Active faults and state changes");
  });
});

describe("toggles and presets", () => {
  const toggled = (text: string, f: (x: EventFilter) => EventFilter) =>
    formatEventFilter(f(parse(text)));

  it("switches categories and sources in the string", () => {
    const off = toggled("faults changes", (f) => toggleCategory(f, "stored", false));
    expect(off).toBe("faults changes -stored");
    expect(toggled(off, (f) => toggleCategory(f, "stored", true))).toBe("faults changes");
    expect(toggled("all -logger", (f) => toggleCategory(f, "refused", true))).toBe(
      "all -transport",
    );

    const bmsOff = toggled("", (f) => toggleSource(f, "BMS", false));
    expect(bmsOff).toBe("-ecu:BMS");
    expect(toggled(bmsOff, (f) => toggleSource(f, "BMS", true))).toBe("");
    expect(toggled("ecu:BMS", (f) => toggleSource(f, "VCU", true))).toBe("ecu:BMS ecu:VCU");
  });

  it("offers the presets as filters that are in normal form", () => {
    expect(DEFAULT_EVENT_FILTER).toBe("active changes");
    expect(EVENT_PRESETS.map((p) => [p.label, p.filter])).toEqual([
      ["Active & changes", "active changes"],
      ["Faults", "faults"],
      ["Changes", "changes"],
      ["Logger", "logger"],
      ["Everything", "all"],
      ["Off", "none"],
    ]);
    for (const p of EVENT_PRESETS) expect(normal(p.filter)).toBe(p.filter);
  });
});
