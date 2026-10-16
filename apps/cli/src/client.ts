import type { ApiError, CommandInput, CommandResult } from "@kipscope/shared";
import { CliError } from "./output.ts";

/** The end of the call's --timeout; every request gets what is left of it. */
export interface Deadline {
  readonly at: number;
  remainingMs(): number;
}

export interface Client {
  /** 2xx → body; 4xx → CliError rejected (ApiError code); 5xx → unavailable; network → unreachable; deadline → timeout. */
  get<T>(path: string, query?: Record<string, string>): Promise<T>;
  /** 200/400/422 → CommandResult; other statuses and failures as get. */
  postCommand(command: CommandInput): Promise<CommandResult>;
}

export function createClient(baseUrl: string, deadline: Deadline): Client {
  async function request(method: "GET" | "POST", path: string, init: RequestInit) {
    const what = `${method} ${path}`;
    const remaining = deadline.remainingMs();
    if (remaining <= 0) throw new CliError("timeout", "timeout", `${what}: --timeout ran out`);
    const signal = AbortSignal.timeout(remaining);
    try {
      const response = await fetch(new URL(path, baseUrl), { ...init, method, signal });
      // Read the body under the same deadline; a server can stall after the headers.
      const text = await response.text();
      return { status: response.status, body: parseJson(text), what };
    } catch (error) {
      if (error instanceof CliError) throw error;
      if (signal.aborted) throw new CliError("timeout", "timeout", `${what}: --timeout ran out`);
      throw new CliError("unreachable", "unreachable", `${what}: ${networkReason(error)}`);
    }
  }

  return {
    async get<T>(path: string, query?: Record<string, string>): Promise<T> {
      const search = query === undefined ? "" : `?${new URLSearchParams(query)}`;
      const { status, body, what } = await request("GET", `${path}${search}`, {});
      if (status >= 200 && status < 300) return expectJson(body, what) as T;
      throw statusError(status, body, what);
    },

    async postCommand(command: CommandInput): Promise<CommandResult> {
      const { status, body, what } = await request("POST", "/api/commands", {
        headers: { "content-type": "application/json" },
        body: JSON.stringify(command),
      });
      if (status === 200 || status === 400 || status === 422) {
        return expectJson(body, what) as CommandResult;
      }
      throw statusError(status, body, what);
    },
  };
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
