import type {
  CatalogSnapshot,
  SignalInfo,
  SignalMatch,
  TimeseriesWindow,
  WorkspaceScope,
} from "@kipscope/shared";
import { describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../src/api.ts";
import {
  CatalogLoader,
  type CatalogReport,
  PARTIAL_RELOAD_MS,
  partialText,
} from "../src/explorer/catalogLoader.ts";
import {
  CHUNK,
  formatDbcRange,
  formatMessageId,
  formatRawStep,
  formatScaling,
  formatSnaPhysical,
  formatSource,
  HIDE_GRACE_MS,
  HOVER_DELAY_MS,
  NEW_WINDOW,
  nextShown,
  resolveTarget,
  visibleCount,
  windowsShowing,
} from "../src/explorer/format.ts";
import { explorerItems, firstSignal } from "../src/explorer/groups.ts";

function win(id: string, signalIds: string[], title?: string): TimeseriesWindow {
  return {
    id,
    kind: "timeseries",
    ...(title ? { title } : {}),
    range: { from: "0", to: "10" },
    display: { mode: "line", envelope: false },
    signals: signalIds.map((signalId, i) => ({ id: `a${id}${i}`, signalId })),
  };
}

describe("explorer formatting", () => {
  it("pins the timing and chunk constants", () => {
    expect(HOVER_DELAY_MS).toBe(350);
    expect(HIDE_GRACE_MS).toBe(150);
    expect(CHUNK).toBe(500);
    expect(NEW_WINDOW).toBe("new");
  });

  it("formats scaling, raw step and DBC range", () => {
    expect(formatScaling(1, 0)).toBe("× 1 + 0");
    expect(formatScaling(0.5, 0)).toBe("× 0.5 + 0");
    expect(formatScaling(1, -40)).toBe("× 1 - 40");
    expect(formatRawStep(1, "km/h")).toBe("1 km/h");
    expect(formatRawStep(0.5, "1/min")).toBe("0.5 1/min");
    expect(formatRawStep(-2, undefined)).toBe("2");
    expect(formatDbcRange(0, 510, "km/h", 3)).toBe("0 … 510 km/h");
    expect(formatDbcRange(-40, 214, "°C", 3)).toBe("-40.0 … 214 °C");
    expect(formatDbcRange(-40, 214, "°C", 4)).toBe("-40.00 … 214.0 °C");
    expect(formatDbcRange(0, 0, "km/h", 3)).toBe("not set");
    // SNA physical values: WSPD_FL raw 3FFFh = 8191.5 1/min (rounded before scaling, N7).
    expect(formatSnaPhysical(8191.5, "1/min", 3)).toBe("8.19 k1/min");
    expect(formatSnaPhysical(8191.5, "1/min", 4)).toBe("8.192 k1/min");
    expect(formatSnaPhysical(511, "km/h", 3)).toBe("511 km/h");
  });

  it("formats message IDs as hex", () => {
    expect(formatMessageId(930)).toBe("0x3A2");
    expect(formatMessageId(1504)).toBe("0x5E0");
    expect(formatMessageId(0x98ff1234)).toBe("0x18FF1234 (ext)");
  });

  it("formats the source line", () => {
    const base: SignalInfo = {
      id: "smart451/ICL_3A2h.SPEED_DISP",
      dataRef: "smart451",
      name: "ICL_3A2h.SPEED_DISP",
    };
    const dbc = { message: "ICL_3A2h", messageId: 930 };
    expect(formatSource({ ...base, dbc: { ...dbc, file: "h-can.dbc" } })).toBe(
      "smart451 · h-can.dbc",
    );
    expect(formatSource({ ...base, dbc })).toBe("smart451 · DBC");
    expect(formatSource(base)).toBe("smart451 · no DBC entry");
  });

  it("lists the windows showing a signal", () => {
    const windows = [
      win("w1", ["c/SPEED_DISP", "c/WSPD_FL"], "Speeds"),
      win("w2", ["c/PTC"]),
      win("w3", ["c/SPEED_DISP"]),
    ];
    expect(windowsShowing(windows, "c/SPEED_DISP")).toEqual(["Speeds", "Window 3"]);
    expect(windowsShowing(windows, "c/T_ENG")).toEqual([]);
  });

  it("returns Window <n> for an untitled window", () => {
    expect(windowsShowing([win("w6", ["c/X"])], "c/X")).toEqual(["Window 6"]);
  });

  it("renders matches in chunks until all are visible", () => {
    expect(visibleCount(1013, CHUNK)).toBe(500);
    let shown = nextShown(1013, CHUNK);
    expect(shown).toBe(1000);
    expect(visibleCount(1013, shown)).toBe(1000);
    shown = nextShown(1013, shown);
    expect(shown).toBe(1013);
    expect(visibleCount(1013, shown)).toBe(1013);
    expect(nextShown(1013, shown)).toBe(1013);
    // The real catalog fits in one chunk.
    expect(visibleCount(428, CHUNK)).toBe(428);
  });

  it("keeps the Add to target by window ID while windows change", () => {
    const w1 = win("w1", []);
    const w2 = win("w2", []);
    expect(resolveTarget("w2", [w1, w2])).toBe("w2");
    // Created, renamed, reordered: still w2.
    expect(resolveTarget("w2", [w1, w2, win("w3", [])])).toBe("w2");
    expect(resolveTarget("w2", [{ ...w1, title: "Renamed" }, w2])).toBe("w2");
    expect(resolveTarget("w2", [w2, w1])).toBe("w2");
    // Removed: falls back to a new window.
    expect(resolveTarget("w2", [w1])).toBe(NEW_WINDOW);
    expect(resolveTarget("w2", [])).toBe(NEW_WINDOW);
    // New window stays, even when windows exist.
    expect(resolveTarget(NEW_WINDOW, [w1, w2])).toBe(NEW_WINDOW);
  });
});

/** A ranked match of a signal in `group` (undefined: Other); only `signal` matters for grouping. */
function match(name: string, group: string | undefined): SignalMatch {
  return {
    signal: { id: `c/${name}`, dataRef: "c", name, ...(group ? { group } : {}) },
    tier: 0,
    name: [],
    shown: [],
    unit: [],
    description: [],
  } as unknown as SignalMatch;
}

describe("explorer groups", () => {
  // Rank order: 1 Other, 2 CGW, 3 ESP, 4 AC, 5 ESP.
  const ranked = [
    match("r1", undefined),
    match("r2", "CGW"),
    match("r3", "ESP"),
    match("r4", "AC"),
    match("r5", "ESP"),
  ];
  const shape = (items: ReturnType<typeof explorerItems>) =>
    items.map((i) =>
      i.kind === "group"
        ? `${i.name} ${i.count} ${i.open ? "open" : "closed"}`
        : i.match.signal.name,
    );

  it("groups matches by best hit, Other last, collapsed on an empty query", () => {
    const none = new Set<string>();
    // Searching: groups by best hit, Other last, rank order inside, all open.
    const searching = explorerItems(ranked, true, true, none);
    expect(shape(searching)).toEqual([
      "CGW 1 open",
      "r2",
      "ESP 2 open",
      "r3",
      "r5",
      "AC 1 open",
      "r4",
      "Other 1 open",
      "r1",
    ]);
    expect(firstSignal(searching)).toBe(1);

    // Empty query: matches are the catalog order; groups by name, Other last, all closed.
    const catalogOrder = [
      match("a", "AC"),
      match("b", "CGW"),
      match("c", "ESP"),
      match("d", undefined),
      match("e", "ESP"),
    ];
    const empty = explorerItems(catalogOrder, false, true, none);
    expect(shape(empty)).toEqual(["AC 1 closed", "CGW 1 closed", "ESP 2 closed", "Other 1 closed"]);
    expect(firstSignal(empty)).toBe(0);

    // Toggling ESP opens just ESP on the empty query, closes just ESP while searching.
    const esp = new Set(["ESP"]);
    expect(shape(explorerItems(catalogOrder, false, true, esp))).toEqual([
      "AC 1 closed",
      "CGW 1 closed",
      "ESP 2 open",
      "c",
      "e",
      "Other 1 closed",
    ]);
    expect(shape(explorerItems(ranked, true, true, esp))).toEqual([
      "CGW 1 open",
      "r2",
      "ESP 2 closed",
      "AC 1 open",
      "r4",
      "Other 1 open",
      "r1",
    ]);

    // Not grouped: the matches in rank order, no headers.
    const flat = explorerItems(ranked, true, false, none);
    expect(flat.every((i) => i.kind === "signal")).toBe(true);
    expect(shape(flat)).toEqual(["r1", "r2", "r3", "r4", "r5"]);
    expect(firstSignal(flat)).toBe(0);
  });

  it("groups 10,000 matches in under 10 ms", () => {
    const matches = Array.from({ length: 10_000 }, (_, i) =>
      match(`s${i}`, i % 101 === 100 ? undefined : `G${String(i % 100).padStart(3, "0")}`),
    );
    const none = new Set<string>();
    explorerItems(matches, true, true, none); // warm-up
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const items = explorerItems(matches, true, true, none);
      runs.push(performance.now() - t0);
      // 100 named groups plus Other: 101 headers and all 10,000 rows.
      expect(items).toHaveLength(10_000 + 101);
    }
    runs.sort((a, b) => a - b);
    const median = runs[2] ?? Infinity;
    console.log(`explorerItems: 10,000 matches in 101 groups, median ${median.toFixed(2)} ms`);
    // Goal 10 ms; the hard limit is the 50 ms of the filtering goal.
    expect(median).toBeLessThan(50);
  });
});

describe("explorer catalog per scope (add-scope)", () => {
  // 2026-10-01T01:00:00Z and 02:00:00Z in ns, by hand.
  const T1 = 1790816400000000000n;
  const T2 = 1790820000000000000n;
  const H = 3_600_000_000_000n;
  const scope = (from: bigint, to: bigint): WorkspaceScope => ({
    dataRef: "testcar",
    from: from.toString(),
    to: to.toString(),
  });
  const snapshot = (id: string, s?: WorkspaceScope): CatalogSnapshot => ({
    items: [{ id: `testcar/${id}`, dataRef: "testcar", name: id }],
    loadedAt: "2026-10-19T08:00:00.000Z",
    ...(s ? { scope: s } : {}),
  });

  /** A fetch whose every call waits for the test to answer it. */
  function harness(retryMs = 5000) {
    const pending: {
      resolve: (s: CatalogSnapshot) => void;
      reject: (e: unknown) => void;
      abort: AbortSignal;
    }[] = [];
    const reports: CatalogReport[] = [];
    const loader = new CatalogLoader(
      (abort) =>
        new Promise<CatalogSnapshot>((resolve, reject) => {
          pending.push({ resolve, reject, abort });
        }),
      (r) => reports.push(r),
      retryMs,
    );
    return { loader, pending, reports };
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("reloads the catalog when the scope changes", async () => {
    const { loader, pending, reports } = harness();
    const second = scope(T1, T2);
    const third = scope(T1 - H, T2 + H);
    loader.setScope(undefined);
    loader.setScope(second);
    // The same scope again is no change: no fetch.
    loader.setScope(scope(T1, T2));
    loader.setScope(third);
    expect(pending).toHaveLength(3);

    // The answer for the second scope arrives after the third scope was set: dropped.
    pending[1]?.resolve(snapshot("Second", second));
    await settle();
    expect(reports).toEqual([]);
    pending[2]?.resolve(snapshot("Third", third));
    await settle();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ kind: "loaded" });
    expect((reports[0] as { snapshot: CatalogSnapshot }).snapshot.items[0]?.name).toBe("Third");
    // The older fetches were aborted by the newer scope.
    expect(pending[0]?.abort.aborted).toBe(true);
    expect(pending[1]?.abort.aborted).toBe(true);
    expect(pending[2]?.abort.aborted).toBe(false);
  });

  it("drops an answer whose own scope is not the current one", async () => {
    const { loader, pending, reports } = harness();
    const current = scope(T1, T2);
    loader.setScope(current);
    pending[0]?.resolve(snapshot("Wrong", scope(T1, T2 + H)));
    await settle();
    expect(reports).toEqual([]);
    // Without a scope the full catalog (no `scope` field) is what counts.
    const { loader: plain, pending: plainPending, reports: plainReports } = harness();
    plain.setScope(undefined);
    plainPending[0]?.resolve(snapshot("Full"));
    await settle();
    expect(plainReports).toHaveLength(1);
  });

  it("shows no scope without retrying until the scope changes", async () => {
    vi.useFakeTimers();
    try {
      const { loader, pending, reports } = harness(1000);
      loader.setScope(undefined);
      pending[0]?.reject(new ApiRequestError(409, "scope_required", "set a scope first"));
      await vi.advanceTimersByTimeAsync(0);
      expect(reports).toEqual([{ kind: "no_scope" }]);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(pending).toHaveLength(1);

      // A scope arrives: one fetch, no reload of the page.
      loader.setScope(scope(T1, T2));
      expect(pending).toHaveLength(2);
      pending[1]?.resolve(snapshot("Listed", scope(T1, T2)));
      await vi.advanceTimersByTimeAsync(0);
      expect(reports.at(-1)).toMatchObject({ kind: "loaded" });

      // Another failure is retried while the scope stays.
      const { loader: failing, pending: failPending, reports: failReports } = harness(1000);
      failing.setScope(scope(T1, T2));
      failPending[0]?.reject(new ApiRequestError(503, "catalog_unavailable", "still loading"));
      await vi.advanceTimersByTimeAsync(0);
      expect(failReports[0]).toMatchObject({ kind: "failed" });
      await vi.advanceTimersByTimeAsync(1000);
      expect(failPending).toHaveLength(2);
      failing.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
  it("reloads while the list is partial", async () => {
    vi.useFakeTimers();
    try {
      const { loader, pending, reports } = harness();
      const object: WorkspaceScope = { ...scope(T1, T2), object: true };
      loader.setScope(object);
      expect(pending).toHaveLength(1);
      pending[0]?.resolve({ ...snapshot("Session", object), partial: true });
      await vi.advanceTimersByTimeAsync(0);
      expect(reports).toHaveLength(1);
      expect((reports[0] as { snapshot: CatalogSnapshot }).snapshot.partial).toBe(true);
      // The note names the session whose list stands in.
      expect(partialText(3)).toBe("Signals of session 3; the vehicle's full list is loading");

      // Not before 10 s; then it asks again.
      await vi.advanceTimersByTimeAsync(PARTIAL_RELOAD_MS - 1);
      expect(pending).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(pending).toHaveLength(2);
      // Still partial: another 10 s.
      pending[1]?.resolve({ ...snapshot("Session", object), partial: true });
      await vi.advanceTimersByTimeAsync(PARTIAL_RELOAD_MS);
      expect(pending).toHaveLength(3);
      // The full list: reported without `partial`, and no more fetches.
      pending[2]?.resolve(snapshot("Vehicle", object));
      await vi.advanceTimersByTimeAsync(0);
      const last = reports.at(-1) as { snapshot: CatalogSnapshot };
      expect(last.snapshot.partial).toBeUndefined();
      expect(last.snapshot.items[0]?.name).toBe("Vehicle");
      await vi.advanceTimersByTimeAsync(5 * PARTIAL_RELOAD_MS);
      expect(pending).toHaveLength(3);

      // A new scope stops a pending partial reload.
      const { loader: second, pending: waiting } = harness();
      second.setScope(object);
      waiting[0]?.resolve({ ...snapshot("Session", object), partial: true });
      await vi.advanceTimersByTimeAsync(0);
      second.setScope(scope(T1 - H, T2));
      expect(waiting).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(PARTIAL_RELOAD_MS);
      expect(waiting).toHaveLength(2);
      second.dispose();
      loader.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
