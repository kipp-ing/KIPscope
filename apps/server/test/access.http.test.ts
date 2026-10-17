import type { RenderStatus } from "@kipscope/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { isLoopbackHost } from "../src/access.ts";
import { buildApp } from "../src/app.ts";
import { Catalog } from "../src/catalog.ts";
import type { DataSource } from "../src/datasource.ts";
import { WorkspaceStore } from "../src/workspace.ts";

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
