import {
  CLOSE_NO_ACCESS,
  CLOSE_SESSION_GONE,
  EMPTY_WORKSPACE,
  encodeViewLink,
  type Me,
  type SessionSummary,
  type ViewDoc,
} from "@kipscope/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { applyLiveMessage, FINAL_CLOSES, type LiveState } from "../src/live.ts";
import { apiPath, resolvesSession, withSession } from "../src/session/apiPath.ts";
import { gateOf, LATEST_SESSION, NEW_SESSION } from "../src/session/gate.ts";
import { ReadOnlyPill, readOnlyTitle } from "../src/session/ReadOnlyPill.tsx";
import { startupTarget } from "../src/session/startup.ts";
import { sessionTitle, sinceText } from "../src/session/title.ts";

const at = (path: string) => {
  const url = new URL(`http://localhost:7310${path}`);
  return { pathname: url.pathname, search: url.search, hash: url.hash };
};

const summary = (id: string, over: Partial<SessionSummary> = {}): SessionSummary => ({
  id,
  owner: "alice",
  share: "private",
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

describe("session start-up (add-multiuser M12)", () => {
  it("chooses the session from the address", async () => {
    const x = summary("xxxxxxxxxx");
    const y = summary("yyyyyyyyyy");
    expect(await startupTarget(at("/s/abcdefghij"), [x, y])).toEqual({ session: "abcdefghij" });
    expect(await startupTarget(at("/"), [x, y])).toEqual({ session: "xxxxxxxxxx" });
    expect(await startupTarget(at("/"), [])).toEqual({ create: {} });

    const code = await encodeViewLink(DOC);
    expect(await startupTarget(at(`/#view=${code}`), [x])).toEqual({
      create: { open: { view: JSON.parse(JSON.stringify(DOC)) } },
    });
    expect(await startupTarget(at("/s/abcdefghij?view=demo"), [x])).toEqual({
      create: { open: { name: "demo" } },
    });
    // A path that is no session address.
    expect(await startupTarget(at("/s/ABC"), [x])).toEqual({ latest: true });
    expect(await startupTarget(at("/elsewhere"), [x])).toEqual({ latest: true });
  });

  it("skips the sessions the user may not open when `/` picks one", async () => {
    const { rights: _hidden, ...hidden } = summary("hhhhhhhhhh");
    const open = summary("oooooooooo");
    expect(await startupTarget(at("/"), [hidden, open])).toEqual({ session: "oooooooooo" });
    expect(await startupTarget(at("/"), [hidden])).toEqual({ create: {} });
  });

  it("lets a view link win over the session in the path", async () => {
    // The link opens in a NEW session: it must not replace the session of the address.
    const target = await startupTarget(at("/s/abcdefghij?view=demo"), []);
    expect("create" in target).toBe(true);
  });

  it("rejects a view code that does not decode", async () => {
    await expect(startupTarget(at("/#view=@@@"), [])).rejects.toThrow();
  });
});

describe("gate pages", () => {
  it("chooses the gate page", () => {
    const me: Pick<Me, "roles"> = { roles: ["nobody"] };
    const gate = (status: number, code: string) => gateOf({ status, code }, me);
    const unknown = gate(404, "unknown_session");
    const forbidden = gate(403, "forbidden");
    const closed = gateOf({ close: CLOSE_NO_ACCESS }, me);
    const noRights = gate(403, "no_rights");
    const signedOut = gate(401, "unauthenticated");
    const down = gate(503, "identity_unavailable");
    expect(unknown?.title).toBe("Session not found");
    expect(forbidden?.title).toBe("No access to this session");
    expect(closed?.title).toBe("No access to this session");
    expect(noRights?.title).toBe("No access rights");
    expect(noRights?.text).toContain("nobody");
    expect(signedOut?.title).toBe("Not signed in");
    expect(down?.title).toBe("Sign-in service unreachable");
    // Only the first three offer the two buttons.
    for (const g of [unknown, forbidden, closed])
      expect(g?.actions).toEqual([LATEST_SESSION, NEW_SESSION]);
    for (const g of [noRights, signedOut, down]) expect(g?.actions).toEqual([]);
    expect(LATEST_SESSION).toBe("My latest session");
    expect(NEW_SESSION).toBe("New session");
  });

  it("gives a deleted session the not-found page and an invalid token the sign-in page", () => {
    expect(gateOf({ close: CLOSE_SESSION_GONE })?.title).toBe("Session not found");
    expect(gateOf(CLOSE_SESSION_GONE)?.title).toBe("Session not found");
    expect(gateOf({ status: 401, code: "invalid_token" })?.title).toBe("Not signed in");
  });

  it("names no roles when the user has none", () => {
    expect(gateOf({ status: 403, code: "no_rights" }, { roles: [] })?.text).toContain("none");
    expect(gateOf({ status: 403, code: "no_rights" })?.text).toContain("none");
    expect(gateOf({ status: 403, code: "no_rights" }, { roles: ["a", "b"] })?.text).toContain(
      "a, b",
    );
  });

  it("shows no gate for errors that are none", () => {
    expect(gateOf({ status: 500, code: "internal" })).toBeUndefined();
    expect(gateOf({ status: 404, code: "unknown_view" })).toBeUndefined();
    expect(gateOf({ status: 403, code: "read_only" })).toBeUndefined();
    expect(gateOf({ status: 403, code: "forbidden_data" })).toBeUndefined();
    expect(gateOf({ close: 1006 })).toBeUndefined();
  });
});

describe("API paths of a session", () => {
  it("prefixes session routes only", () => {
    const id = "abcdefghij";
    expect(apiPath("/api/series?x=1", id)).toBe("/api/s/abcdefghij/series?x=1");
    expect(apiPath("/api/live", id)).toBe("/api/s/abcdefghij/live");
    expect(apiPath("/api/sessions", id)).toBe("/api/sessions");
    expect(apiPath("/api/me", id)).toBe("/api/me");
    expect(apiPath("/api/views", id)).toBe("/api/views");
  });

  it("keeps the other session-independent routes bare and prefixes the rest", () => {
    const id = "abcdefghij";
    for (const bare of [
      "/api/sessions/zzzzzzzzzz",
      "/api/sessions/zzzzzzzzzz/share",
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
      expect(apiPath(prefixed, id), prefixed).toBe(`/api/s/${id}${prefixed.slice("/api".length)}`);
  });

  it("leaves a prefixed, a foreign and a session-less path as they are", () => {
    expect(apiPath("/api/s/zzzzzzzzzz/series", "abcdefghij")).toBe("/api/s/zzzzzzzzzz/series");
    expect(apiPath("/assets/app.js", "abcdefghij")).toBe("/assets/app.js");
    expect(apiPath("/api/series", undefined)).toBe("/api/series");
    expect(withSession("/api/views", "abcdefghij")).toBe("/api/s/abcdefghij/views");
    expect(resolvesSession("/api/commands")).toBe(true);
    expect(resolvesSession("/api/me")).toBe(false);
    expect(resolvesSession("/elsewhere")).toBe(false);
  });
});

describe("live channel state", () => {
  it("keeps the session of the `session` message and does not reconnect after 4403 or 4404", () => {
    const start: LiveState = { connected: false, revision: -1, rangeSets: 0 };
    const s = summary("abcdefghij", { rights: { open: true, change: false, owner: false } });
    const next = applyLiveMessage(start, { type: "session", session: s });
    expect(next.session).toBe(s);
    expect(next.revision).toBe(-1);
    // A state message keeps it.
    const state = applyLiveMessage(next, {
      type: "state",
      revision: 3,
      workspace: EMPTY_WORKSPACE,
    });
    expect(state.session).toBe(s);
    expect(state.revision).toBe(3);
    expect([...FINAL_CLOSES].sort()).toEqual([CLOSE_NO_ACCESS, CLOSE_SESSION_GONE].sort());
  });
});

describe("session titles", () => {
  it("titles sessions", () => {
    expect(sessionTitle({ view: { title: "Drive 3", modified: false } })).toBe("Drive 3");
    expect(sessionTitle({ measurement: "smart451 test" })).toBe("smart451 test");
    const scope = {
      dataRef: "smart451",
      from: "1791892800000000000", // 2026-10-13T12:00:00Z (1791896880 s is 13:08:00Z, minus 68 min)
      to: "1791896400000000000",
    };
    expect(sessionTitle({ scope }, "Europe/Berlin")).toBe("smart451 2026-10-13 14:00");
    expect(sessionTitle({})).toBe("New session");
    // The view title wins over the measurement, the measurement over the scope.
    expect(
      sessionTitle(
        { view: { title: "V", modified: true }, measurement: "M", scope },
        "Europe/Berlin",
      ),
    ).toBe("V");
    expect(sessionTitle({ measurement: "M", scope }, "Europe/Berlin")).toBe("M");
  });

  it("says when a session was last active", () => {
    const now = Date.parse("2026-10-19T12:00:00Z");
    expect(sinceText("2026-10-19T11:59:40Z", now)).toBe("just now");
    expect(sinceText("2026-10-19T11:55:00Z", now)).toBe("5 min ago");
    expect(sinceText("2026-10-19T09:00:00Z", now)).toBe("3 h ago");
    expect(sinceText("2026-10-17T12:00:00Z", now)).toBe("2 days ago");
    expect(sinceText("2026-10-18T11:00:00Z", now)).toBe("1 day ago");
  });
});

describe("read-only pill", () => {
  it("shows for a session the user may open but not change", () => {
    const readOnly = summary("abcdefghij", {
      owner: "alice",
      rights: { open: true, change: false, owner: false },
    });
    const html = renderToStaticMarkup(createElement(ReadOnlyPill, { session: readOnly }));
    expect(html).toContain("Read-only");
    expect(html).toContain(readOnlyTitle("alice"));
    expect(readOnlyTitle("alice")).toBe(
      "alice shares this session read-only. Copy link opens your own copy.",
    );
  });

  it("shows nothing for an own or writable session, or before the session is known", () => {
    for (const session of [
      summary("abcdefghij"),
      summary("abcdefghij", { rights: { open: true, change: true, owner: false } }),
      undefined,
    ])
      expect(renderToStaticMarkup(createElement(ReadOnlyPill, { session }))).toBe("");
  });
});
