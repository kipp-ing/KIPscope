import { readFileSync } from "node:fs";
import type {
  CaseCatalog,
  CaseEntry,
  CaseOpenReport,
  CommandInput,
  CommandResult,
  WorkspaceCase,
  WorkspaceScope,
} from "@kipscope/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SessionBar } from "../src/case/SessionBar.tsx";
import {
  alignItems,
  arrowHint,
  CASE_MESSAGES,
  caseResultEvents,
  catalogRows,
  endsOpenNote,
  goFirstMatch,
  moreText,
  openNoteText,
  pendingTarget,
  sessionSlots,
  stepCommand,
  timesSlot,
} from "../src/case/sessionBar.ts";
import { caseStepKey } from "../src/keys.ts";
import { ScopeRow } from "../src/time/ScopeRow.tsx";
import { resultStripEvents } from "../src/time/scope.ts";
import { nextStrip, type StripEvent, type StripItem } from "../src/views/notice.ts";
import { at, C4, C4_ENTRIES, caseWorkspace, entryAt } from "./caseFixtures.ts";

// Static markup holds no loaded catalog and no open popover, so two seams are stubbed for the tests
// that need them: the catalog the bar reads (`shown.catalog`) and the list's open state
// (`shown.open` makes every `useState(false)` start true while the test renders the bar).
const shown = vi.hoisted(() => ({ catalog: undefined as unknown, open: false }));
vi.mock("../src/case/catalog.ts", async (importActual) => ({
  ...(await importActual<typeof import("../src/case/catalog.ts")>()),
  useCaseCatalog: () => shown.catalog,
}));
vi.mock("react", async (importActual) => {
  const actual = await importActual<typeof import("react")>();
  return {
    ...actual,
    useState: (initial?: unknown) => {
      const [value, set] = actual.useState(initial as never);
      return [shown.open && initial === false ? true : value, set];
    },
  };
});

// Tests run with TZ=Europe/Berlin (see package.json): 2026-10-01 is CEST, UTC+2.

const caseAt = (current: number, linked = true): WorkspaceCase => {
  const c = caseWorkspace({ current }).case as WorkspaceCase;
  return { ...c, linked };
};

/** Decimal ns of a local wall-clock time (the tests run in Europe/Berlin). */
const local = (y: number, mo: number, d: number, h: number, mi: number, s = 0): string =>
  String(BigInt(new Date(y, mo - 1, d, h, mi, s).getTime()) * 1_000_000n);

/** The markup of the first element whose class list has `cls`, its tag balanced; undefined if none. */
function slotHtml(html: string, cls: string): string | undefined {
  const start = new RegExp(`<(\\w+)[^>]*class="(?:[^"]* )?${cls}(?: [^"]*)?"[^>]*>`).exec(html);
  if (!start) return undefined;
  const tag = start[1] as string;
  const token = new RegExp(`<(/?)${tag}\\b[^>]*>`, "g");
  token.lastIndex = start.index + start[0].length;
  let depth = 1;
  for (let m = token.exec(html); m; m = token.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start.index, m.index + m[0].length);
  }
  return undefined;
}

const textIn = (html: string | undefined) => (html ?? "").replace(/<[^>]*>/g, "").trim();

/** The pinned slot classes of a context row, in document order (design DW3). */
const SLOTS = [
  "slot-label",
  "session-arrow",
  "session-position",
  "slot-title",
  "slot-times",
  "slot-duration",
  "slot-action",
];
function slotOrder(html: string): string[] {
  return [...html.matchAll(/class="([^"]*)"/g)].flatMap((m) =>
    (m[1] as string).split(/\s+/).filter((c) => SLOTS.includes(c)),
  );
}

describe("session slots", () => {
  const scope: WorkspaceScope = {
    dataRef: "testcar",
    from: at(0, 0),
    to: at(10, 0),
    object: true,
  };

  it("fills the session slots", () => {
    // Linked C4 entry 0: no title, kind driving, meta distance_km 6.2; 01:00 – 01:10 UTC = 03:00 CEST.
    const linked = sessionSlots(caseAt(0), undefined, { ...C4, origin: { tool: "search tool" } });
    expect(linked.label).toBe("SESSION");
    expect(linked.position).toBe("1 / 4");
    expect(linked.title).toBe("testcar");
    const tip = (linked.titleTooltip ?? "").split("\n");
    expect(tip[0]).toBe("testcar · driving");
    expect(tip).toContain("distance_km: 6.2");
    expect(tip).toContain(`id: ${entryAt(0).id}`);
    expect(tip).toContain("from search tool");
    expect(linked.weekday).toBe("Thu");
    expect(linked.times).toBe("2026-10-01  03:00:00 – 03:10:00");
    expect(linked.duration).toBe("10 min");
    expect(linked.action).toBe("Unlink");
    expect(linked.plusOne).toBe(false);
    expect(linked.pending).toBe(false);

    // Unlinked: the vehicle's whole series, 02:00 – 12:00 local (00:00Z – 10:00Z).
    const unlinked = sessionSlots(caseAt(0, false), scope, C4);
    expect(unlinked.label).toBe("VEHICLE");
    expect(unlinked.title).toBe("testcar · whole series");
    expect(unlinked.times).toBe("2026-10-01  02:00:00 – 12:00:00");
    expect(unlinked.duration).toBe("10 h");
    expect(unlinked.action).toBe("Link");

    // A titled session: once unlinked the bar names the vehicle, never the dropped session's title.
    const titled = { ...caseAt(0, false), entry: { ...entryAt(0), title: "Drive 1" } };
    const bar = sessionSlots(titled, scope, C4);
    expect(bar.label).toBe("VEHICLE");
    expect(bar.title).toBe("testcar · whole series");
    expect(JSON.stringify(bar)).not.toContain("Drive 1");

    // `<k> / <n>` is as wide for every entry: positionCh is the length of `<n> / <n>`.
    const last = sessionSlots(caseAt(3), undefined, C4);
    expect(last.position).toBe("4 / 4");
    expect(last.positionCh).toBe(linked.positionCh);
    expect(linked.positionCh).toBe("4 / 4".length);
    // 04:58 – 05:02 UTC = 06:58 – 07:02 CEST.
    expect(last.times).toBe("2026-10-01  06:58:00 – 07:02:00");
  });

  it("shows a title instead of the object and every meta entry in the tooltip", () => {
    const entry: CaseEntry = {
      ...entryAt(0),
      title: "F-104",
      meta: { a: 1, b: "two", c: true, d: 4, km: 6.23456 },
    };
    const slots = sessionSlots({ ...caseAt(0), entry }, undefined, C4);
    expect(slots.title).toBe("F-104");
    const tip = (slots.titleTooltip ?? "").split("\n");
    expect(tip[0]).toBe("F-104 · driving");
    for (const line of ["a: 1", "b: two", "c: true", "d: 4"]) expect(tip).toContain(line);
    expect(tip.some((l) => /^km: 6\.23/.test(l))).toBe(true);
  });

  it("shows the step target at once", () => {
    // Pending target 2 with the loaded catalog: entry 2 (04:50 – 05:10 UTC = 06:50 – 07:10 CEST).
    const pending = sessionSlots(caseAt(0), undefined, C4, 2);
    expect(pending.position).toBe("3 / 4");
    expect(pending.title).toBe("testcar");
    expect(pending.times).toBe("2026-10-01  06:50:00 – 07:10:00");
    expect(pending.duration).toBe("20 min");
    expect(pending.pending).toBe(true);

    // Catalog not loaded: the position is known, title, times and duration are skeletons.
    const unknown = sessionSlots(caseAt(0), undefined, undefined, 2);
    expect(unknown.position).toBe("3 / 4");
    expect(unknown.title).toBeUndefined();
    expect(unknown.times).toBeUndefined();
    expect(unknown.duration).toBeUndefined();
    expect(unknown.pending).toBe(true);

    // The target of a command: step from the current or the pending index, go, never past an end.
    const c = { current: 0, count: 4, linked: true };
    const step: CommandInput = { type: "case.step", by: 1 };
    expect(pendingTarget(c, undefined, step)).toBe(1);
    expect(pendingTarget(c, 1, step)).toBe(2);
    expect(pendingTarget({ ...c, current: 3 }, undefined, step)).toBeUndefined();
    expect(pendingTarget(c, undefined, { type: "case.go", index: 2 })).toBe(2);
    expect(pendingTarget({ ...c, linked: false }, undefined, step)).toBeUndefined();
  });

  it("marks a session crossing midnight", () => {
    const session = (from: string, to: string): WorkspaceCase => ({
      ...caseAt(0),
      entry: { ...entryAt(0), from, to },
    });
    // 2026-10-20 23:31:05 – 2026-10-21 01:52:43 local: the next day, a small +1.
    const over = sessionSlots(
      session(local(2026, 10, 20, 23, 31, 5), local(2026, 10, 21, 1, 52, 43)),
      undefined,
      C4,
    );
    expect(over.weekday).toBe("Tue");
    expect(over.times).toBe("2026-10-20  23:31:05 – 01:52:43");
    expect(over.plusOne).toBe(true);

    // Two or more days: both dates, both full times in the tooltip.
    const multi = sessionSlots(
      session(local(2026, 10, 11, 10, 0), local(2026, 10, 21, 9, 0)),
      undefined,
      C4,
    );
    expect(multi.weekday).toBe("Sun");
    expect(multi.times).toBe("2026-10-11 – Wed 2026-10-21");
    expect(multi.timesTooltip).toContain("2026-10-11 10:00:00 – 2026-10-21 09:00:00");
    expect(multi.plusOne).toBe(false);

    // Ending exactly at midnight: the exclusive end is the next calendar day, still +1.
    const midnight = sessionSlots(
      session(local(2026, 10, 20, 23, 0), local(2026, 10, 21, 0, 0)),
      undefined,
      C4,
    );
    expect(midnight.times).toContain("23:00:00 – 00:00:00");
    expect(midnight.plusOne).toBe(true);

    // Within one day: no +1.
    expect(sessionSlots(caseAt(0), undefined, C4).plusOne).toBe(false);

    // The times slot of any range, as the scope row uses it.
    expect(
      timesSlot(BigInt(local(2026, 10, 13, 14, 0)), BigInt(local(2026, 10, 13, 16, 0))),
    ).toMatchObject({
      weekday: "Tue",
      times: "2026-10-13  14:00:00 – 16:00:00",
      plusOne: false,
    });
    expect(
      timesSlot(BigInt(local(2026, 10, 20, 23, 31, 5)), BigInt(local(2026, 10, 21, 1, 52, 43))),
    ).toMatchObject({
      times: "2026-10-20  23:31:05 – 01:52:43",
      plusOne: true,
    });
  });

  it("describes the arrows by their neighbour", () => {
    expect(arrowHint(caseAt(2), -1, C4)).toBe("Previous: othercar · 2026-10-01 02:00 ([)");
    expect(arrowHint(caseAt(2), 1, C4)).toBe("Next: testcar · 2026-10-01 06:58 (])");
    expect(arrowHint(caseAt(0, false), 1, C4)).toBe("Link first");
  });
});

describe("session bar keys and arrows", () => {
  const key = (
    k: string,
    mods: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {},
  ) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });
  const el = (tagName: string, type?: string) =>
    ({ tagName, isContentEditable: false, ...(type ? { type } : {}) }) as unknown as Element;

  it("steps with brackets", () => {
    const first = caseAt(0);
    expect(caseStepKey(key("]"), null, first)).toEqual({ type: "case.step", by: 1 });
    expect(caseStepKey(key("["), null, first)).toBeUndefined(); // at entry 0 there is no previous
    expect(caseStepKey(key("]"), el("INPUT", "text"), first)).toBeUndefined(); // "Go to" field
    expect(caseStepKey(key("]"), el("SELECT"), first)).toBeUndefined();
    expect(caseStepKey(key("]", { ctrlKey: true }), null, first)).toBeUndefined();
    expect(caseStepKey(key("]", { metaKey: true }), null, first)).toBeUndefined();
    expect(caseStepKey(key("]", { altKey: true }), null, first)).toBeUndefined();
    expect(caseStepKey(key("]"), null, caseAt(0, false))).toBeUndefined(); // unlinked
    // The other end and the middle.
    const last = caseAt(3);
    expect(caseStepKey(key("]"), null, last)).toBeUndefined();
    expect(caseStepKey(key("["), null, last)).toEqual({ type: "case.step", by: -1 });
    expect(caseStepKey(key("]"), null, undefined)).toBeUndefined(); // no catalog
    // The arrows send the same steps.
    expect(stepCommand(first, 1)).toEqual({ type: "case.step", by: 1 });
    expect(stepCommand(first, -1)).toBeUndefined();
  });

  it("steps on a real bracket keydown on the page", () => {
    // What the document's keydown handler gets: no modifiers, the page body as the target.
    const body = el("BODY");
    const middle = caseAt(1);
    expect(caseStepKey(key("]"), body, middle)).toEqual({ type: "case.step", by: 1 });
    expect(caseStepKey(key("["), body, middle)).toEqual({ type: "case.step", by: -1 });
    expect(caseStepKey(key("]"), el("BUTTON"), middle)).toEqual({ type: "case.step", by: 1 });
    expect(caseStepKey(key("]", { ctrlKey: true }), body, middle)).toBeUndefined();
    expect(caseStepKey(key("a"), body, middle)).toBeUndefined();

    // The App's key handler must use it: the step goes through the tab's command sender (which
    // cancels the preload and shows the result), and the key is consumed. The component needs a
    // browser, so the wiring is read from its source; the UI check on smart451 drives the real key.
    const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    expect(app).toMatch(/import\s*\{[^}]*\bcaseStepKey\b[^}]*\}\s*from\s*"\.\/keys\.ts"/);
    const call = app.indexOf("caseStepKey(");
    expect(call, "App.tsx never calls caseStepKey").toBeGreaterThan(-1);
    const around = app.slice(call, call + 500);
    expect(around).toContain("document.activeElement");
    expect(around).toMatch(/\.case\b/); // the workspace's case decides whether a step is allowed
    expect(around).toContain("preventDefault");
    expect(around).toMatch(/\b(command|caseCommand|barCommand|onCommand|send)\(/);
    // It sits in a document keydown listener.
    expect(app.slice(call)).toMatch(/addEventListener\("keydown"/);
  });

  it("greys the arrows while unlinked", () => {
    const unlinked = caseAt(1, false);
    expect(arrowHint(unlinked, -1, C4)).toBe("Link first");
    expect(arrowHint(unlinked, 1, C4)).toBe("Link first");
    expect(stepCommand(unlinked, -1)).toBeUndefined();
    expect(stepCommand(unlinked, 1)).toBeUndefined();
    const scope: WorkspaceScope = {
      dataRef: "othercar",
      from: at(0, 0),
      to: at(1, 0),
      object: true,
    };
    const html = renderToStaticMarkup(
      createElement(SessionBar, { caseState: unlinked, scope, onCommand: () => undefined }),
    );
    expect(html).toContain("VEHICLE");
    expect(html).toContain("Link first");
    expect((html.match(/disabled=""/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("Link");
    expect(html).not.toContain("Unlink");
  });

  it("shows Unlink while linked and no Align control in the bar", () => {
    const scope: WorkspaceScope = { dataRef: "testcar", from: at(0, 59), to: at(1, 11) };
    const html = renderToStaticMarkup(
      createElement(SessionBar, { caseState: caseAt(0), scope, onCommand: () => undefined }),
    );
    expect(html).toContain("SESSION");
    expect(html).toContain("Unlink");
    expect(html).toContain("1 / 4");
    expect(html).not.toContain("Widen");
    expect(html).not.toContain("Align:");
  });
});

describe("session bar markup", () => {
  const scope: WorkspaceScope = { dataRef: "testcar", from: at(0, 59), to: at(1, 11) };
  const bar = (props: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      createElement(SessionBar, {
        caseState: caseAt(0),
        scope,
        onCommand: () => undefined,
        ...props,
      } as never),
    );
  const SLOT_ORDER = [
    "slot-label",
    "session-arrow",
    "session-position",
    "session-arrow",
    "slot-title",
    "slot-times",
    "slot-duration",
    "slot-action",
  ];

  it("renders skeletons in the same slots", () => {
    // An opening /open#cases= page has no workspace yet; the catalog is not loaded either.
    const opening = bar({ caseState: undefined, scope: undefined });
    const linked = bar();
    expect(slotOrder(opening)).toEqual(SLOT_ORDER);
    expect(slotOrder(linked)).toEqual(SLOT_ORDER);

    // Title, times and duration each hold one skeleton and no text while the case is unknown.
    for (const slot of ["slot-title", "slot-times", "slot-duration"]) {
      const inner = slotHtml(opening, slot);
      expect(inner, `${slot} in the opening markup`).toBeDefined();
      expect(inner?.match(/class="[^"]*\bskeleton\b/g), `${slot} skeletons`).toHaveLength(1);
      expect(textIn(inner), `${slot} text`).toBe("");
      expect(slotHtml(linked, slot), `${slot} loaded`).not.toMatch(/skeleton/);
    }
    // The loaded bar has its texts.
    expect(textIn(slotHtml(linked, "slot-title"))).toContain("testcar");
    expect(textIn(slotHtml(linked, "slot-times"))).toContain("03:00:00 – 03:10:00");
    expect(textIn(slotHtml(linked, "slot-duration"))).toBe("10 min");
    expect(textIn(slotHtml(linked, "slot-action"))).toBe("Unlink");

    // A pending target outside the loaded catalog shows skeletons in its slots as well.
    const pending = bar({ pending: 2 });
    expect(slotOrder(pending)).toEqual(SLOT_ORDER);
    expect(slotHtml(pending, "slot-title")).toMatch(/skeleton/);
    expect(textIn(slotHtml(pending, "session-position"))).toContain("3 / 4");
  });

  it("shows the progress line only while a step is on its way", () => {
    expect(bar()).not.toContain("session-progress");
    expect(bar({ progress: true })).toContain("session-progress");
  });

  it("puts the align modes into the catalog list", () => {
    shown.open = true;
    try {
      const radios = (html: string) => {
        const group = slotHtml(html, "session-list") ?? "";
        const m = /<div[^>]*role="radiogroup"[^>]*>/.exec(group);
        expect(m, "a radiogroup inside the list").not.toBeNull();
        expect(m?.[0]).toContain('aria-label="Align"');
        expect(html.match(/role="radiogroup"/g)).toHaveLength(1);
        return [...group.matchAll(/<button[^>]*role="radio"[^>]*>(.*?)<\/button>/gs)].map((r) => ({
          text: textIn(r[0]),
          checked: r[0].includes('aria-checked="true"'),
          disabled: /\sdisabled(=|\s|>)/.test(r[0]),
        }));
      };
      const noAnchors: CaseCatalog = {
        ...C4,
        entries: C4_ENTRIES.map(({ anchor: _anchor, ...rest }) => rest),
      };

      // Start mode: Session start checked; the anchor item enabled while a session has an anchor.
      shown.catalog = C4;
      const start = bar();
      expect(radios(start)).toEqual([
        { text: "Session start", checked: true, disabled: false },
        { text: "Session end", checked: false, disabled: false },
        { text: "Anchor from the finder", checked: false, disabled: false },
      ]);
      // No C4 entry has an anchor: the item is disabled.
      shown.catalog = noAnchors;
      expect(radios(bar()).map((r) => r.disabled)).toEqual([false, false, true]);

      // Event mode: the event item is the checked one.
      shown.catalog = C4;
      const eventCase = {
        ...caseAt(0),
        align: { mode: "event", event: { kind: "dtc", source: "ECU1", name: "B1234" } },
      } as WorkspaceCase;
      const event = radios(bar({ caseState: eventCase }));
      expect(event).toHaveLength(4);
      expect(event.filter((r) => r.checked).map((r) => r.text)).toEqual(["Event: ECU1 B1234"]);

      // The radio group sits in the list, and no button of the bar starts with `Align`.
      expect(start.indexOf("session-list")).toBeGreaterThanOrEqual(0);
      expect(start.indexOf('role="radiogroup"')).toBeGreaterThan(start.indexOf("session-list"));
      const buttons = [...start.matchAll(/<button[^>]*>(.*?)<\/button>/gs)].map((m) =>
        textIn(m[0]),
      );
      expect(buttons.filter((t) => t.startsWith("Align"))).toEqual([]);
    } finally {
      shown.open = false;
      shown.catalog = undefined;
    }
  });
});

describe("catalog list", () => {
  it("filters the catalog list", () => {
    // C4 at entry 0 with the filter "charg": entry 2 only, and Enter goes to it.
    const { rows, more } = catalogRows(C4_ENTRIES, "charg", 0);
    expect(rows).toHaveLength(1);
    expect(more).toBe(0);
    expect(rows[0]?.index).toBe(2);
    expect(goFirstMatch(rows)).toEqual({ type: "case.go", index: 2 });
    expect(rows[0]?.text).toContain("charging");

    // No filter: every row in catalog order with the current one marked.
    const all = catalogRows(C4_ENTRIES, "", 0);
    expect(all.rows.map((r) => r.index)).toEqual([0, 1, 2, 3]);
    expect(all.rows.map((r) => r.current)).toEqual([true, false, false, false]);

    // The filter matches object, id, a meta value and the local start, case-insensitively.
    expect(catalogRows(C4_ENTRIES, "OTHERCAR", 0).rows.map((r) => r.index)).toEqual([1]);
    expect(catalogRows(C4_ENTRIES, "T04:58", 0).rows.map((r) => r.index)).toEqual([3]);
    expect(catalogRows(C4_ENTRIES, "6.2", 0).rows.map((r) => r.index)).toEqual([0]);
    expect(catalogRows(C4_ENTRIES, "06:50", 0).rows.map((r) => r.index)).toEqual([2]);
    expect(catalogRows(C4_ENTRIES, "nothing like this", 0).rows).toEqual([]);
    expect(goFirstMatch([])).toBeUndefined();

    // 600 sessions without a filter: 500 rows and the note.
    const many: CaseEntry[] = Array.from({ length: 600 }, (_, i) => ({
      ...entryAt(0),
      id: `s${i}`,
      from: String(BigInt(at(0, 0)) + BigInt(i) * 60_000_000_000n),
      to: String(BigInt(at(0, 0)) + BigInt(i) * 60_000_000_000n + 30_000_000_000n),
    }));
    const long = catalogRows(many, "", 0);
    expect(long.rows).toHaveLength(500);
    expect(long.more).toBe(100);
    expect(moreText(long.more)).toBe("… 100 more: type to filter");
    expect(moreText(0)).toBeUndefined();
  });

  it("builds a row from position, kind, name, local start, duration and meta", () => {
    const row = catalogRows(C4_ENTRIES, "", 0).rows[0];
    expect(row?.text).toBe("1 · driving · testcar · 2026-10-01 03:00 · 10 min · distance_km 6.2");
  });
});

describe("align menu", () => {
  it("offers start, end, anchor and the chosen event", () => {
    const items = alignItems({ mode: "start" }, C4_ENTRIES);
    expect(items.map((i) => i.label)).toEqual([
      "Session start",
      "Session end",
      "Anchor from the finder",
    ]);
    expect(items.map((i) => i.checked)).toEqual([true, false, false]);
    expect(items.every((i) => !i.disabled)).toBe(true);

    // No session has an anchor: the item is disabled with its tooltip.
    const noAnchors = C4_ENTRIES.map(({ anchor: _a, ...rest }) => rest);
    const anchor = alignItems({ mode: "start" }, noAnchors)[2];
    expect(anchor?.disabled).toBe(true);
    expect(anchor?.title).toBe("No session in this catalog has an anchor");

    // Event mode adds the checked event.
    const event = {
      mode: "event",
      event: { kind: "dtc", source: "BMS", name: "P0AA100" },
    } as const;
    const withEvent = alignItems(event, C4_ENTRIES);
    expect(withEvent).toHaveLength(4);
    expect(withEvent[3]).toMatchObject({ label: "Event: BMS P0AA100", checked: true });
  });
});

describe("case messages", () => {
  const ok = (extra: Partial<Extract<CommandResult, { ok: true }>>): CommandResult => ({
    ok: true,
    revision: 9,
    ...extra,
  });
  const eventAlign = {
    ...caseAt(2),
    align: { mode: "event", event: { kind: "dtc", source: "ECU1", name: "B1234" } },
  } as WorkspaceCase;

  it("messages after a step", () => {
    // Clamped, linked and unlinked.
    expect(caseResultEvents(ok({ clamped: true }), caseAt(1))).toEqual([
      { kind: "notice", text: "Stopped at the session edge. Unlink shows the whole vehicle." },
    ]);
    expect(caseResultEvents(ok({ clamped: true }), caseAt(1, false))).toEqual([
      { kind: "notice", text: "Stopped at the end of the vehicle's data." },
    ]);
    // The alignment fell back to the start.
    expect(caseResultEvents(ok({ alignFallback: true }), eventAlign)).toEqual([
      { kind: "notice", text: "No B1234 in this session; aligned to its start." },
    ]);
    expect(caseResultEvents(ok({ alignFallback: true }), caseAt(1))).toEqual([
      { kind: "notice", text: CASE_MESSAGES.noAnchor },
    ]);
    // Five signals missing: the first three shown names, then an ellipsis.
    const five = ["S1", "S2", "S3", "S4", "S5"].map((n) => `othercar/Irr_200h.${n}`);
    expect(caseResultEvents(ok({ missing: five }), caseAt(1))).toEqual([
      { kind: "notice", text: "5 signals not in this session: S1, S2, S3, …" },
    ]);
    expect(caseResultEvents(ok({ missing: ["othercar/Irr_200h.JITTER"] }), caseAt(1))).toEqual([
      { kind: "notice", text: "1 signal not in this session: JITTER" },
    ]);
    expect(caseResultEvents(ok({ missing: five.slice(0, 2) }), caseAt(1))[0]).toEqual({
      kind: "notice",
      text: "2 signals not in this session: S1, S2",
    });
    // A shown name from the catalog wins over the ID's last part.
    const named = caseResultEvents(
      ok({ missing: ["othercar/Irr_200h.JITTER"] }),
      caseAt(1),
      () => "Jitter (ms)",
    );
    expect(named).toEqual([{ kind: "notice", text: "1 signal not in this session: Jitter (ms)" }]);
  });

  it("shows open warnings with the case notice", () => {
    const warning =
      "origin.url https://evil.example/ dropped: its origin is not in KIPSCOPE_FINDER_ORIGINS";
    const report = (over: Partial<CaseOpenReport>): CaseOpenReport => ({
      count: 4,
      current: 0,
      dataRefs: ["testcar"],
      missing: [],
      warnings: [],
      ...over,
    });
    // Case texts first, then the warnings: one note, joined by " · ".
    expect(
      openNoteText(
        report({ missing: ["othercar/Irr_200h.JITTER"], warnings: [warning] }),
        caseAt(0),
      ),
    ).toBe(`1 signal not in this session: JITTER \u00b7 ${warning}`);
    // Only a warning: the warning alone.
    expect(openNoteText(report({ warnings: [warning] }), caseAt(0))).toBe(warning);
    // Neither: no note.
    expect(openNoteText(report({}), caseAt(0))).toBeUndefined();

    // The App's open handling sets the note only: no case notice for it in the message line.
    const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    expect(app).not.toMatch(/caseOpenEvents\s*\(/);
    expect(app).toMatch(/openNoteText\s*\(/);
  });

  it("messages after a step: refusals and a plain success", () => {
    const refused: CommandResult = { ok: false, code: "case_end", message: "no next session" };
    expect(caseResultEvents(refused, caseAt(3))).toEqual([
      { kind: "error", text: "case_end: no next session" },
    ]);
    // A plain success ends an older error and an older case message, and sets none.
    const events = caseResultEvents(ok({}), caseAt(1));
    expect(events.every((e) => e.kind === "dismiss")).toBe(true);
  });

  it("clears a case message on the next command", () => {
    const slot = (events: StripEvent[], from?: StripItem): StripItem | undefined =>
      events.reduce<StripItem | undefined>(nextStrip, from);
    const names = (id: string) => id.split(".").pop();
    const five = ["S1", "S2", "S3", "S4", "S5"].map((n) => `othercar/Irr_200h.${n}`);
    const messages: [string, StripEvent[]][] = [
      ["clamped, linked", caseResultEvents(ok({ clamped: true }), caseAt(1))],
      ["clamped, unlinked", caseResultEvents(ok({ clamped: true }), caseAt(1, false))],
      ["no anchor", caseResultEvents(ok({ alignFallback: true }), caseAt(1))],
      ["no event", caseResultEvents(ok({ alignFallback: true }), eventAlign)],
      [
        "1 signal missing",
        caseResultEvents(ok({ missing: [five[0] as string] }), caseAt(1), names),
      ],
      ["5 signals missing", caseResultEvents(ok({ missing: five }), caseAt(1), names)],
      [
        "clamped and missing",
        caseResultEvents(ok({ clamped: true, missing: [five[0] as string] }), caseAt(1), names),
      ],
    ];
    // The next command: a case command, or any other, accepted without a message of its own.
    const next: [string, StripEvent[]][] = [
      ["a case command", caseResultEvents(ok({}), caseAt(2))],
      ["a window command", resultStripEvents(ok({}), caseAt(2))],
    ];
    const stuck: string[] = [];
    for (const [what, shown] of messages) {
      const first = slot(shown);
      expect(first, `${what} is shown`).toBeDefined();
      for (const [command, events] of next) {
        if (slot(events, first) !== undefined) stuck.push(`${what} after ${command}`);
      }
    }
    expect(stuck, "messages that outlive the next command").toEqual([]);
    // A message of the next command replaces it.
    const clamped = slot(caseResultEvents(ok({ clamped: true }), caseAt(1)));
    expect(
      slot(caseResultEvents(ok({ missing: [five[0] as string] }), caseAt(1), names), clamped)?.text,
    ).toBe("1 signal not in this session: S1");
  });
});

describe("open report in the session bar", () => {
  const warning =
    "origin.url https://evil.example/ dropped: its origin is not in KIPSCOPE_FINDER_ORIGINS";
  const note = `1 signal not in this session: JITTER \u00b7 ${warning}`;
  const report: CaseOpenReport = {
    count: 4,
    current: 0,
    dataRefs: ["testcar"],
    missing: ["othercar/Irr_200h.JITTER"],
    warnings: [warning],
  };
  const scope: WorkspaceScope = { dataRef: "testcar", from: at(0, 59), to: at(1, 11) };
  const bar = (openNote?: string, linked = true) =>
    renderToStaticMarkup(
      createElement(SessionBar, {
        caseState: caseAt(0, linked),
        scope,
        onCommand: () => undefined,
        ...(openNote === undefined ? {} : { openNote, onDismissNote: () => undefined }),
      }),
    );

  it("shows the open report in the session bar", () => {
    const html = bar(note);
    // Exactly one note element inside the title slot, after the title, with the text and the title.
    const title = slotHtml(html, "slot-title") ?? "";
    expect(title, "a title slot").not.toBe("");
    const notes =
      title.match(/<span[^>]*class="(?:[^"]* )?session-open-note(?: [^"]*)?"[^>]*>/g) ?? [];
    expect(notes).toHaveLength(1);
    expect(html.match(/session-open-note"/g)).toHaveLength(1);
    expect(notes[0]).toContain(`title="${note}"`);
    expect(notes[0]).toContain('role="status"');
    expect(title).toContain(`\u26a0 ${note}</span>`);
    expect(title.indexOf("session-open-note")).toBeGreaterThan(title.indexOf("slot-title-text"));
    // A button labelled Dismiss inside the note, once.
    const dismiss = html.match(/<button[^>]*aria-label="Dismiss"[^>]*>/);
    expect(dismiss, "no Dismiss button").not.toBeNull();
    expect(dismiss?.[0]).toContain('title="Dismiss"');
    expect(html.match(/aria-label="Dismiss"/g)).toHaveLength(1);
    expect(title).toContain('aria-label="Dismiss"');

    // Without a note: none of it.
    const plain = bar();
    expect(plain).not.toContain("session-open-note");
    expect(plain).not.toContain("Dismiss");
    // Unlinked: the note still shows in the title slot.
    const unlinked = bar(note, false);
    expect(slotHtml(unlinked, "slot-title")?.match(/session-open-note"/g)).toHaveLength(1);

    // The note's text is what openNoteText builds, with a catalog name where there is one.
    const after = caseAt(0);
    expect(openNoteText(report, after)).toBe(note);
    const named = openNoteText(report, after, () => "Jitter (ms)");
    expect(named).toBe(`1 signal not in this session: Jitter (ms) \u00b7 ${warning}`);
    // A warning alone, and neither.
    expect(openNoteText({ ...report, missing: [] }, after)).toBe(warning);
    expect(openNoteText({ ...report, missing: [], warnings: [] }, after)).toBeUndefined();

    // The note ends when the user leaves the session.
    const ok: CommandResult = { ok: true, revision: 9 };
    const refused: CommandResult = { ok: false, code: "case_end", message: "no next session" };
    const step: CommandInput = { type: "case.step", by: 1 };
    const go: CommandInput = { type: "case.go", index: 2 };
    const unlink: CommandInput = { type: "case.unlink" };
    const align: CommandInput = { type: "case.align", align: { mode: "end" } };
    const window: CommandInput = { type: "window.remove", windowId: "w1" };
    expect(endsOpenNote(step, ok)).toBe(true);
    expect(endsOpenNote(go, ok)).toBe(true);
    expect(endsOpenNote(unlink, ok)).toBe(true);
    expect(endsOpenNote(align, ok)).toBe(false);
    expect(endsOpenNote(window, ok)).toBe(false);
    expect(endsOpenNote(step, refused)).toBe(false);
    expect(endsOpenNote(go, refused)).toBe(false);
  });
});

describe("context row", () => {
  const scope: WorkspaceScope = { dataRef: "testcar", from: at(0, 59), to: at(1, 11) };

  it("renders the context row for a case, a scope or neither", () => {
    // A case, linked and unlinked: the session bar, neither Widen nor Clear nor SCOPE.
    for (const linked of [true, false]) {
      const html = renderToStaticMarkup(
        createElement(SessionBar, {
          caseState: caseAt(0, linked),
          scope: linked ? scope : { ...scope, from: at(0, 0), to: at(10, 0), object: true },
          onCommand: () => undefined,
        }),
      );
      expect(html, String(linked)).toContain(linked ? "SESSION" : "VEHICLE");
      expect(html).toContain("context-row");
      expect(html).not.toContain("Widen");
      expect(html).not.toContain("Clear");
      expect(html).not.toContain("SCOPE");
    }

    // A scope without a catalog: the scope row in the same slots, Clear in full mode only.
    const row = (mode: "full" | "scoped") =>
      renderToStaticMarkup(
        createElement(ScopeRow, {
          scope: {
            dataRef: "smart451",
            from: local(2026, 10, 13, 14, 0),
            to: local(2026, 10, 13, 16, 0),
          },
          mode,
          onScopeCommand: async () => ({ ok: true, revision: 1 }) as CommandResult,
        }),
      );
    const full = row("full");
    expect(full).toContain("context-row");
    expect(textIn(slotHtml(full, "slot-label"))).toBe("SCOPE");
    expect(textIn(slotHtml(full, "slot-title"))).toContain("smart451");
    expect(textIn(slotHtml(full, "slot-times"))).toContain("14:00:00 – 16:00:00");
    expect(textIn(slotHtml(full, "slot-duration"))).toBe("2 h");
    expect(full).toContain("Widen");
    expect(full).toContain("Clear");
    expect(row("scoped")).toContain("Widen");
    expect(row("scoped")).not.toContain("Clear");
    // The slots line up with the session bar's: same order up to the action.
    const sessionRow = renderToStaticMarkup(
      createElement(SessionBar, { caseState: caseAt(0), scope, onCommand: () => undefined }),
    );
    expect(slotOrder(full).slice(0, 8)).toEqual(slotOrder(sessionRow));

    // Neither a case nor a scope: no context row. App picks the row; its wiring is read from the source.
    const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    const area = app.slice(app.indexOf("top-area"));
    const order = ["option-bar-slot", "<SessionBar", "<ScopeRow", "<TimeStrip"].map((t) =>
      area.indexOf(t),
    );
    for (const i of order) expect(i).toBeGreaterThanOrEqual(0);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(app).not.toMatch(/sessionBar=\{/); // the strip has no head to put the bar in
  });
});
