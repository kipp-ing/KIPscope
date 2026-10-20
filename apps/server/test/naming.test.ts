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
  it("has no session in the code", () => {
    // grep -rniE "\bsessions?\b" apps/server/src apps/web/src apps/cli/src packages/shared/src \
    //   docs/http-api.md docs/deploy.md README.md | grep -v -e LEGACY_ -e 'KI\.ping'
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
          if (!/\bsessions?\b/i.test(line)) return;
          if (line.includes("LEGACY_") || /KI\.ping/.test(line)) return;
          hits.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim().slice(0, 100)}`);
        });
      }
    expect(hits, hits.slice(0, 20).join("\n")).toEqual([]);
  });
});
