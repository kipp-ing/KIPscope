import {
  Command,
  type CommandResult,
  type LiveServerMessage,
  parseViewDoc,
  RenderedMessage,
  viewScope,
  type WorkspaceScope,
} from "@kipscope/shared";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import type { AppDeps } from "../app.ts";
import { DEFAULT_SCOPE_PAD } from "../config.ts";
import { catalogsOf, commandStatus } from "../http.ts";
import { catalogContext } from "../workspace.ts";

/** A command result, or the 503 of a scope whose signal list did not load (add-scope Z10). */
export type CommandAnswer =
  | CommandResult
  | (Extract<CommandResult, { ok: false }> & { reason: string });

/**
 * The scope a scope-changing command leaves in effect (add-scope Z10): `scope.set`'s own; for
 * `view.open` its `scope`, else the view's (`viewScope` with the pad). `changes` is false for
 * every other command.
 */
function targetScope(command: Command, pad: bigint): { changes: boolean; target?: WorkspaceScope } {
  if (command.type === "scope.set") {
    const { dataRef, from, to } = command;
    return { changes: true, target: { dataRef, from, to } };
  }
  if (command.type !== "view.open") return { changes: false };
  if (command.scope) return { changes: true, target: command.scope };
  // A document that does not parse is refused by the command itself.
  const parsed = parseViewDoc(command.view);
  const target = parsed.ok ? viewScope(parsed.doc, pad) : undefined;
  return target ? { changes: true, target } : { changes: true };
}

/** Settles once the last accepted scope-changing command is applied or refused, per workspace store. */
const scopeChains = new WeakMap<object, Promise<void>>();

/**
 * Runs `apply` after every scope-changing command (`scope.set`, `scope.clear`, `view.open`)
 * accepted before on the same store, so they change the workspace in the order they were accepted
 * even when an older one's list loads longer (add-scope Z10).
 */
function inAcceptedOrder<T>(store: object, apply: () => T | Promise<T>): Promise<T> {
  const result = (scopeChains.get(store) ?? Promise.resolve()).then(apply);
  scopeChains.set(
    store,
    result.then(
      () => {},
      () => {},
    ),
  );
  return result;
}

/**
 * Executes one command the way POST /api/commands does (add-scope Z10) and sets the reply's
 * status. A command that changes the scope first loads the target scope's signal list and is
 * checked against it; when that load fails it answers 503 `catalog_unavailable` and changes
 * nothing. Other commands are checked against the list of the workspace's scope as it stands,
 * without waiting for it; without a scope, as before against the full catalog. In scoped mode every context has `scopeRequired`.
 * Scope-changing commands apply in the order they were accepted: the last accepted wins.
 */
export async function runCommand(
  deps: AppDeps,
  input: unknown,
  reply: FastifyReply,
): Promise<CommandAnswer> {
  const { workspace } = deps;
  const catalogs = catalogsOf(deps);
  const scoped = catalogs.mode === "scoped";
  const answer = (result: CommandAnswer) => {
    reply.code(commandStatus(result));
    return result;
  };
  const parsed = Command.safeParse(input);
  // The store answers invalid_command itself.
  if (!parsed.success) return answer(workspace.execute(input));
  const { changes, target } = targetScope(parsed.data, deps.scopePad ?? DEFAULT_SCOPE_PAD);
  if (changes && target) {
    // The list starts loading at once; only applying waits for older scope changes.
    const loading = catalogs.load(target).then(
      (catalog) => ({ catalog }),
      (error: unknown) => ({ error }),
    );
    return inAcceptedOrder(workspace, async () => {
      const loaded = await loading;
      if ("error" in loaded) {
        const { error } = loaded;
        const message = error instanceof Error ? error.message : String(error);
        return answer({
          ok: false,
          code: "catalog_unavailable",
          message: `signal list of the scope not loaded: ${message}`,
          reason: catalogs.get(target)?.unavailableReason ?? message,
        });
      }
      const command =
        parsed.data.type === "view.open" ? { ...(input as object), scope: target } : input;
      return answer(workspace.execute(command, catalogContext(loaded.catalog, scoped)));
    });
  }
  const inCurrentScope = (): CommandAnswer => {
    const current = changes ? undefined : workspace.workspace.scope;
    if (current) {
      // Never waits for the list: while it loads or fails, every signal is unknown and the
      // command is checked as against a catalog not ready (add-scope Z10).
      const catalog = catalogs.get(current);
      return answer(workspace.execute(input, catalogContext(catalog, scoped)));
    }
    // No scope: in scoped mode refused where one is needed, else today's path.
    if (scoped) return answer(workspace.execute(input, catalogContext(undefined, true)));
    return answer(workspace.execute(input));
  };
  if (changes || parsed.data.type === "scope.clear")
    return inAcceptedOrder(workspace, inCurrentScope);
  return inCurrentScope();
}

export const workspaceRoutes =
  (deps: AppDeps): FastifyPluginAsync =>
  async (app) => {
    const { workspace } = deps;
    /** Applies one command; the endpoint the UI and the CLI share. */
    app.post("/api/commands", async (request, reply) => {
      // Only the view routes name the open view, so a save in place writes its own file (V2 round 2).
      if (namedViewOpen(request.body)) {
        const refused: CommandResult = {
          ok: false,
          code: "invalid_command",
          message: "open a saved view through POST /api/views/open",
        };
        return reply.code(400).send(refused);
      }
      return runCommand(deps, request.body, reply);
    });

    app.get("/api/workspace", async () => ({
      revision: workspace.revision,
      workspace: workspace.workspace,
    }));

    /** Latest rendered revision per connected browser. */
    app.get("/api/render-status", async () => workspace.renderStatus());

    /** Pushes the state after each accepted command; receives render acknowledgements. */
    app.get("/api/live", { websocket: true }, (socket) => {
      const clientId = workspace.connect();
      const send = (message: LiveServerMessage) => socket.send(JSON.stringify(message));
      send({ type: "hello", clientId });
      send({ type: "state", revision: workspace.revision, workspace: workspace.workspace });
      const unsubscribe = workspace.subscribe((revision, state, command) =>
        send({ type: "state", revision, workspace: state, command }),
      );

      socket.on("message", (data: Buffer) => {
        let json: unknown;
        try {
          json = JSON.parse(data.toString());
        } catch {
          return;
        }
        const parsed = RenderedMessage.safeParse(json);
        if (parsed.success) workspace.rendered(clientId, parsed.data);
      });
      socket.on("close", () => {
        unsubscribe();
        workspace.disconnect(clientId);
      });
    });
  };

/** A `view.open` that carries `name`. */
function namedViewOpen(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const { type, name } = body as { type?: unknown; name?: unknown };
  return type === "view.open" && name !== undefined;
}
