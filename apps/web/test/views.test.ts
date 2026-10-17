import type { LiveServerMessage, OpenView, ViewSummary, Workspace } from "@kipscope/shared";
import { EMPTY_WORKSPACE } from "@kipscope/shared";
import { describe, expect, it } from "vitest";
import { ApiRequestError } from "../src/api.ts";
import { applyLiveMessage, type LiveState } from "../src/live.ts";
import {
  existingTitle,
  rowDetails,
  saveEntries,
  saveTarget,
  titleMinChars,
} from "../src/views/model.ts";
import {
  documentTitle,
  nextStrip,
  openedElsewhere,
  openNotice,
  titleParts,
} from "../src/views/notice.ts";

// Scenario tests for the pure helpers of add-saved-views V7 (round 2). Signatures from design V7;
// where V7 leaves a shape open (strip slot, events, `own`), the adapters below are the one place to adjust.

const ws = (view?: OpenView): Workspace => ({ ...EMPTY_WORKSPACE, ...(view ? { view } : {}) });

/** Text of a notice or strip item, whether the helper returns a string or `{ text }`. */
function textOf(x: unknown): string | undefined {
  if (x === undefined || x === null) return undefined;
  if (typeof x === "string") return x;
  const t = (x as { text?: unknown }).text;
  return typeof t === "string" ? t : undefined;
}

/** True for an item in the error tone, false for an info notice. */
const isError = (x: unknown): boolean => /error/i.test(JSON.stringify(x));

describe("view title helpers", () => {
  it("titles the top row and the browser tab", () => {
    // No view: nothing in the row, plain tab title.
    expect(documentTitle(ws())).toBe("KIPscope");
    expect(titleParts(undefined)).toBeUndefined();

    // Clean view with a note: no dot, the note as tooltip.
    const clean: OpenView = {
      name: "drive-3",
      title: "Drive 3",
      note: "Cold start",
      modified: false,
    };
    expect(documentTitle(ws(clean))).toBe("Drive 3 · KIPscope");
    const cleanParts = titleParts(clean);
    expect(cleanParts?.text).toBe("Drive 3");
    expect(cleanParts?.dot).toBe(false);
    expect(cleanParts?.tooltip).toContain("Drive 3");
    expect(cleanParts?.tooltip).toContain("Cold start");

    // Modified: the dot shows, the tab title does not change.
    const modified: OpenView = { ...clean, modified: true };
    expect(documentTitle(ws(modified))).toBe("Drive 3 · KIPscope");
    expect(titleParts(modified)?.text).toBe("Drive 3");
    expect(titleParts(modified)?.dot).toBe(true);
  });

  it("keeps the title at least ten characters", () => {
    expect(titleMinChars("x".repeat(120))).toBe(10);
    expect(titleMinChars("Drive 3")).toBe(7);
    expect(titleMinChars("")).toBe(0);
    expect(titleMinChars("1234567890")).toBe(10);
    expect(titleMinChars("12345678901")).toBe(10);
  });
});

describe("save entries", () => {
  const named: OpenView = { name: "speeds", title: "Speeds", modified: true };

  it("saves the open view in place", () => {
    // Entries: no view and an unnamed view (opened from a link) offer the form only.
    expect(saveEntries(undefined)).toEqual(["saveNew"]);
    expect(saveEntries({ title: "From link", modified: false })).toEqual(["saveNew"]);
    // A named view: Save in place first, then Save as.
    expect(saveEntries(named)).toEqual(["save", "saveAs"]);

    // Targets.
    expect(saveTarget(undefined, "Speeds")).toEqual({ name: "speeds", overwrite: false });
    expect(saveTarget({ title: "From link", modified: false }, "Drive 3")).toEqual({
      name: "drive-3",
      overwrite: false,
    });
    // Title unchanged: in place, no prompt.
    expect(saveTarget(named, "Speeds")).toEqual({ name: "speeds", overwrite: true });
    // Another title: a new name, no overwrite.
    expect(saveTarget(named, "Speeds, run 2")).toEqual({ name: "speeds-run-2", overwrite: false });
    // Another title that derives the open view's name: also in place.
    expect(saveTarget(named, "SPEEDS")).toEqual({ name: "speeds", overwrite: true });
  });

  it("reads a 409 into a Replace prompt", () => {
    const err = new ApiRequestError(409, "view_exists", "exists", {
      code: "view_exists",
      existing: { name: "speeds", title: "Speeds" },
    });
    expect(existingTitle(err)).toBe("Speeds");
    // Other errors name no view.
    expect(existingTitle(new ApiRequestError(400, "invalid_view_name", "bad", undefined))).toBe(
      undefined,
    );
    expect(existingTitle(new Error("boom"))).toBe(undefined);
  });

  it("describes a menu row", () => {
    const summary: ViewSummary = {
      name: "speeds",
      title: "Speeds",
      saved: "2026-10-17T08:14:03Z",
      windows: 6,
      signals: 12,
      data: ["smart451"],
    };
    // 08:14:03Z is 10:14 in Europe/Berlin (CEST, UTC+2), 08:14 in UTC.
    const berlin = rowDetails(summary, "Europe/Berlin");
    expect(berlin).toMatch(/10:14/);
    expect(berlin.endsWith(" · 6 windows · smart451")).toBe(true);
    expect(rowDetails(summary, "UTC")).toMatch(/08:14/);
    // Singular, several refs.
    const one = rowDetails({ ...summary, windows: 1, data: ["a", "b"] }, "UTC");
    expect(one).toContain("1 window ·");
    expect(one).not.toContain("1 windows");
    expect(one.endsWith("a, b")).toBe(true);
  });
});

describe("open notices", () => {
  it("builds the open notice", () => {
    expect(openNotice("Drive 3", undefined).text).toBe('Opened "Drive 3"');
    expect(
      openNotice("Drive 3", { missing: ["smart451/Nope_1h.X"], skipped: [], warnings: [] }).text,
    ).toBe('Opened "Drive 3" · 1 signal not found: Nope_1h.X');
    const many = openNotice("T", {
      missing: ["d/A_1h.A", "d/B_1h.B", "d/C_1h.C", "d/D_1h.D"],
      skipped: [{ signalId: "d/E_1h.E", window: 0, reason: "too_many_units" }],
      warnings: [],
    });
    expect(many.text).toBe(
      'Opened "T" · 4 signals not found: A_1h.A, B_1h.B, C_1h.C, … · 1 left out (limits)',
    );
    // The tooltip lists every ID.
    expect(many.title).toContain("d/D_1h.D");
    expect(many.title).toContain("d/E_1h.E");
  });

  it("clears an older message on open", () => {
    const err = nextStrip(undefined, { kind: "error", text: "unknown_view: nope" });
    expect(textOf(err)).toContain("unknown_view");
    expect(isError(err)).toBe(true);

    // An open replaces the older error; no error left.
    const opened = nextStrip(err, {
      kind: "opened",
      title: "Drive 3",
      report: { missing: [], skipped: [], warnings: [] },
    });
    expect(textOf(opened)).toBe('Opened "Drive 3"');
    expect(isError(opened)).toBe(false);

    // A command error replaces a notice.
    const after = nextStrip(opened, { kind: "error", text: "cursor_off: B is off" });
    expect(textOf(after)).toContain("cursor_off");
    expect(isError(after)).toBe(true);

    // Dismiss empties the slot.
    expect(nextStrip(opened, { kind: "dismiss" })).toBeUndefined();
  });

  it("notices an open from elsewhere", () => {
    const push = (command: string, revision: number): LiveServerMessage =>
      ({
        type: "state",
        revision,
        command,
        workspace: ws({ name: "x", title: "Drive 3", modified: false }),
      }) as LiveServerMessage;
    const own = new Set([8]);

    // A view.open this tab did not run.
    const foreign = openedElsewhere(push("view.open", 9), own);
    expect(textOf(foreign)).toBe('"Drive 3" opened elsewhere');
    expect(isError(foreign)).toBe(false);
    // The tab's own open (its revision is one of its own results).
    expect(openedElsewhere(push("view.open", 8), own)).toBeUndefined();
    // Another command.
    expect(openedElsewhere(push("window.create", 10), own)).toBeUndefined();
  });
});

// Opened elsewhere, own open versus foreign push (design V7 "How a tab learns a push was not its
// own"). App.tsx keeps this protocol in a ref; this harness restates it on the real
// `applyLiveMessage` and `openedElsewhere`, so it pins the protocol, not the component wiring.
describe("opened elsewhere, push before the HTTP answer", () => {
  const openPush = (revision: number, title: string): LiveServerMessage =>
    ({
      type: "state",
      revision,
      command: "view.open",
      workspace: ws({ name: "x", title, modified: false }),
    }) as LiveServerMessage;

  function makeTab() {
    let live: LiveState = { connected: true, revision: 0, workspace: EMPTY_WORKSPACE } as LiveState;
    const own = { pending: 0, revisions: new Set<number>() };
    let decided: number | undefined;
    const notices: (string | undefined)[] = [];
    const decide = () => {
      const push = live.lastOpen;
      if (!push || own.pending > 0 || decided === push.revision) return;
      decided = push.revision;
      const text = openedElsewhere(push, own.revisions);
      if (text !== undefined) notices.push(text);
    };
    return {
      notices,
      push(m: LiveServerMessage) {
        live = applyLiveMessage(live, m);
        decide();
      },
      /** An own open (menu row, Before last open, import): in flight until its answer. */
      startOpen() {
        own.pending++;
      },
      answer(revision: number) {
        own.revisions.add(revision);
        own.pending--;
        decide();
      },
    };
  }

  for (const source of ["menu row", "Before last open", "import with open"]) {
    it(`own open by ${source}: push first, answer later, no notice`, () => {
      const tab = makeTab();
      tab.startOpen();
      tab.push(openPush(5, "Drive 3"));
      expect(tab.notices).toEqual([]); // waits while the open is in flight
      tab.answer(5);
      expect(tab.notices).toEqual([]); // revision 5 is its own
    });
  }

  it("own open: answer first, push later, no notice", () => {
    const tab = makeTab();
    tab.startOpen();
    tab.answer(5);
    tab.push(openPush(5, "Drive 3"));
    expect(tab.notices).toEqual([]);
  });

  it("foreign push gives one notice, also when it arrives during an own open", () => {
    const tab = makeTab();
    tab.push(openPush(6, "Speeds"));
    expect(tab.notices).toEqual(['"Speeds" opened elsewhere']);
    tab.startOpen();
    tab.push(openPush(7, "Other"));
    expect(tab.notices).toHaveLength(1); // held back
    tab.answer(8); // own open got revision 8; 7 was foreign
    expect(tab.notices).toEqual(['"Speeds" opened elsewhere', '"Other" opened elsewhere']);
  });
});
