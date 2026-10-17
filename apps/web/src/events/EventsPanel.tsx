import {
  CATEGORY_TEXT,
  type CommandInput,
  type CommandResult,
  type CursorName,
  categoriesOf,
  compileEventFilter,
  type DiagEvent,
  describeEventFilter,
  EVENT_CATEGORIES,
  EVENT_PRESETS,
  type EventCategory,
  type EventFilter,
  type EventList,
  formatEventFilter,
  parseEventFilter,
  parseSignalId,
  type SignalInfo,
  type SkipReason,
  shownName,
  toggleCategory,
  toggleSource,
} from "@kipscope/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Range } from "../chart/zoom.ts";
import { formatTime } from "../time/axis.ts";
import { appliedFilter, previewedFilter } from "./eventsData.ts";
import {
  dayBands,
  inView,
  isRead,
  type ListItem,
  listItems,
  listRows,
  outside,
  readSummary,
  rowName,
  stepEvent,
} from "./list.ts";
import { eventTitle, markColor, markStyle, READ_LINE } from "./marks.ts";
import {
  type EventsScope,
  loadEventsScope,
  loadRefineOpen,
  saveEventsScope,
  saveRefineOpen,
} from "./prefs.ts";
import "./events.css";

interface Props {
  /** All events of the strip's data ref with its events-line signals, no filter (design V9); undefined while loading. */
  list: EventList | undefined;
  /** The workspace filter (`eventFilter ?? DEFAULT_EVENT_FILTER`). */
  filter: string;
  /** The workspace's events-line signals, in order. */
  signals: readonly string[];
  info: (signalId: string) => SignalInfo | undefined;
  /** The bar target's range: scope `In view` lists the events inside it; undefined without a timeseries window. */
  range: Range | undefined;
  onCommand: (input: CommandInput) => Promise<CommandResult>;
  /** Row click, `‹ ›`, earlier/later: put a cursor on t, centring the bar target first when t lies outside (design P7). */
  onJump: (t: bigint, cursor: CursorName) => void;
  /** Cursor A of the bar target; rows at its time are `current`. */
  cursorA: bigint | undefined;
  /** Bumped by App to open Refine and focus the filter field with its text selected (key `e`, the strip's count). */
  focus: number;
}

/** Text after a skipped events-line signal (design V8). */
const SKIP_TEXT: Record<SkipReason, string> = {
  not_in_catalog: "not recorded yet",
  no_states: "no named states",
  too_many_changes: "too many changes",
  in_events_table: "in the events table",
};

// Titles of the panel's controls (add-guidance W1: `<Name>: <what it does> · <key>`, ≤ 140 characters).
const TITLES = {
  inView: "In view: list the events in the window's time range",
  inViewOff: "In view: needs a window with a time range",
  all: "All: list every event that matches the filter",
  refine: "Refine: filter field, category and ECU chips, signals on the events line · e",
  earlier: "Earlier events: put cursor A on the nearest one · p",
  later: "Later events: put cursor A on the nearest one · n",
  prev: "Previous event: put cursor A on it · p",
  next: "Next event: put cursor A on it · n",
  expand: "Fault memory read: show its DTCs",
  key: "Event key: colours of pins and glyphs, line styles in the plots; hollow means the time a fault memory was read",
} as const;

const count = (n: number) => n.toLocaleString("en-US");

/** localStorage, or undefined where even reading the property throws (blocked site data). */
function localStore(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** The last focus request handled; module-wide so a panel mounted by the request handles it once
 * and a later tab click does not take the focus again. */
let handledFocus = 0;

/** Short weekday of the band's first row, local time ("Thu"). */
function weekday(t: string): string {
  return new Date(Number(BigInt(t) / 1_000_000n)).toLocaleDateString("en-US", {
    weekday: "short",
  });
}

const itemT = (item: ListItem) => (item.kind === "event" ? item.event.t : item.t);

/** Categories named by the filter's category terms, `all` and `none` left out (chips, design F5). */
function namedCategories(f: EventFilter): Set<EventCategory> {
  const named = new Set<EventCategory>();
  for (const term of f.terms) {
    if (term.kind !== "category" || term.word === "all" || term.word === "none") continue;
    for (const c of categoriesOf({ terms: [{ ...term, neg: false }] })) named.add(c);
  }
  return named;
}

/** Whether a source passes the filter's ecu facet (design F2), case-insensitive. */
function sourcePasses(f: EventFilter, source: string): boolean {
  const s = source.toLowerCase();
  const ecus = f.terms.flatMap((t) =>
    t.kind === "ecu" ? [{ neg: t.neg, value: t.value.toLowerCase() }] : [],
  );
  const pos = ecus.filter((t) => !t.neg);
  if (pos.length > 0 && !pos.some((t) => t.value === s)) return false;
  return !ecus.some((t) => t.neg && t.value === s);
}

/** Row line 2 after the name: the text, a change as `<from> → <to>`. */
function rowText(e: DiagEvent): string {
  return e.category === "change" && e.from ? `${e.from.text} → ${e.text}` : e.text;
}

const NO_RECT = { left: 0, right: 0 };

/** A row glyph styled like a pin of one category (design P4, P5): filled, hollow for a read. */
function glyphStyle(category: EventCategory, read: boolean) {
  return markStyle({ x0: 0, x1: 0, events: [], category, read, drawn: NO_RECT, hit: NO_RECT });
}

/** The most severe category of a read item's DTCs. */
const readCategory = (events: readonly DiagEvent[]): EventCategory =>
  EVENT_CATEGORIES.find((c) => events.some((e) => e.category === c)) ?? "other";

/**
 * The Events part of the sidebar (spec events "Events panel", design P3, P4, P6 of improve-events):
 * heading with the scope switch, the filter in words, presets, the Refine section, the list scoped
 * to the view and the key line.
 */
export function EventsPanel({
  list,
  filter,
  signals,
  info,
  range,
  onCommand,
  onJump,
  cursorA,
  focus,
}: Props) {
  // The typed text while the user edits; undefined shows the workspace filter.
  const [draft, setDraft] = useState<string | undefined>();
  const [scope, setScope] = useState<EventsScope>(() => loadEventsScope(localStore()));
  const [refineOpen, setRefineOpen] = useState(() => loadRefineOpen(localStore()));
  // Expanded fault memory reads, by `t|source`; closed by default.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const wantFocus = useRef(false);

  const openRefine = (open: boolean) => {
    setRefineOpen(open);
    saveRefineOpen(localStore(), open);
  };

  useEffect(() => {
    if (focus === handledFocus) return;
    handledFocus = focus;
    wantFocus.current = true;
    setRefineOpen(true);
    saveRefineOpen(localStore(), true);
  }, [focus]);

  // Once the focus request has opened Refine, the field is there to focus.
  useEffect(() => {
    if (!wantFocus.current || !refineOpen) return;
    wantFocus.current = false;
    inputRef.current?.focus();
    inputRef.current?.select();
  });

  const text = draft ?? filter;
  const parsed = useMemo(() => parseEventFilter(text), [text]);
  const applied = useMemo(() => appliedFilter(filter), [filter]);
  const previewed = useMemo(() => previewedFilter(text, filter), [text, filter]);

  const shown = useMemo(
    () => (list ? list.events.filter(compileEventFilter(previewed)) : []),
    [list, previewed],
  );
  // Without a bar target there is no view: the list shows all (design P1).
  const view = range !== undefined && scope === "view";
  const visible = useMemo(() => (range ? inView(shown, range) : shown), [shown, range]);
  const around = useMemo(
    () => (view && range ? outside(shown, range) : undefined),
    [view, shown, range],
  );
  const listed = view ? visible : shown;
  const { rows, more } = useMemo(() => listRows(listed), [listed]);
  const bands = useMemo(() => dayBands(listItems(rows)), [rows]);

  const prev = range ? stepEvent(shown, range, cursorA, -1) : undefined;
  const next = range ? stepEvent(shown, range, cursorA, 1) : undefined;

  // The row at cursor A comes into sight when A moves or the scope changes (design P4), not on
  // every preview while typing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on A and scope changes only
  useEffect(() => {
    listRef.current?.querySelector(".current")?.scrollIntoView?.({ block: "nearest" });
  }, [cursorA, view]);

  const appliedText = formatEventFilter(applied);
  const appliedCats = categoriesOf(applied);
  const named = namedCategories(applied);
  const chips = EVENT_CATEGORIES.filter((c) => (list?.counts[c] ?? 0) > 0 || named.has(c));
  const sources: { source: string; count?: number }[] = [...(list?.sources ?? [])];
  for (const t of applied.terms) {
    if (t.kind === "ecu" && !sources.some((s) => s.source.toLowerCase() === t.value.toLowerCase()))
      sources.push({ source: t.value });
  }

  /** Presets and chips: one events.setFilter each; a pending edit is dropped. */
  const setFilter = (f: string) => {
    setDraft(undefined);
    void onCommand({ type: "events.setFilter", filter: f });
  };

  const chooseScope = (s: EventsScope) => {
    setScope(s);
    saveEventsScope(localStore(), s);
  };

  const toggleRead = (id: string) =>
    setExpanded((old) => {
      const set = new Set(old);
      if (!set.delete(id)) set.add(id);
      return set;
    });

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      // An invalid filter shows its error below the field already; the server would refuse it.
      if (draft === undefined || !parsed.ok) return;
      const sent = draft;
      // The field keeps the typed text until the workspace shows the stored normal form.
      void onCommand({ type: "events.setFilter", filter: sent }).then((r) => {
        if (r.ok) setDraft((d) => (d === sent ? undefined : d));
      });
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDraft(undefined);
    }
  };

  const skipped = new Map(list?.skipped.map((s) => [s.signalId, s.reason]));
  const inRange = (t: string) => {
    if (!range) return false;
    const v = BigInt(t);
    return range.from <= v && v < range.to;
  };
  /** Classes of a row at t: `in-range` in scope All only, `current` at cursor A. */
  const rowClass = (t: string) => {
    let c = "events-row";
    if (!view && inRange(t)) c += " in-range";
    if (cursorA !== undefined && BigInt(t) === cursorA) c += " current";
    return c;
  };
  const jump = (t: string) => (e: React.MouseEvent) => onJump(BigInt(t), e.shiftKey ? "b" : "a");

  const hidden = list ? list.total - shown.length : 0;

  const seen = new Map<string, number>();

  const eventRow = (e: DiagEvent) => {
    // Same time, kind, source and name can repeat; a running number keeps keys unique.
    const id = `${e.t}|${e.kind}|${e.source}|${e.name}`;
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    const line2 = rowText(e);
    return (
      <button
        key={`${id}|${n}`}
        type="button"
        className={rowClass(e.t)}
        title={eventTitle(e)}
        onClick={jump(e.t)}
      >
        <span className="events-row-head">
          <span className="events-glyph" style={glyphStyle(e.category, isRead(e))} />
          <span className="events-time">{formatTime(BigInt(e.t), 3)}</span>
          <span className="events-cat">{CATEGORY_TEXT[e.category].label}</span>
        </span>
        <span className="events-body">
          <span className="events-name">{rowName(e)}</span>
          {line2 && ` ${line2}`}
          {e.category === "change" && e.inferred && (
            <span className="events-gap"> · after a gap</span>
          )}
        </span>
      </button>
    );
  };

  const readRow = (item: Extract<ListItem, { kind: "read" }>) => {
    const id = `${item.t}|${item.source}`;
    const open = expanded.has(id);
    return (
      <div key={`read|${id}`} className="events-read">
        <button type="button" className={rowClass(item.t)} title={READ_LINE} onClick={jump(item.t)}>
          <span className="events-row-head">
            <span className="events-glyph" style={glyphStyle(readCategory(item.events), true)} />
            <span className="events-time">{formatTime(BigInt(item.t), 3)}</span>
            <span className="events-cat">Fault memory read</span>
          </span>
          <span className="events-body">{readSummary(item, list?.events ?? [])}</span>
        </button>
        <button
          type="button"
          className="events-expand"
          aria-expanded={open}
          title={TITLES.expand}
          aria-label={TITLES.expand}
          onClick={() => toggleRead(id)}
        >
          {open ? "▾" : "▸"}
        </button>
        {open &&
          item.events.map((e) => {
            // A code can repeat within one readout; a running number keeps keys unique.
            const n = (seen.get(`dtc|${id}|${e.name}`) ?? 0) + 1;
            seen.set(`dtc|${id}|${e.name}`, n);
            return (
              <div key={`${e.name}|${n}`} className="events-dtc">
                <span className="events-name">{e.name}</span>
                {e.status && <span className="events-status"> {e.status}</span>}
                {e.text && <span className="events-dtc-text">{e.text}</span>}
              </div>
            );
          })}
      </div>
    );
  };

  return (
    <div className="events-panel">
      <div className="events-head">
        <h2 className="section-label">Events</h2>
        <div className="events-scope">
          <button
            type="button"
            className="events-seg"
            aria-pressed={view}
            disabled={!range}
            title={range ? TITLES.inView : TITLES.inViewOff}
            onClick={() => chooseScope("view")}
          >
            In view
            {list && range && <span className="events-scope-n">{` ${count(visible.length)}`}</span>}
          </button>
          <button
            type="button"
            className="events-seg"
            aria-pressed={!view}
            title={TITLES.all}
            onClick={() => chooseScope("all")}
          >
            All{list && <span className="events-scope-n">{` ${count(shown.length)}`}</span>}
          </button>
        </div>
      </div>
      <p className={parsed.ok ? "events-describe" : "events-describe error"}>
        {parsed.ok ? describeEventFilter(parsed.filter) : `${parsed.message} (at ${parsed.at})`}
        {hidden > 0 && <span className="events-hidden">{` · ${count(hidden)} hidden`}</span>}
        {!list && " · Loading…"}
      </p>
      <div className="events-pills">
        {EVENT_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            className="events-pill"
            aria-pressed={appliedText === p.filter}
            onClick={() => setFilter(p.filter)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="events-refine"
        aria-expanded={refineOpen}
        title={TITLES.refine}
        onClick={() => openRefine(!refineOpen)}
      >
        <span className="events-refine-arrow">{refineOpen ? "▾" : "▸"}</span>
        Refine
        {!refineOpen && <span className="events-refine-filter">{filter}</span>}
      </button>
      {refineOpen && (
        <div className="events-refine-body">
          <input
            ref={inputRef}
            className={parsed.ok ? "events-filter" : "events-filter invalid"}
            type="text"
            spellCheck={false}
            aria-label="Event filter"
            aria-invalid={!parsed.ok}
            placeholder="faults ecu:BMS -snapshots  ( e )"
            value={text}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => setDraft(undefined)}
          />
          {chips.length > 0 && (
            <div className="events-chips">
              {chips.map((c) => {
                const on = appliedCats.has(c);
                return (
                  <button
                    key={c}
                    type="button"
                    className="events-chip"
                    aria-pressed={on}
                    onClick={() => setFilter(formatEventFilter(toggleCategory(applied, c, !on)))}
                  >
                    <span className="events-dot" style={{ background: markColor(c) }} />
                    {CATEGORY_TEXT[c].label}
                    <span className="events-chip-count">{count(list?.counts[c] ?? 0)}</span>
                  </button>
                );
              })}
            </div>
          )}
          {sources.length > 0 && (
            <div className="events-chips">
              {sources.map((s) => {
                const on = sourcePasses(applied, s.source);
                return (
                  <button
                    key={s.source}
                    type="button"
                    className="events-chip"
                    aria-pressed={on}
                    onClick={() =>
                      setFilter(formatEventFilter(toggleSource(applied, s.source, !on)))
                    }
                  >
                    <span className="events-dot source" />
                    {s.source}
                    {s.count !== undefined && (
                      <span className="events-chip-count">{count(s.count)}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {signals.length > 0 && (
            <div className="events-line">
              <span className="section-label">On the events line</span>
              {signals.map((id) => {
                const s = info(id);
                const name = s ? shownName(s) : (parseSignalId(id)?.name ?? id);
                const reason = skipped.get(id);
                return (
                  <span
                    key={id}
                    className={reason ? "events-signal skipped" : "events-signal"}
                    title={id}
                  >
                    {name}
                    {reason && <span className="events-skip"> · {SKIP_TEXT[reason]}</span>}
                    <button
                      type="button"
                      className="events-remove"
                      title={`Remove ${name} from the events line`}
                      aria-label={`Remove ${name} from the events line`}
                      onClick={() => void onCommand({ type: "events.removeSignal", signalId: id })}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}
      <div ref={listRef} className="events-list">
        <div className="events-list-head">
          {around && around.earlier > 0 && around.before && (
            <button
              type="button"
              className="events-jump"
              title={TITLES.earlier}
              onClick={() => around.before && onJump(BigInt(around.before.t), "a")}
            >
              ↑ {count(around.earlier)} earlier
            </button>
          )}
          <span className="events-step">
            <button
              type="button"
              className="events-stepper"
              title={TITLES.prev}
              aria-label={TITLES.prev}
              disabled={!prev}
              onClick={() => prev && onJump(BigInt(prev.t), "a")}
            >
              ‹
            </button>
            <button
              type="button"
              className="events-stepper"
              title={TITLES.next}
              aria-label={TITLES.next}
              disabled={!next}
              onClick={() => next && onJump(BigInt(next.t), "a")}
            >
              ›
            </button>
          </span>
        </div>
        {list && shown.length === 0 && (
          <p className="events-empty">
            {list.total === 0 ? "No events recorded" : "No events match the filter"}
          </p>
        )}
        {list && shown.length > 0 && listed.length === 0 && (
          <p className="events-empty">No events in view</p>
        )}
        {bands.map((band) => (
          <div key={band.day} className="events-band">
            <div className="events-day">
              {weekday(band.items[0] ? itemT(band.items[0]) : "0")} {band.day}
            </div>
            {band.items.map((item) =>
              item.kind === "read" ? readRow(item) : eventRow(item.event),
            )}
          </div>
        ))}
        {more > 0 && <p className="events-more">{count(more)} more — narrow the filter</p>}
        {around && around.later > 0 && around.after && (
          <button
            type="button"
            className="events-jump"
            title={TITLES.later}
            onClick={() => around.after && onJump(BigInt(around.after.t), "a")}
          >
            ↓ {count(around.later)} later
          </button>
        )}
      </div>
      <div className="events-key" title={TITLES.key}>
        <span>
          <span className="events-key-sample fault" />
          Fault
        </span>
        <span>
          <span className="events-key-sample stored" />
          Stored
        </span>
        <span>
          <span className="events-key-sample change" />
          Change
        </span>
        <span>
          <span className="events-key-sample other" />
          Other
        </span>
        <span>
          <span className="events-key-sample read" />
          Fault memory read
        </span>
      </div>
    </div>
  );
}
