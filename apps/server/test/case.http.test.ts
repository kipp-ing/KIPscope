import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import {
  CasesDocument,
  decodeTimes,
  encodeCasesLink,
  type LiveServerMessage,
  type SeriesResult,
} from "@kipscope/shared";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { SourceAdapter } from "../src/datasource.ts";
import {
  at,
  C4_IDS,
  c4,
  caseClaims,
  caseSignals,
  classRecording,
  DTC_MATCH,
  ed25519,
  jwksFile,
  NS,
  sameScope,
  scopeNs,
  scopeOfCall,
  signCases,
} from "./caseKit.ts";
import { type Client, type MultiApp, multiApp, realSleep, testIdentity } from "./identityApp.ts";
import { codeOf, memoryAdapter } from "./scopeApp.ts";
import { testSource } from "./testdb.ts";

const finderKey = ed25519();
const keys = jwksFile([finderKey]);
afterAll(() => keys.cleanup());

const apps: MultiApp[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Options = Parameters<typeof multiApp>[0];

/** The app of these tests: scoped mode over the in-memory case signals, no sign-in unless asked. */
async function start(options: Options = {}) {
  const log = classRecording((options?.adapter ?? memoryAdapter(caseSignals())) as SourceAdapter);
  const t = await multiApp({
    mode: "scoped",
    identity: "none",
    ...options,
    adapter: log.adapter,
    finder: { jwks: keys.path, ...options?.finder },
  });
  apps.push(t);
  return { t, log: log.log, calls: t.calls };
}

const signed = (doc: Record<string, unknown> = c4(), over: Record<string, unknown> = {}) =>
  signCases(finderKey, caseClaims(doc, over));

/** POST /api/workspaces with a catalog. */
const open = (client: Client, cases: unknown) =>
  client.post("/api/workspaces", { open: { cases } });
const idOf = (answer: { body: { workspace: { id: string } } }) => answer.body.workspace.id;
const stateOf = async (client: Client, id: string) =>
  (await client.get(`/api/w/${id}/workspace`)).body;
const caseOf = async (client: Client, id: string) => (await client.get(`/api/w/${id}/case`)).body;

/** A window with the signals, at the range (ISO texts). */
async function addWindow(client: Client, id: string, from: string, to: string, signals: string[]) {
  const created = await client.command({ type: "window.create", from, to }, id);
  expect(created.status, JSON.stringify(created.body)).toBe(200);
  for (const signalId of signals) {
    const added = await client.command(
      { type: "window.addSignal", windowId: created.body.created, signalId },
      id,
    );
    expect(added.status, JSON.stringify(added.body)).toBe(200);
  }
  return created.body.created as string;
}

const windowOf = (workspace: { windows: { id: string }[] }, windowId: string) =>
  // biome-ignore lint/suspicious/noExplicitAny: loose JSON
  workspace.windows.find((w) => w.id === windowId) as any;

describe("POST /api/workspaces with a catalog", () => {
  it("opens a catalog as a new workspace", async () => {
    const { t } = await start();
    const answer = await open(t.anon, c4());
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    const id = idOf(answer);
    expect(answer.body.case).toMatchObject({
      count: 4,
      current: 0,
      dataRefs: ["testcar", "othercar"],
      missing: [],
      warnings: [],
    });

    // Unsorted catalog of two vehicles: the order as sent, never sorted.
    const catalog = await caseOf(t.anon, id);
    expect(catalog.catalogId).toMatch(/^[a-z0-9]{10}$/);
    expect(catalog.entries.map((e: { id: string }) => e.id)).toEqual(C4_IDS);
    expect(catalog.entries[1]).toMatchObject({ object: "othercar", dataRef: "othercar" });
    expect(catalog.entries[0]).toMatchObject({
      dataRef: "testcar",
      from: "1790816400000000000",
      to: "1790817000000000000",
      meta: { distance_km: 6.2 },
    });

    const { workspace } = await stateOf(t.anon, id);
    expect(workspace.scope).toEqual({ dataRef: "testcar", from: at(0, 59), to: at(1, 11) });
    expect(workspace.case).toMatchObject({
      catalogId: catalog.catalogId,
      count: 4,
      current: 0,
      linked: true,
      pad: "60000000000",
      align: { mode: "start" },
      alignAt: at(1, 0),
    });
    expect(workspace.case.entry.id).toBe(C4_IDS[0]);
    expect(workspace.windows).toEqual([]);
  });

  it("opens a catalog with the layout of the latest workspace", async () => {
    const { t } = await start();
    const first = idOf(await open(t.anon, c4()));
    // One window at [01:02:00, 01:04:00), 2 min after the alignment point 01:00:00.
    await addWindow(t.anon, first, "2026-10-01T01:02:00Z", "2026-10-01T01:04:00Z", [
      "testcar/Fast_100h.SIG_A",
    ]);
    const second = await open(t.anon, c4({ current: 2, align: { mode: "anchor" } }));
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    const { workspace } = await stateOf(t.anon, idOf(second));
    expect(workspace.scope).toEqual({ dataRef: "testcar", from: at(4, 49), to: at(5, 11) });
    expect(workspace.windows).toHaveLength(1);
    expect(workspace.windows[0].range).toEqual({ from: at(4, 57), to: at(4, 59) });
    expect(workspace.windows[0].signals.map((s: { signalId: string }) => s.signalId)).toEqual([
      "testcar/Fast_100h.SIG_A",
    ]);
    expect(workspace.case.alignAt).toBe("1790830500000000000");
  });

  it("opens a catalog with a view", async () => {
    const { t } = await start();
    const twoWindows = {
      kipscope: "view",
      version: 1,
      title: "Two windows",
      saved: "2026-10-17T08:14:03Z",
      data: ["othercar"],
      linkTime: true,
      cursors: { diff: false },
      digits: 3,
      windows: [0, 1].map(() => ({
        kind: "timeseries",
        from: "2026-10-01T01:00:00Z",
        to: "2026-10-01T01:30:00Z",
        mode: "line",
        envelope: false,
        signals: ["othercar/Fast_100h.SIG_A"],
      })),
    };
    const imported = await t.anon.post("/api/views/import", {
      text: JSON.stringify(twoWindows),
      name: "two-windows",
    });
    expect(imported.status, JSON.stringify(imported.body)).toBe(200);
    const answer = await open(t.anon, c4({ view: "two-windows" }));
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    const { workspace } = await stateOf(t.anon, idOf(answer));
    expect(workspace.windows).toHaveLength(2);
    for (const w of workspace.windows) {
      expect(w.signals.map((s: { signalId: string }) => s.signalId)).toEqual([
        "testcar/Fast_100h.SIG_A",
      ]);
      expect(w.range).toEqual({ from: at(0, 59), to: at(1, 11) });
    }
  });

  it("opens the same catalog from link, file and API", async () => {
    const { t } = await start();
    const code = await encodeCasesLink(CasesDocument.parse(c4()));
    const answers = [
      await open(t.anon, c4()),
      await open(t.anon, code),
      await open(t.anon, signed()),
    ];
    const ids = answers.map((a) => {
      expect(a.status, JSON.stringify(a.body)).toBe(200);
      return idOf(a);
    });
    expect(new Set(ids).size).toBe(3);
    const states = await Promise.all(ids.map((id) => stateOf(t.anon, id)));
    const comparable = states.map(({ workspace }) => {
      const { catalogId: _id, ...caseState } = workspace.case;
      return { case: caseState, scope: workspace.scope };
    });
    expect(comparable[1]).toEqual(comparable[0]);
    expect(comparable[2]).toEqual(comparable[0]);
  });

  it("refuses unsigned catalogs with a sign-in", async () => {
    const { t } = await start({ identity: testIdentity() });
    const alice = t.as("alice");
    const before = t.workspaces.listOf("alice").length;
    const code = await encodeCasesLink(CasesDocument.parse(c4()));
    for (const cases of [c4(), code]) {
      const answer = await open(alice, cases);
      expect(answer.status).toBe(403);
      expect(codeOf(answer.body)).toBe("signature_required");
    }
    expect(t.workspaces.listOf("alice")).toHaveLength(before);
  });

  it("answers finder_not_configured without keys", async () => {
    // No finder keys: the default of multiApp (start() adds the test keys).
    const bare = await multiApp({
      mode: "scoped",
      adapter: memoryAdapter(caseSignals()) as SourceAdapter,
    });
    apps.push(bare);
    const answer = await open(bare.as("alice"), signed(c4(), { sub: "alice" }));
    expect(answer.status).toBe(503);
    expect(codeOf(answer.body)).toBe("finder_not_configured");
    expect(bare.workspaces.listOf("alice")).toHaveLength(0);
  });

  it("binds a signed catalog to its user and widens the grant", async () => {
    const { t } = await start({ identity: testIdentity() });
    const alice = t.as("alice");
    const bob = t.as("bob");
    const token = signed(c4(), { sub: "alice" });

    const forwarded = await open(bob, token);
    expect(forwarded.status).toBe(403);
    expect(codeOf(forwarded.body)).toBe("wrong_user");
    expect(t.workspaces.listOf("bob")).toHaveLength(0);

    const answer = await open(alice, token);
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    const id = idOf(answer);
    expect(answer.body.case.dataRefs).toEqual(["testcar", "othercar"]);
    expect(t.workspaces.grantOf(id)).toEqual({ objects: ["testcar", "othercar"] });

    const url = (signal: string) =>
      `/api/w/${id}/series?signal=${signal}&from=2026-10-01T00:00:00Z&to=2026-10-01T00:01:00Z&case=1`;
    const inside = await alice.get(url("othercar/Fast_100h.SIG_A"));
    expect(inside.status, JSON.stringify(inside.body)).toBe(200);
    const outside = await alice.get(url("drivecar/Fast_100h.SIG_A"));
    expect(outside.status).toBe(403);
    expect(codeOf(outside.body)).toBe("forbidden_data");
  });

  it("keeps only a back link to a listed finder", async () => {
    const { t } = await start({ finder: { origins: ["https://finder.example"] } });
    const withUrl = (url: string) => c4({ origin: { tool: "search tool", url } });
    const listed = await open(t.anon, withUrl("https://finder.example/#f=1"));
    const kept = await caseOf(t.anon, idOf(listed));
    expect(kept.origin).toEqual({ tool: "search tool", url: "https://finder.example/#f=1" });
    expect(listed.body.case.warnings).toEqual([]);
    const foreign = await open(t.anon, withUrl("https://evil.example/"));
    const dropped = await caseOf(t.anon, idOf(foreign));
    expect(dropped.origin?.url).toBeUndefined();
    expect(foreign.body.case.warnings.join(" ")).toMatch(/evil\.example|origin/);
  });

  it("keeps a loopback back link in identity none", async () => {
    const { t } = await start();
    const withUrl = (url: string) => c4({ origin: { tool: "search tool", url } });
    for (const url of [
      "http://localhost:5173/#f=1",
      "http://127.0.0.1:9999/x",
      "http://[::1]:8080/",
    ]) {
      const answer = await open(t.anon, withUrl(url));
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      expect((await caseOf(t.anon, idOf(answer))).origin?.url, url).toBe(url);
      expect(answer.body.case.warnings, url).toEqual([]);
    }
    for (const url of ["http://localhost.evil.example/", "file://localhost/x"]) {
      const answer = await open(t.anon, withUrl(url));
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      expect((await caseOf(t.anon, idOf(answer))).origin?.url, url).toBeUndefined();
      expect(answer.body.case.warnings.join(" "), url).toContain(url);
    }

    // With a sign-in module the rule is the listed origins only.
    const server = await start({ identity: testIdentity() });
    const alice = server.t.as("alice");
    const url = "http://localhost:5173/";
    const answer = await open(alice, signed(withUrl(url), { sub: "alice" }));
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect((await caseOf(alice, idOf(answer))).origin?.url).toBeUndefined();
    expect(answer.body.case.warnings.join(" ")).toContain(url);
  });

  it("refuses an oversized catalog", async () => {
    const { t } = await start();
    const bomb = deflateRawSync(Buffer.alloc(10 * 1024 * 1024, 0x20)).toString("base64url");
    const inflated = await open(t.anon, bomb);
    expect(inflated.status).toBe(400);
    expect(codeOf(inflated.body)).toBe("invalid_catalog");
    const long = await open(t.anon, "A".repeat(4_000_001));
    expect(long.status).toBe(400);
    expect(codeOf(long.body)).toBe("invalid_catalog");
    const empty = await open(t.anon, c4({ cases: [] }));
    expect(empty.status).toBe(400);
    expect(codeOf(empty.body)).toBe("invalid_catalog");
    expect(t.workspaces.listOf("local")).toHaveLength(0);
  });

  it("refuses a request with other keys", async () => {
    const { t } = await start();
    const answer = await t.anon.post("/api/workspaces", { open: { cases: c4(), extra: 1 } });
    expect(answer.status).toBe(400);
  });
});

describe("a catalog and its workspace", () => {
  it("keeps the catalog out of live state pushes", async () => {
    const { t } = await start();
    const id = idOf(await open(t.anon, c4()));
    const live = await t.anon.live(id);
    try {
      const message = (await live.next((m) => m.type === "state")) as Extract<
        LiveServerMessage,
        { type: "state" }
      >;
      const pushed = message.workspace.case;
      expect(pushed).toMatchObject({ count: 4, current: 0, linked: true });
      expect(pushed?.entry.id).toBe(C4_IDS[0]);
      expect(JSON.stringify(message)).not.toContain(C4_IDS[1] as string);
      expect(pushed && "entries" in pushed).toBe(false);
    } finally {
      live.close();
    }
  });

  it("restores the catalog after a restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kipscope-case-restart-"));
    dirs.push(dir);
    const first = await start({ stateDir: dir });
    const id = idOf(await open(first.t.anon, c4()));
    const catalog = await caseOf(first.t.anon, id);
    const before = await stateOf(first.t.anon, id);
    // Let the debounced write reach the disk, then stop the first server.
    await realSleep(600);
    await first.t.close();
    apps.splice(apps.indexOf(first.t), 1);

    const second = await start({ stateDir: dir });
    const again = await caseOf(second.t.anon, id);
    expect(again).toEqual(catalog);
    const after = await stateOf(second.t.anon, id);
    expect(after.workspace.case).toEqual(before.workspace.case);
  });

  it("deletes the catalog with its workspace", async () => {
    const { t } = await start();
    const id = idOf(await open(t.anon, c4()));
    expect((await t.anon.get(`/api/w/${id}/case`)).status).toBe(200);
    const deleted = await t.anon.del(`/api/workspaces/${id}`);
    expect(deleted.status).toBe(200);
    expect((await t.anon.get(`/api/w/${id}/case`)).status).toBe(404);
  });

  it("answers no_case without a catalog", async () => {
    const { t } = await start();
    const plain = (await t.anon.post("/api/workspaces", {})).body.workspace.id;
    const missing = await t.anon.get(`/api/w/${plain}/case`);
    expect(missing.status).toBe(404);
    expect(codeOf(missing.body)).toBe("no_case");
  });
});

describe("case commands over HTTP", () => {
  it("steps through the catalog over HTTP", async () => {
    let failing = false;
    const memory = memoryAdapter(caseSignals(), {
      failListSignals: (scope) =>
        failing && scope?.dataRef === "testcar" && scope.from === BigInt(at(4, 49)),
    });
    const { t, calls } = await start({ adapter: memory as unknown as SourceAdapter });
    const id = idOf(await open(t.anon, c4()));
    const w1 = await addWindow(t.anon, id, "2026-10-01T01:02:00Z", "2026-10-01T01:04:00Z", [
      "testcar/Fast_100h.SIG_A",
      "testcar/Irr_200h.JITTER",
    ]);
    const before = (await stateOf(t.anon, id)).revision;
    const mark = calls.length;

    const stepped = await t.anon.command({ type: "case.step", by: 1 }, id);
    expect(stepped.status, JSON.stringify(stepped.body)).toBe(200);
    expect(stepped.body.revision).toBe(before + 1);
    // othercar's list holds Fast_100h.SIG_A only.
    expect(stepped.body.missing).toEqual(["othercar/Irr_200h.JITTER"]);
    const listed = calls
      .slice(mark)
      .filter((c) => c.method === "listSignals")
      .map((c) => c.args[0] as { dataRef: string; from: bigint; to: bigint });
    expect(listed).toEqual([
      scopeNs("othercar", String((1790812800n - 60n) * NS), String((1790812800n + 61n) * NS)),
    ]);

    const afterStep = (await stateOf(t.anon, id)).workspace;
    expect(afterStep.case.current).toBe(1);
    expect(afterStep.scope.dataRef).toBe("othercar");
    expect(windowOf(afterStep, w1).signals.map((s: { signalId: string }) => s.signalId)).toEqual([
      "othercar/Fast_100h.SIG_A",
      "othercar/Irr_200h.JITTER",
    ]);

    // Entry 2's list cannot be loaded: 503 and the workspace stays at entry 1.
    failing = true;
    const revision = (await stateOf(t.anon, id)).revision;
    const refused = await t.anon.command({ type: "case.step", by: 1 }, id);
    expect(refused.status).toBe(503);
    expect(codeOf(refused.body)).toBe("catalog_unavailable");
    const kept = await stateOf(t.anon, id);
    expect(kept.workspace.case.current).toBe(1);
    expect(kept.revision).toBe(revision);

    // Back to testcar: both signals are known again.
    failing = false;
    const back = await t.anon.command({ type: "case.go", index: 0 }, id);
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(back.body.missing).toBeUndefined();
    const home = windowOf((await stateOf(t.anon, id)).workspace, w1);
    expect(home.signals.map((s: { signalId: string }) => s.signalId)).toEqual([
      "testcar/Fast_100h.SIG_A",
      "testcar/Irr_200h.JITTER",
    ]);
  });

  it("refuses case commands at the ends, past the end and without a catalog", async () => {
    const { t } = await start();
    const id = idOf(await open(t.anon, c4()));
    const prev = await t.anon.command({ type: "case.step", by: -1 }, id);
    expect(prev.status).toBe(422);
    expect(codeOf(prev.body)).toBe("case_end");
    const far = await t.anon.command({ type: "case.go", index: 4 }, id);
    expect(far.status).toBe(422);
    expect(codeOf(far.body)).toBe("case_end");
    const scopeSet = await t.anon.command(
      { type: "scope.set", dataRef: "testcar", from: at(1, 0), to: at(2, 0) },
      id,
    );
    expect(scopeSet.status).toBe(422);
    expect(codeOf(scopeSet.body)).toBe("case_open");
    const cleared = await t.anon.command({ type: "scope.clear" }, id);
    expect(codeOf(cleared.body)).toBe("case_open");

    const plain = (await t.anon.post("/api/workspaces", {})).body.workspace.id;
    const none = await t.anon.command({ type: "case.step", by: 1 }, plain);
    expect(none.status).toBe(422);
    expect(codeOf(none.body)).toBe("no_case");
  });
});

/**
 * The adapter with `listSignals` held while `hold()` is on, so a case command stays in flight (its
 * target's signal list not loaded) while the next one is accepted.
 */
function gated<T extends object>(inner: T) {
  let held: Promise<void> | undefined;
  let open = () => {};
  const adapter = new Proxy(inner, {
    get(target, key, receiver) {
      const member = Reflect.get(target, key, receiver);
      if (key !== "listSignals" || typeof member !== "function") return member;
      return async (...args: unknown[]) => {
        await held;
        return member.apply(target, args);
      };
    },
  });
  return {
    adapter: adapter as unknown as SourceAdapter,
    hold: () => {
      held = new Promise<void>((resolve) => {
        open = resolve;
      });
    },
    release: () => {
      open();
      held = undefined;
    },
  };
}

describe("case commands in flight together", () => {
  /** Posts `a`, then `b` while `a` still waits for its list; `together: false` waits for `a` first. */
  async function both(
    t: MultiApp,
    id: string,
    gate: ReturnType<typeof gated>,
    a: Record<string, unknown>,
    b: Record<string, unknown>,
    together: boolean,
  ) {
    if (!together) {
      const first = await t.anon.command(a, id);
      return [first, await t.anon.command(b, id)] as const;
    }
    gate.hold();
    const first = t.anon.command(a, id);
    await realSleep(100);
    const second = t.anon.command(b, id);
    await realSleep(100);
    gate.release();
    return Promise.all([first, second]);
  }

  describe.each([
    ["one after the other", false],
    ["in flight together", true],
  ])("%s", (_name, together) => {
    it("applies two case.step commands in order", async () => {
      const gate = gated(memoryAdapter(caseSignals()));
      const { t } = await start({ adapter: gate.adapter });
      const id = idOf(await open(t.anon, c4({ align: { mode: "anchor" } })));
      // Offsets +10 s … +40 s from the start of entry 0 (it has no anchor), inside every scope.
      const w1 = await addWindow(t.anon, id, "2026-10-01T01:00:10Z", "2026-10-01T01:00:40Z", [
        "testcar/Fast_100h.SIG_A",
        "testcar/Irr_200h.JITTER",
      ]);
      const before = (await stateOf(t.anon, id)).revision;

      const [one, two] = await both(
        t,
        id,
        gate,
        { type: "case.step", by: 1 },
        { type: "case.step", by: 1 },
        together,
      );
      expect(one.status, JSON.stringify(one.body)).toBe(200);
      expect(two.status, JSON.stringify(two.body)).toBe(200);
      // The first lands on othercar, which lacks the jitter; the second is back on testcar, which
      // lists both signals (the list of entry 2, not the one of entry 1).
      expect(one.body.missing).toEqual(["othercar/Irr_200h.JITTER"]);
      expect(two.body.missing).toBeUndefined();

      const state = await stateOf(t.anon, id);
      expect(state.revision).toBe(before + 2);
      const { workspace } = state;
      // current is k + 2, with the alignment point of entry 2 (its anchor, 04:55:00).
      expect(workspace.case.current).toBe(2);
      expect(workspace.case.alignAt).toBe("1790830500000000000");
      expect(workspace.scope).toEqual({ dataRef: "testcar", from: at(4, 49), to: at(5, 11) });
      const window = windowOf(workspace, w1);
      expect(window.range).toEqual({ from: at(4, 55, 10), to: at(4, 55, 40) });
      expect(window.signals.map((s: { signalId: string }) => s.signalId)).toEqual([
        "testcar/Fast_100h.SIG_A",
        "testcar/Irr_200h.JITTER",
      ]);
    });

    it("unlinks in the session a step before it reached", async () => {
      const gate = gated(memoryAdapter(caseSignals()));
      const { t } = await start({ adapter: gate.adapter });
      const id = idOf(await open(t.anon, c4()));

      const [one, two] = await both(
        t,
        id,
        gate,
        { type: "case.step", by: 1 },
        { type: "case.unlink" },
        together,
      );
      expect(one.status, JSON.stringify(one.body)).toBe(200);
      expect(two.status, JSON.stringify(two.body)).toBe(200);
      const { workspace } = await stateOf(t.anon, id);
      expect(workspace.case).toMatchObject({ current: 1, linked: false });
      // The vehicle is othercar (rows 23:58:00 – 00:02:00), not the testcar the step left.
      expect(workspace.scope.dataRef).toBe("othercar");
      expect(workspace.scope.object).toBe(true);
      expect(BigInt(workspace.scope.from) <= BigInt(at(0, 0)) - 59n * NS).toBe(true);
      expect(BigInt(workspace.scope.to) <= BigInt(at(0, 5))).toBe(true);
    });

    it("aligns to an event in the session a step before it reached", async () => {
      // The 9 DTCs of the test DB lie at 05:00:00 in entries 2 and 3; entry 1 (othercar) has none.
      const gate = gated(testSource());
      const { t } = await start({ adapter: gate.adapter });
      const id = idOf(await open(t.anon, c4({ current: 2 })));
      const event = { ...DTC_MATCH, name: "P0AA100" };
      const set = await t.anon.command(
        { type: "case.align", align: { mode: "event", event }, at: at(5, 0) },
        id,
      );
      expect(set.status, JSON.stringify(set.body)).toBe(200);

      const [one, two] = await both(
        t,
        id,
        gate,
        { type: "case.step", by: -1 },
        { type: "case.align", align: { mode: "event", event } },
        together,
      );
      expect(one.status, JSON.stringify(one.body)).toBe(200);
      // Entry 1 holds no such event: refused, not answered with entry 2's point.
      expect(two.status, JSON.stringify(two.body)).toBe(422);
      expect(codeOf(two.body)).toBe("no_matching_event");
      const { workspace } = await stateOf(t.anon, id);
      expect(workspace.case.current).toBe(1);
      expect(workspace.case.alignAt).toBe(at(0, 0));
    });
  });
});

describe("alignment to an event", () => {
  it("aligns to an event and falls back to the start", async () => {
    // The 9 DTCs of the test DB lie at 05:00:00 in entries 2 and 3, not in entry 0.
    const { t } = await start({ adapter: testSource() as unknown as SourceAdapter });
    const id = idOf(await open(t.anon, c4({ current: 2 })));
    const w1 = await addWindow(t.anon, id, "2026-10-01T04:59:00Z", "2026-10-01T05:01:00Z", []);
    const event = { ...DTC_MATCH, name: "P0AA100" };

    const aligned = await t.anon.command(
      { type: "case.align", align: { mode: "event", event }, at: at(5, 0) },
      id,
    );
    expect(aligned.status, JSON.stringify(aligned.body)).toBe(200);
    expect((await stateOf(t.anon, id)).workspace.case.alignAt).toBe(at(5, 0));

    // Entry 3 holds the same DTC at 05:00:00: the window keeps its place, no fallback.
    const toThree = await t.anon.command({ type: "case.go", index: 3 }, id);
    expect(toThree.status, JSON.stringify(toThree.body)).toBe(200);
    expect(toThree.body.alignFallback).toBeUndefined();
    let state = (await stateOf(t.anon, id)).workspace;
    expect(windowOf(state, w1).range).toEqual({ from: at(4, 59), to: at(5, 1) });
    expect(state.case.alignAt).toBe(at(5, 0));

    // Entry 0 has no DTC: aligned to its start, the window moves with it.
    const toZero = await t.anon.command({ type: "case.go", index: 0 }, id);
    expect(toZero.status, JSON.stringify(toZero.body)).toBe(200);
    expect(toZero.body.alignFallback).toBe(true);
    state = (await stateOf(t.anon, id)).workspace;
    expect(windowOf(state, w1).range).toEqual({ from: at(0, 59), to: at(1, 1) });
    expect(state.case.alignAt).toBe("1790816400000000000");

    // Without `at` and without a match in the current session the command is refused.
    const revision = (await stateOf(t.anon, id)).revision;
    const none = await t.anon.command({ type: "case.align", align: { mode: "event", event } }, id);
    expect(none.status).toBe(422);
    expect(codeOf(none.body)).toBe("no_matching_event");
    expect((await stateOf(t.anon, id)).revision).toBe(revision);

    // Without `at` and a match, the server resolves the point itself.
    await t.anon.command({ type: "case.go", index: 2 }, id);
    const resolved = await t.anon.command(
      { type: "case.align", align: { mode: "event", event } },
      id,
    );
    expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);
    expect((await stateOf(t.anon, id)).workspace.case.alignAt).toBe(at(5, 0));
  });
});

describe("preview and entry-bounded series", () => {
  it("previews a neighbour in the preload class", async () => {
    const { t, calls, log } = await start();
    const id = idOf(await open(t.anon, c4({ align: { mode: "anchor" } })));
    await addWindow(t.anon, id, "2026-10-01T01:02:00Z", "2026-10-01T01:04:00Z", [
      "testcar/Fast_100h.SIG_A",
    ]);
    const settle = async () => {
      let seen = -1;
      while (seen !== calls.length) {
        seen = calls.length;
        await realSleep(300);
      }
    };
    await settle();
    const mark = log.length;

    const preview = await t.anon.get(`/api/w/${id}/case/preview?index=2`, {
      "x-kipscope-class": "preload",
    });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body).toMatchObject({
      index: 2,
      scope: { dataRef: "testcar", from: at(4, 49), to: at(5, 11) },
      alignAt: "1790830500000000000",
    });
    await settle();
    // Everything the preview asked the source ran in the preload class.
    const warmed = log.slice(mark).filter((c) => c.method !== "ping");
    expect(warmed.length).toBeGreaterThan(0);
    expect(warmed.map((c) => `${c.method}:${c.cls}`)).toEqual(
      warmed.map((c) => `${c.method}:preload`),
    );

    // The step and the reads of the new scope make no second call for them.
    const target = scopeNs("testcar", at(4, 49), at(5, 11));
    const scoped = [
      "listSignals",
      "refBuckets",
      "loggerGaps",
      "firstTimes",
      "events",
      "stateChanges",
    ];
    const count = () =>
      log.filter((c) => scoped.includes(c.method) && sameScope(scopeOfCall(c), target)).length;
    const afterPreview = count();
    expect(afterPreview).toBeGreaterThan(0);
    const step = await t.anon.command({ type: "case.go", index: 2 }, id);
    expect(step.status, JSON.stringify(step.body)).toBe(200);
    for (const url of [
      "/density?dataRef=testcar",
      "/gaps?dataRef=testcar&signal=testcar/Fast_100h.SIG_A",
      "/events?dataRef=testcar",
    ]) {
      const read = await t.anon.get(`/api/w/${id}${url}`);
      expect(read.status, `${url}: ${JSON.stringify(read.body)}`).toBe(200);
    }
    await settle();
    expect(count()).toBe(afterPreview);

    // Class of the source calls: the header makes a series request preload, nothing else does.
    const series = (header?: string) => {
      const from = log.length;
      return t.anon
        .get(
          `/api/w/${id}/series?signal=testcar/Fast_100h.SIG_A&from=2026-10-01T04:50:00Z&to=2026-10-01T05:00:00Z&case=2`,
          header === undefined ? {} : { "x-kipscope-class": header },
        )
        .then((answer) => {
          expect(answer.status, JSON.stringify(answer.body)).toBe(200);
          return log
            .slice(from)
            .filter((c) => ["raw", "buckets", "before", "after"].includes(c.method))
            .map((c) => c.cls);
        });
    };
    const withHeader = await series("preload");
    expect(withHeader.length).toBeGreaterThan(0);
    expect(new Set(withHeader)).toEqual(new Set(["preload"]));
    expect(new Set(await series())).toEqual(new Set(["interactive"]));
    expect(new Set(await series("background"))).toEqual(new Set(["interactive"]));
  });

  it("previews a neighbour in the preload class: bad previews", async () => {
    const { t } = await start();
    const id = idOf(await open(t.anon, c4()));
    const bad = await t.anon.get(`/api/w/${id}/case/preview?index=4`);
    expect(bad.status).toBe(400);
    expect(codeOf(bad.body)).toBe("invalid_request");
    const plain = (await t.anon.post("/api/workspaces", {})).body.workspace.id;
    const none = await t.anon.get(`/api/w/${plain}/case/preview?index=0`);
    expect(none.status).toBe(404);
    expect(codeOf(none.body)).toBe("no_case");
  });

  it("bounds series by a catalog entry", async () => {
    const { t } = await start();
    const id = idOf(await open(t.anon, c4()));
    const answer = await t.anon.get(
      `/api/w/${id}/series?signal=testcar/Fast_100h.SIG_A&from=2026-10-01T04:00:00Z&to=2026-10-01T06:00:00Z&case=2`,
    );
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    const series = answer.body as SeriesResult;
    const times = decodeTimes(series.t);
    expect(times.length).toBeGreaterThan(0);
    for (const time of times) {
      expect(time >= BigInt(at(4, 49)) && time < BigInt(at(5, 11))).toBe(true);
    }
    const other = await t.anon.get(
      `/api/w/${id}/series?signal=othercar/Fast_100h.SIG_A&from=2026-10-01T04:00:00Z&to=2026-10-01T06:00:00Z&case=2`,
    );
    expect(other.status).toBe(409);
    expect(codeOf(other.body)).toBe("out_of_scope");
    const bad = await t.anon.get(
      `/api/w/${id}/series?signal=testcar/Fast_100h.SIG_A&from=2026-10-01T04:00:00Z&to=2026-10-01T06:00:00Z&case=9`,
    );
    expect(bad.status).toBe(400);
    const extent = await t.anon.get(`/api/w/${id}/extent?signal=testcar/Fast_100h.SIG_A&case=2`);
    expect(extent.status, JSON.stringify(extent.body)).toBe(200);
    expect(BigInt(extent.body.first) >= BigInt(at(4, 49))).toBe(true);
    expect(BigInt(extent.body.last) < BigInt(at(5, 11))).toBe(true);
    const plain = (await t.anon.post("/api/workspaces", {})).body.workspace.id;
    const none = await t.anon.get(
      `/api/w/${plain}/series?signal=testcar/Fast_100h.SIG_A&from=2026-10-01T04:00:00Z&to=2026-10-01T06:00:00Z&case=0`,
    );
    expect(none.status).toBe(404);
    expect(codeOf(none.body)).toBe("no_case");
  });
});
