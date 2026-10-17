import { describe, expect, it } from "vitest";
import {
  EVENTS_REFINE_KEY,
  EVENTS_SCOPE_KEY,
  loadEventsScope,
  loadRefineOpen,
  saveEventsScope,
  saveRefineOpen,
} from "../src/events/prefs.ts";

const throwing = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

const holding = (key: string, value: string) => ({
  getItem: (k: string) => (k === key ? value : null),
});

describe("events prefs", () => {
  it("loads and saves scope and refine state", () => {
    expect(EVENTS_SCOPE_KEY).toBe("kipscope.eventsScope");
    expect(EVENTS_REFINE_KEY).toBe("kipscope.eventsRefine");

    expect(loadEventsScope(holding(EVENTS_SCOPE_KEY, "all"))).toBe("all");
    expect(loadEventsScope(holding(EVENTS_SCOPE_KEY, "view"))).toBe("view");
    expect(loadEventsScope(holding(EVENTS_SCOPE_KEY, "nonsense"))).toBe("view");
    expect(loadEventsScope({ getItem: () => null })).toBe("view");
    expect(loadEventsScope(throwing)).toBe("view");
    expect(loadEventsScope(undefined)).toBe("view");

    expect(loadRefineOpen(holding(EVENTS_REFINE_KEY, "open"))).toBe(true);
    expect(loadRefineOpen(holding(EVENTS_REFINE_KEY, "closed"))).toBe(false);
    expect(loadRefineOpen(holding(EVENTS_REFINE_KEY, "nonsense"))).toBe(false);
    expect(loadRefineOpen({ getItem: () => null })).toBe(false);
    expect(loadRefineOpen(throwing)).toBe(false);
    expect(loadRefineOpen(undefined)).toBe(false);

    // Saving never throws, and what is saved loads back.
    expect(() => saveEventsScope(throwing, "all")).not.toThrow();
    expect(() => saveRefineOpen(throwing, true)).not.toThrow();
    expect(() => saveEventsScope(undefined, "all")).not.toThrow();
    expect(() => saveRefineOpen(undefined, true)).not.toThrow();
    const data = new Map<string, string>();
    const mem = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
    saveEventsScope(mem, "all");
    saveRefineOpen(mem, true);
    expect(loadEventsScope(mem)).toBe("all");
    expect(loadRefineOpen(mem)).toBe(true);
    saveRefineOpen(mem, false);
    expect(loadRefineOpen(mem)).toBe(false);
  });
});
