import {
  compileEventFilter,
  DEFAULT_EVENT_FILTER,
  type DiagEvent,
  type EventFilter,
  type EventList,
  parseEventFilter,
  scopeKey,
  type TimeRange,
  type WorkspaceScope,
} from "@kipscope/shared";
import { useEffect, useState } from "react";
import { fetchEvents, isTooWide } from "../api.ts";
import { RETRY_MS } from "../time/strip.ts";

// Events of a data ref in the web (design V9 of add-events): one unfiltered EventList per data ref
// and events-line signals; strip, chart and panel filter it locally with the workspace's filter.
// The key carries the scope, and in an object scope the work window (add-case-open K11), so a
// step to another session asks again and a step back finds its list.

/** Lists kept, least recently used dropped first (a catalog's sessions each add one). */
const MAX_LISTS = 32;

/** Lists loaded so far, per `${scope}|${window}|${dataRef}|${signals}`, least recently used first. */
const lists = new Map<string, EventList>();

function remember(key: string, list: EventList): void {
  lists.delete(key);
  lists.set(key, list);
  for (const old of lists.keys()) {
    if (lists.size <= MAX_LISTS) break;
    lists.delete(old);
  }
}
/** Work-window keys that answered `too_wide`: their shown range is asked instead (object-view). */
const tooWide = new Set<string>();

/** Running fetches, shared by every hook asking for the same key; dropped when they fail. */
const running = new Map<string, Promise<EventList>>();

function load(
  key: string,
  dataRef: string,
  signals: readonly string[],
  window: TimeRange | undefined,
): Promise<EventList> {
  let p = running.get(key);
  if (!p) {
    p = fetchEvents(dataRef, signals, undefined, window).then(
      (list) => {
        remember(key, list);
        running.delete(key);
        return list;
      },
      (error: unknown) => {
        running.delete(key);
        throw error;
      },
    );
    running.set(key, p);
  }
  return p;
}

/** The cache key of an events list: scope key, work window, data ref and signals. */
export function eventsKey(
  dataRef: string,
  signals: readonly string[],
  scope?: WorkspaceScope,
  window?: TimeRange,
): string {
  const w = window ? `${window.from}-${window.to}` : "";
  return `${scopeKey(scope)}|${w}|${dataRef}|${signals.join(",")}`;
}

/**
 * GET /api/events for a data ref and its events-line signals, no filter, within the workspace's
 * `scope`; in an object scope with the work window `window` (add-case-open K11), and with the
 * shown range `view` once the work window answered `too_wide` (object-view "Gaps and events
 * follow the view"); cached by `eventsKey`; failures retried after 30 s like the density, a
 * too-wide shown range not until it changes.
 */
export function useEvents(
  dataRef: string | undefined,
  signals: readonly string[],
  scope?: WorkspaceScope,
  window?: TimeRange,
  view?: TimeRange,
): EventList | undefined {
  // An object scope asks nothing without its work window (K11: required there).
  const waiting = scope?.object === true && window === undefined;
  const key =
    dataRef === undefined || waiting ? undefined : eventsKey(dataRef, signals, scope, window);
  const viewKey =
    dataRef === undefined || !scope?.object || !window || !view
      ? undefined
      : eventsKey(dataRef, signals, scope, view);
  // Set when the work window answered too wide: a re-render asks the shown range.
  const [, setNarrowed] = useState(0);
  const narrow = key !== undefined && viewKey !== undefined && tooWide.has(key);
  const asked = narrow ? viewKey : key;
  const range = narrow ? view : window;
  const [loaded, setLoaded] = useState<{ key: string; list: EventList }>();
  // Bumped by the retry timer; a changed key fetches at once through its own dependency.
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is the retry trigger; signals, scope and the range are in the key
  useEffect(() => {
    if (asked === undefined || dataRef === undefined) return;
    const cached = lists.get(asked);
    if (cached) {
      setLoaded({ key: asked, list: cached });
      return;
    }
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    load(asked, dataRef, signals, scope?.object ? range : undefined).then(
      (list) => {
        if (live) setLoaded({ key: asked, list });
      },
      (error: unknown) => {
        if (!live) return;
        if (isTooWide(error)) {
          // The work window once more as the shown range; a too-wide shown range waits for a change.
          if (asked === key && viewKey !== undefined) {
            tooWide.add(asked);
            setNarrowed((n) => n + 1);
          }
          return;
        }
        timer = setTimeout(() => setAttempt((n) => n + 1), RETRY_MS);
      },
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [asked, attempt]);

  if (asked === undefined) return undefined;
  return loaded?.key === asked ? loaded.list : lists.get(asked);
}

/**
 * The workspace filter is what presets, chips, strip and windows use (F5); an unparsable one counts
 * as the default.
 */
export function appliedFilter(filter: string): EventFilter {
  const p = parseEventFilter(filter);
  if (p.ok) return p.filter;
  const d = parseEventFilter(DEFAULT_EVENT_FILTER);
  return d.ok ? d.filter : { terms: [] };
}

/**
 * The filter heading and list use for the typed `text` over the workspace `filter`: a typed filter
 * that parses replaces it; while it does not, they keep the workspace filter's, as strip and windows
 * do (F5), not the previous keystroke's (a half-typed word such as `Contactorfaults` matches nothing).
 */
export function previewedFilter(text: string, filter: string): EventFilter {
  const parsed = parseEventFilter(text);
  return parsed.ok ? parsed.filter : appliedFilter(filter);
}

/** The shown events: appliedFilter(ws.eventFilter ?? DEFAULT) over list.events, one rule for strip, windows and panel. */
export function shownEvents(list: EventList | undefined, filter: string): DiagEvent[] {
  return list ? list.events.filter(compileEventFilter(appliedFilter(filter))) : [];
}
