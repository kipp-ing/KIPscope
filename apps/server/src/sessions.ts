import { randomInt } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  LOCAL_USER,
  MAX_SESSIONS_PER_USER,
  parseSignalId,
  type SessionRights,
  type SessionShare,
  type SessionSummary,
  scopeKey,
  type Workspace,
} from "@kipscope/shared";
import {
  DebouncedFile,
  loadSessionFile,
  loadState,
  SESSIONS_DIR,
  type SessionFile,
  STATE_FILE,
  sessionFileText,
  writeAtomic,
} from "./persist.ts";
import { canSee, type Rights } from "./rights.ts";
import { catalogContext, WorkspaceStore } from "./workspace.ts";

/** Owner, share level and times of a session (add-multiuser M4). */
export interface SessionRecord {
  /** SESSION_ID: 10 × [a-z0-9] from crypto.randomInt. */
  id: string;
  /** USER_ID */
  owner: string;
  /** "private" at create. */
  share: SessionShare;
  /** ISO */
  createdAt: string;
  /** ISO; create, live connect, accepted command. */
  lastActiveAt: string;
}

/** One workspace with its owner and share level (add-multiuser M4). */
export interface Session {
  readonly record: SessionRecord;
  readonly store: WorkspaceStore;
}

/** Every session of the user has a live client, so none can make room (409 `session_limit`). */
export class SessionLimitError extends Error {
  constructor(user: string, limit: number) {
    super(`${user} has ${limit} sessions, each with an open client; close or delete one first`);
    this.name = "SessionLimitError";
  }
}

export type SessionChange = {
  type: "share" | "delete" | "command";
  session: Session;
  scopeChanged: boolean;
};

type Log = { info(message: string): void; warn(message: string): void };

const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
const DAY_MS = 86_400_000;
const CLEANUP_EVERY_MS = 3_600_000;
const consoleLog: Log = { info: (m) => console.info(m), warn: (m) => console.warn(m) };

/** A session ID: 10 characters of [a-z0-9], each from crypto.randomInt. */
function newId(): string {
  let id = "";
  for (let i = 0; i < 10; i++) id += ID_CHARS[randomInt(ID_CHARS.length)];
  return id;
}

/** Internal state per session: its file writer, last scope, activity order. */
interface Held {
  session: Session;
  file: DebouncedFile;
  scope: string | undefined;
  /** Breaks ties of equal `lastActiveAt` (same millisecond): later activity first. */
  seq: number;
  unsubscribe: () => void;
}

/**
 * Every session of every user, in memory, each written to `<dir>/sessions/<id>.json` (add-multiuser
 * M4): 500 ms after its last change, at once on `flush()`, atomically.
 */
export class SessionStore {
  private readonly dir: string;
  private readonly sessionsDir: string;
  /** A new session's workspace before the creator's rights filter it. */
  readonly seed: () => Workspace;
  private readonly idleMs: number;
  private readonly now: () => number;
  private readonly log: Log;
  private readonly limit: number;
  private readonly held = new Map<string, Held>();
  private readonly listeners = new Set<(event: SessionChange) => void>();
  private cleanupTimer: ReturnType<typeof setInterval> | undefined;
  private seq = 0;

  constructor(options: {
    /** `<stateDir>` */
    dir: string;
    /** A new session's workspace (project measurement, events-line signals). */
    seed: () => Workspace;
    idleDays: number;
    /** Fake clocks in tests. */
    now?: () => number;
    log?: Log;
    /** Default MAX_SESSIONS_PER_USER. */
    limit?: number;
  }) {
    this.dir = options.dir;
    this.sessionsDir = join(options.dir, SESSIONS_DIR);
    this.seed = options.seed;
    this.idleMs = options.idleDays * DAY_MS;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? consoleLog;
    this.limit = options.limit ?? MAX_SESSIONS_PER_USER;
  }

  /** Runs the migration, reads every session file, starts the hourly cleanup. */
  start(): void {
    this.migrate();
    let names: string[] = [];
    try {
      names = readdirSync(this.sessionsDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        this.log.warn(`session dir ${this.sessionsDir} not readable: ${String(error)}`);
    }
    for (const name of names) {
      if (!name.endsWith(".json") || name.endsWith(".bad.json")) continue;
      const file = loadSessionFile(join(this.sessionsDir, name), (m) => this.log.warn(m));
      if (file && !this.held.has(file.id)) this.add(file);
    }
    this.cleanup();
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_EVERY_MS);
    this.cleanupTimer.unref?.();
  }

  get(id: string): Session | undefined {
    return this.held.get(id)?.session;
  }

  /**
   * A new private session of `owner` on `seed` (default: the store's seed). At the limit the
   * owner's least recently active session without a live client is deleted first; throws
   * SessionLimitError when every one has a client.
   */
  create(owner: string, seed?: Workspace): Session {
    const own = this.listOf(owner);
    if (own.length >= this.limit) {
      const evict = own.reverse().find((s) => !hasClients(s));
      if (!evict) throw new SessionLimitError(owner, this.limit);
      this.delete(evict.record.id);
    }
    let id = newId();
    while (this.held.has(id) || existsSync(join(this.sessionsDir, `${id}.json`))) id = newId();
    const at = new Date(this.now()).toISOString();
    const held = this.add({
      id,
      owner,
      share: "private",
      createdAt: at,
      lastActiveAt: at,
      revision: 0,
      workspace: seed ?? this.seed(),
    });
    this.write(held);
    return held.session;
  }

  /** Latest own session that `canOpen` accepts, else a new one (on `seed`, if given). */
  defaultOf(user: string, canOpen: (session: Session) => boolean, seed?: Workspace): Session {
    return this.listOf(user).find(canOpen) ?? this.create(user, seed);
  }

  /** Own sessions, latest lastActiveAt first. */
  listOf(user: string): Session[] {
    return [...this.held.values()]
      .filter((h) => h.session.record.owner === user)
      .sort(
        (a, b) =>
          Date.parse(b.session.record.lastActiveAt) - Date.parse(a.session.record.lastActiveAt) ||
          b.seq - a.seq,
      )
      .map((h) => h.session);
  }

  setShare(id: string, share: SessionShare): Session {
    const held = this.require(id);
    held.session.record.share = share;
    this.write(held);
    this.emit({ type: "share", session: held.session, scopeChanged: false });
    return held.session;
  }

  /** Removes the session and its file; false when there is none. */
  delete(id: string): boolean {
    const held = this.held.get(id);
    if (!held) return false;
    held.file.cancel();
    held.unsubscribe();
    this.held.delete(id);
    try {
      rmSync(held.file.path, { force: true });
    } catch (error) {
      this.log.warn(`session file ${held.file.path} not removed: ${String(error)}`);
    }
    this.emit({ type: "delete", session: held.session, scopeChanged: false });
    return true;
  }

  /** lastActiveAt = now, debounced write. */
  touch(id: string): void {
    const held = this.held.get(id);
    if (!held) return;
    this.activate(held);
    this.write(held);
  }

  /** Sessions with at least one live client. */
  open(): Session[] {
    return [...this.held.values()].map((h) => h.session).filter(hasClients);
  }

  /** Fires after a share change, a delete, or any accepted command. */
  onChange(listener: (event: SessionChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  flush(): void {
    for (const held of this.held.values()) held.file.flush();
  }

  /** Deletes sessions idle longer than the idle days that have no live client; the count. */
  cleanup(): number {
    const before = this.now() - this.idleMs;
    const idle = [...this.held.values()]
      .map((h) => h.session)
      .filter((s) => Date.parse(s.record.lastActiveAt) < before && !hasClients(s));
    for (const session of idle) this.delete(session.record.id);
    if (idle.length > 0)
      this.log.info(
        `deleted ${idle.length} sessions idle for more than ${this.idleMs / DAY_MS} days`,
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
    if (!held) throw new Error(`no session ${id}`);
    return held;
  }

  private add(file: SessionFile): Held {
    const { id, owner, share, createdAt, lastActiveAt, revision, workspace } = file;
    // Commands always bring their own context (the request's signal list); this one knows no signal.
    const store = new WorkspaceStore(catalogContext(undefined), {
      initial: { revision, workspace },
      onListenerError: (error) => this.log.warn(`session ${id}: listener failed: ${String(error)}`),
    });
    const session: Session = { record: { id, owner, share, createdAt, lastActiveAt }, store };
    const held: Held = {
      session,
      file: new DebouncedFile(join(this.sessionsDir, `${id}.json`), {
        warn: (m) => this.log.warn(m),
      }),
      scope: scopeOf(workspace),
      seq: ++this.seq,
      unsubscribe: () => {},
    };
    held.unsubscribe = store.subscribe((_revision, state) => {
      const scope = scopeOf(state);
      const scopeChanged = scope !== held.scope;
      held.scope = scope;
      this.activate(held);
      this.write(held);
      this.emit({ type: "command", session, scopeChanged });
    });
    this.held.set(id, held);
    return held;
  }

  private activate(held: Held): void {
    held.session.record.lastActiveAt = new Date(this.now()).toISOString();
    held.seq = ++this.seq;
  }

  private write(held: Held): void {
    const { session } = held;
    held.file.schedule(() =>
      sessionFileText({
        ...session.record,
        revision: session.store.revision,
        workspace: session.store.workspace,
      }),
    );
  }

  private emit(event: SessionChange): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.log.warn(`session ${event.session.record.id}: listener failed: ${String(error)}`);
      }
    }
  }

  /**
   * Once, before reading `sessions/` (add-multiuser M4): the single workspace of
   * `<dir>/workspace.json` becomes a private session of `local`, and `<dir>/views/` becomes
   * `<dir>/users/local/views/`.
   */
  private migrate(): void {
    const stateFile = join(this.dir, STATE_FILE);
    if (existsSync(stateFile) && !existsSync(this.sessionsDir)) {
      // An unreadable file is moved to workspace.bad.json, as before.
      const restored = loadState(stateFile, (m) => this.log.warn(m));
      if (restored) {
        const at = new Date(this.now()).toISOString();
        const id = newId();
        const file: SessionFile = {
          id,
          owner: LOCAL_USER,
          share: "private",
          createdAt: at,
          lastActiveAt: at,
          revision: restored.revision,
          workspace: restored.workspace,
        };
        writeAtomic(join(this.sessionsDir, `${id}.json`), sessionFileText(file));
        const migrated = join(this.dir, "workspace.migrated.json");
        renameSync(stateFile, migrated);
        this.log.info(
          `workspace ${stateFile} (revision ${restored.revision}) migrated to session ${id} of ${LOCAL_USER}; old file kept as ${migrated}`,
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

/** What the routes use of the session store (add-multiuser M4). */
export type Sessions = Pick<
  SessionStore,
  | "seed"
  | "get"
  | "create"
  | "defaultOf"
  | "listOf"
  | "setShare"
  | "delete"
  | "touch"
  | "open"
  | "onChange"
> & {
  /** Commands without a scope use the store's own context (`singleSession`). */
  readonly ownContext?: true;
};

/**
 * One workspace store as the only session, owned by `local` and never written (tests that build the
 * app around a single `WorkspaceStore`). It counts as open with or without a live client, as the
 * one workspace did; it cannot be deleted, and no session can be created.
 */
export function singleSession(store: WorkspaceStore, id = "0000000000"): Sessions {
  const at = new Date().toISOString();
  const session: Session = {
    record: { id, owner: LOCAL_USER, share: "private", createdAt: at, lastActiveAt: at },
    store,
  };
  const listeners = new Set<(event: SessionChange) => void>();
  let scope = scopeOf(store.workspace);
  const emit = (event: SessionChange) => {
    for (const listener of listeners) listener(event);
  };
  store.subscribe((_revision, state) => {
    const next = scopeOf(state);
    const scopeChanged = next !== scope;
    scope = next;
    session.record.lastActiveAt = new Date().toISOString();
    emit({ type: "command", session, scopeChanged });
  });
  return {
    ownContext: true,
    seed: () => store.workspace,
    get: (wanted) => (wanted === id ? session : undefined),
    create: (owner) => {
      throw new SessionLimitError(owner, 1);
    },
    defaultOf: () => session,
    listOf: (user) => (user === LOCAL_USER ? [session] : []),
    setShare(_id, share) {
      session.record.share = share;
      emit({ type: "share", session, scopeChanged: false });
      return session;
    },
    delete: () => false,
    touch() {
      session.record.lastActiveAt = new Date().toISOString();
    },
    open: () => [session],
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const hasClients = (session: Session) => session.store.renderStatus().clients.length > 0;
const scopeOf = (workspace: Workspace) => workspace.scope && scopeKey(workspace.scope);

/**
 * A new session's workspace for a creator with `rights` (add-multiuser M4): `seed` minus the
 * events-line signals of data refs they may not see.
 */
export function seedFor(seed: Workspace, rights: Rights): Workspace {
  if (!seed.eventSignals) return seed;
  const eventSignals = seed.eventSignals.filter((id) => {
    const ref = parseSignalId(id)?.dataRef;
    // A malformed ID names no data ref, as in dataRefsOfWorkspace.
    return ref === undefined || canSee(rights, ref);
  });
  const { eventSignals: _all, ...rest } = seed;
  return eventSignals.length > 0 ? { ...rest, eventSignals } : rest;
}

/** A session as the API lists it, with the requester's rights (absent: may not open it). */
export function summaryOf(session: Session, rights: SessionRights | undefined): SessionSummary {
  const { record, store } = session;
  const { workspace } = store;
  const summary: SessionSummary = {
    id: record.id,
    owner: record.owner,
    share: record.share,
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
