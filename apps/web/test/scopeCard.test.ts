import { readFileSync } from "node:fs";
import {
  type CommandInput,
  type CommandResult,
  EMPTY_WORKSPACE,
  type Workspace,
} from "@kipscope/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SeriesCache } from "../src/chart/cache.ts";
import { SeriesLoader } from "../src/chart/loader.ts";
import { ScopeCard, scopeCardFields, submitScope } from "../src/help/ScopeCard.tsx";
import { NO_SCOPE } from "../src/time/scope.ts";

// Spec scope "Scope card": in scoped mode a workspace without a scope shows a "Set a scope" card;
// its windows meanwhile send nothing and report no error. Tests run with TZ=Europe/Berlin: CEST
// (UTC+2) on 2026-10-01. Every expected value is computed by hand from the instants.

const S = 1_000_000_000n;
const MIN = 60n * S;
const H = 60n * MIN;
/** 2026-10-01T01:00:00Z = 1790816400 s, by hand. */
const T1 = 1790816400n * S;

/** A workspace without scope whose window w1 shows testcar/Fast_100h.SIG_A over [T1 + 10 min, T1 + 20 min). */
const workspace: Workspace = {
  ...EMPTY_WORKSPACE,
  nextId: 2,
  windows: [
    {
      id: "w1",
      kind: "timeseries",
      range: { from: (T1 + 10n * MIN).toString(), to: (T1 + 20n * MIN).toString() },
      display: { mode: "line", envelope: false },
      signals: [{ id: "a1", signalId: "testcar/Fast_100h.SIG_A" }],
    },
  ],
};

describe("Scope card", () => {
  it("prefills the scope from the windows and shows a refusal", async () => {
    // Pad 1 h: [T1 + 10 min - 1 h, T1 + 20 min + 1 h) = [T1 - 50 min, T1 + 80 min), that is
    // 00:10Z - 02:20Z = 02:10 - 04:20 local (CEST).
    const html = renderToStaticMarkup(
      createElement(ScopeCard, {
        workspace,
        pad: H,
        onCommand: async () => ({ ok: true, revision: 1 }) as CommandResult,
      }),
    );
    // The fields read the data ref and the local text of both times.
    expect(html).toContain('value="testcar"');
    expect(html).toMatch(/value="2026-10-01 02:10/);
    expect(html).toMatch(/value="2026-10-01 04:20/);
    // The card, its button and the two hint lines.
    expect(html).toContain("Set a scope");
    expect(html).toContain("Set scope");
    expect(html).toContain("Open a session from the search tool, or drop a catalog file here.");
    expect(html).toContain(
      "CLI: kipscope scope set REF FROM TO · kipscope case drives REF FROM TO",
    );
    // The data ref field suggests the workspace's data refs.
    expect(html).toMatch(/<datalist[^>]*>\s*<option value="testcar"/);

    // The click sends exactly one scope.set with those fields (T1 - 50 min = 1790813400 s and
    // T1 + 80 min = 1790821200 s).
    const message =
      "too wide: 230,000,000 rows, more than the 150,000,000 a query may read; choose a shorter range";
    const sent: CommandInput[] = [];
    const refuse = async (command: CommandInput): Promise<CommandResult> => {
      sent.push(command);
      return { ok: false, code: "too_wide", message } as CommandResult;
    };
    const fields = scopeCardFields(workspace, H);
    expect(fields.dataRef).toBe("testcar");
    const shown = await submitScope(fields, refuse);
    expect(sent).toEqual([
      {
        type: "scope.set",
        dataRef: "testcar",
        from: "1790813400000000000",
        to: "1790821200000000000",
      },
    ]);
    // The message shows under the button, and the fields keep their text (the call changes none).
    expect(shown).toBe(message);
    expect(fields).toEqual(scopeCardFields(workspace, H));

    // An accepted scope.set shows nothing (the card goes with the scope).
    expect(
      await submitScope(fields, async () => ({ ok: true, revision: 2 }) as CommandResult),
    ).toBeUndefined();

    // What the user typed is read as `kipscope` reads times: local time without an offset.
    sent.length = 0;
    await submitScope(
      { dataRef: " testcar ", from: "2026-10-01 03:00", to: "2026-10-01 04:00" },
      refuse,
    );
    expect(sent).toEqual([
      {
        type: "scope.set",
        dataRef: "testcar",
        from: T1.toString(),
        to: (T1 + H).toString(),
      },
    ]);

    // Fields that make no command show why, and send nothing.
    sent.length = 0;
    const none = vi.fn(refuse);
    expect(
      await submitScope({ dataRef: "", from: "2026-10-01 03:00", to: "2026-10-01 04:00" }, none),
    ).toBeTruthy();
    expect(
      await submitScope({ dataRef: "testcar", from: "yesterday", to: "now" }, none),
    ).toBeTruthy();
    expect(
      await submitScope(
        { dataRef: "testcar", from: "2026-10-01 04:00", to: "2026-10-01 03:00" },
        none,
      ),
    ).toBeTruthy();
    expect(none).not.toHaveBeenCalled();
  });

  it("prefills nothing without a window that has a signal", () => {
    expect(scopeCardFields(EMPTY_WORKSPACE, H)).toEqual({ dataRef: "", from: "", to: "" });
    const html = renderToStaticMarkup(
      createElement(ScopeCard, {
        workspace: EMPTY_WORKSPACE,
        pad: H,
        onCommand: async () => ({ ok: true, revision: 1 }) as CommandResult,
      }),
    );
    expect(html).toContain("Set a scope");
  });

  it("keeps windows quiet without a scope", async () => {
    // Scoped mode without a scope: a timeseries window shows `No scope set` in the muted colour,
    // sends no series request and reports no error. There is no DOM in the tests, so this reads
    // the window's source as the legend tests do, and runs the loader the way the window drives it.
    expect(NO_SCOPE).toBe("No scope set");
    const src = readFileSync(new URL("../src/chart/TimeseriesWindow.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../src/chart/window.css", import.meta.url), "utf8");
    const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    // The plot's only content is the note.
    expect(src).toMatch(/\{noScope && <span className="plot-note">\{NO_SCOPE\}<\/span>\}/);
    expect(css).toMatch(/\.plot-note\s*\{[^}]*color:\s*var\(--muted\)/);
    // No request: the loader's and the value loader's requests are empty, whatever the window shows.
    expect(src).toMatch(/width === 0 \|\| noScope\s*\?\s*\[\]/);
    expect(src).toMatch(/noScope \? \[\] : requestable/);
    // No error and no wait: the window is settled without a width, and the status cell is empty.
    expect(src).toMatch(/\(width > 0 \|\| noScope\)/);
    expect(src).toMatch(/: noScope\s*\? ""/);
    // The app decides: scoped mode and no scope.
    expect(app).toMatch(/meta\.meta\?\.catalog\.mode === "scoped" && !workspace\?\.scope/);
    expect(app).toMatch(/noScope=\{noScope\}/);

    // Driven with no request, the loader asks nothing, is settled and holds no error.
    const fetchSeries = vi.fn();
    const loader = new SeriesLoader(new SeriesCache(fetchSeries, { now: () => 1 }), () => {}, {
      retry: true,
    });
    loader.update([]);
    expect(fetchSeries).not.toHaveBeenCalled();
    expect(loader.settled([])).toBe(true);
    loader.dispose();
  });
});
