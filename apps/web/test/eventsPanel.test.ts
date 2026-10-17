import {
  type CommandResult,
  compileEventFilter,
  DEFAULT_EVENT_FILTER,
  type DiagEvent,
  type EventList,
  formatEventFilter,
  parseEventFilter,
} from "@kipscope/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EventsPanel } from "../src/events/EventsPanel.tsx";
import { appliedFilter, previewedFilter } from "../src/events/eventsData.ts";
import {
  dayBands,
  inView,
  listItems,
  listRows,
  MAX_LIST_ROWS,
  outside,
  readSummary,
  rowName,
  stepEvent,
} from "../src/events/list.ts";
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
        onJump: () => undefined,
        cursorA: undefined,
        focus: 0,
      }),
    );
    expect(html.match(/class="events-row( current)?"/g)).toHaveLength(500);
    expect(html).toContain("700 more — narrow the filter");
    // The switch counts all shown events, not the rows.
    expect(html).toMatch(/All[^0-9]*1,?200/);
  });

  it("groups rows by local day", () => {
    // 22:30 UTC on Oct 1 is 00:30 on Oct 2 in Berlin.
    const items = listItems([
      fakeEvent(atB(21, 0, 0), "other", { kind: "note" }),
      fakeEvent(atB(22, 30, 0), "other", { kind: "note" }),
      fakeEvent(atB(23, 59, 0), "other", { kind: "note" }),
    ]);
    const bands = dayBands(items);
    expect(bands).toHaveLength(2);
    expect(bands[0]?.items).toHaveLength(1);
    expect(bands[1]?.items).toHaveLength(2);
    expect(bands[0]?.day).toContain("2026-10-01");
    expect(bands[1]?.day).toContain("2026-10-02");
  });

  it("groups DTCs of one readout", () => {
    const t1 = atB(1, 0, 0);
    const t2 = atB(1, 0, 1);
    const p1 = fakeEvent(t1, "active", { name: "P1", source: "BMS" });
    const p2 = fakeEvent(t1, "stored", { name: "P2", source: "BMS" });
    const p3 = fakeEvent(t1, "active", { name: "P3", source: "VCU" });
    const contactor = fakeEvent(t1, "change", {
      kind: "state",
      source: "BMS",
      name: "BMS.contactor",
    });
    const p4 = fakeEvent(t2, "active", { name: "P4", source: "BMS" });
    const items = listItems([p1, p2, p3, contactor, p4]);
    expect(items).toEqual([
      { kind: "read", t: t1.toString(), source: "BMS", events: [p1, p2] },
      { kind: "event", event: p3 },
      { kind: "event", event: contactor },
      { kind: "event", event: p4 },
    ]);
    // A lone DTC stays an event.
    expect(listItems([p4])).toEqual([{ kind: "event", event: p4 }]);
  });
});

const S = 1_000_000_000n;
const ev10 = fakeEvent(10n * S, "change", { kind: "state" });
const ev20a = fakeEvent(20n * S, "change", { kind: "state", name: "a" });
const ev20b = fakeEvent(20n * S, "change", { kind: "state", name: "b" });
const ev30 = fakeEvent(30n * S, "change", { kind: "state" });

describe("events in view", () => {
  it("keeps the events of the view", () => {
    const events = [ev10, ev20a, ev30];
    const r1 = { from: 20n * S, to: 30n * S };
    expect(inView(events, r1)).toEqual([ev20a]);
    const o1 = outside(events, r1);
    expect(o1.earlier).toBe(1);
    expect(o1.later).toBe(1);
    expect(o1.before).toBe(ev10);
    expect(o1.after).toBe(ev30);

    const r2 = { from: 40n * S, to: 50n * S };
    expect(inView(events, r2)).toEqual([]);
    const o2 = outside(events, r2);
    expect(o2.earlier).toBe(3);
    expect(o2.before).toBe(ev30);
    expect(o2.later).toBe(0);
    expect(o2.after).toBeUndefined();
  });

  it("steps from cursor A or the view's edge", () => {
    const events = [ev10, ev20a, ev20b, ev30];
    const r = { from: 15n * S, to: 35n * S };
    const t = (e: { t: string } | undefined) => e?.t;
    const at = (n: bigint) => (n * S).toString();
    // A off.
    expect(t(stepEvent(events, r, undefined, 1))).toBe(at(20n));
    expect(t(stepEvent(events, r, undefined, -1))).toBe(at(30n));
    // A at 20: events at one time are one step.
    expect(t(stepEvent(events, r, 20n * S, 1))).toBe(at(30n));
    expect(t(stepEvent(events, r, 20n * S, -1))).toBe(at(10n));
    // A at 30.
    expect(stepEvent(events, r, 30n * S, 1)).toBeUndefined();
    expect(t(stepEvent(events, r, 30n * S, -1))).toBe(at(20n));
    // A at 5 lies outside the range: count from the edge.
    expect(t(stepEvent(events, r, 5n * S, 1))).toBe(at(20n));
    expect(t(stepEvent(events, r, 5n * S, -1))).toBe(at(30n));
    // Range [40 s, 50 s), A off.
    const far = { from: 40n * S, to: 50n * S };
    expect(stepEvent(events, far, undefined, 1)).toBeUndefined();
    expect(t(stepEvent(events, far, undefined, -1))).toBe(at(30n));
  });

  it("shows all without a range", () => {
    const list: EventList = {
      dataRef: "testcar",
      total: 2,
      counts: { change: 2 },
      sources: [{ source: "VCU", count: 2 }],
      events: [ev10, ev30],
      skipped: [],
    };
    const html = renderToStaticMarkup(
      createElement(EventsPanel, {
        list,
        filter: "all",
        signals: [],
        info: () => undefined,
        range: undefined,
        onCommand: async () => ({ ok: true, revision: 1 }) as CommandResult,
        onJump: () => undefined,
        cursorA: undefined,
        focus: 0,
      }),
    );
    expect(html).toContain("In view: needs a window with a time range");
    expect(html.match(/class="events-row( current)?"/g)).toHaveLength(2);
    expect(html).not.toMatch(/\d+ earlier/);
    expect(html).not.toMatch(/\d+ later/);
  });
});

describe("events panel in view", () => {
  const list: EventList = {
    dataRef: "testcar",
    total: 4,
    counts: { change: 4 },
    sources: [{ source: "VCU", count: 4 }],
    events: [ev10, ev20a, ev20b, ev30],
    skipped: [],
  };
  const render = (range: { from: bigint; to: bigint }, cursorA?: bigint) =>
    renderToStaticMarkup(
      createElement(EventsPanel, {
        list,
        filter: "all",
        signals: [],
        info: () => undefined,
        range,
        onCommand: async () => ({ ok: true, revision: 1 }) as CommandResult,
        onJump: () => undefined,
        cursorA,
        focus: 0,
      }),
    );

  it("offers earlier and later jumps with their counts", () => {
    const html = render({ from: 15n * S, to: 25n * S });
    expect(html).toContain("↑ 1 earlier");
    expect(html).toContain("↓ 1 later");
    expect(html.match(/class="events-row( current)?"/g)).toHaveLength(2);
  });

  it("says so when no event lies in the view", () => {
    const html = render({ from: 40n * S, to: 50n * S });
    expect(html).toContain("No events in view");
    expect(html).toContain("↑ 4 earlier");
    expect(html).not.toMatch(/\d+ later/);
  });

  it("marks the rows at cursor A as current", () => {
    const html = render({ from: 15n * S, to: 35n * S }, 20n * S);
    expect(html.match(/class="events-row[^"]*current"/g)).toHaveLength(2);
    expect(render({ from: 15n * S, to: 35n * S }).match(/current/g)).toBeNull();
  });
});

describe("events row text", () => {
  it("names rows without a repeated source", () => {
    const e = (over: Partial<DiagEvent>) => fakeEvent(0n, "other", over);
    expect(rowName(e({ kind: "signal", source: "IgnCurMode", name: "CPC_168h.IgnCurMode" }))).toBe(
      "IgnCurMode",
    );
    expect(rowName(e({ kind: "state", source: "BMS", name: "BMS.contactor" }))).toBe(
      "BMS.contactor",
    );
    expect(rowName(e({ kind: "dtc", source: "BMS", name: "P0CA700" }))).toBe("BMS P0CA700");
    expect(rowName(e({ kind: "nrc", source: "BMS", name: "SID 22" }))).toBe("BMS SID 22");
  });

  it("summarises a fault memory read", () => {
    const t = atB(1, 0, 0);
    const dtcs = (n: number, category: "active" | "stored", prefix: string) =>
      Array.from({ length: n }, (_, i) =>
        fakeEvent(t, category, { name: `${prefix}${i}`, source: "BMS" }),
      );
    const active13 = dtcs(13, "active", "A");
    const read13 = { kind: "read" as const, t: t.toString(), source: "BMS", events: active13 };
    const all55 = [...active13, ...dtcs(42, "stored", "S")];
    expect(readSummary(read13, all55)).toBe("BMS · 13 active faults · 55 DTCs read");

    const mixed = [...dtcs(2, "active", "A"), ...dtcs(1, "stored", "S")];
    const read3 = { kind: "read" as const, t: t.toString(), source: "BMS", events: mixed };
    expect(readSummary(read3, mixed)).toBe("BMS · 2 active faults, 1 stored fault · 3 DTCs read");
  });
});

describe("events panel while the typed filter is invalid", () => {
  const list: EventList = {
    dataRef: "testcar",
    total: 4,
    counts: { active: 2, change: 1, untested: 1 },
    sources: [{ source: "BMS", count: 3 }],
    events: [
      fakeEvent(atB(1, 0, 0), "active", { name: "P1", value: 41 }),
      fakeEvent(atB(2, 0, 0), "active", { name: "P2", value: 41 }),
      fakeEvent(atB(3, 0, 0), "change", { kind: "change", name: "BMS.contactor" }),
      fakeEvent(atB(4, 0, 0), "untested", { name: "P3", value: 64 }),
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
        onJump: () => undefined,
        cursorA: undefined,
        focus: 0,
      }),
    );
    // Default `active changes`: two active faults and the change are shown, the untested DTC hidden.
    expect(html).toContain("1 hidden");
    expect(html).toMatch(/All[^0-9]*3/);
  });
});
