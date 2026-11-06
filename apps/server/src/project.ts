import { readFileSync } from "node:fs";
import {
  MAX_EVENT_SIGNALS,
  MAX_MEASUREMENT_KEY,
  MAX_MEASUREMENT_META,
  MAX_MEASUREMENT_TEXT,
  MAX_MEASUREMENT_VALUE,
  MEASUREMENT_KEY,
  type Measurement,
  type MeasurementEntry,
  parseSignalId,
} from "@kipscope/shared";
import { parseDocument } from "yaml";
import { z } from "zod";
import type { GroupRule } from "./groups.ts";
import { type DisplayRule, type DisplayRules, NO_RULES, type Template } from "./names.ts";

/** Invalid or missing required project file; message: one or more lines `<path>: <field>: <problem>` (design N6). */
export class ProjectFileError extends Error {}

const nonEmpty = z.string().min(1);

/** Override keys of one ADX database's mapping (add-adx-databases D3); absent keys keep the shared mapping. */
export interface DatabaseOverride {
  table?: string;
  eventsTable?: string;
  columns?: Partial<Record<(typeof OVERRIDE_COLUMNS)[number], string>>;
}

/** A parsed project file: display rules and the start values of the measurement info (design F7) and events-line signals (add-events E9). */
export interface ProjectFile {
  rules: DisplayRules;
  measurement?: Measurement;
  events?: { signals: string[] };
  /** `adx.databases` by database name, in file order (add-adx-databases D3); read by `loadConfig`. */
  adxDatabases?: Map<string, DatabaseOverride>;
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
    // Checked by parseEvents (add-events E9).
    events: z.unknown().optional(),
    // Checked by parseAdx (add-adx-databases D3).
    adx: z.unknown().optional(),
  })
  .strict();

const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/y;

/** `display.names[1].show`, `display.rename.ICL_3A2h.SPEED_DISP`. */
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

/** The `events` section (add-events E9): only `signals`, at most MAX_EVENT_SIGNALS signal IDs; problems go to `problems`. */
function parseEvents(section: unknown, problems: string[]): { signals: string[] } | undefined {
  if (section === null || section === undefined) return undefined;
  if (!isMap(section)) {
    problems.push("events: must be a map with signals");
    return undefined;
  }
  for (const key of Object.keys(section))
    if (key !== "signals") problems.push(`events: unknown key "${key}"`);
  const list = section.signals;
  if (list === null || list === undefined) return undefined;
  if (!Array.isArray(list)) {
    problems.push("events.signals: must be a list of signal IDs");
    return undefined;
  }
  if (list.length > MAX_EVENT_SIGNALS)
    problems.push(`events.signals: at most ${MAX_EVENT_SIGNALS} signals`);
  const signals: string[] = [];
  list.forEach((id: unknown, i) => {
    const field = `events.signals[${i}]`;
    if (typeof id !== "string" || !parseSignalId(id))
      problems.push(`${field}: not a signal ID (<data ref>/<signal name>)`);
    else if (signals.includes(id)) problems.push(`${field}: ${id} is listed twice`);
    else signals.push(id);
  });
  return { signals };
}

const OVERRIDE_COLUMNS = ["dataRef", "signal", "time", "value", "text", "unit"] as const;
/** The rule of `KIPSCOPE_TABLE` and `KIPSCOPE_COLUMN_*` in config.ts. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A table or column name of an override; a string is the problem. */
function overrideName(value: unknown): { name: string } | string {
  if (typeof value !== "string" || !IDENTIFIER.test(value))
    return `not a valid identifier: ${String(value)}`;
  return { name: value };
}

/** Keys of `map` outside `known` as problems of `field`. */
function unknownKeys(field: string, map: Record<string, unknown>, known: readonly string[]) {
  return Object.keys(map)
    .filter((key) => !known.includes(key))
    .map((key) => `${field}: unknown key "${key}"`);
}

/**
 * The `adx` section (add-adx-databases D3): only `databases`, a map of database name to
 * `table`, `eventsTable` and `columns.{dataRef,signal,time,value,text,unit}`; problems go to
 * `problems`. Whether a name is configured is checked by `loadConfig`.
 */
function parseAdx(section: unknown, problems: string[]): Map<string, DatabaseOverride> | undefined {
  if (section === null || section === undefined) return undefined;
  if (!isMap(section)) {
    problems.push("adx: must be a map with databases");
    return undefined;
  }
  problems.push(...unknownKeys("adx", section, ["databases"]));
  const databases = section.databases;
  if (databases === null || databases === undefined) return undefined;
  if (!isMap(databases)) {
    problems.push("adx.databases: must be a map of database name to table and columns");
    return undefined;
  }
  const result = new Map<string, DatabaseOverride>();
  for (const [database, entry] of Object.entries(databases)) {
    const field = `adx.databases.${database}`;
    const override: DatabaseOverride = {};
    result.set(database, override);
    if (entry === null || entry === undefined) continue;
    if (!isMap(entry)) {
      problems.push(`${field}: must be a map with table, eventsTable and columns`);
      continue;
    }
    problems.push(...unknownKeys(field, entry, ["table", "eventsTable", "columns"]));
    for (const key of ["table", "eventsTable"] as const) {
      if (entry[key] === null || entry[key] === undefined) continue;
      const parsed = overrideName(entry[key]);
      if (typeof parsed === "string") problems.push(`${field}.${key}: ${parsed}`);
      else override[key] = parsed.name;
    }
    const columns = entry.columns;
    if (columns === null || columns === undefined) continue;
    if (!isMap(columns)) {
      problems.push(`${field}.columns: must be a map of ${OVERRIDE_COLUMNS.join(", ")}`);
      continue;
    }
    problems.push(...unknownKeys(`${field}.columns`, columns, OVERRIDE_COLUMNS));
    for (const key of OVERRIDE_COLUMNS) {
      if (columns[key] === null || columns[key] === undefined) continue;
      const parsed = overrideName(columns[key]);
      if (typeof parsed === "string") problems.push(`${field}.columns.${key}: ${parsed}`);
      else override.columns = { ...override.columns, [key]: parsed.name };
    }
  }
  return result;
}

/** Stage 1: YAML syntax. parseDocument (not parse) to report every error, not only the first. */
function parseYaml(text: string, path: string): unknown {
  const doc = parseDocument(text, { uniqueKeys: true });
  const syntax = doc.errors.map(
    (e) => `yaml: ${(e.message.split("\n")[0] ?? "").replace(/:$/, "")}`,
  );
  if (syntax.length) fail(path, syntax);
  try {
    return doc.toJS();
  } catch (error) {
    fail(path, [`yaml: ${(error as Error).message}`]);
  }
}

/** Pure part, for tests: text → rules and measurement info. `path` only labels the messages. */
export function parseProject(text: string, path: string): ProjectFile {
  const data = parseYaml(text, path);

  // Stage 2: structure; the measurement and events sections are checked alongside, so one error lists all.
  const result = FileSchema.safeParse(data ?? {});
  const sectionProblems: string[] = [];
  const measurement = parseMeasurement(isMap(data) ? data.measurement : undefined, sectionProblems);
  const events = parseEvents(isMap(data) ? data.events : undefined, sectionProblems);
  const adxDatabases = parseAdx(isMap(data) ? data.adx : undefined, sectionProblems);
  if (!result.success) {
    const problems: string[] = [];
    for (const issue of result.error.issues) {
      const field = fieldOf(issue.path);
      const prefix = field ? `${field}: ` : "";
      if (issue.code === "unrecognized_keys")
        for (const key of issue.keys) problems.push(`${prefix}unknown key "${key}"`);
      else problems.push(`${prefix}${issue.message}`);
    }
    fail(path, [...problems, ...sectionProblems]);
  }

  // Stage 3: regexes and templates.
  const display = result.data.display;
  const problems: string[] = [];
  const rules = (display?.names ?? []).map((rule, i) => compileRule(rule, i, problems));
  const groups = (display?.groups ?? []).map((rule, i) => compileGroupRule(rule, i, problems));
  problems.push(...sectionProblems);
  if (problems.length) fail(path, problems);
  const file: ProjectFile = {
    rules: {
      rules: rules.filter((r): r is DisplayRule => r !== undefined),
      rename: new Map(Object.entries(display?.rename ?? {})),
      groups: groups.filter((g): g is GroupRule => g !== undefined),
    },
  };
  if (measurement) file.measurement = measurement;
  if (events) file.events = events;
  if (adxDatabases) file.adxDatabases = adxDatabases;
  return file;
}

/** Display rules only; see parseProject. */
export function parseProjectFile(text: string, path: string): DisplayRules {
  return parseProject(text, path).rules;
}

/** The file's text; undefined for a missing optional file. Throws ProjectFileError. */
function readProject(file: { path: string; required: boolean }): string | undefined {
  try {
    return readFileSync(file.path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      if (!file.required) return undefined;
      fail(file.path, ["file not found"]);
    }
    fail(file.path, [`cannot read: ${(error as Error).message}`]);
  }
}

/** Reads, parses, validates and compiles; `{rules: NO_RULES}` for a missing optional file. Throws ProjectFileError. */
export function loadProject(file: { path: string; required: boolean }): ProjectFile {
  const text = readProject(file);
  return text === undefined ? { rules: NO_RULES } : parseProject(text, file.path);
}

/**
 * Only the `adx.databases` overrides (add-adx-databases D3), for `loadConfig`: the rest of the
 * file is checked by loadProject at start. Empty for a missing optional file or section.
 */
export function loadAdxDatabases(file: {
  path: string;
  required: boolean;
}): Map<string, DatabaseOverride> {
  const text = readProject(file);
  if (text === undefined) return new Map();
  const data = parseYaml(text, file.path);
  const problems: string[] = [];
  const databases = parseAdx(isMap(data) ? data.adx : undefined, problems);
  if (problems.length) fail(file.path, problems);
  return databases ?? new Map();
}

/** Display rules only; see loadProject. */
export function loadProjectFile(file: { path: string; required: boolean }): DisplayRules {
  return loadProject(file).rules;
}
