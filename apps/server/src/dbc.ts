import { readFile } from "node:fs/promises";

/** Metadata for one `<message>.<signal>` key (design D6). Absent fields stay absent. */
export interface DbcSignal {
  unit?: string;
  description?: string;
  /** Value table (`VAL_`): raw value → label. Parsed now, used once state signals exist. */
  values?: Map<number, string>;
}

const MESSAGE = /^BO_\s+(\d+)\s+(\w+)\s*:/;
const SIGNAL = /^\s*SG_\s+(\w+)\s*(?:[mM]\w*\s*)?:[^"]*"([^"]*)"/;
const COMMENT = /CM_\s+SG_\s+(\d+)\s+(\w+)\s+"((?:[^"\\]|\\.)*)"\s*;/g;
const VALUES = /VAL_\s+(\d+)\s+(\w+)((?:\s+-?\d+\s+"(?:[^"\\]|\\.)*")*)\s*;/g;
const VALUE_PAIR = /(-?\d+)\s+"((?:[^"\\]|\\.)*)"/g;

const unquote = (s: string) => s.replace(/\\(.)/g, "$1");
const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** Parses DBC text (already decoded) into metadata keyed by `<message>.<signal>`. */
export function parseDbc(text: string): Map<string, DbcSignal> {
  const result = new Map<string, DbcSignal>();
  const messages = new Map<string, string>();
  let message: string | undefined;

  for (const line of text.split(/\r?\n/)) {
    const bo = MESSAGE.exec(line);
    if (bo) {
      const [, id = "", name = ""] = bo;
      messages.set(id, name);
      message = name;
      continue;
    }
    const sg = SIGNAL.exec(line);
    if (sg && message) {
      const [, name = "", unit = ""] = sg;
      const entry: DbcSignal = {};
      if (unit.trim()) entry.unit = unit.trim();
      result.set(`${message}.${name}`, entry);
      continue;
    }
    if (line.trim() === "") message = undefined;
  }

  const entryFor = (id: string, name: string) => {
    const msg = messages.get(id);
    return msg === undefined ? undefined : result.get(`${msg}.${name}`);
  };

  for (const [, id = "", name = "", raw = ""] of text.matchAll(COMMENT)) {
    const entry = entryFor(id, name);
    const description = collapse(unquote(raw));
    if (entry && description) entry.description = description;
  }

  for (const [, id = "", name = "", pairs = ""] of text.matchAll(VALUES)) {
    const entry = entryFor(id, name);
    if (!entry) continue;
    const values = new Map<number, string>();
    for (const [, value = "", label = ""] of pairs.matchAll(VALUE_PAIR)) {
      values.set(Number(value), unquote(label));
    }
    entry.values = values;
  }
  return result;
}

/**
 * Loads DBC files (ISO-8859-1) in priority order; for keys defined in several files the first
 * file wins. Unreadable files are reported via `onError` and skipped: missing metadata never
 * blocks data display.
 */
export async function loadDbcFiles(
  paths: readonly string[],
  onError: (path: string, error: unknown) => void = () => {},
): Promise<Map<string, DbcSignal>> {
  const merged = new Map<string, DbcSignal>();
  const decoder = new TextDecoder("latin1");
  for (const path of paths) {
    let parsed: Map<string, DbcSignal>;
    try {
      parsed = parseDbc(decoder.decode(await readFile(path)));
    } catch (error) {
      onError(path, error);
      continue;
    }
    for (const [key, entry] of parsed) {
      if (!merged.has(key)) merged.set(key, entry);
    }
  }
  return merged;
}
