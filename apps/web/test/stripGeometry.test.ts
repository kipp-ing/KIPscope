import type { Density, Drive } from "@kipscope/shared";
import { describe, expect, it } from "vitest";
import { groupMarks } from "../src/events/marks.ts";
import {
  barTitle,
  brushRange,
  centreRange,
  driveRects,
  driveTitle,
  hitZone,
  jumpRange,
  markerX,
  panRange,
  resizeRange,
  rowsText,
  StripGesture,
  snap,
  stepDrive,
  stripUnit,
  tOf,
  trackOf,
  wholeRange,
  windowRects,
  xOf,
} from "../src/time/stripGeometry.ts";
import { fakeEvent } from "./fakeEvents.ts";

// Tests run with TZ=Europe/Berlin (see package.json); October 2026 is CEST, UTC+2.

const S = 1_000_000_000n;
const MIN = 60n * S;
const H = 3600n * S;

/** Density as a track needs it: start 0, 120 bars of 1 h (design S6 "Geometry"). */
function density(over: Partial<Density> = {}): Density {
  return {
    dataRef: "x",
    first: "0",
    last: (120n * H - 1n).toString(),
    width: H.toString(),
    start: "0",
    counts: new Array<number>(120).fill(1),
    grid: (H / 400n).toString(),
    drives: [],
    ...over,
  };
}

/** "Geometry": 1,438 px, 120 bars of 1 h from 0 -> pitch (1438 + 2) / 120 = 12 px. */
const tr = trackOf(density(), 1438);
const r = (from: bigint, to: bigint) => ({ from, to });
const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe("strip geometry", () => {
  it("maps times to pixels and back on the bar pitch", () => {
    expect(tr.n).toBe(120);
    expect(tr.px).toBe(1438);
    expect(tr.start).toBe(0n);
    expect(tr.width).toBe(H);
    near(xOf(tr, 5n * H), 60);
    near(xOf(tr, 5n * H + 20n * MIN), 64);
    near(xOf(tr, 0n), 0);
    near(xOf(tr, -H), -12); // not clamped
    near(xOf(tr, 120n * H), 1440);

    expect(tOf(tr, 60)).toBe(5n * H);
    expect(tOf(tr, 60.5)).toBe(5n * H + 150n * S); // 0.5 px = 1/24 h = 150 s
    expect(tOf(tr, -20)).toBe(0n); // clamped to [0, px]
    expect(tOf(tr, 5000)).toBe(BigInt(1438 * 300) * S); // 1438 / 12 h = 431,400 s

    // Unit: largest power of ten <= n * width / 1000 = 432 s -> 100 s.
    expect(stripUnit(tr)).toBe(100n * S);
    // Never below 1 ns.
    expect(stripUnit(trackOf(density({ width: "1", counts: [1, 1] }), 100))).toBe(1n);
    // 10 bars of 1 ms: 10 ms / 1000 = 10 us.
    expect(
      stripUnit(trackOf(density({ width: "1000000", counts: new Array(10).fill(1) }), 100)),
    ).toBe(10_000n);
    // Ties round up.
    expect(snap(149n * S, 100n * S)).toBe(100n * S);
    expect(snap(150n * S, 100n * S)).toBe(200n * S);
    expect(snap(250n * S, 100n * S)).toBe(300n * S);
    expect(snap(-150n * S, 100n * S)).toBe(-100n * S);
    expect(snap(7n, 1n)).toBe(7n);
  });

  it("draws the window pixel-exact with minimum widths", () => {
    // [5 h, 5 h 20 min): drawn [60, 64], grab widened about the centre to 12 px: [56, 68].
    const small = windowRects(tr, r(5n * H, 5n * H + 20n * MIN));
    near(small?.drawn.left ?? NaN, 60);
    near(small?.drawn.right ?? NaN, 64);
    near(small?.grab.left ?? NaN, 56);
    near(small?.grab.right ?? NaN, 68);

    // [5 h, 10 h): drawn [60, 120], grab = drawn.
    const mid = windowRects(tr, r(5n * H, 10n * H));
    near(mid?.drawn.left ?? NaN, 60);
    near(mid?.drawn.right ?? NaN, 120);
    expect(mid?.grab).toEqual(mid?.drawn);

    // [0, 120 h): clipped to the track end 1438.
    const whole = windowRects(tr, r(0n, 120n * H));
    near(whole?.drawn.left ?? NaN, 0);
    near(whole?.drawn.right ?? NaN, 1438);

    // A sub-pixel range is drawn 2 px wide about its centre.
    const thin = windowRects(tr, r(5n * H, 5n * H + S));
    near((thin?.drawn.right ?? NaN) - (thin?.drawn.left ?? NaN), 2);
    near(((thin?.drawn.left ?? NaN) + (thin?.drawn.right ?? NaN)) / 2, 60 + (0.5 / 3600) * 12);

    // At the track start it shifts inside instead of leaving the track.
    const edge = windowRects(tr, r(0n, S));
    near(edge?.drawn.left ?? NaN, 0);
    near(edge?.drawn.right ?? NaN, 2);

    // No overlap with the recording's bars: no window.
    expect(windowRects(tr, r(130n * H, 140n * H))).toBeUndefined();
    expect(windowRects(tr, r(-10n * H, -H))).toBeUndefined();
  });

  it("finds the hit zone", () => {
    const small = r(5n * H, 5n * H + 20n * MIN);
    const zone = (x: number, y: number, range: ReturnType<typeof r> | undefined, d: Drive[] = []) =>
      hitZone(tr, x, y, range, d);
    // Window [5 h, 5 h 20 min): 4 px wide, no edge zones, grab [56, 68].
    expect(zone(62, 10, small)).toEqual({ kind: "body" });
    expect(zone(57, 10, small)).toEqual({ kind: "body" });
    expect(zone(55, 10, small)).toEqual({ kind: "bars" });
    expect(zone(62, 26, small)).toEqual({ kind: "bars" }); // drive row without drives

    // Window [5 h, 10 h): drawn [60, 120], edges +-4 px.
    const mid = r(5n * H, 10n * H);
    expect(zone(57, 10, mid)).toEqual({ kind: "edge", side: "from" });
    expect(zone(64, 10, mid)).toEqual({ kind: "edge", side: "from" });
    expect(zone(65, 10, mid)).toEqual({ kind: "body" });
    expect(zone(123, 10, mid)).toEqual({ kind: "edge", side: "to" });
    expect(zone(125, 10, mid)).toEqual({ kind: "bars" });

    // A window spanning the whole track has no body: it brushes. Its edges still resize.
    const whole = r(0n, 120n * H);
    expect(zone(700, 10, whole)).toEqual({ kind: "bars" });
    expect(zone(2, 10, whole)).toEqual({ kind: "edge", side: "from" });
    expect(zone(1436, 10, whole)).toEqual({ kind: "edge", side: "to" });

    // Without a target range there are only bars.
    expect(zone(62, 10, undefined)).toEqual({ kind: "bars" });

    // Pins (add-events V3): events at 5 h, 5 h 20 min and 5 h 40 min, i.e. x 60, 64 and 68, form two
    // pins with hit spans [58, 66] and [64, 72]. They are checked first, in the pin lane (y < 8).
    const pins = groupMarks(
      [5n * H, 5n * H + 20n * MIN, 5n * H + 40n * MIN].map((t) => fakeEvent(t, "active")),
      (t) => xOf(tr, t),
      tr.px,
    ).map((m) => m.hit);
    expect(pins).toHaveLength(2);
    const withPins = (x: number, y: number) => hitZone(tr, x, y, mid, [], pins);
    expect(withPins(62, 3)).toEqual({ kind: "pin", index: 0 });
    // Both spans hold 64.5; the nearer centre (62 vs 68) wins.
    expect(withPins(64.5, 3)).toEqual({ kind: "pin", index: 0 });
    expect(withPins(69, 3)).toEqual({ kind: "pin", index: 1 });
    // Below the lane the window's zones apply again, and away from the pins the body.
    expect(withPins(62, 12)).toEqual({ kind: "edge", side: "from" });
    expect(withPins(90, 3)).toEqual({ kind: "body" });
    // Without pins nothing changes.
    expect(hitZone(tr, 62, 3, mid, [])).toEqual({ kind: "edge", side: "from" });
  });

  it("computes jump, brush, pan and resize ranges", () => {
    // Jump: view [0, 20 min), click at x 60 -> centred on 5 h (unit 100 s): [4 h 50 min, 5 h 10 min).
    expect(jumpRange(tr, 60, r(0n, 20n * MIN))).toEqual(r(5n * H - 10n * MIN, 5n * H + 10n * MIN));
    // The centre is rounded to the unit: 60.5 px = 5 h 150 s -> 5 h 200 s.
    expect(jumpRange(tr, 60.5, r(0n, 200n * S))).toEqual(r(5n * H + 100n * S, 5n * H + 300n * S));

    // Brush: both directions, ends on the unit; under 4 px nothing.
    expect(brushRange(tr, 60, 120)).toEqual(r(5n * H, 10n * H));
    expect(brushRange(tr, 120, 60)).toEqual(r(5n * H, 10n * H));
    expect(brushRange(tr, 60, 62)).toBeUndefined();
    expect(brushRange(tr, 60, 63.9)).toBeUndefined();

    // Pan: 6 px = 30 min; 6.2 px = 31 min, rounded to the unit 100 s -> 31 min 40 s.
    expect(panRange(tr, r(5n * H, 10n * H), 6)).toEqual(r(5n * H + 30n * MIN, 10n * H + 30n * MIN));
    expect(panRange(tr, r(5n * H, 10n * H), 6.2)).toEqual(
      r(5n * H + 31n * MIN + 40n * S, 10n * H + 31n * MIN + 40n * S),
    );
    // Pan far left: the centre stays on the track start.
    expect(panRange(tr, r(0n, 20n * MIN), -100)).toEqual(r(-10n * MIN, 10n * MIN));
    // Pan far right: the centre stays on the track end (120 h).
    expect(panRange(tr, r(100n * H, 110n * H), 500)).toEqual(r(115n * H, 125n * H));

    // Resize: the end by 12 px = 1 h; the start by 100 px stops 100 ns before the end.
    const view = r(5n * H, 10n * H);
    expect(resizeRange(tr, view, "to", 12)).toEqual(r(5n * H, 11n * H));
    expect(resizeRange(tr, view, "from", 100)).toEqual(r(10n * H - 100n, 10n * H));
    // Kept on the track.
    expect(resizeRange(tr, view, "from", -100)).toEqual(r(0n, 10n * H));
    expect(resizeRange(tr, view, "to", 5000)).toEqual(r(5n * H, 120n * H));
    // The end cannot cross the start either.
    expect(resizeRange(tr, view, "to", -500)).toEqual(r(5n * H, 5n * H + 100n));

    // Centre (add-events V3): the span is kept, the pin's first event is the exact middle, no snapping.
    const pinT = 5n * H + 135n * 1_000_000n; // 5 h 0 min 0.135 s
    expect(centreRange(r(0n, 20n * MIN), pinT)).toEqual(
      r(5n * H - 10n * MIN + 135n * 1_000_000n, 5n * H + 10n * MIN + 135n * 1_000_000n),
    );

    // Whole recording: first to just after last, rounded up to the next ms.
    expect(wholeRange(density({ first: "1000000000", last: "5000000500" }))).toEqual(
      r(1_000_000_000n, 5_001_000_000n),
    );
    expect(wholeRange(density({ first: "7", last: "5000000" }))).toEqual(r(7n, 6_000_000n));
  });

  it("turns pointer sequences into strip actions", () => {
    const body = { kind: "body" } as const;
    const bars = { kind: "bars" } as const;

    // A click on the body (moved 3 px): a jump at the release.
    let g = new StripGesture();
    g.down(100, 10, body, 0);
    expect(g.move(103, 10)).toBeUndefined(); // below the threshold: no preview
    expect(g.up(103, 10, 50)).toEqual({ kind: "jump", x: 103 });

    // A drag on the body: preview, then a pan by 30 px.
    g = new StripGesture();
    g.down(100, 10, body, 0);
    expect(g.move(130, 10)).toEqual({ kind: "pan", dx: 30 });
    expect(g.up(130, 10, 80)).toEqual({ kind: "pan", dx: 30 });

    // A drag on an edge resizes that side.
    g = new StripGesture();
    g.down(120, 10, { kind: "edge", side: "to" }, 0);
    expect(g.move(140, 10)).toEqual({ kind: "resize", side: "to", dx: 20 });
    expect(g.up(140, 10, 80)).toEqual({ kind: "resize", side: "to", dx: 20 });

    // A click on a pin centres on it; a drag from a pin brushes like one on the bars.
    g = new StripGesture();
    g.down(62, 3, { kind: "pin", index: 1 }, 0);
    expect(g.up(62, 3, 40)).toEqual({ kind: "centre", pin: 1 });
    g = new StripGesture();
    g.down(62, 3, { kind: "pin", index: 1 }, 0);
    expect(g.move(102, 3)).toEqual({ kind: "brush", x0: 62, x1: 102 });
    expect(g.up(102, 3, 90)).toEqual({ kind: "brush", x0: 62, x1: 102 });

    // A click on a drive fits it.
    g = new StripGesture();
    g.down(50, 26, { kind: "drive", index: 2 }, 0);
    expect(g.up(50, 26, 40)).toEqual({ kind: "fit", drive: 2 });

    // Bars: a click jumps; a second click 300 ms later, 2 px away, shows the whole recording.
    g = new StripGesture();
    g.down(50, 10, bars, 1000);
    expect(g.up(50, 10, 1040)).toEqual({ kind: "jump", x: 50 });
    g.down(52, 10, bars, 1300);
    expect(g.up(52, 10, 1340)).toEqual({ kind: "whole" });
    // The pair is used up: a third click is a jump again.
    g.down(52, 10, bars, 1400);
    expect(g.up(52, 10, 1440)).toEqual({ kind: "jump", x: 52 });

    // Too late (> 500 ms after the first release) or too far (> 4 px): two jumps.
    g = new StripGesture();
    g.down(50, 10, bars, 0);
    g.up(50, 10, 40);
    g.down(50, 10, bars, 600);
    expect(g.up(50, 10, 641)).toEqual({ kind: "jump", x: 50 });
    g = new StripGesture();
    g.down(50, 10, bars, 0);
    g.up(50, 10, 40);
    g.down(60, 10, bars, 200);
    expect(g.up(60, 10, 240)).toEqual({ kind: "jump", x: 60 });

    // Brush on bars (or a drive): x0 = press, x1 = current, both directions.
    g = new StripGesture();
    g.down(60, 10, bars, 0);
    expect(g.move(120, 10)).toEqual({ kind: "brush", x0: 60, x1: 120 });
    expect(g.up(120, 10, 90)).toEqual({ kind: "brush", x0: 60, x1: 120 });
    g = new StripGesture();
    g.down(120, 26, { kind: "drive", index: 0 }, 0);
    expect(g.move(60, 26)).toEqual({ kind: "brush", x0: 120, x1: 60 });
    expect(g.up(60, 26, 90)).toEqual({ kind: "brush", x0: 120, x1: 60 });

    // A brush of 2 px with 10 px vertical movement is a drag by distance but sends nothing.
    g = new StripGesture();
    g.down(60, 10, bars, 0);
    expect(g.move(62, 20)).toEqual({ kind: "brush", x0: 60, x1: 62 });
    expect(g.up(62, 20, 90)).toBeUndefined();

    // A drag is no click for a double-click: the next click right after jumps.
    g = new StripGesture();
    g.down(60, 10, bars, 0);
    g.move(120, 10);
    g.up(120, 10, 100);
    g.down(120, 10, bars, 200);
    expect(g.up(120, 10, 240)).toEqual({ kind: "jump", x: 120 });

    // Cancelled drag: moved 40 px, cancel; nothing from move or release afterwards.
    g = new StripGesture();
    g.down(60, 10, bars, 0);
    expect(g.move(100, 10)).toEqual({ kind: "brush", x0: 60, x1: 100 });
    g.cancel();
    expect(g.move(110, 10)).toBeUndefined();
    expect(g.up(110, 10, 90)).toBeUndefined();

    // Cancelled pan likewise, and a release without a press yields nothing.
    g = new StripGesture();
    g.down(100, 10, body, 0);
    g.move(150, 10);
    g.cancel();
    expect(g.up(150, 10, 90)).toBeUndefined();
    expect(new StripGesture().up(10, 10, 0)).toBeUndefined();
  });

  it("draws drives with a minimum width and hit width", () => {
    const drive = (from: bigint, to: bigint, rows = 1): Drive => ({
      from: from.toString(),
      to: to.toString(),
      rows,
    });
    // [5 h, 5 h 4 min): 0.8 px exact, centre 60.4 -> drawn 4 px [58.4, 62.4], hit 8 px [56.4, 64.4].
    const [one] = driveRects(tr, [drive(5n * H, 5n * H + 4n * MIN)]);
    near(one?.drawn.left ?? NaN, 58.4);
    near(one?.drawn.right ?? NaN, 62.4);
    near(one?.hit.left ?? NaN, 56.4);
    near(one?.hit.right ?? NaN, 64.4);

    // A long drive keeps its exact drawn width; the hit is the drawn rect widened only to 8 px.
    const [long] = driveRects(tr, [drive(10n * H, 20n * H)]);
    near(long?.drawn.left ?? NaN, 120);
    near(long?.drawn.right ?? NaN, 240);
    near(long?.hit.left ?? NaN, 120);
    near(long?.hit.right ?? NaN, 240);

    // Hit zones in the drive row: inside the hit rect only; overlaps go to the nearest centre.
    const a = drive(5n * H, 5n * H + 4n * MIN); // centre 60.4, hit [56.4, 64.4]
    const b = drive(5n * H + 30n * MIN, 5n * H + 34n * MIN); // centre 66.4, hit [62.4, 70.4]
    expect(hitZone(tr, 57, 26, undefined, [a, b])).toEqual({ kind: "drive", index: 0 });
    expect(hitZone(tr, 56, 26, undefined, [a, b])).toEqual({ kind: "bars" });
    expect(hitZone(tr, 63, 26, undefined, [a, b])).toEqual({ kind: "drive", index: 0 });
    expect(hitZone(tr, 64, 26, undefined, [a, b])).toEqual({ kind: "drive", index: 1 });
    expect(hitZone(tr, 70, 26, undefined, [a, b])).toEqual({ kind: "drive", index: 1 });
    // Above the drive row, drives are not hit.
    expect(hitZone(tr, 57, 10, undefined, [a, b])).toEqual({ kind: "bars" });
  });

  it("steps to the previous and next drive", () => {
    const d = (from: number, to: number): Drive => ({
      from: BigInt(from).toString(),
      to: BigInt(to).toString(),
      rows: 1,
    });
    const drives = [d(100, 200), d(300, 400), d(500, 600)];
    const step = (from: number, to: number, dir: 1 | -1) =>
      stepDrive(drives, r(BigInt(from), BigInt(to)), dir);
    expect(step(300, 400, 1)).toBe(drives[2]);
    expect(step(300, 400, -1)).toBe(drives[0]);
    expect(step(320, 330, 1)).toBe(drives[1]);
    expect(step(320, 330, -1)).toBe(drives[0]);
    expect(step(0, 1000, 1)).toBe(drives[2]);
    expect(step(0, 1000, -1)).toBe(drives[1]);
    expect(step(600, 700, 1)).toBeUndefined();
    expect(step(600, 700, -1)).toBe(drives[2]);
    expect(stepDrive([], r(0n, 10n), 1)).toBeUndefined();
  });

  it("formats bar and drive tooltips", () => {
    // drivecar: start 2026-10-02T00:00:00Z, 73 bars of 5 min; bar 12 = [01:00Z, 01:05Z) = 03:00 CEST.
    const counts = new Array<number>(73).fill(0);
    counts[12] = 30_030;
    counts[13] = 1;
    const drivecar = density({
      start: "1790899200000000000",
      first: "1790899200000000000",
      last: "1790920800000000000",
      width: (5n * MIN).toString(),
      counts,
      drives: [
        { from: "1790902800000000000", to: "1790904600000000000", rows: 177_180 },
        { from: "1790910000000000000", to: "1790910300000000000", rows: 30_030 },
        { from: "1790910390000000000", to: "1790910600000000000", rows: 21_021 },
      ],
    });
    expect(barTitle(drivecar, 12)).toBe("2026-10-02 03:00:00 – 2026-10-02 03:05:00 · 30,030 rows");
    expect(barTitle(drivecar, 0)).toBe("2026-10-02 02:00:00 – 2026-10-02 02:05:00 · no rows");
    expect(barTitle(drivecar, 13)).toBe("2026-10-02 03:05:00 – 2026-10-02 03:10:00 · 1 row");
    expect(driveTitle(drivecar, 0)).toBe(
      "Drive 1 of 3 · 2026-10-02 03:00:00 – 2026-10-02 03:30:00 · 30 min · 177,180 rows",
    );
    expect(driveTitle(drivecar, 2)).toBe(
      "Drive 3 of 3 · 2026-10-02 05:06:30 – 2026-10-02 05:10:00 · 3.5 min · 21,021 rows",
    );

    expect(rowsText(0)).toBe("no rows");
    expect(rowsText(1)).toBe("1 row");
    expect(rowsText(2)).toBe("2 rows");
    expect(rowsText(999)).toBe("999 rows");
    expect(rowsText(1_234_567)).toBe("1,234,567 rows");
  });

  it("places markers inside the track only", () => {
    near(markerX(tr, 5n * H) ?? NaN, 60);
    near(markerX(tr, 0n) ?? NaN, 0);
    expect(markerX(tr, -S)).toBeUndefined();
    expect(markerX(tr, 120n * H)).toBe(1438); // the end of the last bar, capped at the track end
    expect(markerX(tr, 120n * H + 1n)).toBeUndefined();
  });

  it("brushes from a window that covers the recording extent (Brush on smart451)", () => {
    // Bucket start 0 lies before the first row (15 min): the window [15 min, 120 h) starts 3 px inside the track.
    const lateFirst = density({ first: (15n * MIN).toString() });
    const t2 = trackOf(lateFirst, 1438);
    const covering = r(15n * MIN, 120n * H);
    near(windowRects(t2, covering)?.drawn.left ?? NaN, 3);
    expect(hitZone(t2, 700, 10, covering, [])).toEqual({ kind: "bars" });
    expect(hitZone(t2, 100, 10, covering, [])).toEqual({ kind: "bars" });
    // Still not a pan body when the right end stops 2 px short of the track end.
    const short = r(15n * MIN, 120n * H - 10n * MIN);
    expect(hitZone(t2, 700, 10, short, [])).toEqual({ kind: "bars" });
    // A window clearly inside keeps its body.
    const inner = r(30n * MIN, 120n * H - 30n * MIN);
    expect(hitZone(t2, 700, 10, inner, [])).toEqual({ kind: "body" });
  });

  it("brushes from a whole-recording window short of first/last by sub-pixel gaps (smart451)", () => {
    // 118 bars of 1 h at 1,162 px; first 34:24.811 into bar 0, last 52:26.850 into bar 117.
    const MS = 1_000_000n;
    const first = 34n * MIN + 24_811n * MS;
    const last = 117n * H + 52n * MIN + 26_850n * MS;
    const d = density({
      first: first.toString(),
      last: last.toString(),
      counts: new Array<number>(118).fill(1),
    });
    const t2 = trackOf(d, 1162);
    // The loaded signals' extent: 13 ms after first, 5.6 s before last.
    const whole = r(first + 13n * MS, last - 5_639n * MS);
    expect(hitZone(t2, 580, 10, whole, [])).toEqual({ kind: "bars" });
    // A window starting one bar after first is a sub-range: its body pans.
    const later = r(first + H, last - 5_639n * MS);
    expect(hitZone(t2, 580, 10, later, [])).toEqual({ kind: "body" });
  });

  it("ends the tooltip of a count-0 bar with 'no rows' (Bar with no rows)", () => {
    const d = density({ counts: [0, 5, ...new Array<number>(118).fill(0)] });
    expect(barTitle(d, 0).endsWith(" · no rows")).toBe(true);
    expect(barTitle(d, 50).endsWith(" · no rows")).toBe(true);
    expect(barTitle(d, 1).endsWith(" · 5 rows")).toBe(true);
  });
});
