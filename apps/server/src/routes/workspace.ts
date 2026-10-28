import {
  type ApplyContext,
  CLOSE_NO_ACCESS,
  CLOSE_WORKSPACE_GONE,
  Command,
  type CommandResult,
  caseScope,
  type LiveServerMessage,
  objectSpan,
  parseViewDoc,
  RenderedMessage,
  viewScope,
  type Workspace,
  type WorkspaceRights,
  type WorkspaceScope,
} from "@kipscope/shared";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { AppDeps } from "../app.ts";
import { keepCatalogLoaded } from "../catalog.ts";
import { DEFAULT_SCOPE_PAD } from "../config.ts";
import type { Access } from "../guard.ts";
import { catalogsOf, commandStatus, userOf, workspaceOf } from "../http.ts";
import { catalogView, covers, dataRefsOfCommand, grantedOf, workspaceRights } from "../rights.ts";
import { TooWideError } from "../scanBound.ts";
import { linkedScopeOf, noteObjectScope } from "../scope.ts";
import { catalogContext } from "../workspace.ts";
import { summaryOf, type WorkspaceEntry } from "../workspaces.ts";
import { alignmentOf, caseEntryOf, reboundEventSignals } from "./case.ts";

/**
 * A command result, the 503 of a scope whose signal list did not load (add-scope Z10), the 422
 * `too_wide` of one the scan bound refused, or the 502 of a case pre-step whose source query
 * failed (add-case-open K9).
 */
export type CommandAnswer =
  | CommandResult
  | (Extract<CommandResult, { ok: false }> & { reason: string })
  | { ok: false; code: "source_error"; message: string };

/**
 * The scope a scope-changing command leaves in effect (add-scope Z10): `scope.set`'s own; for
 * `view.open` its `scope`, else the view's (`viewScope` with the pad); in a case workspace the
 * session's, which `view.open` keeps (add-case-open K6). `changes` is false for every other
 * command, and for `scope.set` in a case workspace, which is refused (`case_open`).
 */
function targetScope(
  command: Command,
  pad: bigint,
  workspace: Workspace,
): { changes: boolean; target?: WorkspaceScope } {
  if (workspace.case) {
    if (command.type !== "view.open" || !workspace.scope) return { changes: false };
    return { changes: true, target: workspace.scope };
  }
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

/** The command result of a scope list the scan bound refused (scope "A too-wide scope is refused"). */
export function tooWideResult(error: TooWideError): Extract<CommandResult, { ok: false }> {
  const result: Extract<CommandResult, { ok: false }> = {
    ok: false,
    code: "too_wide",
    message: error.message,
  };
  if (error.rows !== undefined) result.rows = String(error.rows);
  if (error.limit !== undefined) result.limit = String(error.limit);
  if (error.span !== undefined) result.span = String(error.span);
  if (error.maxSpan !== undefined) result.maxSpan = String(error.maxSpan);
  return result;
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
  /** The workspace to run in; default the request's (`workspaceOf(reply.request)`). */
  entry?: WorkspaceEntry;
  /** Gets the workspace an accepted `view.open` replaces (the requester's `_previous`). */
  beforeOpen?: (previous: Workspace) => void;
}

/**
 * Executes one command the way POST /api/commands does (add-scope Z10) in the request's workspace
 * and sets the reply's status. Signal lookups see only what the workspace's grant covers
 * (add-multiuser M6). A command that changes the scope first loads the target scope's signal list
 * and is checked against it; when that load fails it answers 503 `catalog_unavailable`, or 422
 * `too_wide` when the scan bound refused it, and changes nothing. Other commands are checked against the list of the workspace's scope as it stands,
 * without waiting for it; without a scope, as before against the full catalog. In scoped mode every context has `scopeRequired`.
 * Scope-changing commands apply in the order they were accepted: the last accepted wins.
 */
export async function runCommand(
  deps: AppDeps,
  input: unknown,
  reply: FastifyReply,
  options: RunOptions = {},
): Promise<CommandAnswer> {
  const entry = options.entry ?? workspaceOf(reply.request);
  const workspace = entry.store;
  const grant = deps.workspaces.grantOf(entry.record.id);
  const { beforeOpen } = options;
  const catalogs = catalogsOf(deps);
  const scoped = catalogs.mode === "scoped";
  const context = (catalog: Parameters<typeof catalogView>[0] | undefined, required = scoped) =>
    catalogContext(catalog && catalogView(catalog, grant), required);
  const answer = (result: Exclude<CommandAnswer, { code: "source_error" }>) => {
    reply.code(commandStatus(result));
    return result;
  };
  const parsed = Command.safeParse(input);
  // The store answers invalid_command itself.
  if (!parsed.success) return answer(workspace.execute(input));
  if (parsed.data.type.startsWith("case."))
    return runCaseCommand(deps, entry, parsed.data as CaseCommand, input, {
      reply,
      answer,
      context,
      grant,
    });
  const { changes, target } = targetScope(
    parsed.data,
    deps.scopePad ?? DEFAULT_SCOPE_PAD,
    workspace.workspace,
  );
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
        if (error instanceof TooWideError) return answer(tooWideResult(error));
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
    // store wrapped as the only workspace (tests) brings its own context.
    if (scoped) return answer(workspace.execute(input, context(undefined), beforeOpen));
    if (deps.workspaces.ownContext === true)
      return answer(workspace.execute(input, undefined, beforeOpen));
    return answer(
      workspace.execute(input, context(catalogs.full ?? deps.catalog, false), beforeOpen),
    );
  };
  if (changes || parsed.data.type === "scope.clear")
    return inAcceptedOrder(workspace, inCurrentScope);
  return inCurrentScope();
}

type CaseCommand = Extract<Command, { type: `case.${string}` }>;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** What `runCommand` hands the case pre-steps. */
interface CaseRun {
  reply: FastifyReply;
  answer: (result: Exclude<CommandAnswer, { code: "source_error" }>) => CommandAnswer;
  context: (catalog: Parameters<typeof catalogView>[0] | undefined) => ApplyContext;
  grant: ReturnType<AppDeps["workspaces"]["grantOf"]>;
}

/**
 * The pre-steps of the case commands (add-case-open K9) before `execute`: `case.go` and
 * `case.step` load the target session's list (503 `catalog_unavailable`, or 422 `too_wide` from
 * the scan bound, unchanged) and resolve its alignment point; `case.align` in event mode without
 * `at` resolves the point in the current session; `case.unlink` spans the catalog's sessions of
 * the vehicle (`objectSpan`, B4) with no source query and no list.
 * The target's data ref must lie in the grant (403 `forbidden_data`). Refusals that need no
 * server work (`no_case`, `case_end`, `case_unlinked`) are the store's. Case commands apply in the
 * order they were accepted, after every scope change accepted before, and read the case (target
 * of a step, scope of an unlink, session of an align) as it stands when they apply, so two quick
 * steps land on the second next entry with its own point and list.
 */
async function runCaseCommand(
  deps: AppDeps,
  entry: WorkspaceEntry,
  command: CaseCommand,
  input: unknown,
  run: CaseRun,
): Promise<CommandAnswer> {
  const { store } = entry;
  const catalogs = catalogsOf(deps);
  /** 502 `source_error`, the workspace unchanged. */
  const sourceFailed = (error: unknown): CommandAnswer => {
    run.reply.code(502);
    return { ok: false, code: "source_error", message: errorText(error) };
  };
  const entryAt = (index: number) => caseEntryOf(deps, entry, index);
  const current = () => run.context(catalogs.get(store.workspace.scope));
  const execute = (ctx: ApplyContext, extra: NonNullable<ApplyContext["case"]> | object = {}) =>
    run.answer(store.execute(input, { ...ctx, case: { entry: entryAt, ...extra } }));
  const loadList = (scope: WorkspaceScope) =>
    catalogs.load(scope).then(
      (catalog) => ({ catalog }),
      (error: unknown) => ({ error }),
    );

  if (command.type === "case.go" || command.type === "case.step") {
    const targetIndex = (c: NonNullable<Workspace["case"]>) =>
      command.type === "case.go" ? command.index : c.current + command.by;
    // The list of the target as the case stands now starts loading at once; applying uses it when
    // the target is still the same, and only applying waits for older scope changes.
    const accepted = store.workspace.case;
    const early = accepted ? targetIndex(accepted) : undefined;
    const earlyTarget = early === undefined ? undefined : entryAt(early);
    const prefetch =
      accepted && earlyTarget && covers(run.grant, earlyTarget.dataRef)
        ? loadList(caseScope(earlyTarget, BigInt(accepted.pad)))
        : undefined;
    return inAcceptedOrder(store, async () => {
      const open = store.workspace.case;
      if (!open) return execute(current());
      const index = targetIndex(open);
      const target = entryAt(index);
      if ((command.type === "case.step" && !open.linked) || !target) return execute(current());
      if (!covers(run.grant, target.dataRef))
        return run.answer({
          ok: false,
          code: "forbidden_data",
          message: `data ref ${target.dataRef} is not permitted`,
        });
      const pad = BigInt(open.pad);
      const scope = caseScope(target, pad);
      const loaded = await (index === early && prefetch ? prefetch : loadList(scope));
      if ("error" in loaded) {
        if (loaded.error instanceof TooWideError) return run.answer(tooWideResult(loaded.error));
        const message = errorText(loaded.error);
        return run.answer({
          ok: false,
          code: "catalog_unavailable",
          message: `signal list of the session not loaded: ${message}`,
          reason: catalogs.get(scope)?.unavailableReason ?? message,
        });
      }
      let point: { t: string; fallback: boolean };
      try {
        point = await alignmentOf(
          deps,
          target,
          open.align,
          pad,
          reboundEventSignals(store.workspace, target.dataRef),
        );
      } catch (error) {
        return sourceFailed(error);
      }
      return execute(run.context(loaded.catalog), {
        alignAt: point.t,
        alignFallback: point.fallback,
      });
    });
  }
  if (command.type === "case.align") {
    return inAcceptedOrder(store, async () => {
      const open = store.workspace.case;
      if (!open?.linked || command.at !== undefined || command.align.mode !== "event")
        return execute(current());
      let point: { t: string; fallback: boolean };
      try {
        point = await alignmentOf(
          deps,
          open.entry,
          command.align,
          BigInt(open.pad),
          reboundEventSignals(store.workspace, open.entry.dataRef),
        );
      } catch (error) {
        return sourceFailed(error);
      }
      return execute(current(), point.fallback ? {} : { alignAt: point.t });
    });
  }
  // case.unlink: the span of the catalog's sessions on the scope's vehicle as the scope stands
  // when it applies, no query and no list (B4, D-117).
  return inAcceptedOrder(store, async () => {
    const scope = store.workspace.scope;
    const open = store.workspace.case;
    if (!open?.linked || !scope) return execute(current());
    const cases = deps.workspaces.caseOf(entry.record.id) ?? { entries: [open.entry] };
    const span = objectSpan(cases, scope.dataRef, scope, BigInt(open.pad));
    const result = execute(current(), { extent: { from: span.from, to: span.to } });
    if (result.ok) noteObjectScope(catalogs, store.workspace);
    return result;
  });
}

/** The data refs of a command body; a body that is no command names none (it is refused as invalid). */
function commandDataRefs(request: FastifyRequest): string[] {
  const parsed = Command.safeParse(request.body);
  return parsed.success ? dataRefsOfCommand(parsed.data) : [];
}

const WORKSPACE: { access: Access } = { access: { level: "workspace" } };
const CHANGE: { access: Access } = { access: { level: "change", dataRefs: commandDataRefs } };

/** Default interval of the live channel's ping; a client that misses one pong is dropped. */
export const LIVE_HEARTBEAT_MS = 30_000;

const sameRights = (a: WorkspaceRights | undefined, b: WorkspaceRights | undefined) =>
  a?.open === b?.open && a?.change === b?.change && a?.owner === b?.owner;

export const workspaceRoutes =
  (deps: AppDeps): FastifyPluginAsync =>
  async (app) => {
    const { workspaces } = deps;
    const heartbeatMs = deps.liveHeartbeatMs ?? LIVE_HEARTBEAT_MS;
    const catalogs = catalogsOf(deps);

    /**
     * Keeps the scope's signal list loading until it has loaded once (signal-catalog H5), in an
     * object scope the session's (B5); a scope the bound refuses is not retried. Returns stop().
     */
    const keepScopeLoaded = (workspace: Workspace): (() => void) => {
      const scope = workspace.scope?.object ? linkedScopeOf(workspace) : workspace.scope;
      if (!scope) return () => {};
      let stop = () => {};
      stop = keepCatalogLoaded(catalogs.entry(scope), {
        loaded() {},
        failed(error, retryInMs) {
          if (error instanceof TooWideError) {
            app.log.warn({ dataRef: scope.dataRef }, `scope catalog not loaded: ${error.message}`);
            stop();
            return;
          }
          app.log.error(
            { error: String(error), retryInMs, dataRef: scope.dataRef },
            "scope catalog not loaded; retrying",
          );
        },
      });
      return () => stop();
    };

    /** Applies one command; the endpoint the UI and the CLI share. */
    app.post("/api/commands", { config: CHANGE }, async (request, reply) => {
      // Only the view routes name the open view or mark it saved, so a save in place writes its
      // own file (V2 round 2) and the dirty flag tells the truth (T-02).
      const refusal = endpointRefusal(request.body);
      if (refusal) {
        const refused: CommandResult = { ok: false, code: "invalid_command", message: refusal };
        return reply.code(400).send(refused);
      }
      return runCommand(deps, request.body, reply);
    });

    app.get("/api/workspace", { config: WORKSPACE }, async (request) => {
      const { store } = workspaceOf(request);
      return { revision: store.revision, workspace: store.workspace };
    });

    /** Latest rendered revision per browser connected to the workspace. */
    app.get("/api/render-status", { config: WORKSPACE }, async (request) =>
      workspaceOf(request).store.renderStatus(),
    );

    /**
     * Sends `hello`, the workspace's `summary` with this user's rights, then its `state`; pushes the
     * state after each accepted command and a new summary when this user's rights, the share level
     * or the grant change; closes with 4403 when the user can no longer open it and with 4404 when
     * it is deleted (add-multiuser M8). Connecting sets `lastActiveAt` and clears a reuse claim
     * (M4). Receives render acknowledgements. Pings every `heartbeatMs` and terminates a
     * connection that missed the last pong, so a client gone without a close (page navigation,
     * dead TCP) leaves render status with its acknowledgement.
     */
    app.get("/api/live", { websocket: true, config: WORKSPACE }, (socket, request) => {
      const entry = workspaceOf(request);
      const user = userOf(request).identity.user;
      const { id } = entry.record;
      const { store } = entry;
      let closed = false;
      let current = workspaceRights(user, entry);
      let granted = grantedOf(workspaces.grantOf(id));
      const send = (message: LiveServerMessage) => {
        if (!closed && socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
      };
      const close = (code: number, reason: string) => {
        if (closed) return;
        closed = true;
        socket.close(code, reason);
      };
      const summary = (rights: WorkspaceRights | undefined) =>
        summaryOf(entry, rights, workspaces.grantOf(id));
      const clientId = store.connect(user);
      workspaces.touch(id);
      send({ type: "hello", clientId });
      send({ type: "summary", summary: summary(current) });
      send({ type: "state", revision: store.revision, workspace: store.workspace });
      // The user's own favourites, then each change of them from any client (add-favourites F4).
      const { favouritesOf } = deps;
      if (favouritesOf) send({ type: "favourites", ...favouritesOf(user).get() });
      const offFavourites = favouritesOf
        ? favouritesOf.onChange((changedUser, favourites) => {
            if (changedUser === user) send({ type: "favourites", ...favourites });
          })
        : () => {};
      noteObjectScope(catalogs, store.workspace);
      let stopLoading = keepScopeLoaded(store.workspace);
      // The registry's own listener runs first (it subscribed when the workspace was added), so a
      // command that takes this user's access closes the channel before its state is sent.
      const unsubscribe = store.subscribe((revision, state, command) =>
        send({ type: "state", revision, workspace: state, command }),
      );
      const offChange = workspaces.onChange((event) => {
        if (event.entry.record.id !== id) return;
        if (event.type === "delete") return close(CLOSE_WORKSPACE_GONE, "workspace deleted");
        const next = workspaceRights(user, entry);
        if (!next) return close(CLOSE_NO_ACCESS, "no access to this workspace");
        const nextGranted = grantedOf(workspaces.grantOf(id));
        if (
          event.type === "share" ||
          event.type === "grant" ||
          !sameRights(current, next) ||
          nextGranted !== granted
        ) {
          current = next;
          granted = nextGranted;
          send({ type: "summary", summary: summary(next) });
        }
        if (event.scopeChanged) {
          noteObjectScope(catalogs, store.workspace);
          stopLoading();
          stopLoading = keepScopeLoaded(store.workspace);
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
        offFavourites();
        stopLoading();
        store.disconnect(clientId);
      });
    });
  };

/**
 * Why `POST /api/commands` refuses `body`: a `view.open` that carries `name` or any
 * `view.markSaved` (only the view routes send those); undefined for any other body.
 */
function endpointRefusal(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { type, name } = body as { type?: unknown; name?: unknown };
  if (type === "view.open" && name !== undefined)
    return "open a saved view through POST /api/views/open";
  if (type === "view.markSaved") return "views are marked saved only by POST /api/views";
  return undefined;
}
