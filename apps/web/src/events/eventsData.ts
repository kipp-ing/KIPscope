import {
  compileEventFilter,
  DEFAULT_EVENT_FILTER,
  type DiagEvent,
  type EventFilter,
  type EventList,
  parseEventFilter,
} from "@kipscope/shared";
import { useEffect, useState } from "react";
import { fetchEvents } from "../api.ts";
import { RETRY_MS } from "../time/strip.ts";

// Events of a data ref in the web (design V9 of add-events): one unfiltered EventList per data ref
// and events-line signals; strip, chart and panel filter it locally with the workspace's filter.

/** Lists loaded so far, per `${dataRef}|${signals}`, for the page's life. */
const lists = new Map<string, EventList>();
/** Running fetches, shared by every hook asking for the same key; dropped when they fail. */
const running = new Map<string, Promise<EventList>>();

function load(key: string, dataRef: string, signals: readonly string[]): Promise<EventList> {
  let p = running.get(key);
  if (!p) {
    p = fetchEvents(dataRef, signals).then(
      (list) => {
        lists.set(key, list);
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

/** GET /api/events for a data ref and its events-line signals, no filter; cached per page life by key `${dataRef}|${signals.join(",")}`; failures retried after 30 s like the density. */
export function useEvents(
  dataRef: string | undefined,
  signals: readonly string[],
): EventList | undefined {
  const key = dataRef === undefined ? undefined : `${dataRef}|${signals.join(",")}`;
  const [loaded, setLoaded] = useState<{ key: string; list: EventList }>();
  // Bumped by the retry timer; a changed key fetches at once through its own dependency.
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is the retry trigger; signals are in key
  useEffect(() => {
    if (key === undefined || dataRef === undefined) return;
    const cached = lists.get(key);
    if (cached) {
      setLoaded({ key, list: cached });
      return;
    }
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    load(key, dataRef, signals).then(
      (list) => {
        if (live) setLoaded({ key, list });
      },
      () => {
        if (live) timer = setTimeout(() => setAttempt((n) => n + 1), RETRY_MS);
      },
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, attempt]);

  if (key === undefined) return undefined;
  return loaded?.key === key ? loaded.list : lists.get(key);
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
