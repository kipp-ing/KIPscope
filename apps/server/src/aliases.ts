import { readFileSync } from "node:fs";

/** The dictionary of logical signal names (add-signal-aliases D1), one per server. */
export interface Aliases {
  /** Source name (without data reference) → logical name. */
  bySource: ReadonlyMap<string, string>;
  /** Logical name in lower case → source name; input matches a logical name ignoring case. */
  byLogical: ReadonlyMap<string, string>;
}

/** An aliases file that cannot be read or breaks a rule; the message names the file and the keys. */
export class AliasesFileError extends Error {}

const MAX_LOGICAL_LENGTH = 256;
// C0 and C1 control characters, DEL included.
// biome-ignore lint/suspicious/noControlCharactersInRegex: the check is for control characters
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

const quote = (key: string) => JSON.stringify(key);

function fail(path: string, problems: string[]): never {
  throw new AliasesFileError(problems.map((p) => `${path}: ${p}`).join("\n"));
}

/** Problems of one entry's key and value (spec "Aliases file is checked at start"). */
function entryProblems(logical: string, source: unknown): string[] {
  const problems: string[] = [];
  const key = quote(logical);
  if (logical.trim() === "") problems.push(`${key}: logical name is blank`);
  else if (logical.trim() !== logical)
    problems.push(`${key}: logical name has leading or trailing spaces`);
  if (logical.length > MAX_LOGICAL_LENGTH)
    problems.push(`${key}: logical name is longer than ${MAX_LOGICAL_LENGTH} characters`);
  if (CONTROL.test(logical)) problems.push(`${key}: logical name has a control character`);
  if (typeof source !== "string") problems.push(`${key}: value must be a string (a source name)`);
  else if (source.trim() === "") problems.push(`${key}: source name is blank`);
  return problems;
}

/** Keys per value of `key`, only values held by two or more, in file order. */
function shared(entries: readonly [string, string][], key: (e: [string, string]) => string) {
  const groups = new Map<string, string[]>();
  for (const e of entries) {
    const k = key(e);
    const group = groups.get(k);
    if (group) group.push(e[0]);
    else groups.set(k, [e[0]]);
  }
  return [...groups].filter(([, logicals]) => logicals.length > 1);
}

/** Checks a parsed file and builds the dictionary; self-entries (logical === source) have no effect. */
function parseAliases(data: unknown, path: string): Aliases {
  if (typeof data !== "object" || data === null || Array.isArray(data))
    fail(path, ["must be a JSON object of logical name to source name"]);
  const raw = Object.entries(data as Record<string, unknown>);
  const problems = raw.flatMap(([logical, source]) => entryProblems(logical, source));
  if (problems.length) fail(path, problems);
  const entries = (raw as [string, string][]).filter(([logical, source]) => logical !== source);
  for (const [source, logicals] of shared(entries, ([, s]) => s))
    problems.push(
      `${logicals.map(quote).join(" and ")} stand for the same source name ${quote(source)}`,
    );
  for (const [, logicals] of shared(entries, ([l]) => l.toLowerCase()))
    problems.push(`${logicals.map(quote).join(" and ")} differ only in letter case`);
  const logicalOf = new Map(entries.map(([l, s]) => [s, l]));
  for (const [logical] of entries) {
    const other = logicalOf.get(logical);
    if (other !== undefined)
      problems.push(`${quote(logical)} is the source name of ${quote(other)}`);
  }
  if (problems.length) fail(path, problems);
  return {
    bySource: new Map(entries.map(([l, s]) => [s, l])),
    byLogical: new Map(entries.map(([l, s]) => [l.toLowerCase(), s])),
  };
}

/** Reads and checks the aliases file (spec "Aliases file"). Throws AliasesFileError. */
export function loadAliases(path: string): Aliases {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") fail(path, ["file not found"]);
    fail(path, [`cannot read: ${(error as Error).message}`]);
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    fail(path, [`not valid JSON: ${(error as Error).message}`]);
  }
  return parseAliases(data, path);
}
