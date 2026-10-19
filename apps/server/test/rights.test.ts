import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EMPTY_WORKSPACE, type Workspace } from "@kipscope/shared";
import { afterAll, describe, expect, it } from "vitest";
import { Catalog } from "../src/catalog.ts";
import type { DataSource, Scope, SignalRef } from "../src/datasource.ts";
import {
  ALL_RIGHTS,
  canSee,
  catalogView,
  dataRefsOfCommand,
  dataRefsOfView,
  dataRefsOfWorkspace,
  hasRights,
  loadRules,
  type Rights,
  rightsOf,
  sessionRights,
} from "../src/rights.ts";
import type { Session } from "../src/sessions.ts";

const dir = mkdtempSync(join(tmpdir(), "kipscope-rights-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const rights = (data: string[], share = false): Rights => ({ data, share });
const identity = (roles: string[], user = "alice") => ({ user, roles });

describe("rules and rights (data-access)", () => {
  it("matches data-ref patterns and unions roles", () => {
    const px = rights(["px-*", "demo"]);
    // Hand-computed: `px-*` is a prefix glob over the whole ref, case-sensitive; `demo` is literal.
    expect(
      ["px-01", "px-", "apx-01", "PX-01", "demo", "demo2"].map((ref) => canSee(px, ref)),
    ).toEqual([true, true, false, false, true, false]);
    const car = rights(["car-??"]);
    expect(["car-01", "car-1"].map((ref) => canSee(car, ref))).toEqual([true, false]);

    const rules = {
      roles: [
        { role: "a", data: ["x*"], share: false },
        { role: "b", data: ["y"], share: true },
      ],
    };
    expect(rightsOf(identity(["a", "b", "zzz"]), rules)).toEqual({
      data: ["x*", "y"],
      share: true,
    });
  });

  it("treats every pattern character but * and ? literally", () => {
    // A dot is no regex dot, a bracket or a paren no group: nothing throws, nothing over-matches.
    expect(canSee(rights(["a.b"]), "a.b")).toBe(true);
    expect(canSee(rights(["a.b"]), "aXb")).toBe(false);
    expect(canSee(rights(["a(b"]), "a(b")).toBe(true);
    expect(canSee(rights(["[ab]"]), "a")).toBe(false);
    expect(canSee(rights(["[ab]"]), "[ab]")).toBe(true);
    expect(canSee(rights(["a+"]), "aaa")).toBe(false);
    expect(canSee(rights(["a|b"]), "a")).toBe(false);
    expect(canSee(rights(["^x$"]), "x")).toBe(false);
    expect(canSee(rights(["a\\d"]), "a1")).toBe(false);
    // `*` also matches nothing and spans every character, line breaks included.
    expect(canSee(rights(["*"]), "")).toBe(true);
    expect(canSee(rights(["a*"]), "a")).toBe(true);
    expect(canSee(rights(["a*z"]), "a\nz")).toBe(true);
    // The whole ref must match, not a part of it.
    expect(canSee(rights(["demo"]), "xdemo")).toBe(false);
    expect(canSee(rights(["demo"]), "demox")).toBe(false);
    expect(canSee(rights(["demo"]), "demo\n")).toBe(false);
  });

  it("matches many wildcards in time that does not blow up with the data ref", () => {
    // The data ref comes from the request, the pattern from the rules file. A glob that is turned
    // into a backtracking RegExp takes n^k steps for k wildcards: 60 characters and 5 wildcards
    // take half a second, 100 characters 14 seconds, 16 KB (a query string) never finish, and the server is single-threaded.
    const many = rights(["*a*a*a*a*a*b"]);
    const started = performance.now();
    expect(canSee(many, "a".repeat(60))).toBe(false);
    expect(canSee(many, `${"a".repeat(60)}b`)).toBe(true);
    expect(canSee(many, `${"a".repeat(5)}b`)).toBe(true);
    expect(canSee(many, `${"a".repeat(4)}b`)).toBe(false);
    expect(performance.now() - started, "ms for 60 characters").toBeLessThan(250);

    const two = rights(["px-*-*-x"]);
    const t1 = performance.now();
    expect(canSee(two, `px-${"-".repeat(16_000)}`)).toBe(false);
    expect(canSee(two, `px-${"-".repeat(16_000)}x`)).toBe(true);
    expect(performance.now() - t1, "ms for 16 KB").toBeLessThan(500);
  });

  it("has no data without a pattern and ALL_RIGHTS sees everything", () => {
    expect(canSee(rights([]), "testcar")).toBe(false);
    expect(hasRights(rights([]))).toBe(false);
    expect(hasRights(rights([], true))).toBe(false);
    expect(hasRights(rights(["x"]))).toBe(true);
    expect(ALL_RIGHTS).toEqual({ data: ["*"], share: true });
    expect(canSee(ALL_RIGHTS, "anything-at-all")).toBe(true);
  });

  it("denies by default when no rule matches the roles", () => {
    const rules = { roles: [{ role: "a", data: ["x*"], share: true }] };
    // Roles are case-sensitive and compared whole.
    expect(rightsOf(identity(["nobody"]), rules)).toEqual({ data: [], share: false });
    expect(rightsOf(identity([]), rules)).toEqual({ data: [], share: false });
    expect(rightsOf(identity(["A"]), rules)).toEqual({ data: [], share: false });
    expect(rightsOf(identity(["a "]), rules)).toEqual({ data: [], share: false });
    expect(hasRights(rightsOf(identity(["nobody"]), rules))).toBe(false);
  });

  it("gives the share right only through a rule that has it", () => {
    const rules = {
      roles: [
        { role: "viewers", data: ["demo"], share: false },
        { role: "leads", data: ["demo"], share: true },
      ],
    };
    expect(rightsOf(identity(["viewers"]), rules).share).toBe(false);
    expect(rightsOf(identity(["viewers", "leads"]), rules).share).toBe(true);
  });

  const write = (name: string, text: string) => {
    const path = join(dir, name);
    writeFileSync(path, text);
    return path;
  };
  const valid = `kipscope: rules
version: 1
roles:
  - role: px-engineering
    data: ["px-*", "demo"]
    share: true
  - role: viewers
    data: ["demo"]
`;

  it("checks the rules file", () => {
    const good = write("good.yaml", valid);
    expect(loadRules(good)).toEqual({
      roles: [
        { role: "px-engineering", data: ["px-*", "demo"], share: true },
        { role: "viewers", data: ["demo"], share: false },
      ],
    });

    const throwsNaming = (path: string, ...parts: string[]) => {
      let message = "";
      try {
        loadRules(path);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message, path).not.toBe("");
      expect(message, path).toContain(path);
      for (const part of parts) expect(message, path).toContain(part);
    };
    throwsNaming(write("v2.yaml", valid.replace("version: 1", "version: 2")), "version");
    throwsNaming(write("slash.yaml", valid.replace('"px-*"', '"a/b"')), "roles[0].data[0]");
    throwsNaming(
      write(
        "dupx.yaml",
        "kipscope: rules\nversion: 1\nroles:\n  - role: x\n    data: [a]\n  - role: x\n    data: [b]\n",
      ),
      "x",
    );
    throwsNaming(
      write("key.yaml", valid.replace("    share: true", "    share: true\n    admin: true")),
      "admin",
    );
    throwsNaming(join(dir, "missing.yaml"), join(dir, "missing.yaml"));
  });

  it("refuses malformed rules files, naming the entry", () => {
    const bad = (name: string, text: string) => {
      const path = join(dir, name);
      writeFileSync(path, text);
      expect(() => loadRules(path), name).toThrow(path);
      return path;
    };
    const head = "kipscope: rules\nversion: 1\n";
    bad("empty.yaml", "");
    bad("scalar.yaml", "42\n");
    bad("nokind.yaml", "version: 1\nroles: []\n");
    bad("wrongkind.yaml", "kipscope: views\nversion: 1\nroles: []\n");
    bad("notlist.yaml", `${head}roles: {a: 1}\n`);
    bad("notyaml.yaml", `${head}roles: [\n`);
    bad("norole.yaml", `${head}roles:\n  - data: [a]\n`);
    bad("emptyrole.yaml", `${head}roles:\n  - role: ""\n    data: [a]\n`);
    bad("ctlrole.yaml", `${head}roles:\n  - role: "a\\u0007b"\n    data: [a]\n`);
    bad("longrole.yaml", `${head}roles:\n  - role: ${"r".repeat(129)}\n    data: [a]\n`);
    bad("sharestr.yaml", `${head}roles:\n  - role: a\n    data: [a]\n    share: "yes"\n`);
    bad("datastr.yaml", `${head}roles:\n  - role: a\n    data: a\n`);
    bad("emptypat.yaml", `${head}roles:\n  - role: a\n    data: [""]\n`);
    bad("spacepat.yaml", `${head}roles:\n  - role: a\n    data: ["a b"]\n`);
    bad("longpat.yaml", `${head}roles:\n  - role: a\n    data: ["${"p".repeat(129)}"]\n`);
    const many = Array.from({ length: 201 }, (_, i) => `p${i}`).join(", ");
    bad("manypat.yaml", `${head}roles:\n  - role: a\n    data: [${many}]\n`);
    const roles = Array.from({ length: 1001 }, (_, i) => `  - role: r${i}\n    data: [a]\n`).join(
      "",
    );
    bad("manyroles.yaml", `${head}roles:\n${roles}`);
  });

  it("accepts the limits of the rules file", () => {
    const head = "kipscope: rules\nversion: 1\n";
    const pats = [...Array.from({ length: 199 }, (_, i) => `p${i}`), "p".repeat(128)].join(", ");
    const path = join(dir, "limits.yaml");
    writeFileSync(path, `${head}roles:\n  - role: ${"r".repeat(128)}\n    data: [${pats}]\n`);
    expect(loadRules(path).roles).toHaveLength(1);
    // An empty role list is valid: everyone is denied (deny by default).
    const empty = join(dir, "emptyroles.yaml");
    writeFileSync(empty, `${head}roles: []\n`);
    expect(loadRules(empty)).toEqual({ roles: [] });
  });
});

/** A session reduced to what `sessionRights` reads: its record and the workspace of its store. */
function session(owner: string, share: "private" | "read" | "write", workspace?: Workspace) {
  return {
    record: {
      id: "aaaaaaaaaa",
      owner,
      share,
      createdAt: "2026-10-19T08:00:00.000Z",
      lastActiveAt: "2026-10-19T08:00:00.000Z",
    },
    store: { workspace: workspace ?? EMPTY_WORKSPACE, revision: 0 },
  } as unknown as Session;
}

const T1 = "1790816400000000000";
const T2 = "1790820000000000000";
/** A workspace with one window holding the given signal IDs. */
function withSignals(signals: string[], extra: Partial<Workspace> = {}): Workspace {
  return {
    ...EMPTY_WORKSPACE,
    nextId: 10,
    windows: [
      {
        kind: "timeseries",
        id: "w1",
        range: { from: T1, to: T2 },
        mode: "lines",
        envelope: false,
        signals: signals.map((signalId, i) => ({ id: `a${i + 1}`, signalId })),
      },
    ] as unknown as Workspace["windows"],
    ...extra,
  };
}

describe("data refs of workspaces, views and commands", () => {
  it("lists the data refs of a workspace, unique", () => {
    const ws = withSignals(["testcar/A", "testcar/B", "othercar/A"], {
      eventSignals: ["gapcar/E", "testcar/A"],
      scope: { dataRef: "scopecar", from: T1, to: T2 },
    });
    expect(dataRefsOfWorkspace(ws).sort()).toEqual(["gapcar", "othercar", "scopecar", "testcar"]);
    expect(dataRefsOfWorkspace(EMPTY_WORKSPACE)).toEqual([]);
  });

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

describe("session rights", () => {
  it("derives session rights from owner, share level and data", () => {
    const all = rights(["*"], true);
    // Hand-written table of the spec: rights `*`.
    expect(sessionRights("alice", all, session("alice", "private"))).toEqual({
      open: true,
      change: true,
      owner: true,
    });
    expect(sessionRights("bob", all, session("alice", "private"))).toBeUndefined();
    expect(sessionRights("bob", all, session("alice", "read"))).toEqual({
      open: true,
      change: false,
      owner: false,
    });
    expect(sessionRights("bob", all, session("alice", "write"))).toEqual({
      open: true,
      change: true,
      owner: false,
    });

    // Rights `test*` and a write session holding `othercar/X`: nobody opens it, the owner included.
    const hidden = session("alice", "write", withSignals(["testcar/A", "othercar/X"]));
    const testOnly = rights(["test*"]);
    expect(sessionRights("alice", testOnly, hidden)).toBeUndefined();
    expect(sessionRights("bob", testOnly, hidden)).toBeUndefined();
    // The same session opens for someone who sees every data ref in it.
    expect(sessionRights("bob", rights(["test*", "other*"]), hidden)).toEqual({
      open: true,
      change: true,
      owner: false,
    });
  });

  it("checks the scope and the events-line signals as data refs of the session", () => {
    const scoped = session(
      "alice",
      "write",
      withSignals(["testcar/A"], { scope: { dataRef: "othercar", from: T1, to: T2 } }),
    );
    expect(sessionRights("bob", rights(["test*"]), scoped)).toBeUndefined();
    const events = session(
      "alice",
      "write",
      withSignals(["testcar/A"], { eventSignals: ["othercar/E"] }),
    );
    expect(sessionRights("bob", rights(["test*"]), events)).toBeUndefined();
    // An empty session needs no data right.
    expect(sessionRights("alice", rights(["zz*"]), session("alice", "private"))).toEqual({
      open: true,
      change: true,
      owner: true,
    });
  });

  it("never lets a share level widen the data a user sees", () => {
    for (const share of ["private", "read", "write"] as const) {
      const held = session("alice", share, withSignals(["othercar/X"]));
      expect(sessionRights("bob", rights(["test*"]), held), share).toBeUndefined();
    }
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
    const view = catalogView(catalog, rights(["test*"]));
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

  it("is the whole catalog for ALL_RIGHTS and empty without data rights", async () => {
    await catalog.refresh();
    const all = catalogView(catalog, ALL_RIGHTS);
    expect(all.size).toBe(4);
    expect(all.get("othercar/Secret_900h.ONLY")).toBeDefined();
    expect(all.search("", 0, 50).total).toBe(4);
    const none = catalogView(catalog, rights([]));
    expect(none.size).toBe(0);
    expect(none.all()).toEqual([]);
    expect(none.get("testcar/Fast_100h.SIG_A")).toBeUndefined();
    expect(none.search("", 0, 50)).toEqual({ items: [], total: 0, more: false });
  });

  it("answers no SNA ranges for a hidden signal", async () => {
    await catalog.refresh();
    const view = catalogView(catalog, rights(["test*"]));
    expect(view.snaRanges("othercar/Fast_100h.SIG_A")).toEqual([]);
  });
});
