import {
  type CaseEntry,
  type Density,
  type Drive,
  floorDiv,
  type LoggerGap,
  MIN_SPAN_NS,
  NS_PER_MS,
} from "@kipscope/shared";
import { DOUBLE_CLICK_MS } from "../chart/cursors.ts";
import { DRAG_THRESHOLD_PX } from "../chart/drag.ts";
import { extentRange, type Range } from "../chart/zoom.ts";
import { PIN_LANE_PX } from "../events/marks.ts";
import { fullTime, startDuration } from "./rangeLine.ts";

// Pure geometry of the interactive strip (design S6–S10 of add-strip-navigation, D-057; one row
// with a presence line, flags and end labels: declutter-workspace DW10, DW19).

/** Strip height: track 27 px + 1 px border, in every state (DW10). */
export const STRIP_PX = 28;
/** End slack of the bucket pitch in px (the former bar gap): the track mapping keeps its numbers. */
export const GAP_PX = 2;
/** y ≥ this is the lower lane (day labels, flags): a press there hits a drive or the track, never
 *  the window (time-strip "Strip hit zones", "Zones": the drive row without drives is the track). */
export const LOWER_LANE_PX = 17;
/** An edge zone reaches 4 px to each side of a drawn edge. */
export const EDGE_PX = 4;
/** Windows drawn narrower have no edge zones. */
export const EDGES_MIN_PX = 16;
/** Grab area of the window body. */
export const MIN_GRAB_PX = 12;
/** Drawn window (D-095: was 2). */
export const MIN_WINDOW_PX = 3;
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
 *  grab: drawn widened the same way to MIN_GRAB_PX; caret: the clamped width is below MIN_WINDOW_PX (the window is
 *  drawn wider than the range). Undefined when the range does not meet [start, start + n·width). */
export function windowRects(
  tr: Track,
  range: Range,
): { drawn: Rect; grab: Rect; caret: boolean } | undefined {
  if (range.to <= tr.start || range.from >= endOf(tr)) return undefined;
  const clamped = { left: clampPx(tr, xOf(tr, range.from)), right: clampPx(tr, xOf(tr, range.to)) };
  const drawn = widen(tr, clamped, MIN_WINDOW_PX);
  return {
    drawn,
    grab: widen(tr, drawn, MIN_GRAB_PX),
    caret: clamped.right - clamped.left < MIN_WINDOW_PX,
  };
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

/** A catalog session of the scope's vehicle on the drive row (add-case-open K14). */
export interface CaseMark {
  /** 0-based catalog index. */
  index: number;
  drawn: Rect;
  hit: Rect;
  /** The session left with Unlink: drawn outlined. */
  left: boolean;
}

/**
 * The catalog entries on `dataRef` as marks in catalog order (K14): drawn widened to
 * MIN_DRIVE_PX (4 px), hit to DRIVE_HIT_PX (8 px), like drives.
 */
export function caseMarks(
  tr: Track,
  entries: readonly CaseEntry[],
  dataRef: string,
  current: number,
): CaseMark[] {
  const marks: CaseMark[] = [];
  entries.forEach((e, index) => {
    if (e.dataRef !== dataRef) return;
    const exact = { left: xOf(tr, BigInt(e.from)), right: xOf(tr, BigInt(e.to)) };
    marks.push({
      index,
      drawn: widenAbout(exact, MIN_DRIVE_PX),
      hit: widenAbout(exact, DRIVE_HIT_PX),
      left: index === current,
    });
  });
  return marks;
}

/** `Session <k> of <n> · <kind> · <start and duration> · <title>`; absent parts left out (K14, D-093). */
export function caseMarkTitle(entry: CaseEntry, index: number, count: number): string {
  const parts = [`Session ${index + 1} of ${count}`];
  if (entry.kind) parts.push(entry.kind);
  parts.push(startDuration(BigInt(entry.from), BigInt(entry.to)).text);
  if (entry.title) parts.push(entry.title);
  return parts.join(" · ");
}

/** undefined when t < start or t > start + n·width; else min(xOf(t), px). */
export function markerX(tr: Track, t: bigint): number | undefined {
  if (t < tr.start || t > endOf(tr)) return undefined;
  return Math.min(xOf(tr, t), tr.px);
}

export type Zone =
  | { kind: "pin"; index: number }
  | { kind: "session"; index: number }
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
 *  pins: the hit rects of the event pins (DW20), checked first in the pin lane (y < PIN_LANE_PX); where
 *  two hold x, the nearer centre. sessions: the hit rects of the catalog marks (add-case-open K14),
 *  checked before the drives below the pin lane; the zone's index is the mark's position in that list.
 *  Then the window's edges and body above LOWER_LANE_PX, else the track (`bars`). */
export function hitZone(
  tr: Track,
  x: number,
  y: number,
  range: Range | undefined,
  drives: readonly Drive[],
  pins: readonly Rect[] = [],
  sessions: readonly Rect[] = [],
): Zone {
  if (y < PIN_LANE_PX) {
    const pin = nearestHit(pins, x);
    if (pin >= 0) return { kind: "pin", index: pin };
  }
  if (y >= PIN_LANE_PX) {
    const session = nearestHit(sessions, x);
    if (session >= 0) return { kind: "session", index: session };
    const index = nearestHit(
      driveRects(tr, drives).map((r) => r.hit),
      x,
    );
    if (index >= 0) return { kind: "drive", index };
    if (y >= LOWER_LANE_PX) return { kind: "bars" };
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
  | { kind: "session"; mark: number }
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
    if (p.zone.kind === "session") return { kind: "session", mark: p.zone.index };
    return p.zone.kind === "drive" ? { kind: "fit", drive: p.zone.index } : { kind: "jump", x };
  }

  /** Escape or pointercancel: the running gesture yields nothing. */
  cancel(): void {
    this.press = undefined;
    this.dragging = false;
  }
}

/** Drag kind from the press zone: edge → resize, body → pan, bars, drive, session and pin → brush. */
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
  // A density of a scope spans exactly the scope (add-scope Z9).
  if (d.scope) return { from: BigInt(d.scope.from), to: BigInt(d.scope.to) };
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

/** `Drive ${i + 1} of ${n} · ${startDuration(from, to).text} · ${rowsText(rows)}` (D-093, D-095). */
export function driveTitle(d: Density, i: number): string {
  const drive = d.drives[i];
  if (!drive) return "";
  const range = startDuration(BigInt(drive.from), BigInt(drive.to)).text;
  return `Drive ${i + 1} of ${d.drives.length} · ${range} · ${rowsText(drive.rows)}`;
}

// Presence line, flags, end labels, day labels and hover time (declutter-workspace DW19, D-094, D-095).

/** A break of the presence line is drawn at least this wide. */
export const BREAK_MIN_PX = 3;
export interface PresenceRun {
  left: number;
  right: number;
  /** Inside the shown range's drawn window: drawn in the accent. */
  shown: boolean;
}
export interface PresenceBreak {
  left: number;
  right: number;
  title: string;
}

interface Span {
  from: bigint;
  to: bigint;
}

/** A break before drawing: its px rect, the time span it covers and how many gaps it merges. */
interface Hole extends Rect, Span {
  n: number;
}

/** Data intervals: maximal runs of buckets with count > 0, clipped to [first, last]; breaks: the empty-bucket
 *  runs between them and every logger gap inside [first, last], each widened about its centre to ≥ BREAK_MIN_PX,
 *  overlapping breaks merged; title "No data · <startDuration text>" (one) or "No data · <n> gaps · <startDuration
 *  from the first's from to the last's to>". Runs: data intervals in px minus the drawn breaks, split at the
 *  shown range's drawn edges (`shown` inside). */
export function presence(
  tr: Track,
  d: Density,
  logger: readonly LoggerGap[] | undefined,
  range: Range | undefined,
): { runs: PresenceRun[]; breaks: PresenceBreak[] } {
  const start = BigInt(d.start);
  const width = BigInt(d.width);
  const first = BigInt(d.first);
  const last = BigInt(d.last);
  const data: Span[] = [];
  d.counts.forEach((count, i) => {
    if (count <= 0) return;
    const from = start + BigInt(i) * width;
    const to = from + width;
    const prev = data.at(-1);
    if (prev && prev.to === from) prev.to = to;
    else data.push({ from, to });
  });
  const clipped = data.flatMap(({ from, to }) => {
    const f = from > first ? from : first;
    const t = to < last ? to : last;
    return f < t ? [{ from: f, to: t }] : [];
  });
  const spans: Span[] = [];
  for (let i = 1; i < clipped.length; i++) {
    spans.push({ from: (clipped[i - 1] as Span).to, to: (clipped[i] as Span).from });
  }
  for (const g of logger ?? []) {
    const from = g.from > first ? g.from : first;
    const to = g.to < last ? g.to : last;
    if (from < to) spans.push({ from, to });
  }
  const holes: Hole[] = spans
    .map((s) => {
      const r = widenAbout({ left: xOf(tr, s.from), right: xOf(tr, s.to) }, BREAK_MIN_PX);
      return { ...r, ...s, n: 1 };
    })
    .sort((a, b) => a.left - b.left);
  const merged: Hole[] = [];
  for (const h of holes) {
    const prev = merged.at(-1);
    if (prev && h.left <= prev.right) {
      prev.right = Math.max(prev.right, h.right);
      if (h.from < prev.from) prev.from = h.from;
      if (h.to > prev.to) prev.to = h.to;
      prev.n += h.n;
    } else merged.push({ ...h });
  }
  const breaks = merged.map((h) => {
    const text = startDuration(h.from, h.to).text;
    return {
      left: h.left,
      right: h.right,
      title: h.n === 1 ? `No data · ${text}` : `No data · ${h.n} gaps · ${text}`,
    };
  });
  const win = range && windowRects(tr, range)?.drawn;
  const runs: PresenceRun[] = [];
  const push = (left: number, right: number) => {
    if (right <= left) return;
    if (!win) {
      runs.push({ left, right, shown: false });
      return;
    }
    const cuts = [left, ...[win.left, win.right].filter((x) => x > left && x < right), right];
    for (let i = 1; i < cuts.length; i++) {
      const l = cuts[i - 1] as number;
      const r = cuts[i] as number;
      runs.push({ left: l, right: r, shown: l >= win.left && r <= win.right });
    }
  };
  for (const s of clipped) {
    let left = xOf(tr, s.from);
    const right = xOf(tr, s.to);
    for (const b of breaks) {
      if (b.right <= left || b.left >= right) continue;
      push(left, Math.min(b.left, right));
      left = Math.max(left, b.right);
    }
    push(left, right);
  }
  return { runs, breaks };
}

// Cursor flags (D-095: 14 × 12 face, 24 × 24 hit from y 11, A·B under 18 px, edge flags with a caret).
export const FLAG_FACE_W = 14;
export const FLAG_FACE_H = 12;
export const FLAG_HIT = 24;
export const FLAG_HIT_TOP = 11;
export const FLAG_AB_FACE_W = 26;
export const FLAG_AB_HIT_W = 32;
export const FLAG_EDGE_AB_HIT_W = 36;
export const FLAG_MERGE_PX = 18;

export interface StripFlag {
  name: "A" | "B" | "AB";
  /** Face centre x in track px. Inside: the line's x (AB: the lines' midpoint). Edge: 14 / px − 14 (AB 20 / px − 20). */
  x: number;
  /** Hit rect in track px: inside centred on x, FLAG_HIT (AB FLAG_AB_HIT_W) wide; edge from the edge, 24 (AB 36) wide. */
  hit: Rect;
  /** The cursor lies before the track's start or after its end: no line, a caret beside the face. */
  edge?: "before" | "after";
}

/** A flag inside the track, centred on x. */
function insideFlag(name: StripFlag["name"], x: number): StripFlag {
  const w = name === "AB" ? FLAG_AB_HIT_W : FLAG_HIT;
  return { name, x, hit: { left: x - w / 2, right: x + w / 2 } };
}

/** A flag at the track's edge: the hit rect from the edge, the face centre half the face plus 7 px in. */
function edgeFlag(tr: Track, name: StripFlag["name"], edge: "before" | "after"): StripFlag {
  const w = name === "AB" ? FLAG_EDGE_AB_HIT_W : FLAG_HIT;
  const inset = name === "AB" ? 20 : 14;
  return edge === "before"
    ? { name, x: inset, hit: { left: 0, right: w }, edge }
    : { name, x: tr.px - inset, hit: { left: tr.px - w, right: tr.px }, edge };
}

/** Lines (markerX of the cursors inside the track) and flags: two inside cursors less than FLAG_MERGE_PX apart,
 *  or two on the same edge, give one "AB" flag. */
export function stripFlags(
  tr: Track,
  a: bigint | undefined,
  b: bigint | undefined,
): { lines: { name: "A" | "B"; x: number }[]; flags: StripFlag[] } {
  type Where = { x: number } | { edge: "before" | "after" } | undefined;
  const where = (t: bigint | undefined): Where => {
    if (t === undefined) return undefined;
    const x = markerX(tr, t);
    if (x !== undefined) return { x };
    return { edge: t < tr.start ? "before" : "after" };
  };
  const wa = where(a);
  const wb = where(b);
  const lines: { name: "A" | "B"; x: number }[] = [];
  if (wa && "x" in wa) lines.push({ name: "A", x: wa.x });
  if (wb && "x" in wb) lines.push({ name: "B", x: wb.x });
  if (wa && wb && "x" in wa && "x" in wb && Math.abs(wb.x - wa.x) < FLAG_MERGE_PX) {
    return { lines, flags: [insideFlag("AB", (wa.x + wb.x) / 2)] };
  }
  if (wa && wb && "edge" in wa && "edge" in wb && wa.edge === wb.edge) {
    return { lines, flags: [edgeFlag(tr, "AB", wa.edge)] };
  }
  const flags: StripFlag[] = [];
  const one = (name: "A" | "B", w: Where) => {
    if (!w) return;
    flags.push("x" in w ? insideFlag(name, w.x) : edgeFlag(tr, name, w.edge));
  };
  one("A", wa);
  one("B", wb);
  return { lines, flags };
}

/** Range of an "AB" click: centred on (a + b) / 2, span max(view span, 2·|b − a|). */
export function bothRange(view: Range, a: bigint, b: bigint): Range {
  const distance = b > a ? b - a : a - b;
  const viewSpan = view.to - view.from;
  const span = viewSpan > 2n * distance ? viewSpan : 2n * distance;
  return centreRange({ from: 0n, to: span }, a + (b - a) / 2n);
}

/** Width of each end-label slot (DW10). */
export const END_SLOT_PX = 48;
const DAY_NS = 86_400_000_000_000n;
const pad2 = (n: number) => String(n).padStart(2, "0");
const localOf = (t: bigint) => new Date(Number(floorDiv(t, NS_PER_MS)));
const hhmm = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const mmdd = (d: Date) => `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** Left and right end label of the strip span [from, to]: "HH:MM" when to − from < 24 h, else "MM-DD", cut, local;
 *  title fullTime(t, true). from/to: the scope's bounds, else density first/last. */
export function endLabels(
  from: bigint,
  to: bigint,
): { left: { text: string; title: string }; right: { text: string; title: string } } {
  const text = to - from < DAY_NS ? hhmm : mmdd;
  const label = (t: bigint) => ({ text: text(localOf(t)), title: fullTime(t, true) });
  return { left: label(from), right: label(to) };
}

export const DAY_LABEL_GAP_PX = 32;
export const DAY_LABEL_END_PX = 24;

/** Local midnights m with from < m < to, x = xOf(tr, m), text "MM-DD" of the day starting at m; a label is kept when
 *  x − (previous kept x) ≥ DAY_LABEL_GAP_PX and x ≤ tr.px − DAY_LABEL_END_PX. */
export function dayTicks(tr: Track, from: bigint, to: bigint): { x: number; text: string }[] {
  const ticks: { x: number; text: string }[] = [];
  const d = localOf(from);
  let day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  for (;;) {
    const m = BigInt(day.getTime()) * NS_PER_MS;
    if (m >= to) break;
    const x = xOf(tr, m);
    if (x > tr.px - DAY_LABEL_END_PX) break;
    const prev = ticks.at(-1);
    if (m > from && (!prev || x - prev.x >= DAY_LABEL_GAP_PX)) ticks.push({ x, text: mmdd(day) });
    day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  }
  return ticks;
}

/** Pointer time below the strip: "HH:MM:SS" (cut) when spanNs < 24 h, else "MM-DD HH:MM". */
export function hoverText(t: bigint, spanNs: bigint): string {
  const d = localOf(t);
  return spanNs < DAY_NS ? `${hhmm(d)}:${pad2(d.getSeconds())}` : `${mmdd(d)} ${hhmm(d)}`;
}
