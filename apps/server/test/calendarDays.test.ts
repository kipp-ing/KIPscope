/**
 * The vehicle-day store (speed-up-whole-scans B6, range-picker "Calendar days counted at the
 * lowest priority", "Calendar days kept across restarts", "Calendar days filled ahead"): through
 * the whole server on the in-memory adapter, with a fake clock where the scenario moves time and a
 * temp state directory that a "restart" reuses. Day starts are by hand (2026-10-01T00:00Z =
 * 1790812800 s).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calendarUrl,
  DAY,
  dayNs,
  HOUR,
  OCT1,
  OCT2,
  S,
  settle,
  TESTCAR_ROWS,
  untilCounted,
  WIDTH_60S,
} from "./calendarKit.ts";
import { classRecording } from "./caseKit.ts";
import { memoryAdapter, type ScopeApp, scopeApp } from "./scopeApp.ts";

const apps: ScopeApp[] = [];
const dirs: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(apps.splice(0).map((a) => a.close()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "kipscope-days-"));
  dirs.push(dir);
  return dir;
};

/** A workspace window on testcar, so the workspace "uses" the data ref (fill ahead, rechecks). */
async function addWindow(t: ScopeApp, from: string, to: string) {
  const created = await t.command({ type: "window.create", from, to });
  expect(created.status, JSON.stringify(created.body)).toBe(200);
  const added = await t.command({
    type: "window.addSignal",
    windowId: "w1",
    signalId: "testcar/S",
  });
  expect(added.status, JSON.stringify(added.body)).toBe(200);
}

/** The day-count calls (60 s `refBuckets`) the adapter got for the UTC day starting at `day`. */
function countsOf(log: { method: string; args: unknown[]; cls: string }[], day: bigint) {
  return log.filter((c) => {
    if (c.method !== "refBuckets" || c.args[1] !== WIDTH_60S) return false;
    const scope = c.args[3] as { from: bigint; to: bigint } | undefined;
    return scope !== undefined && scope.from >= day && scope.to <= day + DAY;
  });
}

describe("CalendarDays", () => {
  it("keeps final days across a restart and rechecks today", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
    const stateDir = tempDir();
    const window = [calendarUrl("2026-10-01T00:00:00Z", "2026-10-03T00:00:00Z")] as const;

    // First server: counts both days (the open workspace has a window on testcar).
    const first = classRecording(memoryAdapter(TESTCAR_ROWS));
    const t1 = await scopeApp({ adapter: first.adapter, stateDir });
    await addWindow(t1, "2026-10-02T10:00:00Z", "2026-10-02T11:00:00Z");
    const counted = await untilCounted(() => t1.get(window[0]), settle);
    expect(counted.body.hours[1]).toBe(3);
    expect(counted.body.hours[26]).toBe(2);
    expect(countsOf(first.log, OCT1).length).toBeGreaterThan(0);
    // The file is written at most once per 10 s per data ref: let that pass, then stop.
    await vi.advanceTimersByTimeAsync(11_000);
    await t1.close();
    apps.splice(apps.indexOf(t1), 1);

    // Second server on the same state directory, 10 min later, the same workspace open.
    vi.setSystemTime(new Date("2026-10-02T12:10:00Z"));
    const second = classRecording(memoryAdapter(TESTCAR_ROWS));
    const t2 = await scopeApp({ adapter: second.adapter, stateDir });
    apps.push(t2);
    await addWindow(t2, "2026-10-02T10:00:00Z", "2026-10-02T11:00:00Z");
    const mark = second.log.length;
    const answer = await t2.get(window[0]);
    // Both days come from the file: no `pending`, the same counts.
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(answer.body.pending).toBeUndefined();
    expect(answer.body.hours[1]).toBe(3);
    expect(answer.body.hours[26]).toBe(2);
    // The answer did not wait for a source call of these two days.
    expect(countsOf(second.log.slice(mark), OCT1)).toEqual([]);

    // Today (2026-10-02) was counted 10 min ago, so it is counted again once soon after the start
    // ... and 2026-10-01, final, never.
    await vi.advanceTimersByTimeAsync(1_000);
    await settle();
    expect(countsOf(second.log, OCT1)).toEqual([]);
    const today = () => countsOf(second.log, OCT2);
    expect(today()).toHaveLength(1);
    expect(today()[0]?.cls).toBe("idle");

    // Not again before 12:15: at most one count per 5 min.
    await vi.advanceTimersByTimeAsync(4 * 60_000 + 29_000); // 12:14:30
    await settle();
    expect(today()).toHaveLength(1);

    // After 12:15 it is counted once more (the clock is at 12:19:30), still idle, and 2026-10-01
    // still never.
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await settle();
    expect(today()).toHaveLength(2);
    expect(today().every((c) => c.cls === "idle")).toBe(true);
    expect(countsOf(second.log, OCT1)).toEqual([]);
  });

  it("ignores a day file of another source", async () => {
    const stateDir = tempDir();
    const folder = join(stateDir, "calendar");
    mkdirSync(folder, { recursive: true });
    // Written for table `other`, claiming 999 rows in 2026-10-01 00:05.
    const file = join(folder, "testcar.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        source: { kind: "memory", database: "mem", table: "other" },
        grid: WIDTH_60S.toString(),
        days: {
          [OCT1.toString()]: {
            countedAt: (OCT1 + DAY).toString(),
            final: true,
            buckets: [[(OCT1 + 5n * 60n * S).toString(), 999]],
          },
        },
      }),
    );
    const t = await scopeApp({ adapter: memoryAdapter(TESTCAR_ROWS), stateDir });
    apps.push(t);
    const url = calendarUrl("2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z");
    // The first answer does not know the day: it is pending, and the 999 rows are not shown.
    const first = await t.get(url);
    expect(first.status).toBe(200);
    expect(first.body.pending).toEqual([{ from: OCT1.toString(), to: OCT2.toString() }]);
    expect(first.body.hours[0]).toBe(0);
    // It counts the day again from the source: the real rows.
    const done = await untilCounted(() => t.get(url));
    expect(done.body.hours[0]).toBe(0);
    expect(done.body.hours[1]).toBe(3);
    // One log line, naming the file.
    expect(t.warnings).toHaveLength(1);
    expect(t.warnings[0]).toContain("testcar.json");
  });

  it("ignores a day file that does not parse", async () => {
    const stateDir = tempDir();
    const folder = join(stateDir, "calendar");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "testcar.json"), "{ not json");
    const t = await scopeApp({ adapter: memoryAdapter(TESTCAR_ROWS), stateDir });
    apps.push(t);
    const url = calendarUrl("2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z");
    const done = await untilCounted(() => t.get(url));
    expect(done.body.hours[1]).toBe(3);
    expect(t.warnings).toHaveLength(1);
    expect(t.warnings[0]).toContain("testcar.json");
  });

  it("fills the shown months ahead for open workspaces", async () => {
    // A stub that records the day counts in order and how many ran at once.
    const order: bigint[] = [];
    let running = 0;
    let peak = 0;
    const inner = classRecording(memoryAdapter(TESTCAR_ROWS));
    const adapter = new Proxy(inner.adapter, {
      get(target, key, receiver) {
        const member = Reflect.get(target, key, receiver);
        if (key !== "refBuckets" || typeof member !== "function") return member;
        return async (...args: unknown[]) => {
          const scope = args[3] as { from: bigint } | undefined;
          if (args[1] === WIDTH_60S && scope) {
            order.push(scope.from);
            running++;
            peak = Math.max(peak, running);
          }
          try {
            await new Promise((resolve) => setImmediate(resolve));
            return await member.apply(target, args);
          } finally {
            if (args[1] === WIDTH_60S && scope) running--;
          }
        };
      },
    });

    const t = await scopeApp({ adapter: adapter });
    apps.push(t);
    // A window on testcar at 2026-10-01 01:00-02:00Z; no calendar request follows.
    await addWindow(t, "2026-10-01T01:00:00Z", "2026-10-01T02:00:00Z");
    const first = dayNs("2026-08-31");
    const last = dayNs("2026-11-01");
    const days = Number((last - first) / DAY) + 1; // 63
    await vi.waitFor(
      () => {
        const dayStarts = new Set(order.map((from) => from - (from % DAY)));
        expect(dayStarts.size).toBeGreaterThanOrEqual(days);
      },
      { timeout: 15_000, interval: 25 },
    );

    // Every UTC day from 2026-08-31 to 2026-11-01, newest first, one at a time, in idle.
    const dayOf = (from: bigint) => from - (from % DAY);
    const seen: bigint[] = [];
    for (const from of order) {
      const day = dayOf(from);
      if (seen[seen.length - 1] !== day) seen.push(day);
    }
    const expected: bigint[] = [];
    for (let d = last; d >= first; d -= DAY) expected.push(d);
    expect(seen.slice(0, days)).toEqual(expected);
    expect(peak).toBe(1);
    expect(
      inner.log.filter((c) => c.method === "refBuckets" && c.args[1] === WIDTH_60S),
    ).not.toHaveLength(0);
    expect(
      inner.log
        .filter((c) => c.method === "refBuckets" && c.args[1] === WIDTH_60S)
        .every((c) => c.cls === "idle"),
    ).toBe(true);
  });

  it("counts a requested month before the rest of the fill", async () => {
    // The fill goes newest first; asking for September (an older month than October) shows that
    // the requested days jump the queue. A gate holds the first day count until the request is in.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const order: bigint[] = [];
    let gated = false;
    const base = memoryAdapter(TESTCAR_ROWS);
    const adapter = new Proxy(base, {
      get(target, key, receiver) {
        const member = Reflect.get(target, key, receiver);
        if (key !== "refBuckets" || typeof member !== "function") return member;
        return async (...args: unknown[]) => {
          const scope = args[3] as { from: bigint } | undefined;
          if (args[1] === WIDTH_60S && scope) {
            order.push(scope.from - (scope.from % DAY));
            if (!gated) {
              gated = true;
              await gate;
            }
          }
          return member.apply(target, args);
        };
      },
    });
    const t = await scopeApp({ adapter: adapter });
    apps.push(t);
    await addWindow(t, "2026-10-01T01:00:00Z", "2026-10-01T02:00:00Z");
    await vi.waitFor(() => expect(order).toHaveLength(1), { timeout: 5_000 });
    expect(order[0]).toBe(dayNs("2026-11-01")); // newest first

    // The picker asks for September (local Europe/Berlin: 2026-08-31T22:00Z - 2026-09-30T22:00Z).
    const asked = await t.get(calendarUrl("2026-08-31T22:00:00Z", "2026-09-30T22:00:00Z"));
    expect(asked.status, JSON.stringify(asked.body)).toBe(200);
    expect(asked.body.pending).toHaveLength(31); // 2026-08-31 … 2026-09-30
    release();

    await vi.waitFor(() => expect(new Set(order).size).toBeGreaterThanOrEqual(1 + 31 + 31), {
      timeout: 15_000,
      interval: 25,
    });
    const days: bigint[] = [];
    for (const day of order) if (days[days.length - 1] !== day) days.push(day);
    // The in-flight day first, then September's days newest first, then the rest (October) newest first.
    const september: bigint[] = [];
    for (let d = dayNs("2026-09-30"); d >= dayNs("2026-08-31"); d -= DAY) september.push(d);
    const october: bigint[] = [];
    for (let d = dayNs("2026-10-31"); d >= dayNs("2026-10-01"); d -= DAY) october.push(d);
    expect(days.slice(0, 1 + 31 + 31)).toEqual([dayNs("2026-11-01"), ...september, ...october]);
  });

  it("counts a day above the bound in four 6 h parts", async () => {
    // Bound 3 rows: 2026-10-03 holds five rows (two, one, one, one in its four 6 h parts).
    const OCT3 = OCT2 + DAY;
    const signals = [
      ...TESTCAR_ROWS,
      {
        dataRef: "testcar",
        name: "T",
        rows: [
          [OCT3 + HOUR, 1],
          [OCT3 + 2n * HOUR, 1],
          [OCT3 + 7n * HOUR, 1],
          [OCT3 + 13n * HOUR, 1],
          [OCT3 + 19n * HOUR, 1],
        ] as [bigint, number][],
      },
    ];
    const log = classRecording(memoryAdapter(signals));
    const t = await scopeApp({ adapter: log.adapter, scanRows: 3 });
    apps.push(t);
    const url = calendarUrl("2026-10-03T00:00:00Z", "2026-10-04T00:00:00Z");
    const done = await untilCounted(() => t.get(url));
    // Hand count: hour 1 and 2: one row each; 7, 13, 19: one row each.
    const hours = done.body.hours as number[];
    expect(hours.slice(0, 24)).toEqual([
      0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0,
    ]);
    // Four calls of 6 h each, none of 24 h, in idle.
    const calls = countsOf(log.log, OCT3);
    const sizes = calls.map((c) => {
      const scope = c.args[3] as { from: bigint; to: bigint };
      return scope.to - scope.from;
    });
    expect(sizes).toEqual([6n * HOUR, 6n * HOUR, 6n * HOUR, 6n * HOUR]);
    expect(calls.every((c) => c.cls === "idle")).toBe(true);
    // A day within the bound (2026-10-01, three rows) is one call of 24 h.
    const day1 = await untilCounted(() =>
      t.get(calendarUrl("2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z")),
    );
    expect(day1.body.hours[1]).toBe(3);
    const one = countsOf(log.log, OCT1);
    expect(one).toHaveLength(1);
    const single = one[0]?.args[3] as { from: bigint; to: bigint };
    expect(single.to - single.from).toBe(DAY);
  });

  it("retries a failed day at the next pass, at most once per 5 min", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
    let fail = true;
    const base = memoryAdapter(TESTCAR_ROWS);
    const adapter = new Proxy(base, {
      get(target, key, receiver) {
        const member = Reflect.get(target, key, receiver);
        if (key !== "refBuckets" || typeof member !== "function") return member;
        return async (...args: unknown[]) => {
          if (args[1] === WIDTH_60S && fail) throw new Error("boom");
          return member.apply(target, args);
        };
      },
    });
    const log = classRecording(adapter);
    const t = await scopeApp({ adapter: log.adapter });
    apps.push(t);
    await addWindow(t, "2026-10-01T01:00:00Z", "2026-10-01T02:00:00Z");
    const url = calendarUrl("2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z");
    await t.get(url);
    await vi.advanceTimersByTimeAsync(1_000);
    await settle();
    // The day failed once: still pending, answer 200 (a failed day is no error of the request).
    const failed = await t.get(url);
    expect(failed.status).toBe(200);
    expect(failed.body.pending).toEqual([{ from: OCT1.toString(), to: OCT2.toString() }]);
    const attempts = countsOf(log.log, OCT1).length;
    expect(attempts).toBeGreaterThanOrEqual(1);

    // Not again within 5 min ...
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    await settle();
    expect(countsOf(log.log, OCT1)).toHaveLength(attempts);

    // ... but at the next pass after it, when the source is back.
    fail = false;
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    await settle();
    const done = await untilCounted(
      () => t.get(url),
      async () => {
        await vi.advanceTimersByTimeAsync(1_000);
        await settle();
      },
    );
    expect(done.body.hours[1]).toBe(3);
  });
});
