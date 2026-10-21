import { type CalendarDensity, type Density, fromIso } from "@kipscope/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCalendar } from "../src/api.ts";
import {
  canPage,
  dayBarHeight,
  dayBars,
  dayDrives,
  dayTip,
  draftOf,
  draftRange,
  fieldText,
  localMonth,
  monthCells,
  openMonths,
  type PickerDraft,
  pickDay,
  wholeLabel,
} from "../src/time/calendar.ts";

// Spec range-picker (Calendar months, Day density, Day selection, Time fields, Presets, Picker
// states). Tests run with TZ=Europe/Berlin: CEST (UTC+2) until 2026-10-25 03:00 local, then CET.
// Every expected value is computed by hand from the instants, never from the code under test.

const S = 1_000_000_000n;
/** M10 = the local month October 2026: 2026-09-30T22:00:00Z .. 2026-10-31T23:00:00Z (745 hours). */
const M10_FROM = "1790805600000000000";
const M10_TO = "1793487600000000000";

/** The drivecar answer of "One month of drivecar" (spec Calendar density), built by hand. */
function drivecarMonth(): CalendarDensity {
  const hours = new Array<number>(745).fill(0);
  // 2026-10-02T00:00Z is hour 26 of M10 (24 h from 22:00Z on 09-30 to 22:00Z on 10-01, plus 2 h).
  hours[26] = 360;
  hours[27] = 177_360;
  hours[28] = 3_360;
  hours[29] = 51_360;
  hours[30] = 360;
  hours[31] = 360;
  hours[32] = 1;
  return {
    dataRef: "drivecar",
    from: M10_FROM,
    to: M10_TO,
    hours,
    drives: [
      { from: "1790902800000000000", to: "1790904600000000000", rows: 177_180 }, // 01:00Z-01:30Z
      { from: "1790910000000000000", to: "1790910600000000000", rows: 51_060 }, // 03:00Z-03:10Z
    ],
  };
}

/** The cell of a local date in October 2026. */
function day(date: string) {
  const cell = monthCells(2026, 10).find((c) => c?.date === date);
  if (!cell) throw new Error(`no cell for ${date}`);
  return cell;
}

describe("draftOf", () => {
  it("drafts the shown range", () => {
    expect(
      draftOf({ from: fromIso("2026-10-12T22:00:00Z"), to: fromIso("2026-10-13T22:00:00Z") }),
    ).toEqual({
      start: "2026-10-13",
      end: "2026-10-13",
      from: "00:00:00",
      to: "24:00:00",
      phase: "start",
    });
    expect(
      draftOf({ from: fromIso("2026-10-20T21:30:00Z"), to: fromIso("2026-10-20T23:52:43Z") }),
    ).toEqual({
      start: "2026-10-20",
      end: "2026-10-21",
      from: "23:30:00",
      to: "01:52:43",
      phase: "start",
    });
  });
});

describe("field text", () => {
  it("shows filled times to the minute", () => {
    expect(fieldText("15:06:03")).toBe("15:06");
    expect(fieldText("24:00:00")).toBe("24:00");
    expect(fieldText("15:08:00.093")).toBe("15:08");
    expect(fieldText("00:00:00")).toBe("00:00");
  });
});

describe("months", () => {
  it("lays out a month Monday first", () => {
    const cells = monthCells(2026, 10);
    expect(cells).toHaveLength(42);
    // 2026-10-01 is a Thursday: three empty cells (Mo Tu We) in front, 31 days, then empty ones.
    for (const i of [0, 1, 2, ...Array.from({ length: 8 }, (_, k) => 34 + k)]) {
      expect(cells[i], `cell ${i}`).toBeNull();
    }
    expect(cells[3]).toMatchObject({ date: "2026-10-01", weekday: "Thu", day: 1 });
    expect(cells[33]).toMatchObject({ date: "2026-10-31", weekday: "Sat", day: 31 });
    expect(cells.filter((c) => c !== null)).toHaveLength(31);
    // The cells' columns are Monday first: 2026-10-13 is a Tuesday.
    expect(cells.findIndex((c) => c?.date === "2026-10-13") % 7).toBe(1);

    expect(localMonth(2026, 10)).toEqual({
      from: fromIso("2026-09-30T22:00:00Z"),
      to: fromIso("2026-10-31T23:00:00Z"),
    });
    // A day is local midnight to local midnight, also across the DST change of 2026-10-25.
    expect(cells[27]).toMatchObject({ date: "2026-10-25", weekday: "Sun" });
    expect(cells[27]?.from).toBe(fromIso("2026-10-24T22:00:00Z"));
    expect(cells[27]?.to).toBe(fromIso("2026-10-25T23:00:00Z"));
    // December rolls into the next year.
    expect(localMonth(2026, 12).to).toBe(fromIso("2026-12-31T23:00:00Z"));
  });

  it("opens on the month of the range's start and the one before", () => {
    const range = { from: fromIso("2026-10-13T13:06:03Z"), to: fromIso("2026-10-13T13:18:33Z") };
    expect(openMonths(range)).toEqual([
      { year: 2026, month: 9 },
      { year: 2026, month: 10 },
    ]);
    // January: the left month is December of the year before.
    expect(
      openMonths({ from: fromIso("2026-01-15T12:00:00Z"), to: fromIso("2026-01-16T12:00:00Z") }),
    ).toEqual([
      { year: 2025, month: 12 },
      { year: 2026, month: 1 },
    ]);
  });

  it("pages only towards data", () => {
    const density = (first: string, last: string) =>
      ({
        dataRef: "smart451",
        first: fromIso(first).toString(),
        last: fromIso(last).toString(),
        width: "3600000000000",
        start: "0",
        counts: [],
        grid: "9000000000",
        drives: [],
      }) satisfies Density;
    const d = density("2026-10-11T12:34:24Z", "2026-10-21T00:52:43Z");
    // Right month October (left September): all data is in October.
    expect(canPage(d, { year: 2026, month: 9 })).toEqual({ prev: false, next: false });
    // Right month November (left October): data before it, none after.
    expect(canPage(d, { year: 2026, month: 10 })).toEqual({ prev: true, next: false });
    // First row in August, right month October: data before the left month.
    const early = density("2026-08-20T12:00:00Z", "2026-10-21T00:52:43Z");
    expect(canPage(early, { year: 2026, month: 9 })).toEqual({ prev: true, next: false });
    // Data after the right month turns › on.
    const late = density("2026-10-11T12:34:24Z", "2026-12-05T08:00:00Z");
    expect(canPage(late, { year: 2026, month: 9 })).toEqual({ prev: false, next: true });
    // Without a density both are on.
    expect(canPage(undefined, { year: 2026, month: 9 })).toEqual({ prev: true, next: true });
  });
});

describe("day bars", () => {
  it("sums local two-hour bars and marks drives", () => {
    const bars = dayBars(drivecarMonth(), day("2026-10-02"));
    expect(bars).toHaveLength(12);
    // Local bar k = hours 24 + 2k and 25 + 2k of the month (local midnight is 22:00Z on 10-01).
    expect(bars.map((b) => b.count)).toEqual([0, 177_720, 54_720, 720, 1, 0, 0, 0, 0, 0, 0, 0]);
    // The drives 03:00-03:30 and 05:00-05:10 local lie in bars 1 (02-04) and 2 (04-06).
    expect(bars.map((b) => b.drive)).toEqual([
      false,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);

    // The DST day of 25 h: 11 bars of 2 h and a last one of 3 h (hours 576 … 600 of the month).
    const ones: CalendarDensity = {
      dataRef: "drivecar",
      from: M10_FROM,
      to: M10_TO,
      hours: new Array<number>(745).fill(1),
      drives: [],
    };
    const dst = dayBars(ones, day("2026-10-25"));
    expect(dst.map((b) => b.count)).toEqual([2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3]);
    expect(dst.some((b) => b.drive)).toBe(false);
  });

  it("scales bar heights by decades", () => {
    expect(dayBarHeight(0, 1000)).toBe(0);
    expect(dayBarHeight(1000, 1000)).toBe(12);
    expect(dayBarHeight(100, 1000)).toBe(9);
    expect(dayBarHeight(10, 1000)).toBe(6);
    expect(dayBarHeight(1, 1000)).toBe(3);
    // Four decades below the largest bar and beyond: the 2 px floor.
    expect(dayBarHeight(1, 1_000_000_000)).toBe(2);
  });

  it("words the day tooltip with rows, drives and the reason for no rows", () => {
    const month = drivecarMonth();
    expect(dayTip(month, day("2026-10-02"), "none")).toBe("Fri 26-10-02 · 233,161 rows · 2 drives");
    expect(dayTip(month, day("2026-10-03"), "none")).toBe("Sat 26-10-03 · no data");
    // One drive: singular.
    const one = { ...month, drives: month.drives.slice(0, 1) };
    expect(dayTip(one, day("2026-10-02"), "none")).toBe("Fri 26-10-02 · 233,161 rows · 1 drive");
    // A day without rows outside the scope the answer carries names the scope or the session.
    const scoped: CalendarDensity = {
      ...month,
      scope: { from: "1790902800000000000", to: "1790906400000000000" },
    };
    expect(dayTip(scoped, day("2026-10-10"), "scope")).toBe("Sat 26-10-10 · outside the scope");
    expect(dayTip(scoped, day("2026-10-10"), "session")).toBe("Sat 26-10-10 · outside the session");
    expect(dayTip(scoped, day("2026-10-10"), "object")).toBe("Sat 26-10-10 · no data");
  });
});

describe("day selection", () => {
  const base = (): PickerDraft =>
    draftOf({ from: fromIso("2026-10-13T13:06:03Z"), to: fromIso("2026-10-13T13:18:33Z") });

  it("picks a start and an end day", () => {
    const first = pickDay(base(), "2026-10-15");
    expect(first).toMatchObject({ start: "2026-10-15", end: "2026-10-15", phase: "end" });
    const second = pickDay(first, "2026-10-17");
    expect(second).toMatchObject({ start: "2026-10-15", end: "2026-10-17", phase: "start" });
    const third = pickDay(second, "2026-10-16");
    expect(third).toMatchObject({ start: "2026-10-16", end: "2026-10-16", phase: "end" });
    // 14 lies before the start 16: starts again.
    const fourth = pickDay(third, "2026-10-14");
    expect(fourth).toMatchObject({ start: "2026-10-14", end: "2026-10-14", phase: "end" });
    // The same day ends the range on that day.
    expect(pickDay(fourth, "2026-10-14")).toMatchObject({
      start: "2026-10-14",
      end: "2026-10-14",
      phase: "start",
    });
    // From and To keep their times throughout.
    for (const d of [first, second, third, fourth]) {
      expect(d.from).toBe("15:06:03");
      expect(d.to).toBe("15:18:33");
    }
  });
});

describe("draftRange", () => {
  const draft = (over: Partial<PickerDraft>): PickerDraft => ({
    start: "2026-10-13",
    end: "2026-10-13",
    from: "15:06:03",
    to: "15:18:33",
    phase: "start",
    ...over,
  });

  it("turns the draft into a range or a reason", () => {
    expect(draftRange(draft({}))).toEqual({
      from: fromIso("2026-10-13T13:06:03Z"),
      to: fromIso("2026-10-13T13:18:33Z"),
    });
    // 24:00 is the next local midnight.
    expect(draftRange(draft({ from: "00:00", to: "24:00" }))).toEqual({
      from: fromIso("2026-10-12T22:00:00Z"),
      to: fromIso("2026-10-13T22:00:00Z"),
    });
    expect(draftRange(draft({ from: "00:00:00", to: "24:00:00" }))).toEqual({
      from: fromIso("2026-10-12T22:00:00Z"),
      to: fromIso("2026-10-13T22:00:00Z"),
    });
    // Milliseconds are accepted.
    expect(draftRange(draft({ from: "15:08:00.093", to: "15:08:00.995" }))).toEqual({
      from: fromIso("2026-10-13T13:08:00.093Z"),
      to: fromIso("2026-10-13T13:08:00.995Z"),
    });
    // A range over several days.
    expect(draftRange(draft({ end: "2026-10-15" }))).toEqual({
      from: fromIso("2026-10-13T13:06:03Z"),
      to: fromIso("2026-10-15T13:18:33Z"),
    });

    expect(draftRange(draft({ from: "15:18", to: "15:06" }))).toEqual({
      error: "To lies before From",
    });
    expect(draftRange(draft({ from: "25:00", to: "26:00" }))).toEqual({
      error: "Time as hh:mm",
    });
    expect(draftRange(draft({ from: "abc" }))).toEqual({ error: "Time as hh:mm" });
    // 24:00 is only an end.
    expect(draftRange(draft({ from: "24:00", to: "24:00" }))).toEqual({
      error: "Time as hh:mm",
    });

    // 2026-10-25 02:30 happens twice (CEST and CET): refused, naming both offsets.
    const ambiguous = draftRange(
      draft({ start: "2026-10-25", end: "2026-10-25", from: "02:30", to: "04:00" }),
    );
    expect(ambiguous).toHaveProperty("error");
    expect((ambiguous as { error: string }).error).toContain("+02:00 or +01:00");
  });
});

describe("presets", () => {
  it("lists the day's drives and names the whole span", () => {
    const month = drivecarMonth();
    const chips = dayDrives(month, day("2026-10-02"));
    expect(chips.map((c) => c.label)).toEqual(["03:00  0:30", "05:00  0:10"]);
    expect(chips.map((c) => c.drive)).toEqual(month.drives);
    // A day without drives has no chip, and neither does a calendar that is not loaded.
    expect(dayDrives(month, day("2026-10-03"))).toEqual([]);
    expect(dayDrives(undefined, day("2026-10-02"))).toEqual([]);

    expect(wholeLabel("none")).toBe("Whole recording");
    expect(wholeLabel("scope")).toBe("Whole scope");
    expect(wholeLabel("session")).toBe("Whole session");
    expect(wholeLabel("object")).toBe("Whole recording");
  });
});

describe("picker states", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const month = localMonth(2026, 10);

  it("keeps the picker usable while the calendar loads or fails", async () => {
    const urls: string[] = [];
    // Held: the request never answers until it is aborted (the picker closed).
    vi.stubGlobal("fetch", (url: string, init?: { signal?: AbortSignal }) => {
      urls.push(url);
      return new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    });
    const held = new AbortController();
    const pending = fetchCalendar("smart451", month, held.signal);
    let settled = false;
    pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    // While it is held: no answer, so no bars, no chips and no paging bounds; every day reads as a
    // plain date, and typed input and Whole day still make a range.
    await Promise.resolve();
    expect(settled).toBe(false);
    const oct13 = day("2026-10-13");
    expect(dayDrives(undefined, oct13)).toEqual([]);
    expect(dayTip(undefined, oct13, "none")).toBe("Tue 26-10-13");
    expect(canPage(undefined, { year: 2026, month: 9 })).toEqual({ prev: true, next: true });
    const typed = draftRange({
      start: "2026-10-13",
      end: "2026-10-13",
      from: "15:08",
      to: "15:09",
      phase: "start",
    });
    expect(typed).toEqual({
      from: fromIso("2026-10-13T13:08:00Z"),
      to: fromIso("2026-10-13T13:09:00Z"),
    });
    expect(
      draftRange({
        start: "2026-10-13",
        end: "2026-10-13",
        from: "00:00:00",
        to: "24:00:00",
        phase: "start",
      }),
    ).toEqual({ from: fromIso("2026-10-12T22:00:00Z"), to: fromIso("2026-10-13T22:00:00Z") });

    held.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    // The request asks for the month as decimal ns on the minute grid.
    const query = new URL(urls[0] as string, "http://localhost").searchParams;
    expect(new URL(urls[0] as string, "http://localhost").pathname).toBe("/api/calendar");
    expect(query.get("dataRef")).toBe("smart451");
    expect(query.get("from")).toBe(M10_FROM);
    expect(query.get("to")).toBe(M10_TO);
    expect(BigInt(query.get("from") as string) % (60n * S)).toBe(0n);

    // Failed: a 502 rejects; nothing is kept, the next request asks again and gets its bars.
    let calls = 0;
    const answer = drivecarMonth();
    vi.stubGlobal("fetch", async () => {
      calls++;
      if (calls === 1) {
        return new Response(JSON.stringify({ error: { code: "source_error", message: "down" } }), {
          status: 502,
        });
      }
      return new Response(JSON.stringify(answer), { status: 200 });
    });
    await expect(fetchCalendar("drivecar", month)).rejects.toMatchObject({
      status: 502,
      code: "source_error",
    });
    const again = await fetchCalendar("drivecar", month);
    expect(calls).toBe(2);
    expect(again).toEqual(answer);
    // Reopened: bars from the answer.
    expect(dayBars(again, day("2026-10-02")).map((b) => b.count)[1]).toBe(177_720);
  });
});

describe("month grid size (round 2)", () => {
  // Weekday of the 1st (Monday first) and day count, by hand: rows used = ceil((lead + days) / 7).
  // 2026-02: Sunday, 28 days -> lead 6 -> 34 cells -> 5 rows. 2026-10: Thursday, 31 -> lead 3 -> 34 -> 5 rows.
  // 2026-08: Saturday, 31 -> lead 5 -> 36 -> 6 rows. 2027-02: Monday, 28 -> lead 0 -> 28 -> 4 rows.
  const cases: [number, number, number, number][] = [
    [2026, 2, 5, 28],
    [2026, 10, 5, 31],
    [2026, 8, 6, 31],
    [2027, 2, 4, 28],
  ];
  it.each(cases)(
    "%i-%i always has 6 rows x 7 cells (42), %i used rows, %i days",
    (y, m, used, days) => {
      const cells = monthCells(y, m);
      expect(cells).toHaveLength(42);
      expect(cells.length / 7).toBe(6);
      expect(cells.filter((c) => c !== null)).toHaveLength(days);
      const rows = Array.from({ length: 6 }, (_, r) => cells.slice(r * 7, r * 7 + 7));
      expect(rows.filter((row) => row.some((c) => c !== null))).toHaveLength(used);
    },
  );

  it("an open pair of a 5-row and a 6-row month has the same cell count", () => {
    expect(monthCells(2026, 10).length).toBe(monthCells(2026, 8).length);
    expect(monthCells(2026, 2).length).toBe(monthCells(2026, 8).length);
  });
});
