import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Workspace, WorkspaceSchema } from "@kipscope/shared";
import type { WorkspaceStore } from "./workspace.ts";

/** Trailing debounce of state writes after the last accepted command (design V4). */
export const STATE_WRITE_DELAY_MS = 500;
export const STATE_FILE = "workspace.json";
/** A state file that could not be restored is moved here, replacing an older one. */
export const BAD_STATE_FILE = "workspace.bad.json";

export interface RestoredState {
  revision: number;
  workspace: Workspace;
}

type Warn = (message: string) => void;
const consoleWarn: Warn = (message) => console.warn(message);

/**
 * Writes `text` to a temp file in the same directory and renames it over `path`, so a crash
 * leaves the old or the new file, never half of one. Creates the directory first.
 */
export function writeAtomic(path: string, text: string): void {
  const tmp = `${path}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

function stateError(json: unknown): string | undefined {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return "not an object";
  const file = json as Record<string, unknown>;
  if (file.kipscope !== "workspace") return "not a KIPscope state file";
  if (file.version !== 1) return `state version ${String(file.version)}; this KIPscope reads 1`;
  const { revision } = file;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0)
    return "revision: not a non-negative integer";
  const parsed = WorkspaceSchema.safeParse(file.workspace);
  if (!parsed.success)
    return parsed.error.issues.map((i) => `workspace.${i.path.join(".")}: ${i.message}`).join("; ");
  return undefined;
}

/**
 * Reads the state file (design V4): missing → undefined (fresh start); valid → its revision and
 * workspace, unchecked against the catalog; anything else is moved to `workspace.bad.json` with
 * one warning and gives undefined.
 */
export function loadState(path: string, warn: Warn = consoleWarn): RestoredState | undefined {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    warn(`state file ${path} not readable (${String(error)}); starting with an empty workspace`);
    return undefined;
  }
  let json: unknown;
  let reason: string | undefined;
  try {
    json = JSON.parse(text);
    reason = stateError(json);
  } catch (error) {
    reason = `not JSON: ${(error as Error).message}`;
  }
  if (reason === undefined) {
    const file = json as { revision: number; workspace: unknown };
    return { revision: file.revision, workspace: WorkspaceSchema.parse(file.workspace) };
  }
  const bad = join(dirname(path), BAD_STATE_FILE);
  try {
    renameSync(path, bad);
    warn(`state file ${path} not restored (${reason}); moved to ${bad}, starting fresh`);
  } catch (error) {
    warn(`state file ${path} not restored (${reason}); move to ${bad} failed: ${String(error)}`);
  }
  return undefined;
}

/**
 * Writes the workspace and its revision to the state file (design V4): `STATE_WRITE_DELAY_MS`
 * after the last accepted command, or at once on `flush()`. A failed write never affects
 * commands and warns once per failure streak.
 */
export class StatePersister {
  private pending: RestoredState | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private failing = false;
  readonly path: string;
  private readonly warn: Warn;
  private readonly delayMs: number;

  constructor(path: string, options: { warn?: Warn; delayMs?: number } = {}) {
    this.path = path;
    this.warn = options.warn ?? consoleWarn;
    this.delayMs = options.delayMs ?? STATE_WRITE_DELAY_MS;
  }

  subscribe(store: WorkspaceStore): () => void {
    return store.subscribe((revision, workspace) => {
      this.pending = { revision, workspace };
      if (this.timer !== undefined) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.flush(), this.delayMs);
    });
  }

  /** Writes a pending change now; nothing pending → no write. */
  flush(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    const state = this.pending;
    if (!state) return;
    this.pending = undefined;
    const file = {
      kipscope: "workspace",
      version: 1,
      revision: state.revision,
      written: new Date().toISOString(),
      workspace: state.workspace,
    };
    try {
      writeAtomic(this.path, `${JSON.stringify(file, null, 2)}\n`);
      this.failing = false;
    } catch (error) {
      if (!this.failing) this.warn(`state file ${this.path} not written: ${String(error)}`);
      this.failing = true;
    }
  }
}
