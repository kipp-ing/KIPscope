import { readFileSync } from "node:fs";
import { parseDocument } from "yaml";
import { z } from "zod";
import { type DisplayRule, type DisplayRules, NO_RULES, type Template } from "./names.ts";

/** Invalid or missing required project file; message: one or more lines `<path>: <field>: <problem>` (design N6). */
export class ProjectFileError extends Error {}

const nonEmpty = z.string().min(1);

/** File format of design N2; `null` (a key without value) counts as absent. */
const ProjectFile = z
  .object({
    display: z
      .object({
        names: z
          .array(
            z
              .object({ match: nonEmpty, show: nonEmpty, collision: z.string().optional() })
              .strict(),
          )
          .nullish(),
        rename: z
          .record(
            z.string(),
            z.string().refine((v) => v.trim() !== "", "empty name"),
          )
          .nullish(),
      })
      .strict()
      .nullish(),
  })
  .strict();

const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/y;

/** `display.names[1].show`, `display.rename.COMBI_412h.V_ANZ`. */
function fieldOf(path: readonly PropertyKey[]): string {
  return path
    .map((key, i) => (typeof key === "number" ? `[${key}]` : `${i === 0 ? "" : "."}${String(key)}`))
    .join("");
}

/** Template grammar of design N3; a string is the problem of the first stray brace. */
function parseTemplate(text: string): Template | string {
  const parts: (string | { group: string })[] = [];
  let literal = "";
  for (let i = 0; i < text.length; ) {
    const ch = text[i];
    if (ch === "{") {
      PLACEHOLDER.lastIndex = i;
      const m = PLACEHOLDER.exec(text);
      if (!m) return `stray "{" at column ${i + 1}`;
      if (literal) parts.push(literal);
      literal = "";
      parts.push({ group: m[1] as string });
      i = PLACEHOLDER.lastIndex;
    } else if (ch === "}") {
      return `stray "}" at column ${i + 1}`;
    } else {
      literal += ch;
      i++;
    }
  }
  if (literal) parts.push(literal);
  return parts;
}

/** Stage 3: regex, templates and their groups of one rule; problems go to `problems`. */
function compileRule(
  rule: { match: string; show: string; collision?: string | undefined },
  index: number,
  problems: string[],
): DisplayRule | undefined {
  const field = `display.names[${index}]`;
  let match: RegExp;
  try {
    match = new RegExp(rule.match);
  } catch (error) {
    problems.push(`${field}.match: invalid regex: ${(error as Error).message}`);
    return undefined;
  }
  // The empty alternative always matches; `groups` then lists every named group (design N3).
  const groups = Object.keys(new RegExp(`(?:${rule.match})|`).exec("")?.groups ?? {});
  const template = (key: "show" | "collision", text: string): Template | undefined => {
    const parsed = parseTemplate(text);
    if (typeof parsed === "string") {
      problems.push(`${field}.${key}: ${parsed}`);
      return undefined;
    }
    const unknown = new Set<string>();
    for (const part of parsed)
      if (typeof part !== "string" && !groups.includes(part.group)) unknown.add(part.group);
    for (const group of unknown)
      problems.push(
        `${field}.${key}: unknown group "${group}" (groups: ${groups.join(", ") || "none"})`,
      );
    return unknown.size ? undefined : parsed;
  };
  const show = template("show", rule.show);
  const collision =
    rule.collision === undefined ? undefined : template("collision", rule.collision);
  if (!show || (rule.collision !== undefined && !collision)) return undefined;
  return collision ? { index, match, show, collision } : { index, match, show };
}

function fail(path: string, problems: string[]): never {
  throw new ProjectFileError(problems.map((p) => `${path}: ${p}`).join("\n"));
}

/** Pure part, for tests: text → rules. `path` only labels the messages. */
export function parseProjectFile(text: string, path: string): DisplayRules {
  // Stage 1: YAML syntax. parseDocument (not parse) to report every error, not only the first.
  const doc = parseDocument(text, { uniqueKeys: true });
  const syntax = doc.errors.map(
    (e) => `yaml: ${(e.message.split("\n")[0] ?? "").replace(/:$/, "")}`,
  );
  if (syntax.length) fail(path, syntax);
  let data: unknown;
  try {
    data = doc.toJS();
  } catch (error) {
    fail(path, [`yaml: ${(error as Error).message}`]);
  }

  // Stage 2: structure.
  const result = ProjectFile.safeParse(data ?? {});
  if (!result.success) {
    const problems: string[] = [];
    for (const issue of result.error.issues) {
      const field = fieldOf(issue.path);
      const prefix = field ? `${field}: ` : "";
      if (issue.code === "unrecognized_keys")
        for (const key of issue.keys) problems.push(`${prefix}unknown key "${key}"`);
      else problems.push(`${prefix}${issue.message}`);
    }
    fail(path, problems);
  }

  // Stage 3: regexes and templates.
  const display = result.data.display;
  const problems: string[] = [];
  const rules = (display?.names ?? []).map((rule, i) => compileRule(rule, i, problems));
  if (problems.length) fail(path, problems);
  return {
    rules: rules.filter((r): r is DisplayRule => r !== undefined),
    rename: new Map(Object.entries(display?.rename ?? {})),
  };
}

/** Reads, parses, validates and compiles; NO_RULES for a missing optional file. Throws ProjectFileError. */
export function loadProjectFile(file: { path: string; required: boolean }): DisplayRules {
  let text: string;
  try {
    text = readFileSync(file.path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      if (!file.required) return NO_RULES;
      fail(file.path, ["file not found"]);
    }
    fail(file.path, [`cannot read: ${(error as Error).message}`]);
  }
  return parseProjectFile(text, file.path);
}
