import type { DiagEvent } from "@kipscope/shared";
import { describe, expect, it } from "vitest";
import {
  EVENT_COLORS,
  GROUP_PX,
  groupMarks,
  markColor,
  markStyle,
  markTitle,
  PIN_HIT_PX,
  PIN_LANE_PX,
  type PinShape,
  pinShape,
  READ_LINE,
  STRIP_PIN_HIT_H,
  STRIP_PIN_HIT_W,
  stripPin,
} from "../src/events/marks.ts";
import { trackOf, xOf } from "../src/time/stripGeometry.ts";
import { atB, fakeEvent, TESTCAR_DTCS } from "./fakeEvents.ts";

// Tests run with TZ=Europe/Berlin (see package.json); October 2026 is CEST, UTC+2.

const S = 1_000_000_000n;
const MIN = 60n * S;
const H = 3600n * S;

/** "Geometry" of the strip tests: 1,438 px, 120 bars of 1 h from 0, pitch 12 px. */
const tr = trackOf(
  {
    dataRef: "x",
    first: "0",
    last: (120n * H - 1n).toString(),
    width: H.toString(),
    start: "0",
    counts: new Array<number>(120).fill(1),
    grid: (H / 400n).toString(),
    drives: [],
  },
  1438,
);

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe("event marks", () => {
  it("clusters events into pins", () => {
    expect(GROUP_PX).toBe(6);
    expect(PIN_HIT_PX).toBe(8);
    // The hit lane of the strip's pins grew to y 0-11 with the 10 x 11 px hit area (D-095, DW20).
    expect(PIN_LANE_PX).toBe(11);
    // Events at 5 h (active), 5 h 20 min (change), 5 h 40 min (snapshot) and 130 h (off the track).
    const marks = groupMarks(
      [
        fakeEvent(5n * H, "active", { kind: "state" }),
        fakeEvent(5n * H + 20n * MIN, "change", { kind: "state" }),
        fakeEvent(5n * H + 40n * MIN, "snapshot", { kind: "state" }),
        fakeEvent(130n * H, "active", { kind: "state" }),
      ],
      (t) => xOf(tr, t),
      tr.px,
    );
    // The first two are 4 px apart (< 6) and form one pin; 5 h 40 min is 8 px from the first.
    expect(marks).toHaveLength(2);
    const [many, one] = marks;
    expect(many?.events).toHaveLength(2);
    near(many?.drawn.left ?? Number.NaN, 58.5);
    near(many?.drawn.right ?? Number.NaN, 65.5);
    near(many?.hit.left ?? Number.NaN, 58);
    near(many?.hit.right ?? Number.NaN, 66);
    // The most severe category of the group colours it: active beats change.
    expect(many?.category).toBe("active");
    expect(markColor(many?.category ?? "other")).toBe("#be123c");

    expect(one?.events).toHaveLength(1);
    near(one?.drawn.left ?? Number.NaN, 66.5);
    near(one?.drawn.right ?? Number.NaN, 69.5);
    near(one?.hit.left ?? Number.NaN, 64);
    near(one?.hit.right ?? Number.NaN, 72);
    expect(markColor(one?.category ?? "other")).toBe("#64748b");
  });

  it("shapes strip pins by kind", () => {
    expect([STRIP_PIN_HIT_W, STRIP_PIN_HIT_H]).toEqual([10, 11]);
    const on = (events: DiagEvent[]) => groupMarks(events, (t) => xOf(tr, t), tr.px);
    const state = (t: bigint, category: DiagEvent["category"]) =>
      fakeEvent(t, category, { kind: "state" });
    const edges = (r: { left: number; right: number }, left: number, right: number) => {
      near(r.left, left);
      near(r.right, right);
    };

    // Events at 5 h (active), 5 h 20 min (change), 5 h 40 min (snapshot) and 130 h (off the track).
    const marks = on([
      state(5n * H, "active"),
      state(5n * H + 20n * MIN, "change"),
      state(5n * H + 40n * MIN, "snapshot"),
      state(130n * H, "active"),
    ]);
    expect(marks).toHaveLength(2);
    const [fault, dot] = marks.map((m) => stripPin(m));
    // The most severe category of the group decides: active beats change.
    expect(fault?.shape).toBe("fault");
    expect(fault?.color).toBe("#be123c");
    edges(fault?.drawn as never, 58.5, 65.5);
    edges(fault?.hit as never, 57, 67);
    expect(marks[0]?.events).toHaveLength(2);
    expect(dot?.shape).toBe("dot");
    expect(dot?.color).toBe("#64748b");
    edges(dot?.drawn as never, 66, 70);
    edges(dot?.hit as never, 63, 73);

    // One change at 10 h: a 2 px tick; its hit is widened to 10 px.
    const [one] = on([state(10n * H, "change")]).map((m) => stripPin(m));
    expect(one?.shape).toBe("change");
    expect(one?.color).toBe("#7c3aed");
    edges(one?.drawn as never, 119, 121);
    edges(one?.hit as never, 115, 125);

    // Two changes at 15 h and 15 h 10 min share one pin, 4 px wide.
    const many = on([state(15n * H, "change"), state(15n * H + 10n * MIN, "change")]);
    expect(many).toHaveLength(1);
    const [several] = many.map((m) => stripPin(m));
    expect(several?.shape).toBe("change");
    edges(several?.drawn as never, 179, 183);
    edges(several?.hit as never, 176, 186);

    // An active DTC read at 20 h: hollow in the fault colour, 6 px.
    const [read] = on([fakeEvent(20n * H, "active")]).map((m) => stripPin(m));
    expect(read?.shape).toBe("hollow");
    expect(read?.color).toBe("#be123c");
    edges(read?.drawn as never, 237, 243);
    edges(read?.hit as never, 235, 245);

    // Several reads are 8 px wide.
    const reads = on([
      fakeEvent(20n * H, "active", { name: "P1" }),
      fakeEvent(20n * H, "stored", { name: "P2" }),
    ]);
    expect(reads).toHaveLength(1);
    const wide = stripPin(reads[0] as never);
    expect(wide.shape).toBe("hollow");
    edges(wide.drawn, 236, 244);
  });

  it("names the pin shape of a mark by kind and category", () => {
    const shape = (e: DiagEvent): PinShape =>
      pinShape(groupMarks([e], () => 10, 100)[0] as NonNullable<ReturnType<typeof groupMarks>[0]>);
    // Faults: active and pending, whatever else is in the group.
    expect(shape(fakeEvent(S, "active", { kind: "state" }))).toBe("fault");
    expect(shape(fakeEvent(S, "pending", { kind: "state" }))).toBe("fault");
    // A stored event, and every DTC read, is hollow.
    expect(shape(fakeEvent(S, "stored", { kind: "state" }))).toBe("hollow");
    expect(shape(fakeEvent(S, "active"))).toBe("hollow");
    expect(shape(fakeEvent(S, "passed"))).toBe("hollow");
    // A change is a tick; anything else a dot.
    expect(shape(fakeEvent(S, "change", { kind: "state" }))).toBe("change");
    for (const c of ["refused", "transport", "untested", "passed", "snapshot", "other"] as const) {
      expect(shape(fakeEvent(S, c, { kind: "state" })), c).toBe("dot");
    }
    // A DTC next to a state change is no read: the most severe category decides.
    const mixed = groupMarks(
      [fakeEvent(S, "active"), fakeEvent(S, "change", { kind: "state" })],
      () => 10,
      100,
    )[0];
    expect(pinShape(mixed as NonNullable<typeof mixed>)).toBe("fault");
  });

  it("colours by category family", () => {
    expect(markColor("active")).toBe(EVENT_COLORS.fault);
    expect(markColor("pending")).toBe("#be123c");
    expect(markColor("stored")).toBe("#b45309");
    expect(markColor("change")).toBe("#7c3aed");
    for (const c of ["refused", "transport", "untested", "passed", "snapshot", "other"] as const) {
      expect(markColor(c)).toBe("#64748b");
    }
  });

  it("groups events into chart glyphs", () => {
    // A plot 600 px wide over [0, 60 s): 10 px per second.
    const xOfPlot = (t: bigint) => (Number(t) / Number(60n * S)) * 600;
    const marks = groupMarks(
      [
        fakeEvent(10n * S, "change"),
        fakeEvent(10n * S + S / 2n, "change"),
        fakeEvent(30n * S, "active"),
        fakeEvent(75n * S, "active"),
      ],
      xOfPlot,
      600,
    );
    expect(marks).toHaveLength(2);
    near(marks[0]?.x0 ?? Number.NaN, 100);
    near(marks[0]?.x1 ?? Number.NaN, 105);
    expect(marks[0]?.events).toHaveLength(2);
    near(marks[1]?.x0 ?? Number.NaN, 300);
    near(marks[1]?.x1 ?? Number.NaN, 300);
    expect(marks[1]?.events).toHaveLength(1);
  });

  it("formats pin tooltips", () => {
    const p0ca700 = TESTCAR_DTCS.find((e) => e.name === "P0CA700") as DiagEvent;
    const one = groupMarks([p0ca700], () => 10, 100)[0];
    expect(markTitle(one as NonNullable<typeof one>).split("\n")).toEqual([
      "2026-10-01 07:00:00.000 · Active fault · BMS P0CA700",
      "Discharge current too high",
      "Status 0x29 failing now · confirmed · failed since clear",
      "Fault memory read at this time; when a fault first occurred is unknown",
    ]);
    expect(READ_LINE).toBe(
      "Fault memory read at this time; when a fault first occurred is unknown",
    );

    // The inferred door change at 02:00 UTC = 04:00 Berlin.
    const inferred = fakeEvent(atB(2, 0, 0), "change", {
      kind: "state",
      source: "VCU",
      name: "VCU.door",
      text: "closed",
      from: { text: "open", t: atB(1, 4, 30).toString() },
      inferred: true,
    });
    const gap = groupMarks([inferred], () => 10, 100)[0];
    expect(markTitle(gap as NonNullable<typeof gap>).split("\n")).toEqual([
      "2026-10-01 04:00:00.000 · State change · VCU VCU.door",
      "open → closed",
      "seen after a gap; last seen open at 2026-10-01 03:04:30.000",
    ]);

    // A change that is not inferred has no third line.
    const { inferred: _gap, ...plain } = inferred;
    const noGap = groupMarks([plain], () => 10, 100)[0];
    expect(markTitle(noGap as NonNullable<typeof noGap>).split("\n")).toHaveLength(2);

    // Nine DTCs in one pin: counts by category most severe first, eight lines, then "and 1 more".
    const many = groupMarks(TESTCAR_DTCS, () => 10, 100);
    expect(many).toHaveLength(1);
    const lines = markTitle(many[0] as NonNullable<(typeof many)[0]>).split("\n");
    expect(lines[0]).toBe(
      "9 events · 2 active faults, 1 pending fault, 2 stored faults, 2 untested DTCs, 1 passed DTC, 1 other event",
    );
    expect(lines[1]).toBe(READ_LINE);
    expect(lines).toHaveLength(1 + 1 + 8 + 1);
    expect(lines.at(-1)).toBe("… and 1 more");
    for (const line of lines.slice(2, 10))
      expect(line.startsWith("2026-10-01 07:00:00.000 ")).toBe(true);

    // Long texts are cut to 60 characters with an ellipsis in the lines of several events.
    const long = fakeEvent(atB(5, 0, 0), "active", { name: "P0LONG", text: "x".repeat(100) });
    const cut = markTitle(
      groupMarks([long, TESTCAR_DTCS[0] as DiagEvent], () => 10, 100)[0] as never,
    );
    const longLine = cut.split("\n").find((l) => l.includes("P0LONG")) ?? "";
    expect(longLine.endsWith("…")).toBe(true);
    expect(longLine).not.toContain("x".repeat(61));
    expect(longLine).toContain("x".repeat(59));
  });

  it("draws fault memory reads hollow", () => {
    const hollow = { background: "var(--panel)", boxShadow: "inset 0 0 0 1px #be123c" };
    const active = (name: string) => fakeEvent(atB(5, 0, 0), "active", { name });
    const mark = (events: DiagEvent[]) => groupMarks(events, () => 10, 100)[0];
    const one = mark([active("P1")]);
    expect(one?.read).toBe(true);
    expect(markStyle(one as NonNullable<typeof one>)).toEqual(hollow);
    // The lone DTC mark is at least 5 px wide.
    expect((one?.drawn.right ?? 0) - (one?.drawn.left ?? 0)).toBeGreaterThanOrEqual(5);

    const two = mark([active("P1"), active("P2")]);
    expect(two?.read).toBe(true);
    expect(markStyle(two as NonNullable<typeof two>)).toEqual(hollow);

    // A DTC and a state change: filled in the most severe colour.
    const change = fakeEvent(atB(5, 0, 0), "change", { kind: "state", name: "VCU.door" });
    const mixed = mark([active("P1"), change]);
    expect(mixed?.read).toBe(false);
    expect(markStyle(mixed as NonNullable<typeof mixed>)).toEqual({ background: "#be123c" });

    const state = mark([change]);
    expect(state?.read).toBe(false);
    expect(markStyle(state as NonNullable<typeof state>)).toEqual({ background: "#7c3aed" });
  });
});
