import {
  type ApplyContext,
  applyCommand,
  type ClientRenderStatus,
  Command,
  type CommandResult,
  type CommandType,
  EMPTY_WORKSPACE,
  LOCAL_USER,
  type Measurement,
  type RenderedMessage,
  type RenderStatus,
  type Workspace,
} from "@kipscope/shared";
import type { Catalog } from "./catalog.ts";

/**
 * Apply context of a signal list (add-scope Z10): the scope's list, the full catalog, or none
 * (every signal unknown, not ready). `scopeRequired` in scoped mode. With a loaded list that can
 * list its entries, `inputInfo` finds a computed signal's input by name: the first entry with that
 * name (add-computed-signals C7); without one, inputs go unchecked.
 */
export function catalogContext(
  catalog: (Pick<Catalog, "get" | "loadedAt"> & Partial<Pick<Catalog, "all">>) | undefined,
  scopeRequired = false,
): ApplyContext {
  const ctx: ApplyContext = {
    signalExists: (id) => catalog?.get(id) !== undefined,
    unitOf: (id) => catalog?.get(id)?.unit,
    hasStates: (id) => catalog?.get(id)?.states !== undefined,
    catalogReady: () => catalog?.loadedAt !== undefined,
  };
  if (scopeRequired) ctx.scopeRequired = true;
  const all = catalog?.all?.bind(catalog);
  if (all && catalog?.loadedAt !== undefined) {
    ctx.inputInfo = (name) => {
      const info = all().find((s) => s.name === name);
      return info && { states: info.states !== undefined };
    };
  }
  return ctx;
}

type Listener = (revision: number, workspace: Workspace, command: CommandType) => void;

export interface WorkspaceStoreOptions {
  /** Gets what a listener threw; default `console.error`. */
  onListenerError?(error: unknown): void;
  /**
   * Measurement info at the start, from the project file (design F7). Seeds only a fresh workspace:
   * with `initial` the restored measurement wins (saved-views V4, S-3 (b)).
   */
  measurement?: Measurement;
  /** Events-line signals at revision 0, from the project file (add-events E8), unchecked: a signal not in the catalog waits. */
  eventSignals?: readonly string[];
  /** Restored state file (saved-views V4): start at this revision with this workspace, unchecked. */
  initial?: { revision: number; workspace: Workspace };
  /**
   * Gets the workspace an accepted `view.open` is about to replace (saved-views V5); a hook passed
   * to `execute` replaces it for that call (add-multiuser M4).
   */
  beforeOpen?(previous: Workspace): void;
}

/**
 * One workspace (spec workspace-state, add-multiuser M4), held in memory. Changes only through commands;
 * each accepted command increases the revision by one. Browsers report what they have rendered.
 */
export class WorkspaceStore {
  private state: Workspace = EMPTY_WORKSPACE;
  private rev = 0;
  private readonly ctx: ApplyContext;
  private readonly listeners = new Set<Listener>();
  private readonly clients = new Map<string, ClientRenderStatus>();
  private nextClient = 1;
  private readonly onListenerError: (error: unknown) => void;
  private readonly beforeOpen: ((previous: Workspace) => void) | undefined;

  constructor(ctx: ApplyContext, options: WorkspaceStoreOptions = {}) {
    this.ctx = ctx;
    this.onListenerError = options.onListenerError ?? ((error) => console.error(error));
    this.beforeOpen = options.beforeOpen;
    if (options.initial) {
      // Restored whole, measurement and events-line signals included; `view.modified` as stored.
      this.state = options.initial.workspace;
      this.rev = options.initial.revision;
      return;
    }
    if (options.measurement) this.state = { ...this.state, measurement: options.measurement };
    if (options.eventSignals?.length)
      this.state = { ...this.state, eventSignals: [...options.eventSignals] };
  }

  get workspace(): Workspace {
    return this.state;
  }

  get revision(): number {
    return this.rev;
  }

  /**
   * Validates and applies one command against `ctx` (default: the store's own), e.g. the signal
   * list of the scope the command leaves in effect (add-scope Z10). A rejected command changes
   * nothing. `beforeOpen` (default: the store's own) gets the workspace an accepted `view.open`
   * replaces, e.g. for the requester's `_previous` view (add-multiuser M9).
   */
  execute(
    input: unknown,
    ctx: ApplyContext = this.ctx,
    beforeOpen: ((previous: Workspace) => void) | undefined = this.beforeOpen,
  ): CommandResult {
    const parsed = Command.safeParse(input);
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((i) => `${i.path.join(".") || "command"}: ${i.message}`)
        .join("; ");
      return { ok: false, code: "invalid_command", message };
    }
    const result = applyCommand(this.state, parsed.data, ctx);
    if (!result.ok) return result;
    if (parsed.data.type === "view.open" && beforeOpen) {
      // A failing hook (e.g. the `_previous` write) never fails the open.
      try {
        beforeOpen(this.state);
      } catch (error) {
        this.onListenerError(error);
      }
    }
    this.state = result.workspace;
    this.rev++;
    // A listener that throws neither fails the accepted command nor starves later listeners.
    for (const listener of this.listeners) {
      try {
        listener(this.rev, this.state, parsed.data.type);
      } catch (error) {
        this.onListenerError(error);
      }
    }
    const answer: CommandResult = { ok: true, revision: this.rev };
    if (result.created !== undefined) answer.created = result.created;
    if (result.createdWindow !== undefined) answer.createdWindow = result.createdWindow;
    if (result.removedWindow !== undefined) answer.removedWindow = result.removedWindow;
    if (result.report !== undefined) answer.report = result.report;
    if (result.clamped) answer.clamped = true;
    if (result.missing !== undefined) answer.missing = result.missing;
    if (result.alignFallback) answer.alignFallback = true;
    return answer;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Adds a live client of `user`, listed by `renderStatus()` (add-multiuser M4). */
  connect(user: string = LOCAL_USER): string {
    const clientId = `c${this.nextClient++}`;
    this.clients.set(clientId, { clientId, user, connectedAt: new Date().toISOString() });
    return clientId;
  }

  disconnect(clientId: string): void {
    this.clients.delete(clientId);
  }

  /** Records a render acknowledgement; ignores revisions that do not exist yet. */
  rendered(clientId: string, message: RenderedMessage): boolean {
    const client = this.clients.get(clientId);
    if (!client || message.revision > this.rev) return false;
    client.rendered = {
      revision: message.revision,
      status: message.status,
      errors: message.errors ?? [],
      at: new Date().toISOString(),
    };
    return true;
  }

  renderStatus(): RenderStatus {
    return { revision: this.rev, clients: [...this.clients.values()] };
  }
}
