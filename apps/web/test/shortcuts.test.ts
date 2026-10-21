import { describe, expect, it } from "vitest";
import { type KeyProbe, SHORTCUTS } from "../src/help/shortcuts.ts";
import { caseKey, isHelpKey, isSearchKey, type NavKey, navKey } from "../src/keys.ts";
import { isEventsKey, isSidebarKey } from "../src/layout/sidebar.ts";

const event = (p: KeyProbe) => ({
  key: p.key,
  shiftKey: p.shiftKey ?? false,
  ctrlKey: p.ctrlKey ?? false,
  metaKey: p.metaKey ?? false,
  altKey: p.altKey ?? false,
});

/** Handlers with no focused element; nav keys additionally report their step. */
function recognised(p: KeyProbe): { any: boolean; nav: NavKey | undefined } {
  const e = event(p);
  const nav = navKey(e, null);
  return {
    nav,
    any:
      nav !== undefined ||
      isSearchKey(e, null) ||
      isSidebarKey(e, null) ||
      isEventsKey(e, null) ||
      isHelpKey(e, null) ||
      // The catalog keys `[` and `]` (add-case-open K14).
      caseKey(e, null) !== undefined,
  };
}

const probes = SHORTCUTS.flatMap((s) => s.probe ?? []);

// Expected steps are written out by hand from design N6 / H6, not derived from navKey.
const STEP: Record<string, NavKey> = {
  "+": "in",
  "=": "in",
  "-": "out",
  ArrowLeft: "left",
  "Shift+ArrowLeft": "pageLeft",
  ArrowRight: "right",
  "Shift+ArrowRight": "pageRight",
  Home: "home",
  t: "goTo",
  ",": "prevDrive",
  ".": "nextDrive",
  n: "nextEvent",
  p: "prevEvent",
  "Shift+A": "cursorA",
  "Shift+B": "cursorB",
};

describe("shortcut table", () => {
  it("lists every handled key and only handled keys", () => {
    expect(probes.length).toBeGreaterThan(0);

    // Only handled keys: every probe is recognised, and navigation probes map to the right step.
    for (const p of probes) {
      const r = recognised(p);
      const name = `${p.shiftKey ? "Shift+" : ""}${p.key}`;
      expect(r.any, `probe ${name} is recognised by no handler`).toBe(true);
      if (r.nav !== undefined) expect(r.nav, `probe ${name}`).toBe(STEP[name]);
    }

    // Every handled key: each of these keys is recognised by some handler and has a probe.
    const handled: KeyProbe[] = [
      { key: "+" },
      { key: "=" },
      { key: "-" },
      { key: "ArrowLeft" },
      { key: "ArrowRight" },
      { key: "ArrowLeft", shiftKey: true },
      { key: "ArrowRight", shiftKey: true },
      { key: "Home" },
      { key: "t" },
      { key: "," },
      { key: "." },
      { key: "n" },
      { key: "p" },
      { key: "A", shiftKey: true },
      { key: "B", shiftKey: true },
      { key: "/" },
      { key: "s" },
      { key: "e" },
      { key: "?" },
      { key: "[" },
      { key: "]" },
    ];
    for (const h of handled) {
      expect(recognised(h).any, `handler for ${h.key} gone`).toBe(true);
      const listed = probes.some(
        (p) => p.key === h.key && (p.shiftKey ?? false) === (h.shiftKey ?? false),
      );
      expect(listed, `key ${h.shiftKey ? "Shift+" : ""}${h.key} has no probe`).toBe(true);
    }
  });

  it("lists Shift+A and Shift+B in the Time group and the strip's click on the line (D-095)", () => {
    const entry = SHORTCUTS.find((s) => s.group === "Time" && s.keys.includes("Shift+A"));
    expect(entry?.keys).toBe("Shift+A  Shift+B");
    expect(entry?.action).toBe("Bring cursor A or B into view");
    expect(entry?.probe).toEqual([
      { key: "A", shiftKey: true },
      { key: "B", shiftKey: true },
    ]);
    // The strip has no bars to click any more.
    const strip = SHORTCUTS.filter((s) => s.group === "Time strip").map((s) => s.keys);
    expect(strip).toContain("click the line");
    expect(strip).not.toContain("click a bar");
  });

  it("has the six groups in order, with Shift+click for B and the drive keys", () => {
    const groups: string[] = [];
    for (const s of SHORTCUTS) if (!groups.includes(s.group)) groups.push(s.group);
    expect(groups).toEqual([
      "Anywhere",
      "Time",
      "Signal list",
      "In a plot",
      "Drag and drop",
      "Time strip",
    ]);
    const shiftClick = SHORTCUTS.find((s) => s.group === "In a plot" && s.keys === "Shift+click");
    expect(shiftClick?.action).toMatch(/\bB\b/);
    const time = SHORTCUTS.filter((s) => s.group === "Time");
    expect(time.some((s) => s.keys.includes(",") && s.keys.includes("."))).toBe(true);
    for (const s of SHORTCUTS) {
      expect(s.keys.length).toBeGreaterThan(0);
      expect(s.action).not.toMatch(/\.$/);
    }
  });
});
