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
  type WorkspaceCase,
  type WorkspaceScope,
} from "@kipscope/shared";
import { formatDate, formatFull, formatTime } from "../time/axis.ts";
import { startDuration } from "../time/rangeLine.ts";
import { caseNotice, endedEvents } from "../time/scope.ts";
import type { StripEvent } from "../views/notice.ts";

/** Meta entries a catalog list row shows (design K14). */
const ROW_META = 2;
/** Names a `missing` message lists before `, …`. */
const MISSING_NAMES = 3;

/** Messages after a case command result (design K14). */
export const CASE_MESSAGES = {
  clampedLinked: "Stopped at the session edge. Unlink shows the whole vehicle.",
  clampedObject: "Stopped at the end of the catalog's sessions.",
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
  /** The position button's tooltip (D-095): what it opens and the alignment. */
  position: (words: string) => `Sessions of the catalog, aligned at ${words}`,
  /** The position button's `aria-label` (D-095). */
  positionLabel: (k: number, n: number, words: string) =>
    `Session ${k} of ${n}, aligned at ${words}: sessions and align`,
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
  /** `<k> / <n>` in the fixed 88 px button (D-095); "" → skeleton. */
  position: string;
  /** The current alignment, for the position button's glyph and words. */
  align: CaseAlign["mode"];
  /** "Sessions of the catalog, aligned at the session start". */
  positionTooltip: string;
  /** "Session 1 of 4, aligned at the session start: sessions and align". */
  positionLabel: string;
  /** undefined → skeleton. */
  title: string | undefined;
  /** Line 1 `<title or object> · <full start> · <duration> · <kind>` (unlinked `<object> · whole
   *  series · <full start> · <duration>`), then the meta, id and tool lines. */
  titleTooltip: string | undefined;
  /** startDuration's duration: "0:10 h", "41 s", "9 d 23 h". undefined → skeleton. */
  duration: string | undefined;
  /** startDuration's durationTip: "Duration 10 min". */
  durationTooltip: string | undefined;
  action: "Unlink" | "Link";
  /** The slots show the target of a step or go on its way (DW4). */
  pending: boolean;
}

/**
 * The start and duration of any range (the session bar's title tooltip and duration slot, the scope
 * row's, the catalog list's; DW5, D-093, D-095) from startDuration: `start` "26-10-01 03:00", its
 * full form "Thu 2026-10-01 03:00" as `startTooltip`, `duration` "0:10 h" and its words.
 */
export function timesSlot(
  from: bigint,
  to: bigint,
): { start: string; startTooltip: string; duration: string; durationTooltip: string } {
  const sd = startDuration(from, to);
  return {
    start: `${sd.date} ${sd.time}`,
    startTooltip: sd.full,
    duration: sd.duration,
    durationTooltip: sd.durationTip,
  };
}

/** "the session start" | "the session end" | "the anchor" | the event item's label (alignItems). */
export function alignWords(align: CaseAlign): string {
  if (align.mode === "start") return "the session start";
  if (align.mode === "end") return "the session end";
  if (align.mode === "anchor") return "the anchor";
  return alignEventText(align);
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

/** The action button's text while Unlink or Link is on its way (D-112). */
export type PendingAction = "Unlinking…" | "Linking…";

/** linked + case.unlink → "Unlinking…"; unlinked + case.go → "Linking…"; else undefined. */
export function pendingAction(
  c: Pick<WorkspaceCase, "linked">,
  input: CommandInput,
): PendingAction | undefined {
  if (c.linked && input.type === "case.unlink") return "Unlinking…";
  if (!c.linked && input.type === "case.go") return "Linking…";
  return undefined;
}

/** How long an Unlink runs before the patience hint shows (D-113). */
export const UNLINK_HINT_DELAY_MS = 1000;

/** True only for a pending Unlink; Link never gets the hint (D-113). */
export function patienceHintFor(action: PendingAction | undefined): boolean {
  return action === "Unlinking…";
}

/** Calls `show` once after `delayMs` (setTimeout); the returned function cancels it,
 *  and is a no-op once `show` ran. */
export function startPatienceTimer(
  show: () => void,
  delayMs: number = UNLINK_HINT_DELAY_MS,
): () => void {
  const timer = setTimeout(show, delayMs);
  return () => clearTimeout(timer);
}

/** True exactly when pendingTarget(c, pending, input) or pendingAction(c, input) gives a value. */
export function startsPending(
  c: Pick<WorkspaceCase, "current" | "count" | "linked">,
  pending: number | undefined,
  input: CommandInput,
): boolean {
  return pendingTarget(c, pending, input) !== undefined || pendingAction(c, input) !== undefined;
}

/** The title's tooltip: `head`, then every meta entry, the id and the origin tool, one per line. */
const titleTooltip = (entry: CaseEntry, head: string, tool: string | undefined): string =>
  [
    head,
    ...Object.entries(entry.meta ?? {}).map(([k, v]) => `${k}: ${metaValueText(v)}`),
    `id: ${entry.id}`,
    ...(tool ? [`from ${tool}`] : []),
  ].join("\n");

type Position = Pick<SessionSlots, "position" | "align" | "positionTooltip" | "positionLabel">;
type Content = Omit<SessionSlots, keyof Position | "pending">;

/** `<head> · <full start> · <duration>[ · <kind>]` of a range: line 1 of the title's tooltip. */
const headLine = (name: string, from: bigint, to: bigint, kind?: string): string => {
  const t = timesSlot(from, to);
  return [name, t.startTooltip, t.duration, ...(kind ? [kind] : [])].join(" · ");
};

/** A session's slots: its title or object, its start in the tooltip, its duration. */
function sessionContent(entry: CaseEntry, tool: string | undefined): Content {
  const from = BigInt(entry.from);
  const to = BigInt(entry.to);
  const name = entryName(entry);
  const t = timesSlot(from, to);
  return {
    label: "SESSION",
    title: name,
    titleTooltip: titleTooltip(entry, headLine(name, from, to, entry.kind), tool),
    duration: t.duration,
    durationTooltip: t.durationTooltip,
    action: "Unlink",
  };
}

/** A slot set whose texts are not known yet: skeletons. */
const SKELETON: Omit<Content, "label" | "action"> = {
  title: undefined,
  titleTooltip: undefined,
  duration: undefined,
  durationTooltip: undefined,
};

/** The position button's text, glyph and words for index `k` (0-based) of `c` (D-095). */
function positionSlots(c: WorkspaceCase, k: number): Position {
  const words = alignWords(c.align);
  return {
    position: positionText({ current: k, count: c.count }),
    align: c.align.mode,
    positionTooltip: CASE_HINTS.position(words),
    positionLabel: CASE_HINTS.positionLabel(k + 1, c.count, words),
  };
}

/**
 * The session bar's slots (case-navigation "Session bar", DW5). Linked: the entry's title or
 * object, its duration, `Unlink`; unlinked: `<object> · whole series` (the vehicle, never the
 * dropped session's title) with the scope's duration, `Link`; the start only in the title's
 * tooltip (D-095). With `pending` (a step or go on its way, DW4) the target's slots from the loaded
 * catalog, skeletons where it is not loaded; without a case (an opening `/open#cases=` page) every
 * text slot a skeleton.
 */
export function sessionSlots(
  c: WorkspaceCase | undefined,
  scope?: WorkspaceScope,
  catalog?: CaseCatalog,
  pending?: number,
): SessionSlots {
  if (!c) {
    const position: Position = {
      position: "",
      align: "start",
      positionTooltip: CASE_HINTS.list,
      positionLabel: CASE_HINTS.list,
    };
    return { label: "SESSION", ...SKELETON, action: "Unlink", ...position, pending: false };
  }
  const tool = catalog?.origin?.tool;
  const position = positionSlots(c, pending ?? c.current);
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
  const t = timesSlot(from, to);
  return {
    label: "VEHICLE",
    title,
    titleTooltip: titleTooltip(e, headLine(title, from, to), tool),
    duration: t.duration,
    durationTooltip: t.durationTooltip,
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
  /** "1" */
  position: string;
  /** `<title or object> · <kind> · <first 2 meta>`, truncating, full text as tooltip. */
  name: string;
  /** "26-10-01 03:00", its full form "Thu 2026-10-01 03:00" as tooltip. */
  start: string;
  startTooltip: string;
  /** "0:10 h" in the duration tag, its words as the tag's title. */
  duration: string;
  durationTooltip: string;
  current: boolean;
}

/** A catalog list row's columns (D-093, D-095, mock grid `28px 1fr 116px 64px`). */
function catalogRow(entry: CaseEntry, index: number, current: number): CatalogRow {
  return {
    index,
    position: String(index + 1),
    name: [
      entryName(entry),
      ...(entry.kind ? [entry.kind] : []),
      ...metaText(entry, ROW_META),
    ].join(" · "),
    ...timesSlot(BigInt(entry.from), BigInt(entry.to)),
    current: index === current,
  };
}

/** Whether `filter` (lower case) is a substring of title, object, kind, id, local start or a meta value. */
function matches(entry: CaseEntry, filter: string): boolean {
  const fields = [
    entry.title ?? "",
    entry.object,
    entry.kind ?? "",
    entry.id,
    localMinute(entry.from),
    timesSlot(BigInt(entry.from), BigInt(entry.to)).start,
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
    rows.push(catalogRow(entry, index, current));
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
