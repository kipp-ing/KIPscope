import {
  CATEGORY_TEXT,
  type CommandInput,
  type CommandResult,
  categoriesOf,
  compileEventFilter,
  DEFAULT_EVENT_FILTER,
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
import { dayBands, listRows } from "./list.ts";
import { markColor } from "./marks.ts";
import "./events.css";

interface Props {
  /** All events of the strip's data ref with its events-line signals, no filter (design V9); undefined while loading. */
  list: EventList | undefined;
  /** The workspace filter (`eventFilter ?? DEFAULT_EVENT_FILTER`). */
  filter: string;
  /** The workspace's events-line signals, in order. */
  signals: readonly string[];
  info: (signalId: string) => SignalInfo | undefined;
  /** The bar target's range: rows inside it carry the accent border; undefined without a timeseries window. */
  range: Range | undefined;
  onCommand: (input: CommandInput) => Promise<CommandResult>;
  /** A row click: centre the bar target on the event (App: centreRange, one window.setRange). */
  onCentre: (t: bigint) => void;
  /** Bumped by App to focus the filter field with its text selected (key `e`, the strip's count). */
  focus: number;
}

/** Text after a skipped events-line signal (design V8). */
const SKIP_TEXT: Record<SkipReason, string> = {
  not_in_catalog: "not recorded yet",
  no_states: "no named states",
  too_many_changes: "too many changes",
  in_events_table: "in the events table",
};

const count = (n: number) => n.toLocaleString("en-US");

/** The last focus request handled; module-wide so a panel mounted by the request handles it once
 * and a later tab click does not take the focus again. */
let handledFocus = 0;

/** Short weekday of the band's first row, local time ("Thu"). */
function weekday(t: string): string {
  return new Date(Number(BigInt(t) / 1_000_000n)).toLocaleDateString("en-US", {
    weekday: "short",
  });
}

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

/** Row line 2: the text, a change as `<from> → <to>`. */
function rowText(e: DiagEvent): string {
  return e.category === "change" && e.from ? `${e.from.text} → ${e.text}` : e.text;
}

/**
 * The workspace filter is what presets and chips edit; an unparsable one counts as the default.
 * A typed filter that parses replaces it in heading and list (previewedFilter); while it does not,
 * they keep the workspace filter's, as strip and windows do (F5), not the previous keystroke's
 * (a half-typed word such as `Contactorfaults` matches nothing).
 */
export function appliedFilter(filter: string): EventFilter {
  const p = parseEventFilter(filter);
  if (p.ok) return p.filter;
  const d = parseEventFilter(DEFAULT_EVENT_FILTER);
  return d.ok ? d.filter : { terms: [] };
}

/** The filter heading and list use for the typed `text` over the workspace `filter`. */
export function previewedFilter(text: string, filter: string): EventFilter {
  const parsed = parseEventFilter(text);
  return parsed.ok ? parsed.filter : appliedFilter(filter);
}

/**
 * The Events part of the sidebar (spec events "Events panel", design V8, F5): heading with the count,
 * the filter field with its preview, presets, chips, the events-line signals and the day-banded list.
 */
export function EventsPanel({
  list,
  filter,
  signals,
  info,
  range,
  onCommand,
  onCentre,
  focus,
}: Props) {
  // The typed text while the user edits; undefined shows the workspace filter.
  const [draft, setDraft] = useState<string | undefined>();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focus === handledFocus) return;
    handledFocus = focus;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focus]);

  const text = draft ?? filter;
  const parsed = useMemo(() => parseEventFilter(text), [text]);
  const applied = useMemo(() => appliedFilter(filter), [filter]);
  const previewed = parsed.ok ? parsed.filter : applied;

  const shown = useMemo(
    () => (list ? list.events.filter(compileEventFilter(previewed)) : []),
    [list, previewed],
  );
  const { rows, more } = useMemo(() => listRows(shown), [shown]);
  const bands = useMemo(() => dayBands(rows), [rows]);

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

  const seen = new Map<string, number>();

  return (
    <div className="events-panel">
      <div className="events-head">
        <h2 className="section-label">Events</h2>
        <span className="events-count">
          {list ? `${count(shown.length)} of ${count(list.total)}` : "Loading…"}
        </span>
      </div>
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
      <p className={parsed.ok ? "events-describe" : "events-describe error"}>
        {parsed.ok ? describeEventFilter(parsed.filter) : `${parsed.message} (at ${parsed.at})`}
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
                onClick={() => setFilter(formatEventFilter(toggleSource(applied, s.source, !on)))}
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
      <div className="events-list">
        {list && shown.length === 0 && (
          <p className="events-empty">
            {list.total === 0 ? "No events recorded" : "No events match the filter"}
          </p>
        )}
        {bands.map((band) => (
          <div key={band.day} className="events-band">
            <div className="events-day">
              {weekday(band.rows[0]?.t ?? "0")} {band.day}
            </div>
            {band.rows.map((e) => {
              const line2 = rowText(e);
              // Same time, kind, source and name can repeat; a running number keeps keys unique.
              const id = `${e.t}|${e.kind}|${e.source}|${e.name}`;
              const n = (seen.get(id) ?? 0) + 1;
              seen.set(id, n);
              return (
                <button
                  key={`${id}|${n}`}
                  type="button"
                  className={inRange(e.t) ? "events-row in-range" : "events-row"}
                  onClick={() => onCentre(BigInt(e.t))}
                >
                  <span className="events-row-head">
                    <span className="events-glyph" style={{ background: markColor(e.category) }} />
                    <span className="events-time">{formatTime(BigInt(e.t), 3)}</span>
                    <span className="events-name">
                      {e.source} {e.name}
                    </span>
                  </span>
                  {line2 && (
                    <span className="events-text" title={line2}>
                      {line2}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
        {more > 0 && <p className="events-more">{count(more)} more — narrow the filter</p>}
      </div>
    </div>
  );
}
