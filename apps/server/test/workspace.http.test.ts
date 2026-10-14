import type { LiveServerMessage, RenderStatus } from "@letsview/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { buildApp } from "../src/app.ts";
import { Catalog } from "../src/catalog.ts";
import type { DataSource } from "../src/datasource.ts";
import { WorkspaceStore } from "../src/workspace.ts";

const source = {} as DataSource;

function setup() {
  const workspace = new WorkspaceStore({ signalExists: (id) => id.startsWith("car/") });
  const app = buildApp({ catalog: new Catalog(source, async () => new Map()), source, workspace });
  return { app, workspace };
}

describe("POST /api/commands, GET /api/workspace", () => {
  const { app } = setup();
  afterAll(() => app.close());

  const command = (body: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/api/commands", body });

  it("increments the revision for accepted commands and returns created IDs", async () => {
    const created = await command({ type: "window.create", from: "0", to: "1000" });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toEqual({ ok: true, revision: 1, created: "w1" });
    const added = await command({ type: "window.addSignal", windowId: "w1", signalId: "car/A" });
    expect(added.json()).toEqual({ ok: true, revision: 2, created: "a2" });
    const state = (await app.inject({ url: "/api/workspace" })).json();
    expect(state.revision).toBe(2);
    expect(state.workspace.windows[0].signals).toEqual([{ id: "a2", signalId: "car/A" }]);
  });

  it("rejects commands without changing the revision", async () => {
    const before = (await app.inject({ url: "/api/workspace" })).json();
    const unknown = await command({ type: "window.remove", windowId: "w99" });
    expect(unknown.statusCode).toBe(422);
    expect(unknown.json()).toMatchObject({ ok: false, code: "unknown_window" });
    const invalid = await command({ type: "window.remove" });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ ok: false, code: "invalid_command" });
    const after = (await app.inject({ url: "/api/workspace" })).json();
    expect(after).toEqual(before);
  });
});

/** Opens a WebSocket and collects server messages. */
async function connect(base: string) {
  const ws = new WebSocket(`${base.replace("http", "ws")}/api/live`);
  const messages: LiveServerMessage[] = [];
  const waiters: (() => void)[] = [];
  ws.on("message", (data) => {
    messages.push(JSON.parse(data.toString()));
    for (const w of waiters.splice(0)) w();
  });
  await new Promise((resolve) => ws.once("open", resolve));
  const next = async (predicate: (m: LiveServerMessage) => boolean) => {
    for (;;) {
      const found = messages.find(predicate);
      if (found) return found;
      await new Promise<void>((r) => waiters.push(r));
    }
  };
  return { ws, messages, next };
}

describe("WS /api/live and GET /api/render-status", () => {
  const { app } = setup();
  let base = "";
  beforeAll(async () => {
    base = await app.listen({ port: 0, host: "127.0.0.1" });
  });
  afterAll(() => app.close());

  const renderStatus = async (): Promise<RenderStatus> =>
    (await fetch(`${base}/api/render-status`)).json() as Promise<RenderStatus>;
  const post = (body: unknown) =>
    fetch(`${base}/api/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json());

  it("sends the state on connect and after each accepted command", async () => {
    const client = await connect(base);
    const hello = await client.next((m) => m.type === "hello");
    expect(hello).toEqual({ type: "hello", clientId: expect.stringMatching(/^c\d+$/) });
    expect(await client.next((m) => m.type === "state" && m.revision === 0)).toBeTruthy();
    await post({ type: "window.create", from: "0", to: "10" });
    const pushed = await client.next((m) => m.type === "state" && m.revision === 1);
    expect(pushed.type === "state" && pushed.workspace.windows).toHaveLength(1);
    client.ws.close();
  });

  it("reports rendered revisions, complete and with errors", async () => {
    const client = await connect(base);
    const hello = await client.next((m) => m.type === "hello");
    const clientId = hello.type === "hello" ? hello.clientId : "";
    const { revision } = await post({ type: "window.create", from: "0", to: "10" });

    client.ws.send(JSON.stringify({ type: "rendered", revision, status: "complete" }));
    await expect
      .poll(
        async () =>
          (await renderStatus()).clients.find((c) => c.clientId === clientId)?.rendered?.revision,
      )
      .toBe(revision);

    const { revision: next } = await post({
      type: "window.addSignal",
      windowId: "w1",
      signalId: "car/A",
    });
    const errors = [{ windowId: "w1", signalId: "car/A", message: "source_error: timeout" }];
    client.ws.send(JSON.stringify({ type: "rendered", revision: next, status: "error", errors }));
    await expect
      .poll(
        async () => (await renderStatus()).clients.find((c) => c.clientId === clientId)?.rendered,
      )
      .toMatchObject({ revision: next, status: "error", errors });

    // Acknowledgements for revisions that do not exist yet are ignored.
    client.ws.send(JSON.stringify({ type: "rendered", revision: 999, status: "complete" }));
    await new Promise((r) => setTimeout(r, 50));
    const status = await renderStatus();
    expect(status.revision).toBe(next);
    expect(status.clients.find((c) => c.clientId === clientId)?.rendered?.revision).toBe(next);

    client.ws.close();
    await expect
      .poll(async () => (await renderStatus()).clients.some((c) => c.clientId === clientId))
      .toBe(false);
  });
});
