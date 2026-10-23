import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HINTS } from "../src/help/hints.ts";
import { SHORTCUTS } from "../src/help/shortcuts.ts";

type Hint = string | ((...args: never[]) => string);
const table = HINTS as unknown as Record<string, Hint>;

/** Sample arguments per function entry (design H5): linked and unlinked, titles, kinds, shares. */
const SAMPLES: Record<string, unknown[][]> = {
  sidebarToggle: [[true], [false]],
  addButton: [["Speed"], [undefined]],
  goTo: [[true], [false, "Window 2"]],
  back: [
    [true, undefined, true],
    [false, "Window 2", true],
    [true, undefined, false],
  ],
  reset: [[true], [false, "Window 2"]],
  windowHeader: [[true], [false]],
  windowTitle: [["Window 2"]],
  badge: [
    ["raw", ""],
    ["agg", "10 s"],
    ["part", "1 min"],
  ],
  legendUnit: [
    ["km/h", "left"],
    ["°C", "right"],
  ],
  sna: [["4.0 %"]],
  stripInfo: [["3 d 4 h"]],
  // D-094, D-095 (design DW18): the flag's clock is HH:MM:SS.mmm, with the date before / after the strip.
  stripFlag: [
    ["A", "15:09:12.000", "view"],
    ["A", "11:31:10.000", "outside"],
    ["A", "26-10-13 10:02:00.000", "before"],
    ["B", "26-10-13 12:31:40.000", "after"],
  ],
  stripFlagAB: [["15:09:12.000", "15:09:12.950"]],
  eventsCount: [[13, 669, "faults and state changes"]],
  // add-favourites F7: the row's star (starred or not) and the Favourites header's counts.
  star: [[true], [false]],
  favourites: [
    [5, 7],
    [1, 1],
  ],
  // add-computed-signals C12: the numeric-only hint names the signal's short name.
  computedNumericOnly: [["MODE"], ["PNHV_SupBat_Curr"]],
};

function texts(): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  for (const [id, h] of Object.entries(table)) {
    if (typeof h === "string") {
      out.push({ id, text: h });
      continue;
    }
    // Entries without a sample (added by other changes) get a plain call with a few shapes.
    const sets = SAMPLES[id] ?? [[], ["Window 2"], [true], [false, "Window 2"]];
    let ok = false;
    for (const args of sets) {
      try {
        const t = (h as (...a: unknown[]) => string)(...args);
        out.push({ id: `${id}(${args.map(String).join(", ")})`, text: t });
        ok = true;
      } catch {
        // A sample that does not fit this entry's parameters.
      }
    }
    expect(ok, `no sample call works for HINTS.${id}; add one to SAMPLES`).toBe(true);
  }
  return out;
}

const keyTokens = new Set<string>();
for (const s of SHORTCUTS) {
  keyTokens.add(s.keys);
  for (const t of s.keys.split(/\s+|\/(?!click|wheel)/)) keyTokens.add(t);
}

describe("hints table", () => {
  it("keeps every hint within the wording rule", () => {
    const all = texts();
    expect(all.length).toBeGreaterThan(20);
    for (const { id, text } of all) {
      expect(text.length, `${id} is empty`).toBeGreaterThan(0);
      expect(text.length, `${id}: ${text.length} chars`).toBeLessThanOrEqual(140);
      expect(text.endsWith("."), `${id} ends with a period: ${text}`).toBe(false);
      expect(/^([A-Z0-9+[]|raw\b|agg\b|part\b)/.test(text), `${id} starts oddly: ${text}`).toBe(
        true,
      );
      // A key named after " · " is one of the shortcuts (not a prose tail like "double-click to rename").
      const tail = text.split(" · ").slice(1).pop();
      if (tail !== undefined && tail.length <= 12 && !tail.includes(" ")) {
        expect(keyTokens.has(tail), `${id} names "${tail}", missing in SHORTCUTS`).toBe(true);
      }
    }
  });

  it("words the star and Favourites hints", () => {
    // add-favourites "Header tooltip": the same facts as `5 of your 7 starred signals are in this list`.
    for (const [inList, total] of [
      [5, 7],
      [1, 1],
    ] as const) {
      const text = HINTS.favourites(inList, total);
      expect(text.startsWith("Favourites")).toBe(true);
      expect(text).toContain(String(inList));
      expect(text).toContain(String(total));
      expect(text).toContain("in this list");
    }
    expect(HINTS.favourites(5, 7)).not.toBe(HINTS.favourites(1, 1));
    // The star names its state and the key; Ctrl/Cmd+D is in the key list.
    expect(HINTS.star(false).startsWith("Star")).toBe(true);
    expect(HINTS.star(true).startsWith("Starred")).toBe(true);
    for (const starred of [true, false]) expect(HINTS.star(starred)).toContain("Ctrl/Cmd+D");
    const key = SHORTCUTS.find((s) => s.keys === "Ctrl/Cmd+D");
    expect(key?.group).toBe("Signal list");
    expect(key?.action).toBe("Star or unstar the row or the selection");
  });

  it("words the computed signal hints", () => {
    // add-computed-signals: the four hints of the Computed section and the editor.
    expect(HINTS.computedEmpty).toBe("No computed signals yet: click + to build one");
    expect(HINTS.computedNew.startsWith("New computed signal")).toBe(true);
    expect(HINTS.computedEdit.startsWith("Edit computed signal")).toBe(true);
    // The pencil names its key, which is in the key list.
    expect(HINTS.computedEdit.endsWith(" \u00b7 F2")).toBe(true);
    const key = SHORTCUTS.find((s) => s.keys === "F2");
    expect(key?.group).toBe("Signal list");
    expect(key?.action).toBe("Edit the active computed signal");
    expect(HINTS.computedNumericOnly("MODE")).toBe("MODE has states: pick a numeric signal");
    expect(HINTS.computedNumericOnly("PNHV_SupBat_Curr")).toContain("PNHV_SupBat_Curr");
    for (const text of [
      HINTS.computedNew,
      HINTS.computedEmpty,
      HINTS.computedEdit,
      HINTS.computedNumericOnly("MODE"),
    ]) {
      expect(text.length).toBeLessThanOrEqual(140);
      expect(text.endsWith(".")).toBe(false);
    }
  });

  it("takes every tooltip from the hints table", () => {
    const root = new URL("../src", import.meta.url).pathname;
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        // The events panel belongs to improve-events (design H5).
        if (e.isDirectory()) {
          if (!(dir === root && e.name === "events")) walk(join(dir, e.name));
        } else if (e.name.endsWith(".tsx")) files.push(join(dir, e.name));
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(10);

    const literal = /title=(?:"[^"]|\{\s*["'])/;
    const bad: string[] = [];
    for (const f of files) {
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (literal.test(line)) bad.push(`${f.slice(root.length + 1)}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(bad).toEqual([]);
  });

  it("words the Go to hint for the range picker and has no Span hint", () => {
    // Range picker design R11: the button's tooltip, unlinked with the target's title.
    expect(HINTS.goTo(true)).toBe("Go to: pick a range or type one · t");
    const unlinked = HINTS.goTo(false, "Window 2");
    expect(unlinked).toContain("Window 2");
    expect(unlinked.startsWith("Go to: pick a range or type one")).toBe(true);
    expect(unlinked.endsWith(" · t")).toBe(true);
    // The Span select is gone (time-navigation "Span presets" removed).
    expect("span" in HINTS).toBe(false);
    const t = SHORTCUTS.find((s) => s.keys === "t");
    expect(t?.action).toBe("Open the range picker (Go to)");
  });

  it("has no Duration hint and words the calendar keys (D-095)", () => {
    // The tooltip of a duration is its words (`durationTip`), so the fixed hint is gone.
    expect("duration" in HINTS).toBe(false);
    expect(JSON.stringify(Object.values(table).filter((h) => typeof h === "string"))).not.toContain(
      "Duration (h:mm)",
    );
    expect(HINTS.calendarKeys).toBe(
      "Calendar keys: arrows move a day or a week, PageUp or PageDown a month, Enter picks",
    );
    // Within the wording rule, and it carries no ` · key` tail (W1's key check does not apply).
    expect(HINTS.calendarKeys.length).toBeLessThanOrEqual(140);
    expect(HINTS.calendarKeys).not.toContain(" \u00b7 ");
    expect(HINTS.calendarKeys.endsWith(".")).toBe(false);
  });

  it("words the SNA hint with the strip in the signal's colour (design H5)", () => {
    const t = HINTS.sna("4.0 %");
    expect(t).toContain("strip in the signal's colour");
    expect(t.toLowerCase()).not.toContain("amber");
  });

  it("words the strip info for the presence line (D-094)", () => {
    const t = HINTS.stripInfo("3 d 4 h");
    // DW18 words it "…; the line shows where data exists, a break a gap. Click …", which is 141 characters for
    // "3 d 4 h" (W1: at most 140), so the test pins the parts both wordings share.
    expect(
      t.startsWith("Time strip: the whole recording (3 d 4 h); the line shows where data exists"),
    ).toBe(true);
    expect(t.endsWith(". Click to jump, drag to zoom, double-click for all")).toBe(true);
    // No bars any more.
    expect(t).not.toMatch(/\bbars?\b/);
    expect(t.length).toBeLessThanOrEqual(140);
  });

  it("words the strip's cursor flags (D-094, D-095)", () => {
    // One flag's tooltip per place of the cursor; the key it ends on is a shortcut (W1).
    expect(HINTS.stripFlag("A", "15:09:12.000", "view")).toBe(
      "A 15:09:12.000: click centres the view on A, span kept · Shift+A",
    );
    expect(HINTS.stripFlag("A", "11:31:10.000", "outside")).toBe(
      "A 11:31:10.000, outside the view: click centres the view on A, span kept · Shift+A",
    );
    expect(HINTS.stripFlag("A", "26-10-13 10:02:00.000", "before")).toBe(
      "A 26-10-13 10:02:00.000, before the strip's start: click centres the view on A, span kept · Shift+A",
    );
    expect(HINTS.stripFlag("B", "26-10-13 12:31:40.000", "after")).toBe(
      "B 26-10-13 12:31:40.000, after the strip's end: click centres the view on B, span kept · Shift+B",
    );
    expect(HINTS.stripFlagAB("15:09:12.000", "15:09:12.950")).toBe(
      "A 15:09:12.000 and B 15:09:12.950: click centres the view on both; Shift+A or Shift+B for one",
    );
    // The key tails are in the shortcut table (the wording-rule test checks every sample too).
    const keys = SHORTCUTS.flatMap((x) => x.keys.split(/\s+/));
    expect(keys).toContain("Shift+A");
    expect(keys).toContain("Shift+B");
  });

  it("words More without Share and the way back to the search (D-095)", () => {
    // Share stays in the row, so "⋯" holds digits and the values window only; no argument any more.
    expect(HINTS.more).toBe("More: digits, + values window");
    expect(String(HINTS.more)).not.toMatch(/share/i);
    expect(HINTS.backToSearch).toBe("Back to search: the tool that opened these sessions");
    expect(HINTS.backToSearch.length).toBeLessThanOrEqual(140);
  });

  it("puts the filter sentence of the events count in parentheses, and none without one", () => {
    const withS = HINTS.eventsCount(13, 669, "faults and state changes");
    expect(withS).toContain("(faults and state changes)");
    expect(withS).toBe(
      "13 events match the filter (faults and state changes), 669 in the recording · click to open the list · e",
    );
    for (const none of [undefined, ""]) {
      const t = HINTS.eventsCount(13, 669, none);
      expect(t).not.toContain("()");
      expect(t).not.toContain("(");
      expect(t).toContain("13 events match the filter, 669 in the recording");
    }
  });
});

describe("events count with a long filter sentence", () => {
  it("cuts the sentence so the count stays within 140 characters", () => {
    const sentence =
      "active faults, stored faults and state changes of BMS and IgnMode, without NRCs";
    const t = HINTS.eventsCount(99_999, 99_999 + 1, sentence);
    expect(t.length).toBeLessThanOrEqual(140);
    expect(t).toContain("…)");
  });
});
