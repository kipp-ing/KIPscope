import {
  type CalendarDensity,
  type Density,
  scopeKey,
  type WorkspaceScope,
} from "@kipscope/shared";
import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fetchCalendar, fetchDensity } from "../api.ts";
import {
  type CalendarDay,
  canPage,
  dayBarHeight,
  dayBars,
  dayDrives,
  dayTip,
  draftOf,
  draftRange,
  localMonth,
  monthCells,
  openMonths,
  type PickerDraft,
  pickDay,
  type ScopeKind,
  wholeLabel,
} from "../time/calendar.ts";
import { rangeLine } from "../time/rangeLine.ts";
import { wholeRange } from "../time/stripGeometry.ts";
import "./rangePicker.css";

export interface RangePickerProps {
  /** The bar target's shown range (preview included). */
  range: { from: bigint; to: bigint };
  /** stripDataRef(workspace); undefined → no bars. */
  dataRef: string | undefined;
  scope: WorkspaceScope | undefined;
  kind: ScopeKind;
  /** The typed text, kept by App across opens. */
  typed: string;
  onTyped: (text: string) => void;
  /** Resolves and applies "Go to" text (today's onGoTo): error text, or undefined when applied (then the picker closes). */
  onGoTo: (text: string) => string | undefined;
  /** One range command for the bar target, one history entry (as the strip's range commands). */
  onApply: (range: { from: bigint; to: bigint }) => void;
  /** Close without a command; focus returns to the button. */
  onClose: () => void;
}

interface Month {
  year: number;
  month: number;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAY_HEADS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const VIEWPORT_MARGIN_PX = 8;

// Calendar answers for the page's life (design R10), keyed `dataRef|scopeKey|from`; cleared when
// the scope key changes. Failures are not kept: the next open asks again.
const answers = new Map<string, CalendarDensity>();
let answersScope = "";

function answersFor(scope: string): Map<string, CalendarDensity> {
  if (answersScope !== scope) {
    answers.clear();
    answersScope = scope;
  }
  return answers;
}

const monthKey = (dataRef: string, scope: string, m: Month): string =>
  `${dataRef}|${scope}|${localMonth(m.year, m.month).from}`;

const nextMonth = (m: Month, step: number): Month => {
  const i = m.year * 12 + (m.month - 1) + step;
  return { year: Math.floor(i / 12), month: (i % 12) + 1 };
};

/** "Tue" of a local date "2026-10-13". */
const weekdayOf = (date: string): string =>
  WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? "";

const monthOfDate = (date: string): Month => ({
  year: Number(date.slice(0, 4)),
  month: Number(date.slice(5, 7)),
});

function dayOf(date: string): CalendarDay | undefined {
  const m = monthOfDate(date);
  return monthCells(m.year, m.month).find((c) => c?.date === date) ?? undefined;
}

function todayText(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The range line without its ⁺¹; the mark is drawn as a <sup>. */
function RangeText({ from, to }: { from: bigint; to: bigint }) {
  const line = rangeLine(from, to);
  const text = line.plusOne && line.text.endsWith("⁺¹") ? line.text.slice(0, -2) : line.text;
  return (
    <>
      <span className="result-text">
        {text}
        {line.plusOne && <sup>+1</sup>}
      </span>
      <span className="result-duration">{line.duration}</span>
    </>
  );
}

const chevron = (points: string) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points={points} />
  </svg>
);

/**
 * The range picker under the range button (spec range-picker, design R10, mock `GoTo.dc.html`):
 * the typed "Go to" field, two months with per-day density bars and drives, the day's presets,
 * From and To, and the result line with Cancel and Go. Every row has a fixed height, so loading,
 * failure, errors and paging never change its size.
 */
export function RangePicker({
  range,
  dataRef,
  scope,
  kind,
  typed,
  onTyped,
  onGoTo,
  onApply,
  onClose,
}: RangePickerProps) {
  const sKey = scopeKey(scope);
  // Left month; the right one follows it (R9).
  const [left, setLeft] = useState<Month>(
    () => openMonths(range)[0] ?? nextMonth(monthOfDate(draftOf(range).start), -1),
  );
  const [draft, setDraft] = useState<PickerDraft>(() => draftOf(range));
  const [typedError, setTypedError] = useState<string | undefined>();
  const [density, setDensity] = useState<Density | undefined>();
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  // Bumped when an answer lands in the module cache.
  const [, setLanded] = useState(0);
  const inFlight = useRef(new Map<string, AbortController>());
  const root = useRef<HTMLDivElement>(null);
  const typedRef = useRef<HTMLInputElement>(null);
  const [shift, setShift] = useState(0);
  const shiftRef = useRef(0);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const months = [left, nextMonth(left, 1)];
  const cache = answersFor(sKey);
  const keyOf = (m: Month) => (dataRef === undefined ? undefined : monthKey(dataRef, sKey, m));

  // The whole span (paging bounds, whole-span preset): the strip's density, from the server cache.
  useEffect(() => {
    setDensity(undefined);
    if (dataRef === undefined) return;
    const abort = new AbortController();
    fetchDensity(dataRef, abort.signal).then(setDensity, () => {});
    return () => abort.abort();
  }, [dataRef]);

  // The shown months' calendars; paging aborts a month no longer shown and asks only the new one.
  useEffect(() => {
    if (dataRef === undefined) return;
    const cached = answersFor(sKey);
    const wanted = new Map(
      [left, nextMonth(left, 1)].map((m) => [monthKey(dataRef, sKey, m), m] as const),
    );
    for (const [key, abort] of inFlight.current) {
      if (wanted.has(key)) continue;
      abort.abort();
      inFlight.current.delete(key);
    }
    for (const [key, m] of wanted) {
      if (cached.has(key) || failed.has(key) || inFlight.current.has(key)) continue;
      const abort = new AbortController();
      inFlight.current.set(key, abort);
      fetchCalendar(dataRef, localMonth(m.year, m.month), abort.signal)
        .then(
          (answer) => {
            answersFor(sKey).set(key, answer);
            setLanded((n) => n + 1);
          },
          () => {
            if (!abort.signal.aborted) setFailed((f) => new Set(f).add(key));
          },
        )
        .finally(() => {
          if (inFlight.current.get(key) === abort) inFlight.current.delete(key);
        });
    }
  }, [dataRef, sKey, left, failed]);

  useEffect(() => {
    const pending = inFlight.current;
    return () => {
      for (const abort of pending.values()) abort.abort();
      pending.clear();
    };
  }, []);

  // Opened: the typed field focused with its last text selected.
  useEffect(() => {
    typedRef.current?.focus();
    typedRef.current?.select();
  }, []);

  // A pointer-down outside the picker and the range button closes it (capture phase, as the menus).
  useEffect(() => {
    const onDown = (e: Event) => {
      const target = e.target as Element | null;
      if (root.current?.contains(target) || target?.closest?.(".range-button")) return;
      closeRef.current();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, []);

  // Left edge at the button's, shifted left to stay inside the viewport.
  useLayoutEffect(() => {
    const place = () => {
      const el = root.current;
      if (!el) return;
      const natural = el.getBoundingClientRect().left - shiftRef.current;
      const over =
        natural + el.offsetWidth - (document.documentElement.clientWidth - VIEWPORT_MARGIN_PX);
      const next = over > 0 ? -Math.min(over, Math.max(0, natural - VIEWPORT_MARGIN_PX)) : 0;
      shiftRef.current = next;
      setShift(next);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, []);

  const changeDraft = (d: PickerDraft) => {
    setDraft(d);
    setTypedError(undefined);
  };
  const result = draftRange(draft);
  const resultRange = "error" in result ? undefined : result;
  const go = () => {
    if (!resultRange) return;
    onApply(resultRange);
    onClose();
  };
  const goTyped = () => {
    const error = onGoTo(typed);
    if (error === undefined) onClose();
    else setTypedError(error);
  };

  // Month states: answered, loading (asked, no answer yet) or failed.
  const answerOf = (m: Month): CalendarDensity | undefined => {
    const key = keyOf(m);
    return key === undefined ? undefined : cache.get(key);
  };
  const monthFailed = (m: Month) => {
    const key = keyOf(m);
    return key !== undefined && failed.has(key);
  };
  const monthLoading = (m: Month) => keyOf(m) !== undefined && !answerOf(m) && !monthFailed(m);
  const anyFailed = months.some(monthFailed);
  const anyLoading = months.some(monthLoading);

  // Bars of every day of both months; heights scale by the largest bar shown.
  const grids = months.map((m) => {
    const answer = answerOf(m);
    return {
      m,
      answer,
      cells: monthCells(m.year, m.month).map((day) =>
        day ? { day, bars: answer ? dayBars(answer, day) : undefined } : null,
      ),
    };
  });
  let max = 0;
  for (const g of grids)
    for (const c of g.cells) for (const b of c?.bars ?? []) if (b.count > max) max = b.count;

  const scopeFrom = scope ? BigInt(scope.from) : undefined;
  const scopeTo = scope ? BigInt(scope.to) : undefined;
  const inScope = (day: CalendarDay) =>
    scopeFrom === undefined || scopeTo === undefined || (day.from < scopeTo && day.to > scopeFrom);
  const today = todayText();
  const paging = canPage(density, left);

  // The start day's presets.
  const startDay = dayOf(draft.start);
  const startMonth = monthOfDate(draft.start);
  const startAnswer = answerOf(startMonth);
  const startShown = months.some((m) => m.year === startMonth.year && m.month === startMonth.month);
  const drives = startDay && startAnswer ? dayDrives(startAnswer, startDay) : [];
  let drivesNote: string | undefined;
  if (startAnswer && drives.length === 0) drivesNote = "no drive";
  else if (!startAnswer && startShown && monthLoading(startMonth)) drivesNote = "Loading…";

  let hint = "Click a day; a second click ends the range";
  if (anyFailed) hint = "Density unavailable";
  else if (anyLoading) hint = "Loading…";
  else if (draft.phase === "end") hint = "Click the last day, or set the times";

  const error = typedError ?? ("error" in result ? result.error : undefined);
  const timeKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    go();
  };

  return (
    <div
      ref={root}
      className="range-picker"
      role="dialog"
      aria-label="Go to"
      style={{ transform: shift ? `translateX(${shift}px)` : undefined }}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="picker-typed">
        <input
          ref={typedRef}
          type="text"
          className="typed"
          aria-label="Type a time or range"
          placeholder="Type: 15:08 · 15:07 .. 15:09 · 1h · +10min"
          spellCheck={false}
          autoComplete="off"
          value={typed}
          aria-invalid={typedError !== undefined}
          onChange={(e) => {
            onTyped(e.target.value);
            setTypedError(undefined);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            goTyped();
          }}
        />
      </div>

      <div className="picker-months">
        <button
          type="button"
          className="page"
          aria-label="Earlier months"
          disabled={!paging.prev}
          onClick={() => setLeft((m) => nextMonth(m, -1))}
        >
          {chevron("15 6 9 12 15 18")}
        </button>
        {months.map((m) => (
          <span key={`${m.year}-${m.month}`} className="month-title">
            {MONTH_NAMES[m.month - 1]} {m.year}
          </span>
        ))}
        <button
          type="button"
          className="page"
          aria-label="Later months"
          disabled={!paging.next}
          onClick={() => setLeft((m) => nextMonth(m, 1))}
        >
          {chevron("9 6 15 12 9 18")}
        </button>
      </div>

      <div className="picker-grids">
        {grids.map((g) => (
          <div key={`${g.m.year}-${g.m.month}`} className="month-grid">
            {WEEKDAY_HEADS.map((w) => (
              <span key={w} className="weekday">
                {w}
              </span>
            ))}
            {g.cells.map((c, i) => {
              if (!c) {
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed 42-cell grid
                return <span key={i} className="day empty" />;
              }
              const { day, bars } = c;
              const rows = bars?.reduce((s, b) => s + b.count, 0) ?? 0;
              const off = dataRef !== undefined && (g.answer ? rows === 0 : !inScope(day));
              const edge = day.date === draft.start || day.date === draft.end;
              const between = day.date > draft.start && day.date < draft.end;
              const tip = dayTip(g.answer, day, kind);
              const classes = ["day"];
              if (edge) classes.push("edge");
              else if (between) classes.push("between");
              if (rows > 0) classes.push("has-data");
              if (day.date === today) classes.push("today");
              return (
                <button
                  key={day.date}
                  type="button"
                  className={classes.join(" ")}
                  aria-disabled={off}
                  title={tip}
                  aria-label={tip}
                  onClick={() => {
                    if (!off) changeDraft(pickDay(draft, day.date));
                  }}
                >
                  <span className="day-number">{day.day}</span>
                  {bars && (
                    <span className="day-bars" aria-hidden="true">
                      {bars.map((b, k) => (
                        <span
                          // biome-ignore lint/suspicious/noArrayIndexKey: 12 fixed bars per day
                          key={k}
                          className={b.drive ? "bar drive" : "bar"}
                          style={{ height: dayBarHeight(b.count, max) }}
                        />
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="picker-legend">
        <span className="legend-item">
          <span className="swatch" />
          data per 2 h
        </span>
        <span className="legend-item">
          <span className="swatch drive" />
          drive
        </span>
        <span className="picker-hint">{hint}</span>
      </div>

      <div className="picker-chips">
        <span className="chips-label">
          DRIVES {weekdayOf(draft.start).toUpperCase()} {Number(draft.start.slice(8, 10))}
        </span>
        {drives.map((d) => (
          <button
            key={d.drive.from}
            type="button"
            className="chip"
            onClick={() =>
              changeDraft(draftOf({ from: BigInt(d.drive.from), to: BigInt(d.drive.to) }))
            }
          >
            {d.label}
          </button>
        ))}
        {drivesNote && <span className="chips-note">{drivesNote}</span>}
        <span className="chips-gap" />
        <button
          type="button"
          className="chip"
          onClick={() =>
            changeDraft({
              ...draft,
              end: draft.start,
              from: "00:00:00",
              to: "24:00:00",
              phase: "start",
            })
          }
        >
          Whole day
        </button>
        <button
          type="button"
          className="chip"
          disabled={!density}
          onClick={() => {
            if (density) changeDraft(draftOf(wholeRange(density)));
          }}
        >
          {wholeLabel(kind)}
        </button>
      </div>

      <div className="picker-times">
        <label htmlFor="range-picker-from" className="time-label from">
          From
        </label>
        <span className="time-date">
          {weekdayOf(draft.start)} {draft.start}
        </span>
        <input
          id="range-picker-from"
          type="text"
          className="time"
          spellCheck={false}
          autoComplete="off"
          value={draft.from}
          onChange={(e) => changeDraft({ ...draft, from: e.target.value })}
          onKeyDown={timeKey}
        />
        <span className="times-gap" />
        <label htmlFor="range-picker-to" className="time-label to">
          To
        </label>
        <span className="time-date">
          {weekdayOf(draft.end)} {draft.end}
        </span>
        <input
          id="range-picker-to"
          type="text"
          className="time"
          spellCheck={false}
          autoComplete="off"
          value={draft.to}
          onChange={(e) => changeDraft({ ...draft, to: e.target.value })}
          onKeyDown={timeKey}
        />
      </div>

      <div className="picker-result">
        <span className="result" title={error}>
          {error !== undefined ? (
            <span className="result-error">{error}</span>
          ) : (
            resultRange && <RangeText from={resultRange.from} to={resultRange.to} />
          )}
        </span>
        <button type="button" className="cancel" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="go" disabled={!resultRange} onClick={go}>
          Go
        </button>
      </div>
    </div>
  );
}
