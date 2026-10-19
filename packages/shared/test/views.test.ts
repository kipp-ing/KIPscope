import { describe, expect, it } from "vitest";
import { applyCommand } from "../src/apply.ts";
import {
  decodeViewLink,
  encodeViewLink,
  linkViewDoc,
  parseViewDoc,
  type ViewDoc,
  viewLinkUrl,
  viewName,
  workspaceToView,
} from "../src/views.ts";
import { Command, EMPTY_WORKSPACE, type Workspace } from "../src/workspace.ts";

const ctx = {
  signalExists: (id: string) => id.startsWith("smart451/") || id.startsWith("car/"),
  hasStates: () => true,
  unitOf: (id: string) => id,
};

/** 2026-10-13T13:08:00Z = 1791896880 s (by hand: the same constant the CLI tests use). */
const T0 = 1791896880n * 1_000_000_000n;
const NS = (n: bigint) => n.toString();

/** Opens a document on `state` the way the server does. */
function openView(state: Workspace, view: unknown, name?: string) {
  return applyCommand(
    state,
    Command.parse({ type: "view.open", view, ...(name === undefined ? {} : { name }) }),
    ctx,
  );
}

const SAVED_AT = "2026-10-17T08:14:03Z";

describe("view document", () => {
  it("round-trips a workspace through a view document", () => {
    const ws: Workspace = {
      windows: [
        {
          id: "w1",
          kind: "timeseries",
          title: "Speeds",
          range: { from: NS(T0), to: NS(T0 + 20_000_000_000n) },
          display: { mode: "step", envelope: true },
          height: 360,
          signals: [
            { id: "a2", signalId: "car/A" },
            { id: "a3", signalId: "car/B" },
          ],
        },
        {
          id: "w4",
          kind: "values",
          mode: "step",
          signals: [{ id: "a5", signalId: "car/A" }],
        },
      ],
      nextId: 6,
      linkTime: true,
      colors: { "car/A": 3, "car/B": 5 },
      cursors: { a: NS(T0 + 1_500_000_000n), b: NS(T0 + 9_250_000_000n), diff: true },
      options: { digits: 4 },
      measurement: { name: "Drive 3", object: "smart451", meta: [{ key: "Driver", value: "JK" }] },
      eventFilter: "faults",
      eventSignals: ["car/MODE"],
    };

    const doc = workspaceToView(ws, { title: "Round trip", saved: SAVED_AT });
    // The document is plain data: it must survive JSON like a file or a link does.
    const wire = JSON.parse(JSON.stringify(doc));
    const parsed = parseViewDoc(wire);
    if (!parsed.ok) throw new Error(parsed.message);
    expect(parsed.warnings).toEqual([]);

    const opened = openView(ws, parsed.doc);
    if (!opened.ok) throw new Error(`${opened.code}: ${opened.message}`);
    // IDs continue from the old nextId (6): two windows and three assignments take 6 … 10, nextId ends
    // at 11. The order of numbering (windows first or interleaved) is not asserted here.
    const nw = opened.workspace;
    const ids = [
      ...nw.windows.map((w) => w.id),
      ...nw.windows.flatMap((w) => w.signals.map((s) => s.id)),
    ];
    expect(new Set(ids).size).toBe(5);
    expect(ids.map((i) => Number(i.slice(1))).sort((x, y) => x - y)).toEqual([6, 7, 8, 9, 10]);
    expect(nw.windows.every((w) => /^w\d+$/.test(w.id))).toBe(true);
    expect(nw.nextId).toBe(11);
    const stripIds = (w: Workspace["windows"][number]) => ({
      ...w,
      id: "",
      signals: w.signals.map((s) => ({ ...s, id: "" })),
    });
    expect({ ...nw, windows: nw.windows.map(stripIds), nextId: 0, view: undefined }).toEqual({
      ...ws,
      windows: ws.windows.map(stripIds),
      nextId: 0,
      view: undefined,
    });
    expect(nw.view).toEqual({ title: "Round trip", modified: false });
    expect(opened.workspace.lastZoomed).toBeUndefined();
  });

  it("derives the informational data refs, sorted and unique", () => {
    const ws: Workspace = {
      ...EMPTY_WORKSPACE,
      windows: [
        {
          id: "w1",
          kind: "values",
          mode: "line",
          signals: [
            { id: "a2", signalId: "zeta/X_1h.A" },
            { id: "a3", signalId: "alpha/X_1h.A" },
            { id: "a4", signalId: "zeta/Y_1h.B" },
          ],
        },
      ],
      nextId: 5,
    };
    const doc = workspaceToView(ws, { title: "T" });
    expect(doc.data).toEqual(["alpha", "zeta"]);
    expect(doc.kipscope).toBe("view");
    expect(doc.version).toBe(1);
    // No IDs of windows or assignments, no nextId.
    const text = JSON.stringify(doc);
    expect(text).not.toMatch(/"(?:id|nextId)"/);
    expect(text).not.toMatch(/"[wa]\d+"/);
  });

  it("keeps times exact to the nanosecond", () => {
    const ns = "1791896881500000001";
    const ws: Workspace = {
      ...EMPTY_WORKSPACE,
      cursors: { a: ns, diff: false },
    };
    const doc = workspaceToView(ws, { title: "ns" });
    expect(doc.cursors.a).toBe("2026-10-13T13:08:01.500000001Z");

    const parsed = parseViewDoc(JSON.parse(JSON.stringify(doc)));
    if (!parsed.ok) throw new Error(parsed.message);
    expect(parsed.doc.cursors.a).toBe("2026-10-13T13:08:01.500000001Z");

    const opened = openView(EMPTY_WORKSPACE, parsed.doc);
    if (!opened.ok) throw new Error(opened.message);
    expect(opened.workspace.cursors.a).toBe(ns);
  });

  it("reads times with any offset or as decimal nanoseconds and writes them back as UTC", () => {
    const base = validDoc({
      cursors: { a: "2026-10-13T15:08:01.5+02:00", b: "1791896889250000000", diff: false },
    });
    const parsed = parseViewDoc(base);
    if (!parsed.ok) throw new Error(parsed.message);
    // Opened and written again, both are UTC with the shortest fraction (design V1 example).
    const opened = openView(EMPTY_WORKSPACE, parsed.doc);
    if (!opened.ok) throw new Error(opened.message);
    expect(opened.workspace.cursors).toEqual({
      a: "1791896881500000000",
      b: "1791896889250000000",
      diff: false,
    });
    const again = workspaceToView(opened.workspace, { title: "T" });
    // Same instants in UTC; the spelling of the fraction (.5Z or .500Z) is not asserted, the design
    // example (.5Z) and toIso (.500Z) differ there.
    expect(again.cursors.a).toMatch(/^2026-10-13T13:08:01\.5(00)?Z$/);
    expect(again.cursors.b).toMatch(/^2026-10-13T13:08:09\.25(0)?Z$/);
  });

  it("reads versions and unknown keys", () => {
    // (1) valid v1
    const ok = parseViewDoc(validDoc());
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.warnings).toEqual([]);

    // (2) version 2
    const v2 = parseViewDoc(validDoc({ version: 2 }));
    expect(v2).toMatchObject({ ok: false, code: "unsupported_version" });
    if (!v2.ok) expect(v2.message).toBe("view version 2; this KIPscope reads 1");

    // (3) another kind of file
    expect(parseViewDoc(validDoc({ kipscope: "workspace" }))).toMatchObject({
      ok: false,
      code: "invalid_view",
    });

    // (4) a time that is not a time
    const bad = validDoc();
    (bad.windows as Record<string, unknown>[])[0] = {
      ...(bad.windows as Record<string, unknown>[])[0],
      from: "yesterday",
    };
    const badResult = parseViewDoc(bad);
    expect(badResult).toMatchObject({ ok: false, code: "invalid_view" });
    if (!badResult.ok) expect(badResult.message).toContain("windows.0.from");

    // (5) unknown keys: one warning each, never refused
    const extra = validDoc({ author: "jk" });
    (extra.windows as Record<string, unknown>[])[1] = {
      ...(extra.windows as Record<string, unknown>[])[1],
      colour: "red",
    };
    const extraResult = parseViewDoc(extra);
    expect(extraResult.ok).toBe(true);
    if (extraResult.ok) {
      expect(extraResult.warnings).toEqual([
        'unknown key "author" ignored',
        'unknown key "windows[1].colour" ignored',
      ]);
    }
  });

  it("refuses what is not an object and a missing or odd version", () => {
    for (const v of [null, 5, "view", []]) {
      expect(parseViewDoc(v)).toMatchObject({ ok: false, code: "invalid_view" });
    }
    for (const version of [0, -1, 1.5, "1"]) {
      expect(parseViewDoc(validDoc({ version }))).toMatchObject({
        ok: false,
        code: "invalid_view",
      });
    }
  });

  it("derives file names from titles", () => {
    expect(viewName("Hard acceleration, drive 3")).toBe("hard-acceleration-drive-3");
    expect(viewName("Übersicht Fahrt 1")).toBe("ubersicht-fahrt-1");
    expect(viewName("   ")).toBe("view");
    expect(viewName("x".repeat(120))).toBe("x".repeat(63));
    // Runs of other characters become one dash; the ends are trimmed.
    expect(viewName("  --A / B__C--  ")).toBe("a-b-c");
  });
});

describe("view links", () => {
  it("encodes views into short links", async () => {
    const doc = syntheticDoc();
    // Guard the fixture: 17 windows, 66 entries, 44 distinct IDs.
    expect(doc.windows).toHaveLength(17);
    expect(doc.windows.reduce((n, w) => n + w.signals.length, 0)).toBe(66);
    expect(new Set(doc.windows.flatMap((w) => w.signals)).size).toBe(44);

    const code = await encodeViewLink(doc);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(code.length).toBeLessThanOrEqual(2_000);
    expect(await decodeViewLink(code)).toEqual(JSON.parse(JSON.stringify(doc)));

    await expect(decodeViewLink("@@@")).rejects.toThrow();
    await expect(decodeViewLink(code.slice(0, Math.floor(code.length / 2)))).rejects.toThrow();
  });

  it("refuses a link that inflates beyond the size limit", async () => {
    // A highly compressible document of more than 256 KiB inflated is a few hundred bytes encoded.
    const big = validDoc({ note: "x".repeat(300_000) });
    const bytes = new TextEncoder().encode(JSON.stringify(big));
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    const packed = new Uint8Array(await new Response(stream).arrayBuffer());
    const code = Buffer.from(packed).toString("base64url");
    await expect(decodeViewLink(code)).rejects.toThrow();
  });
});

/** A valid v1 document as parsed JSON, with two windows; `over` replaces top-level keys. */
function validDoc(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kipscope: "view",
    version: 1,
    title: "Drive 3",
    data: ["smart451"],
    linkTime: true,
    cursors: { diff: false },
    digits: 3,
    windows: [
      {
        kind: "timeseries",
        from: "2026-10-13T13:08:00Z",
        to: "2026-10-13T13:08:20Z",
        mode: "line",
        envelope: false,
        signals: ["smart451/ICL_3A2h.SPEED_DISP"],
      },
      { kind: "values", mode: "step", signals: ["smart451/ICL_3A2h.SPEED_DISP"] },
    ],
    ...over,
  };
}

/** 17 windows, 66 entries (2 windows of 3, 15 of 4) over 44 smart451-like IDs, in a fixed order. */
function syntheticDoc(): ViewDoc {
  const id = (k: number) =>
    `smart451/${["ICL", "BS", "DCU", "BMS", "EVC", "DCDC"][k % 6]}_${(0x200 + k * 37).toString(16).toUpperCase()}h.${["SPEED_DISP", "WSPD_FL", "IgnMode", "SOC", "Temp", "Iact"][(k * 5) % 6]}_${k}`;
  const windows: ViewDoc["windows"] = [];
  let k = 0;
  for (let w = 0; w < 17; w++) {
    const size = w < 2 ? 3 : 4;
    const signals = Array.from({ length: size }, () => id(k++ % 44));
    windows.push(
      w % 5 === 4
        ? { kind: "values", mode: "step", signals }
        : {
            kind: "timeseries",
            title: `Window ${w + 1}`,
            from: "2026-10-13T13:08:00Z",
            to: "2026-10-13T13:08:20Z",
            mode: "line",
            envelope: false,
            signals,
          },
    );
  }
  const colors: Record<string, number> = {};
  for (let i = 0; i < 44; i++) colors[id(i)] = i % 10;
  return {
    kipscope: "view",
    version: 1,
    title: "Synthetic",
    saved: SAVED_AT,
    data: ["smart451"],
    linkTime: true,
    cursors: { a: "2026-10-13T13:08:01.5Z", b: "2026-10-13T13:08:09.25Z", diff: true },
    digits: 3,
    colors,
    windows,
  };
}

describe("link document", () => {
  const base: Workspace = {
    ...EMPTY_WORKSPACE,
    windows: [
      {
        id: "w1",
        kind: "values",
        mode: "line",
        signals: [{ id: "a2", signalId: "car/A" }],
      },
    ],
    nextId: 3,
  };

  it("builds the link document", async () => {
    // Title rule: view title, else measurement name, else "Shared view".
    const named: Workspace = {
      ...base,
      measurement: { name: "Drive 3" },
      view: { name: "drive-3", title: "Drive 3 view", note: "BRK_LMP first", modified: true },
    };
    const doc = linkViewDoc(named);
    expect(doc.title).toBe("Drive 3 view");
    expect(doc.note).toBe("BRK_LMP first");
    expect("saved" in doc).toBe(false);

    expect(linkViewDoc({ ...base, measurement: { name: "Drive 3" } }).title).toBe("Drive 3");
    const bare = linkViewDoc(base);
    expect(bare.title).toBe("Shared view");
    expect("note" in bare).toBe(false);
    expect("saved" in bare).toBe(false);

    // An open view without a note has no note in the document.
    const noNote = linkViewDoc({ ...base, view: { title: "Plain", modified: false } });
    expect(noNote.title).toBe("Plain");
    expect("note" in noNote).toBe(false);

    // The URL: page origin and path, query and fragment dropped, then #view=<code of linkViewDoc>.
    const url = await viewLinkUrl(named, "http://127.0.0.1:5173/app/?x=1#old");
    const prefix = "http://127.0.0.1:5173/app/#view=";
    expect(url.startsWith(prefix)).toBe(true);
    expect(url.slice(prefix.length)).toBe(await encodeViewLink(doc));
    expect(await decodeViewLink(url.slice(prefix.length))).toMatchObject({
      title: "Drive 3 view",
      note: "BRK_LMP first",
    });
    expect(await viewLinkUrl(named, "http://127.0.0.1:5173/")).toMatch(
      /^http:\/\/127\.0\.0\.1:5173\/#view=/,
    );
  });
});

describe("scope in a view document (add-scope)", () => {
  /** 2026-10-01T01:00:00Z and 02:00:00Z in ns, by hand. */
  const T1 = 1790816400000000000n;
  const T2 = 1790820000000000000n;
  const MIN = 60n * 1_000_000_000n;
  const scoped: Workspace = {
    ...EMPTY_WORKSPACE,
    windows: [
      {
        id: "w1",
        kind: "timeseries",
        range: { from: NS(T1 + 10n * MIN), to: NS(T1 + 20n * MIN) },
        display: { mode: "line", envelope: false },
        signals: [{ id: "a2", signalId: "car/A" }],
      },
    ],
    nextId: 3,
    scope: { dataRef: "car", from: NS(T1), to: NS(T2) },
  };

  it("round-trips the scope of a view", () => {
    const doc = workspaceToView(scoped, { title: "Scoped" });
    expect(doc.version).toBe(1);
    expect(doc.scope).toEqual({
      dataRef: "car",
      from: "2026-10-01T01:00:00Z",
      to: "2026-10-01T02:00:00Z",
    });
    // Written right after `data`, so the YAML and the link hold it in that place.
    const keys = Object.keys(doc);
    expect(keys[keys.indexOf("data") + 1]).toBe("scope");

    const parsed = parseViewDoc(JSON.parse(JSON.stringify(doc)));
    if (!parsed.ok) throw new Error(parsed.message);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.doc.scope).toEqual(doc.scope);
    const opened = openView(EMPTY_WORKSPACE, parsed.doc);
    if (!opened.ok) throw new Error(`${opened.code}: ${opened.message}`);
    expect(opened.workspace.scope).toEqual(scoped.scope);

    // A link carries it too.
    expect(linkViewDoc(scoped).scope).toEqual(doc.scope);
    // Without a scope the document has no `scope` key at all.
    const { scope: _scope, ...bare } = scoped;
    expect("scope" in workspaceToView(bare, { title: "Bare" })).toBe(false);
  });

  it("refuses a scope whose end is not after its start", () => {
    for (const to of ["2026-10-01T01:00:00Z", "2026-10-01T00:00:00Z"]) {
      const result = parseViewDoc(
        validDoc({ scope: { dataRef: "car", from: "2026-10-01T01:00:00Z", to } }),
      );
      expect(result).toMatchObject({ ok: false, code: "invalid_view" });
    }
    // The key is known: no unknown-key warning for a good scope.
    const good = parseViewDoc(
      validDoc({
        scope: { dataRef: "car", from: "2026-10-01T01:00:00Z", to: "2026-10-01T02:00:00Z" },
      }),
    );
    expect(good).toMatchObject({ ok: true, warnings: [] });
  });
});
