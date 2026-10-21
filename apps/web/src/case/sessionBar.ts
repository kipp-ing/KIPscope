import {
  CASE_LIST_ROWS,
  type CaseAlign,
  type CaseCatalog,
  type CaseEntry,
  type CaseOpenReport,
  type CommandInput,
  type CommandResult,
  type DiagEvent,
  eventMatchOf,
  floorDiv,
  NS_PER_MS,
  type WorkspaceCase,
  type WorkspaceScope,
} from "@kipscope/shared";
import { formatDate, formatFull, formatTime } from "../time/axis.ts";
import { caseNotice, endedEvents } from "../time/scope.ts";
import { formatSpan } from "../time/strip.ts";
import type { StripEvent } from "../views/notice.ts";

/** Meta entries a catalog list row shows (design K14). */
const ROW_META = 2;
/** Names a `missing` message lists before `, …`. */
const MISSING_NAMES = 3;

/** Messages after a case command result (design K14). */
export const CASE_MESSAGES = {
  clampedLinked: "Stopped at the session edge. Unlink shows the whole vehicle.",
  clampedObject: "Stopped at the end of the vehicle's data.",
  noAnchor: "No anchor in this session; aligned to its start.",
  noEvent: (name: string) => `No ${name} in this session; aligned to its start.`,
} as const;

/** Tooltips of the session bar (design K14). */
export const CASE_HINTS = {
  linkFirst: "Link first",
  previous: (name: string, from: string) => `Previous: ${name} · ${from} ([)`,
  next: (name: string, from: string) => `Next: ${name} · ${from} (])`,
  first: "First session of the catalog",
  last: "Last session of the catalog",
  unlink: "Unlink: show the whole vehicle; the arrows wait until Link",
  link: "Link: back to the session left, at the same offsets",
  list: "All sessions of the catalog",
  align: "What stays in place when you step to another session",
  noAnchor: "No session in this catalog has an anchor",
  dismissNote: "Dismiss",
} as const;

/** Local "YYYY-MM-DD HH:MM" of `t` (decimal ns). */
export const localMinute = (t: string | bigint): string => {
  const ns = BigInt(t);
  return `${formatDate(ns)} ${formatTime(ns, 0, false)}`;
};

/** A meta value as the bar shows it: numbers with 3 significant digits (K14). */
export function metaValueText(v: string | number | boolean | null): string {
  if (v === null) return "–";
  if (typeof v !== "number") return String(v);
  if (!Number.isFinite(v)) return String(v);
  const r = Number(v.toPrecision(3));
  const m = Math.abs(r);
  return m !== 0 && (m < 0.001 || m >= 1e6) ? r.toExponential(2) : String(r);
}

const metaText = (entry: CaseEntry, n: number): string[] =>
  Object.entries(entry.meta ?? {})
    .slice(0, n)
    .map(([k, v]) => `${k} ${metaValueText(v)}`);

/** The session's name: its title, else its object. */
export const entryName = (entry: CaseEntry): string => entry.title ?? entry.object;

/** `<k> / <n>`, 1-based (K15). */
export const positionText = (c: Pick<WorkspaceCase, "current" | "count">): string =>
  `${c.current + 1} / ${c.count}`;

// Session slots (design DW4, DW5): what each fixed slot of the context row shows.

/** The slots of the session bar; a slot whose text is undefined shows a skeleton (DW5). */
export interface SessionSlots {
  label: "SESSION" | "VEHICLE";
  /** `<k> / <n>`; `positionCh` = length of `<n> / <n>` (constant per catalog). */
  position: string;
  positionCh: number;
  /** undefined → skeleton. */
  title: string | undefined;
  titleTooltip: string | undefined;
  /** "Tue" */
  weekday: string | undefined;
  /** "2026-10-13  15:06:54 – 15:17:42" or "2026-10-11 – Wed 2026-10-21" */
  times: string | undefined;
  /** Full local from – to. */
  timesTooltip: string | undefined;
  plusOne: boolean;
  /** formatSpan of the span. */
  duration: string | undefined;
  action: "Unlink" | "Link";
  /** The slots show the target of a step or go on its way (DW4). */
  pending: boolean;
}

/** Width of `<k> / <n>` in ch for every k of a catalog of `count` (tabular numbers): `<n> / <n>`. */
export const positionCh = (count: number): number => `${count} / ${count}`.length;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MS_PER_DAY = 86_400_000;

/** The local calendar day of `t` as a day count, and its English weekday abbreviation. */
function localDay(t: bigint): { day: number; weekday: string } {
  const d = new Date(Number(floorDiv(t, NS_PER_MS)));
  return {
    day: Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / MS_PER_DAY,
    weekday: WEEKDAYS[d.getDay()] ?? "",
  };
}

/**
 * The times slot of any range (also the scope row's, DW5): `<date>  <from> – <to>` on one local
 * day, the same with `plusOne` when `to` is on the next local day (a `to` at midnight is that
 * day's, `to` exclusive or not), `<date> – <weekday> <date>` from 2 days; the weekday of `from`
 * apart, the full local times as tooltip.
 */
export function timesSlot(
  from: bigint,
  to: bigint,
): Pick<SessionSlots, "weekday" | "times" | "timesTooltip" | "plusOne"> {
  const start = localDay(from);
  const end = localDay(to);
  const days = end.day - start.day;
  const timesTooltip = `${formatFull(from)} – ${formatFull(to)}`;
  if (days >= 2) {
    const times = `${formatDate(from)} – ${end.weekday} ${formatDate(to)}`;
    return { weekday: start.weekday, times, timesTooltip, plusOne: false };
  }
  const times = `${formatDate(from)}  ${formatTime(from, 0)} – ${formatTime(to, 0)}`;
  return { weekday: start.weekday, times, timesTooltip, plusOne: days === 1 };
}

/** The index a case command will reach: go → its index; step → (pending ?? current) + by inside
 *  [0, count); anything else, unlinked, or outside the catalog → undefined (DW4). */
export function pendingTarget(
  c: Pick<WorkspaceCase, "current" | "count" | "linked">,
  pending: number | undefined,
  input: CommandInput,
): number | undefined {
  if (!c.linked) return undefined;
  const index =
    input.type === "case.go"
      ? input.index
      : input.type === "case.step"
        ? (pending ?? c.current) + input.by
        : undefined;
  return index !== undefined && index >= 0 && index < c.count ? index : undefined;
}

/** The title's tooltip: `head`, then every meta entry, the id and the origin tool, one per line. */
const titleTooltip = (entry: CaseEntry, head: string, tool: string | undefined): string =>
  [
    head,
    ...Object.entries(entry.meta ?? {}).map(([k, v]) => `${k}: ${metaValueText(v)}`),
    `id: ${entry.id}`,
    ...(tool ? [`from ${tool}`] : []),
  ].join("\n");

type Content = Omit<SessionSlots, "position" | "positionCh" | "pending">;

/** A session's slots: its title or object, `<name> · <kind>` heading the tooltip, its times. */
function sessionContent(entry: CaseEntry, tool: string | undefined): Content {
  const from = BigInt(entry.from);
  const to = BigInt(entry.to);
  const name = entryName(entry);
  const head = entry.kind ? `${name} · ${entry.kind}` : name;
  return {
    label: "SESSION",
    title: name,
    titleTooltip: titleTooltip(entry, head, tool),
    ...timesSlot(from, to),
    duration: formatSpan(to - from),
    action: "Unlink",
  };
}

/** A slot set whose texts are not known yet: skeletons. */
const SKELETON: Omit<Content, "label" | "action"> = {
  title: undefined,
  titleTooltip: undefined,
  weekday: undefined,
  times: undefined,
  timesTooltip: undefined,
  plusOne: false,
  duration: undefined,
};

/**
 * The session bar's slots (case-navigation "Session bar", DW5). Linked: the entry's title or
 * object, its local times and duration, `Unlink`; unlinked: `<object> · whole series` (the vehicle,
 * never the dropped session's title) with the scope's times and span, `Link`. With `pending` (a
 * step or go on its way, DW4) the target's slots from the loaded catalog, skeletons where it is not
 * loaded; without a case (an opening `/open#cases=` page) every text slot a skeleton.
 */
export function sessionSlots(
  c: WorkspaceCase | undefined,
  scope?: WorkspaceScope,
  catalog?: CaseCatalog,
  pending?: number,
): SessionSlots {
  if (!c) {
    const position = { position: "", positionCh: positionCh(0), pending: false };
    return { label: "SESSION", ...SKELETON, action: "Unlink", ...position };
  }
  const tool = catalog?.origin?.tool;
  const position = {
    position: positionText({ current: pending ?? c.current, count: c.count }),
    positionCh: positionCh(c.count),
  };
  if (pending !== undefined) {
    const entry = pending === c.current ? c.entry : catalog?.entries[pending];
    const content: Content = entry
      ? sessionContent(entry, tool)
      : { label: "SESSION", ...SKELETON, action: "Unlink" };
    return { ...content, ...position, pending: true };
  }
  if (c.linked) return { ...sessionContent(c.entry, tool), ...position, pending: false };
  const e = c.entry;
  const from = BigInt(scope?.from ?? e.from);
  const to = BigInt(scope?.to ?? e.to);
  const title = `${e.object} · whole series`;
  return {
    label: "VEHICLE",
    title,
    titleTooltip: titleTooltip(e, title, tool),
    ...timesSlot(from, to),
    duration: formatSpan(to - from),
    action: "Link",
    ...position,
    pending: false,
  };
}

/** Tooltip of `‹` or `›` (K14): the neighbour, or why the arrow is disabled. */
export function arrowHint(c: WorkspaceCase, by: -1 | 1, catalog: CaseCatalog | undefined): string {
  if (!c.linked) return CASE_HINTS.linkFirst;
  const index = c.current + by;
  if (index < 0) return CASE_HINTS.first;
  if (index >= c.count) return CASE_HINTS.last;
  const entry = catalog?.entries[index];
  if (!entry) return by < 0 ? "Previous session ([)" : "Next session (])";
  const hint = by < 0 ? CASE_HINTS.previous : CASE_HINTS.next;
  return hint(entryName(entry), localMinute(entry.from));
}

/** The step `‹` (-1) or `›` (1) sends, or undefined: unlinked, or at that end (K14). */
export function stepCommand(c: WorkspaceCase | undefined, by: -1 | 1): CommandInput | undefined {
  if (!c?.linked) return undefined;
  const index = c.current + by;
  if (index < 0 || index >= c.count) return undefined;
  return { type: "case.step", by };
}

/** "Align sessions to this event" (K7): the event's match, `at` its time. For 3.3 and 3.4. */
export function alignToEvent(event: DiagEvent): CommandInput {
  return { type: "case.align", align: { mode: "event", event: eventMatchOf(event) }, at: event.t };
}

// Catalog list (K14).

export interface CatalogRow {
  /** 0-based catalog index. */
  index: number;
  text: string;
  current: boolean;
}

/** `<k> · <kind> · <title or object> · <local from> · <duration> · <first 2 meta>`. */
export function catalogRowText(entry: CaseEntry, index: number): string {
  const span = BigInt(entry.to) - BigInt(entry.from);
  return [
    String(index + 1),
    ...(entry.kind ? [entry.kind] : []),
    entryName(entry),
    localMinute(entry.from),
    formatSpan(span),
    ...metaText(entry, ROW_META),
  ].join(" · ");
}

/** Whether `filter` (lower case) is a substring of title, object, kind, id, local start or a meta value. */
function matches(entry: CaseEntry, filter: string): boolean {
  const fields = [
    entry.title ?? "",
    entry.object,
    entry.kind ?? "",
    entry.id,
    localMinute(entry.from),
    formatFull(BigInt(entry.from)),
    ...Object.values(entry.meta ?? {}).map(metaValueText),
  ];
  return fields.some((f) => f.toLowerCase().includes(filter));
}

/**
 * The catalog list's rows for `filter` (case-insensitive, K14): at most `limit` rows in catalog
 * order, and how many more matched (`… <m> more: type to filter`).
 */
export function catalogRows(
  entries: readonly CaseEntry[],
  filter: string,
  current: number,
  limit = CASE_LIST_ROWS,
): { rows: CatalogRow[]; more: number } {
  const f = filter.trim().toLowerCase();
  const rows: CatalogRow[] = [];
  let more = 0;
  entries.forEach((entry, index) => {
    if (f !== "" && !matches(entry, f)) return;
    if (rows.length >= limit) {
      more++;
      return;
    }
    rows.push({ index, text: catalogRowText(entry, index), current: index === current });
  });
  return { rows, more };
}

/** The line after the shown rows, or undefined when every match is shown. */
export const moreText = (more: number): string | undefined =>
  more > 0 ? `… ${more} more: type to filter` : undefined;

/** What Enter in the filter sends: `case.go` to the first match, or nothing (K14). */
export function goFirstMatch(rows: readonly CatalogRow[]): CommandInput | undefined {
  const first = rows[0];
  return first && { type: "case.go", index: first.index };
}

// Align group of the catalog list (K14, DW6).

export interface AlignItem {
  label: string;
  align: CaseAlign;
  checked: boolean;
  disabled?: true;
  title?: string;
}

/** `Session start`, `Session end`, `Anchor from the finder` and, in event mode, the event. */
export function alignItems(
  align: CaseAlign,
  entries: readonly CaseEntry[] | undefined,
): AlignItem[] {
  const anyAnchor = entries === undefined || entries.some((e) => e.anchor !== undefined);
  const items: AlignItem[] = [
    { label: "Session start", align: { mode: "start" }, checked: align.mode === "start" },
    { label: "Session end", align: { mode: "end" }, checked: align.mode === "end" },
    {
      label: "Anchor from the finder",
      align: { mode: "anchor" },
      checked: align.mode === "anchor",
      ...(anyAnchor ? {} : { disabled: true as const, title: CASE_HINTS.noAnchor }),
    },
  ];
  if (align.mode === "event") items.push({ label: alignEventText(align), align, checked: true });
  return items;
}

/** ` → <state>` of a change match (its text, the state changed to), else "". */
const changeText = (event: Extract<CaseAlign, { mode: "event" }>["event"]): string =>
  event.text !== undefined && event.text !== "" ? ` → ${event.text}` : "";

const alignEventText = (align: Extract<CaseAlign, { mode: "event" }>): string =>
  `Event: ${align.event.source} ${align.event.name}${changeText(align.event)}`;

// Messages (K14).

/** Shown name of a signal ID without info: the part of its name after the last ".". */
function fallbackName(id: string): string {
  const name = id.slice(id.indexOf("/") + 1);
  return name.slice(name.lastIndexOf(".") + 1);
}

/** `<n> signal(s) not in this session: <first 3 shown names>[, …]`. */
export function missingText(
  missing: readonly string[],
  nameOf: (signalId: string) => string | undefined = () => undefined,
): string {
  const names = missing
    .slice(0, MISSING_NAMES)
    .map((id) => nameOf(id) ?? fallbackName(id))
    .join(", ");
  const more = missing.length > MISSING_NAMES ? ", …" : "";
  return `${missing.length} signal${missing.length === 1 ? "" : "s"} not in this session: ${names}${more}`;
}

/** The clamp message while a catalog is open: at the session edge, or in an object scope. */
export const caseClampMessage = (c: Pick<WorkspaceCase, "linked">): string =>
  c.linked ? CASE_MESSAGES.clampedLinked : CASE_MESSAGES.clampedObject;

/**
 * What a case command's result does to the message line (K14): a refusal shows its code and
 * message; an accepted one shows its clamp, fallback and missing parts joined by " · " (the case
 * after the command decides the texts), else ends an older error, scope-edge message and every
 * case notice, combined texts included (`endedEvents`).
 */
export function caseResultEvents(
  result: CommandResult,
  after: WorkspaceCase | undefined,
  nameOf?: (signalId: string) => string | undefined,
): StripEvent[] {
  if (!result.ok) return [{ kind: "error", text: `${result.code}: ${result.message}` }];
  const parts = caseTexts(result, after, nameOf);
  if (parts.length > 0) return [caseNotice(parts.join(" · "))];
  return endedEvents();
}

/** The clamp, fallback and missing texts of an accepted case result, in that order. */
function caseTexts(
  result: Pick<Extract<CommandResult, { ok: true }>, "clamped" | "alignFallback" | "missing">,
  after: WorkspaceCase | undefined,
  nameOf?: (signalId: string) => string | undefined,
): string[] {
  const parts: string[] = [];
  if (result.clamped) parts.push(caseClampMessage(after ?? { linked: true }));
  if (result.alignFallback) {
    const align = after?.align;
    parts.push(
      align?.mode === "event" ? CASE_MESSAGES.noEvent(align.event.name) : CASE_MESSAGES.noAnchor,
    );
  }
  if (result.missing && result.missing.length > 0) parts.push(missingText(result.missing, nameOf));
  return parts;
}

/** The open's one notice text (case-handoff "Open warnings shown", design X4a): alignment fallback
 *  and missing signals as caseResultEvents words them, then the report's warnings, joined by " · ";
 *  undefined when empty. The session bar shows it as its note. */
export function openNoteText(
  report: CaseOpenReport,
  after: WorkspaceCase,
  nameOf?: (signalId: string) => string | undefined,
): string | undefined {
  const parts = [
    ...caseTexts(
      { missing: report.missing, ...(report.alignFallback ? { alignFallback: true } : {}) },
      after,
      nameOf,
    ),
    ...report.warnings,
  ];
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** The open's one notice in the message line (X4): openNoteText as a case notice; [] when empty. */
export function caseOpenEvents(
  report: CaseOpenReport,
  after: WorkspaceCase,
  nameOf?: (signalId: string) => string | undefined,
): StripEvent[] {
  const text = openNoteText(report, after, nameOf);
  return text === undefined ? [] : [caseNotice(text)];
}

/** Whether a command result ends the session bar's open note (X4a): only an accepted `case.go`,
 *  `case.step` or `case.unlink` leaves the opened session; window commands, `case.align` and
 *  refusals keep it. */
export const endsOpenNote = (input: CommandInput, result: CommandResult): boolean =>
  result.ok &&
  (input.type === "case.go" || input.type === "case.step" || input.type === "case.unlink");
