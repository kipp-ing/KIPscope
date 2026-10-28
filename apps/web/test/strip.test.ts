import {
  type Density,
  EMPTY_WORKSPACE,
  type TimeseriesWindow,
  type ValuesWindow,
  type Workspace,
} from "@kipscope/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorText, fetchDensity, isTooWide } from "../src/api.ts";
import {
  densityRetryMs,
  formatSpan,
  nearbyHint,
  nextWorkWindow,
  RETRY_MS,
  scopeDensity,
  stripDataRef,
  stripLabel,
  TOO_WIDE_NOTE,
} from "../src/time/strip.ts";
import {
  caseMarks,
  caseMarkTitle,
  hitZone,
  presence,
  StripGesture,
  trackOf,
  xOf,
} from "../src/time/stripGeometry.ts";
import { loadedDensity, stripDropText } from "../src/time/TimeStrip.tsx";
import { apiError } from "./apiError.ts";
import { at, C4_ENTRIES } from "./caseFixtures.ts";

const S = 1_000_000_000n;
const MIN = 60n * S;
const H = 60n * MIN;
const D = 24n * H;

const density = (over: Partial<Density> = {}): Density => ({
  dataRef: "car",
  first: "0",
  last: (40n * S).toString(),
  width: (10n * S).toString(),
  start: "0",
  counts: [0, 10, 5, 0, 1],
  grid: ((10n * S) / 400n).toString(),
  drives: [],
  ...over,
});

describe("strip retry", () => {
  it("retries a failed load every 30 s", () => {
    expect(RETRY_MS).toBe(30_000);
  });

  it("shows a too-wide strip without retrying", async () => {
    // Time strip "Time strip states": after a `too_wide` answer the track reads `Range too wide
    // for the strip` with the answer's message as tooltip, and asks again only when the scope or
    // the shown range changes; any other failure keeps the 30 s retry.
    expect(TOO_WIDE_NOTE).toBe("Range too wide for the strip");
    const message =
      "too wide: 230,000,000 rows, more than the 150,000,000 a query may read; choose a shorter range";
    const wide = await apiError(422, "too_wide", message);
    expect(isTooWide(wide)).toBe(true);
    // The tooltip is the server's message, not `too_wide: …` of the error's own text.
    expect(errorText(wide)).toBe(message);
    expect(densityRetryMs(wide)).toBeUndefined();

    const down = await apiError(502, "source_error", "down");
    expect(isTooWide(down)).toBe(false);
    expect(densityRetryMs(down)).toBe(30_000);
    expect(densityRetryMs(new Error("network"))).toBe(30_000);
    // A 422 with another code is no too-wide answer.
    expect(densityRetryMs(await apiError(422, "invalid_request", "x"))).toBe(30_000);
  });
});

describe("formatSpan", () => {
  it("uses the largest unit it reaches, one decimal at most, no .0", () => {
    expect(formatSpan(20n * MIN)).toBe("20 min");
    expect(formatSpan(150n * MIN)).toBe("2.5 h");
    expect(formatSpan(45n * 1_000_000n)).toBe("45 ms");
    expect(formatSpan(5n * 365n * D)).toBe("5 y");
    expect(formatSpan(0n)).toBe("0 ms");
    expect(formatSpan(19n * S)).toBe("19 s");
    expect(formatSpan(6n * D)).toBe("6 d");
    expect(formatSpan(3n * H)).toBe("3 h");
    expect(formatSpan(364n * D)).toBe("364 d");
    expect(formatSpan(365n * D)).toBe("1 y");
    expect(formatSpan(90n * MIN)).toBe("1.5 h");
    // Below 1 ms the unit stays ms.
    expect(formatSpan(500_000n)).toBe("0.5 ms");
  });
});

describe("strip label and data ref with a scope (add-scope)", () => {
  // 2026-10-01T01:00:00Z and 02:00:00Z in ns, by hand.
  const T1 = 1790816400000000000n;
  const T2 = 1790820000000000000n;
  const scopeOf = (dataRef: string) => ({ dataRef, from: T1.toString(), to: T2.toString() });

  it("labels the shown span within the scope", () => {
    const d = density({
      first: T1.toString(),
      last: (T2 - 1n).toString(),
      width: (30n * S).toString(),
      start: T1.toString(),
      counts: [1],
      scope: { from: T1.toString(), to: T2.toString() },
    });
    const view = { from: T1 + 10n * MIN, to: T1 + 20n * MIN };
    // No `1 bar =` any more (D-094: the strip has no bars).
    expect(stripLabel(d, view)).toBe("10 min of 1 h in scope");
    expect(stripLabel(d)).toBe("1 h in scope");
    // Without `scope` the label reads "recorded": first = T1, last 6 d later.
    const { scope: _scope, ...plain } = d;
    const sixDays = { ...plain, last: (T1 + 6n * D).toString() };
    expect(stripLabel(sixDays, view)).toBe("10 min of 6 d recorded");
  });

  it("takes the scope's data ref", () => {
    // The only window shows another data ref than the scope's.
    const windows = [ts("w1", ["othercar/Fast_100h.SIG_A"])];
    expect(stripDataRef(ws(windows, { scope: scopeOf("testcar") }))).toBe("testcar");
    expect(stripDataRef(ws(windows))).toBe("othercar");
    // A scope gives the data ref even with no window at all.
    expect(stripDataRef(ws([], { scope: scopeOf("testcar") }))).toBe("testcar");
  });
});

describe("stripLabel", () => {
  it("labels the shown and recorded spans", () => {
    const d = density({
      first: "0",
      last: (6n * D).toString(),
      width: (3n * H).toString(),
      start: "0",
      counts: [1],
    });
    expect(stripLabel(d, { from: 12n * S, to: 31n * S })).toBe("19 s of 6 d recorded");
    expect(stripLabel(d)).toBe("6 d recorded");
    expect(stripLabel(d, { from: 12n * S, to: 31n * S })).not.toContain("bar");
  });
});

const ts = (id: string, signals: string[]): TimeseriesWindow => ({
  id,
  kind: "timeseries",
  range: { from: "0", to: "10" },
  display: { mode: "line", envelope: false },
  signals: signals.map((signalId, i) => ({ id: `a${id}${i}`, signalId })),
});
const values = (id: string, signals: string[]): ValuesWindow => ({
  id,
  kind: "values",
  mode: "line",
  signals: signals.map((signalId, i) => ({ id: `a${id}${i}`, signalId })),
});
const ws = (windows: Workspace["windows"], extra: Partial<Workspace> = {}): Workspace => ({
  ...EMPTY_WORKSPACE,
  windows,
  ...extra,
});

describe("stripDataRef", () => {
  it("takes the data ref of the target window, else of any window", () => {
    // No window, no data ref.
    expect(stripDataRef(EMPTY_WORKSPACE)).toBeUndefined();
    // Only a values window: its first signal.
    expect(stripDataRef(ws([values("w1", ["carB/X", "carC/Y"])]))).toBe("carB");
    // The target is the first timeseries window, even behind a values window.
    const w = [values("w1", ["carB/X"]), ts("w2", ["carA/P", "carC/Q"]), ts("w3", ["carC/R"])];
    expect(stripDataRef(ws(w))).toBe("carA");
    // The window zoomed last wins.
    expect(stripDataRef(ws(w, { lastZoomed: "w3" }))).toBe("carC");
    // A target without signals: the first signal of any window in order.
    expect(stripDataRef(ws([ts("w1", []), values("w2", ["carB/X"]), ts("w3", ["carC/R"])]))).toBe(
      "carB",
    );
    // Signal names may contain a slash; the data ref ends at the first one.
    expect(stripDataRef(ws([ts("w1", ["smart451/A/B"])]))).toBe("smart451");
    // Windows without any signal.
    expect(stripDataRef(ws([ts("w1", []), values("w2", [])]))).toBeUndefined();
  });
});

describe("strip drop text for a selection", () => {
  it("names a selection that has no new state signals", () => {
    expect(stripDropText({ name: "4 signals", ok: false, reason: "none_new" })).toBe(
      "None of 4 signals has new named states",
    );
    // The one-signal wording stays as it was.
    expect(stripDropText({ name: "BRK_LMP", ok: true })).toBe(
      "Drop to mark state changes of BRK_LMP",
    );
    expect(stripDropText({ name: "3 signals", ok: true })).toBe(
      "Drop to mark state changes of 3 signals",
    );
  });
});

describe("strip in an object scope (add-case-open)", () => {
  /** A y in the drive row, below the line area (the old bars area is gone, the zones keep their y). */
  const DRIVE_ROW_Y = 26;
  const DAYS = 86_400n * S;
  const ms = (y: number, m: number, d: number, h = 0, min = 0) =>
    BigInt(Date.UTC(y, m - 1, d, h, min)) * 1_000_000n;

  it("labels an object scope", () => {
    // An object scope of 400 days (the span of the catalog's sessions) and a 10-minute view.
    const first = ms(2025, 8, 1);
    const scope = {
      dataRef: "longcar",
      from: first.toString(),
      to: (first + 400n * DAYS).toString(),
      object: true as const,
    };
    expect(stripLabel(scope, { from: ms(2026, 6, 10, 12), to: ms(2026, 6, 10, 12, 10) })).toBe(
      "10 min of 1.1 y in catalog",
    );
    // The same range in a non-object scope of 1 h.
    expect(
      stripLabel({ dataRef: "longcar", from: "0", to: H.toString() }, { from: 0n, to: 10n * MIN }),
    ).toBe("10 min of 1 h in scope");
    // A scope's density that is not an object scope's still reads "in scope".
    expect(
      stripLabel(
        density({ scope: { from: "0", to: (2n * H).toString() }, width: (30n * S).toString() }),
        { from: 0n, to: 10n * MIN },
      ),
    ).toBe("10 min of 2 h in scope");
  });

  it("asks the detail density for the work window", async () => {
    const scope = {
      dataRef: "longcar",
      from: ms(2025, 8, 1).toString(),
      to: ms(2026, 9, 5).toString(),
      object: true as const,
    };
    const view = (from: bigint, span: bigint) => ({ from, to: from + span });
    const week = 7n * D;
    // A 10-minute view: ±10 min is under 6 h, so 6 h centred on the view (09:05 … 15:05) on whole
    // hours: [09:00, 16:00) of that day.
    const start = ms(2026, 6, 10, 12);
    const held = nextWorkWindow(undefined, view(start, 10n * MIN), scope, week);
    expect(held).toEqual({
      from: ms(2026, 6, 10, 9).toString(),
      to: ms(2026, 6, 10, 16).toString(),
    });
    // A pan by one hour stays inside the window: the same window, nothing new to ask.
    expect(nextWorkWindow(held, view(start + H, 10n * MIN), scope, week)).toBe(held);
    // A jump of ten days leaves it: a new window around the new view.
    const jumped = nextWorkWindow(held, view(start + 10n * D, 10n * MIN), scope, week);
    expect(jumped).not.toEqual(held);
    expect(jumped).toEqual({
      from: ms(2026, 6, 20, 9).toString(),
      to: ms(2026, 6, 20, 16).toString(),
    });
    expect(nearbyHint(held)).toBe("Events within 7 h around the view");
    // The default bound is the server's (7 d without meta): the same windows.
    expect(nextWorkWindow(undefined, view(start, 10n * MIN), scope)).toEqual(held);

    // The track of an object scope asks nothing: it spans the scope from the scope itself, and
    // the density without from and to is never requested (the server answers 400 for it).
    const asked: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      asked.push(url);
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    try {
      const track = loadedDensity("longcar", scope);
      expect(asked).toEqual([]);
      expect(track).toMatchObject({
        dataRef: "longcar",
        first: scope.from,
        last: (BigInt(scope.to) - 1n).toString(),
        scope: { from: scope.from, to: scope.to },
      });
      expect(track?.coarse).toBeUndefined();
      expect(track).toEqual(scopeDensity(scope));
      // The detail density names the work window: both from and to.
      await fetchDensity("longcar", undefined, held).catch(() => {});
      const params = new URL(asked[0] as string, "http://x").searchParams;
      expect(params.get("dataRef")).toBe("longcar");
      expect(params.get("from")).toBe(held.from);
      expect(params.get("to")).toBe(held.to);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("draws catalog marks of the vehicle", () => {
    // The object scope is the span of the catalog's testcar sessions: 00:59:00 … 05:11:00 (C4's
    // pad of 60 s). Its track is made from the scope alone.
    const scope = {
      dataRef: "testcar",
      from: at(0, 59),
      to: at(5, 11),
      object: true as const,
    };
    const d = scopeDensity(scope);
    const tr = trackOf(d, 1438);
    // Entry 0 is the session left with Unlink.
    const marks = caseMarks(tr, C4_ENTRIES, "testcar", 0);
    expect(marks.map((m) => m.index)).toEqual([0, 2, 3]); // not 1: othercar
    expect(marks.map((m) => m.left)).toEqual([true, false, false]);
    for (const mark of marks) {
      expect(mark.drawn.right - mark.drawn.left).toBeGreaterThanOrEqual(4);
      expect(mark.hit.right - mark.hit.left).toBeGreaterThanOrEqual(8);
    }
    const title = caseMarkTitle(C4_ENTRIES[2] as (typeof C4_ENTRIES)[number], 2, 4);
    expect(title.startsWith("Session 3 of 4 · charging · ")).toBe(true);
    // The range reads as start and duration (D-093): 04:50 – 05:10 UTC = 06:50 CEST, 20 min.
    expect(title).toContain("26-10-01 06:50  0:20 h");
    expect(title).not.toContain("07:10");
    // A title is the last part.
    expect(
      caseMarkTitle(
        { ...(C4_ENTRIES[2] as (typeof C4_ENTRIES)[number]), title: "F-104" },
        2,
        4,
      ).endsWith(" · F-104"),
    ).toBe(true);

    // A click on entry 2's mark (04:50 – 05:10Z) is a session action for that mark, hit before
    // drives: at 04:52Z, which lies in no other mark.
    const hits = marks.map((m) => m.hit);
    const x = xOf(tr, BigInt(at(4, 52)));
    const zone = hitZone(tr, x, DRIVE_ROW_Y, undefined, [], [], hits);
    expect(zone).toEqual({ kind: "session", index: 1 });
    const g = new StripGesture();
    g.down(x, DRIVE_ROW_Y, zone, 0);
    const action = g.up(x, DRIVE_ROW_Y, 40);
    expect(action).toEqual({ kind: "session", mark: 1 });
    // The mark at that position is catalog entry 2: the command is case.go {index: 2}.
    expect(marks[(action as { mark: number }).mark]?.index).toBe(2);

    // A drive under the mark does not win.
    const drive = { from: at(4, 51), to: at(5, 9), rows: 10 };
    expect(hitZone(tr, x, DRIVE_ROW_Y, undefined, [drive], [], hits).kind).toBe("session");
    // Without marks the drive is hit.
    expect(hitZone(tr, x, DRIVE_ROW_Y, undefined, [drive], [], []).kind).toBe("drive");

    // The presence line exists only inside the work window: the detail density of 01:00 - 02:00
    // (one 10 min bar after the other, all with rows) draws runs between those two times only.
    const detail: Density = {
      dataRef: "testcar",
      first: at(1, 0),
      last: (BigInt(at(2, 0)) - 1n).toString(),
      width: (10n * MIN).toString(),
      start: at(1, 0),
      counts: [5, 5, 5, 5, 5, 5],
      grid: ((10n * MIN) / 400n).toString(),
      drives: [],
    };
    const line = presence(tr, detail, undefined, undefined);
    const left = xOf(tr, BigInt(at(1, 0)));
    const right = xOf(tr, BigInt(at(2, 0)));
    expect(line.runs.length).toBeGreaterThan(0);
    for (const run of line.runs) {
      expect(run.left).toBeGreaterThanOrEqual(left - 0.5);
      expect(run.right).toBeLessThanOrEqual(right + 0.5);
    }
    // The marks lie outside it too: entry 2's mark (04:50 …) is not covered by the line.
    const third = marks[1] as (typeof marks)[number];
    expect(third.drawn.left).toBeGreaterThan(right);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
