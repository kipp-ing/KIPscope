import { readFileSync } from "node:fs";
import {
  MAX_MEASUREMENT_KEY,
  MAX_MEASUREMENT_META,
  MAX_MEASUREMENT_TEXT,
  MAX_MEASUREMENT_VALUE,
  MEASUREMENT_KEY,
  type Measurement,
  type MeasurementEntry,
} from "@kipscope/shared";
import { parseDocument } from "yaml";
import { z } from "zod";
import type { GroupRule } from "./groups.ts";
import { type DisplayRule, type DisplayRules, NO_RULES, type Template } from "./names.ts";

/** Invalid or missing required project file; message: one or more lines `<path>: <field>: <problem>` (design N6). */
export class ProjectFileError extends Error {}

const nonEmpty = z.string().min(1);

/** A parsed project file: display rules and the start value of the measurement info (design F7). */
export interface ProjectFile {
  rules: DisplayRules;
  measurement?: Measurement;
}

/** File format of design N2 and F7; `null` (a key without value) counts as absent. */
const FileSchema = z
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
        groups: z
          .array(z.object({ match: nonEmpty.optional(), group: nonEmpty }).strict())
          .nullish(),
      })
      .strict()
      .nullish(),
    // Checked by parseMeasurement for the problem texts of design F7.
    measurement: z.unknown().optional(),
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

/** Regex and its named groups; a string is the problem. */
function compileRegex(source: string): { match: RegExp; groups: string[] } | string {
  let match: RegExp;
  try {
    match = new RegExp(source);
  } catch (error) {
    return `invalid regex: ${(error as Error).message}`;
  }
  // The empty alternative always matches; `groups` then lists every named group (design N3).
  const groups = Object.keys(new RegExp(`(?:${source})|`).exec("")?.groups ?? {});
  return { match, groups };
}

/** Template of `field` whose placeholders must be in `known`; problems go to `problems`. */
function compileTemplate(
  field: string,
  text: string,
  known: readonly string[],
  unknownProblem: (placeholder: string) => string,
  problems: string[],
): Template | undefined {
  const parsed = parseTemplate(text);
  if (typeof parsed === "string") {
    problems.push(`${field}: ${parsed}`);
    return undefined;
  }
  const unknown = new Set<string>();
  for (const part of parsed)
    if (typeof part !== "string" && !known.includes(part.group)) unknown.add(part.group);
  for (const placeholder of unknown) problems.push(`${field}: ${unknownProblem(placeholder)}`);
  return unknown.size ? undefined : parsed;
}

/** Stage 3: regex, templates and their groups of one rule; problems go to `problems`. */
function compileRule(
  rule: { match: string; show: string; collision?: string | undefined },
  index: number,
  problems: string[],
): DisplayRule | undefined {
  const field = `display.names[${index}]`;
  const regex = compileRegex(rule.match);
  if (typeof regex === "string") {
    problems.push(`${field}.match: ${regex}`);
    return undefined;
  }
  const { match, groups } = regex;
  const template = (key: "show" | "collision", text: string): Template | undefined =>
    compileTemplate(
      `${field}.${key}`,
      text,
      groups,
      (group) => `unknown group "${group}" (groups: ${groups.join(", ") || "none"})`,
      problems,
    );
  const show = template("show", rule.show);
  const collision =
    rule.collision === undefined ? undefined : template("collision", rule.collision);
  if (!show || (rule.collision !== undefined && !collision)) return undefined;
  return collision ? { index, match, show, collision } : { index, match, show };
}

/** Stage 3 for one `display.groups` rule (design G3): placeholders are `sender` and the regex's groups. */
function compileGroupRule(
  rule: { match?: string | undefined; group: string },
  index: number,
  problems: string[],
): GroupRule | undefined {
  const field = `display.groups[${index}]`;
  let match: RegExp | undefined;
  let groups: string[] = [];
  if (rule.match !== undefined) {
    const regex = compileRegex(rule.match);
    if (typeof regex === "string") {
      problems.push(`${field}.match: ${regex}`);
      return undefined;
    }
    ({ match, groups } = regex);
    if (groups.includes("sender")) {
      problems.push(`${field}.match: group "sender" clashes with the field {sender}`);
      match = undefined;
    }
  }
  const known = ["sender", ...groups.filter((g) => g !== "sender")];
  const group = compileTemplate(
    `${field}.group`,
    rule.group,
    known,
    (placeholder) => `unknown placeholder "${placeholder}" (known: ${known.join(", ")})`,
    problems,
  );
  if (!group || (rule.match !== undefined && !match)) return undefined;
  return match ? { index, match, group } : { index, group };
}

function fail(path: string, problems: string[]): never {
  throw new ProjectFileError(problems.map((p) => `${path}: ${p}`).join("\n"));
}

const MEASUREMENT_FIELDS = new Set(["name", "object", "meta"]);
const CONTROL = /\p{Cc}/u;

function isMap(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Text, number or boolean as trimmed text; `null` and blank as undefined; a string is the problem. */
function scalarText(value: unknown, max: number): { text?: string } | string {
  if (value === null || value === undefined) return {};
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")
    return "must be text, a number or true/false";
  const text = String(value).trim();
  if (CONTROL.test(text)) return "no line breaks or control characters";
  if (text.length > max) return `at most ${max} characters`;
  return text ? { text } : {};
}

/** The `measurement` section (design F7) with the limits of F6; problems go to `problems`. */
function parseMeasurement(section: unknown, problems: string[]): Measurement | undefined {
  if (section === null || section === undefined) return undefined;
  if (!isMap(section)) {
    problems.push("measurement: must be a map with name, object and meta");
    return undefined;
  }
  const measurement: Measurement = {};
  for (const key of Object.keys(section))
    if (!MEASUREMENT_FIELDS.has(key)) problems.push(`measurement: unknown key "${key}"`);
  for (const field of ["name", "object"] as const) {
    const parsed = scalarText(section[field], MAX_MEASUREMENT_TEXT);
    if (typeof parsed === "string") problems.push(`measurement.${field}: ${parsed}`);
    else if (parsed.text !== undefined) measurement[field] = parsed.text;
  }
  const meta = section.meta;
  if (meta !== null && meta !== undefined) {
    if (!isMap(meta)) problems.push("measurement.meta: must be a map of key: value");
    else {
      // Keys are trimmed like the measurement.setMeta command's, so `"driver "` here and `driver`
      // from the CLI are one entry; keys equal after trimming apply in file order like the command.
      const raw = Object.keys(meta);
      if (new Set(raw.map((k) => k.trim())).size > MAX_MEASUREMENT_META)
        problems.push(`measurement.meta: at most ${MAX_MEASUREMENT_META} entries`);
      let entries: MeasurementEntry[] = [];
      for (const rawKey of raw) {
        const key = rawKey.trim();
        const field = `measurement.meta.${key}`;
        if (!/^\p{L}/u.test(key)) problems.push(`${field}: key must start with a letter`);
        else if (!MEASUREMENT_KEY.test(key))
          problems.push(`${field}: key may hold only letters, digits, space, _ . -`);
        else if (key.length > MAX_MEASUREMENT_KEY)
          problems.push(`${field}: at most ${MAX_MEASUREMENT_KEY} characters`);
        const parsed = scalarText(meta[rawKey], MAX_MEASUREMENT_VALUE);
        if (typeof parsed === "string") {
          problems.push(`${field}: ${parsed}`);
          continue;
        }
        const index = entries.findIndex((e) => e.key === key);
        if (parsed.text === undefined) entries = entries.filter((e) => e.key !== key);
        else if (index >= 0) entries = entries.with(index, { key, value: parsed.text });
        else entries.push({ key, value: parsed.text });
      }
      if (entries.length) measurement.meta = entries;
    }
  }
  return Object.keys(measurement).length ? measurement : undefined;
}

/** Pure part, for tests: text → rules and measurement info. `path` only labels the messages. */
export function parseProject(text: string, path: string): ProjectFile {
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

  // Stage 2: structure; the measurement section is checked alongside, so one error lists both.
  const result = FileSchema.safeParse(data ?? {});
  const measurementProblems: string[] = [];
  const measurement = parseMeasurement(
    isMap(data) ? data.measurement : undefined,
    measurementProblems,
  );
  if (!result.success) {
    const problems: string[] = [];
    for (const issue of result.error.issues) {
      const field = fieldOf(issue.path);
      const prefix = field ? `${field}: ` : "";
      if (issue.code === "unrecognized_keys")
        for (const key of issue.keys) problems.push(`${prefix}unknown key "${key}"`);
      else problems.push(`${prefix}${issue.message}`);
    }
    fail(path, [...problems, ...measurementProblems]);
  }

  // Stage 3: regexes and templates.
  const display = result.data.display;
  const problems: string[] = [];
  const rules = (display?.names ?? []).map((rule, i) => compileRule(rule, i, problems));
  const groups = (display?.groups ?? []).map((rule, i) => compileGroupRule(rule, i, problems));
  problems.push(...measurementProblems);
  if (problems.length) fail(path, problems);
  const file: ProjectFile = {
    rules: {
      rules: rules.filter((r): r is DisplayRule => r !== undefined),
      rename: new Map(Object.entries(display?.rename ?? {})),
      groups: groups.filter((g): g is GroupRule => g !== undefined),
    },
  };
  if (measurement) file.measurement = measurement;
  return file;
}

/** Display rules only; see parseProject. */
export function parseProjectFile(text: string, path: string): DisplayRules {
  return parseProject(text, path).rules;
}

/** Reads, parses, validates and compiles; `{rules: NO_RULES}` for a missing optional file. Throws ProjectFileError. */
export function loadProject(file: { path: string; required: boolean }): ProjectFile {
  let text: string;
  try {
    text = readFileSync(file.path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      if (!file.required) return { rules: NO_RULES };
      fail(file.path, ["file not found"]);
    }
    fail(file.path, [`cannot read: ${(error as Error).message}`]);
  }
  return parseProject(text, file.path);
}

/** Display rules only; see loadProject. */
export function loadProjectFile(file: { path: string; required: boolean }): DisplayRules {
  return loadProject(file).rules;
}
