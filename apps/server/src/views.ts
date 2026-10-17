import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_VIEW_BYTES,
  type ParsedView,
  PREVIOUS_VIEW,
  PREVIOUS_VIEW_TITLE,
  parseViewDoc,
  VIEW_NAME,
  type ViewDoc,
  type ViewSummary,
  type Workspace,
  workspaceToView,
} from "@kipscope/shared";
import { parseDocument, stringify } from "yaml";
import { writeAtomic } from "./persist.ts";

const EXTENSION = ".yaml";

/** A user view name or the store's own `_previous` (design V5). */
export function validViewName(name: string): boolean {
  return VIEW_NAME.test(name) || name === PREVIOUS_VIEW;
}

/** ISO-8601 UTC to the second, the form of a view's `saved`. */
export function savedNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Canonical YAML of a view document (design V1 "Writing"). */
export function viewYaml(doc: ViewDoc): string {
  return stringify(doc, { lineWidth: 0 });
}

/** Alias expansions allowed per document; the `yaml` default, named so it cannot drift (design V6). */
const MAX_ALIAS_COUNT = 100;

/**
 * Parses view text (YAML or JSON, YAML 1.2 core: ISO times stay strings) into a plain value.
 * A syntax error gives its message, which names line and column; a resolve error (alias bomb)
 * counts as one.
 */
export function parseViewText(
  text: string,
): { ok: true; data: unknown } | { ok: false; message: string } {
  const doc = parseDocument(text, { schema: "core" });
  const [error] = doc.errors;
  if (error) return { ok: false, message: error.message };
  try {
    return { ok: true, data: doc.toJS({ maxAliasCount: MAX_ALIAS_COUNT }) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export function viewSummary(name: string, doc: ViewDoc): ViewSummary {
  const signals = new Set(doc.windows.flatMap((w) => w.signals));
  const summary: ViewSummary = {
    name,
    title: doc.title,
    windows: doc.windows.length,
    signals: signals.size,
    data: doc.data,
  };
  if (doc.note !== undefined) summary.note = doc.note;
  if (doc.saved !== undefined) summary.saved = doc.saved;
  return summary;
}

function brokenSummary(name: string, error: string): ViewSummary {
  return { name, title: name, windows: 0, signals: 0, data: [], error };
}

/**
 * Named views as YAML files in one directory (design V5). Every name is checked before a path
 * is built, so nothing outside the directory is read, written or removed. Writes are
 * synchronous and atomic.
 */
export class ViewStore {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  /** Throws for a name that is not a view name, before any path is built. */
  private path(name: string): string {
    if (!validViewName(name)) throw new Error(`invalid view name: ${name}`);
    return join(this.dir, `${name}${EXTENSION}`);
  }

  /** False also for a name that is not a view name. */
  exists(name: string): boolean {
    return validViewName(name) && existsSync(this.path(name));
  }

  /** The file text; undefined when there is no such view (or the name is not a view name). */
  read(name: string): string | undefined {
    if (!validViewName(name)) return undefined;
    try {
      return readFileSync(this.path(name), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  /** The file's plain value (for `view.open`, which parses it itself) or why it cannot be read. */
  data(name: string): { ok: true; data: unknown } | { ok: false; message: string } | undefined {
    const text = this.read(name);
    if (text === undefined) return undefined;
    if (Buffer.byteLength(text) > MAX_VIEW_BYTES)
      return { ok: false, message: `file larger than ${MAX_VIEW_BYTES} bytes` };
    return parseViewText(text);
  }

  get(name: string): ParsedView | undefined {
    const data = this.data(name);
    if (data === undefined) return undefined;
    if (!data.ok) return { ok: false, code: "invalid_view", message: data.message };
    return parseViewDoc(data.data);
  }

  write(name: string, doc: ViewDoc): void {
    writeAtomic(this.path(name), viewYaml(doc));
  }

  /** False when there was no such view (or the name is not a view name). */
  remove(name: string): boolean {
    if (!validViewName(name)) return false;
    const path = this.path(name);
    if (!existsSync(path)) return false;
    rmSync(path);
    return true;
  }

  summary(name: string): ViewSummary | undefined {
    const parsed = this.get(name);
    if (parsed === undefined) return undefined;
    return parsed.ok ? viewSummary(name, parsed.doc) : brokenSummary(name, parsed.message);
  }

  /** Every `*.yaml`, newest `saved` first (none last), `_previous` always last; broken ones with `error`. */
  list(): ViewSummary[] {
    let files: string[];
    try {
      files = readdirSync(this.dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const views = files
      .filter((file) => file.endsWith(EXTENSION))
      .map((file) => {
        const name = file.slice(0, -EXTENSION.length);
        if (!validViewName(name)) return brokenSummary(name, "file name is not a valid view name");
        try {
          return this.summary(name) ?? brokenSummary(name, "file vanished while listing");
        } catch (error) {
          return brokenSummary(name, String(error));
        }
      });
    const rank = (v: ViewSummary) => (v.name === PREVIOUS_VIEW ? 2 : v.saved ? 0 : 1);
    return views.sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (b.saved ?? "").localeCompare(a.saved ?? "") ||
        a.name.localeCompare(b.name),
    );
  }

  /** `WorkspaceStore` hook: keeps a workspace with windows as "Before last open" (design V5). */
  beforeOpen(previous: Workspace): void {
    if (previous.windows.length === 0) return;
    this.write(
      PREVIOUS_VIEW,
      workspaceToView(previous, { title: PREVIOUS_VIEW_TITLE, saved: savedNow() }),
    );
  }
}
