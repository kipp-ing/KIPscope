import { GRANT_ALL, GRANT_NONE, type Grant } from "@kipscope/shared";
import { describe, expect, it } from "vitest";
import { Catalog } from "../src/catalog.ts";
import type { DataSource, Scope, SignalRef } from "../src/datasource.ts";
import {
  catalogView,
  covers,
  dataRefsOfCommand,
  dataRefsOfView,
  effectiveGrant,
  grantedOf,
  initialGrant,
  workspaceRights,
} from "../src/rights.ts";

const T1 = "1790816400000000000";
const T2 = "1790820000000000000";

const grant = (...objects: string[]): Grant => ({ objects });

describe("grants (data-access)", () => {
  it("covers data refs by grant", () => {
    // Hand-written table: `all` covers any ref; a list covers exactly its members.
    expect(covers({ objects: "all" }, "x")).toBe(true);
    const two = grant("testcar", "demo");
    expect(
      ["testcar", "demo", "testcar2", "TESTCAR", "test*"].map((ref) => covers(two, ref)),
    ).toEqual([true, true, false, false, false]);
    expect(covers({ objects: [] }, "testcar")).toBe(false);
    // Nothing but an exact match counts: no prefix, no pattern character, no whitespace.
    expect(covers(grant("a.b"), "aXb")).toBe(false);
    expect(covers(grant("px-*"), "px-01")).toBe(false);
    expect(covers(grant("demo"), "demo ")).toBe(false);
  });

  it("derives the effective and initial grant from the identity kind", () => {
    const all: Grant = { objects: "all" };
    const some: Grant = { objects: ["a"] };
    expect(effectiveGrant(all, "none")).toEqual({ objects: "all" });
    expect(effectiveGrant(some, "none")).toEqual({ objects: "all" });
    // A stored `all` never grants on a server; a stored list stays as it is.
    expect(effectiveGrant(all, "oidc")).toEqual({ objects: [] });
    expect(effectiveGrant(some, "oidc")).toEqual({ objects: ["a"] });
    expect(effectiveGrant(all, "module")).toEqual({ objects: [] });
    expect(initialGrant("none")).toEqual({ objects: "all" });
    expect(initialGrant("module")).toEqual({ objects: [] });
    expect(initialGrant("oidc")).toEqual({ objects: [] });
    expect(GRANT_ALL).toEqual({ objects: "all" });
    expect(GRANT_NONE).toEqual({ objects: [] });
  });

  it("tells a client how much is granted", () => {
    expect(grantedOf({ objects: "all" })).toBe("all");
    expect(grantedOf({ objects: [] })).toBe(0);
    expect(grantedOf(grant("a", "b", "c"))).toBe(3);
  });
});

describe("data refs of views and commands", () => {
  const doc = (over: Record<string, unknown> = {}) => ({
    kipscope: "view",
    version: 1,
    title: "x",
    data: [],
    linkTime: true,
    cursors: { diff: false },
    digits: 3,
    windows: [
      {
        kind: "timeseries",
        from: "2026-10-01T01:00:00Z",
        to: "2026-10-01T02:00:00Z",
        mode: "lines",
        envelope: false,
        signals: ["testcar/A"],
      },
      { kind: "values", mode: "last", signals: ["othercar/B"] },
    ],
    ...over,
  });

  it("lists the data refs of a view document from its content, not from its `data` list", () => {
    // The informational `data` list is empty here and a lie in the next call: never trusted.
    expect(dataRefsOfView(doc()).sort()).toEqual(["othercar", "testcar"]);
    expect(dataRefsOfView(doc({ data: ["testcar"] })).sort()).toEqual(["othercar", "testcar"]);
    const full = doc({
      scope: { dataRef: "scopecar", from: "2026-10-01T01:00:00Z", to: "2026-10-01T02:00:00Z" },
      events: { signals: ["evcar/E1"] },
    });
    expect(dataRefsOfView(full).sort()).toEqual(["evcar", "othercar", "scopecar", "testcar"]);
  });

  it("reads what it can from a malformed view document and never throws", () => {
    for (const garbage of [
      undefined,
      null,
      42,
      "text",
      [],
      {},
      { windows: "x" },
      { windows: [null] },
    ]) {
      expect(() => dataRefsOfView(garbage), JSON.stringify(garbage)).not.toThrow();
      expect(dataRefsOfView(garbage), JSON.stringify(garbage)).toEqual([]);
    }
    // A broken window does not hide the data refs of the others.
    const partly = doc({
      windows: [null, { kind: "values", mode: "last", signals: ["othercar/B", 7, null] }],
    });
    expect(dataRefsOfView(partly)).toEqual(["othercar"]);
  });

  it("lists the data refs a command names", () => {
    const of = (command: Record<string, unknown>) => dataRefsOfCommand(command as never).sort();
    expect(of({ type: "window.addSignal", windowId: "w1", signalId: "othercar/X" })).toEqual([
      "othercar",
    ]);
    expect(of({ type: "events.addSignal", signalId: "othercar/X" })).toEqual(["othercar"]);
    expect(of({ type: "scope.set", dataRef: "othercar", from: T1, to: T2 })).toEqual(["othercar"]);
    expect(of({ type: "view.open", view: doc() })).toEqual(["othercar", "testcar"]);
    // An explicit scope on view.open is a data ref the command names too (it is loaded and set).
    expect(
      of({ type: "view.open", view: doc(), scope: { dataRef: "scopecar", from: T1, to: T2 } }),
    ).toEqual(["othercar", "scopecar", "testcar"]);
    // Commands that name no data ref.
    expect(of({ type: "window.create" })).toEqual([]);
    expect(of({ type: "cursor.set", cursor: "a", t: "5" })).toEqual([]);
    expect(of({ type: "window.removeSignal", windowId: "w1", assignmentId: "a1" })).toEqual([]);
    expect(of({ type: "scope.clear" })).toEqual([]);
  });
});

describe("workspace rights", () => {
  /** An entry reduced to what `workspaceRights` reads. */
  const entry = (owner: string, share: "private" | "read" | "write") =>
    ({ record: { id: "aaaaaaaaaa", owner, share } }) as unknown as Parameters<
      typeof workspaceRights
    >[1];

  it("derives workspace rights from owner and share level", () => {
    // Hand-written table of the spec.
    expect(workspaceRights("alice", entry("alice", "private"))).toEqual({
      open: true,
      change: true,
      owner: true,
    });
    expect(workspaceRights("bob", entry("alice", "private"))).toBeUndefined();
    expect(workspaceRights("bob", entry("alice", "read"))).toEqual({
      open: true,
      change: false,
      owner: false,
    });
    expect(workspaceRights("bob", entry("alice", "write"))).toEqual({
      open: true,
      change: true,
      owner: false,
    });
    // The owner keeps every right whatever the share level.
    for (const share of ["private", "read", "write"] as const)
      expect(workspaceRights("alice", entry("alice", share))?.owner, share).toBe(true);
  });
});

describe("catalog view", () => {
  const SIGNALS: SignalRef[] = [
    { dataRef: "testcar", name: "Fast_100h.SIG_A" },
    { dataRef: "testcar", name: "Fast_100h.SIG_B" },
    { dataRef: "othercar", name: "Fast_100h.SIG_A" },
    { dataRef: "othercar", name: "Secret_900h.ONLY" },
  ];
  const source = {
    listSignals: async (_scope?: Scope) => SIGNALS,
  } as unknown as DataSource;
  const catalog = new Catalog(source, async () => new Map());

  it("shows only visible signals in lookups, lists, search and counts", async () => {
    await catalog.refresh();
    const view = catalogView(catalog, grant("testcar"));
    expect(view.get("testcar/Fast_100h.SIG_A")?.id).toBe("testcar/Fast_100h.SIG_A");
    expect(view.get("othercar/Fast_100h.SIG_A")).toBeUndefined();
    expect(view.get("nosuchcar/X")).toBeUndefined();
    expect(view.all().map((s) => s.id)).toEqual([
      "testcar/Fast_100h.SIG_A",
      "testcar/Fast_100h.SIG_B",
    ]);
    expect(view.size).toBe(2);
    // Search counts visible hits only: "secret" matches one signal of othercar and none visible.
    expect(view.search("secret", 0, 50)).toEqual({ items: [], total: 0, more: false });
    const page = view.search("", 0, 50);
    expect(page.total).toBe(2);
    expect(page.items.map((s) => s.dataRef)).toEqual(["testcar", "testcar"]);
    expect(view.search("Fast", 0, 1)).toMatchObject({ total: 2, more: true });
    expect(view.loadedAt).toBe(catalog.loadedAt);
  });

  it("is the whole catalog for an all grant and empty for an empty grant", async () => {
    await catalog.refresh();
    const all = catalogView(catalog, GRANT_ALL);
    expect(all.size).toBe(4);
    expect(all.get("othercar/Secret_900h.ONLY")).toBeDefined();
    expect(all.search("", 0, 50).total).toBe(4);
    const none = catalogView(catalog, GRANT_NONE);
    expect(none.size).toBe(0);
    expect(none.all()).toEqual([]);
    expect(none.get("testcar/Fast_100h.SIG_A")).toBeUndefined();
    expect(none.search("", 0, 50)).toEqual({ items: [], total: 0, more: false });
  });

  it("answers no SNA ranges for a hidden signal", async () => {
    await catalog.refresh();
    const view = catalogView(catalog, grant("testcar"));
    expect(view.snaRanges("othercar/Fast_100h.SIG_A")).toEqual([]);
  });
});
