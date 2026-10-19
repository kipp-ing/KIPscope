import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeTimes, EMPTY_WORKSPACE } from "@kipscope/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import {
  callsNaming,
  codeOf,
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
/** A data ref that exists in the test DB and one that does not; neither is visible to `test*`. */
const HIDDEN = "othercar";
const ABSENT = "nosuchcar";
const REFS = [HIDDEN, ABSENT] as const;

describe("deny by default", () => {
  it("refuses users without rights", async () => {
    t = await multiApp();
    const callsBefore = t.calls.length;
    const eve = t.as("eve", ["nobody"]);
    const me = await eve.get("/api/me");
    expect(me.status).toBe(200);
    expect(me.body.rights).toEqual({ data: [], share: false });
    for (const [method, url, body] of [
      ["GET", "/api/workspace"],
      ["GET", "/api/catalog"],
      ["GET", "/api/sessions"],
      ["POST", "/api/sessions", {}],
    ] as const) {
      const res = await eve.request(method, url, body);
      expect([res.status, codeOf(res.body)], `${method} ${url}`).toEqual([403, "no_rights"]);
    }
    const live = await eve.live();
    expect(live.messages).toEqual([]);
    expect(live.status === 403 || live.closeCode !== undefined).toBe(true);
    // No session was created for her, and the source received no call.
    expect(t.sessions.listOf("eve")).toEqual([]);
    expect(t.calls.length).toBe(callsBefore);
  });

  it("refuses users without rights on every route but /api/me and /api/license", async () => {
    t = await multiApp({ licenseText: "AAL" });
    const owned = t.sessions.create("alice");
    const callsBefore = t.calls.length;
    const eve = t.as("eve", ["nobody"]);
    const urls: [string, string][] = routeLog
      .filter((r) => r.url.startsWith("/api/") && !["/api/me", "/api/license"].includes(r.url))
      .filter((r) => !(r.method === "GET" && r.url === "/api/live"))
      .map((r) => [r.method, r.url.replace(":id", owned.record.id).replace(":name", "speeds")]);
    expect(urls.length).toBeGreaterThan(20);
    for (const [method, url] of urls) {
      const res = await eve.request(
        method as "GET" | "POST" | "DELETE",
        url,
        method === "POST" ? {} : undefined,
      );
      expect([res.status, codeOf(res.body)], `${method} ${url}`).toEqual([403, "no_rights"]);
      const viaSession = await eve.request(
        method as "GET" | "POST" | "DELETE",
        url.replace("/api/", `/api/s/${owned.record.id}/`),
        method === "POST" ? {} : undefined,
      );
      expect(viaSession.status, `prefixed ${method} ${url}`).toBe(403);
    }
    expect((await eve.get("/api/license")).status).toBe(200);
    expect(t.sessions.listOf("eve")).toEqual([]);
    expect(t.calls.length).toBe(callsBefore);
  });

  it("gives a role that has a rule but no data patterns no rights either", async () => {
    t = await multiApp({ rules: { roles: [{ role: "empty", data: [], share: true }] } });
    const res = await t.as("eve", ["empty"]).get("/api/workspace");
    expect([res.status, codeOf(res.body)]).toEqual([403, "no_rights"]);
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
    post("/api/views/import", { text: JSON.stringify(viewDoc([[`${r}/${SIG}`]])) }),
    post("/api/views/import", {
      text: stringify(viewDoc([[`${r}/${SIG}`]])),
      open: true,
      name: "imported",
    }),
  ],
  "POST /api/sessions": (r) => [
    post("/api/sessions", { open: { view: viewDoc([[`${r}/${SIG}`]]) } }),
    post("/api/sessions", { open: { name: `via-${r}` } }),
  ],
};

describe("one guard for every route", () => {
  it("keeps role A out of data refs of role B on every route", async () => {
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

    // Saved views of alice that name a data ref she may not see (rights narrowed since).
    const viewsDir = join(t.stateDir, "users", "alice", "views");
    mkdirSync(viewsDir, { recursive: true });
    for (const ref of REFS)
      writeFileSync(
        join(viewsDir, `via-${ref}.yaml`),
        stringify(viewDoc([[`${ref}/${SIG}`]], { title: `via ${ref}` })),
      );

    const alice = t.as("alice", ["testers"]);
    const bob = t.as("bob", ["all"]);
    const own = (await alice.post("/api/sessions", {})).body.session.id as string;
    const foreign = (await bob.post("/api/sessions", {})).body.session.id as string;
    // A session of alice's with a visible window, so a changed revision would show.
    expect(
      (
        await alice.command(
          { type: "window.create", from: T1.toString(), to: (T1 + 600_000_000_000n).toString() },
          own,
        )
      ).status,
    ).toBe(200);

    // Let background work started by the setup settle, so only the sweep's calls are counted.
    await new Promise((r) => setTimeout(r, 100));
    const app = t;
    const revisions = () =>
      Object.fromEntries(
        [...app.sessions.listOf("alice"), ...app.sessions.listOf("bob")].map((s) => [
          s.record.id,
          s.store.revision,
        ]),
      );
    const before = revisions();
    const ownBefore = t.sessions.listOf("alice").length;
    const callsBefore = t.calls.length;

    const prefixes = ["", `/s/${own}`, `/s/${foreign}`, "/s/zzzzzzzzzz"];
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
            // The guard answers before it looks at any session.
            expect(res.headers["x-kipscope-session"], label).toBeUndefined();
            answers[ref]?.push({ status: res.status, text: res.text });
            checked++;
          }
        }
        // Existing and non-existent data refs answer alike once the name is replaced.
        const hidden = answers[HIDDEN] ?? [];
        const absent = answers[ABSENT] ?? [];
        expect(hidden.length).toBe(absent.length);
        hidden.forEach((h, i) => {
          const a = absent[i];
          expect(h.status).toBe(a?.status);
          expect(h.text.replaceAll(HIDDEN, "REF"), `${routeKey(route)} #${i}`).toBe(
            a?.text.replaceAll(ABSENT, "REF"),
          );
        });
      }
    }
    expect(checked).toBeGreaterThan(40);

    // No source query names either ref, no revision moved, no session appeared.
    for (const ref of REFS) expect(callsNaming(t.calls.slice(callsBefore), ref), ref).toEqual([]);
    expect(revisions()).toEqual(before);
    expect(t.sessions.listOf("alice")).toHaveLength(ownBefore);
    expect(t.sessions.listOf("bob")).toHaveLength(1);
    expect(t.sessions.listOf(HIDDEN)).toEqual([]);
  });

  it("decides forbidden_data before the session, the catalog or the body is looked at", async () => {
    // A signal list that has not loaded: the refusal needs no list, no session and no source.
    t = await multiApp({ loadFullCatalog: false });
    const alice = t.as("alice", ["testers"]);
    const res = await alice.get(`/api/series?signal=${HIDDEN}/${SIG}`);
    expect([res.status, codeOf(res.body)]).toEqual([403, "forbidden_data"]);
    // A visible data ref on the same unloaded catalog answers as before (503, not 403).
    const visible = await alice.get(
      `/api/series?signal=testcar/${SIG}&from=2026-10-01T01:00:00Z&to=2026-10-01T01:10:00Z`,
    );
    expect(visible.status).toBe(503);
    expect(callsNaming(t.calls, HIDDEN)).toEqual([]);
  });

  it("answers visible data as before", async () => {
    t = await multiApp({ adapter: testSource(), dbc: true });
    const alice = t.as("alice", ["testers"]);
    const ok = await alice.get(
      `/api/series?signal=testcar/${SIG}&from=2026-10-01T00:00:00Z&to=2026-10-01T00:00:10Z&target=500`,
    );
    expect(ok.status).toBe(200);
    expect(["raw", "buckets"]).toContain(ok.body.kind);
    expect(decodeTimes(ok.body.t).length).toBeGreaterThan(0);
    const unknown = await alice.get(
      "/api/series?signal=testcar/Nope.X&from=2026-10-01T00:00:00Z&to=2026-10-01T00:00:10Z",
    );
    expect(unknown.status).toBe(404);
    expect(codeOf(unknown.body)).toBe("unknown_signal");
    // The same two answers an administrator gets.
    const admin = t.as("root", ["admins"]);
    expect(
      (
        await admin.get(
          `/api/series?signal=${HIDDEN}/${SIG}&from=2026-10-01T00:00:00Z&to=2026-10-01T00:00:10Z`,
        )
      ).status,
    ).toBe(200);
    const absent = await admin.get(
      `/api/series?signal=${ABSENT}/${SIG}&from=2026-10-01T00:00:00Z&to=2026-10-01T00:00:10Z`,
    );
    expect(codeOf(absent.body)).toBe("unknown_signal");
  });

  it("names the refused data ref only as the request sent it", async () => {
    t = await multiApp();
    const alice = t.as("alice", ["testers"]);
    const res = await alice.get(`/api/density?dataRef=${encodeURIComponent("other car/<x>")}`);
    expect([res.status, codeOf(res.body)]).toEqual([403, "forbidden_data"]);
    expect(res.body.error.message).toBe("data ref other car/<x> is not permitted");
    expect(Object.keys(res.body.error).sort()).toEqual(["code", "message"]);
  });
});

describe("one guard for every spelling of the prefix", () => {
  /** Prefixes the router decodes to `/api/`; the plain form is the reference. */
  const ENCODED = ["/%61pi", "/a%70i", "/ap%69", "/%61%70%69"];
  /** Same length as HIDDEN, so the answers can be compared byte for byte once the name is swapped. */
  const SAME_LENGTH_ABSENT = "nowherec";
  const respell = (url: string, prefix: string) => `${prefix}${url.slice("/api".length)}`;

  it("answers hidden data refs through an encoded prefix like the plain form, never 200 or 500", async () => {
    t = await multiApp({ adapter: testSource(), dbc: true });
    const routes = routeLog.filter((r) => r.access?.dataRefs !== undefined);
    // Saved views of alice that name a hidden data ref (the cases open them by name).
    const viewsDir = join(t.stateDir, "users", "alice", "views");
    mkdirSync(viewsDir, { recursive: true });
    for (const ref of REFS)
      writeFileSync(
        join(viewsDir, `via-${ref}.yaml`),
        stringify(viewDoc([[`${ref}/${SIG}`]], { title: `via ${ref}` })),
      );
    const alice = t.as("alice", ["testers"]);
    const own = (await alice.post("/api/sessions", {})).body.session.id as string;
    const callsBefore = t.calls.length;
    const revisionBefore = t.sessions.get(own)?.store.revision;
    let checked = 0;
    for (const route of routes) {
      for (const ref of REFS) {
        for (const req of CASES[routeKey(route)]?.(ref) ?? []) {
          // A session prefix after an encoded `api` is no prefix at all, so it is left out here.
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
    expect(checked).toBeGreaterThan(150);
    // Neither ref reached a source, and the session did not change.
    for (const ref of REFS) expect(callsNaming(t.calls.slice(callsBefore), ref), ref).toEqual([]);
    expect(t.sessions.get(own)?.store.revision).toBe(revisionBefore);
  });

  it("refuses an unsigned and a no-rights caller through an encoded prefix on every data route", async () => {
    t = await multiApp({ adapter: testSource(), dbc: true });
    const eve = t.as("eve", ["nobody"]);
    let checked = 0;
    for (const route of routeLog.filter((r) => r.access?.dataRefs !== undefined)) {
      for (const req of CASES[routeKey(route)]?.(HIDDEN) ?? []) {
        for (const prefix of ENCODED) {
          const url = respell(req.url, prefix);
          const anon = await t.anon.request(req.method, url, req.body);
          expect([anon.status, codeOf(anon.body)], url).toEqual([401, "unauthenticated"]);
          const none = await eve.request(req.method, url, req.body);
          expect([none.status, codeOf(none.body)], url).toEqual([403, "no_rights"]);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(80);
    expect(t.calls.filter((c) => callsNaming([c], HIDDEN).length > 0)).toEqual([]);
  });

  it("returns byte-identical forbidden_data for a hidden and a non-existent ref on a prefixed route", async () => {
    t = await multiApp({ adapter: testSource(), dbc: true });
    const alice = t.as("alice", ["testers"]);
    const bob = t.as("bob", ["all"]);
    const own = (await alice.post("/api/sessions", {})).body.session.id as string;
    const foreign = (await bob.post("/api/sessions", {})).body.session.id as string;
    expect(SAME_LENGTH_ABSENT.length).toBe(HIDDEN.length);
    const volatile = new Set(["date"]);
    const stable = (headers: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(headers).filter(([k]) => !volatile.has(k)));
    const urlOf = (prefix: string, ref: string) =>
      `/api${prefix}/series?signal=${ref}/${SIG}&from=2026-10-01T01:00:00Z&to=2026-10-01T01:10:00Z`;

    const seen: string[] = [];
    // Own, foreign (someone else's private) and missing session: the guard answers before any of
    // them is looked up, so all give the same bytes.
    for (const prefix of [`/s/${own}`, `/s/${foreign}`, "/s/zzzzzzzzzz", ""]) {
      const hidden = await alice.get(urlOf(prefix, HIDDEN));
      const absent = await alice.get(urlOf(prefix, SAME_LENGTH_ABSENT));
      const label = prefix || "(default session)";
      expect([hidden.status, codeOf(hidden.body)], label).toEqual([403, "forbidden_data"]);
      expect(hidden.status, label).toBe(absent.status);
      expect(hidden.text.length, label).toBe(absent.text.length);
      expect(hidden.text.replaceAll(HIDDEN, "REF"), label).toBe(
        absent.text.replaceAll(SAME_LENGTH_ABSENT, "REF"),
      );
      expect(stable(hidden.headers), label).toEqual(stable(absent.headers));
      expect(hidden.headers["x-kipscope-session"], label).toBeUndefined();
      seen.push(hidden.text);
    }
    // And across the session prefixes: the session is not told apart either.
    expect(new Set(seen).size).toBe(1);
  });
});

describe("lists and counts show visible data only", () => {
  it("filters lists and counts by rights", async () => {
    t = await multiApp({ adapter: testSource(), dbc: true });
    const listsBefore = t.calls.filter((c) => c.method === "listSignals").length;
    const alice = t.as("alice", ["testers"]);
    const admin = t.as("root", ["admins"]);
    const catalogOf = async (c: typeof alice) =>
      (await c.get("/api/catalog")).body.items as { dataRef: string; id: string }[];

    const a = await catalogOf(alice);
    const r = await catalogOf(admin);
    expect(a.length).toBeGreaterThan(0);
    for (const item of a) expect(item.dataRef.startsWith("test"), item.id).toBe(true);
    expect(new Set(r.map((i) => i.dataRef)).has(HIDDEN)).toBe(true);
    expect(r.length).toBeGreaterThan(a.length);
    expect(a.some((i) => i.dataRef === HIDDEN)).toBe(false);

    // Search: alice's total counts her hits only; the same name in `othercar` is not counted.
    const hits = async (c: typeof alice, q: string) =>
      (await c.get(`/api/signals?q=${q}&limit=200`)).body;
    const aliceHits = await hits(alice, SIG);
    const adminHits = await hits(admin, SIG);
    expect(aliceHits.total).toBe(aliceHits.items.length);
    expect(aliceHits.items.every((i: { dataRef: string }) => i.dataRef === "testcar")).toBe(true);
    expect(adminHits.total).toBe(aliceHits.total + 1);
    const all = await hits(alice, "");
    expect(all.total).toBe(a.length);
    for (const item of all.items) expect(item.dataRef.startsWith("test")).toBe(true);

    // Meta counts what the user may see.
    const aliceMeta = (await alice.get("/api/meta")).body;
    const adminMeta = (await admin.get("/api/meta")).body;
    expect(aliceMeta.catalog.size).toBe(a.length);
    expect(adminMeta.catalog.size).toBe(r.length);
    expect(adminMeta.catalog.size).toBeGreaterThan(aliceMeta.catalog.size);

    // The shared list was loaded once, at start, for both users; a refresh loads it again.
    expect(t.calls.filter((c) => c.method === "listSignals").length).toBe(listsBefore);
    const refreshed = await alice.post("/api/catalog/refresh");
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.size).toBe(a.length);
    expect(t.calls.filter((c) => c.method === "listSignals").length).toBe(listsBefore + 1);
  });

  it("refuses a hidden signal in a command and accepts a visible one", async () => {
    t = await multiApp();
    const alice = t.as("alice", ["testers"]);
    const created = await alice.post("/api/sessions", {});
    const id = created.body.session.id as string;
    const w = await alice.command({ type: "window.create", from: "0", to: "10" }, id);
    // A signal of a hidden data ref is refused by the guard (403), not "unknown signal".
    const hidden = await alice.command(
      { type: "window.addSignal", windowId: w.body.created, signalId: `${HIDDEN}/${SIG}` },
      id,
    );
    expect([hidden.status, codeOf(hidden.body)]).toEqual([403, "forbidden_data"]);
    const visible = await alice.command(
      { type: "window.addSignal", windowId: w.body.created, signalId: `testcar/${SIG}` },
      id,
    );
    expect(visible.status).toBe(200);
  });

  it("seeds a new session without the events-line signals the creator may not see", async () => {
    const seed = () => ({
      ...EMPTY_WORKSPACE,
      eventSignals: [`testcar/${SIG}`, `${HIDDEN}/${SIG}`],
    });
    t = await multiApp({ seed });
    const alice = t.as("alice", ["testers"]);
    const admin = t.as("root", ["admins"]);
    const a = await alice.post("/api/sessions", {});
    const r = await admin.post("/api/sessions", {});
    expect(a.status).toBe(200);
    const ws = async (c: typeof alice, id: string) =>
      (await c.get(`/api/s/${id}/workspace`)).body.workspace;
    expect((await ws(alice, a.body.session.id)).eventSignals).toEqual([`testcar/${SIG}`]);
    expect((await ws(admin, r.body.session.id)).eventSignals).toEqual([
      `testcar/${SIG}`,
      `${HIDDEN}/${SIG}`,
    ]);
    // Her default session is seeded the same way.
    const other = await t.as("carol", ["testers"]).get("/api/workspace");
    expect(other.body.workspace.eventSignals).toEqual([`testcar/${SIG}`]);
  });
});

describe("scoped mode", () => {
  it("answers a hidden data ref alike whether it exists, whatever the scope", async () => {
    t = await multiApp({ mode: "scoped" });
    const alice = t.as("alice", ["testers"]);
    const id = (await alice.post("/api/sessions", {})).body.session.id as string;
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
      const res = await alice.get(`/api/s/${id}/density?dataRef=${ref}`);
      expect([res.status, codeOf(res.body)], ref).toEqual([403, "forbidden_data"]);
      answers.push(res.text.replaceAll(ref, "REF"));
    }
    expect(answers[0]).toBe(answers[1]);
    // A scope on a hidden data ref is refused before its signal list is loaded.
    for (const ref of REFS) {
      const res = await alice.command(
        { type: "scope.set", dataRef: ref, from: SCOPE.from, to: SCOPE.to },
        id,
      );
      expect([res.status, codeOf(res.body)], ref).toEqual([403, "forbidden_data"]);
    }
    expect(t.calls.slice(callsBefore)).toEqual([]);
    // A visible data ref outside the scope still answers as before.
    const other = await alice.get(`/api/s/${id}/density?dataRef=testcar2`);
    expect(other.status).toBe(409);
    expect(codeOf(other.body)).toBe("out_of_scope");
  });
});

describe("sharing never widens data access", () => {
  it("refuses a shared session holding hidden data", async () => {
    t = await multiApp();
    const admin = t.as("admin", ["admins"]);
    const alice = t.as("alice", ["testers"]);
    const a = (await admin.post("/api/sessions", {})).body.session.id as string;
    const window = await admin.command(
      { type: "window.create", from: T1.toString(), to: (T1 + 600_000_000_000n).toString() },
      a,
    );
    expect(window.status).toBe(200);
    expect(
      (
        await admin.command(
          { type: "window.addSignal", windowId: window.body.created, signalId: `testcar/${SIG}` },
          a,
        )
      ).status,
    ).toBe(200);
    expect((await admin.post(`/api/sessions/${a}/share`, { share: "write" })).status).toBe(200);

    // A private session of admin for the comparison of the refusal bodies.
    const p = (await admin.post("/api/sessions", {})).body.session.id as string;
    const privateAnswer = await alice.get(`/api/s/${p}/workspace`);
    expect([privateAnswer.status, codeOf(privateAnswer.body)]).toEqual([403, "forbidden"]);

    const live = await alice.live(a);
    await live.next((m) => m.type === "state");
    expect((await alice.get(`/api/s/${a}/workspace`)).status).toBe(200);

    // Admin adds a signal of a data ref alice may not see.
    const add = await admin.command(
      { type: "window.addSignal", windowId: window.body.created, signalId: `${HIDDEN}/${SIG}` },
      a,
    );
    expect(add.status).toBe(200);
    expect(await live.closedBy()).toBe(4403);
    // The channel never carried the hidden signal: the close comes before the state with it.
    expect(JSON.stringify(live.messages)).not.toContain(HIDDEN);

    const workspace = await alice.get(`/api/s/${a}/workspace`);
    const catalog = await alice.get(`/api/s/${a}/catalog`);
    for (const res of [workspace, catalog]) {
      expect([res.status, codeOf(res.body)]).toEqual([403, "forbidden"]);
      expect(res.body).toEqual(privateAnswer.body);
    }
    // No other route of the session opens either, and no change gets through.
    expect((await alice.command({ type: "cursor.set", cursor: "a", t: "5" }, a)).status).toBe(403);
    expect((await alice.get(`/api/s/${a}/render-status`)).status).toBe(403);
    expect((await alice.get(`/api/s/${a}/meta`)).status).toBe(403);
    expect((await alice.get(`/api/sessions/${a}`)).status).toBe(403);
    const reconnect = await alice.live(a);
    expect(reconnect.messages).toEqual([]);
    expect(reconnect.status === 403 || reconnect.closeCode !== undefined).toBe(true);
    // The owner still opens it.
    expect((await admin.get(`/api/s/${a}/workspace`)).status).toBe(200);
  });

  it("does not serve an own session that holds data the user lost the right to", async () => {
    t = await multiApp();
    const before = t.as("alice", ["admins"]);
    const id = (await before.post("/api/sessions", {})).body.session.id as string;
    const w = await before.command(
      { type: "window.create", from: T1.toString(), to: (T1 + 600_000_000_000n).toString() },
      id,
    );
    await before.command(
      { type: "window.addSignal", windowId: w.body.created, signalId: `${HIDDEN}/${SIG}` },
      id,
    );

    // The same user, now with a narrower role.
    const now = t.as("alice", ["testers"]);
    const direct = await now.get(`/api/s/${id}/workspace`);
    expect([direct.status, codeOf(direct.body)]).toEqual([403, "forbidden"]);
    // The default session is a new one, not the latest own session that holds hidden data.
    const fallback = await now.get("/api/workspace");
    expect(fallback.status).toBe(200);
    expect(fallback.headers["x-kipscope-session"]).not.toBe(id);
    expect(fallback.body.workspace.windows).toEqual([]);
    // She still lists it (without rights) and may delete it.
    const list = await now.get("/api/sessions");
    const listed = list.body.sessions.find((s: { id: string }) => s.id === id);
    expect(listed).toBeDefined();
    expect(listed.rights).toBeUndefined();
    expect((await now.del(`/api/sessions/${id}`)).status).toBe(200);
  });

  it("needs the share right to share", async () => {
    t = await multiApp();
    const alice = t.as("alice", ["testers"]);
    const id = (await alice.post("/api/sessions", {})).body.session.id as string;
    for (const share of ["read", "write"]) {
      const res = await alice.post(`/api/sessions/${id}/share`, { share });
      expect([res.status, codeOf(res.body)], share).toEqual([403, "share_not_permitted"]);
    }
    expect((await alice.get(`/api/sessions/${id}`)).body.session.share).toBe("private");
    const back = await alice.post(`/api/sessions/${id}/share`, { share: "private" });
    expect(back.status).toBe(200);
    expect(back.body.session.share).toBe("private");
    // With a role that may share, the same request works.
    const lead = t.as("lead", ["admins"]);
    const mine = (await lead.post("/api/sessions", {})).body.session.id as string;
    expect(
      (await lead.post(`/api/sessions/${mine}/share`, { share: "read" })).body.session.share,
    ).toBe("read");
  });

  it("never lets a share make a session readable by a user with no data right to it", async () => {
    t = await multiApp();
    const admin = t.as("admin", ["admins"]);
    const id = (await admin.post("/api/sessions", {})).body.session.id as string;
    const w = await admin.command(
      { type: "window.create", from: T1.toString(), to: (T1 + 600_000_000_000n).toString() },
      id,
    );
    await admin.command(
      { type: "window.addSignal", windowId: w.body.created, signalId: `${HIDDEN}/${SIG}` },
      id,
    );
    for (const share of ["read", "write"]) {
      expect((await admin.post(`/api/sessions/${id}/share`, { share })).status).toBe(200);
      const alice = t.as("alice", ["testers"]);
      for (const path of ["workspace", "catalog", "signals", "render-status", "meta", "extent"]) {
        const res = await alice.get(`/api/s/${id}/${path}`);
        expect(res.status, `${share} ${path}`).toBe(403);
      }
      const command = await alice.command({ type: "window.create" }, id);
      expect(command.status, share).toBe(403);
      expect(codeOf(command.body)).toBe("forbidden");
    }
  });
});
