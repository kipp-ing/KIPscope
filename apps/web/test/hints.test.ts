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
  span: [[true], [false, "Window 2"]],
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
  range: [["14:03:10.250 – 14:08:22.500"]],
  legendUnit: [
    ["km/h", "left"],
    ["°C", "right"],
  ],
  sna: [["4.0 %"]],
  stripInfo: [["3 d 4 h", "2 h"]],
  eventsCount: [[13, 669, "faults and state changes"]],
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
});
