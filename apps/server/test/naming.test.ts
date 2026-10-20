import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");

/** Every file below `path` (or `path` itself), without build output and dependencies. */
function files(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((name) =>
    name === "node_modules" || name === "dist" ? [] : files(join(path, name)),
  );
}

describe("naming (workspaces: Session is not a word for the workspace)", () => {
  // Since add-case-open (design K1) "session" is the word for one entry of a catalog (the UI says
  // "session", the code says `case`), so the word alone is no longer a finding. What stays out is
  // the old name of the workspace: its header, option, variable, routes, menu and types.
  const OLD_WORKSPACE_WORDS = new RegExp(
    [
      "X-KIPscope-Session",
      "KIPSCOPE_SESSIONS?_?\\w*",
      "--session\\b",
      "/api/sessions?\\b",
      "\\bsessions? (id|folder|store|registry|link|menu)\\b",
      "\\bSessions menu\\b",
      "\\bSession(Store|Registry|Entry|Summary|Answer)\\b",
      "\\bsessionId\\b",
    ].join("|"),
    "i",
  );

  it("has no session as the name of the workspace in the code", () => {
    const paths = [
      "apps/server/src",
      "apps/web/src",
      "apps/cli/src",
      "packages/shared/src",
      "docs/http-api.md",
      "docs/deploy.md",
      "README.md",
    ];
    const hits: string[] = [];
    for (const path of paths)
      for (const file of files(resolve(ROOT, path))) {
        const lines = readFileSync(file, "utf8").split("\n");
        lines.forEach((line, i) => {
          if (!OLD_WORKSPACE_WORDS.test(line)) return;
          if (line.includes("LEGACY_") || /search tool/i.test(line)) return;
          hits.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim().slice(0, 100)}`);
        });
      }
    expect(hits, hits.slice(0, 20).join("\n")).toEqual([]);
  });
});
