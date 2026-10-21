import { type Density, type Drive, fromIso, type LoggerGap } from "@kipscope/shared";
import { describe, expect, it } from "vitest";
import { groupMarks, stripPin } from "../src/events/marks.ts";
import {
  BREAK_MIN_PX,
  bothRange,
  brushRange,
  centreRange,
  DAY_LABEL_END_PX,
  DAY_LABEL_GAP_PX,
  dayTicks,
  driveRects,
  driveTitle,
  END_SLOT_PX,
  endLabels,
  FLAG_AB_FACE_W,
  FLAG_AB_HIT_W,
  FLAG_EDGE_AB_HIT_W,
  FLAG_FACE_H,
  FLAG_FACE_W,
  FLAG_HIT,
  FLAG_HIT_TOP,
  FLAG_MERGE_PX,
  hitZone,
  hoverText,
  jumpRange,
  MIN_WINDOW_PX,
  markerX,
  panRange,
  presence,
  resizeRange,
  rowsText,
  STRIP_PX,
  StripGesture,
  snap,
  stepDrive,
  stripFlags,
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
const D = 24n * H;

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
    expect(MIN_WINDOW_PX).toBe(3);
    // [5 h, 5 h 20 min): 4 px, drawn [60, 64], grab widened about the centre to 12 px: [56, 68]; no caret.
    const small = windowRects(tr, r(5n * H, 5n * H + 20n * MIN));
    near(small?.drawn.left ?? NaN, 60);
    near(small?.drawn.right ?? NaN, 64);
    near(small?.grab.left ?? NaN, 56);
    near(small?.grab.right ?? NaN, 68);
    expect(small?.caret).toBe(false);

    // [5 h, 5 h 5 min): 1 px exact, drawn 3 px about its centre 60.5: [59, 62], grab [54.5, 66.5], caret.
    const tiny = windowRects(tr, r(5n * H, 5n * H + 5n * MIN));
    near(tiny?.drawn.left ?? NaN, 59);
    near(tiny?.drawn.right ?? NaN, 62);
    near(tiny?.grab.left ?? NaN, 54.5);
    near(tiny?.grab.right ?? NaN, 66.5);
    expect(tiny?.caret).toBe(true);

    // [5 h, 10 h): drawn [60, 120], grab = drawn, no caret.
    const mid = windowRects(tr, r(5n * H, 10n * H));
    near(mid?.drawn.left ?? NaN, 60);
    near(mid?.drawn.right ?? NaN, 120);
    expect(mid?.grab).toEqual(mid?.drawn);
    expect(mid?.caret).toBe(false);

    // [0, 120 h): clipped to the track end 1438.
    const whole = windowRects(tr, r(0n, 120n * H));
    near(whole?.drawn.left ?? NaN, 0);
    near(whole?.drawn.right ?? NaN, 1438);
    expect(whole?.caret).toBe(false);

    // A sub-pixel range is drawn 3 px wide about its centre, with the caret.
    const thin = windowRects(tr, r(5n * H, 5n * H + S));
    near((thin?.drawn.right ?? NaN) - (thin?.drawn.left ?? NaN), 3);
    near(((thin?.drawn.left ?? NaN) + (thin?.drawn.right ?? NaN)) / 2, 60 + (0.5 / 3600) * 12);
    expect(thin?.caret).toBe(true);

    // At the track start it shifts inside instead of leaving the track.
    const edge = windowRects(tr, r(0n, S));
    near(edge?.drawn.left ?? NaN, 0);
    near(edge?.drawn.right ?? NaN, 3);
    expect(edge?.caret).toBe(true);

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

    // Pins (D-095, DW20): events at 5 h (active), 5 h 20 min (change) and 5 h 40 min (snapshot), i.e. x 60,
    // 64 and 68, form two pins: a fault (hit [57, 67]) and a dot (hit [63, 73]). They are checked first,
    // in the pin lane (y < 11).
    const pinMarks = groupMarks(
      [5n * H, 5n * H + 20n * MIN, 5n * H + 40n * MIN].map((t, i) =>
        fakeEvent(t, (["active", "change", "snapshot"] as const)[i] as "active", { kind: "state" }),
      ),
      (t) => xOf(tr, t),
      tr.px,
    );
    expect(pinMarks).toHaveLength(2);
    const pins = pinMarks.map((m) => stripPin(m).hit);
    near(pins[0]?.left ?? NaN, 57);
    near(pins[0]?.right ?? NaN, 67);
    near(pins[1]?.left ?? NaN, 63);
    near(pins[1]?.right ?? NaN, 73);
    const withPins = (x: number, y: number) => hitZone(tr, x, y, mid, [], pins);
    expect(withPins(62, 3)).toEqual({ kind: "pin", index: 0 });
    // Both rects hold 64.5; the nearer centre (62 vs 68) wins.
    expect(withPins(64.5, 3)).toEqual({ kind: "pin", index: 0 });
    // Both hold 66: centre 62 is 4 away, centre 68 is 2 away.
    expect(withPins(66, 3)).toEqual({ kind: "pin", index: 1 });
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

  it("formats drive tooltips", () => {
    // drivecar: start 2026-10-02T00:00:00Z; drive 1 = [01:00Z, 01:30Z) = 03:00 – 03:30 CEST.
    const drivecar = density({
      start: "1790899200000000000",
      first: "1790899200000000000",
      last: "1790920800000000000",
      width: (5n * MIN).toString(),
      counts: new Array<number>(73).fill(1),
      drives: [
        { from: "1790902800000000000", to: "1790904600000000000", rows: 177_180 },
        { from: "1790910000000000000", to: "1790910300000000000", rows: 30_030 },
        { from: "1790910390000000000", to: "1790910600000000000", rows: 21_021 },
      ],
    });
    // Start and duration of range-picker "Start and duration": `YY-MM-DD HH:MM  H:MM h`.
    expect(driveTitle(drivecar, 0)).toBe("Drive 1 of 3 · 26-10-02 03:00  0:30 h · 177,180 rows");
    expect(driveTitle(drivecar, 1)).toBe("Drive 2 of 3 · 26-10-02 05:00  0:05 h · 30,030 rows");
    expect(driveTitle(drivecar, 2)).toBe("Drive 3 of 3 · 26-10-02 05:06  0:03 h · 21,021 rows");

    expect(rowsText(0)).toBe("no rows");
    expect(rowsText(1)).toBe("1 row");
    expect(rowsText(2)).toBe("2 rows");
    expect(rowsText(999)).toBe("999 rows");
    expect(rowsText(30_030)).toBe("30,030 rows");
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

  it("pins the strip numbers of D-094 and D-095", () => {
    expect(STRIP_PX).toBe(28);
    expect(BREAK_MIN_PX).toBe(3);
    expect([FLAG_FACE_W, FLAG_FACE_H, FLAG_HIT, FLAG_HIT_TOP]).toEqual([14, 12, 24, 11]);
    expect([FLAG_AB_FACE_W, FLAG_AB_HIT_W, FLAG_EDGE_AB_HIT_W, FLAG_MERGE_PX]).toEqual([
      26, 32, 36, 18,
    ]);
    expect([END_SLOT_PX, DAY_LABEL_GAP_PX, DAY_LABEL_END_PX]).toEqual([48, 32, 24]);
  });

  it("draws data presence with breaks at empty buckets and logger gaps", () => {
    // "Geometry" with buckets 10 and 11 empty, first 30 min, last 119 h 30 min.
    const counts = new Array<number>(120).fill(1);
    counts[10] = 0;
    counts[11] = 0;
    const d = density({
      counts,
      first: (30n * MIN).toString(),
      last: (119n * H + 30n * MIN).toString(),
    });
    const t = trackOf(d, 1438);
    const range = r(20n * H, 30n * H);
    const gaps: LoggerGap[] = [
      { from: 50n * H, to: 50n * H + 15n * MIN },
      { from: 50n * H + 17n * MIN + 30n * S, to: 50n * H + 25n * MIN },
    ];

    // Empty buckets and both logger gaps; the two gaps (3 px and 1.5 px widened to 3 px) merge.
    const withGaps = presence(t, d, gaps, range);
    expect(withGaps.runs).toHaveLength(5);
    withGaps.runs.forEach((run, i) => {
      const [left, right] = [
        [6, 120],
        [144, 240],
        [240, 360],
        [360, 600],
        [605.75, 1434],
      ][i] as number[];
      near(run.left, left as number);
      near(run.right, right as number);
      expect(run.shown, `run ${i} shown`).toBe(i === 2);
    });
    expect(withGaps.breaks).toHaveLength(2);
    near(withGaps.breaks[0]?.left ?? NaN, 120);
    near(withGaps.breaks[0]?.right ?? NaN, 144);
    expect(withGaps.breaks[0]?.title).toBe("No data · 70-01-01 11:00  2:00 h");
    near(withGaps.breaks[1]?.left ?? NaN, 600);
    near(withGaps.breaks[1]?.right ?? NaN, 605.75);
    expect(withGaps.breaks[1]?.title).toBe("No data · 2 gaps · 70-01-03 03:00  0:25 h");

    // Without logger gaps only the empty buckets break the line; the data after 30 h runs on.
    for (const none of [undefined, []]) {
      const plain = presence(t, d, none, range);
      expect(plain.runs).toHaveLength(4);
      [
        [6, 120, false],
        [144, 240, false],
        [240, 360, true],
        [360, 1434, false],
      ].forEach(([left, right, shown], i) => {
        near(plain.runs[i]?.left ?? NaN, left as number);
        near(plain.runs[i]?.right ?? NaN, right as number);
        expect(plain.runs[i]?.shown).toBe(shown);
      });
      expect(plain.breaks).toHaveLength(1);
      near(plain.breaks[0]?.left ?? NaN, 120);
      near(plain.breaks[0]?.right ?? NaN, 144);
    }

    // No range: nothing is shown; a logger gap of 1 px ([600, 601]) is widened to 3 px about its centre.
    const noRange = presence(t, d, undefined, undefined);
    expect(noRange.runs.every((run) => !run.shown)).toBe(true);
    const narrow = presence(t, density(), [{ from: 50n * H, to: 50n * H + 5n * MIN }], undefined);
    expect(narrow.breaks).toHaveLength(1);
    near(narrow.breaks[0]?.left ?? NaN, 599);
    near(narrow.breaks[0]?.right ?? NaN, 602);
  });

  it("places and merges the cursor flags, edge flags outside the track", () => {
    const flags = (a: bigint | undefined, b: bigint | undefined) => stripFlags(tr, a, b);
    const check = (
      got: ReturnType<typeof stripFlags>,
      lines: [string, number][],
      list: { name: string; x: number; hit: number[]; edge?: string }[],
    ) => {
      expect(got.lines.map((l) => l.name)).toEqual(lines.map(([n]) => n));
      for (const [i, l] of got.lines.entries()) near(l.x, (lines[i] as [string, number])[1]);
      expect(got.flags.map((f) => f.name)).toEqual(list.map((f) => f.name));
      got.flags.forEach((f, i) => {
        const want = list[i] as (typeof list)[number];
        near(f.x, want.x);
        near(f.hit.left, want.hit[0] as number);
        near(f.hit.right, want.hit[1] as number);
        expect(f.edge, `${f.name} edge`).toBe(want.edge);
      });
    };
    // A at 7 h (x 84), B at 9 h (x 108): two flags side by side.
    check(
      flags(7n * H, 9n * H),
      [
        ["A", 84],
        ["B", 108],
      ],
      [
        { name: "A", x: 84, hit: [72, 96] },
        { name: "B", x: 108, hit: [96, 120] },
      ],
    );
    // 18 px apart (8 h 30 min = x 102): still two flags.
    check(
      flags(7n * H, 8n * H + 30n * MIN),
      [
        ["A", 84],
        ["B", 102],
      ],
      [
        { name: "A", x: 84, hit: [72, 96] },
        { name: "B", x: 102, hit: [90, 114] },
      ],
    );
    // 4 px apart: one A·B flag centred between the lines, hit 32 px wide.
    check(
      flags(7n * H, 7n * H + 20n * MIN),
      [
        ["A", 84],
        ["B", 88],
      ],
      [{ name: "AB", x: 86, hit: [70, 102] }],
    );
    // A off.
    check(
      flags(undefined, 7n * H + 20n * MIN),
      [["B", 88]],
      [{ name: "B", x: 88, hit: [76, 100] }],
    );
    // A before the track's start: no line, an edge flag at 14 with hit [0, 24]; B inside.
    check(
      flags(-S, 7n * H + 20n * MIN),
      [["B", 88]],
      [
        { name: "A", x: 14, hit: [0, 24], edge: "before" },
        { name: "B", x: 88, hit: [76, 100] },
      ],
    );
    // B after the track's end: no line, an edge flag at 1424 with hit [1414, 1438].
    check(
      flags(7n * H, 121n * H),
      [["A", 84]],
      [
        { name: "A", x: 84, hit: [72, 96] },
        { name: "B", x: 1424, hit: [1414, 1438], edge: "after" },
      ],
    );
    // Both before the start: one A·B edge flag at 20 with hit [0, 36].
    check(flags(-S, -2n * S), [], [{ name: "AB", x: 20, hit: [0, 36], edge: "before" }]);
    // Neither cursor: nothing.
    check(flags(undefined, undefined), [], []);
  });

  it("centres the view on a clicked cursor flag", () => {
    // A at 5 h 0 min 0.135 s, view [0, 20 min): same span, centred on A.
    const a = 5n * H + 135_000_000n;
    expect(centreRange(r(0n, 20n * MIN), a)).toEqual(r(a - 10n * MIN, a + 10n * MIN));
    expect(centreRange(r(0n, 20n * MIN), a)).toEqual(
      r(4n * H + 50n * MIN + 135_000_000n, 5n * H + 10n * MIN + 135_000_000n),
    );
    // A·B with A at 5 h and B at 5 h 1 min: centred on the midpoint 5 h 0 min 30 s, span at least twice
    // their distance (2 min); the view's span (20 min) is kept when it is longer.
    expect(bothRange(r(0n, 20n * MIN), 5n * H, 5n * H + MIN)).toEqual(
      r(4n * H + 50n * MIN + 30n * S, 5n * H + 10n * MIN + 30n * S),
    );
    expect(bothRange(r(0n, MIN), 5n * H, 5n * H + MIN)).toEqual(
      r(4n * H + 59n * MIN + 30n * S, 5n * H + MIN + 30n * S),
    );
    // The order of the cursors does not matter.
    expect(bothRange(r(0n, MIN), 5n * H + MIN, 5n * H)).toEqual(
      r(4n * H + 59n * MIN + 30n * S, 5n * H + MIN + 30n * S),
    );
  });

  it("labels the strip's ends", () => {
    const label = (from: string, to: string) => endLabels(fromIso(from), fromIso(to));
    // Under 24 h: HH:MM, cut; the tooltip is the full local time with seconds.
    expect(label("2026-10-13T13:06:03Z", "2026-10-13T13:18:33Z")).toEqual({
      left: { text: "15:06", title: "Tue 2026-10-13 15:06:03" },
      right: { text: "15:18", title: "Tue 2026-10-13 15:18:33" },
    });
    // Days apart: MM-DD of the local day.
    expect(label("2026-10-11T12:34:24Z", "2026-10-20T23:52:43Z")).toEqual({
      left: { text: "10-11", title: "Sun 2026-10-11 14:34:24" },
      right: { text: "10-21", title: "Wed 2026-10-21 01:52:43" },
    });
    // 2 h 21 min across local midnight: still HH:MM.
    const across = label("2026-10-20T21:31:05Z", "2026-10-20T23:52:43Z");
    expect(across.left.text).toBe("23:31");
    expect(across.right.text).toBe("01:52");
  });

  it("marks local midnights and words the hover time", () => {
    // Local midnights of 1970 (CET, UTC+1) lie at 23 h, 47 h, 71 h, 95 h and 119 h; 1,438 px, pitch 12.
    const ticks = dayTicks(tr, 0n, 120n * H);
    expect(ticks.map((t) => t.text)).toEqual(["01-02", "01-03", "01-04", "01-05"]);
    for (const [i, x] of [276, 564, 852, 1140].entries()) near(ticks[i]?.x ?? NaN, x);
    // 142 px (pitch 1.2): labels must be 32 px apart, so only 01-02 (27.6) and 01-04 (85.2) stay.
    const small = dayTicks(trackOf(density(), 142), 0n, 120n * H);
    expect(small.map((t) => t.text)).toEqual(["01-02", "01-04"]);
    near(small[0]?.x ?? NaN, 27.6);
    near(small[1]?.x ?? NaN, 85.2);
    // A span without a midnight has none.
    expect(dayTicks(tr, 2n * H, 10n * H)).toEqual([]);

    const t = fromIso("2026-10-13T13:13:48.700Z");
    expect(hoverText(t, 12n * MIN)).toBe("15:13:48");
    expect(hoverText(t, 9n * D)).toBe("10-13 15:13");
  });
});
