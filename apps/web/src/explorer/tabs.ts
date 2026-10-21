import { HINTS } from "../help/hints.ts";

/** The strip's events as the Events tab counts them (design DW14). */
export interface TabEvents {
  shown: number;
  total: number;
  /** The events filter as a sentence, for the tooltip; absent without a filter. */
  sentence?: string;
  /** The work window's "nearby" tooltip under a vehicle scope; replaces the count tooltip. */
  nearby?: string;
}

/**
 * Counts and tooltips of the sidebar's tabs (guidance "Explorer names the drag", events "Events
 * count on the Events tab"): the catalog size or, while searching, the matches; the events matching
 * the filter, none without events.
 */
export function sidebarTabs(input: { signals: number; matches?: number; events?: TabEvents }): {
  signals: { count: string; title: string };
  events: { count?: string; title: string };
} {
  const { signals, matches, events } = input;
  return {
    signals: {
      count: (matches ?? signals).toLocaleString("en-US"),
      title: HINTS.tabSignals(signals, matches),
    },
    events:
      events && events.total > 0
        ? {
            count: events.shown.toLocaleString("en-US"),
            title: events.nearby ?? HINTS.eventsCount(events.shown, events.total, events.sentence),
          }
        : { title: HINTS.tabEvents },
  };
}
