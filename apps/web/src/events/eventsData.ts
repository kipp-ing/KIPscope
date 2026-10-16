import {
  compileEventFilter,
  DEFAULT_EVENT_FILTER,
  type DiagEvent,
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

/** The shown events: compileEventFilter(parse(ws.eventFilter ?? DEFAULT)) over list.events; an invalid filter counts as the default. */
export function shownEvents(list: EventList | undefined, filter: string): DiagEvent[] {
  if (!list) return [];
  let parsed = parseEventFilter(filter);
  if (!parsed.ok) parsed = parseEventFilter(DEFAULT_EVENT_FILTER);
  return parsed.ok ? list.events.filter(compileEventFilter(parsed.filter)) : [];
}
