import { afterEach, describe, expect, it, vi } from "vitest";
import type { Scope } from "../src/datasource.ts";
import { pause, untilCounted } from "./calendarKit.ts";
import { closeApps, quiet, stateOf, unlink, unlinked } from "./caseApp.ts";
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

const DAY_NS = 86_400_000_000_000n;
/** The span of the catalog's testcar sessions with C4's pad of 60 s: 00:59:00 … 05:11:00. */
const SPAN = { dataRef: "testcar", from: at(0, 59), to: at(5, 11), object: true };

const nonPing = (calls: readonly { method: string }[]) => calls.filter((c) => c.method !== "ping");

describe("an object scope (add-case-open, speed-up-whole-scans)", () => {
  it("unlinks to the span of the catalog's sessions without a query", async () => {
    const { t, id, calls } = await unlinked();
    await t.anon.command({ type: "window.create", from: at(1, 2), to: at(1, 4) }, id);
    await quiet(calls);
    const mark = calls.length;

    await unlink(t.anon, id);
    // The source got no call between the command and its answer.
    expect(nonPing(calls.slice(mark))).toEqual([]);
    const { workspace } = await stateOf(t.anon, id);
    // Entries 0, 2 and 3 are on testcar (entry 1 on othercar): the earliest bound is entry 0's
    // 01:00:00 − 60 s, the latest entry 2's 05:10:00 + 60 s.
    expect(workspace.scope).toEqual(SPAN);
    // The window is unchanged, and Link remembers it as offsets from the alignment point 01:00:00.
    expect(workspace.windows[0].range).toEqual({ from: at(1, 2), to: at(1, 4) });
    expect(workspace.case.linked).toBe(false);
    expect(workspace.case.linkedRanges).toEqual({
      w1: { from: "120000000000", to: "240000000000" },
    });

    // Extent cached: link and unlink again, and another workspace unlinks on testcar. No
    // extent query is made at all, and both scopes are equal.
    const linked = await t.anon.command({ type: "case.go", index: 0 }, id);
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);
    await unlink(t.anon, id);
    const other = (await t.anon.post("/api/workspaces", { open: { cases: c4() } })).body.workspace
      .id as string;
    await unlink(t.anon, other);
    expect((await stateOf(t.anon, other)).workspace.scope).toEqual(SPAN);
    expect((await stateOf(t.anon, id)).workspace.scope).toEqual(SPAN);
    expect(calls.filter((c) => c.method === "refExtent")).toEqual([]);
  });

  it("unlinks and reads the strip in full mode as well", async () => {
    const { t, id, calls } = await unlinked({ mode: "full" });
    const mark = calls.length;
    await unlink(t.anon, id);
    const { workspace } = await stateOf(t.anon, id);
    expect(workspace.scope).toEqual(SPAN);
    expect(calls.slice(mark).filter((c) => c.method === "refExtent")).toEqual([]);
    // No coarse density: a density without from and to is a 400 in an object scope.
    const coarse = await t.anon.get(`/api/w/${id}/density?dataRef=testcar`);
    expect(coarse.status, JSON.stringify(coarse.body)).toBe(400);
    expect(codeOf(coarse.body)).toBe("invalid_request");
    const day = "from=2026-10-01T00:00:00Z&to=2026-10-02T00:00:00Z";
    for (const route of ["gaps", "events"]) {
      const asked = await t.anon.get(`/api/w/${id}/${route}?dataRef=testcar&${day}`);
      expect(asked.status, `${route}: ${JSON.stringify(asked.body)}`).toBe(200);
      const without = await t.anon.get(`/api/w/${id}/${route}?dataRef=testcar`);
      expect(without.status, route).toBe(400);
    }
  });

  it("answers a detail density for a work window", async () => {
    const facts = await testcarFacts();
    const { t, id, calls } = await unlinked();
    await unlink(t.anon, id);
    const day = "from=2026-10-01T00:00:00Z&to=2026-10-02T00:00:00Z";
    const wholeDay = await t.anon.get(`/api/w/${id}/density?dataRef=testcar&${day}`);
    expect(wholeDay.status, JSON.stringify(wholeDay.body)).toBe(200);
    expect(wholeDay.body.coarse).toBeUndefined();
    // The window is cut to the object scope (00:59:00 … 05:11:00 of that day): counts over that
    // part of the day only, drives inside it.
    expect(wholeDay.body.first).toBe(at(0, 59));
    expect(BigInt(wholeDay.body.last)).toBe(BigInt(at(5, 11)) - 1n);
    expect((wholeDay.body.counts as number[]).reduce((a, b) => a + b, 0)).toBe(
      await facts.rowsIn("2026-10-01 00:59:00", "2026-10-01 05:11:00"),
    );
    expect(wholeDay.body.drives.length).toBeGreaterThan(0);
    for (const drive of wholeDay.body.drives as { from: string; to: string }[]) {
      expect(BigInt(drive.from) >= BigInt(at(0, 59))).toBe(true);
      expect(BigInt(drive.to) <= BigInt(at(5, 11))).toBe(true);
    }

    // Without from and to: 400, never a coarse density.
    const bare = await t.anon.get(`/api/w/${id}/density?dataRef=testcar`);
    expect(bare.status).toBe(400);
    expect(codeOf(bare.body)).toBe("invalid_request");
    expect(bare.body.error.message).toBe(
      "from and to are required in an object scope (the work window)",
    );
    const lone = await t.anon.get(`/api/w/${id}/density?dataRef=testcar&from=2026-10-01T00:00:00Z`);
    expect(lone.status).toBe(400);

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
    expect(calls.slice(mark).filter((c) => c.method === "refExtent")).toEqual([]);
  });

  it("answers the calendar of a month while unlinked", async () => {
    const facts = await testcarFacts();
    const { t, id, calls } = await unlinked();
    await unlink(t.anon, id);
    const { workspace } = await stateOf(t.anon, id);
    // M10 = local October 2026 (TZ=Europe/Berlin): 2026-09-30T22:00:00Z .. 2026-10-31T23:00:00Z.
    const M10_FROM = 1790805600n * 1_000_000_000n;
    const M10_TO = 1793487600n * 1_000_000_000n;
    const month = "from=2026-09-30T22:00:00Z&to=2026-10-31T23:00:00Z";
    const url = `/api/w/${id}/calendar?dataRef=testcar&${month}`;

    // The vehicle-days of M10 are counted (at idle, in the background); asked until none is left.
    const answer = await untilCounted(() => t.anon.get(url), pause);
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(answer.body.pending).toBeUndefined();
    // The scope of the answer is the object scope.
    expect(answer.body.scope).toEqual({ from: workspace.scope.from, to: workspace.scope.to });
    expect(answer.body.scope).toEqual({ from: SPAN.from, to: SPAN.to });
    const hours = answer.body.hours as number[];
    expect(hours).toHaveLength(745);
    expect(hours.reduce((a, b) => a + b, 0)).toBe(
      await facts.rowsIn("2026-10-01 00:59:00", "2026-10-01 05:11:00"),
    );
    // 00:00Z of 2026-10-01 is hour 2 of M10 (22:00Z + 2 h) and 05:00Z hour 7: rows only there.
    expect(hours.slice(0, 2).every((n) => n === 0)).toBe(true);
    expect(hours.slice(8).every((n) => n === 0)).toBe(true);
    expect(hours[2]).toBeGreaterThan(0);

    // The same hours and drives as a plain scope of the object scope's bounds.
    const plain = await scopeApp({ adapter: testSource() });
    try {
      const set = await plain.command({
        type: "scope.set",
        dataRef: "testcar",
        from: SPAN.from,
        to: SPAN.to,
      });
      expect(set.status, JSON.stringify(set.body)).toBe(200);
      const ref = await plain.get(`/api/calendar?dataRef=testcar&${month}`);
      expect(ref.status, JSON.stringify(ref.body)).toBe(200);
      expect(answer.body.hours).toEqual(ref.body.hours);
      expect(answer.body.drives).toEqual(ref.body.drives);
    } finally {
      await plain.close();
    }

    // Once counted, a request makes no source call, and only days inside M10 were ever counted.
    await quiet(calls);
    const mark = calls.length;
    const again = await t.anon.get(url);
    expect(again.status).toBe(200);
    expect(again.body.pending).toBeUndefined();
    expect(nonPing(calls.slice(mark))).toEqual([]);
    expect(calls.filter((c) => c.method === "refExtent")).toEqual([]);
    for (const call of calls.filter(
      (c) => c.method === "refBuckets" && c.args[1] === 60_000_000_000n,
    )) {
      const scope = scopeOfCall(call) as Scope;
      expect(scope.to - scope.from).toBeLessThanOrEqual(DAY_NS);
      expect(scope.from >= M10_FROM - DAY_NS && scope.to <= M10_TO + DAY_NS).toBe(true);
    }

    // The 32-day rule holds here too.
    const wide = await t.anon.get(
      `/api/w/${id}/calendar?dataRef=testcar&from=2026-09-30T22:00:00Z&to=2026-11-02T22:00:00Z`,
    );
    expect(wide.status).toBe(400);
    expect(codeOf(wide.body)).toBe("invalid_request");
  });

  it("needs a bounded work window for gaps and events in an object scope", async () => {
    const { t, id, calls } = await unlinked();
    await unlink(t.anon, id);
    const base = `/api/w/${id}`;
    for (const route of ["gaps", "events"]) {
      // Without a range: 400.
      const bare = await t.anon.get(`${base}/${route}?dataRef=testcar`);
      expect(bare.status, route).toBe(400);
      expect(codeOf(bare.body)).toBe("invalid_request");
      // A 10-day range: 422 too_wide (the span is over 7 d), with no source call.
      const mark10 = calls.length;
      const wide = await t.anon.get(
        `${base}/${route}?dataRef=testcar&from=2026-10-01T00:00:00Z&to=2026-10-11T00:00:00Z`,
      );
      expect(wide.status, `${route}: ${JSON.stringify(wide.body)}`).toBe(422);
      expect(codeOf(wide.body)).toBe("too_wide");
      expect(wide.body.error.span).toBe((10n * DAY_NS).toString());
      expect(wide.body.error.maxSpan).toBe((7n * DAY_NS).toString());
      expect(
        calls
          .slice(mark10)
          .filter((c) => ["loggerGaps", "firstTimes", "events", "stateChanges"].includes(c.method)),
      ).toEqual([]);
    }
    const day = "from=2026-10-01T00:00:00Z&to=2026-10-02T00:00:00Z";
    const mark = calls.length;
    const gaps = await t.anon.get(`${base}/gaps?dataRef=testcar&${day}`);
    const events = await t.anon.get(`${base}/events?dataRef=testcar&${day}`);
    expect(gaps.status, JSON.stringify(gaps.body)).toBe(200);
    expect(events.status, JSON.stringify(events.body)).toBe(200);

    // The same answer as a linked scope of that range (the day cut to the object scope).
    const linked = await scopeApp({ adapter: testSource(), dbc: true });
    try {
      const set = await linked.command({
        type: "scope.set",
        dataRef: "testcar",
        from: SPAN.from,
        to: SPAN.to,
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

  it("keeps the session's signal list while unlinked", async () => {
    const { t, id, calls } = await unlinked();
    // The linked session's own list, as the catalog route answers it before Unlink.
    const linkedList = await t.anon.get(`/api/w/${id}/catalog`);
    expect(linkedList.status, JSON.stringify(linkedList.body)).toBe(200);
    const sessionIds = (linkedList.body.items as { id: string }[]).map((item) => item.id);
    expect(sessionIds.length).toBeGreaterThan(0);
    await quiet(calls);

    await unlink(t.anon, id);
    const mark = calls.length;
    const read = async () => {
      const answer = await t.anon.get(`/api/w/${id}/catalog`);
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      expect(answer.body.partial).toBe(true);
      expect((answer.body.items as { id: string }[]).map((item) => item.id)).toEqual(sessionIds);
    };
    await read();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await read();
    // /api/signals answers from the same list.
    const signals = await t.anon.get(`/api/w/${id}/signals?q=sig`);
    expect(signals.status, JSON.stringify(signals.body)).toBe(200);
    // The source got no listSignals call after the unlink.
    expect(calls.slice(mark).filter((c) => c.method === "listSignals")).toEqual([]);
  });

  it("sends no query over the whole vehicle while unlinked", async () => {
    const { t, id, calls } = await unlinked();
    await unlink(t.anon, id);
    const mark = calls.length;
    const base = `/api/w/${id}`;
    const day = "from=2026-10-01T00:00:00Z&to=2026-10-02T00:00:00Z";
    const hour = `from=${at(1, 0)}&to=${at(2, 0)}`;
    const urls = [
      `/density?dataRef=testcar&${day}`,
      `/series?signal=testcar/Fast_100h.SIG_A&${hour}`,
      `/gaps?dataRef=testcar&${day}`,
      `/events?dataRef=testcar&${day}`,
      "/catalog",
    ];
    for (const url of urls) {
      const answer = await t.anon.get(`${base}${url}`);
      expect(answer.status, `${url}: ${JSON.stringify(answer.body)}`).toBe(200);
    }
    // Let background work (prefetches) start and finish.
    await quiet(calls, 500);

    const from = BigInt(SPAN.from);
    const to = BigInt(SPAN.to);
    for (const call of calls.slice(mark)) {
      if (call.method === "ping") continue;
      // No extent query and no signal list over the object scope.
      expect(call.method, "no refExtent while unlinked").not.toBe("refExtent");
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
      // No scope wider than the scan bound's 7 d, and none over the whole object scope.
      expect(
        (given as Scope).to - (given as Scope).from,
        `${call.method} span`,
      ).toBeLessThanOrEqual(7n * DAY_NS);
      if (call.method === "listSignals") {
        expect(
          given?.from === from && given?.to === to,
          "no listSignals over the object scope",
        ).toBe(false);
      }
    }
  });
});
