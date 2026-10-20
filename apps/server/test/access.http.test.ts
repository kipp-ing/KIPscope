import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RenderStatus } from "@kipscope/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { accessLog, hostAllowed, isLoopbackHost, originAllowed } from "../src/access.ts";
import { buildApp } from "../src/app.ts";
import { Catalog } from "../src/catalog.ts";
import type { DataSource } from "../src/datasource.ts";
import type { IdentityAdapter } from "../src/identity.ts";
import { WorkspaceStore } from "../src/workspace.ts";
import { type MultiApp, multiApp } from "./identityApp.ts";

const source = {
  listSignals: async () => [{ dataRef: "car", name: "S" }],
} as unknown as DataSource;

function setup(options: { extraHost?: string } = {}) {
  const workspace = new WorkspaceStore({
    signalExists: (id) => id.startsWith("car/"),
    hasStates: () => false,
  });
  const catalog = new Catalog(source, async () => new Map());
  const app = buildApp({ catalog, source, workspace }, options);
  return { app, workspace };
}

const command = { type: "window.create", from: "0", to: "10" };

type Attempt = { messages: string[]; status?: number | undefined; closeCode?: number | undefined };

/** Opens the live channel with the given headers; reports what happened until it ends. */
function liveAttempt(base: string, headers: Record<string, string>) {
  return new Promise<Attempt>((resolve) => {
    const ws = new WebSocket(`${base.replace("http", "ws")}/api/live`, { headers });
    const messages: string[] = [];
    let status: number | undefined;
    ws.on("message", (data) => messages.push(data.toString()));
    ws.on("unexpected-response", (_req, res) => {
      status = res.statusCode;
      res.resume();
      ws.terminate();
    });
    ws.on("error", () => {});
    ws.on("close", (closeCode) => resolve({ messages, status, closeCode }));
    // A server that accepts the connection never closes it; give up and let the assertions fail.
    setTimeout(() => ws.terminate(), 2000).unref();
  });
}

/** True when the attempt got no message and was refused (handshake 403 or close 1008). */
function refused(r: Attempt) {
  expect(r.messages).toEqual([]);
  expect(r.status === 403 || r.closeCode === 1008).toBe(true);
}

describe("access guard over HTTP", () => {
  const { app, workspace } = setup();
  afterAll(() => app.close());

  it("accepts loopback Host headers with any port", async () => {
    for (const host of [
      "localhost:7310",
      "127.0.0.1:7310",
      "[::1]:7310",
      "LOCALHOST",
      "localhost:5173",
    ]) {
      const res = await app.inject({ url: "/api/workspace", headers: { host } });
      expect(res.statusCode, host).toBe(200);
    }
  });

  it("accepts local origins and requests without origin", async () => {
    const before = workspace.revision;
    for (const headers of [
      { origin: "http://localhost:5173" },
      { origin: "http://127.0.0.1:5173" },
      {},
    ]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/commands",
        headers,
        body: command,
      });
      expect(res.statusCode, JSON.stringify(headers)).toBe(200);
    }
    expect(workspace.revision).toBe(before + 3);
  });

  it("refuses non-JSON bodies with 415", async () => {
    const before = workspace.revision;
    const res = await app.inject({
      method: "POST",
      url: "/api/commands",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(command),
    });
    expect(res.statusCode).toBe(415);
    expect(workspace.revision).toBe(before);
  });

  it("tells loopback hosts from network-facing ones", () => {
    const hosts = ["127.0.0.1", "localhost", "::1", "0.0.0.0", "::", "192.168.42.10"];
    expect(hosts.map(isLoopbackHost)).toEqual([true, true, true, false, false, false]);
  });
});

describe("access guard on HTTP and the live channel", () => {
  const { app, workspace } = setup();
  let base = "";
  beforeAll(async () => {
    base = await app.listen({ port: 0, host: "127.0.0.1" });
  });
  afterAll(() => app.close());

  it("refuses a foreign Host on HTTP and on the live channel", async () => {
    const res = await app.inject({ url: "/api/catalog", headers: { host: "evil.example:7310" } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("forbidden_host");
    refused(await liveAttempt(base, { Host: "evil.example" }));
  });

  it("refuses foreign origins on HTTP and on the live channel", async () => {
    const before = workspace.revision;
    const evil = { origin: "https://evil.example" };
    const post = await app.inject({
      method: "POST",
      url: "/api/commands",
      headers: evil,
      body: command,
    });
    const refresh = await app.inject({
      method: "POST",
      url: "/api/catalog/refresh",
      headers: evil,
    });
    const nullOrigin = await app.inject({ url: "/api/workspace", headers: { origin: "null" } });
    for (const res of [post, refresh, nullOrigin]) {
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("forbidden_origin");
    }
    refused(await liveAttempt(base, { Origin: "https://evil.example" }));
    expect(workspace.revision).toBe(before);
  });

  it("closes a live connection on a frame over 256 KiB", async () => {
    const renderStatus = async (): Promise<RenderStatus> =>
      (await fetch(`${base}/api/render-status`)).json() as Promise<RenderStatus>;
    const ws = new WebSocket(`${base.replace("http", "ws")}/api/live`);
    const closed = new Promise<number>((resolve) => ws.on("close", resolve));
    await new Promise((resolve) => ws.once("open", resolve));
    await expect.poll(async () => (await renderStatus()).clients.length).toBe(1);
    ws.send("x".repeat(300 * 1024));
    expect(await closed).toBe(1009);
    await expect.poll(async () => (await renderStatus()).clients.length).toBe(0);
  });
});

describe("configured non-loopback host", () => {
  const { app } = setup({ extraHost: "192.168.42.10" });
  afterAll(() => app.close());

  it("accepts the configured non-loopback host", async () => {
    const ok = await app.inject({
      url: "/api/workspace",
      headers: { host: "192.168.42.10:7310" },
    });
    expect(ok.statusCode).toBe(200);
    const other = await app.inject({
      url: "/api/workspace",
      headers: { host: "192.168.42.11:7310" },
    });
    expect(other.statusCode).toBe(403);
    expect(other.json().error.code).toBe("forbidden_host");
  });
});

describe("configured origins (add-multiuser M10)", () => {
  const ORIGIN = "https://kipscope.example.org";
  let t: MultiApp | undefined;
  afterEach(async () => {
    await t?.close();
    t = undefined;
  });

  it("accepts the host of a configured origin", async () => {
    t = await multiApp({ identity: "none", origins: [ORIGIN] });
    const statusOf = async (host: string) =>
      (await t?.anon.get("/api/workspace", { host }))?.status;
    expect(await statusOf("kipscope.example.org")).toBe(200);
    expect(await statusOf("KIPSCOPE.example.org:443")).toBe(200);
    const other = await t.anon.get("/api/workspace", { host: "other.example.org" });
    expect(other.status).toBe(403);
    expect(other.body.error.code).toBe("forbidden_host");
    // Without the origin configured the same host is foreign.
    const plain = await multiApp({ identity: "none" });
    const refused = await plain.anon.get("/api/workspace", { host: "kipscope.example.org" });
    expect(refused.status).toBe(403);
    await plain.close();
  });

  it("accepts a configured origin only exactly", async () => {
    t = await multiApp({ identity: "none", origins: [ORIGIN] });
    const workspace = t.workspaces.create("local");
    const before = workspace.store.revision;
    const send = (origin: string) =>
      t?.anon.request("POST", `/api/w/${workspace.record.id}/commands`, command, { origin });
    expect((await send("https://kipscope.example.org"))?.status).toBe(200);
    expect((await send("https://kipscope.example.org:443"))?.status).toBe(200);
    for (const origin of [
      "http://kipscope.example.org",
      "https://kipscope.example.org:8443",
      "https://kipscope.example.org.evil.example",
      "https://evilkipscope.example.org",
      "https://evil.example",
      "null",
    ]) {
      const res = await send(origin);
      expect(res?.status, origin).toBe(403);
      expect(res?.body.error.code, origin).toBe("forbidden_origin");
    }
    expect(workspace.store.revision).toBe(before + 2);
  });

  it("checks origins before it identifies anyone", async () => {
    const refuseAll: IdentityAdapter = {
      kind: "t",
      identify: async () => ({ refused: "unauthenticated" }),
    };
    t = await multiApp({ identity: refuseAll, origins: [ORIGIN] });
    const foreign = await t.anon.get("/api/me", { origin: "https://evil.example" });
    expect([foreign.status, foreign.body.error.code]).toEqual([403, "forbidden_origin"]);
    const host = await t.anon.get("/api/me", { host: "evil.example" });
    expect([host.status, host.body.error.code]).toEqual([403, "forbidden_host"]);
    const own = await t.anon.get("/api/me", { origin: ORIGIN, host: "kipscope.example.org" });
    expect([own.status, own.body.error.code]).toEqual([401, "unauthenticated"]);
  });

  it("refuses a foreign origin on the live channel and accepts a configured one", async () => {
    t = await multiApp({ origins: [ORIGIN] });
    const alice = t.as("alice", ["all"]);
    const id = (await alice.post("/api/workspaces", {})).body.workspace.id as string;
    const foreign = await alice.live(id, { origin: "https://evil.example" });
    expect(foreign.messages).toEqual([]);
    expect(foreign.status === 403 || foreign.closeCode === 1008).toBe(true);
    const own = await alice.live(id, { origin: ORIGIN, host: "kipscope.example.org" });
    await own.next((m) => m.type === "state");
    expect(own.messages.map((m) => m.type)).toEqual(["hello", "summary", "state"]);
    own.close();
  });

  it("compares scheme, host and port of an origin after normalisation", () => {
    const options = { origins: ["https://h.example", "http://b.example:8080"] };
    const yes = [
      "https://h.example",
      "https://h.example:443",
      "HTTPS://H.EXAMPLE",
      "http://b.example:8080",
    ];
    const no = [
      "http://h.example",
      "https://h.example:8443",
      "http://b.example",
      "https://b.example:8080",
      "ftp://h.example",
      "null",
      "https://h.example.evil.example",
    ];
    for (const origin of yes) expect(originAllowed(origin, options), origin).toBe(true);
    for (const origin of no) expect(originAllowed(origin, options), origin).toBe(false);
    expect(originAllowed(undefined, options)).toBe(true);
    // Loopback pages stay allowed whatever is configured.
    expect(originAllowed("http://localhost:5173", options)).toBe(true);
    expect(hostAllowed("h.example:1234", options)).toBe(true);
    expect(hostAllowed("B.Example", options)).toBe(true);
    expect(hostAllowed("c.example", options)).toBe(false);
    expect(hostAllowed(undefined, options)).toBe(false);
  });

  it("logs the access settings per mode", () => {
    const none = { identity: { kind: "none" } as const, share: true, origins: [] as string[] };
    expect(accessLog({ ...none, host: "127.0.0.1" })).toEqual([]);
    const open = accessLog({ ...none, host: "0.0.0.0" });
    expect(open).toHaveLength(1);
    expect(open[0]?.level).toBe("warn");
    expect(open[0]?.message).toContain("every machine that reaches it");

    const lines = accessLog({
      host: "0.0.0.0",
      identity: {
        kind: "oidc",
        oidc: {
          issuer: "https://idp.example.org",
          audience: "kipscope",
          userClaim: "sub",
          rolesClaim: "roles",
          header: "authorization",
          algs: ["RS256"],
        },
      },
      share: false,
      origins: [ORIGIN],
    });
    const info = lines.filter((l) => l.level === "info");
    const warn = lines.filter((l) => l.level === "warn");
    expect(info).toHaveLength(1);
    for (const part of ["oidc", "https://idp.example.org", "kipscope", "sharing off", ORIGIN])
      expect(info[0]?.message).toContain(part);
    // No rules file any more (D-085).
    expect(info[0]?.message).not.toMatch(/rules/i);
    expect(warn).toHaveLength(1);
    expect(warn[0]?.message).toContain("only the proxy");
    // A loopback host with an identity: the info line only, and sharing on.
    const local = accessLog({
      host: "127.0.0.1",
      identity: { kind: "module", path: "/srv/id.mjs" },
      share: true,
      origins: [ORIGIN],
    });
    expect(local.map((l) => l.level)).toEqual(["info"]);
    expect(local[0]?.message).toContain("/srv/id.mjs");
    expect(local[0]?.message).toContain("sharing on");
  });

  it("logs the access lines at start", () => {
    // main.ts calls accessLog; a refactor that drops the call would hide the start lines.
    const main = readFileSync(resolve(import.meta.dirname, "../src/main.ts"), "utf8");
    expect(main).toContain("accessLog(");
  });
});
