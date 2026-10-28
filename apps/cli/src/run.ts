import { spawn } from "node:child_process";
import {
  type CommandInput,
  type CreateWorkspaceAnswer,
  type CursorValueResult,
  DEFAULT_EVENT_FILTER,
  describeEventFilter,
  type EventList,
  type Extent,
  formatLocal,
  isTimeseries,
  type Me,
  parseEventFilter,
  parseSignalId,
  type RenderStatus,
  type ServerMeta,
  type SignalPage,
  type Workspace,
  type WorkspaceAnswer,
  type WorkspaceList,
  widenScope,
  workspacePath,
} from "@kipscope/shared";
import { type GlobalOptions, type Invocation, parseArgs, USAGE } from "./args.ts";
import { type CalcInvocation, calcCommand, computedDefs, computedQuery } from "./calc.ts";
import { runCase } from "./case.ts";
import { type Client, createClient, type Deadline } from "./client.ts";
import { runFavourites } from "./favourites.ts";
import {
  CliError,
  type CliOutput,
  type EventListData,
  EXIT,
  eventTable,
  type Outcome,
  printOutput,
  type RenderWait,
} from "./output.ts";
import { type Lookups, resolveCommand, resolveSignal, resolveTime } from "./refs.ts";
import { runView } from "./views.ts";
import { NO_UI_GRACE_MS, waitForRender } from "./wait.ts";

export interface Io {
  env: Record<string, string | undefined>;
  stdout(line: string): void;
  stderr(line: string): void;
}

/** Everything of a CliOutput except ok, outcome and exitCode; filled while the call runs. */
export type Body = Omit<CliOutput, "ok" | "outcome" | "exitCode">;

/** Parses, executes and prints one call; returns the exit code. Never throws. */
export async function run(argv: string[], io: Io): Promise<number> {
  let out: CliOutput;
  /** Printed instead of the JSON line: `events list --table`, `view export` without --out. */
  let text: string | undefined;
  let pretty = prettyRequested(argv);
  try {
    const { options, invocation } = parseArgs(argv, io.env);
    if (invocation.kind === "help") {
      io.stdout(USAGE.trimEnd());
      return 0;
    }
    pretty = options.pretty;
    out = await execute(invocation, options, io.env);
    if (invocation.kind === "events" && invocation.table && out.ok) {
      text = eventTable(out.data as EventListData, out.local?.t as string[]);
    }
    if (invocation.kind === "view" && invocation.action === "export" && !invocation.out && out.ok) {
      // The YAML text unchanged: io.stdout adds the final line break back.
      const yaml = out.data as string;
      text = yaml.endsWith("\n") ? yaml.slice(0, -1) : yaml;
    }
  } catch (e) {
    out = failure({}, e);
  }
  try {
    // Only on success; a failure prints the JSON line as usual (spec cli).
    if (text !== undefined) io.stdout(text);
    else printOutput(out, io, pretty);
  } catch {
    // A closed stdout must not turn into a throw; the exit code still tells the result.
  }
  return out.exitCode;
}

/** `--pretty` before `--`, for output of calls whose arguments do not parse. */
function prettyRequested(argv: string[]): boolean {
  const end = argv.indexOf("--");
  return (end < 0 ? argv : argv.slice(0, end)).includes("--pretty");
}

/** KIPSCOPE_TOKEN_COMMAND's limit (design "Numbers"). */
export const TOKEN_COMMAND_TIMEOUT_MS = 10_000;

/**
 * The trimmed stdout of KIPSCOPE_TOKEN_COMMAND, run once through the shell (M13). A non-zero exit,
 * a timeout or empty output is a usage error `token_command_failed` naming the command's last
 * stderr line; the token itself is never part of a message.
 */
export function runTokenCommand(
  command: string,
  env: Record<string, string | undefined>,
  timeoutMs = TOKEN_COMMAND_TIMEOUT_MS,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const fail = (why: string) =>
      reject(new CliError("usage", "token_command_failed", `KIPSCOPE_TOKEN_COMMAND ${why}`));
    const child = spawn(command, {
      shell: true,
      env: env as NodeJS.ProcessEnv,
      stdio: ["inherit", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
      // A grandchild may hold the pipes open: settle now and let go of the child.
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      fail(`timed out after ${timeoutMs / 1000} s`);
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      fail(`could not run: ${error.message}`);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const lines = Buffer.concat(err).toString("utf8").trim().split("\n");
      const last = lines[lines.length - 1]?.trim();
      const detail = last ? `: ${last}` : "";
      if (timedOut) return;
      if (code !== 0) return fail(`exited with ${code ?? signal}${detail}`);
      const token = Buffer.concat(out).toString("utf8").trim();
      if (token === "") return fail(`printed no token${detail}`);
      resolve(token);
    });
  });
}

async function execute(
  invocation: Exclude<Invocation, { kind: "help" }>,
  options: GlobalOptions,
  env: Record<string, string | undefined>,
): Promise<CliOutput> {
  const deadline = createDeadline(options.timeoutMs);
  let token = options.token;
  if (token === undefined && options.tokenCommand !== undefined) {
    try {
      token = await runTokenCommand(options.tokenCommand, env);
    } catch (e) {
      return failure({}, e);
    }
  }
  const client = createClient(options.server, deadline, {
    ...(options.workspace !== undefined && { workspace: options.workspace }),
    ...(token !== undefined && { token }),
  });
  const out = await executeWith(invocation, options, client, deadline);
  const workspace = client.workspace();
  // The workspace right after exitCode (S2 key order); of the fav forms only `add` uses one (F11).
  const userOnly = invocation.kind === "fav" && invocation.action !== "add";
  if (workspace === undefined || userOnly) return out;
  const { ok, outcome, exitCode, ...rest } = out;
  return { ok, outcome, exitCode, workspace, ...rest };
}

async function executeWith(
  invocation: Exclude<Invocation, { kind: "help" }>,
  options: GlobalOptions,
  client: Client,
  deadline: Deadline,
): Promise<CliOutput> {
  const lookups = createLookups(client);
  const body: Body = {};
  try {
    switch (invocation.kind) {
      case "state": {
        // Workspace first: the client then sends the render status to that same workspace.
        const current = await lookups.workspace();
        const render = await client.get<RenderStatus>("/api/render-status");
        body.revision = current.revision;
        body.data = { revision: current.revision, workspace: current.workspace, render };
        body.local = stateLocal(current.workspace);
        return result("ok", body);
      }
      case "search": {
        const query: Record<string, string> = { q: invocation.query };
        if (invocation.limit !== undefined) query.limit = String(invocation.limit);
        body.data = await client.get<SignalPage>("/api/signals", query);
        return result("ok", body);
      }
      case "extent": {
        const signal = await resolveSignal(invocation.signal, lookups);
        const extent = await client.get<Extent>("/api/extent", {
          signal,
          ...(await computedQuery(signal, lookups)),
        });
        body.data = extent;
        body.local = { first: local(extent.first), last: local(extent.last) };
        return result("ok", body);
      }
      case "value": {
        const signal = await resolveSignal(invocation.signal, lookups);
        const t = await resolveTime(invocation.t, lookups);
        const query: Record<string, string> = {
          signal,
          t: t.toString(),
          ...(await computedQuery(signal, lookups)),
        };
        if (invocation.mode) query.mode = invocation.mode;
        const value = await client.get<CursorValueResult>("/api/value", query);
        body.data = value;
        body.local = {
          t: local(value.t),
          ...(value.at && { at: local(value.at.t) }),
          ...(value.next && { next: local(value.next.t) }),
        };
        return result("ok", body);
      }
      case "events": {
        const { workspace } = await lookups.workspace();
        const dataRef = invocation.dataRef ?? firstDataRef(workspace);
        if (dataRef === undefined) {
          throw new CliError(
            "rejected",
            "no_data_ref",
            "no window shows a signal; name the data ref with --ref",
          );
        }
        const filter = invocation.filter ?? workspace.eventFilter ?? DEFAULT_EVENT_FILTER;
        const query = new URLSearchParams({ dataRef, filter });
        for (const id of workspace.eventSignals ?? []) {
          if (parseSignalId(id)?.dataRef === dataRef) query.append("signal", id);
        }
        if (invocation.from && invocation.to) {
          query.set("from", (await resolveTime(invocation.from, lookups)).toString());
          query.set("to", (await resolveTime(invocation.to, lookups)).toString());
        }
        // In the path: the query map of client.get cannot repeat `signal`.
        const list = await client.get<EventList>(`/api/events?${query}`);
        const parsed = parseEventFilter(list.filter ?? filter);
        const data: EventListData = {
          ...list,
          description: parsed.ok ? describeEventFilter(parsed.filter) : "",
        };
        body.data = data;
        body.local = { t: list.events.map((e) => local(e.t)) };
        return result("ok", body);
      }
      case "wait": {
        const status = await client.get<RenderStatus>("/api/render-status");
        if (invocation.revision !== undefined && invocation.revision > status.revision) {
          // The server ignores acknowledgements above its revision; the wait could only time out.
          throw new CliError(
            "rejected",
            "unknown_revision",
            `revision ${invocation.revision} does not exist yet (current: ${status.revision})`,
          );
        }
        const target = invocation.revision ?? status.revision;
        body.revision = target;
        return renderResult(await awaitRender(target, deadline, client), body, options);
      }
      case "command":
        return await runCommand(invocation, options, client, lookups, deadline, body);
      case "scope": {
        const { revision, workspace } = await lookups.workspace();
        if (invocation.action === "show") {
          const meta = await client.get<ServerMeta>("/api/meta");
          const { mode, state, size } = meta.catalog;
          body.revision = revision;
          body.data = {
            ...(workspace.scope && { scope: workspace.scope }),
            catalog: { mode, state, size },
          };
          if (workspace.scope) {
            body.local = { from: local(workspace.scope.from), to: local(workspace.scope.to) };
          }
          return result("ok", body);
        }
        // widen: one absolute scope.set (design Z7), so two callers never widen twice by accident.
        if (!workspace.scope) {
          body.accepted = false;
          throw new CliError(
            "rejected",
            "scope_required",
            "the workspace has no scope; set one with scope set REF FROM TO",
          );
        }
        const template = { type: "scope.set", ...widenScope(workspace.scope) } as const;
        return await runCommand(
          { kind: "command", template, raw: true },
          options,
          client,
          lookups,
          deadline,
          body,
        );
      }
      case "whoami":
        body.data = await client.get<Me>("/api/me");
        return result("ok", body);
      case "workspace":
        await runWorkspace(invocation, options, client, body);
        return result("ok", body);
      case "calc":
        if (invocation.action !== "list") {
          return await runCommand(invocation, options, client, lookups, deadline, body);
        }
        body.data = { computed: await computedDefs(lookups) };
        return result("ok", body);
      case "fav":
        await runFavourites(invocation, client, lookups, body);
        return result("ok", body);
      case "case":
        await runCase(invocation, client, options.server, body);
        return result("ok", body);
      case "view": {
        const opened = await runView(invocation, client, body);
        if (opened === undefined || !options.wait) return result("ok", body);
        return renderResult(await awaitRender(opened, deadline, client), body, options);
      }
    }
  } catch (e) {
    return failure(body, e);
  }
}

/** The workspace forms (M13); `share` acts on the call's workspace, pinned first when none was given. */
async function runWorkspace(
  invocation: Extract<Invocation, { kind: "workspace" }>,
  options: GlobalOptions,
  client: Client,
  body: Body,
): Promise<void> {
  switch (invocation.action) {
    case "list":
      body.data = await client.get<WorkspaceList>("/api/workspaces");
      return;
    case "new": {
      const answer = await client.post<CreateWorkspaceAnswer>("/api/workspaces", {});
      body.data = answer;
      body.local = { url: new URL(workspacePath(answer.workspace.id), options.server).href };
      return;
    }
    case "share": {
      // No workspace given: the default one, named by the header of a workspace-resolving answer.
      if (client.workspace() === undefined) await client.get<RenderStatus>("/api/render-status");
      const id = client.workspace();
      if (id === undefined)
        throw new CliError("unavailable", "unavailable", "the server named no workspace");
      body.data = await client.post<WorkspaceAnswer>(`/api/workspaces/${id}/share`, {
        share: invocation.share,
      });
      return;
    }
    case "delete":
      body.data = await client.delete<{ deleted: string }>(`/api/workspaces/${invocation.id}`);
      return;
  }
}

/** A command form, or a `calc add|edit|rm` whose command is built when the call runs (C13). */
async function runCommand(
  invocation:
    | Extract<Invocation, { kind: "command" }>
    | Exclude<CalcInvocation, { action: "list" }>,
  options: GlobalOptions,
  client: Client,
  lookups: Lookups,
  deadline: Deadline,
  body: Body,
): Promise<CliOutput> {
  let command: CommandInput;
  try {
    // A raw `command JSON` goes out as parsed; only templates of the forms hold refs to resolve.
    command =
      invocation.kind === "calc"
        ? await calcCommand(invocation, lookups)
        : invocation.raw
          ? (invocation.template as CommandInput)
          : await resolveCommand(invocation.template, lookups);
  } catch (e) {
    // A lookup refused it (cursor_off, unknown_signal, …): nothing was sent.
    if (e instanceof CliError && e.outcome === "rejected") body.accepted = false;
    throw e;
  }
  body.command = command;
  // A transport failure of the POST leaves `accepted` out: the server may have applied it.
  const answer = await client.postCommand(command);
  if (!answer.ok) {
    body.accepted = false;
    body.error = { code: answer.code, message: answer.message };
    return result("rejected", body);
  }
  body.accepted = true;
  body.revision = answer.revision;
  if (answer.created !== undefined) body.created = answer.created;
  if (answer.createdWindow !== undefined) body.createdWindow = answer.createdWindow;
  if (answer.removedWindow !== undefined) body.removedWindow = answer.removedWindow;
  if (command.type.startsWith("case.")) {
    // What a step moved or could not resolve (add-case-open K6).
    const { clamped, missing, alignFallback } = answer;
    const data = {
      ...(clamped && { clamped }),
      ...(missing && { missing }),
      ...(alignFallback && { alignFallback }),
    };
    if (Object.keys(data).length > 0) body.data = data;
  }
  if (!options.wait) return result("ok", body);
  return renderResult(await awaitRender(answer.revision, deadline, client), body, options);
}

function awaitRender(target: number, deadline: Deadline, client: Client): Promise<RenderWait> {
  return waitForRender(target, deadline.at, {
    renderStatus: () => client.get<RenderStatus>("/api/render-status"),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
}

function renderResult(render: RenderWait, body: Body, options: GlobalOptions): CliOutput {
  body.render = render;
  switch (render.status) {
    case "complete":
      return result("ok", body);
    case "error": {
      const errors = (render.errors ?? []).map((e) =>
        [e.windowId, e.signalId, e.message].filter(Boolean).join(" "),
      );
      body.error = {
        code: "render_error",
        message: `UI ${render.clientId} rendered revision ${render.revision} with errors: ${errors.join("; ")}`,
      };
      return result("render_error", body);
    }
    case "no_ui":
      body.error = { code: "no_ui", message: `no UI connected for ${NO_UI_GRACE_MS / 1000} s` };
      return result("no_ui", body);
    case "timeout":
      body.error = {
        code: "timeout",
        message: `no UI acknowledged revision ${render.target} within ${options.timeoutMs} ms`,
      };
      return result("timeout", body);
  }
}

function failure(body: Body, e: unknown): CliOutput {
  if (e instanceof CliError) {
    body.error = {
      code: e.code,
      message: e.message,
      ...(e.candidates && { candidates: e.candidates }),
    };
    return result(e.outcome, body);
  }
  // Not a mapped failure (a bug or an unexpected answer): still one JSON result, never a throw.
  body.error = { code: "internal_error", message: e instanceof Error ? e.message : String(e) };
  return result("unavailable", body);
}

/** Key order of the printed output after ok, outcome and exitCode (S2). */
const BODY_KEYS = [
  "accepted",
  "command",
  "revision",
  "created",
  "createdWindow",
  "removedWindow",
  "render",
  "data",
  "local",
  "error",
] as const satisfies readonly (keyof Body)[];

/** CliOutput in a fixed key order, without absent fields. */
function result(outcome: Outcome, body: Body): CliOutput {
  const exitCode = EXIT[outcome];
  const out: CliOutput = { ok: exitCode === 0, outcome, exitCode };
  for (const key of BODY_KEYS) {
    if (body[key] !== undefined) Object.assign(out, { [key]: body[key] });
  }
  return out;
}

function createDeadline(timeoutMs: number): Deadline {
  const at = Date.now() + timeoutMs;
  return { at, remainingMs: () => Math.max(0, at - Date.now()) };
}

/** Lookups of one call; the workspace is read at most once (S3 "memoised per call"). */
function createLookups(client: Client): Lookups {
  let workspace: Promise<{ revision: number; workspace: Workspace }> | undefined;
  return {
    workspace: () => {
      workspace ??= client.get<{ revision: number; workspace: Workspace }>("/api/workspace");
      return workspace;
    },
    search: (query, limit) =>
      client.get<SignalPage>("/api/signals", { q: query, limit: String(limit) }),
  };
}

/** Data ref of the first signal in window order (`events list` without --ref). */
function firstDataRef(workspace: Workspace): string | undefined {
  for (const w of workspace.windows) {
    for (const a of w.signals) {
      const id = parseSignalId(a.signalId);
      if (id) return id.dataRef;
    }
  }
  return undefined;
}

/** Local time with offset (design L5), from decimal ns. */
function local(t: string | bigint): string {
  return formatLocal(BigInt(t), { offset: true });
}

/** `local` of `state`: cursors A/B and each timeseries window's range (design S2). */
function stateLocal(workspace: Workspace): Record<string, unknown> {
  const { a, b } = workspace.cursors;
  const ranges: Record<string, { from: string; to: string }> = {};
  for (const w of workspace.windows) {
    if (isTimeseries(w)) ranges[w.id] = { from: local(w.range.from), to: local(w.range.to) };
  }
  return {
    cursors: { ...(a !== undefined && { a: local(a) }), ...(b !== undefined && { b: local(b) }) },
    ranges,
  };
}
