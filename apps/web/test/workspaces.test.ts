import {
  CasesDocument,
  CLOSE_NO_ACCESS,
  CLOSE_WORKSPACE_GONE,
  EMPTY_WORKSPACE,
  encodeCasesLink,
  encodeViewLink,
  type Me,
  RECENT_WORKSPACES,
  type ViewDoc,
  type WorkspaceSummary,
} from "@kipscope/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyLiveMessage, FINAL_CLOSES, type LiveState } from "../src/live.ts";
import { apiPath, resolvesWorkspace, withWorkspace } from "../src/workspaces/apiPath.ts";
import { GatePage } from "../src/workspaces/Gate.tsx";
import { gateOf, LATEST_WORKSPACE, NEW_WORKSPACE } from "../src/workspaces/gate.ts";
import { ReadOnlyPill, readOnlyTitle } from "../src/workspaces/ReadOnlyPill.tsx";
import { recentRows } from "../src/workspaces/recent.ts";
import { shareItems } from "../src/workspaces/share.ts";
import { CASES_FAILED, startupTarget, startWorkspace } from "../src/workspaces/startup.ts";
import { sinceText, workspaceTitle } from "../src/workspaces/title.ts";

const at = (path: string) => {
  const url = new URL(`http://localhost:7310${path}`);
  return { pathname: url.pathname, search: url.search, hash: url.hash };
};

const summary = (id: string, over: Partial<WorkspaceSummary> = {}): WorkspaceSummary => ({
  id,
  owner: "alice",
  share: "private",
  granted: "all",
  createdAt: "2026-10-19T08:00:00.000Z",
  lastActiveAt: "2026-10-19T08:00:00.000Z",
  revision: 0,
  windows: 0,
  clients: 0,
  rights: { open: true, change: true, owner: true },
  ...over,
});

const DOC: ViewDoc = {
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
  ],
};

describe("workspace start-up (add-multiuser M12)", () => {
  it("chooses the workspace from the address", async () => {
    // The page and the legacy address both name the workspace and the path to show.
    expect(await startupTarget(at("/w/abcdefghij"))).toEqual({
      workspace: "abcdefghij",
      path: "/w/abcdefghij",
    });
    expect(await startupTarget(at("/s/abcdefghij"))).toEqual({
      workspace: "abcdefghij",
      path: "/w/abcdefghij",
    });
    // `/` reuses a free workspace.
    expect(await startupTarget(at("/"))).toEqual({ create: { reuse: true } });

    const code = await encodeViewLink(DOC);
    expect(await startupTarget(at(`/#view=${code}`))).toEqual({
      create: { open: { view: JSON.parse(JSON.stringify(DOC)) } },
    });
    expect(await startupTarget(at("/w/abcdefghij?view=demo"))).toEqual({
      create: { open: { name: "demo" } },
    });
    // A path that is no workspace address starts like `/`.
    expect(await startupTarget(at("/w/ABC"))).toEqual({ create: { reuse: true } });
    expect(await startupTarget(at("/elsewhere"))).toEqual({ create: { reuse: true } });
  });

  it("lets a view link win over the workspace in the path", async () => {
    // The link opens in a NEW workspace: it must not replace the workspace of the address.
    const target = await startupTarget(at("/w/abcdefghij?view=demo"));
    expect("create" in target).toBe(true);
    const legacy = await startupTarget(at("/s/abcdefghij?view=demo"));
    expect("create" in legacy).toBe(true);
  });

  it("rejects a view code that does not decode", async () => {
    await expect(startupTarget(at("/#view=@@@"))).rejects.toThrow();
  });
});

describe("gate pages", () => {
  it("says who the user is signed in as", () => {
    const alice: Me = { user: "alice", identity: "oidc", roles: ["viewers"], canShare: true };
    const local: Me = { user: "local", identity: "none", roles: [], canShare: true };
    const empty = gateOf({ summary: { granted: 0 } }, alice);
    const forbidden = gateOf({ status: 403, code: "forbidden" }, alice);
    for (const gate of [empty, forbidden]) {
      if (!gate) throw new Error("expected a gate");
      const html = renderToStaticMarkup(createElement(GatePage, { gate, me: alice }));
      expect(html).toContain(gate.title);
      expect(html).toContain("Signed in as alice (oidc) · roles: viewers");
    }
    // As in the footer: no user line with the identity none, and none before /api/me answered.
    const gate = gateOf({ status: 404, code: "unknown_workspace" });
    if (!gate) throw new Error("expected a gate");
    expect(renderToStaticMarkup(createElement(GatePage, { gate, me: local }))).not.toContain(
      "Signed in",
    );
    expect(renderToStaticMarkup(createElement(GatePage, { gate }))).not.toContain("Signed in");
  });

  it("chooses the gate page", () => {
    const server: Pick<Me, "identity"> = { identity: "oidc" };
    const local: Pick<Me, "identity"> = { identity: "none" };
    const gate = (status: number, code: string) => gateOf({ status, code }, server);
    const unknown = gate(404, "unknown_workspace");
    const forbidden = gate(403, "forbidden");
    const closed = gateOf({ close: CLOSE_NO_ACCESS }, server);
    const empty = gateOf({ summary: { granted: 0 } }, server);
    const emptyLocal = gateOf({ summary: { granted: 0 } }, local);
    const signedOut = gate(401, "unauthenticated");
    const down = gate(503, "identity_unavailable");
    expect(unknown?.title).toBe("Workspace not found");
    expect(forbidden?.title).toBe("No access to this workspace");
    expect(closed?.title).toBe("No access to this workspace");
    expect(empty?.title).toBe("Open a session from KI.ping");
    expect(empty?.text).toBe(
      "This workspace has no data yet. KI.ping decides which vehicles you may see: open a session there and it opens here.",
    );
    // With the identity none an empty grant is no gate.
    expect(emptyLocal).toBeUndefined();
    expect(signedOut?.title).toBe("Not signed in");
    expect(signedOut?.text).toBe("Reload to sign in.");
    expect(down?.title).toBe("Sign-in service unreachable");
    expect(down?.text).toBe("Try again later.");
    // Only the first three offer the two buttons.
    for (const g of [unknown, forbidden, closed])
      expect(g?.actions).toEqual([LATEST_WORKSPACE, NEW_WORKSPACE]);
    for (const g of [empty, signedOut, down]) expect(g?.actions).toEqual([]);
    expect(LATEST_WORKSPACE).toBe("My latest workspace");
    expect(NEW_WORKSPACE).toBe("New workspace");
  });

  it("lifts the empty-grant gate once the summary brings a grant", () => {
    const server: Pick<Me, "identity"> = { identity: "oidc" };
    expect(gateOf({ summary: { granted: 0 } }, server)).toBeDefined();
    expect(gateOf({ summary: { granted: 2 } }, server)).toBeUndefined();
    expect(gateOf({ summary: { granted: "all" } }, server)).toBeUndefined();
  });

  it("gives a deleted workspace the not-found page and an invalid token the sign-in page", () => {
    expect(gateOf({ close: CLOSE_WORKSPACE_GONE })?.title).toBe("Workspace not found");
    expect(gateOf(CLOSE_WORKSPACE_GONE)?.title).toBe("Workspace not found");
    expect(gateOf({ status: 401, code: "invalid_token" })?.title).toBe("Not signed in");
  });

  it("has no gate for the removed no_rights answer, nor for errors that are none", () => {
    expect(gateOf({ status: 403, code: "no_rights" })).toBeUndefined();
    expect(gateOf({ status: 500, code: "internal" })).toBeUndefined();
    expect(gateOf({ status: 404, code: "unknown_view" })).toBeUndefined();
    expect(gateOf({ status: 403, code: "read_only" })).toBeUndefined();
    expect(gateOf({ status: 403, code: "forbidden_data" })).toBeUndefined();
    expect(gateOf({ close: 1006 })).toBeUndefined();
  });
});

describe("API paths of a workspace", () => {
  it("prefixes workspace routes only", () => {
    const id = "abcdefghij";
    expect(apiPath("/api/series?x=1", id)).toBe("/api/w/abcdefghij/series?x=1");
    expect(apiPath("/api/live", id)).toBe("/api/w/abcdefghij/live");
    expect(apiPath("/api/workspaces", id)).toBe("/api/workspaces");
    expect(apiPath("/api/me", id)).toBe("/api/me");
    expect(apiPath("/api/views", id)).toBe("/api/views");
  });

  it("keeps the other workspace-independent routes bare and prefixes the rest", () => {
    const id = "abcdefghij";
    for (const bare of [
      "/api/workspaces/zzzzzzzzzz",
      "/api/workspaces/zzzzzzzzzz/share",
      "/api/views/speeds",
      "/api/views/speeds?download=1",
      "/api/license",
    ])
      expect(apiPath(bare, id), bare).toBe(bare);
    for (const prefixed of [
      "/api/commands",
      "/api/workspace",
      "/api/render-status",
      "/api/catalog",
      "/api/catalog/refresh",
      "/api/signals?q=a",
      "/api/meta",
      "/api/extent?signal=a/b",
      "/api/density?dataRef=a",
      "/api/gaps?dataRef=a",
      "/api/events?dataRef=a",
      "/api/value?signal=a/b&t=1",
      "/api/views/open",
      "/api/views/import",
    ])
      expect(apiPath(prefixed, id), prefixed).toBe(`/api/w/${id}${prefixed.slice("/api".length)}`);
  });

  it("leaves a prefixed, a foreign and a workspace-less path as they are", () => {
    expect(apiPath("/api/w/zzzzzzzzzz/series", "abcdefghij")).toBe("/api/w/zzzzzzzzzz/series");
    expect(apiPath("/assets/app.js", "abcdefghij")).toBe("/assets/app.js");
    expect(apiPath("/api/series", undefined)).toBe("/api/series");
    expect(withWorkspace("/api/views", "abcdefghij")).toBe("/api/w/abcdefghij/views");
    expect(resolvesWorkspace("/api/commands")).toBe(true);
    expect(resolvesWorkspace("/api/me")).toBe(false);
    expect(resolvesWorkspace("/elsewhere")).toBe(false);
  });
});

describe("live channel state", () => {
  it("keeps the workspace of the `summary` message and does not reconnect after 4403 or 4404", () => {
    const start: LiveState = { connected: false, revision: -1, rangeSets: 0 };
    const s = summary("abcdefghij", { rights: { open: true, change: false, owner: false } });
    const next = applyLiveMessage(start, { type: "summary", summary: s });
    expect(next.summary).toBe(s);
    expect(next.revision).toBe(-1);
    // A state message keeps it.
    const state = applyLiveMessage(next, {
      type: "state",
      revision: 3,
      workspace: EMPTY_WORKSPACE,
    });
    expect(state.summary).toBe(s);
    expect(state.revision).toBe(3);
    expect([...FINAL_CLOSES].sort()).toEqual([CLOSE_NO_ACCESS, CLOSE_WORKSPACE_GONE].sort());
  });

  it("takes a later summary, as a grant that arrives lifts the gate", () => {
    const start: LiveState = { connected: true, revision: 0, rangeSets: 0 };
    const empty = applyLiveMessage(start, {
      type: "summary",
      summary: summary("abcdefghij", { granted: 0 }),
    });
    expect(empty.summary?.granted).toBe(0);
    const widened = applyLiveMessage(empty, {
      type: "summary",
      summary: summary("abcdefghij", { granted: 2 }),
    });
    expect(widened.summary?.granted).toBe(2);
  });
});

describe("workspace titles", () => {
  it("titles workspaces", () => {
    expect(workspaceTitle({ view: { title: "Drive 3", modified: false } })).toBe("Drive 3");
    expect(workspaceTitle({ measurement: "smart451 test" })).toBe("smart451 test");
    const scope = {
      dataRef: "smart451",
      from: "1791892800000000000", // 2026-10-13T12:00:00Z
      to: "1791896400000000000",
    };
    expect(workspaceTitle({ scope }, "Europe/Berlin")).toBe("smart451 2026-10-13 14:00");
    expect(workspaceTitle({})).toBe("New workspace");
    // The view title wins over the measurement, the measurement over the scope.
    expect(
      workspaceTitle(
        { view: { title: "V", modified: true }, measurement: "M", scope },
        "Europe/Berlin",
      ),
    ).toBe("V");
    expect(workspaceTitle({ measurement: "M", scope }, "Europe/Berlin")).toBe("M");
  });

  it("says when a workspace was last active", () => {
    const now = Date.parse("2026-10-19T12:00:00Z");
    expect(sinceText("2026-10-19T11:59:40Z", now)).toBe("just now");
    expect(sinceText("2026-10-19T11:55:00Z", now)).toBe("5 min ago");
    expect(sinceText("2026-10-19T09:00:00Z", now)).toBe("3 h ago");
    expect(sinceText("2026-10-17T12:00:00Z", now)).toBe("2 days ago");
    expect(sinceText("2026-10-18T11:00:00Z", now)).toBe("1 day ago");
  });
});

describe("recent workspaces", () => {
  it("lists recent workspaces", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `workspace${String(i).padStart(2, "0")}`);
    const list = ids.map((id, i) => summary(id, i === 0 ? { clients: 1 } : {}));
    const rows = recentRows(list, ids[2]);
    // The first 10, in list order.
    expect(RECENT_WORKSPACES).toBe(10);
    expect(rows.map((r) => r.id)).toEqual(ids.slice(0, 10));
    // The current one is marked, the one with a client has the dot, every row links to /w/<id>.
    expect(rows.filter((r) => r.current).map((r) => r.id)).toEqual([ids[2]]);
    expect(rows.filter((r) => r.dot).map((r) => r.id)).toEqual([ids[0]]);
    for (const row of rows) expect(row.href, row.id).toBe(`/w/${row.id}`);
    // A row carries its title and when it was last active.
    expect(rows[0]).toMatchObject({ title: "New workspace" });
    expect(typeof rows[0]?.since).toBe("string");
  });

  it("marks no row when the current workspace is not among them", () => {
    const rows = recentRows([summary("aaaaaaaaaa"), summary("bbbbbbbbbb")], "cccccccccc");
    expect(rows.some((r) => r.current)).toBe(false);
    expect(recentRows([], undefined)).toEqual([]);
  });
});

describe("share items", () => {
  const OWN_LINE = "The receiver gets their own copy of this layout; changes stay apart.";
  const SERVER_LINE = "On this server they see data only for vehicles KI.ping opened for them.";
  const owner = summary("abcdefghij", { rights: { open: true, change: true, owner: true } });

  it("offers the share items", () => {
    // 1. The owner on a server with sharing on.
    const one = shareItems({ identity: "oidc", canShare: true }, owner);
    // 2. The owner on a server with sharing off.
    const two = shareItems({ identity: "oidc", canShare: false }, owner);
    // 3. Someone the owner shared a read workspace with.
    const guest = summary("abcdefghij", {
      owner: "alice",
      share: "read",
      rights: { open: true, change: false, owner: false },
    });
    const three = shareItems({ identity: "oidc", canShare: true }, guest);
    // 4. Local mode.
    const four = shareItems({ identity: "none" }, owner);

    for (const items of [one, two, three, four]) {
      expect(items.copy.label).toBe("Copy link (own copy)");
      expect(items.copy.lines[0]).toBe(OWN_LINE);
    }
    for (const items of [one, two, three])
      expect(items.copy.lines).toEqual([OWN_LINE, SERVER_LINE]);
    expect(four.copy.lines).toEqual([OWN_LINE]);

    // 1: Private, Read and Write, all enabled, and the workspace link.
    expect(one.invite.levels?.map((l) => [l.label, l.disabled])).toEqual([
      ["Private", false],
      ["Read", false],
      ["Write", false],
    ]);
    expect(one.invite.button).toBe("Copy workspace link");
    expect(one.invite.lines).toEqual([
      "Read: they watch this workspace live.",
      "Write: they change it with you.",
    ]);
    // 2: Read and Write disabled with the tooltip; Private stays available.
    const levels = two.invite.levels ?? [];
    expect(levels.map((l) => [l.label, l.disabled])).toEqual([
      ["Private", false],
      ["Read", true],
      ["Write", true],
    ]);
    for (const l of levels.filter((x) => x.label !== "Private"))
      expect(l.title).toBe("Sharing is turned off on this server");
    // 3: no radio, who shared it.
    expect(three.invite.levels).toBeUndefined();
    expect(three.invite.lines).toEqual(["Shared by alice (read)"]);
    expect(three.invite.button).toBe("Copy workspace link");
    // 4: no radio, the button says it is the same live workspace.
    expect(four.invite.levels).toBeUndefined();
    expect(four.invite.button).toBe("Copy workspace link (same live workspace)");
    // Only on a server is there anyone to invite: the heading shows there, not in local mode.
    for (const items of [one, two, three])
      expect(items.invite.label).toBe("Invite to this workspace");
    expect(four.invite.label).toBeUndefined();
    expect(four.invite.lines).toEqual([]);
  });
});

describe("read-only pill", () => {
  it("shows for a workspace the user may open but not change", () => {
    const readOnly = summary("abcdefghij", {
      owner: "alice",
      rights: { open: true, change: false, owner: false },
    });
    const html = renderToStaticMarkup(createElement(ReadOnlyPill, { summary: readOnly }));
    expect(html).toContain("Read-only");
    expect(html).toContain("alice shares this workspace read-only.");
    expect(readOnlyTitle("alice")).toBe(
      'alice shares this workspace read-only. "Copy link (own copy)" gives you your own copy.',
    );
  });

  it("shows nothing for an own or writable workspace, or before the summary is known", () => {
    for (const s of [
      summary("abcdefghij"),
      summary("abcdefghij", { rights: { open: true, change: true, owner: false } }),
      undefined,
    ])
      expect(renderToStaticMarkup(createElement(ReadOnlyPill, { summary: s }))).toBe("");
  });
});

describe("catalog start-up (add-case-open K14)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const C4_DOC = {
    kipscope: "cases",
    version: 1,
    cases: [
      {
        id: "testcar|driving|2026-10-01T01:00:00Z",
        object: "testcar",
        from: "2026-10-01T01:00:00Z",
        to: "2026-10-01T01:10:00Z",
      },
    ],
  };
  const ME: Me = { user: "local", identity: "none", roles: [], canShare: true };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  /** The browser as the start-up sees it: a fake server for /api/me and POST /api/workspaces. */
  function browser(open: (body: unknown) => Response) {
    const posts: unknown[] = [];
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        urls.push(`${init?.method ?? "GET"} ${url}`);
        if (url === "/api/me") return json(200, ME);
        if (url === "/api/workspaces" && init?.method === "POST") {
          const body = JSON.parse(String(init.body));
          posts.push(body);
          return open(body);
        }
        throw new Error(`unexpected request ${url}`);
      }),
    );
    const replaceState = vi.fn();
    vi.stubGlobal("history", { replaceState });
    return { posts, urls, replaceState };
  }

  it("chooses a catalog from the address", async () => {
    const code = await encodeCasesLink(CasesDocument.parse(C4_DOC));
    // The finder's link wins over the path; a JWS in the fragment is passed as it is.
    expect(await startupTarget(at(`/open#cases=${code}`))).toEqual({ cases: code });
    expect(await startupTarget(at("/#cases=aaa.bbb.ccc"))).toEqual({ cases: "aaa.bbb.ccc" });
    // No catalog: as before.
    expect(await startupTarget(at("/open"))).toEqual({ create: { reuse: true } });
  });

  it("opens /open#cases= as a new workspace", async () => {
    const code = await encodeCasesLink(CasesDocument.parse(C4_DOC));
    const b = browser(() =>
      json(200, {
        workspace: summary("abcdefghij"),
        case: { count: 4, current: 0, dataRefs: ["testcar"], missing: [], warnings: [] },
      }),
    );
    const started = await startWorkspace(at(`/open#cases=${code}`));
    expect(started).toMatchObject({ kind: "ready", workspace: "abcdefghij" });
    if (started.kind === "ready") expect(started.cases?.count).toBe(4);
    // One post with the code, and the address becomes /w/<id> without a page load.
    expect(b.posts).toEqual([{ open: { cases: code } }]);
    expect(b.urls.filter((u) => u.startsWith("POST"))).toEqual(["POST /api/workspaces"]);
    expect(b.replaceState).toHaveBeenCalledTimes(1);
    expect(b.replaceState).toHaveBeenCalledWith(null, "", "/w/abcdefghij");
  });

  it("shows the gate page of a catalog that did not open", async () => {
    const b = browser(() =>
      json(403, {
        error: { code: "wrong_user", message: "this catalog was made for another user" },
      }),
    );
    const started = await startWorkspace(at("/open#cases=aaa.bbb.ccc"));
    expect(started.kind).toBe("gate");
    if (started.kind !== "gate") return;
    expect(CASES_FAILED).toBe("Could not open the sessions");
    expect(started.gate.title).toBe("Could not open the sessions");
    expect(started.gate.text).toContain("wrong_user");
    expect(started.gate.text).toContain("this catalog was made for another user");
    // The button back to the user's latest workspace.
    expect(started.gate.actions).toEqual([LATEST_WORKSPACE]);
    expect(b.replaceState).not.toHaveBeenCalled();
    // The gate page renders the message.
    const html = renderToStaticMarkup(createElement(GatePage, { gate: started.gate, me: ME }));
    expect(html).toContain("Could not open the sessions");
    expect(html).toContain("wrong_user");
    expect(html).toContain("My latest workspace");
  });
});
