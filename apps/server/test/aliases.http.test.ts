import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { shownName } from "@kipscope/shared";
import { afterEach, describe, expect, it } from "vitest";
import { NO_RULES } from "../src/names.ts";
import { type ViewsApp, viewsApp } from "./viewsApp.ts";

// Spec signal-aliases "Identity stays on the source name": a stored view survives a dictionary edit.
const SIG_A = "testcar/Fast_100h.SIG_A";
const T0_NS = "1791896880000000000";
const withSpeed = { ...NO_RULES, aliases: new Map([["Fast_100h.SIG_A", "Speed"]]) };

const apps: ViewsApp[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
});
async function start(options: Parameters<typeof viewsApp>[0] = {}): Promise<ViewsApp> {
  const a = await viewsApp(options);
  apps.push(a);
  return a;
}

/** Saves the view "mine" holding SIG_A on a server whose dictionary maps it to `Speed`; returns the file text. */
async function savedWithEntry(): Promise<{ app: ViewsApp; text: string }> {
  const app = await start({ rules: withSpeed });
  app.store.execute({ type: "window.create", title: "T", from: T0_NS, to: "1791896900000000000" });
  app.store.execute({ type: "window.addSignal", windowId: "w1", signalId: SIG_A });
  expect((await app.post("/api/views", { title: "Mine", name: "mine" })).status).toBe(200);
  return { app, text: readFileSync(join(app.viewsDir, "mine.yaml"), "utf8") };
}

describe("views and a dictionary (signal-aliases)", () => {
  it("opens a view saved with the dictionary on, showing the logical name", async () => {
    const { app, text } = await savedWithEntry();
    expect(text).toContain(SIG_A);
    expect(text).not.toContain("Speed");

    const opened = await app.post("/api/views/open", { name: "mine" });
    expect(opened.status).toBe(200);
    const signals = (await app.get("/api/workspace")).body.workspace.windows.flatMap(
      (w: { signals: { signalId: string }[] }) => w.signals.map((s) => s.signalId),
    );
    expect(signals).toEqual([SIG_A]);
    const info = app.catalog.get(SIG_A);
    expect(info && shownName(info)).toBe("Speed");
    expect(info && shownName(info, "source")).toBe("Fast_100h.SIG_A");
  });

  it("opens a view after an entry was removed", async () => {
    const { text } = await savedWithEntry();

    // The server restarts with the entry removed: same file, no dictionary.
    const restarted = await start();
    expect(restarted.catalog.get(SIG_A)).not.toHaveProperty("alias");
    writeFileSync(join(restarted.viewsDir, "mine.yaml"), text);

    const list = await restarted.get("/api/views");
    expect(list.body.views[0]).toMatchObject({ name: "mine", signals: 1 });
    expect(list.body.views[0].error).toBeUndefined();

    const opened = await restarted.post("/api/views/open", { name: "mine" });
    expect(opened.status).toBe(200);
    expect(opened.body).toMatchObject({ ok: true, report: { missing: [], skipped: [] } });
    const ws = (await restarted.get("/api/workspace")).body.workspace;
    const signals = ws.windows.flatMap((w: { signals: { signalId: string }[] }) =>
      w.signals.map((s) => s.signalId),
    );
    expect(signals).toEqual([SIG_A]);
    // Shown as the source name now.
    const info = restarted.catalog.get(SIG_A);
    expect(info && shownName(info)).toBe("Fast_100h.SIG_A");
  });

  it("keeps the saved file byte for byte across the removal", async () => {
    const { text } = await savedWithEntry();
    const restarted = await start();
    writeFileSync(join(restarted.viewsDir, "mine.yaml"), text);
    await restarted.post("/api/views/open", { name: "mine" });
    expect(readFileSync(join(restarted.viewsDir, "mine.yaml"), "utf8")).toBe(text);
  });
});
