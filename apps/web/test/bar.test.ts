import { readFileSync } from "node:fs";
import {
  type CommandResult,
  EMPTY_WORKSPACE,
  fromIso,
  type TimeseriesWindow,
  type ValuesWindow,
  type Workspace,
} from "@kipscope/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { barTarget, defaultCursorTime, resetSignals } from "../src/bar/bar.ts";
import { OptionBar } from "../src/bar/OptionBar.tsx";

// useSyncExternalStore has no server snapshot, so the linked preview is stubbed for static markup.
vi.mock("../src/chart/linkedPreview.ts", async (importActual) => ({
  ...(await importActual<typeof import("../src/chart/linkedPreview.ts")>()),
  useLinkedPreview: () => undefined,
}));

const ts = (id: string, signals: string[]): TimeseriesWindow => ({
  id,
  kind: "timeseries",
  range: { from: "0", to: "10" },
  display: { mode: "line", envelope: false },
  signals: signals.map((signalId, i) => ({ id: `a${id}${i}`, signalId })),
});
const values = (id: string, signals: string[]): ValuesWindow => ({
  id,
  kind: "values",
  mode: "line",
  signals: signals.map((signalId, i) => ({ id: `a${id}${i}`, signalId })),
});
const ws = (windows: Workspace["windows"], extra: Partial<Workspace> = {}): Workspace => ({
  ...EMPTY_WORKSPACE,
  windows,
  ...extra,
});

describe("barTarget", () => {
  it("targets the window zoomed last, else the first timeseries window", () => {
    const w = [values("w1", ["c/WSPD_FL"]), ts("w2", ["c/SPEED_DISP"]), ts("w3", ["c/PTC"])];
    // The window zoomed last wins.
    expect(barTarget(ws(w, { lastZoomed: "w3" }))?.id).toBe("w3");
    // No lastZoomed: the first timeseries window, skipping the values window before it.
    expect(barTarget(ws(w))?.id).toBe("w2");
    // lastZoomed names a window that no longer exists.
    expect(barTarget(ws(w, { lastZoomed: "w9" }))?.id).toBe("w2");
    // lastZoomed names a values window (not possible in the workspace, but must not be a target).
    expect(barTarget(ws(w, { lastZoomed: "w1" }))?.id).toBe("w2");
    // Without a timeseries window there is no target.
    expect(barTarget(ws([values("w1", [])]))).toBeUndefined();
    expect(barTarget(EMPTY_WORKSPACE)).toBeUndefined();
  });
});

describe("resetSignals", () => {
  it("resets to the union of all timeseries extents while linked", () => {
    const w = [ts("w1", ["c/SPEED_DISP"]), values("w2", ["c/WSPD_FL"]), ts("w3", ["c/PTC"])];
    // Linked: the signals of all timeseries windows, never those of a values window.
    const linked = resetSignals(ws(w, { linkTime: true, lastZoomed: "w1" }));
    expect([...linked].sort()).toEqual(["c/PTC", "c/SPEED_DISP"]);
    // Unlinked: the target's signals only.
    expect(resetSignals(ws(w, { linkTime: false, lastZoomed: "w3" }))).toEqual(["c/PTC"]);
    expect(resetSignals(ws(w, { linkTime: false }))).toEqual(["c/SPEED_DISP"]);
    // Nothing to reset.
    expect(resetSignals(ws([values("w1", ["c/WSPD_FL"])]))).toEqual([]);
  });
});

describe("defaultCursorTime", () => {
  it("places new cursors at a third and two thirds of the reference range", () => {
    const range = {
      from: fromIso("2026-10-13T13:08:00Z"),
      to: fromIso("2026-10-13T13:08:03Z"),
    };
    expect(defaultCursorTime(range, "a")).toBe(fromIso("2026-10-13T13:08:01Z"));
    expect(defaultCursorTime(range, "b")).toBe(fromIso("2026-10-13T13:08:02Z"));
    // Snapped to the grid of the span (span / 1000 = 3 ms → 1 ms): 1/3 of 3.000000100 s.
    const odd = { from: 0n, to: 3_000_000_100n };
    expect(defaultCursorTime(odd, "a")).toBe(1_000_000_000n);
    expect(defaultCursorTime(odd, "b")).toBe(2_000_000_000n);
  });
});

describe("option bar row", () => {
  // No DOM in the tests: the row's source is read as text (as hints.test.ts does for tooltips).
  const source = readFileSync(new URL("../src/bar/OptionBar.tsx", import.meta.url), "utf8");

  it("holds the range button and no Span select", () => {
    // Range picker design R11: the Go to field and both Span selects (row and ⋯ menu) are gone.
    expect(source).not.toMatch(/spanSelect|onSpan|SPAN_PRESETS/);
    expect(source).not.toMatch(/>\s*Span\s*</);
    expect(source).toContain("range-button");
    expect(source).toContain('aria-haspopup="dialog"');
  });
});

describe("option bar order", () => {
  const noop = () => {};
  const bar = (workspace: Workspace, range = { from: 0n, to: 10n }) =>
    renderToStaticMarkup(
      createElement(OptionBar, {
        workspace,
        target: workspace.windows.find((w): w is TimeseriesWindow => w.kind === "timeseries"),
        canGoBack: true,
        onCommand: async () => ({ ok: true, revision: 1 }) as CommandResult,
        onBack: noop,
        onReset: noop,
        onGoTo: () => undefined,
        range,
        rangeLoaded: true,
        pickerOpen: false,
        onPickerOpen: noop,
        typed: "",
        onTyped: noop,
        onApply: noop,
        onOpened: noop,
        trackOpen: ((send: () => unknown) => send()) as never,
        onNotice: noop,
        onMessage: noop,
        workspaceId: "w1",
        summary: undefined,
        me: undefined,
      }),
    );

  it("words the range button's three tooltips apart (D-095)", () => {
    // Scenario "Button text": 2026-10-13 15:06:03 - 15:18:33 local.
    const range = { from: fromIso("2026-10-13T13:06:03Z"), to: fromIso("2026-10-13T13:18:33Z") };
    const html = bar(ws([ts("w1", ["c/SPEED_DISP"])]), range);
    const button = /<button[^>]*class="range-button"[^>]*>(.*?)<\/button>/s.exec(html);
    expect(button, "the range button").not.toBeNull();
    const open = /^<button[^>]*>/.exec(button?.[0] ?? "")?.[0] ?? "";
    const inner = button?.[1] ?? "";
    // The button's own tooltip is what it does, alone: no date, no duration.
    expect(open).toContain('title="Go to: pick a range or type one \u00b7 t"');
    expect(open).not.toContain("Tue 2026-10-13");
    expect(open).not.toContain("Duration 12 min");
    // The date and the time each name the full start; no weekday, end time or +1 in the text.
    const text = inner.replace(/<svg.*?<\/svg>/gs, "").replace(/<[^>]*>/g, "");
    expect(text).toBe("26-10-13 15:060:12 h"); // the tag follows the start without a space
    expect(inner).toMatch(
      /<span[^>]*class="range-date"[^>]*title="Tue 2026-10-13 15:06"[^>]*>26-10-13<\/span>/,
    );
    expect(inner).toContain('<span title="Tue 2026-10-13 15:06">15:06</span>');
    // The duration tag: stopwatch, unit, words as its tooltip; the old fixed hint is gone.
    expect(inner).toMatch(/<span[^>]*class="duration-tag"[^>]*title="Duration 12 min"[^>]*>/);
    expect(inner).toContain("0:12 h");
    expect(html).not.toContain("Duration (h:mm)");
  });

  it("renders the top row in order", () => {
    const html = bar(ws([ts("w1", ["c/SPEED_DISP"])]));
    // First position of each control in the markup, in the order timeseries-window "Option bar" names.
    const find = (name: string, pattern: RegExp) => {
      const i = html.search(pattern);
      expect(i, `${name} is in the row`).toBeGreaterThanOrEqual(0);
      return i;
    };
    const order = [
      find("Views", />Views</),
      find("range control", /class="range-control"/),
      find("Back", /aria-label="Back"/),
      find("Reset", /aria-label="Reset"/),
      find("Link time axes", /aria-label="Link time axes"/),
      find("A", /<label[^>]*>(?:<input[^>]*>)?\s*A\s*<\/label>/),
      find("B", /<label[^>]*>(?:<input[^>]*>)?\s*B\s*<\/label>/),
      find("Diff", /<label[^>]*>(?:<input[^>]*>)?\s*Diff\s*<\/label>/),
      find("Share…", /Share…/),
      find("More", /aria-label="More"/),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    // Back and Reset are icon buttons without visible text; Link time axes is a pressed-state button.
    const button = (label: string) =>
      new RegExp(`<button[^>]*aria-label="${label}"[^>]*>(.*?)</button>`, "s").exec(html);
    for (const label of ["Back", "Reset"]) {
      const m = button(label);
      expect(m, label).not.toBeNull();
      expect((m?.[1] ?? "").replace(/<[^>]*>/g, "").trim(), `${label} text`).toBe("");
    }
    expect(button("Link time axes")?.[0]).toContain("aria-pressed");

    // Digits and + Values window are items of the "⋯" menu only (closed here).
    expect(html).not.toContain('aria-label="Digits"');
    expect(html).not.toContain("+ Values");
    expect(html).not.toContain("New values window");
  });
});
