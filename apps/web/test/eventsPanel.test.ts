import {
  type CommandResult,
  compileEventFilter,
  DEFAULT_EVENT_FILTER,
  type EventList,
  formatEventFilter,
  parseEventFilter,
} from "@kipscope/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { appliedFilter, EventsPanel, previewedFilter } from "../src/events/EventsPanel.tsx";
import { dayBands, listRows, MAX_LIST_ROWS } from "../src/events/list.ts";
import { atB, fakeEvent } from "./fakeEvents.ts";

// Tests run with TZ=Europe/Berlin (see package.json).

/** 1,200 notes, one per second from 01:00:00 on testcar's first day. */
function longList(): EventList {
  const events = Array.from({ length: 1200 }, (_, i) =>
    fakeEvent(atB(1, 0, 0) + BigInt(i) * 1_000_000_000n, "other", {
      kind: "note",
      source: "VCU",
      name: `n${i}`,
      text: `note ${i}`,
    }),
  );
  return {
    dataRef: "testcar",
    total: events.length,
    counts: { other: events.length },
    sources: [{ source: "VCU", count: events.length }],
    events,
    skipped: [],
  };
}

describe("events list", () => {
  it("caps the list at 500 rows", () => {
    expect(MAX_LIST_ROWS).toBe(500);
    const list = longList();
    const { rows, more } = listRows(list.events);
    expect(rows).toHaveLength(500);
    expect(more).toBe(700);
    expect(rows[0]).toBe(list.events[0]);
    expect(listRows(list.events.slice(0, 500))).toEqual({
      rows: list.events.slice(0, 500),
      more: 0,
    });

    // The panel renders 500 rows and the note.
    const html = renderToStaticMarkup(
      createElement(EventsPanel, {
        list,
        filter: "all",
        signals: [],
        info: () => undefined,
        range: undefined,
        onCommand: async () => ({ ok: true, revision: 1 }) as CommandResult,
        onCentre: () => undefined,
        focus: 0,
      }),
    );
    expect(html.match(/class="events-row( in-range)?"/g)).toHaveLength(500);
    expect(html).toContain("700 more — narrow the filter");
    // The heading counts all shown events, not the rows.
    expect(html).toContain("1,200 of 1,200");
  });

  it("groups rows by local day", () => {
    // 22:30 UTC on Oct 1 is 00:30 on Oct 2 in Berlin.
    const rows = [
      fakeEvent(atB(21, 0, 0), "other"),
      fakeEvent(atB(22, 30, 0), "other"),
      fakeEvent(atB(23, 59, 0), "other"),
    ];
    const bands = dayBands(rows);
    expect(bands).toHaveLength(2);
    expect(bands[0]?.rows).toHaveLength(1);
    expect(bands[1]?.rows).toHaveLength(2);
    expect(bands[0]?.day).toContain("2026-10-01");
    expect(bands[1]?.day).toContain("2026-10-02");
  });
});

describe("events panel while the typed filter is invalid", () => {
  const list: EventList = {
    dataRef: "testcar",
    total: 3,
    counts: { active: 2, change: 1 },
    sources: [{ source: "BMS", count: 3 }],
    events: [
      fakeEvent(atB(1, 0, 0), "active", { name: "P1", value: 41 }),
      fakeEvent(atB(2, 0, 0), "active", { name: "P2", value: 41 }),
      fakeEvent(atB(3, 0, 0), "change", { kind: "change", name: "BMS.contactor" }),
    ],
    skipped: [],
  };
  const count = (filter: string) => listCount(list, previewedFilter(filter, "active"));
  const listCount = (l: EventList, f: ReturnType<typeof previewedFilter>) =>
    l.events.filter(compileEventFilter(f)).length;

  it("falls back to the workspace filter's list, not the previous keystroke's", () => {
    expect(count("active")).toBe(2);
    expect(count("changes")).toBe(1);
    // `ecu:` does not parse: the workspace filter's count stays.
    expect(parseEventFilter("ecu:").ok).toBe(false);
    expect(count("ecu:")).toBe(2);
    expect(count("active ecu:")).toBe(2);
  });

  it("an unparsable workspace filter counts as the default (active changes)", () => {
    const f = previewedFilter("ecu:", "ecu:");
    expect(f).toEqual(appliedFilter(DEFAULT_EVENT_FILTER));
    expect(formatEventFilter(f)).toBe("active changes");
  });

  it("the panel renders the workspace filter's count for an invalid workspace filter", () => {
    const html = renderToStaticMarkup(
      createElement(EventsPanel, {
        list,
        filter: "ecu:",
        signals: [],
        info: () => undefined,
        range: undefined,
        onCommand: async () => ({ ok: true, revision: 1 }) as CommandResult,
        onCentre: () => undefined,
        focus: 0,
      }),
    );
    // Default `active changes`: the active fault (P1/P2 are value 41 = active) and the change.
    expect(html).toContain("of 3");
  });
});
