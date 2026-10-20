import {
  type ApiError,
  type CommandInput,
  type CommandResult,
  WORKSPACE_HEADER,
  WORKSPACE_ID,
  workspaceApi,
} from "@kipscope/shared";
import { CliError } from "./output.ts";

/** The end of the call's --timeout; every request gets what is left of it. */
export interface Deadline {
  readonly at: number;
  remainingMs(): number;
}

export interface Client {
  /** 2xx → body; 4xx → CliError rejected (ApiError code); 5xx → unavailable; network → unreachable; deadline → timeout. */
  get<T>(path: string, query?: Record<string, string>): Promise<T>;
  /** GET of a text body (view export): 2xx → the text unchanged; failures as get. */
  getText(path: string): Promise<string>;
  /** POST of a JSON body: 2xx → body; failures as get. */
  post<T>(path: string, body: unknown): Promise<T>;
  /** DELETE: 2xx → body; failures as get. */
  delete<T>(path: string): Promise<T>;
  /** 200/400/422 → CommandResult; other statuses and failures as get. */
  postCommand(command: CommandInput): Promise<CommandResult>;
  /** As postCommand, for an endpoint that answers like POST /api/commands (POST /api/views/open). */
  postCommandAt(path: string, body: unknown): Promise<CommandResult>;
  /** The call's workspace: the given one, else the first answer's `X-KIPscope-Workspace` (M13). */
  workspace(): string | undefined;
}

export interface ClientOptions {
  /** Every request goes to `/api/w/<workspace>/…`; the server ignores the prefix where no workspace applies. */
  workspace?: string;
  /** Sent as `Authorization: Bearer <token>`; never part of a message. */
  token?: string;
}

export function createClient(
  baseUrl: string,
  deadline: Deadline,
  options: ClientOptions = {},
): Client {
  let workspace = options.workspace;
  const auth: Record<string, string> =
    options.token === undefined ? {} : { authorization: `Bearer ${options.token}` };

  /** `/api/x` → `/api/w/<id>/x` once the call has a workspace. */
  const address = (path: string) =>
    workspace !== undefined && path.startsWith("/api/")
      ? `${workspaceApi(workspace)}${path.slice("/api".length)}`
      : path;

  async function request(method: "GET" | "POST" | "DELETE", path: string, init: RequestInit) {
    const what = `${method} ${path}`;
    const remaining = deadline.remainingMs();
    if (remaining <= 0) throw new CliError("timeout", "timeout", `${what}: --timeout ran out`);
    const signal = AbortSignal.timeout(remaining);
    try {
      const headers = { ...(init.headers as Record<string, string> | undefined), ...auth };
      const response = await fetch(new URL(address(path), baseUrl), {
        ...init,
        headers,
        method,
        signal,
      });
      // One workspace per call: a default workspace the server chose stays the call's workspace.
      const served = response.headers.get(WORKSPACE_HEADER);
      if (workspace === undefined && served !== null && WORKSPACE_ID.test(served)) {
        workspace = served;
      }
      // Read the body under the same deadline; a server can stall after the headers.
      const text = await response.text();
      return { status: response.status, text, body: parseJson(text), what };
    } catch (error) {
      if (error instanceof CliError) throw error;
      if (signal.aborted) throw new CliError("timeout", "timeout", `${what}: --timeout ran out`);
      throw new CliError("unreachable", "unreachable", `${what}: ${networkReason(error)}`);
    }
  }

  async function postCommandAt(path: string, json: unknown): Promise<CommandResult> {
    const { status, body, what } = await request("POST", path, jsonInit(json));
    // A 400/422 in the ApiError form (`{ error }`) is no command result: mapped as by get.
    if (status === 200 || ((status === 400 || status === 422) && !isApiError(body))) {
      return expectJson(body, what) as CommandResult;
    }
    throw statusError(status, body, what);
  }

  return {
    async get<T>(path: string, query?: Record<string, string>): Promise<T> {
      const search = query === undefined ? "" : `?${new URLSearchParams(query)}`;
      const { status, body, what } = await request("GET", `${path}${search}`, {});
      if (status >= 200 && status < 300) return expectJson(body, what) as T;
      throw statusError(status, body, what);
    },

    async getText(path: string): Promise<string> {
      const { status, text, body, what } = await request("GET", path, {});
      if (status >= 200 && status < 300) return text;
      throw statusError(status, body, what);
    },

    async post<T>(path: string, json: unknown): Promise<T> {
      const { status, body, what } = await request("POST", path, jsonInit(json));
      if (status >= 200 && status < 300) return expectJson(body, what) as T;
      throw statusError(status, body, what);
    },

    async delete<T>(path: string): Promise<T> {
      const { status, body, what } = await request("DELETE", path, {});
      if (status >= 200 && status < 300) return expectJson(body, what) as T;
      throw statusError(status, body, what);
    },

    postCommand: (command: CommandInput) => postCommandAt("/api/commands", command),
    postCommandAt,
    workspace: () => workspace,
  };
}

function jsonInit(json: unknown): RequestInit {
  return { headers: { "content-type": "application/json" }, body: JSON.stringify(json) };
}

function isApiError(body: unknown): boolean {
  return typeof (body as Partial<ApiError> | null)?.error === "object";
}

const NOT_JSON = Symbol("not json");

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return NOT_JSON;
  }
}

function expectJson(body: unknown, what: string): unknown {
  if (body === NOT_JSON) throw new CliError("unavailable", "unavailable", `${what}: not JSON`);
  return body;
}

/** 4xx → rejected, anything else → unavailable; the code is the server's where it sent one. */
function statusError(status: number, body: unknown, what: string): CliError {
  const outcome = status >= 400 && status < 500 ? "rejected" : "unavailable";
  const error = (body as Partial<ApiError> | null)?.error;
  if (typeof error === "object" && error !== null && typeof error.code === "string") {
    return new CliError(outcome, error.code, `${what}: HTTP ${status}: ${error.message}`);
  }
  // A failed CommandResult (`{ ok: false, code, message }`) outside 400/422, e.g. 503 catalog_unavailable.
  const failed = body as { ok?: unknown; code?: unknown; message?: unknown } | null;
  if (failed?.ok === false && typeof failed.code === "string") {
    return new CliError(outcome, failed.code, `${what}: HTTP ${status}: ${String(failed.message)}`);
  }
  const message = (body as { message?: unknown } | null)?.message;
  const detail = typeof message === "string" ? `: ${message}` : "";
  return new CliError(outcome, outcome, `${what}: HTTP ${status}${detail}`);
}

/** Node's fetch reports refused/reset/DNS failures as TypeError("fetch failed") with the cause. */
function networkReason(error: unknown): string {
  const cause = (error as { cause?: { code?: unknown; message?: unknown } }).cause;
  if (typeof cause?.code === "string") return cause.code;
  if (typeof cause?.message === "string") return cause.message;
  return error instanceof Error ? error.message : String(error);
}
