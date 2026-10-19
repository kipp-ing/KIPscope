import {
  CLOSE_NO_ACCESS,
  CLOSE_SESSION_GONE,
  Command,
  type CommandResult,
  type LiveServerMessage,
  parseViewDoc,
  RenderedMessage,
  type SessionRights,
  viewScope,
  type Workspace,
  type WorkspaceScope,
} from "@kipscope/shared";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { AppDeps } from "../app.ts";
import { keepCatalogLoaded } from "../catalog.ts";
import { DEFAULT_SCOPE_PAD } from "../config.ts";
import type { Access } from "../guard.ts";
import { catalogsOf, commandStatus, sessionOf, userOf } from "../http.ts";
import { catalogView, dataRefsOfCommand, sessionRights } from "../rights.ts";
import { type Session, summaryOf } from "../sessions.ts";
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

/** Options of `runCommand` (add-multiuser M4, M9). */
export interface RunOptions {
  /** The session to run in; default the request's (`sessionOf(reply.request)`). */
  session?: Session;
  /** Gets the workspace an accepted `view.open` replaces (the requester's `_previous`). */
  beforeOpen?: (previous: Workspace) => void;
}

/**
 * Executes one command the way POST /api/commands does (add-scope Z10) in the request's session
 * and sets the reply's status. Signal lookups see only what the requester may see
 * (add-multiuser M6). A command that changes the scope first loads the target scope's signal list
 * and is checked against it; when that load fails it answers 503 `catalog_unavailable` and changes
 * nothing. Other commands are checked against the list of the workspace's scope as it stands,
 * without waiting for it; without a scope, as before against the full catalog. In scoped mode every context has `scopeRequired`.
 * Scope-changing commands apply in the order they were accepted: the last accepted wins.
 */
export async function runCommand(
  deps: AppDeps,
  input: unknown,
  reply: FastifyReply,
  options: RunOptions = {},
): Promise<CommandAnswer> {
  const workspace = (options.session ?? sessionOf(reply.request)).store;
  const { rights } = userOf(reply.request);
  const { beforeOpen } = options;
  const catalogs = catalogsOf(deps);
  const scoped = catalogs.mode === "scoped";
  const context = (catalog: Parameters<typeof catalogView>[0] | undefined, required = scoped) =>
    catalogContext(catalog && catalogView(catalog, rights), required);
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
      return answer(workspace.execute(command, context(loaded.catalog), beforeOpen));
    });
  }
  const inCurrentScope = (): CommandAnswer => {
    const current = changes ? undefined : workspace.workspace.scope;
    if (current) {
      // Never waits for the list: while it loads or fails, every signal is unknown and the
      // command is checked as against a catalog not ready (add-scope Z10).
      return answer(workspace.execute(input, context(catalogs.get(current)), beforeOpen));
    }
    // No scope: in scoped mode refused where one is needed, else against the full catalog; a
    // store wrapped as the only session (tests) brings its own context.
    if (scoped) return answer(workspace.execute(input, context(undefined), beforeOpen));
    if (deps.sessions.ownContext === true)
      return answer(workspace.execute(input, undefined, beforeOpen));
    return answer(
      workspace.execute(input, context(catalogs.full ?? deps.catalog, false), beforeOpen),
    );
  };
  if (changes || parsed.data.type === "scope.clear")
    return inAcceptedOrder(workspace, inCurrentScope);
  return inCurrentScope();
}

/** The data refs of a command body; a body that is no command names none (it is refused as invalid). */
function commandDataRefs(request: FastifyRequest): string[] {
  const parsed = Command.safeParse(request.body);
  return parsed.success ? dataRefsOfCommand(parsed.data) : [];
}

const SESSION: { access: Access } = { access: { level: "session" } };
const CHANGE: { access: Access } = { access: { level: "change", dataRefs: commandDataRefs } };

/** Default interval of the live channel's ping; a client that misses one pong is dropped. */
export const LIVE_HEARTBEAT_MS = 30_000;

/** Options of the live channel. */
export interface LiveOptions {
  /** Ping interval in ms; default LIVE_HEARTBEAT_MS (tests use a short one). */
  liveHeartbeatMs?: number;
}

const sameRights = (a: SessionRights | undefined, b: SessionRights | undefined) =>
  a?.open === b?.open && a?.change === b?.change && a?.owner === b?.owner;

export const workspaceRoutes =
  (deps: AppDeps & LiveOptions): FastifyPluginAsync =>
  async (app) => {
    const { sessions } = deps;
    const heartbeatMs = deps.liveHeartbeatMs ?? LIVE_HEARTBEAT_MS;
    const catalogs = catalogsOf(deps);

    /** Keeps the scope's signal list loading until it has loaded once (signal-catalog H5); returns stop(). */
    const keepScopeLoaded = (scope: WorkspaceScope | undefined): (() => void) => {
      if (!scope) return () => {};
      return keepCatalogLoaded(catalogs.entry(scope), {
        loaded() {},
        failed(error, retryInMs) {
          app.log.error(
            { error: String(error), retryInMs, dataRef: scope.dataRef },
            "scope catalog not loaded; retrying",
          );
        },
      });
    };

    /** Applies one command; the endpoint the UI and the CLI share. */
    app.post("/api/commands", { config: CHANGE }, async (request, reply) => {
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

    app.get("/api/workspace", { config: SESSION }, async (request) => {
      const { store } = sessionOf(request);
      return { revision: store.revision, workspace: store.workspace };
    });

    /** Latest rendered revision per browser connected to the session. */
    app.get("/api/render-status", { config: SESSION }, async (request) =>
      sessionOf(request).store.renderStatus(),
    );

    /**
     * Pushes the session's state after each accepted command and its summary when this user's
     * rights on it change; closes with 4403 when the user can no longer open it and with 4404 when
     * it is deleted (add-multiuser M8). Receives render acknowledgements. Pings every
     * `heartbeatMs` and terminates a connection that missed the last pong, so a client gone without
     * a close (page navigation, dead TCP) leaves render status with its acknowledgement.
     */
    app.get("/api/live", { websocket: true, config: SESSION }, (socket, request) => {
      const session = sessionOf(request);
      const { identity, rights } = userOf(request);
      const user = identity.user;
      const { store } = session;
      let closed = false;
      let current = sessionRights(user, rights, session);
      const send = (message: LiveServerMessage) => {
        if (!closed && socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
      };
      const close = (code: number, reason: string) => {
        if (closed) return;
        closed = true;
        socket.close(code, reason);
      };
      const clientId = store.connect(user);
      sessions.touch(session.record.id);
      send({ type: "hello", clientId });
      send({ type: "session", session: summaryOf(session, current) });
      send({ type: "state", revision: store.revision, workspace: store.workspace });
      let stopLoading = keepScopeLoaded(store.workspace.scope);
      // The session store's own listener runs first (it subscribed when the session was added), so
      // a command that hides the session from this user closes the channel before its state is sent.
      const unsubscribe = store.subscribe((revision, state, command) =>
        send({ type: "state", revision, workspace: state, command }),
      );
      const offChange = sessions.onChange((event) => {
        if (event.session.record.id !== session.record.id) return;
        if (event.type === "delete") return close(CLOSE_SESSION_GONE, "session deleted");
        const next = sessionRights(user, rights, session);
        if (!next) return close(CLOSE_NO_ACCESS, "no access to this session");
        if (event.type === "share" || !sameRights(current, next)) {
          current = next;
          send({ type: "session", session: summaryOf(session, next) });
        }
        if (event.scopeChanged) {
          stopLoading();
          stopLoading = keepScopeLoaded(store.workspace.scope);
        }
      });

      socket.on("message", (data: Buffer) => {
        if (closed) return;
        let json: unknown;
        try {
          json = JSON.parse(data.toString());
        } catch {
          return;
        }
        const parsed = RenderedMessage.safeParse(json);
        if (parsed.success) store.rendered(clientId, parsed.data);
      });
      let alive = true;
      socket.on("pong", () => {
        alive = true;
      });
      const heartbeat = setInterval(() => {
        // Terminating emits "close", which disconnects the client.
        if (!alive) return socket.terminate();
        alive = false;
        if (socket.readyState === socket.OPEN) socket.ping();
      }, heartbeatMs);
      heartbeat.unref();
      socket.on("close", () => {
        clearInterval(heartbeat);
        closed = true;
        unsubscribe();
        offChange();
        stopLoading();
        store.disconnect(clientId);
      });
    });
  };

/** A `view.open` that carries `name`. */
function namedViewOpen(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const { type, name } = body as { type?: unknown; name?: unknown };
  return type === "view.open" && name !== undefined;
}
