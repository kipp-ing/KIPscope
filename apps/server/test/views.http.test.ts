import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ViewDoc, type Workspace, workspaceToView } from "@kipscope/shared";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { codeOf, type ViewsApp, viewsApp } from "./viewsApp.ts";

const RPM = "testcar/Sna_800h.RPM";
const SPEED = "testcar/Sna_800h.SPEED";
const T0 = "2026-10-13T13:08:00Z"; // 1791896880 s
const T0_NS = "1791896880000000000";

/** A valid document: one timeseries window per entry of `windows` (lists of signal IDs). */
function doc(windows: string[][], over: Partial<ViewDoc> = {}): ViewDoc {
  return {
    kipscope: "view",
    version: 1,
    title: "Fixture",
    saved: "2026-10-17T08:14:03Z",
    data: ["testcar"],
    linkTime: true,
    cursors: { diff: false },
    digits: 3,
    windows: windows.map((signals) => ({
      kind: "timeseries" as const,
      from: T0,
      to: "2026-10-13T13:08:20Z",
      mode: "line" as const,
      envelope: false,
      signals,
    })),
    ...over,
  };
}

function twoWindows(): { revision: number; workspace: Workspace } {
  return {
    revision: 7,
    workspace: {
      windows: [
        { id: "w1", kind: "values", mode: "line", signals: [{ id: "a2", signalId: RPM }] },
        { id: "w10", kind: "values", mode: "step", signals: [] },
      ],
      nextId: 12,
      linkTime: true,
      colors: { [RPM]: 0 },
      cursors: { diff: false },
      options: { digits: 3 },
    },
  };
}

let t: ViewsApp;
afterEach(() => t?.close());

async function seeded() {
  t = await viewsApp();
  t.store.execute({
    type: "window.create",
    title: "Speeds",
    from: T0_NS,
    to: "1791896900000000000",
  });
  t.store.execute({ type: "window.addSignal", windowId: "w1", signalId: RPM });
  return t;
}

describe("views over HTTP", () => {
  it("saves, lists and overwrites views", async () => {
    await seeded();
    const title = "Hard acceleration, drive 3";
    const before = t.store.revision;

    const first = await t.post("/api/views", { title });
    expect(first.status).toBe(200);
    expect(first.body.view).toMatchObject({
      name: "hard-acceleration-drive-3",
      title,
      windows: 1,
      signals: 1,
    });
    expect(first.body.revision).toBe(before + 1);

    const second = await t.post("/api/views", { title });
    expect(second.status).toBe(409);
    expect(codeOf(second.body)).toBe("view_exists");
    expect(t.store.revision).toBe(before + 1);

    const third = await t.post("/api/views", { title, overwrite: true });
    expect(third.status).toBe(200);

    const list = await t.get("/api/views");
    expect(list.status).toBe(200);
    expect(list.body.views).toHaveLength(1);
    expect(list.body.views[0]).toMatchObject({
      name: "hard-acceleration-drive-3",
      title,
      windows: 1,
      signals: 1,
      data: ["testcar"],
    });

    const ws = await t.get("/api/workspace");
    expect(ws.body.workspace.view).toEqual({
      name: "hard-acceleration-drive-3",
      title,
      modified: false,
    });
  });

  it("saves a note and an explicit name", async () => {
    await seeded();
    const res = await t.post("/api/views", {
      title: "T",
      note: "first line\nsecond",
      name: "mine",
    });
    expect(res.status).toBe(200);
    expect(res.body.view).toMatchObject({ name: "mine", note: "first line\nsecond" });
    expect(
      parse(readFileSync(join(t.viewsDir, "mine.yaml"), "utf8"), { schema: "core" }),
    ).toMatchObject({
      note: "first line\nsecond",
    });
    expect((await t.get("/api/workspace")).body.workspace.view).toEqual({
      name: "mine",
      title: "T",
      note: "first line\nsecond",
      modified: false,
    });
  });

  it("refuses an empty title and a bad body", async () => {
    await seeded();
    for (const body of [{}, { title: "" }, { title: "   " }, { title: "x".repeat(121) }]) {
      const res = await t.post("/api/views", body);
      expect(res.status).toBe(400);
      expect(codeOf(res.body)).toBe("invalid_request");
    }
  });

  it("refuses names that are not file-safe", async () => {
    await seeded();
    // A file outside the views directory that must stay as it is.
    const outside = join(t.stateDir, "workspace.json");
    writeFileSync(outside, "keep");
    const before = readdirSync(t.stateDir).sort();

    const attempts = [
      await t.get("/api/views/..%2Fworkspace"),
      await t.get("/api/views/a.b"),
      await t.del("/api/views/-x"),
      await t.post("/api/views", { title: "t", name: "../x" }),
      await t.post("/api/views", { title: "t", name: "_previous" }),
      await t.post("/api/views", { title: "t", name: "Upper" }),
    ];
    for (const a of attempts) {
      expect(a.status).toBe(400);
      expect(codeOf(a.body)).toBe("invalid_view_name");
    }
    expect(readFileSync(outside, "utf8")).toBe("keep");
    expect(readdirSync(t.stateDir).sort()).toEqual(before);
    expect(existsSync(join(t.stateDir, "x.yaml"))).toBe(false);
    expect(readdirSync(t.viewsDir)).toEqual([]);
  });

  it("lists a broken file with its error", async () => {
    await seeded();
    await t.post("/api/views", { title: "Good" });
    writeFileSync(join(t.viewsDir, "broken.yaml"), "windows: [");
    const list = await t.get("/api/views");
    expect(list.status).toBe(200);
    const byName = Object.fromEntries(list.body.views.map((v: { name: string }) => [v.name, v]));
    expect(byName.broken).toMatchObject({ name: "broken", title: "broken" });
    expect(typeof byName.broken.error).toBe("string");
    expect(byName.broken.error.length).toBeGreaterThan(0);
    expect(byName.good).toMatchObject({ title: "Good", windows: 1, signals: 1 });
    expect(byName.good.error).toBeUndefined();
  });

  it("deletes a view", async () => {
    await seeded();
    await t.post("/api/views", { title: "Hard acceleration, drive 3" });
    const file = join(t.viewsDir, "hard-acceleration-drive-3.yaml");
    expect(existsSync(file)).toBe(true);
    const first = await t.del("/api/views/hard-acceleration-drive-3");
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ deleted: "hard-acceleration-drive-3" });
    expect(existsSync(file)).toBe(false);
    const second = await t.del("/api/views/hard-acceleration-drive-3");
    expect(second.status).toBe(404);
    expect(codeOf(second.body)).toBe("unknown_view");
  });

  it("opens a view as one command", async () => {
    t = await viewsApp({ initial: twoWindows() });
    // Three windows, only the last holds a signal: IDs w12, w13, w14, then a15 whatever the numbering order.
    t.views.write("three", doc([[], [], [RPM]]));
    // A second view with an unknown signal: reported, and the file stays as it was.
    t.views.write("gone", doc([[RPM, "testcar/Gone_1h.X"]]));
    const goneText = readFileSync(join(t.viewsDir, "gone.yaml"), "utf8");

    const opened = await t.post("/api/views/open", { name: "three" });
    expect(opened.status).toBe(200);
    expect(opened.body).toMatchObject({
      ok: true,
      revision: 8,
      report: { missing: [], skipped: [], warnings: [] },
    });
    expect(t.pushes).toEqual([{ revision: 8, command: "view.open" }]);
    const ws = (await t.get("/api/workspace")).body;
    expect(ws.revision).toBe(8);
    expect(ws.workspace.windows.map((w: { id: string }) => w.id)).toEqual(["w12", "w13", "w14"]);
    expect(ws.workspace.windows[2].signals[0].id).toBe("a15");
    expect(ws.workspace.view).toEqual({ name: "three", title: "Fixture", modified: false });

    const gone = await t.post("/api/views/open", { name: "gone" });
    expect(gone.body).toMatchObject({
      ok: true,
      revision: 9,
      report: { missing: ["testcar/Gone_1h.X"] },
    });
    expect(readFileSync(join(t.viewsDir, "gone.yaml"), "utf8")).toBe(goneText);
  });

  it("opens a document sent in the body, and answers the errors of a command", async () => {
    await seeded();
    const rev = t.store.revision;
    const ok = await t.post("/api/views/open", { view: doc([[RPM]]) });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ok: true, revision: rev + 1 });
    expect((await t.get("/api/workspace")).body.workspace.view.name).toBeUndefined();

    const unknown = await t.post("/api/views/open", { name: "nope" });
    expect(unknown.status).toBe(404);
    expect(codeOf(unknown.body)).toBe("unknown_view");

    const odd = await t.post("/api/views/open", { view: { kipscope: "view", version: 9 } });
    expect(odd.status).toBe(422);
    expect(codeOf(odd.body)).toBe("unsupported_version");
    const notView = await t.post("/api/views/open", { view: { kipscope: "nope" } });
    expect(notView.status).toBe(422);
    expect(codeOf(notView.body)).toBe("invalid_view");
    expect(t.store.revision).toBe(rev + 1);
  });

  it("refuses to open before the catalog loads", async () => {
    t = await viewsApp({ loadCatalog: false });
    t.views.write("v", doc([[RPM]]));
    const res = await t.post("/api/views/open", { name: "v" });
    expect(res.status).toBe(503);
    expect(codeOf(res.body)).toBe("catalog_unavailable");
    expect(t.store.revision).toBe(0);
    expect(t.store.workspace.windows).toEqual([]);
    expect(t.pushes).toEqual([]);
  });

  it("keeps the workspace before the last open", async () => {
    t = await viewsApp({ initial: twoWindows() });
    t.views.write("x", doc([[RPM], [SPEED], []], { title: "X" }));
    t.views.write("other", doc([[RPM]], { title: "Other", saved: "2026-10-01T00:00:00Z" }));

    // Empty workspace first: no `_previous` is written, an older one stays.
    const empty = await viewsApp();
    try {
      empty.views.write("_previous", doc([[RPM]], { title: "Older" }));
      const olderText = readFileSync(join(empty.viewsDir, "_previous.yaml"), "utf8");
      empty.views.write("x", doc([[RPM]]));
      expect((await empty.post("/api/views/open", { name: "x" })).status).toBe(200);
      expect(readFileSync(join(empty.viewsDir, "_previous.yaml"), "utf8")).toBe(olderText);
    } finally {
      await empty.close();
    }
    const emptyOnly = await viewsApp();
    try {
      emptyOnly.views.write("x", doc([[RPM]]));
      await emptyOnly.post("/api/views/open", { name: "x" });
      expect(existsSync(join(emptyOnly.viewsDir, "_previous.yaml"))).toBe(false);
    } finally {
      await emptyOnly.close();
    }

    expect((await t.post("/api/views/open", { name: "x" })).status).toBe(200);
    const list = (await t.get("/api/views")).body.views as {
      name: string;
      title: string;
      windows: number;
    }[];
    expect(list.at(-1)).toMatchObject({ name: "_previous", title: "Before last open", windows: 2 });
    expect(
      list
        .map((v) => v.name)
        .slice(0, -1)
        .sort(),
    ).toEqual(["other", "x"]);

    // Go back: the two windows again, with new IDs; `_previous` now holds X's three windows.
    const back = await t.post("/api/views/open", { name: "_previous" });
    expect(back.status).toBe(200);
    const ws = (await t.get("/api/workspace")).body.workspace as Workspace;
    expect(ws.windows).toHaveLength(2);
    expect(ws.windows.map((w) => w.kind)).toEqual(["values", "values"]);
    expect(ws.windows.map((w) => w.id)).not.toContain("w1");
    expect(ws.windows.map((w) => w.id)).not.toContain("w10");
    const prev = (await t.get("/api/views")).body.views.at(-1);
    expect(prev).toMatchObject({ name: "_previous", windows: 3 });
  });

  it("serves a view file for download", async () => {
    await seeded();
    await t.post("/api/views", { title: "Hard acceleration, drive 3" });
    const file = readFileSync(join(t.viewsDir, "hard-acceleration-drive-3.yaml"), "utf8");

    const plain = await t.get("/api/views/hard-acceleration-drive-3");
    expect(plain.status).toBe(200);
    expect(plain.headers["content-type"]).toBe("application/yaml; charset=utf-8");
    expect(plain.headers["content-disposition"]).toBeUndefined();
    expect(plain.text).toBe(file);

    const dl = await t.get("/api/views/hard-acceleration-drive-3?download=1");
    expect(dl.status).toBe(200);
    expect(dl.headers["content-type"]).toBe("application/yaml; charset=utf-8");
    expect(dl.headers["content-disposition"]).toBe(
      'attachment; filename="hard-acceleration-drive-3.kipscope.yaml"',
    );
    expect(dl.text).toBe(file);

    const missing = await t.get("/api/views/nope");
    expect(missing.status).toBe(404);
    expect(codeOf(missing.body)).toBe("unknown_view");
  });

  it("imports YAML and JSON", async () => {
    await seeded();
    await t.post("/api/views", { title: "Source", note: "n" });
    const exported = (await t.get("/api/views/source")).text;
    const withoutSaved = (s: string) => s.replace(/^saved: .*\n/m, "");

    // YAML with a name.
    const yamlRes = await t.post("/api/views/import", { text: exported, name: "copy" });
    expect(yamlRes.status).toBe(200);
    expect(yamlRes.body.view).toMatchObject({ name: "copy", title: "Source" });
    expect(yamlRes.body.warnings).toEqual([]);
    expect(withoutSaved(readFileSync(join(t.viewsDir, "copy.yaml"), "utf8"))).toBe(
      withoutSaved(exported),
    );

    // The same document as JSON, opened at once.
    const asJson = JSON.stringify(parse(exported, { schema: "core" }));
    const jsonRes = await t.post("/api/views/import", {
      text: asJson,
      name: "copy-json",
      open: true,
    });
    expect(jsonRes.status).toBe(200);
    expect(jsonRes.body.opened).toMatchObject({ ok: true });
    expect(withoutSaved(readFileSync(join(t.viewsDir, "copy-json.yaml"), "utf8"))).toBe(
      withoutSaved(exported),
    );

    // Name from the title; an existing name needs overwrite.
    const again = await t.post("/api/views/import", { text: exported, name: "copy" });
    expect(again.status).toBe(409);
    expect(codeOf(again.body)).toBe("view_exists");
    expect(
      (await t.post("/api/views/import", { text: exported, name: "copy", overwrite: true })).status,
    ).toBe(200);
    expect(
      (await t.post("/api/views/import", { text: exported, overwrite: true })).body.view.name,
    ).toBe("source");

    // Too large: 300 KiB.
    const big = await t.post("/api/views/import", { text: `title: ${"x".repeat(300 * 1024)}\n` });
    expect(big.status).toBe(413);
    expect(codeOf(big.body)).toBe("view_too_large");

    // Syntax error in line 4 (a duplicate key).
    const syntax = await t.post("/api/views/import", {
      text: "kipscope: view\nversion: 1\ntitle: t\ntitle: again\n",
    });
    expect(syntax.status).toBe(400);
    expect(codeOf(syntax.body)).toBe("invalid_view_yaml");
    expect(syntax.body.error.message).toMatch(/line 4/);

    // Not a view, wrong version, bad name.
    expect(codeOf((await t.post("/api/views/import", { text: "a: 1\n" })).body)).toBe(
      "invalid_view",
    );
    const v9 = await t.post("/api/views/import", { text: "kipscope: view\nversion: 9\n" });
    expect(v9.status).toBe(400);
    expect(codeOf(v9.body)).toBe("unsupported_version");
    const badName = await t.post("/api/views/import", { text: exported, name: "../x" });
    expect(badName.status).toBe(400);
    expect(codeOf(badName.body)).toBe("invalid_view_name");
  });

  it("keeps YAML timestamps as strings and warns about unknown keys on import", async () => {
    t = await viewsApp();
    const text = [
      "kipscope: view",
      "version: 1",
      "title: Hand written",
      "author: jk",
      "data:",
      "  - testcar",
      "linkTime: true",
      "cursors:",
      "  diff: false",
      "digits: 3",
      "windows:",
      "  - kind: timeseries",
      "    from: 2026-10-13T13:08:00Z",
      "    to: 2026-10-13T13:08:20Z",
      "    mode: line",
      "    envelope: false",
      "    signals:",
      `      - ${RPM}`,
      "",
    ].join("\n");
    const res = await t.post("/api/views/import", { text, open: true });
    expect(res.status).toBe(200);
    expect(res.body.warnings).toContain('unknown key "author" ignored');
    expect(res.body.opened).toMatchObject({ ok: true });
    const w = (await t.get("/api/workspace")).body.workspace.windows[0];
    expect(w.range.from).toBe(T0_NS);
    // Stored in canonical form, not as uploaded.
    const stored = readFileSync(join(t.viewsDir, "hand-written.yaml"), "utf8");
    expect(stored).not.toContain("author");
  });

  it("stores no credentials and no internal IDs", async () => {
    // The server has no credential in its app dependencies; assert on the text anyway.
    t = await viewsApp({ initial: twoWindows() });
    t.store.execute({ type: "cursor.set", cursor: "a", t: "1791896881500000001" });
    t.store.execute({ type: "measurement.set", name: "Drive 3" });
    const res = await t.post("/api/views", { title: "Secrets" });
    expect(res.status).toBe(200);
    const text = readFileSync(join(t.viewsDir, "secrets.yaml"), "utf8");
    expect(text).not.toContain("s3cret");
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/127\.0\.0\.1|localhost/);
    expect(text).not.toMatch(/\b[wa]\d+\b/);
    expect(text).not.toContain("nextId");
    // Display names are not references: the full ID is there.
    expect(text).toContain(RPM);
    // Nanoseconds survive to the file.
    expect(text).toContain("2026-10-13T13:08:01.500000001Z");
  });

  it("opens a view through the command endpoint", async () => {
    await seeded();
    const rev = t.store.revision;
    const ok = await t.post("/api/commands", { type: "view.open", view: doc([[RPM], [SPEED]]) });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ok: true, revision: rev + 1, report: { missing: [] } });
    const ws = (await t.get("/api/workspace")).body.workspace;
    expect(ws.windows).toHaveLength(2);
    expect(ws.view.name).toBeUndefined();

    const odd = await t.post("/api/commands", {
      type: "view.open",
      view: { kipscope: "view", version: 9 },
    });
    expect(odd.status).toBe(422);
    expect(codeOf(odd.body)).toBe("unsupported_version");
    expect(t.store.revision).toBe(rev + 1);
  });

  it("refuses a view name through the command endpoint", async () => {
    await seeded();
    const rev = t.store.revision;
    const named = await t.post("/api/commands", {
      type: "view.open",
      view: doc([[RPM]]),
      name: "speeds",
    });
    expect(named.status).toBe(400);
    expect(codeOf(named.body)).toBe("invalid_command");
    expect(t.store.revision).toBe(rev);
    // Without a name the link path stays.
    const plain = await t.post("/api/commands", { type: "view.open", view: doc([[RPM]]) });
    expect(plain.status).toBe(200);
  });

  it("refuses an alias bomb", async () => {
    await seeded();
    // 10 levels, each of 10 aliases of the level before: 10^10 nodes if expanded.
    const lines = ["x0: &a0 [a, a, a, a, a, a, a, a, a, a]"];
    for (let i = 1; i < 10; i++) {
      const prev = `*a${i - 1}`;
      lines.push(`x${i}: &a${i} [${Array(10).fill(prev).join(", ")}]`);
    }
    const bomb = `${lines.join("\n")}\n`;
    expect(bomb.length).toBeLessThan(2048 + 512);
    const started = Date.now();
    const res = await t.post("/api/views/import", { text: bomb, name: "bomb-import" });
    expect(res.status).toBe(400);
    expect(codeOf(res.body)).toBe("invalid_view_yaml");
    expect(Date.now() - started).toBeLessThan(1000);

    writeFileSync(join(t.viewsDir, "bomb.yaml"), bomb);
    const list = await t.get("/api/views");
    expect(list.status).toBe(200);
    const entry = list.body.views.find((v: { name: string }) => v.name === "bomb");
    expect(entry).toBeDefined();
    expect(typeof entry.error).toBe("string");
    const rev = t.store.revision;
    const open = await t.post("/api/views/open", { name: "bomb" });
    expect(open.status).toBe(422);
    expect(codeOf(open.body)).toBe("invalid_view");
    expect(t.store.revision).toBe(rev);
  });

  it("answers 404 for the view routes when the app has no view store", async () => {
    const { buildApp } = await import("../src/app.ts");
    const { Catalog } = await import("../src/catalog.ts");
    const { WorkspaceStore } = await import("../src/workspace.ts");
    const source = {} as import("../src/datasource.ts").DataSource;
    const app = buildApp({
      catalog: new Catalog(source, async () => new Map()),
      source,
      workspace: new WorkspaceStore({ signalExists: () => true, hasStates: () => false }),
    });
    try {
      expect((await app.inject({ url: "/api/views" })).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("the document written by save equals workspaceToView of the state at that moment", async () => {
    await seeded();
    t.store.execute({ type: "cursor.set", cursor: "a", t: "1791896881000000000" });
    const snapshot = t.store.workspace;
    await t.post("/api/views", { title: "Snap", name: "snap" });
    const stored = parse(readFileSync(join(t.viewsDir, "snap.yaml"), "utf8"), { schema: "core" });
    const expected = workspaceToView(snapshot, { title: "Snap", saved: stored.saved });
    expect(stored).toEqual(JSON.parse(JSON.stringify(expected)));
    mkdirSync(t.viewsDir, { recursive: true });
  });
});
