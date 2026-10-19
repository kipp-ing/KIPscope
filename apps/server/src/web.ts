import { realpathSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { routerPath } from "./guard.ts";

/** Content types of the built UI's files (design M11); anything else is octet-stream. */
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

const INDEX = "index.html";

/** The file below `root` a URL path names; undefined when it resolves outside `root` or is not a path. */
function fileOf(root: string, url: string): string | undefined {
  let path: string;
  try {
    path = decodeURIComponent(url.split("?", 1)[0] ?? "");
  } catch {
    return undefined;
  }
  if (path.includes("\0")) return undefined;
  const full = resolve(root, `.${path}`);
  const rel = relative(root, full);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;
  return full;
}

/** Whether `path` is a regular file whose real path (links followed) lies below `root`. */
function servable(root: string, path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    const rel = relative(root, realpathSync(path));
    return !(rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel));
  } catch {
    return false;
  }
}

/**
 * The built UI from `KIPSCOPE_WEB_DIR` (design M11): a GET outside `/api/` answers the file below
 * the directory, else `index.html` (so `/s/<id>` loads the app); a path outside it answers 404.
 * No identity: these files hold no data. Without a directory nothing is registered (404 as today).
 */
export const webRoutes =
  (dir: string | undefined): FastifyPluginAsync =>
  async (app) => {
    if (dir === undefined) return;
    const root = realpathSync(resolve(dir));
    const index = join(root, INDEX);
    app.get("/*", async (request, reply) => {
      // The path as the router reads it, so an encoded `/%61pi/…` is an API path too.
      const routed = routerPath(request.url);
      if (routed === "/api" || routed.startsWith("/api/")) return reply.callNotFound();
      const path = fileOf(root, request.url);
      if (path === undefined) return reply.callNotFound();
      const file = servable(root, path) ? path : index;
      let body: Buffer;
      try {
        body = await readFile(file);
      } catch {
        return reply.callNotFound();
      }
      const rel = relative(root, file);
      reply.type(TYPES[extname(file).toLowerCase()] ?? "application/octet-stream");
      if (file === index) reply.header("cache-control", "no-cache");
      else if (rel.startsWith(`assets${sep}`))
        reply.header("cache-control", "max-age=31536000, immutable");
      return reply.send(body);
    });
  };
