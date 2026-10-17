import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EVENT_COLORS, groupMarks, markStyle } from "../src/events/marks.ts";
import { atB, fakeEvent } from "./fakeEvents.ts";

// The suite has no DOM environment, so placeEventGlyphs (which needs uPlot) is checked through its
// contract: markStyle yields the values placeEventGlyphs writes into --glyph-bg / --glyph-shadow,
// and window.css must read those variables in the event-glyph ::before rule.

const css = readFileSync(new URL("../src/chart/window.css", import.meta.url), "utf8");
const tsx = readFileSync(new URL("../src/chart/TimeseriesWindow.tsx", import.meta.url), "utf8");

/** The body of the `.event-glyph::before` rule. */
function beforeRule(): string {
  const m = /\.event-glyph::before\s*\{([^}]*)\}/.exec(css);
  expect(m, "rule .event-glyph::before missing in window.css").not.toBeNull();
  return m?.[1] ?? "";
}

const x = () => 500;

describe("event glyph variables", () => {
  it("a change mark gets --glyph-bg in the category colour and no shadow", () => {
    const [mark] = groupMarks([fakeEvent(atB(5, 0, 0), "change", { kind: "state" })], x, 1000);
    expect(mark).toBeDefined();
    if (!mark) return;
    const style = markStyle(mark);
    expect(style.background).toBe(EVENT_COLORS.change);
    expect(style.boxShadow ?? "none").toBe("none");
  });

  it("a fault memory read mark gets --glyph-bg var(--panel) and an inset shadow", () => {
    const [mark] = groupMarks([fakeEvent(atB(5, 0, 0), "active", { kind: "dtc" })], x, 1000);
    expect(mark?.read).toBe(true);
    if (!mark) return;
    const style = markStyle(mark);
    expect(style.background).toBe("var(--panel)");
    expect(style.boxShadow).toBeTruthy();
    expect(style.boxShadow).not.toBe("none");
    expect(style.boxShadow).toContain(EVENT_COLORS.fault);
  });

  it("placeEventGlyphs writes both variables from markStyle", () => {
    expect(tsx).toContain('setProperty("--glyph-bg", style.background)');
    expect(tsx).toContain('setProperty("--glyph-shadow", style.boxShadow ?? "none")');
  });

  it("window.css reads both variables in the event-glyph ::before rule", () => {
    const rule = beforeRule();
    expect(rule).toContain("var(--glyph-bg");
    expect(rule).toContain("var(--glyph-shadow");
  });
});
