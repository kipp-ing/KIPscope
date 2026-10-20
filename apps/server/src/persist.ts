import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  GRANT_ALL,
  Grant,
  USER_ID,
  WORKSPACE_ID,
  type Workspace,
  WorkspaceSchema,
  WorkspaceShare,
} from "@kipscope/shared";
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
 * One file written `delayMs` after the last `schedule`, or at once on `flush()`, atomically
 * (design V4). A failed write never reaches the caller and warns once per failure streak.
 */
export class DebouncedFile {
  private pending: (() => string) | undefined;
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

  /** Writes `text()` after the delay; a later call restarts the delay and replaces the text. */
  schedule(text: () => string): void {
    this.pending = text;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delayMs);
  }

  /** Writes a pending change now; nothing pending → no write. */
  flush(): void {
    const text = this.pending;
    this.cancel();
    if (!text) return;
    try {
      writeAtomic(this.path, text());
      this.failing = false;
    } catch (error) {
      if (!this.failing) this.warn(`state file ${this.path} not written: ${String(error)}`);
      this.failing = true;
    }
  }

  /** Drops a pending write. */
  cancel(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
  }
}

/**
 * Writes the workspace and its revision to the state file (design V4): `STATE_WRITE_DELAY_MS`
 * after the last accepted command, or at once on `flush()`. A failed write never affects
 * commands and warns once per failure streak.
 */
export class StatePersister {
  private readonly file: DebouncedFile;
  readonly path: string;

  constructor(path: string, options: { warn?: Warn; delayMs?: number } = {}) {
    this.path = path;
    this.file = new DebouncedFile(path, options);
  }

  subscribe(store: WorkspaceStore): () => void {
    return store.subscribe((revision, workspace) => {
      this.file.schedule(() => {
        const file = {
          kipscope: "workspace",
          version: 1,
          revision,
          written: new Date().toISOString(),
          workspace,
        };
        return `${JSON.stringify(file, null, 2)}\n`;
      });
    });
  }

  /** Writes a pending change now; nothing pending → no write. */
  flush(): void {
    this.file.flush();
  }
}

/** Folder of the workspace files below the state dir (add-multiuser M4). */
export const WORKSPACES_DIR = "workspaces";
/** LEGACY_: the folder of round 1, renamed to WORKSPACES_DIR once at start (M4 migration). */
export const LEGACY_SESSIONS_DIR = "sessions";
/** LEGACY_: the `kipscope` tag of round-1 files (version 1, no grant), read as grant "all". */
export const LEGACY_SESSION_TAG = "session";
/** The `kipscope` tag and version of a workspace file (M4). */
const WORKSPACE_TAG = "workspace";
const WORKSPACE_VERSION = 2;

/** What a workspace file holds besides its envelope (add-multiuser M4). */
export interface WorkspaceFile {
  id: string;
  owner: string;
  share: WorkspaceShare;
  grant: Grant;
  createdAt: string;
  lastActiveAt: string;
  revision: number;
  workspace: Workspace;
}

/** The text of `<stateDir>/workspaces/<id>.json`, always version 2 (add-multiuser M4). */
export function workspaceFileText(file: WorkspaceFile): string {
  const { id, owner, share, grant, createdAt, lastActiveAt, revision, workspace } = file;
  const json = {
    kipscope: WORKSPACE_TAG,
    version: WORKSPACE_VERSION,
    id,
    owner,
    share,
    grant,
    createdAt,
    lastActiveAt,
    revision,
    workspace,
  };
  return `${JSON.stringify(json, null, 2)}\n`;
}

const isTime = (value: unknown) => typeof value === "string" && !Number.isNaN(Date.parse(value));

/** Why a parsed file is no workspace file of `id`; undefined when it is one (v2 or LEGACY_SESSION_TAG v1). */
function workspaceFileError(json: unknown, id: string): string | undefined {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return "not an object";
  const file = json as Record<string, unknown>;
  const legacy = file.kipscope === LEGACY_SESSION_TAG;
  if (legacy) {
    if (file.version !== 1)
      return `version ${String(file.version)} of a round-1 file; this KIPscope reads 1`;
  } else if (file.kipscope !== WORKSPACE_TAG) return "not a KIPscope workspace file";
  else if (file.version !== WORKSPACE_VERSION)
    return `workspace version ${String(file.version)}; this KIPscope reads ${WORKSPACE_VERSION}`;
  if (file.id !== id || !WORKSPACE_ID.test(id)) return "id: not the file's workspace ID";
  if (typeof file.owner !== "string" || !USER_ID.test(file.owner)) return "owner: not a user ID";
  if (!WorkspaceShare.safeParse(file.share).success) return "share: not private, read or write";
  if (!legacy) {
    const grant = Grant.safeParse(file.grant);
    if (!grant.success)
      return grant.error.issues.map((i) => `grant.${i.path.join(".")}: ${i.message}`).join("; ");
  }
  if (!isTime(file.createdAt)) return "createdAt: not a time";
  if (!isTime(file.lastActiveAt)) return "lastActiveAt: not a time";
  const { revision } = file;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0)
    return "revision: not a non-negative integer";
  const parsed = WorkspaceSchema.safeParse(file.workspace);
  if (!parsed.success)
    return parsed.error.issues.map((i) => `workspace.${i.path.join(".")}: ${i.message}`).join("; ");
  return undefined;
}

/**
 * Reads one workspace file (add-multiuser M4); `<id>` is its name without `.json`. Version 2, or
 * a round-1 file (LEGACY_SESSION_TAG, version 1) read with grant "all"; valid → its fields,
 * unchecked against any catalog. Anything else is moved to `<id>.bad.json` with one warning and
 * gives undefined.
 */
export function loadWorkspaceFile(
  path: string,
  warn: Warn = consoleWarn,
): WorkspaceFile | undefined {
  const id = basename(path, ".json");
  let reason: string | undefined;
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
    reason = workspaceFileError(json, id);
  } catch (error) {
    reason =
      error instanceof SyntaxError
        ? `not JSON: ${error.message}`
        : `not readable: ${String(error)}`;
  }
  if (reason === undefined) {
    const file = json as Omit<WorkspaceFile, "grant"> & { kipscope: string; grant?: unknown };
    return {
      id,
      owner: file.owner,
      share: file.share,
      grant: file.kipscope === LEGACY_SESSION_TAG ? GRANT_ALL : Grant.parse(file.grant),
      createdAt: file.createdAt,
      lastActiveAt: file.lastActiveAt,
      revision: file.revision,
      workspace: WorkspaceSchema.parse(file.workspace),
    };
  }
  const bad = join(dirname(path), `${id}.bad.json`);
  try {
    renameSync(path, bad);
    warn(`workspace file ${path} not restored (${reason}); moved to ${bad}`);
  } catch (error) {
    warn(
      `workspace file ${path} not restored (${reason}); move to ${bad} failed: ${String(error)}`,
    );
  }
  return undefined;
}
