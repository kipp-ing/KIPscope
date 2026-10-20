import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { decodeTimes, EMPTY_WORKSPACE } from "@kipscope/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import {
  callsNaming,
  codeOf,
  grant,
  type MultiApp,
  multiApp,
  SCOPE,
  T1,
  T2,
  viewDoc,
} from "./identityApp.ts";
import { clearRoutes, type RegisteredRoute, routeKey, routeLog } from "./routeLog.ts";
import { testSource } from "./testdb.ts";

vi.mock("fastify", async (importOriginal) =>
  (await import("./routeLog.ts")).recordRoutes(await importOriginal()),
);

let t: MultiApp | undefined;
let routes: RegisteredRoute[] = [];
beforeEach(() => clearRoutes());
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const SIG = "Fast_100h.SIG_A";
/** A data ref that exists in the test DB and one that does not; the workspaces here are not granted either. */
const OTHER = "othercar";
const ABSENT = "nosuchcar";
const REFS = [OTHER, ABSENT] as const;
/** The methods of the data source that read series data (everything but listing and ping). */
const SERIES_METHODS = ["raw", "buckets", "before", "after", "refBuckets"];
const SERIES_RANGE = "from=2026-10-01T00:00:00Z&to=2026-10-01T00:00:10Z";

type Who = ReturnType<MultiApp["as"]>;
const window10 = {
  type: "window.create",
  from: T1.toString(),
  to: (T1 + 600_000_000_000n).toString(),
};
/** A new workspace of `who`, widened to `refs` the way add-case-open will. */
async function workspaceOf(who: Who, refs: string[] = []): Promise<string> {
  const id = (await who.post("/api/workspaces", {})).body.workspace.id as string;
  if (t && refs.length > 0) grant(t, id, refs);
  return id;
}
const seriesOf = (id: string, ref: string) =>
  `/api/w/${id}/series?signal=${ref}/${SIG}&${SERIES_RANGE}&target=500`;

describe("grant per workspace", () => {
  it("starts a server workspace with an empty grant", async () => {
    t = await multiApp({ adapter: testSource(), dbc: true });
    // Roles decide nothing: even an administrator role starts with an empty grant.
    const alice = t.as("alice", ["kipscope-admin"]);
    const created = await alice.post("/api/workspaces", {});
    expect(created.status).toBe(200);
    expect(created.body.workspace.granted).toBe(0);
    const id = created.body.workspace.id as string;
    const callsBefore = t.calls.length;

    const catalog = await alice.get(`/api/w/${id}/catalog`);
    expect([catalog.status, catalog.body.items]).toEqual([200, []]);
    const signals = await alice.get(`/api/w/${id}/signals?q=`);
    expect([signals.status, signals.body.items, signals.body.total]).toEqual([200, [], 0]);
    const meta = await alice.get(`/api/w/${id}/meta`);
    expect(meta.body.catalog.size).toBe(0);
    const series = await alice.get(seriesOf(id, "testcar"));
    expect([series.status, codeOf(series.body)]).toEqual([403, "forbidden_data"]);
    // The source received no series query.
    const queries = t.calls.slice(callsBefore).filter((c) => SERIES_METHODS.includes(c.method));
    expect(queries).toEqual([]);
  });

  it("reads a stored all as empty on a server", async () => {
    // A state dir of `none` mode: one workspace of user `local` with grant all and a window.
    const local = await multiApp({ identity: "none", adapter: testSource(), dbc: true });
    const stateDir = local.stateDir;
    const id = (await local.anon.post("/api/workspaces", {})).body.workspace.id as string;
    expect((await local.anon.command(window10, id)).status).toBe(200);
    const added = await local.anon.command(
      { type: "window.addSignal", windowId: "w1", signalId: `testcar/${SIG}` },
      id,
    );
    expect(added.status).toBe(200);
    local.workspaces.flush();
    local.workspaces.stop();
    await local.app.close();

    try {
      // The same dir under the test identity adapter, as user `local`.
      t = await multiApp({ stateDir, adapter: testSource(), dbc: true });
      const me = t.as("local");
      const read = await me.get(`/api/w/${id}/workspace`);
      expect(read.status).toBe(200);
      expect(read.body.workspace.windows).toHaveLength(1);
      const summary = await me.get(`/api/workspaces/${id}`);
      expect(summary.body.workspace.granted).toBe(0);
      const series = await me.get(seriesOf(id, "testcar"));
      expect([series.status, codeOf(series.body)]).toEqual([403, "forbidden_data"]);
    } finally {
      await t?.close();
      t = undefined;
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("grants everything in local mode", async () => {
    t = await multiApp({ identity: "none", adapter: testSource(), dbc: true });
    const created = await t.anon.post("/api/workspaces", {});
    expect(created.body.workspace.granted).toBe("all");
    const id = created.body.workspace.id as string;
    const series = await t.anon.get(seriesOf(id, OTHER));
    expect(series.status).toBe(200);
    expect(decodeTimes(series.body.t).length).toBeGreaterThan(0);
  });

  it("takes no grant from a client", async () => {
    t = await multiApp({ adapter: testSource(), dbc: true });
    const alice = t.as("alice");
    const id = await workspaceOf(alice);
    const before = t.workspaces.listOf("alice").length;

    const create = await alice.post("/api/workspaces", { grant: { objects: "all" } });
    expect(create.status).toBe(400);
    expect(t.workspaces.listOf("alice")).toHaveLength(before);

    const command = await alice.command({ type: "grant.set", objects: "all" }, id);
    expect(command.status).toBe(400);

    // A view document with a top-level grant opens like any other, and grants nothing.
    const doc = viewDoc([], { grant: { objects: "all" } });
    const imported = await alice.post(`/api/w/${id}/views/import`, {
      text: JSON.stringify(doc),
      open: true,
    });
    expect(imported.status).toBe(200);
    expect((await alice.get(`/api/workspaces/${id}`)).body.workspace.granted).toBe(0);
    expect(t.workspaces.grantOf(id)).toEqual({ objects: [] });

    // The one widening path: `grantObjects(` is called nowhere in the server code but its definition.
    const src = resolve(import.meta.dirname, "../src");
    let found = "";
    try {
      found = execFileSync("grep", ["-rn", "grantObjects(", src], { encoding: "utf8" });
    } catch {
      // grep exits 1 when nothing matches
    }
    const code = found
      .split("\n")
      .filter((line) => line !== "")
      .filter((line) => !/^[^:]+:\d+:\s*(\/\/|\*|\/\*)/.test(line));
    expect(code, code.join("\n")).toHaveLength(1);
    expect(code[0]).toContain("workspaces.ts");
  });
});

/** A request of a route-wide case. */
interface Req {
  method: "GET" | "POST";
  url: string;
  body?: unknown;
}
const get = (url: string): Req => ({ method: "GET", url });
const post = (url: string, body: unknown): Req => ({ method: "POST", url, body });

/** Requests that name data ref `ref`, per route (design M6 table); the keys are the registered routes. */
const CASES: Record<string, (ref: string) => Req[]> = {
  "GET /api/extent": (r) => [get(`/api/extent?signal=${r}/${SIG}`)],
  "GET /api/series": (r) => [
    get(`/api/series?signal=${r}/${SIG}&from=2026-10-01T01:00:00Z&to=2026-10-01T01:10:00Z`),
  ],
  "GET /api/value": (r) => [get(`/api/value?signal=${r}/${SIG}&t=2026-10-01T01:05:00Z`)],
  "GET /api/density": (r) => [
    get(`/api/density?dataRef=${r}`),
    // The same parameter twice: every value is checked, not only the first.
    get(`/api/density?dataRef=testcar&dataRef=${r}`),
    get(`/api/density?dataRef=${r}&dataRef=testcar`),
  ],
  "GET /api/gaps": (r) => [
    get(`/api/gaps?dataRef=${r}`),
    get(`/api/gaps?dataRef=testcar&signal=${r}/${SIG}`),
    get(`/api/gaps?dataRef=testcar&signal=testcar/${SIG}&signal=${r}/${SIG}`),
  ],
  "GET /api/events": (r) => [
    get(`/api/events?dataRef=${r}`),
    get(`/api/events?dataRef=testcar&signal=${r}/${SIG}`),
  ],
  "POST /api/commands": (r) => [
    post("/api/commands", { type: "window.addSignal", windowId: "w1", signalId: `${r}/${SIG}` }),
    post("/api/commands", { type: "events.addSignal", signalId: `${r}/${SIG}` }),
    post("/api/commands", {
      type: "scope.set",
      dataRef: r,
      from: T1.toString(),
      to: T2.toString(),
    }),
    post("/api/commands", { type: "view.open", view: viewDoc([[`${r}/${SIG}`]]) }),
    // A visible document opened with a caller-given scope on a hidden data ref.
    post("/api/commands", {
      type: "view.open",
      view: viewDoc([[`testcar/${SIG}`]]),
      scope: { dataRef: r, from: T1.toString(), to: T2.toString() },
    }),
    // A hidden data ref only in the document's scope, or only on its events line.
    post("/api/commands", {
      type: "view.open",
      view: viewDoc([[`testcar/${SIG}`]], {
        scope: { dataRef: r, from: "2026-10-01T01:00:00Z", to: "2026-10-01T02:00:00Z" },
      }),
    }),
    post("/api/commands", {
      type: "view.open",
      view: viewDoc([[`testcar/${SIG}`]], { events: { signals: [`${r}/${SIG}`] } }),
    }),
  ],
  "POST /api/views/open": (r) => [
    post("/api/views/open", { view: viewDoc([[`${r}/${SIG}`]]) }),
    post("/api/views/open", { name: `via-${r}` }),
  ],
  "POST /api/views/import": (r) => [
    post("/api/views/import", { text: JSON.stringify(viewDoc([[`${r}/${SIG}`]])), open: true }),
    // An import without `open` names no data ref (storing a layout reveals no data), so it is no case.
    post("/api/views/import", {
      text: stringify(viewDoc([[`${r}/${SIG}`]])),
      open: true,
      name: "imported",
    }),
  ],
  "POST /api/workspaces": (r) => [
    post("/api/workspaces", { open: { view: viewDoc([[`${r}/${SIG}`]]) } }),
    post("/api/workspaces", { open: { name: `via-${r}` } }),
  ],
};

describe("one guard for every route", () => {
  it("keeps a workspace to its grant on every route", async () => {
    t = await multiApp({ adapter: testSource(), dbc: true });
    routes = routeLog.filter((r) => r.access?.dataRefs !== undefined && r.url.startsWith("/api/"));
    // The case list comes from the registered routes: a data route without a case fails here.
    expect(routes.length).toBeGreaterThanOrEqual(10);
    for (const route of routes)
      expect(
        CASES[routeKey(route)],
        `${routeKey(route)} names data refs but has no case`,
      ).toBeDefined();
    // And no case for a route that is not registered with data refs.
    for (const key of Object.keys(CASES)) expect(routes.map(routeKey), key).toContain(key);

    // Saved views of alice that name a data ref outside her grant (the cases open them by name).
    const viewsDir = join(t.stateDir, "users", "alice", "views");
    mkdirSync(viewsDir, { recursive: true });
    for (const ref of REFS)
      writeFileSync(
        join(viewsDir, `via-${ref}.yaml`),
        stringify(viewDoc([[`${ref}/${SIG}`]], { title: `via ${ref}` })),
      );

    const alice = t.as("alice", ["kipscope-admin"]);
    const w = await workspaceOf(alice, ["testcar"]);
    // A visible window, so a changed revision would show.
    expect((await alice.command(window10, w)).status).toBe(200);

    // Let background work started by the setup settle, so only the sweep's calls are counted.
    await new Promise((r) => setTimeout(r, 100));
    const app = t;
    const revision = () => app.workspaces.get(w)?.store.revision;
    const before = revision();
    const ownBefore = t.workspaces.listOf("alice").length;
    const callsBefore = t.calls.length;

    // Without a prefix the default workspace serves (alice's only one, W); with it, W itself.
    const prefixes = ["", `/w/${w}`];
    let checked = 0;
    for (const route of routes) {
      for (const prefix of prefixes) {
        const answers: Record<string, { status: number; text: string }[]> = {};
        for (const ref of REFS) {
          const requests = CASES[routeKey(route)]?.(ref) ?? [];
          answers[ref] = [];
          for (const req of requests) {
            const url = prefix === "" ? req.url : req.url.replace("/api/", `/api${prefix}/`);
            const res = await alice.request(req.method, url, req.body);
            const label = `${req.method} ${url}`;
            expect(res.status, label).toBe(403);
            expect(codeOf(res.body), label).toBe("forbidden_data");
            expect(res.body.error.message, label).toBe(`data ref ${ref} is not permitted`);
            answers[ref]?.push({ status: res.status, text: res.text });
            checked++;
          }
        }
        // Existing and non-existent data refs answer alike once the name is replaced.
        const exists = answers[OTHER] ?? [];
        const absent = answers[ABSENT] ?? [];
        expect(exists.length).toBe(absent.length);
        exists.forEach((h, i) => {
          const a = absent[i];
          expect(h.status).toBe(a?.status);
          expect(h.text.replaceAll(OTHER, "REF"), `${routeKey(route)} #${i}`).toBe(
            a?.text.replaceAll(ABSENT, "REF"),
          );
        });
      }
    }
    expect(checked).toBeGreaterThan(30);

    // No source query names either ref, W did not change, and no workspace appeared.
    for (const ref of REFS) expect(callsNaming(t.calls.slice(callsBefore), ref), ref).toEqual([]);
    expect(revision()).toBe(before);
    expect(t.workspaces.listOf("alice")).toHaveLength(ownBefore);
    expect(t.workspaces.listOf(OTHER)).toEqual([]);
  });

  it("decides forbidden_data before the catalog or the body is looked at", async () => {
    // A signal list that has not loaded: the refusal needs no list and no source.
    t = await multiApp({ loadFullCatalog: false });
    const alice = t.as("alice");
    const w = await workspaceOf(alice, ["testcar"]);
    const res = await alice.get(`/api/w/${w}/series?signal=${OTHER}/${SIG}`);
    expect([res.status, codeOf(res.body)]).toEqual([403, "forbidden_data"]);
    // A granted data ref on the same unloaded catalog answers as before (503, not 403).
    const granted = await alice.get(
      `/api/w/${w}/series?signal=testcar/${SIG}&from=2026-10-01T01:00:00Z&to=2026-10-01T01:10:00Z`,
    );
    expect(granted.status).toBe(503);
    expect(callsNaming(t.calls, OTHER)).toEqual([]);
  });

  it("answers granted data as before", async () => {
    t = await multiApp({ adapter: testSource(), dbc: true });
    const alice = t.as("alice", ["testers"]);
    const w = await workspaceOf(alice, ["testcar"]);
    const ok = await alice.get(seriesOf(w, "testcar"));
    expect(ok.status).toBe(200);
    expect(["raw", "buckets"]).toContain(ok.body.kind);
    expect(decodeTimes(ok.body.t).length).toBeGreaterThan(0);
    const unknown = await alice.get(`/api/w/${w}/series?signal=testcar/Nope.X&${SERIES_RANGE}`);
    expect(unknown.status).toBe(404);
    expect(codeOf(unknown.body)).toBe("unknown_signal");
    // Widened by the server, the second data ref answers the same way; an absent one is still refused.
    expect((await alice.get(seriesOf(w, OTHER))).status).toBe(403);
    grant(t, w, [OTHER]);
    expect((await alice.get(seriesOf(w, OTHER))).status).toBe(200);
    const absent = await alice.get(seriesOf(w, ABSENT));
    expect([absent.status, codeOf(absent.body)]).toEqual([403, "forbidden_data"]);
    grant(t, w, [ABSENT]);
    expect(codeOf((await alice.get(seriesOf(w, ABSENT))).body)).toBe("unknown_signal");
  });

  it("names the refused data ref only as the request sent it", async () => {
    t = await multiApp();
    const alice = t.as("alice");
    const w = await workspaceOf(alice, ["testcar"]);
    const res = await alice.get(
      `/api/w/${w}/density?dataRef=${encodeURIComponent("other car/<x>")}`,
    );
    expect([res.status, codeOf(res.body)]).toEqual([403, "forbidden_data"]);
    expect(res.body.error.message).toBe("data ref other car/<x> is not permitted");
    expect(Object.keys(res.body.error).sort()).toEqual(["code", "message"]);
  });
});

describe("one guard for every spelling of the prefix", () => {
  /** Prefixes the router decodes to `/api/`; the plain form is the reference. */
  const ENCODED = ["/%61pi", "/a%70i", "/ap%69", "/%61%70%69"];
  /** Same length as OTHER, so the answers can be compared byte for byte once the name is swapped. */
  const SAME_LENGTH_ABSENT = "nowherec";
  const respell = (url: string, prefix: string) => `${prefix}${url.slice("/api".length)}`;

  it("answers ungranted data refs through an encoded prefix like the plain form, never 200 or 500", async () => {
    t = await multiApp({ adapter: testSource(), dbc: true });
    const sweep = routeLog.filter((r) => r.access?.dataRefs !== undefined);
    // Saved views of alice that name an ungranted data ref (the cases open them by name).
    const viewsDir = join(t.stateDir, "users", "alice", "views");
    mkdirSync(viewsDir, { recursive: true });
    for (const ref of REFS)
      writeFileSync(
        join(viewsDir, `via-${ref}.yaml`),
        stringify(viewDoc([[`${ref}/${SIG}`]], { title: `via ${ref}` })),
      );
    const alice = t.as("alice", ["testers"]);
    const own = await workspaceOf(alice, ["testcar"]);
    const callsBefore = t.calls.length;
    const revisionBefore = t.workspaces.get(own)?.store.revision;
    let checked = 0;
    for (const route of sweep) {
      for (const ref of REFS) {
        for (const req of CASES[routeKey(route)]?.(ref) ?? []) {
          // A workspace prefix after an encoded `api` is no prefix at all, so it is left out here.
          const plain = await alice.request(req.method, req.url, req.body);
          expect([plain.status, codeOf(plain.body)], req.url).toEqual([403, "forbidden_data"]);
          for (const prefix of ENCODED) {
            const url = respell(req.url, prefix);
            const res = await alice.request(req.method, url, req.body);
            const label = `${req.method} ${url}`;
            expect([res.status, codeOf(res.body)], label).toEqual([403, "forbidden_data"]);
            expect(res.text, label).toBe(plain.text);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(120);
    // Neither ref reached a source, and the workspace did not change.
    for (const ref of REFS) expect(callsNaming(t.calls.slice(callsBefore), ref), ref).toEqual([]);
    expect(t.workspaces.get(own)?.store.revision).toBe(revisionBefore);
  });

  it("refuses an unsigned caller through an encoded prefix on every data route", async () => {
    t = await multiApp({ adapter: testSource(), dbc: true });
    let checked = 0;
    for (const route of routeLog.filter((r) => r.access?.dataRefs !== undefined)) {
      for (const req of CASES[routeKey(route)]?.(OTHER) ?? []) {
        for (const prefix of ENCODED) {
          const url = respell(req.url, prefix);
          const anon = await t.anon.request(req.method, url, req.body);
          expect([anon.status, codeOf(anon.body)], url).toEqual([401, "unauthenticated"]);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(40);
    expect(t.calls.filter((c) => callsNaming([c], OTHER).length > 0)).toEqual([]);
  });

  it("returns byte-identical forbidden_data for an existing and a non-existent ref on a prefixed route", async () => {
    t = await multiApp({ adapter: testSource(), dbc: true });
    const alice = t.as("alice", ["testers"]);
    const own = await workspaceOf(alice, ["testcar"]);
    expect(SAME_LENGTH_ABSENT.length).toBe(OTHER.length);
    const volatile = new Set(["date"]);
    const stable = (headers: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(headers).filter(([k]) => !volatile.has(k)));
    const urlOf = (prefix: string, ref: string) =>
      `/api${prefix}/series?signal=${ref}/${SIG}&from=2026-10-01T01:00:00Z&to=2026-10-01T01:10:00Z`;

    const seen: string[] = [];
    // Through the workspace's prefix and through the default workspace (the same one).
    for (const prefix of [`/w/${own}`, ""]) {
      const exists = await alice.get(urlOf(prefix, OTHER));
      const absent = await alice.get(urlOf(prefix, SAME_LENGTH_ABSENT));
      const label = prefix || "(default workspace)";
      expect([exists.status, codeOf(exists.body)], label).toEqual([403, "forbidden_data"]);
      expect(exists.status, label).toBe(absent.status);
      expect(exists.text.length, label).toBe(absent.text.length);
      expect(exists.text.replaceAll(OTHER, "REF"), label).toBe(
        absent.text.replaceAll(SAME_LENGTH_ABSENT, "REF"),
      );
      expect(stable(exists.headers), label).toEqual(stable(absent.headers));
      seen.push(exists.text);
    }
    expect(new Set(seen).size).toBe(1);
  });
});

describe("lists and counts show granted data only", () => {
  it("filters lists and counts by grant", async () => {
    t = await multiApp({ adapter: testSource(), dbc: true });
    const listsBefore = t.calls.filter((c) => c.method === "listSignals").length;
    const alice = t.as("alice", ["testers"]);
    const w1 = await workspaceOf(alice, ["testcar"]);
    const w2 = await workspaceOf(alice, ["testcar", OTHER]);
    const catalogOf = async (id: string) =>
      (await alice.get(`/api/w/${id}/catalog`)).body.items as { dataRef: string; id: string }[];

    const a = await catalogOf(w1);
    const r = await catalogOf(w2);
    expect(a.length).toBeGreaterThan(0);
    for (const item of a) expect(item.dataRef, item.id).toBe("testcar");
    expect(new Set(r.map((i) => i.dataRef)).has(OTHER)).toBe(true);
    expect(r.length).toBeGreaterThan(a.length);

    // Search: W1's total counts its hits only; the same name in `othercar` is not counted.
    const hits = async (id: string, q: string) =>
      (await alice.get(`/api/w/${id}/signals?q=${q}&limit=200`)).body;
    const w1Hits = await hits(w1, SIG);
    const w2Hits = await hits(w2, SIG);
    expect(w1Hits.total).toBe(w1Hits.items.length);
    expect(w1Hits.items.every((i: { dataRef: string }) => i.dataRef === "testcar")).toBe(true);
    expect(w2Hits.total).toBe(w1Hits.total + 1);
    const all = await hits(w1, "");
    expect(all.total).toBe(a.length);

    // Meta counts what the workspace may see.
    const m1 = (await alice.get(`/api/w/${w1}/meta`)).body;
    const m2 = (await alice.get(`/api/w/${w2}/meta`)).body;
    expect(m1.catalog.size).toBe(a.length);
    expect(m2.catalog.size).toBe(r.length);
    expect(m2.catalog.size).toBeGreaterThan(m1.catalog.size);

    // The shared list was loaded once, at start, for both workspaces.
    expect(t.calls.filter((c) => c.method === "listSignals").length).toBe(listsBefore);
  });

  it("refuses an ungranted signal in a command and accepts a granted one", async () => {
    t = await multiApp();
    const alice = t.as("alice", ["testers"]);
    const id = await workspaceOf(alice, ["testcar"]);
    const w = await alice.command({ type: "window.create", from: "0", to: "10" }, id);
    // A signal of an ungranted data ref is refused by the guard (403), not "unknown signal".
    const refused = await alice.command(
      { type: "window.addSignal", windowId: w.body.created, signalId: `${OTHER}/${SIG}` },
      id,
    );
    expect([refused.status, codeOf(refused.body)]).toEqual([403, "forbidden_data"]);
    const granted = await alice.command(
      { type: "window.addSignal", windowId: w.body.created, signalId: `testcar/${SIG}` },
      id,
    );
    expect(granted.status).toBe(200);
  });

  it("seeds a server workspace without the events-line signals it may not read", async () => {
    const seed = () => ({
      ...EMPTY_WORKSPACE,
      eventSignals: [`testcar/${SIG}`, `${OTHER}/${SIG}`],
    });
    t = await multiApp({ seed });
    const alice = t.as("alice", ["testers"]);
    const created = await alice.post("/api/workspaces", {});
    expect(created.status).toBe(200);
    const read = async (c: typeof alice, id: string) =>
      (await c.get(`/api/w/${id}/workspace`)).body.workspace;
    // The initial grant of a server is empty, so none of them is seeded (the invariant of M3).
    expect((await read(alice, created.body.workspace.id)).eventSignals ?? []).toEqual([]);
    // Her default workspace is seeded the same way.
    const other = await t.as("carol", ["testers"]).get("/api/workspace");
    expect(other.body.workspace.eventSignals ?? []).toEqual([]);
    await t.close();

    // With none, the grant is all and every events-line signal is seeded.
    t = await multiApp({ seed, identity: "none" });
    const local = await t.anon.post("/api/workspaces", {});
    expect((await read(t.anon as typeof alice, local.body.workspace.id)).eventSignals).toEqual([
      `testcar/${SIG}`,
      `${OTHER}/${SIG}`,
    ]);
  });
});

describe("scoped mode", () => {
  it("answers an ungranted data ref alike whether it exists, whatever the scope", async () => {
    t = await multiApp({ mode: "scoped" });
    const alice = t.as("alice", ["testers"]);
    const id = await workspaceOf(alice, ["testcar", "testcar2"]);
    expect(
      (
        await alice.command(
          { type: "scope.set", dataRef: SCOPE.dataRef, from: SCOPE.from, to: SCOPE.to },
          id,
        )
      ).status,
    ).toBe(200);
    const callsBefore = t.calls.length;
    const answers = [];
    for (const ref of REFS) {
      const res = await alice.get(`/api/w/${id}/density?dataRef=${ref}`);
      expect([res.status, codeOf(res.body)], ref).toEqual([403, "forbidden_data"]);
      answers.push(res.text.replaceAll(ref, "REF"));
    }
    expect(answers[0]).toBe(answers[1]);
    // A scope on an ungranted data ref is refused before its signal list is loaded.
    for (const ref of REFS) {
      const res = await alice.command(
        { type: "scope.set", dataRef: ref, from: SCOPE.from, to: SCOPE.to },
        id,
      );
      expect([res.status, codeOf(res.body)], ref).toEqual([403, "forbidden_data"]);
    }
    expect(t.calls.slice(callsBefore)).toEqual([]);
    // A granted data ref outside the scope still answers as before.
    const other = await alice.get(`/api/w/${id}/density?dataRef=testcar2`);
    expect(other.status).toBe(409);
    expect(codeOf(other.body)).toBe("out_of_scope");
  });
});

describe("sharing never widens data access", () => {
  it("shows an invited user the shared grant only there", async () => {
    t = await multiApp({ adapter: testSource(), dbc: true });
    const alice = t.as("alice", ["testers"]);
    const bob = t.as("bob", ["testers"]);
    const a = await workspaceOf(alice, ["testcar"]);
    const w = await alice.command(window10, a);
    expect(
      (
        await alice.command(
          { type: "window.addSignal", windowId: w.body.created, signalId: `testcar/${SIG}` },
          a,
        )
      ).status,
    ).toBe(200);
    expect((await alice.post(`/api/workspaces/${a}/share`, { share: "read" })).status).toBe(200);

    // In A, bob sees what A's grant covers: testcar only.
    const catalog = await bob.get(`/api/w/${a}/catalog`);
    expect(catalog.status).toBe(200);
    expect(catalog.body.items.length).toBeGreaterThan(0);
    for (const item of catalog.body.items) expect(item.dataRef).toBe("testcar");
    expect((await bob.get(seriesOf(a, "testcar"))).status).toBe(200);
    expect(codeOf((await bob.get(seriesOf(a, OTHER))).body)).toBe("forbidden_data");

    // An own copy of A's layout, and a new workspace of his own, get the initial grant.
    const copy = await bob.post("/api/workspaces", {
      open: { view: viewDoc([[`testcar/${SIG}`]]) },
    });
    expect([copy.status, codeOf(copy.body)]).toEqual([403, "forbidden_data"]);
    expect(t.workspaces.listOf("bob")).toEqual([]);
    const own = await bob.post("/api/workspaces", {});
    expect(own.status).toBe(200);
    expect(own.body.workspace.granted).toBe(0);
    const ownCatalog = await bob.get(`/api/w/${own.body.workspace.id}/catalog`);
    expect(ownCatalog.body.items).toEqual([]);
  });

  it("needs sharing turned on to share", async () => {
    t = await multiApp({ share: false });
    const alice = t.as("alice", ["testers"]);
    const id = await workspaceOf(alice);
    for (const share of ["read", "write"]) {
      const res = await alice.post(`/api/workspaces/${id}/share`, { share });
      expect([res.status, codeOf(res.body)], share).toEqual([403, "share_not_permitted"]);
    }
    expect((await alice.get(`/api/workspaces/${id}`)).body.workspace.share).toBe("private");
    const back = await alice.post(`/api/workspaces/${id}/share`, { share: "private" });
    expect(back.status).toBe(200);
    expect(back.body.workspace.share).toBe("private");
    await t.close();

    // With sharing on, the same request works.
    t = await multiApp({ share: true });
    const lead = t.as("lead", ["testers"]);
    const mine = await workspaceOf(lead);
    expect(
      (await lead.post(`/api/workspaces/${mine}/share`, { share: "read" })).body.workspace.share,
    ).toBe("read");
  });
});

describe("a view grants nothing", () => {
  it("opens a view only within the grant", async () => {
    t = await multiApp({ adapter: testSource(), dbc: true });
    const viewsDir = join(t.stateDir, "users", "alice", "views");
    mkdirSync(viewsDir, { recursive: true });
    writeFileSync(
      join(viewsDir, "both.yaml"),
      stringify(viewDoc([[`testcar/${SIG}`], [`${OTHER}/${SIG}`]], { title: "both" })),
    );
    const alice = t.as("alice", ["testers"]);
    const w = await workspaceOf(alice, ["testcar"]);
    const revision = t.workspaces.get(w)?.store.revision;

    // 1. The grant lacks othercar: refused naming it, and nothing changed.
    const refused = await alice.post(`/api/w/${w}/views/open`, { name: "both" });
    expect([refused.status, codeOf(refused.body)]).toEqual([403, "forbidden_data"]);
    expect(refused.body.error.message).toContain(OTHER);
    expect(t.workspaces.get(w)?.store.revision).toBe(revision);

    // 2. Widened by the server, the same open works and shows both windows.
    grant(t, w, [OTHER]);
    const opened = await alice.post(`/api/w/${w}/views/open`, { name: "both" });
    expect(opened.status).toBe(200);
    expect((await alice.get(`/api/workspaces/${w}`)).body.workspace.windows).toBe(2);

    // 3. Importing a view without opening it needs no grant, on a workspace with an empty one.
    const empty = await workspaceOf(alice);
    const imported = await alice.post(`/api/w/${empty}/views/import`, {
      text: JSON.stringify(viewDoc([[`testcar/${SIG}`], [`${OTHER}/${SIG}`]], { title: "again" })),
    });
    expect(imported.status).toBe(200);
  });
});
