import {
  type EventRow,
  MAX_EVENTS,
  MAX_SIGNAL_CHANGES,
  type SignalInfo,
  type StateRow,
} from "@kipscope/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Scope, SeriesRef, StateChangeRule } from "../src/datasource.ts";
import { EventsCache } from "../src/events.ts";
import { closeApps, gated, quiet, unlink, unlinked } from "./caseApp.ts";
import { at, sameScope, scopeNs, scopeOfCall } from "./caseKit.ts";
import { scopeApp } from "./scopeApp.ts";
import { testSource } from "./testdb.ts";

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
    eventCalls: [] as { dataRef: string; limit: number; scope?: Scope | undefined }[],
    changeCalls: [] as {
      ref: SeriesRef;
      by: StateChangeRule;
      limit: number;
      scope?: Scope | undefined;
    }[],
    info: { kind: "clickhouse", database: "sdlog", table: "signals", eventsTable: "sdlog.events" },
    async events(dataRef: string, limit: number, scope?: Scope) {
      this.eventCalls.push({ dataRef, limit, scope });
      await Promise.resolve();
      return rowsOf(dataRef, limit);
    },
    async stateChanges(ref: SeriesRef, by: StateChangeRule, limit: number, scope?: Scope) {
      this.changeCalls.push({ ref, by, limit, scope });
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

describe("EventsCache with a scope (add-scope)", () => {
  // 2026-10-01T01:00:00Z and 02:00:00Z in ns, by hand.
  const scope: Scope = { dataRef: "testcar", from: 1790816400000000000n, to: 1790820000000000000n };

  it("loads table events and signal changes of a scope", async () => {
    const source = fakeSource(
      () => [note(1)],
      () => [{ t: s(1), value: 0, text: "closed" }],
    );
    const catalog = fakeCatalog(door);
    const cache = new EventsCache(source, catalog, vi.fn());
    const answers = await Promise.all([
      cache.table("testcar", scope),
      cache.signal(door.id, scope),
      cache.table("testcar", scope),
    ]);
    expect(Array.isArray((answers[1] as unknown[]) ?? [])).toBe(true);
    // The table load is shared and the signal's own load found it ("in the events table" check):
    // events and stateChanges were each called once, with the scope, and never without one.
    expect(source.eventCalls).toHaveLength(1);
    expect(source.changeCalls).toHaveLength(1);
    expect(source.eventCalls[0]?.scope).toEqual(scope);
    expect(source.changeCalls[0]?.scope).toEqual(scope);
    expect([...source.eventCalls, ...source.changeCalls].every((c) => c.scope !== undefined)).toBe(
      true,
    );

    // Cached per scope: the same scope loads nothing again, another scope loads again.
    await cache.table("testcar", scope);
    await cache.signal(door.id, scope);
    expect(source.eventCalls).toHaveLength(1);
    expect(source.changeCalls).toHaveLength(1);
    const narrower = { ...scope, to: scope.to - 60_000_000_000n };
    await cache.table("testcar", narrower);
    expect(source.eventCalls).toHaveLength(2);
    expect(source.eventCalls[1]?.scope).toEqual(narrower);

    // Without a scope the source is asked without one, as before.
    await cache.table("testcar");
    expect(source.eventCalls[2]?.scope).toBeUndefined();
  });
});

describe("EventsCache with a work window (add-case-open)", () => {
  afterEach(closeApps);

  it("loads the events of a work window", async () => {
    // The reference: the linked scope of the same hour.
    const reference = await scopeApp({ adapter: testSource(), dbc: true });
    let linked: { total: number; events: unknown[] };
    try {
      const set = await reference.command({
        type: "scope.set",
        dataRef: "testcar",
        from: "2026-10-01T01:00:00Z",
        to: "2026-10-01T02:00:00Z",
      });
      expect(set.status).toBe(200);
      const answer = await reference.get(
        "/api/events?dataRef=testcar&signal=testcar/Ign_A20h.MODE",
      );
      expect(answer.status).toBe(200);
      linked = answer.body;
    } finally {
      await reference.close();
    }

    const { t, id, calls } = await unlinked();
    // The scope prefetch of the linked session (queued when its list loaded) has run out before the
    // unlink, so every events call after the mark is the ask's own.
    await quiet(calls);
    await unlink(t.anon, id);
    const mark = calls.length;
    const ask = () =>
      t.anon.get(
        `/api/w/${id}/events?dataRef=testcar&signal=testcar/Ign_A20h.MODE&from=2026-10-01T01:00:00Z&to=2026-10-01T02:00:00Z`,
      );
    const [one, two] = [await ask(), await ask()];
    expect(one.status, JSON.stringify(one.body)).toBe(200);
    expect(two.text).toBe(one.text);
    // The same events as the linked scope of that hour.
    expect(one.body.total).toBe(linked.total);
    expect(one.body.events).toEqual(linked.events);

    // events and stateChanges: once each, with the window as their scope, never the whole object.
    const window = { dataRef: "testcar", from: 1790816400000000000n, to: 1790820000000000000n };
    const read = calls.slice(mark);
    for (const name of ["events", "stateChanges"]) {
      const named = read.filter((c) => c.method === name);
      expect(named, name).toHaveLength(1);
      expect(scopeOfCall(named[0] as (typeof read)[number]), name).toEqual(window);
    }
  });

  // The linked session of C4's entry 0 with its pad, 00:59:00 to 01:11:00 (by hand: 01:00:00 - 60 s,
  // 01:10:00 + 60 s).
  const session = scopeNs("testcar", at(0, 59), at(1, 11));
  const holdsSession = (method: string, args: unknown[]) =>
    method === "refBuckets" && sameScope(scopeOfCall({ method, args }), session);
  const eventCalls = (calls: readonly { method: string }[]) =>
    calls.filter((c) => c.method === "events" || c.method === "stateChanges");

  it("runs the session's events prefetch while the workspace stays linked", async () => {
    // The control of the next test: with the chain held at its first job and then released, the
    // linked session's table events are loaded with the session as their scope.
    const hold = gated(testSource(), holdsSession);
    const { t, id, calls } = await unlinked({ adapter: hold.adapter });
    const live = await (await t.anon.live(id)).connected();
    await vi.waitFor(() => expect(hold.held).toContain("refBuckets"));
    const mark = calls.length;
    hold.release();
    await quiet(calls);
    live.close();
    const events = calls.slice(mark).filter((c) => c.method === "events");
    expect(events.map((c) => scopeOfCall(c))).toEqual([session]);
  });

  it("does not load session events for a prefetch job that runs after the unlink", async () => {
    // Opening the catalog queues the session's density, gap and events prefetch behind one another
    // (chainPrefetch). The first job is held inside its source call; the workspace unlinks; then the
    // chain goes on. The events job starts after the unlink and must not call the source at all:
    // an unlinked workspace's events follow the asked work windows (K11).
    const hold = gated(testSource(), holdsSession);
    const { t, id, calls } = await unlinked({ adapter: hold.adapter });
    // A tab holds the workspace, as in use: the prefetch is for workspaces with a live client.
    const live = await (await t.anon.live(id)).connected();
    await vi.waitFor(() => expect(hold.held).toContain("refBuckets"));
    expect(eventCalls(calls)).toEqual([]);
    await unlink(t.anon, id);
    const mark = calls.length;
    hold.release();
    await quiet(calls);
    live.close();
    expect(eventCalls(calls.slice(mark))).toEqual([]);
    expect(eventCalls(calls)).toEqual([]);
  });

  describe("concurrent asks while the vehicle's list replaces the session's", () => {
    // 2026-10-01T01:00:00Z .. 02:00:00Z in ns, by hand (1790816400 s and 1790820000 s).
    const scope: Scope = {
      dataRef: "testcar",
      from: 1790816400000000000n,
      to: 1790820000000000000n,
    };
    const window: Scope = {
      dataRef: "testcar",
      from: 1790817000000000000n,
      to: 1790818800000000000n,
    };
    // The scope the cache keys the asks by; `object` marks the vehicle's own scope.
    const object = { ...scope, object: true as const };

    /** A source whose `events` waits for `release()`; counts its calls like fakeSource. */
    function heldSource() {
      const source = fakeSource(
        () => [note(1)],
        () => [{ t: s(1), value: 0, text: "closed" }],
      );
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const events = source.events.bind(source);
      source.events = async (dataRef, limit, sc) => {
        const rows = await events(dataRef, limit, sc);
        await gate;
        return rows;
      };
      return { source, release };
    }

    it("loads once when the first load is still running as the new list arrives", async () => {
      const { source, release } = heldSource();
      const catalog = fakeCatalog(door);
      const cache = new EventsCache(source, catalog, vi.fn());
      const first = cache.signal(door.id, object, window);
      await vi.waitFor(() => expect(source.eventCalls).toHaveLength(1));
      // The vehicle's own list replaces the session's: a new load time, the signal still in it.
      catalog.load();
      const second = cache.signal(door.id, object, window);
      release();
      const [a, b] = await Promise.all([first, second]);
      expect(Array.isArray(a) && Array.isArray(b)).toBe(true);
      expect(b).toEqual(a);
      // One table load and one change load, both with the window as their scope.
      expect(source.eventCalls).toHaveLength(1);
      expect(source.changeCalls).toHaveLength(1);
      expect(source.eventCalls[0]?.scope).toEqual({
        dataRef: "testcar",
        from: window.from,
        to: window.to,
      });
      expect(source.changeCalls[0]?.scope).toEqual({
        dataRef: "testcar",
        from: window.from,
        to: window.to,
      });
      // Settled, the same ask again finds it.
      await cache.signal(door.id, object, window);
      expect(source.eventCalls).toHaveLength(1);
      expect(source.changeCalls).toHaveLength(1);
    });

    it("asks the new list once when the first load did not find the signal in the old one", async () => {
      const source = fakeSource(
        () => [note(1)],
        () => [{ t: s(1), value: 0, text: "closed" }],
      );
      // The session's list lacks the signal; the vehicle's list has it.
      let vehicle = false;
      const catalog = {
        loadedAt: new Date(1_000) as Date | undefined,
        get: (id: string) => (vehicle && id === door.id ? door : undefined),
        snaRanges: () => [] as { lo: number; hi: number }[],
      };
      const cache = new EventsCache(source, catalog, vi.fn());
      const first = cache.signal(door.id, object, window);
      // The list arrives before the first load has answered.
      vehicle = true;
      catalog.loadedAt = new Date(2_000);
      const second = cache.signal(door.id, object, window);
      const found = await second;
      await first;
      expect(Array.isArray(found), String(found)).toBe(true);
      // Exactly one re-run against the new list: one table load and one change load, no more.
      expect(source.eventCalls).toHaveLength(1);
      expect(source.changeCalls).toHaveLength(1);
      await cache.signal(door.id, object, window);
      expect(source.eventCalls).toHaveLength(1);
      expect(source.changeCalls).toHaveLength(1);
    });
  });
});
