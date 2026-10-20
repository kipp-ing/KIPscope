import { randomInt } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  type CaseCatalog,
  DataRef,
  GRANT_ALL,
  GRANT_NONE,
  type Grant,
  LOCAL_USER,
  MAX_GRANT_OBJECTS,
  MAX_WORKSPACES_PER_USER,
  parseSignalId,
  scopeKey,
  type Workspace,
  type WorkspaceRights,
  type WorkspaceShare,
  type WorkspaceSummary,
} from "@kipscope/shared";
import type { IdentityConfig } from "./config.ts";
import {
  DebouncedFile,
  LEGACY_SESSIONS_DIR,
  loadState,
  loadWorkspaceFile,
  STATE_FILE,
  WORKSPACES_DIR,
  type WorkspaceFile,
  workspaceFileText,
  writeAtomic,
} from "./persist.ts";
import { covers, effectiveGrant, grantedOf, initialGrant } from "./rights.ts";
import { catalogContext, WorkspaceStore } from "./workspace.ts";

/** Owner, share level, grant and times of a workspace (add-multiuser M4). */
export interface WorkspaceRecord {
  /** WORKSPACE_ID: 10 × [a-z0-9] from crypto.randomInt. */
  id: string;
  /** USER_ID */
  owner: string;
  /** "private" at create. */
  share: WorkspaceShare;
  /** M3; initialGrant(identity) at create. Replaced, never mutated, when widened. */
  grant: Grant;
  /** ISO */
  createdAt: string;
  /** ISO; create, live connect, accepted command. */
  lastActiveAt: string;
}

/** One workspace store with its owner, share level and grant (add-multiuser M4). */
export interface WorkspaceEntry {
  readonly record: WorkspaceRecord;
  readonly store: WorkspaceStore;
}

/** Every workspace of the user has a live client, so none can make room (409 `workspace_limit`). */
export class WorkspaceLimitError extends Error {
  constructor(user: string, limit: number) {
    super(`${user} has ${limit} workspaces, each with an open client; close or delete one first`);
    this.name = "WorkspaceLimitError";
  }
}

/** A grant would hold more than MAX_GRANT_OBJECTS data refs (M3); the grant stays unchanged. */
export class GrantLimitError extends Error {
  constructor(id: string, size: number) {
    super(`workspace ${id} would hold ${size} data refs; at most ${MAX_GRANT_OBJECTS} are allowed`);
    this.name = "GrantLimitError";
  }
}

export type WorkspaceChange = {
  type: "share" | "grant" | "delete" | "command";
  entry: WorkspaceEntry;
  scopeChanged: boolean;
};

/** How long a workspace handed out by `reuseOf` stays unpickable without a live connect (M4). */
export const REUSE_CLAIM_MS = 10_000;

type Log = { info(message: string): void; warn(message: string): void };

const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
const DAY_MS = 86_400_000;
const CLEANUP_EVERY_MS = 3_600_000;
const consoleLog: Log = { info: (m) => console.info(m), warn: (m) => console.warn(m) };

/** A workspace ID: 10 characters of [a-z0-9], each from crypto.randomInt. */
function newId(): string {
  let id = "";
  for (let i = 0; i < 10; i++) id += ID_CHARS[randomInt(ID_CHARS.length)];
  return id;
}

/** The `kipscope` tag and version of a catalog file (add-case-open K9 step 5). */
const CATALOG_TAG = "case-catalog";
const CATALOG_VERSION = 1;
/** `<id>.cases.json`: the catalog of a workspace opened from one, next to its workspace file. */
const CATALOG_SUFFIX = ".cases.json";

/** The text of a catalog file. */
const catalogFileText = (catalog: CaseCatalog) =>
  `${JSON.stringify({ kipscope: CATALOG_TAG, version: CATALOG_VERSION, catalog })}\n`;

const isText = (value: unknown) => typeof value === "string";

/** Why a parsed catalog file is not the catalog `catalogId` with `count` entries; undefined when it is. */
function catalogFileError(json: unknown, catalogId: string, count: number): string | undefined {
  const file = json as { kipscope?: unknown; version?: unknown; catalog?: Partial<CaseCatalog> };
  if (typeof json !== "object" || json === null) return "not an object";
  if (file.kipscope !== CATALOG_TAG || file.version !== CATALOG_VERSION)
    return "not a KIPscope catalog file of version 1";
  const catalog = file.catalog;
  if (catalog?.catalogId !== catalogId) return "catalogId: not the workspace's catalog";
  const entries = catalog.entries;
  if (!Array.isArray(entries) || entries.length !== count)
    return `entries: not the ${count} sessions of the workspace's catalog`;
  for (const [i, e] of entries.entries())
    if (![e?.id, e?.object, e?.dataRef, e?.from, e?.to].every(isText))
      return `entries[${i}]: not a session`;
  return undefined;
}

/** Internal state per workspace: its file writer, last scope, activity order, reuse claim. */
interface Held {
  entry: WorkspaceEntry;
  /** The open catalog's entries (add-case-open K6); absent without `workspace.case`. */
  catalog?: CaseCatalog;
  file: DebouncedFile;
  scope: string | undefined;
  /** Breaks ties of equal `lastActiveAt` (same millisecond): later activity first. */
  seq: number;
  /** When `reuseOf` last handed it out (in memory only); a live connect clears it. */
  claimedAt: number | undefined;
  unsubscribe: () => void;
}

/**
 * Every workspace of every user, in memory, each written to `<dir>/workspaces/<id>.json`
 * (add-multiuser M4): 500 ms after its last change, at once on `flush()`, atomically.
 */
export class WorkspaceRegistry {
  private readonly dir: string;
  private readonly workspacesDir: string;
  private readonly seed: (grant: Grant) => Workspace;
  private readonly identity: IdentityConfig["kind"];
  private readonly idleMs: number;
  private readonly now: () => number;
  private readonly log: Log;
  private readonly limit: number;
  private readonly held = new Map<string, Held>();
  private readonly listeners = new Set<(event: WorkspaceChange) => void>();
  private cleanupTimer: ReturnType<typeof setInterval> | undefined;
  private seq = 0;

  constructor(options: {
    /** `<stateDir>` */
    dir: string;
    /** A new workspace's content: events-line signals filtered by covers(grant, ·). */
    seed: (grant: Grant) => Workspace;
    /** For initialGrant / effectiveGrant. */
    identity: IdentityConfig["kind"];
    idleDays: number;
    /** Fake clocks in tests. */
    now?: () => number;
    log?: Log;
    /** Default MAX_WORKSPACES_PER_USER. */
    limit?: number;
  }) {
    this.dir = options.dir;
    this.workspacesDir = join(options.dir, WORKSPACES_DIR);
    this.seed = options.seed;
    this.identity = options.identity;
    this.idleMs = options.idleDays * DAY_MS;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? consoleLog;
    this.limit = options.limit ?? MAX_WORKSPACES_PER_USER;
  }

  /** Runs the migration, reads every workspace file, starts the hourly cleanup. */
  start(): void {
    this.migrate();
    let names: string[] = [];
    try {
      names = readdirSync(this.workspacesDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        this.log.warn(`workspace dir ${this.workspacesDir} not readable: ${String(error)}`);
    }
    for (const name of names) {
      if (!name.endsWith(".json") || name.endsWith(".bad.json") || name.endsWith(CATALOG_SUFFIX))
        continue;
      const file = loadWorkspaceFile(join(this.workspacesDir, name), (m) => this.log.warn(m));
      if (file && !this.held.has(file.id)) this.restore(file);
    }
    this.cleanup();
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_EVERY_MS);
    this.cleanupTimer.unref?.();
  }

  get(id: string): WorkspaceEntry | undefined {
    return this.held.get(id)?.entry;
  }

  /**
   * A new private workspace of `owner` with the initial grant, seeded within it. At the limit the
   * owner's least recently active workspace without a live client is deleted first; throws
   * WorkspaceLimitError when every one has a client.
   */
  create(owner: string): WorkspaceEntry {
    const own = this.listOf(owner);
    if (own.length >= this.limit) {
      const evict = own.reverse().find((e) => !hasClients(e));
      if (!evict) throw new WorkspaceLimitError(owner, this.limit);
      this.delete(evict.record.id);
    }
    let id = newId();
    while (this.held.has(id) || existsSync(join(this.workspacesDir, `${id}.json`))) id = newId();
    const at = new Date(this.now()).toISOString();
    const grant = initialGrant(this.identity);
    const held = this.add({
      id,
      owner,
      share: "private",
      grant,
      createdAt: at,
      lastActiveAt: at,
      revision: 0,
      workspace: this.seed(grant),
    });
    this.write(held);
    return held.entry;
  }

  /**
   * The atomic pick for "/" (M4): the owner's latest workspace without a live client and without a
   * claim younger than REUSE_CLAIM_MS, claimed now; else a new one. One synchronous step, so two
   * requests never get the same entry. Throws WorkspaceLimitError.
   */
  reuseOf(owner: string): { entry: WorkspaceEntry; reused: boolean } {
    const at = this.now();
    for (const entry of this.listOf(owner)) {
      const held = this.held.get(entry.record.id);
      if (!held || hasClients(entry)) continue;
      if (held.claimedAt !== undefined && at - held.claimedAt < REUSE_CLAIM_MS) continue;
      held.claimedAt = at;
      return { entry, reused: true };
    }
    const entry = this.create(owner);
    const held = this.held.get(entry.record.id);
    if (held) held.claimedAt = at;
    return { entry, reused: false };
  }

  /** The user's own workspace with the latest lastActiveAt, else a new one (M4). */
  defaultOf(user: string): WorkspaceEntry {
    return this.listOf(user)[0] ?? this.create(user);
  }

  /** Own workspaces, latest lastActiveAt first. */
  listOf(user: string): WorkspaceEntry[] {
    return [...this.held.values()]
      .filter((h) => h.entry.record.owner === user)
      .sort(
        (a, b) =>
          Date.parse(b.entry.record.lastActiveAt) - Date.parse(a.entry.record.lastActiveAt) ||
          b.seq - a.seq,
      )
      .map((h) => h.entry);
  }

  /**
   * Gives a new workspace its content from a catalog (add-case-open K9 steps 4–5): writes the
   * catalog file `<id>.cases.json` once, atomically, then replaces the workspace's content with
   * `workspace` as the next revision (it has no live client yet). Returns the entry, whose store is
   * new; undefined for an unknown ID. A failed write throws and leaves the workspace unchanged.
   */
  openCase(id: string, workspace: Workspace, catalog: CaseCatalog): WorkspaceEntry | undefined {
    const held = this.held.get(id);
    if (!held) return undefined;
    writeAtomic(this.catalogPath(id), catalogFileText(catalog));
    held.file.cancel();
    held.unsubscribe();
    const { record, store } = held.entry;
    // The record stays the one object the routes hold.
    const next = this.add({ ...record, revision: store.revision + 1, workspace }, record);
    next.seq = held.seq;
    next.catalog = catalog;
    this.write(next);
    return next.entry;
  }

  /** The open catalog of a workspace (add-case-open K6); undefined without one. */
  caseOf(id: string): CaseCatalog | undefined {
    return this.held.get(id)?.catalog;
  }

  /** The effective grant of the stored one (M3); GRANT_NONE for an unknown ID. */
  grantOf(id: string): Grant {
    const held = this.held.get(id);
    return held ? effectiveGrant(held.entry.record.grant, this.identity) : GRANT_NONE;
  }

  /**
   * The only code that widens a grant (M3). Adds `dataRefs` (each matching DataRef) to the
   * workspace's grant: unique, existing order kept, new ones appended. A stored "all" is a no-op
   * with identity none; with any other identity it counts as empty (effectiveGrant) and is replaced
   * by the given refs, so a workspace carried over from local use can be widened. Writes the file
   * (debounced) and fires onChange {type: "grant"}, so open live clients get a new `summary`.
   * Throws GrantLimitError (grant unchanged) above MAX_GRANT_OBJECTS; returns undefined for an
   * unknown ID. Never reachable from a client payload: no route, command or view sets a grant.
   */
  grantObjects(workspaceId: string, dataRefs: readonly string[]): WorkspaceEntry | undefined {
    const held = this.held.get(workspaceId);
    if (!held) return undefined;
    const { record } = held.entry;
    const stored = record.grant.objects;
    if (stored === "all" && this.identity === "none") return held.entry;
    const objects = stored === "all" ? [] : stored;
    for (const ref of dataRefs)
      if (!DataRef.safeParse(ref).success)
        throw new TypeError(`grantObjects: not a data ref: ${JSON.stringify(ref)}`);
    const next = [...objects];
    const present = new Set(objects);
    for (const ref of dataRefs)
      if (!present.has(ref)) {
        present.add(ref);
        next.push(ref);
      }
    if (next.length === objects.length) return held.entry;
    if (next.length > MAX_GRANT_OBJECTS) throw new GrantLimitError(workspaceId, next.length);
    record.grant = { objects: next };
    this.write(held);
    this.emit({ type: "grant", entry: held.entry, scopeChanged: false });
    return held.entry;
  }

  setShare(id: string, share: WorkspaceShare): WorkspaceEntry {
    const held = this.require(id);
    held.entry.record.share = share;
    this.write(held);
    this.emit({ type: "share", entry: held.entry, scopeChanged: false });
    return held.entry;
  }

  /** Removes the workspace and its file; false when there is none. */
  delete(id: string): boolean {
    const held = this.held.get(id);
    if (!held) return false;
    held.file.cancel();
    held.unsubscribe();
    this.held.delete(id);
    for (const path of [held.file.path, this.catalogPath(id)]) {
      try {
        rmSync(path, { force: true });
      } catch (error) {
        this.log.warn(`workspace file ${path} not removed: ${String(error)}`);
      }
    }
    this.emit({ type: "delete", entry: held.entry, scopeChanged: false });
    return true;
  }

  /** On a live connect: lastActiveAt = now, the reuse claim cleared, debounced write. */
  touch(id: string): void {
    const held = this.held.get(id);
    if (!held) return;
    held.claimedAt = undefined;
    this.activate(held);
    this.write(held);
  }

  /** Workspaces with at least one live client. */
  open(): WorkspaceEntry[] {
    return [...this.held.values()].map((h) => h.entry).filter(hasClients);
  }

  /** Fires after a share change, a grant change, a delete, or any accepted command. */
  onChange(listener: (event: WorkspaceChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  flush(): void {
    for (const held of this.held.values()) held.file.flush();
  }

  /** Deletes workspaces idle longer than the idle days that have no live client; the count. */
  cleanup(): number {
    const before = this.now() - this.idleMs;
    const idle = [...this.held.values()]
      .map((h) => h.entry)
      .filter((e) => Date.parse(e.record.lastActiveAt) < before && !hasClients(e));
    for (const entry of idle) this.delete(entry.record.id);
    if (idle.length > 0)
      this.log.info(
        `deleted ${idle.length} workspaces idle for more than ${this.idleMs / DAY_MS} days`,
      );
    return idle.length;
  }

  /** Timers off (tests, close); pending writes are written first. */
  stop(): void {
    if (this.cleanupTimer !== undefined) clearInterval(this.cleanupTimer);
    this.cleanupTimer = undefined;
    this.flush();
  }

  private require(id: string): Held {
    const held = this.held.get(id);
    if (!held) throw new Error(`no workspace ${id}`);
    return held;
  }

  private catalogPath(id: string): string {
    return join(this.workspacesDir, `${id}${CATALOG_SUFFIX}`);
  }

  /**
   * A workspace read at start; one with a case gets its catalog file (add-case-open K9 step 5). A
   * missing or bad catalog file drops `workspace.case` with one warning; windows and scope stay.
   */
  private restore(file: WorkspaceFile): void {
    const { workspace } = file;
    if (!workspace.case) {
      this.add(file);
      return;
    }
    const path = this.catalogPath(file.id);
    let reason: string | undefined;
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(path, "utf8"));
      reason = catalogFileError(json, workspace.case.catalogId, workspace.case.count);
    } catch (error) {
      reason =
        error instanceof SyntaxError
          ? `not JSON: ${error.message}`
          : `not readable: ${String(error)}`;
    }
    if (reason === undefined) {
      const held = this.add(file);
      held.catalog = (json as { catalog: CaseCatalog }).catalog;
      return;
    }
    this.log.warn(
      `catalog file ${path} not restored (${reason}); workspace ${file.id} has no catalog`,
    );
    const { case: _dropped, ...rest } = workspace;
    const held = this.add({ ...file, workspace: rest });
    this.write(held);
  }

  /** Holds a workspace; `record` (default: one from the file's fields) becomes the entry's. */
  private add(file: WorkspaceFile, record?: WorkspaceRecord): Held {
    const { id, owner, share, grant, createdAt, lastActiveAt, revision, workspace } = file;
    // Commands always bring their own context (the request's signal list); this one knows no signal.
    const store = new WorkspaceStore(catalogContext(undefined), {
      initial: { revision, workspace },
      onListenerError: (error) =>
        this.log.warn(`workspace ${id}: listener failed: ${String(error)}`),
    });
    const entry: WorkspaceEntry = {
      record: record ?? { id, owner, share, grant, createdAt, lastActiveAt },
      store,
    };
    const held: Held = {
      entry,
      file: new DebouncedFile(join(this.workspacesDir, `${id}.json`), {
        warn: (m) => this.log.warn(m),
      }),
      scope: scopeOf(workspace),
      seq: ++this.seq,
      claimedAt: undefined,
      unsubscribe: () => {},
    };
    held.unsubscribe = store.subscribe((_revision, state) => {
      const scope = scopeOf(state);
      const scopeChanged = scope !== held.scope;
      held.scope = scope;
      this.activate(held);
      this.write(held);
      this.emit({ type: "command", entry, scopeChanged });
    });
    this.held.set(id, held);
    return held;
  }

  private activate(held: Held): void {
    held.entry.record.lastActiveAt = new Date(this.now()).toISOString();
    held.seq = ++this.seq;
  }

  private write(held: Held): void {
    const { entry } = held;
    held.file.schedule(() =>
      workspaceFileText({
        ...entry.record,
        revision: entry.store.revision,
        workspace: entry.store.workspace,
      }),
    );
  }

  private emit(event: WorkspaceChange): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.log.warn(`workspace ${event.entry.record.id}: listener failed: ${String(error)}`);
      }
    }
  }

  /**
   * Once, before reading `workspaces/` (add-multiuser M4), in this order, one info line per step:
   * 1. the folder of round 1 (LEGACY_SESSIONS_DIR) becomes `workspaces/`;
   * 2. the single workspace of `<dir>/workspace.json` becomes a private workspace of `local` with
   *    grant "all";
   * 3. `<dir>/views/` becomes `<dir>/users/local/views/`.
   */
  private migrate(): void {
    const legacyDir = join(this.dir, LEGACY_SESSIONS_DIR);
    if (existsSync(legacyDir) && !existsSync(this.workspacesDir)) {
      renameSync(legacyDir, this.workspacesDir);
      this.log.info(`folder ${legacyDir} renamed to ${this.workspacesDir}`); // LEGACY_SESSIONS_DIR
    }
    const stateFile = join(this.dir, STATE_FILE);
    if (existsSync(stateFile) && !existsSync(this.workspacesDir)) {
      // An unreadable file is moved to workspace.bad.json, as before.
      const restored = loadState(stateFile, (m) => this.log.warn(m));
      if (restored) {
        const at = new Date(this.now()).toISOString();
        const id = newId();
        const file: WorkspaceFile = {
          id,
          owner: LOCAL_USER,
          share: "private",
          grant: GRANT_ALL,
          createdAt: at,
          lastActiveAt: at,
          revision: restored.revision,
          workspace: restored.workspace,
        };
        writeAtomic(join(this.workspacesDir, `${id}.json`), workspaceFileText(file));
        const migrated = join(this.dir, "workspace.migrated.json");
        renameSync(stateFile, migrated);
        this.log.info(
          `workspace ${stateFile} (revision ${restored.revision}) migrated to workspace ${id} of ${LOCAL_USER}; old file kept as ${migrated}`,
        );
      }
    }
    const views = join(this.dir, "views");
    const userViews = join(this.dir, "users", LOCAL_USER, "views");
    if (existsSync(views) && !existsSync(userViews)) {
      mkdirSync(join(this.dir, "users", LOCAL_USER), { recursive: true });
      renameSync(views, userViews);
      this.log.info(`views ${views} moved to ${userViews}`);
    }
  }
}

/** What the routes use of the registry (add-multiuser M4). */
export type Workspaces = Pick<
  WorkspaceRegistry,
  | "get"
  | "create"
  | "grantObjects"
  | "openCase"
  | "caseOf"
  | "reuseOf"
  | "defaultOf"
  | "listOf"
  | "grantOf"
  | "setShare"
  | "delete"
  | "touch"
  | "open"
  | "onChange"
> & {
  /** Commands without a scope use the store's own context (`singleWorkspace`, tests). */
  readonly ownContext?: true;
};

/**
 * One workspace store as the only workspace, owned by `local` with grant "all" and never written
 * (tests that build the app around a single `WorkspaceStore`). It counts as open with or without
 * a live client, as the one workspace did; it cannot be deleted, and no workspace can be created.
 */
export function singleWorkspace(store: WorkspaceStore, id = "0000000000"): Workspaces {
  const at = new Date().toISOString();
  const entry: WorkspaceEntry = {
    record: {
      id,
      owner: LOCAL_USER,
      share: "private",
      grant: GRANT_ALL,
      createdAt: at,
      lastActiveAt: at,
    },
    store,
  };
  const listeners = new Set<(event: WorkspaceChange) => void>();
  let scope = scopeOf(store.workspace);
  const emit = (event: WorkspaceChange) => {
    for (const listener of listeners) listener(event);
  };
  store.subscribe((_revision, state) => {
    const next = scopeOf(state);
    const scopeChanged = next !== scope;
    scope = next;
    entry.record.lastActiveAt = new Date().toISOString();
    emit({ type: "command", entry, scopeChanged });
  });
  return {
    ownContext: true,
    get: (wanted) => (wanted === id ? entry : undefined),
    create: (owner) => {
      throw new WorkspaceLimitError(owner, 1);
    },
    reuseOf: () => ({ entry, reused: true }),
    defaultOf: () => entry,
    listOf: (user) => (user === LOCAL_USER ? [entry] : []),
    grantOf: () => GRANT_ALL,
    grantObjects: (wanted) => (wanted === id ? entry : undefined),
    // No workspace can be created, so none is opened from a catalog.
    openCase: () => undefined,
    caseOf: () => undefined,
    setShare(_id, share) {
      entry.record.share = share;
      emit({ type: "share", entry, scopeChanged: false });
      return entry;
    },
    delete: () => false,
    touch() {
      entry.record.lastActiveAt = new Date().toISOString();
    },
    open: () => [entry],
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const hasClients = (entry: WorkspaceEntry) => entry.store.renderStatus().clients.length > 0;
const scopeOf = (workspace: Workspace) => workspace.scope && scopeKey(workspace.scope);

/**
 * A new workspace's content for `grant` (add-multiuser M4): `seed` minus the events-line signals
 * whose data ref the grant does not cover (on a server: all of them).
 */
export function seedFor(seed: Workspace, grant: Grant): Workspace {
  if (!seed.eventSignals) return seed;
  const eventSignals = seed.eventSignals.filter((id) => {
    const ref = parseSignalId(id)?.dataRef;
    // A malformed ID names no data ref and reads nothing.
    return ref === undefined || covers(grant, ref);
  });
  const { eventSignals: _all, ...rest } = seed;
  return eventSignals.length > 0 ? { ...rest, eventSignals } : rest;
}

/** A workspace as the API lists it, with the requester's rights (absent: may not open it). */
export function summaryOf(
  entry: WorkspaceEntry,
  rights: WorkspaceRights | undefined,
  grant: Grant,
): WorkspaceSummary {
  const { record, store } = entry;
  const { workspace } = store;
  const summary: WorkspaceSummary = {
    id: record.id,
    owner: record.owner,
    share: record.share,
    granted: grantedOf(grant),
    createdAt: record.createdAt,
    lastActiveAt: record.lastActiveAt,
    revision: store.revision,
    windows: workspace.windows.length,
    clients: store.renderStatus().clients.length,
  };
  if (workspace.scope) summary.scope = { ...workspace.scope };
  if (workspace.view) {
    const { name, title, modified } = workspace.view;
    summary.view = name === undefined ? { title, modified } : { name, title, modified };
  }
  if (workspace.measurement?.name !== undefined) summary.measurement = workspace.measurement.name;
  if (rights) summary.rights = { ...rights };
  return summary;
}
