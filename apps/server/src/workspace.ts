import {
  type ApplyContext,
  applyCommand,
  type ClientRenderStatus,
  Command,
  type CommandResult,
  type CommandType,
  EMPTY_WORKSPACE,
  type Measurement,
  type RenderedMessage,
  type RenderStatus,
  type Workspace,
} from "@kipscope/shared";

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
  /** Gets the workspace an accepted `view.open` is about to replace (saved-views V5). */
  beforeOpen?(previous: Workspace): void;
}

/**
 * The one open workspace (spec workspace-state), held in memory. Changes only through commands;
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

  /** Validates and applies one command. A rejected command changes nothing. */
  execute(input: unknown): CommandResult {
    const parsed = Command.safeParse(input);
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((i) => `${i.path.join(".") || "command"}: ${i.message}`)
        .join("; ");
      return { ok: false, code: "invalid_command", message };
    }
    const result = applyCommand(this.state, parsed.data, this.ctx);
    if (!result.ok) return result;
    if (parsed.data.type === "view.open" && this.beforeOpen) {
      // A failing hook (e.g. the `_previous` write) never fails the open.
      try {
        this.beforeOpen(this.state);
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
    return answer;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  connect(): string {
    const clientId = `c${this.nextClient++}`;
    this.clients.set(clientId, { clientId, connectedAt: new Date().toISOString() });
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
