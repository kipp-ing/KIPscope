import { describe, expect, it } from "vitest";
import { applyCommand } from "../src/apply.ts";
import {
  alignPoint,
  CASES_KIND,
  CASES_VERSION,
  type CaseAlign,
  CasesDocument,
  caseDataRef,
  caseScope,
  casesLinkUrl,
  decodeCasesLink,
  encodeCasesLink,
  eventMatchOf,
  firstMatch,
  isSignedCases,
  MAX_CASES,
  matchesEvent,
  parseCasesDocument,
  rebindSignalId,
  workWindow,
} from "../src/case.ts";
import { openCase } from "../src/caseApply.ts";
import type { DiagEvent } from "../src/events.ts";
import { scopeKey } from "../src/scope.ts";
import { MAX_LINK_CHARS } from "../src/views.ts";
import { Command, EMPTY_WORKSPACE, type Workspace, type WorkspaceScope } from "../src/workspace.ts";
import { at, B, C4, C4_DOC, DAY, entryAt, NS, PAD } from "./caseFixtures.ts";
import { TESTCAR_EVENTS } from "./testEvents.ts";

/** The message of a refused catalog; fails when it was accepted. */
function refusal(doc: unknown, options?: Parameters<typeof parseCasesDocument>[1]): string {
  const parsed = parseCasesDocument(doc, options);
  if (parsed.ok) throw new Error("expected the document to be refused");
  expect(parsed.code).toBe("invalid_catalog");
  return parsed.message;
}

const withCases = (cases: unknown[], extra: Record<string, unknown> = {}) => ({
  kipscope: "cases",
  version: 1,
  ...extra,
  cases,
});
const s = (i: number) => C4_DOC.cases[i] as Record<string, unknown>;

describe("catalog document", () => {
  it("parses a catalog document", () => {
    expect(CASES_KIND).toBe("cases");
    expect(CASES_VERSION).toBe(1);
    const parsed = parseCasesDocument(C4_DOC);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.current).toBe(0);
    expect(parsed.pad).toBe(60n * NS);
    expect(parsed.align).toEqual({ mode: "start" });
    expect(parsed.entries.map((e) => e.id)).toEqual(C4_DOC.cases.map((c) => c.id));
    expect(parsed.entries.map((e) => e.dataRef)).toEqual([
      "testcar",
      "othercar",
      "testcar",
      "testcar",
    ]);
    expect(parsed.entries[0]?.from).toBe("1790816400000000000");
    expect(parsed.entries[0]?.to).toBe("1790817000000000000");
    expect(parsed.entries[2]?.anchor).toBe("1790830500000000000");
    expect(parsed.entries[0]?.meta).toEqual({ distance_km: 6.2 });
    expect("extra" in parsed).toBe(false);
    expect(parsed.entries.every((e) => !("extra" in e))).toBe(true);
    // The schema itself drops the unknown key.
    const schema = CasesDocument.parse(C4_DOC);
    expect("extra" in schema).toBe(false);
    expect(schema.cases).toHaveLength(4);
  });

  it("refuses bad catalogs", () => {
    expect(refusal(withCases([]))).toMatch(/^cases\b/);
    const many = Array.from({ length: MAX_CASES + 1 }, (_, i) => ({
      id: `s${i}`,
      object: "testcar",
      from: "2026-10-01T01:00:00Z",
      to: "2026-10-01T01:10:00Z",
    }));
    expect(MAX_CASES).toBe(2_000);
    expect(refusal(withCases(many))).toMatch(/^cases\b/);
    expect(refusal(withCases([s(0), { ...s(1), to: s(1).from }, s(2)]))).toMatch(
      /^cases\[1\]\.to\b/,
    );
    expect(refusal(withCases([s(0), s(1), { ...s(2), anchor: "2026-10-01T05:10:01Z" }]))).toMatch(
      /^cases\[2\]\.anchor\b/,
    );
    expect(refusal({ ...C4_DOC, current: 4 })).toMatch(/^current\b/);
    expect(refusal({ ...C4_DOC, pad: "2d" })).toMatch(/^pad\b/);
    const meta = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`k${i}`, i]));
    expect(refusal(withCases([{ ...s(0), meta }]))).toMatch(/^cases\[0\]\.meta\b/);
  });

  it("accepts a pad inside 0 … 1 d and refuses outside it", () => {
    const pad = (text: string) => parseCasesDocument({ ...C4_DOC, pad: text });
    expect(pad("0s")).toMatchObject({ ok: true, pad: 0n });
    expect(pad("90s")).toMatchObject({ ok: true, pad: 90n * NS });
    expect(pad("24h")).toMatchObject({ ok: true, pad: 86_400n * NS });
    expect(pad("25h").ok).toBe(false);
    expect(pad("-1s").ok).toBe(false);
  });

  it("takes the default pad and the data ref template from the reader", () => {
    const parsed = parseCasesDocument(C4_DOC, { template: "fleet-{object}", defaultPad: 5n * NS });
    expect(parsed).toMatchObject({ ok: true, pad: 5n * NS });
    if (!parsed.ok) return;
    expect(parsed.entries.map((e) => e.dataRef)).toEqual([
      "fleet-testcar",
      "fleet-othercar",
      "fleet-testcar",
      "fleet-testcar",
    ]);
    // A document pad wins over the default.
    expect(parseCasesDocument({ ...C4_DOC, pad: "2min" }, { defaultPad: 5n * NS })).toMatchObject({
      ok: true,
      pad: 120n * NS,
    });
  });

  it("refuses a data ref that is not valid", () => {
    expect(refusal(withCases([{ ...s(0), object: "a/b" }]))).toMatch(/^cases\[0\]/);
  });

  it("accepts the catalog fields align, view and origin", () => {
    const parsed = parseCasesDocument({
      ...C4_DOC,
      current: 2,
      pad: "30s",
      align: { mode: "event", event: { kind: "dtc", source: "BMS", name: "P0CA700" } },
      view: "my-view",
      origin: { tool: "KI.ping", url: "https://kiping.example/#f=1", set: "abc" },
    });
    expect(parsed).toMatchObject({
      ok: true,
      current: 2,
      pad: 30n * NS,
      align: { mode: "event", event: { kind: "dtc", source: "BMS", name: "P0CA700" } },
      view: "my-view",
      origin: { tool: "KI.ping", url: "https://kiping.example/#f=1", set: "abc" },
    });
    expect(parseCasesDocument({ ...C4_DOC, align: { mode: "middle" } }).ok).toBe(false);
    expect(parseCasesDocument({ ...C4_DOC, view: "not a view name!" }).ok).toBe(false);
  });
});

describe("object to data ref", () => {
  it("maps objects to data refs by the template", () => {
    expect(caseDataRef("{object}", "TESTVIN0000000001")).toBe("TESTVIN0000000001");
    expect(caseDataRef("fleet-{object}", "F-104")).toBe("fleet-F-104");
    expect(caseDataRef("{object}/{object}", "A")).toBe("A/A");
  });
});

describe("case scope and alignment", () => {
  it("builds the scope of a session with the pad", () => {
    expect(caseScope(entryAt(0), PAD)).toEqual({
      dataRef: "testcar",
      from: at(0, 59),
      to: at(1, 11),
    });
    expect(caseScope(entryAt(1), PAD)).toEqual({
      dataRef: "othercar",
      from: String((B - 60n) * NS),
      to: String((B + 61n) * NS),
    });
    expect(caseScope(entryAt(2), 0n)).toEqual({
      dataRef: "testcar",
      from: at(4, 50),
      to: at(5, 10),
    });
  });

  it("clamps the scope of a session to the time bounds", () => {
    const edge = { ...entryAt(0), from: "-2208988800000000000", to: "9223286400000000000" };
    const scope = caseScope(edge, PAD);
    expect(scope.from).toBe("-2208988800000000000");
    expect(scope.to).toBe("9223286400000000000");
  });

  it("computes the alignment point", () => {
    expect(alignPoint(entryAt(2), { mode: "start" })).toEqual({ t: at(4, 50), fallback: false });
    expect(alignPoint(entryAt(2), { mode: "end" })).toEqual({ t: at(5, 10), fallback: false });
    expect(alignPoint(entryAt(2), { mode: "anchor" })).toEqual({ t: at(4, 55), fallback: false });
    expect(alignPoint(entryAt(0), { mode: "anchor" })).toEqual({ t: at(1, 0), fallback: true });
  });

  it("leaves event mode to the server: the start with fallback", () => {
    const align: CaseAlign = {
      mode: "event",
      event: { kind: "dtc", source: "BMS", name: "P0CA700" },
    };
    expect(alignPoint(entryAt(2), align)).toEqual({ t: at(4, 50), fallback: true });
  });

  const dtc = TESTCAR_EVENTS.find((e) => e.name === "P0CA700") as DiagEvent;
  const change = (text: string, t: string): DiagEvent => ({
    t,
    category: "change",
    kind: "state",
    source: "VCU",
    name: "Ign_A20h.MODE",
    text,
    detail: "from NONE",
    value: 0,
  });

  it("matches events", () => {
    const dtcMatch = eventMatchOf(dtc);
    expect(dtcMatch).toEqual({ kind: "dtc", source: "BMS", name: "P0CA700" });
    expect("text" in dtcMatch).toBe(false);
    const keyon = change("KEYON", at(1, 10));
    const keyonMatch = eventMatchOf(keyon);
    expect(keyonMatch).toEqual({
      kind: "state",
      source: "VCU",
      name: "Ign_A20h.MODE",
      text: "KEYON",
    });
    expect(matchesEvent(keyon, keyonMatch)).toBe(true);
    expect(matchesEvent(change("NONE", at(2, 0)), keyonMatch)).toBe(false);
    expect(matchesEvent(dtc, dtcMatch)).toBe(true);
    expect(matchesEvent(keyon, dtcMatch)).toBe(false);
    // A match without text ignores the event's text.
    expect(matchesEvent({ ...dtc, text: "other words" }, dtcMatch)).toBe(true);
  });

  it("finds the first matching event inside a scope", () => {
    const match = eventMatchOf(dtc);
    const events: DiagEvent[] = [
      { ...dtc, t: at(4, 30) },
      { ...dtc, t: at(5, 0) },
      { ...dtc, t: at(5, 5) },
      { ...dtc, name: "OTHER", t: at(4, 52) },
    ];
    const scope2 = caseScope(entryAt(2), PAD);
    expect(firstMatch(events, match, scope2)?.t).toBe(at(5, 0));
    expect(firstMatch(events, match, caseScope(entryAt(0), PAD))).toBeUndefined();
    // [from, to): an event at the scope's end does not count.
    const atEnd = [{ ...dtc, t: scope2.to }];
    expect(firstMatch(atEnd, match, scope2)).toBeUndefined();
    const atStart = [{ ...dtc, t: scope2.from }];
    expect(firstMatch(atStart, match, scope2)?.t).toBe(scope2.from);
  });

  it("rebinds a signal ID to another data ref", () => {
    expect(rebindSignalId("testcar/Fast_100h.SIG_A", "othercar")).toBe("othercar/Fast_100h.SIG_A");
    expect(rebindSignalId("a/b.c", "a")).toBe("a/b.c");
  });
});

describe("work window", () => {
  const scope: WorkspaceScope = {
    dataRef: "longcar",
    from: String(BigInt(Date.UTC(2025, 7, 1, 6)) * 1_000_000n), // 2025-08-01T06:00Z
    to: String(BigInt(Date.UTC(2026, 8, 5, 6)) * 1_000_000n), // 2026-09-05T06:00Z, 400 d
    object: true,
  };
  const ms = (y: number, m: number, d: number, h = 0, min = 0) =>
    BigInt(Date.UTC(y, m - 1, d, h, min)) * 1_000_000n;
  const range = (from: bigint, to: bigint) => ({ from: String(from), to: String(to) });

  it("computes the work window", () => {
    // 10 min at 2026-06-10 12:00 → ±1 d, on day edges: three days.
    expect(workWindow(range(ms(2026, 6, 10, 12), ms(2026, 6, 10, 12, 10)), scope)).toEqual(
      range(ms(2026, 6, 9), ms(2026, 6, 12)),
    );
    // A 3-day view: ±3 d → nine days.
    expect(workWindow(range(ms(2026, 6, 10), ms(2026, 6, 13)), scope)).toEqual(
      range(ms(2026, 6, 7), ms(2026, 6, 16)),
    );
    // A 90-day view: 30 days centred on the view, widened to whole days (31 or 32 days).
    const view = range(ms(2026, 1, 1), ms(2026, 4, 1));
    const wide = workWindow(view, scope);
    const days = (BigInt(wide.to) - BigInt(wide.from)) / DAY;
    expect(days === 31n || days === 32n || days === 30n).toBe(true);
    expect(BigInt(wide.to) - BigInt(wide.from)).toBeLessThanOrEqual(32n * DAY);
    expect(BigInt(wide.from) % DAY).toBe(0n);
    expect(BigInt(wide.to) % DAY).toBe(0n);
    const centre = (BigInt(view.from) + BigInt(view.to)) / 2n;
    expect(BigInt(wide.from)).toBeLessThanOrEqual(centre - 15n * DAY);
    expect(BigInt(wide.to)).toBeGreaterThanOrEqual(centre + 15n * DAY);
    // 2 h after the scope's start the window starts at the scope's from.
    const near = workWindow(range(ms(2025, 8, 1, 8), ms(2025, 8, 1, 8, 10)), scope);
    expect(near).toEqual({ from: scope.from, to: String(ms(2025, 8, 3)) });
  });

  it("never leaves the scope", () => {
    const late = workWindow(range(ms(2026, 9, 5, 5), ms(2026, 9, 5, 5, 30)), scope);
    expect(late.to).toBe(scope.to);
    expect(BigInt(late.from)).toBeGreaterThanOrEqual(BigInt(scope.from));
  });

  it("keys an object scope apart", () => {
    const plain: WorkspaceScope = { dataRef: "testcar", from: "1", to: "2" };
    const object: WorkspaceScope = { ...plain, object: true };
    expect(scopeKey(plain)).toBe("testcar|1|2");
    expect(scopeKey(object)).not.toBe(scopeKey(plain));
    expect(scopeKey(object).endsWith("|object")).toBe(true);
    expect(scopeKey(undefined)).toBe("");
  });
});

describe("catalog link", () => {
  it("round-trips a document through the link code", async () => {
    const doc = CasesDocument.parse(C4_DOC);
    const code = await encodeCasesLink(doc);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await decodeCasesLink(code)).toEqual(JSON.parse(JSON.stringify(doc)));
  });

  it("refuses bad codes", async () => {
    await expect(decodeCasesLink("not a code!")).rejects.toThrow();
    await expect(decodeCasesLink("AAAA")).rejects.toThrow();
  });

  it("inflates at most the limit", async () => {
    // 6 MB of zeros deflates to ~6 kB: a bomb well over MAX_CASES_JSON (4 MiB).
    const zeros = new Uint8Array(6 * 1024 * 1024);
    const packed = await new Response(
      new Blob([zeros]).stream().pipeThrough(new CompressionStream("deflate-raw")),
    ).arrayBuffer();
    let binary = "";
    for (const byte of new Uint8Array(packed)) binary += String.fromCharCode(byte);
    const code = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    await expect(decodeCasesLink(code)).rejects.toThrow();
  });

  it("tells a JWS from other strings and builds the url", () => {
    expect(isSignedCases("aaa.bbb.ccc")).toBe(true);
    expect(isSignedCases("aaa.bbb")).toBe(false);
    expect(isSignedCases("abcDEF-_0123")).toBe(false);
    expect(casesLinkUrl("https://kipscope.example", "CODE")).toBe(
      "https://kipscope.example/open#cases=CODE",
    );
    expect(MAX_LINK_CHARS).toBe(8_192);
  });
});

describe("openCase", () => {
  const known = (id: string) => id.startsWith("testcar/") || id.startsWith("othercar/");
  const ctx = { signalExists: known, hasStates: () => false };

  /** A layout workspace: w1 on the two signals at [from, to). */
  function layout(from: string, to: string): Workspace {
    let ws = EMPTY_WORKSPACE;
    const run = (input: Parameters<typeof Command.parse>[0]) => {
      const r = applyCommand(ws, Command.parse(input), ctx);
      if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
      ws = r.workspace;
    };
    run({ type: "window.create", from, to });
    run({ type: "window.addSignal", windowId: "w1", signalId: "testcar/Fast_100h.SIG_A" });
    run({ type: "window.addSignal", windowId: "w1", signalId: "testcar/Irr_200h.JITTER" });
    return ws;
  }

  it("opens a case with the latest workspace's layout", () => {
    const { workspace, missing } = openCase({
      catalog: C4,
      current: 2,
      pad: PAD,
      align: { mode: "anchor" },
      alignAt: at(4, 55),
      layout: layout(at(1, 2), at(1, 4)),
      layoutAlignAt: at(1, 0),
      known,
    });
    expect(missing).toEqual([]);
    expect(workspace.scope).toEqual({ dataRef: "testcar", from: at(4, 49), to: at(5, 11) });
    expect(workspace.windows[0]).toMatchObject({
      id: "w1",
      kind: "timeseries",
      range: { from: at(4, 57), to: at(4, 59) },
    });
    expect(workspace.case).toMatchObject({
      catalogId: "c4c4c4c4c4",
      count: 4,
      current: 2,
      linked: true,
      pad: "60000000000",
      align: { mode: "anchor" },
      alignAt: "1790830500000000000",
      entry: entryAt(2),
    });
    expect(workspace.case?.linkedRanges).toBeUndefined();
  });

  it("shows the whole scope when the layout had no case", () => {
    const { workspace } = openCase({
      catalog: C4,
      current: 0,
      pad: PAD,
      align: { mode: "start" },
      alignAt: at(1, 0),
      layout: layout(at(7, 0), at(8, 0)),
      known,
    });
    expect(workspace.scope).toEqual({ dataRef: "testcar", from: at(0, 59), to: at(1, 11) });
    expect(workspace.windows[0]).toMatchObject({ range: { from: at(0, 59), to: at(1, 11) } });
  });

  it("opens an empty workspace without a layout and lists unknown signals", () => {
    const empty = openCase({
      catalog: C4,
      current: 1,
      pad: PAD,
      align: { mode: "start" },
      alignAt: at(0, 0),
      known,
    });
    expect(empty.workspace.windows).toEqual([]);
    expect(empty.workspace.scope?.dataRef).toBe("othercar");
    const partial = openCase({
      catalog: C4,
      current: 0,
      pad: PAD,
      align: { mode: "start" },
      alignAt: at(1, 0),
      layout: layout(at(1, 2), at(1, 4)),
      layoutAlignAt: at(1, 0),
      known: (id) => id === "testcar/Fast_100h.SIG_A",
    });
    expect(partial.missing).toEqual(["testcar/Irr_200h.JITTER"]);
    // A missing signal stays in its window.
    expect(partial.workspace.windows[0]).toMatchObject({
      signals: [{ signalId: "testcar/Fast_100h.SIG_A" }, { signalId: "testcar/Irr_200h.JITTER" }],
    });
  });
});
