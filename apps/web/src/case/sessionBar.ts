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
  NS_PER_MS,
  type WorkspaceCase,
  type WorkspaceScope,
} from "@kipscope/shared";
import { formatDate, formatFull, formatTime } from "../time/axis.ts";
import { caseNotice, endedEvents } from "../time/scope.ts";
import { formatSpan } from "../time/strip.ts";
import type { StripEvent } from "../views/notice.ts";

/** Meta entries the bar text shows; the list rows show 2 (design K14). */
const BAR_META = 3;
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

/** "<from> – <to>" in local minutes; `to` without its date when on the same local day. */
function localSpan(from: bigint, to: bigint, sameDayShort: boolean): string {
  // A half-open end at midnight belongs to the day before.
  const last = to - NS_PER_MS > from ? to - NS_PER_MS : to;
  const end =
    sameDayShort && formatDate(from) === formatDate(last)
      ? formatTime(to, 0, false)
      : localMinute(to);
  return `${localMinute(from)} – ${end}`;
}

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

export interface SessionBarText {
  /** "SESSION" while linked, "VEHICLE" while unlinked. */
  label: "SESSION" | "VEHICLE";
  text: string;
  position: string;
  /** Every meta entry, the id and the origin tool. */
  tooltip: string;
}

/**
 * The session bar's text (design K14). Linked: `<title or object> · <kind> · <local from> – <local
 * to> (<duration>) · <up to 3 meta>`; unlinked: `<object> · whole series · <scope from> – <scope
 * to> (<span>)`, the vehicle, never the dropped session's title.
 */
export function sessionBarText(
  c: WorkspaceCase,
  scope?: WorkspaceScope,
  origin?: CaseCatalog["origin"],
): SessionBarText {
  const e = c.entry;
  const tooltip = [
    ...Object.entries(e.meta ?? {}).map(([k, v]) => `${k}: ${metaValueText(v)}`),
    `id: ${e.id}`,
    ...(origin?.tool ? [`from ${origin.tool}`] : []),
  ].join("\n");
  const position = positionText(c);
  if (!c.linked) {
    const from = BigInt(scope?.from ?? e.from);
    const to = BigInt(scope?.to ?? e.to);
    const text = `${e.object} · whole series · ${localSpan(from, to, false)} (${formatSpan(to - from)})`;
    return { label: "VEHICLE", text, position, tooltip };
  }
  const from = BigInt(e.from);
  const to = BigInt(e.to);
  const parts = [
    entryName(e),
    ...(e.kind ? [e.kind] : []),
    `${localSpan(from, to, true)} (${formatSpan(to - from)})`,
    ...metaText(e, BAR_META),
  ];
  return { label: "SESSION", text: parts.join(" · "), position, tooltip };
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

// Align menu (K14).

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

/**
 * The Align button's mode text: `start`, `end`, `anchor`, or the event's name with the state a
 * change goes to (`CPC_168h.IgnCurMode → KEYON`).
 */
export const alignModeText = (align: CaseAlign): string =>
  align.mode === "event" ? `${align.event.name}${changeText(align.event)}` : align.mode;

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
