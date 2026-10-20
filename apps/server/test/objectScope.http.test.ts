import { TIME_MAX, TIME_MIN } from "@kipscope/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Scope, SourceAdapter } from "../src/datasource.ts";
import { closeApps, stateOf, unlink, unlinked } from "./caseApp.ts";
import { at, c4, SCOPE_AT, scopeOfCall } from "./caseKit.ts";
import { codeOf, scopeApp } from "./scopeApp.ts";
import { testClient, testSource } from "./testdb.ts";

afterEach(async () => {
  vi.useRealTimers();
  await closeApps();
});

/** Rows of testcar and the first and last time, straight from the test DB (design T). */
async function testcarFacts() {
  const query = async (sql: string) =>
    (await (await testClient().query({ query: sql, format: "TabSeparated" })).text()).trim();
  const [first, last] = (
    await query(
      "SELECT toUnixTimestamp64Nano(min(utc)), toUnixTimestamp64Nano(max(utc)) FROM sdlog.signals WHERE vehicle = 'testcar'",
    )
  ).split("\t");
  const rowsIn = async (from?: string, to?: string) =>
    Number(
      await query(
        `SELECT count() FROM sdlog.signals WHERE vehicle = 'testcar' AND utc IS NOT NULL ${
          from
            ? `AND utc >= toDateTime64('${from}', 3, 'UTC') AND utc < toDateTime64('${to}', 3, 'UTC')`
            : ""
        }`,
      ),
    );
  return {
    first: BigInt(first as string),
    // The scope ends one nanosecond after the last row.
    end: BigInt(last as string) + 1n,
    rowsIn,
  };
}

const isExtentCall = (call: { method: string; args: unknown[] }) =>
  call.method === "refExtent" &&
  (call.args[1] as Scope | undefined)?.from === TIME_MIN &&
  (call.args[1] as Scope | undefined)?.to === TIME_MAX;

describe("an object scope (add-case-open)", () => {
  it("unlinks to the vehicle's extent with one extent query", async () => {
    const facts = await testcarFacts();
    const { t, id, calls } = await unlinked();
    await t.anon.command({ type: "window.create", from: at(1, 2), to: at(1, 4) }, id);
    const mark = calls.length;

    await unlink(t.anon, id);
    const { workspace } = await stateOf(t.anon, id);
    expect(workspace.scope).toEqual({
      dataRef: "testcar",
      from: facts.first.toString(),
      to: facts.end.toString(),
      object: true,
    });
    // The window is unchanged, and Link remembers it as offsets from the alignment point 01:00:00.
    expect(workspace.windows[0].range).toEqual({ from: at(1, 2), to: at(1, 4) });
    expect(workspace.case.linked).toBe(false);
    expect(workspace.case.linkedRanges).toEqual({
      w1: { from: "120000000000", to: "240000000000" },
    });
    const extents = calls.slice(mark).filter(isExtentCall);
    expect(extents).toHaveLength(1);
    expect(extents[0]?.args[0]).toBe("testcar");
    expect(extents[0]?.args[1]).toEqual({ dataRef: "testcar", from: TIME_MIN, to: TIME_MAX });

    // Extent cached: link and unlink again, and another workspace unlinks on testcar.
    const linked = await t.anon.command({ type: "case.go", index: 0 }, id);
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);
    await unlink(t.anon, id);
    const other = (await t.anon.post("/api/workspaces", { open: { cases: c4() } })).body.workspace
      .id as string;
    await unlink(t.anon, other);
    expect(calls.slice(mark).filter(isExtentCall)).toHaveLength(1);
  });

  it("unlinks and reads the strip in full mode as well", async () => {
    const facts = await testcarFacts();
    const { t, id, calls } = await unlinked({ mode: "full" });
    const mark = calls.length;
    await unlink(t.anon, id);
    const { workspace } = await stateOf(t.anon, id);
    expect(workspace.scope).toEqual({
      dataRef: "testcar",
      from: facts.first.toString(),
      to: facts.end.toString(),
      object: true,
    });
    expect(calls.slice(mark).filter(isExtentCall)).toHaveLength(1);
    const coarse = await t.anon.get(`/api/w/${id}/density?dataRef=testcar`);
    expect(coarse.status, JSON.stringify(coarse.body)).toBe(200);
    expect(coarse.body.coarse).toBe(true);
    expect(coarse.body.drives).toEqual([]);
    const day = "from=2026-10-01T00:00:00Z&to=2026-10-02T00:00:00Z";
    for (const route of ["gaps", "events"]) {
      const asked = await t.anon.get(`/api/w/${id}/${route}?dataRef=testcar&${day}`);
      expect(asked.status, `${route}: ${JSON.stringify(asked.body)}`).toBe(200);
      const without = await t.anon.get(`/api/w/${id}/${route}?dataRef=testcar`);
      expect(without.status, route).toBe(400);
    }
  });

  it("answers a coarse density over the whole vehicle", async () => {
    const facts = await testcarFacts();
    const { t, id, calls } = await unlinked();
    await unlink(t.anon, id);
    const mark = calls.length;
    const ask = () => t.anon.get(`/api/w/${id}/density?dataRef=testcar`);
    const [one, two] = [await ask(), await ask()];
    for (const answer of [one, two]) {
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      expect(answer.body.coarse).toBe(true);
      expect(answer.body.drives).toEqual([]);
      expect(answer.body.first).toBe(facts.first.toString());
      expect(answer.body.last).toBe((facts.end - 1n).toString());
      expect(answer.body.counts.length).toBeLessThanOrEqual(120);
      const sum = (answer.body.counts as number[]).reduce((a, b) => a + b, 0);
      expect(sum).toBe(await facts.rowsIn());
    }
    expect(two.text).toBe(one.text);
    // One bucket query at the bar width and no grid query, however often it is asked.
    const buckets = calls.slice(mark).filter((c) => c.method === "refBuckets");
    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.args[0]).toBe("testcar");
    expect(buckets[0]?.args[1]).toBe(BigInt(one.body.width));
  });

  it("answers a detail density for a work window", async () => {
    const facts = await testcarFacts();
    const { t, id, calls } = await unlinked();
    await unlink(t.anon, id);
    const day = "from=2026-10-01T00:00:00Z&to=2026-10-02T00:00:00Z";
    const wholeDay = await t.anon.get(`/api/w/${id}/density?dataRef=testcar&${day}`);
    expect(wholeDay.status, JSON.stringify(wholeDay.body)).toBe(200);
    expect(wholeDay.body.coarse).toBeUndefined();
    expect((wholeDay.body.counts as number[]).reduce((a, b) => a + b, 0)).toBe(
      await facts.rowsIn(),
    );
    for (const drive of wholeDay.body.drives as { from: string; to: string }[]) {
      expect(BigInt(drive.from) >= BigInt(at(0, 0))).toBe(true);
      expect(BigInt(drive.to) <= BigInt(at(24, 0))).toBe(true);
    }

    // An hour inside the vehicle: counts over that hour only, cached per window.
    const hour = "from=2026-10-01T01:00:00Z&to=2026-10-01T02:00:00Z";
    const mark = calls.length;
    const first = await t.anon.get(`/api/w/${id}/density?dataRef=testcar&${hour}`);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.coarse).toBeUndefined();
    expect(first.body.first).toBe(at(1, 0));
    expect(BigInt(first.body.last) < BigInt(at(2, 0))).toBe(true);
    expect((first.body.counts as number[]).reduce((a, b) => a + b, 0)).toBe(
      await facts.rowsIn("2026-10-01 01:00:00", "2026-10-01 02:00:00"),
    );
    const queries = calls.slice(mark).filter((c) => c.method === "refBuckets").length;
    expect(queries).toBeGreaterThan(0);
    const again = await t.anon.get(`/api/w/${id}/density?dataRef=testcar&${hour}`);
    expect(again.text).toBe(first.text);
    expect(calls.slice(mark).filter((c) => c.method === "refBuckets")).toHaveLength(queries);
    // Every bucket query carried a scope inside the asked window.
    for (const call of calls.slice(mark).filter((c) => c.method === "refBuckets")) {
      const scope = scopeOfCall(call) as Scope;
      expect(scope.from >= BigInt(at(1, 0)) && scope.to <= BigInt(at(2, 0))).toBe(true);
    }
  });

  it("needs a work window for gaps and events in an object scope", async () => {
    const { t, id, calls } = await unlinked();
    await unlink(t.anon, id);
    const base = `/api/w/${id}`;
    for (const route of ["gaps", "events"]) {
      for (const query of ["", "&from=2026-09-01T00:00:00Z&to=2026-10-11T00:00:00Z"]) {
        const refused = await t.anon.get(`${base}/${route}?dataRef=testcar${query}`);
        expect(refused.status, `${route}${query}`).toBe(400);
        expect(codeOf(refused.body)).toBe("invalid_request");
      }
    }
    const day = "from=2026-10-01T00:00:00Z&to=2026-10-02T00:00:00Z";
    const mark = calls.length;
    const gaps = await t.anon.get(`${base}/gaps?dataRef=testcar&${day}`);
    const events = await t.anon.get(`${base}/events?dataRef=testcar&${day}`);
    expect(gaps.status, JSON.stringify(gaps.body)).toBe(200);
    expect(events.status, JSON.stringify(events.body)).toBe(200);

    // The same answer as a linked scope of that day.
    const linked = await scopeApp({ adapter: testSource(), dbc: true });
    try {
      const set = await linked.command({
        type: "scope.set",
        dataRef: "testcar",
        from: "2026-10-01T00:00:00Z",
        to: "2026-10-02T00:00:00Z",
      });
      expect(set.status).toBe(200);
      const gapsRef = await linked.get("/api/gaps?dataRef=testcar");
      const eventsRef = await linked.get("/api/events?dataRef=testcar");
      expect(gaps.body.logger).toEqual(gapsRef.body.logger);
      expect(events.body.events).toEqual(eventsRef.body.events);
      expect(events.body.total).toBe(eventsRef.body.total);
    } finally {
      await linked.close();
    }

    // Every source call carried a scope inside that day.
    const dayFrom = BigInt(at(0, 0));
    const dayTo = BigInt(at(24, 0));
    const read = calls
      .slice(mark)
      .filter((c) => ["loggerGaps", "firstTimes", "events", "stateChanges"].includes(c.method));
    expect(read.length).toBeGreaterThan(0);
    for (const call of read) {
      const scope = scopeOfCall(call) as Scope;
      expect(scope, call.method).toBeDefined();
      expect(scope.from >= dayFrom && scope.to <= dayTo, call.method).toBe(true);
    }
  });

  it("loads the object's signal list lazily", async () => {
    const facts = await testcarFacts();
    const real = testSource();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The vehicle's own list is the one whose scope is the object scope.
    const held = new Proxy(real, {
      get(target, key, receiver) {
        const member = Reflect.get(target, key, receiver);
        if (key !== "listSignals")
          return typeof member === "function" ? member.bind(target) : member;
        return async (scope?: Scope, abort?: AbortSignal) => {
          if (scope && scope.from === facts.first && scope.to === facts.end) await gate;
          return target.listSignals(scope, abort);
        };
      },
    });
    const { t, id, log } = await unlinked({ adapter: held as unknown as SourceAdapter });
    const unlinkedAt = Date.now();
    await unlink(t.anon, id);
    // Unlink did not wait for the list.
    expect(Date.now() - unlinkedAt).toBeLessThan(5000);

    const partial = await t.anon.get(`/api/w/${id}/catalog`);
    expect(partial.status, JSON.stringify(partial.body)).toBe(200);
    expect(partial.body.partial).toBe(true);
    const sessionIds = (partial.body.items as { id: string }[]).map((s) => s.id);
    expect(sessionIds.length).toBeGreaterThan(0);
    expect(sessionIds.every((s) => s.startsWith("testcar/"))).toBe(true);

    // The vehicle's list was asked in the background class.
    await vi.waitFor(() =>
      expect(
        log.some(
          (c) =>
            c.method === "listSignals" &&
            (c.args[0] as Scope | undefined)?.from === facts.first &&
            (c.args[0] as Scope | undefined)?.to === facts.end,
        ),
      ).toBe(true),
    );
    const vehicleList = log.find(
      (c) =>
        c.method === "listSignals" &&
        (c.args[0] as Scope | undefined)?.from === facts.first &&
        (c.args[0] as Scope | undefined)?.to === facts.end,
    );
    expect(vehicleList?.cls).toBe("background");

    release();
    await vi.waitFor(
      async () => {
        const full = await t.anon.get(`/api/w/${id}/catalog`);
        expect(full.status).toBe(200);
        expect(full.body.partial).toBeUndefined();
        expect(full.body.items.length).toBeGreaterThan(sessionIds.length);
        const all = new Set((full.body.items as { id: string }[]).map((s) => s.id));
        for (const known of sessionIds) expect(all.has(known)).toBe(true);
      },
      { timeout: 20_000, interval: 200 },
    );
  });

  it("sends no query without a data ref and a time range while unlinked", async () => {
    const { t, id, calls } = await unlinked();
    await unlink(t.anon, id);
    const { workspace } = await stateOf(t.anon, id);
    const scope = workspace.scope as { from: string; to: string };
    const day = "from=2026-10-01T00:00:00Z&to=2026-10-02T00:00:00Z";
    const base = `/api/w/${id}`;
    const urls = [
      "/density?dataRef=testcar",
      `/density?dataRef=testcar&${day}`,
      `/series?signal=testcar/Fast_100h.SIG_A&from=${scope.from}&to=${scope.to}`,
      `/gaps?dataRef=testcar&${day}`,
      `/events?dataRef=testcar&${day}`,
      "/catalog",
    ];
    for (const url of urls) {
      const answer = await t.anon.get(`${base}${url}`);
      expect(answer.status, `${url}: ${JSON.stringify(answer.body)}`).toBe(200);
    }
    // Let background work (the vehicle's list, prefetches) start and finish.
    let seen = -1;
    while (seen !== calls.length) {
      seen = calls.length;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const from = BigInt(scope.from);
    const to = BigInt(scope.to);
    let extents = 0;
    for (const call of calls) {
      if (call.method === "ping") continue;
      if (isExtentCall(call)) {
        extents++;
        continue;
      }
      if (["raw", "buckets", "count"].includes(call.method)) {
        const [ref, start, end] = call.args as [{ dataRef: string }, bigint, bigint];
        expect(ref.dataRef).toBe("testcar");
        expect(start >= from && end <= to, `${call.method} range`).toBe(true);
        continue;
      }
      expect(SCOPE_AT[call.method], `${call.method} is a scoped method`).toBeDefined();
      const given = scopeOfCall(call);
      expect(given, `${call.method} has a scope`).toBeDefined();
      expect(given?.dataRef).toBe("testcar");
    }
    expect(extents).toBeLessThanOrEqual(1);
  });
});
