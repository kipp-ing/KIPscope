import { readFileSync } from "node:fs";
import type { CaseEntry, CommandResult, WorkspaceCase, WorkspaceScope } from "@kipscope/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionBar } from "../src/case/SessionBar.tsx";
import {
  alignItems,
  arrowHint,
  CASE_MESSAGES,
  caseResultEvents,
  catalogRows,
  goFirstMatch,
  moreText,
  sessionBarText,
  stepCommand,
} from "../src/case/sessionBar.ts";
import { loadStatusText, NOT_IN_SESSION } from "../src/chart/loader.ts";
import { caseStepKey } from "../src/keys.ts";
import { resultStripEvents } from "../src/time/scope.ts";
import { TimeStrip } from "../src/time/TimeStrip.tsx";
import { nextStrip, type StripEvent, type StripItem } from "../src/views/notice.ts";
import { at, C4, C4_ENTRIES, caseWorkspace, entryAt } from "./caseFixtures.ts";

// Tests run with TZ=Europe/Berlin (see package.json): 2026-10-01 is CEST, UTC+2.

const caseAt = (current: number, linked = true): WorkspaceCase => {
  const c = caseWorkspace({ current }).case as WorkspaceCase;
  return { ...c, linked };
};

describe("session bar text", () => {
  it("describes the session", () => {
    const linked = sessionBarText(caseAt(0));
    expect(linked.label).toBe("SESSION");
    expect(linked.text).toBe(
      "testcar · driving · 2026-10-01 03:00 – 03:10 (10 min) · distance_km 6.2",
    );
    expect(linked.position).toBe("1 / 4");
    // The tooltip lists every meta entry, the id and the origin tool.
    const tip = sessionBarText(caseAt(0), undefined, { tool: "KI.ping" }).tooltip;
    expect(tip).toContain("distance_km");
    expect(tip).toContain(entryAt(0).id);
    expect(tip).toContain("KI.ping");

    // Unlinked: the vehicle's whole series, 02:00 – 12:00 local (00:00Z – 10:00Z).
    const scope: WorkspaceScope = {
      dataRef: "testcar",
      from: at(0, 0),
      to: at(10, 0),
      object: true,
    };
    const unlinked = sessionBarText(caseAt(0, false), scope);
    expect(unlinked.label).toBe("VEHICLE");
    expect(unlinked.text).toBe(
      "testcar · whole series · 2026-10-01 02:00 – 2026-10-01 12:00 (10 h)",
    );
  });

  it("shows a title instead of the object and at most three meta values", () => {
    const entry: CaseEntry = {
      ...entryAt(0),
      title: "F-104",
      meta: { a: 1, b: "two", c: true, d: 4 },
    };
    const c = { ...caseAt(0), entry };
    const text = sessionBarText(c).text;
    expect(text.startsWith("F-104 · driving")).toBe(true);
    expect(text).toContain("a 1 · b two · c true");
    expect(text).not.toContain("d 4");
    // Numbers keep three significant digits.
    const long = { ...c, entry: { ...entry, meta: { km: 6.23456 } } };
    expect(sessionBarText(long).text).toContain("km 6.23");
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

  it("shows Unlink and Align while linked", () => {
    const scope: WorkspaceScope = { dataRef: "testcar", from: at(0, 59), to: at(1, 11) };
    const html = renderToStaticMarkup(
      createElement(SessionBar, { caseState: caseAt(0), scope, onCommand: () => undefined }),
    );
    expect(html).toContain("SESSION");
    expect(html).toContain("Unlink");
    expect(html).toContain("Align");
    expect(html).toContain("1 / 4");
    expect(html).not.toContain("Widen");
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

  it("reads a signal the session lacks as not in this session", () => {
    const missing = {
      status: "error" as const,
      request: "k",
      error: "unknown_signal: unknown signal",
      errorStatus: 404,
      errorCode: "unknown_signal",
    };
    expect(NOT_IN_SESSION).toBe("not in this session");
    expect(loadStatusText(missing, true)).toBe("not in this session");
    // Outside a case workspace the failure reads as before.
    expect(loadStatusText(missing, false)).toBe("failed: unknown_signal: unknown signal");
    expect(loadStatusText({ ...missing, errorStatus: 502, errorCode: "source_error" }, true)).toBe(
      "failed: unknown_signal: unknown signal",
    );
  });
});

describe("strip head with a catalog", () => {
  const scope: WorkspaceScope = { dataRef: "testcar", from: at(0, 59), to: at(1, 11) };

  it("describes the session", () => {
    // Linked and unlinked: the session bar, neither Widen nor Clear.
    for (const linked of [true, false]) {
      const workspace = caseWorkspace({ current: 0 });
      const c = { ...(workspace.case as WorkspaceCase), linked };
      const ws = {
        ...workspace,
        case: c,
        scope: linked ? scope : { ...scope, from: at(0, 0), to: at(10, 0), object: true as const },
      };
      const html = renderToStaticMarkup(
        createElement(TimeStrip, {
          workspace: ws,
          mode: "full",
          onScopeCommand: async () => ({ ok: true, revision: 1 }) as CommandResult,
          caseCatalog: C4,
          sessionBar: createElement(SessionBar, {
            caseState: c,
            scope: ws.scope,
            onCommand: () => undefined,
          }),
        }),
      );
      expect(html, String(linked)).toContain(linked ? "SESSION" : "VEHICLE");
      expect(html).not.toContain("Widen");
      expect(html).not.toContain("Clear");
      expect(html).not.toContain("SCOPE");
    }

    // Without a catalog the scope head stays.
    const plain = { ...caseWorkspace({ current: 0 }), scope } as ReturnType<typeof caseWorkspace>;
    const { case: _c, ...noCase } = plain;
    const html = renderToStaticMarkup(
      createElement(TimeStrip, {
        workspace: noCase,
        mode: "full",
        onScopeCommand: async () => ({ ok: true, revision: 1 }) as CommandResult,
      }),
    );
    expect(html).toContain("Widen");
    expect(html).toContain("Clear");
  });
});
