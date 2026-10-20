import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { IdentityAdapter } from "../src/identity.ts";
import { codeOf, type MultiApp, multiApp } from "./identityApp.ts";

const refuseAll: IdentityAdapter = {
  kind: "test-refuse",
  identify: async () => ({ refused: "unauthenticated" }),
};

let root: string;
let webDir: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "kipscope-web-"));
  webDir = join(root, "dist");
  mkdirSync(join(webDir, "assets"), { recursive: true });
  writeFileSync(join(webDir, "index.html"), "<!doctype html><title>KIPscope index</title>");
  writeFileSync(join(webDir, "assets", "app.js"), "console.log('app');");
  writeFileSync(join(webDir, "assets", "app.css"), "body{}");
  writeFileSync(join(webDir, "icon.svg"), "<svg/>");
  writeFileSync(join(webDir, "data.json"), "{}");
  writeFileSync(join(webDir, "app.js.map"), "{}");
  writeFileSync(join(webDir, "font.woff2"), "woff");
  writeFileSync(join(webDir, "notes.txt"), "notes");
  writeFileSync(join(webDir, "blob.xyz"), "blob");
  // Outside the served directory: a secret next to it, and a link to it from inside.
  writeFileSync(join(root, "secret.txt"), "TOP SECRET");
  symlinkSync(join(root, "secret.txt"), join(webDir, "link.txt"));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

let t: MultiApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

/** A GET with the path exactly as given (no normalisation by the client). */
function rawGet(
  base: string,
  path: string,
): Promise<{ status: number; type: string; body: string }> {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const req = request({ host: url.hostname, port: url.port, path, method: "GET" }, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          type: String(res.headers["content-type"] ?? ""),
          body,
        }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

describe("built UI served by the server", () => {
  it("serves the built UI", async () => {
    t = await multiApp({ identity: refuseAll, webDir });
    const asset = await t.anon.get("/assets/app.js");
    expect(asset.status).toBe(200);
    expect(asset.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(asset.headers["cache-control"]).toContain("immutable");
    expect(asset.text).toBe("console.log('app');");

    for (const path of ["/w/abcdefghij", "/s/abcdefghij", "/"]) {
      const page = await t.anon.get(path);
      expect(page.status, path).toBe(200);
      expect(page.headers["content-type"], path).toBe("text/html; charset=utf-8");
      expect(page.headers["cache-control"], path).toBe("no-cache");
      expect(page.text, path).toContain("KIPscope index");
    }
    // The index itself is the same file under its own name.
    const index = await t.anon.get("/index.html");
    expect(index.headers["cache-control"]).toBe("no-cache");

    const base = await t.listen();
    const traversal = await rawGet(base, "/..%2f..%2fetc%2fpasswd");
    expect(traversal.status).toBe(404);
    const api = await t.anon.get("/api/me");
    expect([api.status, codeOf(api.body)]).toEqual([401, "unauthenticated"]);
  });

  it("answers 404 for paths without a web directory", async () => {
    t = await multiApp({ identity: refuseAll });
    expect((await t.anon.get("/")).status).toBe(404);
    expect((await t.anon.get("/w/abcdefghij")).status).toBe(404);
    expect((await t.anon.get("/s/abcdefghij")).status).toBe(404);
    expect((await t.anon.get("/assets/app.js")).status).toBe(404);
  });

  it("needs no user for the files, but every API path still needs one", async () => {
    t = await multiApp({ identity: refuseAll, webDir });
    expect((await t.anon.get("/")).status).toBe(200);
    for (const path of [
      "/api/me",
      "/api/workspace",
      "/api/nosuchroute",
      "/api/w/abcdefghij/workspace",
    ]) {
      const res = await t.anon.get(path);
      expect([res.status, codeOf(res.body)], path).toEqual([401, "unauthenticated"]);
    }
  });

  it("answers an unknown API path with 404 JSON, not the index page", async () => {
    t = await multiApp({ webDir });
    const res = await t.as("alice", ["all"]).get("/api/nosuchroute");
    expect(res.status).toBe(404);
    expect(res.text).not.toContain("KIPscope index");
    const bare = await t.as("alice", ["all"]).get("/api");
    expect(bare.text).not.toContain("KIPscope index");
  });

  it("answers an encoded or query-carrying API path with 404, never the SPA", async () => {
    t = await multiApp({ webDir });
    const alice = t.as("alice", ["all"]);
    for (const path of [
      "/%61pi/nosuch",
      "/%61pi",
      "/a%70i/nosuch",
      "/api?x=1",
      "/api/nosuch?x=1",
    ]) {
      const res = await alice.get(path);
      expect(res.status, path).toBe(404);
      expect(res.headers["content-type"], path).toContain("application/json");
      expect(res.body, path).toMatchObject({ statusCode: 404, error: "Not Found" });
      expect(res.text, path).not.toContain("KIPscope index");
    }
    // Without a user: below /api/ the answer is 401, the bare /api a plain 404; never the index.
    const refused = await multiApp({ identity: refuseAll, webDir });
    try {
      for (const path of ["/%61pi/nosuch", "/api/nosuch?x=1"]) {
        const res = await refused.anon.get(path);
        expect([res.status, codeOf(res.body)], path).toEqual([401, "unauthenticated"]);
      }
      for (const path of ["/%61pi", "/api?x=1"]) {
        const res = await refused.anon.get(path);
        expect(res.status, path).toBe(404);
        expect(res.text, path).not.toContain("KIPscope index");
      }
    } finally {
      await refused.close();
    }
    // The SPA route itself still gets the index, also with a query string.
    for (const path of [
      "/w/abcdefghij",
      "/w/abcdefghij?x=1",
      "/s/abcdefghij",
      "/s/abcdefghij?x=1",
    ]) {
      const page = await alice.get(path);
      expect(page.status, path).toBe(200);
      expect(page.text, path).toContain("KIPscope index");
    }
  });

  it("gives each file its content type", async () => {
    t = await multiApp({ webDir });
    const types: [string, string][] = [
      ["/assets/app.css", "text/css; charset=utf-8"],
      ["/icon.svg", "image/svg+xml"],
      ["/data.json", "application/json"],
      ["/app.js.map", "application/json"],
      ["/font.woff2", "font/woff2"],
      ["/notes.txt", "text/plain; charset=utf-8"],
      ["/blob.xyz", "application/octet-stream"],
    ];
    for (const [path, type] of types) {
      const res = await t.anon.get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers["content-type"], path).toBe(type);
    }
    // Only assets/ is cached for a year.
    expect((await t.anon.get("/assets/app.css")).headers["cache-control"]).toContain(
      "max-age=31536000",
    );
    expect(String((await t.anon.get("/icon.svg")).headers["cache-control"] ?? "")).not.toContain(
      "immutable",
    );
  });

  it("never serves a file outside the directory", async () => {
    t = await multiApp({ webDir });
    const base = await t.listen();
    for (const path of [
      "/..%2fsecret.txt",
      "/%2e%2e/secret.txt",
      "/%2e%2e%2fsecret.txt",
      "/assets/..%2f..%2fsecret.txt",
      "/assets/%2e%2e/%2e%2e/secret.txt",
      "/..\\secret.txt",
      "/%5c..%5csecret.txt",
      "/%252e%252e%252fsecret.txt",
      "/secret.txt%00.html",
      "/%00",
      "/link.txt",
      `/${"..%2f".repeat(20)}etc/passwd`,
    ]) {
      const res = await rawGet(base, path);
      expect(res.body, path).not.toContain("TOP SECRET");
      expect(res.body, path).not.toContain("root:");
      // Either not found, or the index page for a path that is merely not a file.
      expect([200, 400, 404], path).toContain(res.status);
    }
    const dotdot = await rawGet(base, "/..%2fsecret.txt");
    expect(dotdot.status).toBe(404);
  });

  it("serves only GET and HEAD", async () => {
    t = await multiApp({ webDir });
    const post = await t.anon.post("/");
    expect(post.status).toBe(404);
    const del = await t.anon.del("/assets/app.js");
    expect(del.status).toBe(404);
  });
});
