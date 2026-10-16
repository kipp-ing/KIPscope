import { type Density, type Drive, MIN_SPAN_NS } from "@kipscope/shared";
import { DOUBLE_CLICK_MS } from "../chart/cursors.ts";
import { DRAG_THRESHOLD_PX } from "../chart/drag.ts";
import { extentRange, type Range } from "../chart/zoom.ts";
import { PIN_LANE_PX } from "../events/marks.ts";
import { formatRange } from "./axis.ts";
import { formatSpan } from "./strip.ts";

// Pure geometry of the interactive strip (design S6–S10 of add-strip-navigation, D-057).

/** Bar gap in px (strip.css). */
export const GAP_PX = 2;
/** Bars area height; y ≥ BARS_PX is the drive row. */
export const BARS_PX = 24;
export const DRIVE_ROW_PX = 7;
/** An edge zone reaches 4 px to each side of a drawn edge. */
export const EDGE_PX = 4;
/** Windows drawn narrower have no edge zones. */
export const EDGES_MIN_PX = 16;
/** Grab area of the window body. */
export const MIN_GRAB_PX = 12;
/** Drawn window. */
export const MIN_WINDOW_PX = 2;
/** Drawn drive. */
export const MIN_DRIVE_PX = 4;
/** Drive hit width. */
export const DRIVE_HIT_PX = 8;
/** ns, timeseries-window "Minimum zoom span". */
export const MIN_SPAN = MIN_SPAN_NS;

export interface Track {
  start: bigint;
  width: bigint;
  n: number;
  px: number;
  /** The recording's first and last row (density): a window covering both spans the whole track (S7). */
  first: bigint;
  last: bigint;
}
export interface Rect {
  left: number;
  right: number;
}

/** start, width, n = counts.length, first and last from the density; px = the track's clientWidth. */
export function trackOf(d: Density, px: number): Track {
  return {
    start: BigInt(d.start),
    width: BigInt(d.width),
    n: d.counts.length,
    px,
    first: BigInt(d.first),
    last: BigInt(d.last),
  };
}

const pitchOf = (tr: Track) => (tr.px + GAP_PX) / tr.n;
const endOf = (tr: Track) => tr.start + BigInt(tr.n) * tr.width;
const clampPx = (tr: Track, x: number) => Math.min(Math.max(x, 0), tr.px);

/** pitch = (px + GAP_PX) / n; x = Number(t − start) / Number(width) × pitch (not clamped). Bar i covers [i·pitch, i·pitch + pitch − GAP_PX]. */
export function xOf(tr: Track, t: bigint): number {
  return (Number(t - tr.start) / Number(tr.width)) * pitchOf(tr);
}

/** Inverse of xOf with x clamped to [0, px]; rounded to whole ns. */
export function tOf(tr: Track, x: number): bigint {
  return tr.start + BigInt(Math.round((clampPx(tr, x) / pitchOf(tr)) * Number(tr.width)));
}

/** Largest power of ten in ns that is ≤ n × width / 1000, at least 1 ns. */
export function stripUnit(tr: Track): bigint {
  const limit = (BigInt(tr.n) * tr.width) / 1000n;
  let unit = 1n;
  while (unit * 10n <= limit) unit *= 10n;
  return unit;
}

/** Nearest multiple of unit (ties up). */
export function snap(t: bigint, unit: bigint): bigint {
  const rest = ((t % unit) + unit) % unit;
  return rest * 2n >= unit ? t - rest + unit : t - rest;
}

/** Widens r about its centre to at least min px, then shifts it inside [0, px]. */
function widen(tr: Track, r: Rect, min: number): Rect {
  let { left, right } = r;
  if (right - left < min) {
    const centre = (left + right) / 2;
    left = centre - min / 2;
    right = centre + min / 2;
  }
  if (left < 0) {
    right -= left;
    left = 0;
  }
  if (right > tr.px) {
    left -= right - tr.px;
    right = tr.px;
  }
  return { left, right };
}

/** drawn: [xOf(from), xOf(to)] clamped to [0, px], widened about its centre to MIN_WINDOW_PX and shifted inside [0, px];
 *  grab: drawn widened the same way to MIN_GRAB_PX. Undefined when the range does not meet [start, start + n·width). */
export function windowRects(tr: Track, range: Range): { drawn: Rect; grab: Rect } | undefined {
  if (range.to <= tr.start || range.from >= endOf(tr)) return undefined;
  const clamped = { left: clampPx(tr, xOf(tr, range.from)), right: clampPx(tr, xOf(tr, range.to)) };
  const drawn = widen(tr, clamped, MIN_WINDOW_PX);
  return { drawn, grab: widen(tr, drawn, MIN_GRAB_PX) };
}

/** Widens r about its centre to at least min px (no clamping). */
function widenAbout(r: Rect, min: number): Rect {
  if (r.right - r.left >= min) return r;
  const centre = (r.left + r.right) / 2;
  return { left: centre - min / 2, right: centre + min / 2 };
}

/** Per drive: drawn widened to MIN_DRIVE_PX, hit widened to DRIVE_HIT_PX, both about the drive's centre. */
export function driveRects(tr: Track, drives: readonly Drive[]): { drawn: Rect; hit: Rect }[] {
  return drives.map((d) => {
    const exact = { left: xOf(tr, BigInt(d.from)), right: xOf(tr, BigInt(d.to)) };
    return { drawn: widenAbout(exact, MIN_DRIVE_PX), hit: widenAbout(exact, DRIVE_HIT_PX) };
  });
}

/** undefined when t < start or t > start + n·width; else min(xOf(t), px). */
export function markerX(tr: Track, t: bigint): number | undefined {
  if (t < tr.start || t > endOf(tr)) return undefined;
  return Math.min(xOf(tr, t), tr.px);
}

export type Zone =
  | { kind: "pin"; index: number }
  | { kind: "drive"; index: number }
  | { kind: "edge"; side: "from" | "to" }
  | { kind: "body" }
  | { kind: "bars" };

/** Index of the rect whose x span holds x, nearest centre on overlap, the earlier on a tie; −1 when none. */
function nearestHit(rects: readonly Rect[], x: number): number {
  let index = -1;
  let best = Number.POSITIVE_INFINITY;
  rects.forEach((hit, i) => {
    const dist = Math.abs(x - (hit.left + hit.right) / 2);
    if (x >= hit.left && x <= hit.right && dist < best) {
      index = i;
      best = dist;
    }
  });
  return index;
}

/** x, y relative to the track's top left. range: the bar target's range; undefined without a target.
 *  pins: the hit rects of the event pins (add-events V3), checked first in the pin lane (y < PIN_LANE_PX). */
export function hitZone(
  tr: Track,
  x: number,
  y: number,
  range: Range | undefined,
  drives: readonly Drive[],
  pins: readonly Rect[] = [],
): Zone {
  if (y < PIN_LANE_PX) {
    const pin = nearestHit(pins, x);
    if (pin >= 0) return { kind: "pin", index: pin };
  }
  if (y >= BARS_PX) {
    const index = nearestHit(
      driveRects(tr, drives).map((r) => r.hit),
      x,
    );
    return index >= 0 ? { kind: "drive", index } : { kind: "bars" };
  }
  const rects = range && windowRects(tr, range);
  if (!range || !rects) return { kind: "bars" };
  const { drawn, grab } = rects;
  if (drawn.right - drawn.left >= EDGES_MIN_PX) {
    const dFrom = Math.abs(x - drawn.left);
    const dTo = Math.abs(x - drawn.right);
    if (dFrom <= EDGE_PX || dTo <= EDGE_PX) {
      return { kind: "edge", side: dFrom <= dTo ? "from" : "to" };
    }
  }
  // A full window brushes from its body (design S7): drawn to within EDGE_PX of the recorded data
  // at both ends (xOf first and last), so sub-pixel gaps between the loaded signals' extent and the
  // density's first/last row do not matter. A window starting in a later drive still pans.
  const full =
    drawn.left <= xOf(tr, tr.first) + EDGE_PX && drawn.right >= xOf(tr, tr.last) - EDGE_PX;
  if (!full && x >= grab.left && x <= grab.right) return { kind: "body" };
  return { kind: "bars" };
}

export type StripAction =
  | { kind: "jump"; x: number }
  | { kind: "fit"; drive: number }
  | { kind: "centre"; pin: number }
  | { kind: "whole" }
  | { kind: "brush"; x0: number; x1: number }
  | { kind: "pan"; dx: number }
  | { kind: "resize"; side: "from" | "to"; dx: number };

/** One pointer gesture on the track; the caller passes the zone of the press (S7) and event times in ms. */
export class StripGesture {
  private press: { x: number; y: number; zone: Zone } | undefined;
  private dragging = false;
  /** Release of the last single click, for the double-click (design S8). */
  private lastClick: { x: number; y: number; now: number } | undefined;

  down(x: number, y: number, zone: Zone, _now: number): void {
    this.press = { x, y, zone };
    this.dragging = false;
  }

  /** Once moved ≥ DRAG_THRESHOLD_PX (hypot) from the press: the preview (brush, pan or resize); before that undefined. */
  move(x: number, y: number): StripAction | undefined {
    const p = this.press;
    if (!p) return undefined;
    if (!this.dragging && Math.hypot(x - p.x, y - p.y) >= DRAG_THRESHOLD_PX) this.dragging = true;
    return this.dragging ? dragAction(p.zone, p.x, x) : undefined;
  }

  /** The action to commit, or undefined (no press, cancelled, or a brush with |x1 − x0| < DRAG_THRESHOLD_PX). */
  up(x: number, y: number, now: number): StripAction | undefined {
    const p = this.press;
    this.press = undefined;
    if (!p) return undefined;
    if (this.dragging || Math.hypot(x - p.x, y - p.y) >= DRAG_THRESHOLD_PX) {
      this.dragging = false;
      this.lastClick = undefined;
      const action = dragAction(p.zone, p.x, x);
      return action.kind === "brush" && Math.abs(action.x1 - action.x0) < DRAG_THRESHOLD_PX
        ? undefined
        : action;
    }
    const last = this.lastClick;
    if (
      last &&
      now - last.now <= DOUBLE_CLICK_MS &&
      Math.hypot(x - last.x, y - last.y) <= DRAG_THRESHOLD_PX
    ) {
      this.lastClick = undefined;
      return { kind: "whole" };
    }
    this.lastClick = { x, y, now };
    if (p.zone.kind === "pin") return { kind: "centre", pin: p.zone.index };
    return p.zone.kind === "drive" ? { kind: "fit", drive: p.zone.index } : { kind: "jump", x };
  }

  /** Escape or pointercancel: the running gesture yields nothing. */
  cancel(): void {
    this.press = undefined;
    this.dragging = false;
  }
}

/** Drag kind from the press zone: edge → resize, body → pan, bars, drive and pin → brush. */
function dragAction(zone: Zone, x0: number, x: number): StripAction {
  if (zone.kind === "edge") return { kind: "resize", side: zone.side, dx: x - x0 };
  if (zone.kind === "body") return { kind: "pan", dx: x - x0 };
  return { kind: "brush", x0, x1: x };
}

/** snap(tOf(x)) as centre, the view's span kept: from = c − span / 2, to = from + span. */
export function jumpRange(tr: Track, x: number, view: Range): Range {
  const centre = snap(tOf(tr, x), stripUnit(tr));
  const span = view.to - view.from;
  const from = centre - span / 2n;
  return { from, to: from + span };
}

/** from = t − span / 2, to = from + span (exact, no snapping; add-events V3). */
export function centreRange(view: Range, t: bigint): Range {
  const from = t - (view.to - view.from) / 2n;
  return { from, to: from + (view.to - view.from) };
}

/** [snap(tOf(min)), snap(tOf(max))); undefined when |x1 − x0| < DRAG_THRESHOLD_PX or the ends coincide. */
export function brushRange(tr: Track, x0: number, x1: number): Range | undefined {
  if (Math.abs(x1 - x0) < DRAG_THRESHOLD_PX) return undefined;
  const unit = stripUnit(tr);
  const from = snap(tOf(tr, Math.min(x0, x1)), unit);
  const to = snap(tOf(tr, Math.max(x0, x1)), unit);
  return from === to ? undefined : { from, to };
}

/** The dragged time: round(dx / pitch × width / unit) × unit. */
function dragTime(tr: Track, dx: number): bigint {
  const unit = stripUnit(tr);
  return BigInt(Math.round(((dx / pitchOf(tr)) * Number(tr.width)) / Number(unit))) * unit;
}

/** dt = round(dx / pitch × width / unit) × unit; view + dt with its centre clamped into [start, start + n·width]. */
export function panRange(tr: Track, view: Range, dx: number): Range {
  const dt = dragTime(tr, dx);
  const from = view.from + dt;
  const to = view.to + dt;
  const centre = from + (to - from) / 2n;
  const end = endOf(tr);
  const shift = centre < tr.start ? tr.start - centre : centre > end ? end - centre : 0n;
  return { from: from + shift, to: to + shift };
}

/** from' = min(max(from + dt, start), to − MIN_SPAN) or to' = max(min(to + dt, start + n·width), from + MIN_SPAN). */
export function resizeRange(tr: Track, view: Range, side: "from" | "to", dx: number): Range {
  const dt = dragTime(tr, dx);
  if (side === "from") {
    const from = view.from + dt;
    const lo = from > tr.start ? from : tr.start;
    const hi = view.to - MIN_SPAN;
    return { from: lo < hi ? lo : hi, to: view.to };
  }
  const to = view.to + dt;
  const end = endOf(tr);
  const hi = to < end ? to : end;
  const lo = view.from + MIN_SPAN;
  return { from: view.from, to: hi > lo ? hi : lo };
}

/** extentRange([{ first, last }]): first to just after last, rounded up to the next ms. */
export function wholeRange(d: Density): Range {
  return extentRange([{ first: d.first, last: d.last }]) as Range;
}

const centreOf = (r: Range) => r.from + (r.to - r.from) / 2n;

/** centre(r) = from + (to − from) / 2. dir 1: first drive (time order) with centre > centre(view); dir −1: last with centre < centre(view). */
export function stepDrive(drives: readonly Drive[], view: Range, dir: 1 | -1): Drive | undefined {
  const c = centreOf(view);
  const centre = (d: Drive) => centreOf({ from: BigInt(d.from), to: BigInt(d.to) });
  return dir === 1 ? drives.find((d) => centre(d) > c) : drives.findLast((d) => centre(d) < c);
}

/** "no rows", "1 row", else en-US thousands commas + " rows". */
export function rowsText(n: number): string {
  if (n === 0) return "no rows";
  if (n === 1) return "1 row";
  return `${n.toLocaleString("en-US")} rows`;
}

/** `${formatRange(start_i, start_i + width)} · ${rowsText(counts[i])}` (formatRange of time/axis.ts: local time as the header). */
export function barTitle(d: Density, i: number): string {
  const width = BigInt(d.width);
  const from = BigInt(d.start) + BigInt(i) * width;
  return `${formatRange(from, from + width)} · ${rowsText(d.counts[i] ?? 0)}`;
}

/** `Drive ${i + 1} of ${n} · ${formatRange(from, to)} · ${formatSpan(to − from)} · ${rowsText(rows)}`. */
export function driveTitle(d: Density, i: number): string {
  const drive = d.drives[i];
  if (!drive) return "";
  const from = BigInt(drive.from);
  const to = BigInt(drive.to);
  return `Drive ${i + 1} of ${d.drives.length} · ${formatRange(from, to)} · ${formatSpan(to - from)} · ${rowsText(drive.rows)}`;
}
