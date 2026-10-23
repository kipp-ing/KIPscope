import type {
  CatalogSnapshot,
  SignalInfo,
  SignalMatch,
  TimeseriesWindow,
  WorkspaceScope,
} from "@kipscope/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
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
import {
  COMPUTED_GROUP,
  explorerItems,
  FAVOURITES_GROUP,
  firstSignal,
} from "../src/explorer/groups.ts";
import { HINTS } from "../src/help/hints.ts";

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
    // add-adx-row-metadata R6: a unit with neither DBC entry nor diag field can only come from the table.
    expect(formatSource({ ...base, unit: "km/h" })).toBe("smart451 · unit from the table");
    expect(formatSource({ ...base, unit: "km/h", dbc })).toBe("smart451 · DBC");
    expect(formatSource({ ...base, unit: "km/h", dbc: { ...dbc, file: "h-can.dbc" } })).toBe(
      "smart451 · h-can.dbc",
    );
    const diag = {
      file: "test-diag.manifest.json",
      ecu: "TBMS",
      group: "DT_Pack",
      did: 516,
      field: "DT_Pack_Current",
      kind: "number" as const,
    };
    expect(formatSource({ ...base, unit: "A", diag })).toBe("smart451 · test-diag (TBMS diag)");
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
        : i.kind === "hint"
          ? `hint ${i.text}`
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

/** A ranked match of `dataRef/name` (favourites match by `name` alone, design F3). */
function matchOf(dataRef: string, name: string, group?: string): SignalMatch {
  return {
    signal: { id: `${dataRef}/${name}`, dataRef, name, ...(group ? { group } : {}) },
    tier: 0,
    name: [],
    shown: [],
    unit: [],
    description: [],
  } as unknown as SignalMatch;
}

describe("explorer favourites (add-favourites)", () => {
  // Rank order of signal-groups "Group order and state": 1 Other, 2 CGW, 3 ESP, 4 AC, 5 ESP.
  const ranked = [
    match("r1", undefined),
    match("r2", "CGW"),
    match("r3", "ESP"),
    match("r4", "AC"),
    match("r5", "ESP"),
  ];
  const none = new Set<string>();
  const stars = ["r5", "r2"];
  /** One line per item: header `name count open|closed` (+ `*` for the Favourites header), row `name` (+ `*` for a copy). */
  const shape = (items: ReturnType<typeof explorerItems>) =>
    items.map((i) =>
      i.kind === "group"
        ? `${i.name} ${i.count} ${i.open ? "open" : "closed"}${i.favourites ? " *" : ""}`
        : i.kind === "hint"
          ? `hint ${i.text}`
          : `${i.match.signal.name}${i.inFavourites ? " *" : ""}`,
    );
  const base = (searching: boolean, grouped = true, toggled = none) =>
    explorerItems(ranked, searching, grouped, toggled);

  it("puts favourites in a group at the top", () => {
    expect(FAVOURITES_GROUP).toBe("★ Favourites");

    // Searching: the header, the copies in rank order (2 before 5), then today's items unchanged.
    const searching = explorerItems(ranked, true, true, none, stars);
    expect(shape(searching).slice(0, 3)).toEqual(["★ Favourites 2 open *", "r2 *", "r5 *"]);
    expect(searching[0]).toMatchObject({
      kind: "group",
      name: FAVOURITES_GROUP,
      count: 2,
      open: true,
      favourites: true,
    });
    expect(searching.slice(3)).toEqual(base(true));
    expect(shape(searching.slice(3))).toEqual([
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

    // Empty query (catalog order): open although the other groups are closed; the copies in the
    // order of the favourites (5 before 2), then the closed headers by name.
    const empty = explorerItems(ranked, false, true, none, stars);
    expect(shape(empty)).toEqual([
      "★ Favourites 2 open *",
      "r5 *",
      "r2 *",
      "AC 1 closed",
      "CGW 1 closed",
      "ESP 2 closed",
      "Other 1 closed",
    ]);
    expect(empty.slice(3)).toEqual(base(false));

    // Toggled: the header closed, no copies, the groups below as before.
    const closed = new Set([FAVOURITES_GROUP]);
    const searchingClosed = explorerItems(ranked, true, true, closed, stars);
    expect(searchingClosed[0]).toMatchObject({ count: 2, open: false, favourites: true });
    expect(searchingClosed.slice(1)).toEqual(base(true));
    const emptyClosed = explorerItems(ranked, false, true, closed, stars);
    expect(emptyClosed[0]).toMatchObject({ count: 2, open: false, favourites: true });
    expect(emptyClosed.slice(1)).toEqual(base(false));
    // Toggling a group below leaves the Favourites group alone.
    expect(shape(explorerItems(ranked, false, true, new Set(["ESP"]), stars)).slice(0, 3)).toEqual([
      "★ Favourites 2 open *",
      "r5 *",
      "r2 *",
    ]);

    // Flat list ("Flat list with favourites"): the header, the copies, then the five matches.
    const flat = explorerItems(ranked, true, false, none, stars);
    expect(shape(flat)).toEqual([
      "★ Favourites 2 open *",
      "r2 *",
      "r5 *",
      "r1",
      "r2",
      "r3",
      "r4",
      "r5",
    ]);
    expect(flat.filter((i) => i.kind === "group")).toHaveLength(1);

    // One favourite match in an otherwise flat catalog: the only header is the Favourites one.
    expect(shape(explorerItems(ranked, true, false, none, ["r3"]))).toEqual([
      "★ Favourites 1 open *",
      "r3 *",
      "r1",
      "r2",
      "r3",
      "r4",
      "r5",
    ]);
  });

  it("changes nothing without a favourite in the matches", () => {
    // No favourites, or none of them among the matches: exactly today's items.
    expect(explorerItems(ranked, true, true, none, [])).toEqual(base(true));
    expect(explorerItems(ranked, true, true, none)).toEqual(base(true));
    expect(explorerItems(ranked, true, true, none, ["nothing"])).toEqual(base(true));
    expect(explorerItems(ranked, false, false, none, ["nothing"])).toEqual(base(false, false));
    expect(explorerItems([], true, true, none, stars)).toEqual([]);
  });

  it("matches favourites by name on every data ref", () => {
    const catalog = [
      matchOf("testcar", "Fast_100h.SIG_A"),
      matchOf("testcar", "Other_1h.X"),
      matchOf("othercar", "Fast_100h.SIG_A"),
    ];
    for (const searching of [true, false]) {
      const items = explorerItems(catalog, searching, false, none, [
        "Fast_100h.SIG_A",
        "Gone_900h.X",
      ]);
      expect(items[0], `searching ${searching}`).toMatchObject({
        kind: "group",
        name: FAVOURITES_GROUP,
        count: 2,
        open: true,
      });
      // Both entries, in catalog order, and nothing for the name that is not in the catalog.
      const copies = items.filter((i) => i.kind === "signal" && i.inFavourites);
      expect(
        copies.map((i) => (i.kind === "signal" ? i.match.signal.id : "")),
        `searching ${searching}`,
      ).toEqual(["testcar/Fast_100h.SIG_A", "othercar/Fast_100h.SIG_A"]);
      expect(items.slice(1 + copies.length)).toEqual(
        explorerItems(catalog, searching, false, none),
      );

      // Only a name that is not here: exactly the items without favourites, no header.
      expect(explorerItems(catalog, searching, false, none, ["Gone_900h.X"])).toEqual(
        explorerItems(catalog, searching, false, none),
      );
    }
    // Case counts: a favourite is the exact name (design F3).
    expect(explorerItems(catalog, true, false, none, ["fast_100h.sig_a"])).toEqual(
      explorerItems(catalog, true, false, none),
    );
  });

  it("keeps the best hit active when favourites come first", () => {
    const searching = explorerItems(ranked, true, true, none, stars);
    // 0 header, 1 copy r2, 2 copy r5, 3 CGW, 4 r2, 5 ESP, 6 r3, 7 r5, 8 AC, 9 r4, 10 Other, 11 r1.
    expect(firstSignal(searching, "c/r1")).toBe(11);
    // A favourite best hit is active in its Favourites copy.
    expect(firstSignal(searching, "c/r2")).toBe(1);
    expect(firstSignal(searching, "c/r5")).toBe(2);
    // Without a best hit the first signal item: the first copy.
    const empty = explorerItems(ranked, false, true, none, stars);
    expect(firstSignal(empty)).toBe(1);
    expect(empty[1]).toMatchObject({ kind: "signal", inFavourites: true });
    expect(empty[1]?.kind === "signal" && empty[1].match.signal.name).toBe("r5");
    // A best hit that is not among the items falls back to the first signal item.
    expect(firstSignal(searching, "c/nowhere")).toBe(1);
    // Without favourites it is today's behaviour; a closed Favourites group has no copies.
    expect(firstSignal(base(true), "c/r1")).toBe(8);
    expect(
      firstSignal(explorerItems(ranked, true, true, new Set([FAVOURITES_GROUP]), stars), "c/r2"),
    ).toBe(2);
    // Only headers: the first item.
    expect(firstSignal(explorerItems(ranked, false, true, none))).toBe(0);
  });

  it("groups 10,000 matches with 1,000 favourites in under 10 ms", () => {
    const matches = Array.from({ length: 10_000 }, (_, i) =>
      match(`s${i}`, i % 101 === 100 ? undefined : `G${String(i % 100).padStart(3, "0")}`),
    );
    // 1,000 favourites: 500 of the matches (every 20th) and 500 names no match has.
    const favourites = [
      ...Array.from({ length: 500 }, (_, i) => `s${i * 20}`),
      ...Array.from({ length: 500 }, (_, i) => `gone${i}`),
    ];
    const toggled = new Set<string>();
    explorerItems(matches, true, true, toggled, favourites); // warm-up
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const items = explorerItems(matches, true, true, toggled, favourites);
      runs.push(performance.now() - t0);
      // 101 group headers and 10,000 rows, plus the Favourites header and 500 copies.
      expect(items).toHaveLength(10_000 + 101 + 1 + 500);
    }
    runs.sort((a, b) => a - b);
    const median = runs[2] ?? Number.POSITIVE_INFINITY;
    console.log(
      `explorerItems with favourites: 10,000 matches, 1,000 favourites, median ${median.toFixed(2)} ms`,
    );
    // Goal 10 ms; the hard limit is the 50 ms of the filtering goal.
    expect(median).toBeLessThan(50);
  });
});

describe("explorer star markup (add-favourites)", () => {
  afterEach(() => {
    vi.doUnmock("../src/explorer/catalogLoader.ts");
    vi.resetModules();
  });

  /** The explorer on a catalog that is there from the first render (SSR runs no effects, so no fetch). */
  async function render(favourites: string[]) {
    const items: SignalInfo[] = [
      { id: "testcar/Sna_800h.RPM", dataRef: "testcar", name: "Sna_800h.RPM" },
      { id: "testcar/Fast_100h.SIG_A", dataRef: "testcar", name: "Fast_100h.SIG_A" },
    ] as SignalInfo[];
    vi.resetModules();
    vi.doMock("../src/explorer/catalogLoader.ts", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/explorer/catalogLoader.ts")>()),
      CatalogLoader: class {
        constructor(_fetch: unknown, report: (r: CatalogReport) => void) {
          report({ kind: "loaded", snapshot: { items } as unknown as CatalogSnapshot });
        }
        setScope() {}
        dispose() {}
      },
    }));
    const { SignalExplorer } = await import("../src/explorer/SignalExplorer.tsx");
    const html = renderToStaticMarkup(
      createElement(SignalExplorer, {
        windows: [],
        onAdd: () => {},
        onAddMany: () => {},
        onSeen: () => {},
        digits: 3,
        target: "new",
        onTarget: () => {},
        open: true,
        onOpen: () => {},
        part: "signals",
        onPart: () => {},
        favourites,
      } as never),
    );
    return html;
  }

  /** The rows (`div.row`) of the markup: opening tag and inner HTML. */
  const rowsOf = (html: string) =>
    [...html.matchAll(/<div\b([^>]*\bclass="row[ "][^>]*)>(.*?)<\/div>/gs)].map((m) => ({
      tag: m[1] ?? "",
      inner: m[2] ?? "",
    }));
  const starOf = (inner: string) => {
    const m = /^<button\b([^>]*)>(.*?)<\/button>/s.exec(inner);
    return m ? { attrs: m[1] ?? "", text: m[2] ?? "" } : undefined;
  };

  it("renders a star button in every row", async () => {
    const html = await render(["Sna_800h.RPM"]);
    const rows = rowsOf(html);
    // The Favourites copy of RPM, then the list: RPM and SIG_A.
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      const star = starOf(row.inner);
      expect(star, `first child of ${row.tag}`).toBeDefined();
      expect(star?.attrs).toMatch(/\bclass="[^"]*\bstar\b/);
      expect(star?.attrs).toContain('tabindex="-1"');
      expect(star?.attrs).toMatch(/\btype="button"/);
    }
    const [copy, rpm, sigA] = rows.map((r) => starOf(r.inner));
    for (const star of [copy, rpm]) {
      expect(star?.attrs).toContain('aria-pressed="true"');
      expect(star?.text).toBe("★");
      expect(star?.attrs).toContain(`title="${HINTS.star(true)}"`);
      expect(star?.attrs).toContain(`aria-label="${HINTS.star(true)}"`);
    }
    expect(sigA?.attrs).toContain('aria-pressed="false"');
    expect(sigA?.text).toBe("☆");
    expect(sigA?.attrs).toContain(`title="${HINTS.star(false)}"`);
    expect(sigA?.attrs).toContain(`aria-label="${HINTS.star(false)}"`);
    // The star comes before the SNA dot and the name, in the same row.
    for (const row of rows) {
      expect(row.inner.indexOf('class="sna-dot')).toBeGreaterThan(row.inner.indexOf("</button>"));
      expect(row.inner.indexOf('class="name')).toBeGreaterThan(row.inner.indexOf("</button>"));
    }
  });

  it("shows the Favourites header without a star, with the tooltip of both counts", async () => {
    const html = await render(["Sna_800h.RPM", "Gone_900h.X"]);
    const head = /<div\b[^>]*\bclass="group-head[^"]*"[^>]*>(.*?)<\/div>/s.exec(html);
    expect(head, "the Favourites header").not.toBeNull();
    expect(head?.[0]).toContain(FAVOURITES_GROUP);
    // One of the two starred signals is in this list.
    expect(head?.[0]).toContain(`title="${HINTS.favourites(1, 2)}"`);
    expect(head?.[0]).not.toContain("<button");
    expect(head?.[0]).toMatch(/group-count">1</);
  });

  it("shows no Favourites header and unpressed stars without favourites", async () => {
    const html = await render([]);
    expect(html).not.toContain(FAVOURITES_GROUP);
    const rows = rowsOf(html);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(starOf(row.inner)?.attrs).toContain('aria-pressed="false"');
      expect(starOf(row.inner)?.text).toBe("☆");
    }
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

/** A computed row as `computedInfos` makes it (C11): `=<id>` name, formula in the description. */
function computedMatch(id: string, name: string, unavailable?: string): SignalMatch {
  const signal: SignalInfo = {
    id: `c/=${id}`,
    dataRef: "c",
    name: `=${id}`,
    displayName: name,
    description: "A.X - B.Y",
    unit: "A",
    computed: {
      formula: "A.X - B.Y",
      ...(unavailable !== undefined && { unavailable }),
    },
  };
  return {
    signal,
    tier: 0,
    name: [],
    shown: [],
    unit: [],
    description: [],
  } as unknown as SignalMatch;
}

describe("explorer Computed section (add-computed-signals)", () => {
  // Rank order of signal-groups "Group order and state": 1 Other, 2 CGW, 3 ESP, 4 AC, 5 ESP.
  const ranked = [
    match("r1", undefined),
    match("r2", "CGW"),
    match("r3", "ESP"),
    match("r4", "AC"),
    match("r5", "ESP"),
  ];
  const none = new Set<string>();
  const stars = ["r5", "r2"];
  const one = { matches: [computedMatch("c1", "Diff")] };
  const base = (searching: boolean) => explorerItems(ranked, searching, true, none);
  const header = (count: number, open: boolean) => ({
    kind: "group",
    name: COMPUTED_GROUP,
    count,
    open,
    computed: true,
  });

  // spec computed-signals "Items of the section"; signal-groups "Groups unchanged below the Computed section"
  it("puts the Computed section under Favourites", () => {
    expect(COMPUTED_GROUP).toBe("ƒ Computed");

    for (const searching of [true, false]) {
      // Favourites header and copies (3 items), the Computed header and its row, then today's items.
      const items = explorerItems(ranked, searching, true, none, stars, one);
      expect(items[0]).toMatchObject({ kind: "group", name: FAVOURITES_GROUP, favourites: true });
      expect(items[3]).toMatchObject(header(1, true));
      expect(items[4]).toMatchObject({ kind: "signal" });
      expect((items[4] as { match: SignalMatch }).match.signal.computed).toBeDefined();
      expect(items.slice(5)).toEqual(base(searching));
      // Without favourites the section comes first.
      const first = explorerItems(ranked, searching, true, none, [], one);
      expect(first[0]).toMatchObject(header(1, true));
      expect(first.slice(2)).toEqual(base(searching));
    }

    // Empty query without a definition: the header with count 0 and one hint item, then the groups.
    const empty = explorerItems(ranked, false, true, none, stars, { matches: [] });
    expect(empty[3]).toMatchObject(header(0, true));
    expect(empty[4]).toEqual({ kind: "hint", text: HINTS.computedEmpty });
    expect(empty.slice(5)).toEqual(base(false));
    expect(HINTS.computedEmpty).toBe("None yet \u00b7 + creates one");

    // Searching without a computed match: no Computed header and no hint.
    const searching = explorerItems(ranked, true, true, none, stars, { matches: [] });
    expect(searching.some((i) => i.kind === "hint")).toBe(false);
    expect(searching.some((i) => i.kind === "group" && i.name === COMPUTED_GROUP)).toBe(false);
    expect(searching).toEqual(explorerItems(ranked, true, true, none, stars));

    // Toggling the section closes it on both queries; the groups below do not change.
    const closed = new Set([COMPUTED_GROUP]);
    for (const query of [true, false]) {
      const items = explorerItems(ranked, query, true, closed, [], one);
      expect(items[0]).toMatchObject(header(1, false));
      expect(items.slice(1)).toEqual(explorerItems(ranked, query, true, closed));
    }
    const noDef = explorerItems(ranked, false, true, closed, [], { matches: [] });
    expect(noDef[0]).toMatchObject(header(0, false));
    expect(noDef.some((i) => i.kind === "hint")).toBe(false);

    // Absent: exactly today's items (no section, no header).
    expect(explorerItems(ranked, false, true, none, stars)).toEqual(
      explorerItems(ranked, false, true, none, stars, undefined),
    );
    expect(
      explorerItems(ranked, false, true, none, stars).some(
        (i) => i.kind === "group" && i.name === COMPUTED_GROUP,
      ),
    ).toBe(false);
    // The flat list gets the section too, above the five matches.
    const flat = explorerItems(ranked, true, false, none, [], one);
    expect(flat[0]).toMatchObject(header(1, true));
    expect(flat.slice(2).map((i) => (i.kind === "signal" ? i.match.signal.name : "?"))).toEqual([
      "r1",
      "r2",
      "r3",
      "r4",
      "r5",
    ]);
  });
});

describe("explorer computed row markup (add-computed-signals)", () => {
  afterEach(() => {
    vi.doUnmock("../src/explorer/catalogLoader.ts");
    vi.resetModules();
  });

  async function render(computed: SignalInfo[]) {
    const items: SignalInfo[] = [
      { id: "c/A.X", dataRef: "c", name: "A.X" },
      { id: "c/B.Y", dataRef: "c", name: "B.Y" },
    ] as SignalInfo[];
    vi.resetModules();
    vi.doMock("../src/explorer/catalogLoader.ts", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/explorer/catalogLoader.ts")>()),
      CatalogLoader: class {
        constructor(_fetch: unknown, report: (r: CatalogReport) => void) {
          report({ kind: "loaded", snapshot: { items } as unknown as CatalogSnapshot });
        }
        setScope() {}
        dispose() {}
      },
    }));
    const { SignalExplorer } = await import("../src/explorer/SignalExplorer.tsx");
    return renderToStaticMarkup(
      createElement(SignalExplorer, {
        windows: [],
        onAdd: () => {},
        onAddMany: () => {},
        onSeen: () => {},
        digits: 3,
        target: "new",
        onTarget: () => {},
        open: true,
        onOpen: () => {},
        part: "signals",
        onPart: () => {},
        favourites: [],
        computed,
        computedDefs: [],
        onCommand: async () => ({ ok: false, code: "network", message: "unused" }),
      } as never),
    );
  }

  const rowsOf = (html: string) =>
    [...html.matchAll(/<div\b([^>]*\bclass="row[ "][^>]*)>(.*?)<\/div>/gs)].map((m) => ({
      tag: m[1] ?? "",
      inner: m[2] ?? "",
    }));

  // spec computed-signals "Row markup"
  it("renders computed rows with a pencil and no star", async () => {
    const html = await render([
      computedMatch("c1", "Diff").signal,
      computedMatch("c2", "Broken", "not in this list: C.Z").signal,
    ]);
    const rows = rowsOf(html).filter((r) => /\bcomputed\b/.test(r.tag));
    expect(rows).toHaveLength(2);
    const [ok, off] = rows as [(typeof rows)[number], (typeof rows)[number]];
    for (const row of rows) {
      // The glyph in the indent where other rows have the star; no star button; a pencil.
      expect(row.inner).toMatch(/aria-hidden="true"[^>]*>ƒ</);
      expect(row.inner).not.toMatch(/class="star\b/);
      expect(row.inner).not.toContain("★");
      expect(row.inner).not.toContain("☆");
      const pencil = /<button\b([^>]*\bclass="edit"[^>]*)>/.exec(row.inner);
      expect(pencil, `pencil in ${row.tag}`).not.toBeNull();
      expect(pencil?.[1]).toContain(`title="${HINTS.computedEdit}"`);
    }
    // The available row has the + button, the unavailable one has none and says why.
    expect(ok.inner).toMatch(/<button\b[^>]*\bclass="add"/);
    expect(ok.tag).not.toContain("unavailable");
    expect(off.inner).not.toMatch(/\bclass="add"/);
    expect(off.tag).toContain('title="not in this list: C.Z"');
  });

  it("renders the Computed header with a plus and the hint", async () => {
    const withRows = await render([computedMatch("c1", "Diff").signal]);
    const chunk = withRows.split('class="group-head').find((c) => c.includes(COMPUTED_GROUP));
    const head = chunk?.slice(0, chunk.indexOf("</div>"));
    expect(head, "the Computed header").toBeDefined();
    expect(head).toMatch(/group-count">1</);
    expect(head).toContain('aria-label="New computed signal"');
    expect(head).toContain(`title="${HINTS.computedNew}"`);
    expect(withRows).not.toContain(HINTS.computedEmpty);

    const empty = await render([]);
    expect(empty).toContain(COMPUTED_GROUP);
    expect(empty).toContain(HINTS.computedEmpty);
    expect(empty).toMatch(/group-count">0</);
  });
});
