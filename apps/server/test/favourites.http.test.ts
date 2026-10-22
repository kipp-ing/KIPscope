import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { codeOf, type MultiApp, multiApp, realSleep } from "./identityApp.ts";

const RPM = "Sna_800h.RPM";
const SPEED = "Sna_800h.SPEED";
const SIG_A = "Fast_100h.SIG_A";

let t: MultiApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

/** `<stateDir>/users/<user>/favourites.yaml`, the file of design F2. */
const fileOf = (app: MultiApp, user: string) =>
  join(app.stateDir, "users", user, "favourites.yaml");
const textOf = (path: string): string | undefined =>
  existsSync(path) ? readFileSync(path, "utf8") : undefined;

/** Every file below `dir` with its text. */
function filesBelow(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue;
    const path = join(e.parentPath, e.name);
    out[path] = readFileSync(path, "utf8");
  }
  return out;
}

describe("favourites over HTTP", () => {
  it("stores favourites per user in the state dir", async () => {
    // No identity adapter: every request is the user `local`.
    t = await multiApp({ identity: "none", favourites: true });
    const empty = await t.anon.get("/api/favourites");
    expect([empty.status, empty.body]).toEqual([200, { names: [] }]);
    expect(existsSync(fileOf(t, "local"))).toBe(false);

    const post = await t.anon.post("/api/favourites", { add: [RPM, SIG_A] });
    expect(post.status).toBe(200);
    expect(post.body.names).toEqual([RPM, SIG_A]);
    const get = await t.anon.get("/api/favourites");
    expect(get.status).toBe(200);
    expect(get.body.names).toEqual([RPM, SIG_A]);
    expect(get.body.error).toBeUndefined();

    const file = textOf(fileOf(t, "local"));
    expect(file, "favourites.yaml of the user local").toBeDefined();
    expect(parse(file as string)).toEqual({
      kipscope: "favourites",
      version: 1,
      names: [RPM, SIG_A],
    });

    // Removing and adding: removes first, a new name goes last; a no-op succeeds.
    const change = await t.anon.post("/api/favourites", { remove: [RPM], add: [SPEED] });
    expect(change.body.names).toEqual([SIG_A, SPEED]);
    const noop = await t.anon.post("/api/favourites", { add: [SPEED], remove: ["Gone_900h.X"] });
    expect([noop.status, noop.body.names]).toEqual([200, [SIG_A, SPEED]]);
    expect(parse(textOf(fileOf(t, "local")) as string).names).toEqual([SIG_A, SPEED]);
  });

  it("reads a hand-edited file from the next request on", async () => {
    t = await multiApp({ identity: "none", favourites: true });
    await t.anon.post("/api/favourites", { add: [RPM] });
    // No cache (design F2): a hand edit counts at once, unknown keys and repeats are tolerated.
    writeFileSync(
      fileOf(t, "local"),
      `kipscope: favourites\nversion: 1\nnote: by hand\nnames:\n  - ${SPEED}\n  - ${RPM}\n  - ${SPEED}\n`,
    );
    expect((await t.anon.get("/api/favourites")).body).toEqual({ names: [SPEED, RPM] });
  });

  it("keeps favourites per user", async () => {
    t = await multiApp({ favourites: true });
    const alice = t.as("alice");
    const bob = t.as("bob");
    expect((await alice.post("/api/favourites", { add: [RPM] })).status).toBe(200);

    expect((await bob.get("/api/favourites")).body).toEqual({ names: [] });
    // Bob removes the name he does not have: a no-op for him, nothing for alice.
    const removed = await bob.post("/api/favourites", { remove: [RPM] });
    expect([removed.status, removed.body.names]).toEqual([200, []]);
    expect((await bob.get("/api/favourites")).body).toEqual({ names: [] });

    expect((await alice.get("/api/favourites")).body).toEqual({ names: [RPM] });
    // No file under users/bob/ names the signal.
    for (const [path, text] of Object.entries(filesBelow(join(t.stateDir, "users", "bob"))))
      expect(text, path).not.toContain(RPM);
    expect(parse(textOf(fileOf(t, "alice")) as string).names).toEqual([RPM]);

    // Without a user the route refuses like every `user` route.
    expect((await t.anon.get("/api/favourites")).status).toBe(401);
    expect((await t.anon.post("/api/favourites", { add: [RPM] })).status).toBe(401);
  });

  it("leaves a broken file untouched", async () => {
    t = await multiApp({ identity: "none", favourites: true });
    const path = fileOf(t, "local");
    mkdirSync(join(t.stateDir, "users", "local"), { recursive: true });
    const broken = "names: [";
    writeFileSync(path, broken);

    const get = await t.anon.get("/api/favourites");
    expect(get.status).toBe(200);
    expect(get.body.names).toEqual([]);
    expect(typeof get.body.error).toBe("string");
    expect(get.body.error.length).toBeGreaterThan(0);

    const post = await t.anon.post("/api/favourites", { add: ["X.Y"] });
    expect([post.status, codeOf(post.body)]).toEqual([409, "favourites_unreadable"]);
    expect(readFileSync(path, "utf8")).toBe(broken);

    // A remove is refused as well; a file of the wrong kind is just as unreadable.
    const remove = await t.anon.post("/api/favourites", { remove: ["X.Y"] });
    expect([remove.status, codeOf(remove.body)]).toEqual([409, "favourites_unreadable"]);
    writeFileSync(path, "kipscope: view\nversion: 1\nnames: [A.B]\n");
    expect(codeOf((await t.anon.post("/api/favourites", { add: ["X.Y"] })).body)).toBe(
      "favourites_unreadable",
    );
    expect(readFileSync(path, "utf8")).toBe("kipscope: view\nversion: 1\nnames: [A.B]\n");

    // Repaired by hand, the next request works again.
    writeFileSync(path, "kipscope: favourites\nversion: 1\nnames: [A.B]\n");
    const fixed = await t.anon.post("/api/favourites", { add: ["X.Y"] });
    expect([fixed.status, fixed.body.names]).toEqual([200, ["A.B", "X.Y"]]);
  });

  it("treats a favourites file over 256 KiB as broken and leaves it untouched", async () => {
    t = await multiApp({ identity: "none", favourites: true });
    const path = fileOf(t, "local");
    mkdirSync(join(t.stateDir, "users", "local"), { recursive: true });
    // Otherwise valid YAML, padded by a comment to one byte over 256 KiB (262144 bytes).
    const head = "kipscope: favourites\nversion: 1\nnames: [A.B]\n# ";
    const big = `${head}${"x".repeat(262_145 - head.length)}`;
    expect(Buffer.byteLength(big)).toBe(262_145);
    writeFileSync(path, big);

    const get = await t.anon.get("/api/favourites");
    expect(get.status).toBe(200);
    expect(get.body.names).toEqual([]);
    expect(typeof get.body.error).toBe("string");
    expect(get.body.error.length).toBeGreaterThan(0);

    const post = await t.anon.post("/api/favourites", { add: ["X.Y"] });
    expect([post.status, codeOf(post.body)]).toEqual([409, "favourites_unreadable"]);
    expect(readFileSync(path, "utf8")).toBe(big);
  });

  it("refuses bad changes", async () => {
    t = await multiApp({ identity: "none", favourites: true });
    const path = fileOf(t, "local");
    const bad: unknown[] = [
      {},
      { add: [] },
      { add: ["x".repeat(201)] },
      { add: ["A\u0007B"] },
      { add: ["A.B"], grant: 1 },
    ];
    for (const body of bad) {
      const before = textOf(path);
      const res = await t.anon.post("/api/favourites", body);
      expect([res.status, codeOf(res.body)], JSON.stringify(body).slice(0, 40)).toEqual([
        400,
        "invalid_request",
      ]);
      expect(textOf(path)).toBe(before);
    }

    // Not JSON-shaped as a change at all.
    const text = await t.app.inject({
      method: "POST",
      url: "/api/favourites",
      headers: { "content-type": "application/json" },
      body: '"A.B"',
    });
    expect(text.statusCode).toBe(400);

    // 1000 names fit; one more does not, and the file stays as it was.
    const thousand = Array.from({ length: 1000 }, (_, i) => `Many_${i}h.SIG`);
    const full = await t.anon.post("/api/favourites", { add: thousand });
    expect([full.status, full.body.names.length]).toEqual([200, 1000]);
    const before = textOf(path);
    expect(before).toBeDefined();
    const over = await t.anon.post("/api/favourites", { add: ["NEW.ONE"] });
    expect([over.status, codeOf(over.body)]).toEqual([422, "too_many_favourites"]);
    expect(textOf(path)).toBe(before);
    // Removing one in the same change makes room.
    const swap = await t.anon.post("/api/favourites", {
      remove: [thousand[0] as string],
      add: ["NEW.ONE"],
    });
    expect([swap.status, swap.body.names.length]).toEqual([200, 1000]);
  });

  it("lets a reader of a shared workspace star their own", async () => {
    t = await multiApp({ favourites: true });
    const alice = t.as("alice");
    const bob = t.as("bob");
    const id = (await alice.post("/api/workspaces", {})).body.workspace.id as string;
    expect((await alice.post(`/api/workspaces/${id}/share`, { share: "read" })).status).toBe(200);
    expect((await alice.post("/api/favourites", { add: [RPM] })).status).toBe(200);
    expect((await bob.post("/api/favourites", { add: [SIG_A] })).status).toBe(200);
    const revision = async () => (await bob.get(`/api/w/${id}/workspace`)).body.revision as number;
    const before = await revision();
    // Bob has the read right only: a command is refused, starring is not a command.
    const refused = await bob.command({ type: "window.create", from: "0", to: "10" }, id);
    expect(refused.status).toBeGreaterThanOrEqual(400);

    const live = await bob.live(id);
    const first = await live.next((m) => m.type === "favourites");
    expect(first).toMatchObject({ type: "favourites", names: [SIG_A] });

    // The workspace prefix is ignored on a `user` route.
    const post = await bob.post(`/api/w/${id}/favourites`, { add: [SPEED] });
    expect(post.status).toBe(200);
    await live.next((m) => m.type === "favourites" && m.names.length === 2);
    expect(live.last("favourites")?.names).toEqual([SIG_A, SPEED]);

    expect(await revision()).toBe(before);
    expect((await alice.get("/api/favourites")).body.names).toEqual([RPM]);
    expect((await bob.get("/api/favourites")).body.names).toEqual([SIG_A, SPEED]);
    live.close();
  });

  it("pushes favourites on the live channel", async () => {
    t = await multiApp({ favourites: true });
    const alice = t.as("alice");
    const bob = t.as("bob");
    const a = (await alice.post("/api/workspaces", {})).body.workspace.id as string;
    const b = (await alice.post("/api/workspaces", {})).body.workspace.id as string;
    const c = (await bob.post("/api/workspaces", {})).body.workspace.id as string;
    const liveA = await alice.live(a);
    const liveB = await alice.live(b);
    const liveC = await bob.live(c);
    for (const live of [liveA, liveB, liveC]) await live.next((m) => m.type === "favourites");

    // After the connect `state`, an empty list of the connection's own user.
    for (const live of [liveA, liveB, liveC])
      expect(live.messages.map((m) => m.type)).toEqual(["hello", "summary", "state", "favourites"]);
    expect(liveA.last("favourites")).toMatchObject({ names: [] });

    expect((await alice.post("/api/favourites", { add: [RPM] })).status).toBe(200);
    for (const live of [liveA, liveB])
      await live.next((m) => m.type === "favourites" && m.names.length === 1);

    // The same change again changes nothing and pushes nothing.
    expect((await alice.post("/api/favourites", { add: [RPM] })).status).toBe(200);
    await realSleep(150);
    for (const live of [liveA, liveB]) {
      const pushes = live.messages.filter((m) => m.type === "favourites");
      expect(pushes.map((m) => (m as { names: string[] }).names)).toEqual([[], [RPM]]);
    }
    // Bob's connection got only his connect message.
    expect(liveC.messages.filter((m) => m.type === "favourites")).toEqual([
      { type: "favourites", names: [] },
    ]);

    // A change that removes pushes too.
    expect((await alice.post("/api/favourites", { remove: [RPM] })).status).toBe(200);
    await vi.waitFor(() =>
      expect(liveA.messages.filter((m) => m.type === "favourites")).toHaveLength(3),
    );
    expect(liveA.last("favourites")).toMatchObject({ names: [] });
    for (const live of [liveA, liveB, liveC]) live.close();
  });

  it("sends no favourites message and has no routes without a store", async () => {
    t = await multiApp();
    const alice = t.as("alice");
    const id = (await alice.post("/api/workspaces", {})).body.workspace.id as string;
    const live = await alice.live(id);
    await live.next((m) => m.type === "state");
    await realSleep(100);
    expect(live.messages.map((m) => m.type)).toEqual(["hello", "summary", "state"]);
    expect((await alice.get("/api/favourites")).status).toBe(404);
    live.close();
  });
});
