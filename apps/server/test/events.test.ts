import {
  type EventRow,
  MAX_EVENTS,
  MAX_SIGNAL_CHANGES,
  type SignalInfo,
  type StateRow,
} from "@kipscope/shared";
import { describe, expect, it, vi } from "vitest";
import type { SeriesRef, StateChangeRule } from "../src/datasource.ts";
import { EventsCache } from "../src/events.ts";

const s = (n: number) => String(BigInt(n) * 1_000_000_000n);

/** A note row at second n of the data ref. */
const note = (n: number): EventRow => ({
  t: s(n),
  source: "VCU",
  kind: "note",
  name: `n${n}`,
  value: 0,
  text: "",
  detail: "",
});

const door: SignalInfo = {
  id: "testcar/DIAG.door",
  dataRef: "testcar",
  name: "DIAG.door",
  states: "text",
};

/** A fake catalog whose load time the test moves ("a catalog load"). */
function fakeCatalog(...infos: SignalInfo[]) {
  const catalog = {
    loadedAt: new Date(1_000) as Date | undefined,
    get: (id: string) => infos.find((i) => i.id === id),
    snaRanges: () => [] as { lo: number; hi: number }[],
    load: () => {
      catalog.loadedAt = new Date((catalog.loadedAt?.getTime() ?? 0) + 1_000);
    },
  };
  return catalog;
}

/** A fake source that counts its calls; `rowsOf` answers per data ref (undefined: no table). */
function fakeSource(
  rowsOf: (dataRef: string, limit: number) => EventRow[] | undefined = () => [],
  changesOf: (ref: SeriesRef, limit: number) => StateRow[] = () => [],
) {
  return {
    eventCalls: [] as { dataRef: string; limit: number }[],
    changeCalls: [] as { ref: SeriesRef; by: StateChangeRule; limit: number }[],
    eventsTable: "sdlog.events",
    async events(dataRef: string, limit: number) {
      this.eventCalls.push({ dataRef, limit });
      await Promise.resolve();
      return rowsOf(dataRef, limit);
    },
    async stateChanges(ref: SeriesRef, by: StateChangeRule, limit: number) {
      this.changeCalls.push({ ref, by, limit });
      await Promise.resolve();
      return changesOf(ref, limit);
    },
  };
}

describe("EventsCache", () => {
  it("caches per catalog load and prefetches", async () => {
    const source = fakeSource(
      () => [note(1)],
      () => [{ t: s(1), value: 0, text: "closed" }],
    );
    const catalog = fakeCatalog(door);
    const warn = vi.fn();
    const cache = new EventsCache(source, catalog, warn);

    // Two concurrent gets share one source call and one result.
    const [a, b] = await Promise.all([cache.table("testcar"), cache.table("testcar")]);
    expect(source.eventCalls).toHaveLength(1);
    expect(a).toBe(b);
    expect(a.events).toHaveLength(1);
    await cache.table("testcar");
    expect(source.eventCalls).toHaveLength(1);

    // A signal's changes are loaded once as well.
    await Promise.all([cache.signal(door.id), cache.signal(door.id)]);
    expect(source.changeCalls).toHaveLength(1);

    // A catalog load makes the next get load again.
    catalog.load();
    await cache.table("testcar");
    expect(source.eventCalls).toHaveLength(2);
    await cache.signal(door.id);
    expect(source.changeCalls).toHaveLength(2);

    // After the load the prefetch loads every data ref's table events and the listed signals.
    catalog.load();
    source.eventCalls.length = 0;
    source.changeCalls.length = 0;
    await cache.prefetch(["testcar", "othercar"], [door.id], warn);
    expect(source.eventCalls.map((c) => c.dataRef).sort()).toEqual(["othercar", "testcar"]);
    expect(source.changeCalls.map((c) => c.ref.name)).toEqual(["DIAG.door"]);
    // A later request finds everything cached.
    await cache.table("testcar");
    await cache.signal(door.id);
    expect(source.eventCalls).toHaveLength(2);
    expect(source.changeCalls).toHaveLength(1);

    // A failure rejects, is not cached and the retry calls the source again.
    catalog.load();
    let fail = true;
    const flaky = fakeSource(() => {
      if (fail) throw new Error("connect ECONNREFUSED");
      return [note(1)];
    });
    const retry = new EventsCache(flaky, catalog, warn);
    await expect(retry.table("testcar")).rejects.toThrow("ECONNREFUSED");
    fail = false;
    await expect(retry.table("testcar")).resolves.toMatchObject({ truncated: false });
    expect(flaky.eventCalls).toHaveLength(2);

    // A failing prefetch reports through warn and does not throw.
    const failing = new EventsCache(
      fakeSource(() => {
        throw new Error("boom");
      }),
      catalog,
      warn,
    );
    const prefetchWarn = vi.fn();
    await expect(failing.prefetch(["testcar"], [], prefetchWarn)).resolves.toBeUndefined();
    expect(prefetchWarn).toHaveBeenCalledTimes(1);
    expect(String(prefetchWarn.mock.calls[0]?.[0])).toContain("testcar");
  });

  it("warns once per catalog load about a missing table and waiting signals", async () => {
    const source = fakeSource(() => undefined);
    const catalog = fakeCatalog();
    const warn = vi.fn();
    const cache = new EventsCache(source, catalog, warn);

    // No table: no events, one warning naming the table, however often it is asked.
    expect((await cache.table("testcar")).events).toEqual([]);
    expect((await cache.table("othercar")).events).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("sdlog.events");

    // A signal not in the catalog waits, logged once per load.
    expect(await cache.signal("testcar/Later.X")).toBe("not_in_catalog");
    expect(await cache.signal("testcar/Later.X")).toBe("not_in_catalog");
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("testcar/Later.X"))).toHaveLength(1);

    // The next load warns again.
    catalog.load();
    await cache.table("testcar");
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("keeps the first 100,000 events", async () => {
    const rows = Array.from({ length: MAX_EVENTS + 1 }, (_, i) => note(i));
    const source = fakeSource((_, limit) => rows.slice(0, limit));
    const cache = new EventsCache(source, fakeCatalog(), vi.fn());
    const table = await cache.table("testcar");
    expect(MAX_EVENTS).toBe(100_000);
    // One row more than the cap is asked for, to tell a full table from a truncated one.
    expect(source.eventCalls[0]?.limit).toBe(MAX_EVENTS + 1);
    expect(table.truncated).toBe(true);
    expect(table.events).toHaveLength(MAX_EVENTS);
    expect(table.events[0]?.t).toBe(s(0));
    expect(table.events[MAX_EVENTS - 1]?.t).toBe(s(MAX_EVENTS - 1));

    // Exactly the cap is not truncated.
    const exact = new EventsCache(
      fakeSource((_, limit) => rows.slice(0, Math.min(limit, MAX_EVENTS))),
      fakeCatalog(),
      vi.fn(),
    );
    const full = await exact.table("testcar");
    expect(full.truncated).toBe(false);
    expect(full.events).toHaveLength(MAX_EVENTS);
  });

  it("skips a signal with more than 2,000 changes", async () => {
    // The first row plus n changes: texts alternate a, b, a, …
    const rowsFor = (changes: number): StateRow[] =>
      Array.from({ length: changes + 1 }, (_, i): StateRow => {
        const row: StateRow = { t: s(i * 10), value: 0, text: i % 2 === 0 ? "a" : "b" };
        if (i > 0) row.prev = { t: s((i - 1) * 10), value: 0, text: i % 2 === 0 ? "b" : "a" };
        return row;
      });
    const run = async (changes: number) => {
      const source = fakeSource(
        () => [],
        (_, limit) => rowsFor(changes).slice(0, limit),
      );
      const cache = new EventsCache(source, fakeCatalog(door), vi.fn());
      return { result: await cache.signal(door.id), source };
    };

    const over = await run(MAX_SIGNAL_CHANGES + 1);
    expect(MAX_SIGNAL_CHANGES).toBe(2_000);
    expect(over.result).toBe("too_many_changes");
    // The source is asked for at most MAX_SIGNAL_CHANGES + 2 rows (first row, changes, one more).
    expect(over.source.changeCalls[0]?.limit).toBe(MAX_SIGNAL_CHANGES + 2);
    expect(over.source.changeCalls[0]?.by).toEqual({ kind: "text" });

    // 2,000 changes are fine: the first row is a snapshot, the others changes.
    const ok = await run(MAX_SIGNAL_CHANGES);
    expect(Array.isArray(ok.result)).toBe(true);
    if (Array.isArray(ok.result)) {
      expect(ok.result).toHaveLength(MAX_SIGNAL_CHANGES + 1);
      expect(ok.result[0]?.category).toBe("snapshot");
      expect(ok.result[1]?.category).toBe("change");
    }
  });

  it("skips signals without states and ones the events table already holds", async () => {
    const plain: SignalInfo = {
      id: "testcar/Fast_100h.SIG_A",
      dataRef: "testcar",
      name: "Fast_100h.SIG_A",
    };
    const lock: SignalInfo = {
      id: "testcar/DIAG.lock",
      dataRef: "testcar",
      name: "DIAG.lock",
      states: "text",
    };
    const source = fakeSource(() => [
      {
        t: s(1),
        source: "VCU",
        kind: "state",
        name: "DIAG.lock",
        value: 0,
        text: "locked",
        detail: "initial",
      },
    ]);
    const cache = new EventsCache(source, fakeCatalog(plain, lock), vi.fn());
    expect(await cache.signal(plain.id)).toBe("no_states");
    expect(await cache.signal(lock.id)).toBe("in_events_table");
    // Neither asked the source for signal changes.
    expect(source.changeCalls).toHaveLength(0);
  });
});
