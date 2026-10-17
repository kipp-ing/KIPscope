import {
  CATEGORY_TEXT,
  type DiagEvent,
  EVENT_CATEGORIES,
  type EventCategory,
} from "@kipscope/shared";
import { formatDate, formatTime } from "../time/axis.ts";
import type { Rect } from "../time/stripGeometry.ts";
import { isRead } from "./list.ts";

// Event pins on the strip and glyphs over the plots (design V1, V2, V4 of add-events; D-058;
// hollow fault memory reads: P5 of improve-events).

/** Events less than this from a group's first event join it. */
export const GROUP_PX = 6;
/** Pin and glyph height. */
export const PIN_H = 6;
/** Drawn width of one event. */
export const PIN_W = 3;
/** Drawn width of several. */
export const PIN_W_MANY = 5;
/** Minimum hit width. */
export const PIN_HIT_PX = 8;
/** Strip: y < this is the pin lane for hits. */
export const PIN_LANE_PX = 8;

export interface Mark {
  x0: number;
  x1: number;
  events: DiagEvent[];
  /** The most severe category of the events (first of EVENT_CATEGORIES present). */
  category: EventCategory;
  /** Every event of the mark is a DTC (isRead): drawn hollow. */
  read: boolean;
  drawn: Rect;
  hit: Rect;
}

/** Widens r about its centre to at least min px (no clamping). */
function widenAbout(r: Rect, min: number): Rect {
  if (r.right - r.left >= min) return r;
  const centre = (r.left + r.right) / 2;
  return { left: centre - min / 2, right: centre + min / 2 };
}

/** xs sorted with the events in time order; events with x outside [0, px] dropped; pure. */
export function groupMarks(
  events: readonly DiagEvent[],
  xOf: (t: bigint) => number,
  px: number,
): Mark[] {
  const groups: { x0: number; x1: number; events: DiagEvent[] }[] = [];
  for (const e of events) {
    const x = xOf(BigInt(e.t));
    if (!(x >= 0 && x <= px)) continue;
    const last = groups.at(-1);
    if (last && x - last.x0 < GROUP_PX) {
      last.x1 = x;
      last.events.push(e);
    } else {
      groups.push({ x0: x, x1: x, events: [e] });
    }
  }
  return groups.map(({ x0, x1, events: es }) => {
    const centre = (x0 + x1) / 2;
    const read = es.every(isRead);
    const width = Math.max(es.length > 1 || read ? PIN_W_MANY : PIN_W, x1 - x0 + PIN_W);
    const drawn = { left: centre - width / 2, right: centre + width / 2 };
    const present = new Set(es.map((e) => e.category));
    const category = EVENT_CATEGORIES.find((c) => present.has(c)) ?? "other";
    return { x0, x1, events: es, category, read, drawn, hit: widenAbout(drawn, PIN_HIT_PX) };
  });
}

/** Hex values of the --ev-* tokens (styles.css), usable on canvas too (design V1). */
export const EVENT_COLORS = {
  fault: "#be123c",
  stored: "#b45309",
  change: "#7c3aed",
  info: "#64748b",
} as const;

/** active, pending → fault; stored; change; all others → info (design V1). */
export function markColor(c: EventCategory): string {
  if (c === "active" || c === "pending") return EVENT_COLORS.fault;
  if (c === "stored") return EVENT_COLORS.stored;
  if (c === "change") return EVENT_COLORS.change;
  return EVENT_COLORS.info;
}

/** Inline style of a pin or glyph: hollow in the category's colour for a read, else filled. */
export function markStyle(m: Mark): { background: string; boxShadow?: string } {
  const color = markColor(m.category);
  return m.read
    ? { background: "var(--panel)", boxShadow: `inset 0 0 0 1px ${color}` }
    : { background: color };
}

/** Tooltip line of a DTC: its time is the fault memory readout's. */
export const READ_LINE = "Fault memory read at this time; when a fault first occurred is unknown";

/** Local time to the ms, as the window header: `2026-10-01 07:00:00.000`. */
function stamp(t: string): string {
  const ns = BigInt(t);
  return `${formatDate(ns)} ${formatTime(ns, 3)}`;
}

/** The event's text; for a change `<from> → <to>`. */
function eventText(e: DiagEvent): string {
  return e.category === "change" && e.from ? `${e.from.text} → ${e.text}` : e.text;
}

/** Lines in a tooltip of several events. */
const TITLE_LINES = 8;
/** Text of one line in a tooltip of several, longer cut with "…". */
const TITLE_TEXT_CHARS = 60;

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The one-event tooltip (design V4), plus READ_LINE last for a DTC. */
export function eventTitle(e: DiagEvent): string {
  const lines = [`${stamp(e.t)} · ${CATEGORY_TEXT[e.category].label} · ${e.source} ${e.name}`];
  const text = eventText(e);
  if (text) lines.push(text);
  if (e.kind === "dtc" && e.status) lines.push(`Status ${e.status}`);
  if (e.category === "change" && e.inferred && e.from) {
    lines.push(`seen after a gap; last seen ${e.from.text} at ${stamp(e.from.t)}`);
  }
  if (isRead(e)) lines.push(READ_LINE);
  return lines.join("\n");
}

/** Tooltip of a pin or glyph (design V4; READ_LINE after line 1 when any event is a DTC). */
export function markTitle(m: Mark): string {
  const [first] = m.events;
  if (!first) return "";
  if (m.events.length === 1) return eventTitle(first);
  const counts = new Map<EventCategory, number>();
  for (const e of m.events) counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
  const parts = EVENT_CATEGORIES.flatMap((c) => {
    const n = counts.get(c);
    return n ? [`${n} ${n === 1 ? CATEGORY_TEXT[c].one : CATEGORY_TEXT[c].many}`] : [];
  });
  const lines = [`${m.events.length} events · ${parts.join(", ")}`];
  if (m.events.some(isRead)) lines.push(READ_LINE);
  for (const e of m.events.slice(0, TITLE_LINES)) {
    const text = eventText(e);
    const line = `${stamp(e.t)} ${CATEGORY_TEXT[e.category].label} ${e.name}`;
    lines.push(text ? `${line} ${cut(text, TITLE_TEXT_CHARS)}` : line);
  }
  const more = m.events.length - TITLE_LINES;
  if (more > 0) lines.push(`… and ${more} more`);
  return lines.join("\n");
}
