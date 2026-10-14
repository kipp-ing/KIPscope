import {
  type ApplyContext,
  applyCommand,
  type ClientRenderStatus,
  Command,
  type CommandResult,
  EMPTY_WORKSPACE,
  type RenderedMessage,
  type RenderStatus,
  type Workspace,
} from "@letsview/shared";

type Listener = (revision: number, workspace: Workspace) => void;

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

  constructor(ctx: ApplyContext) {
    this.ctx = ctx;
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
    this.state = result.workspace;
    this.rev++;
    for (const listener of this.listeners) listener(this.rev, this.state);
    return result.created === undefined
      ? { ok: true, revision: this.rev }
      : { ok: true, revision: this.rev, created: result.created };
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
