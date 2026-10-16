import type {
  ApiError,
  CatalogSnapshot,
  CommandInput,
  CommandResult,
  CursorValueResult,
  Extent,
  SeriesResult,
  SignalInfo,
  SignalPage,
  ValuesMode,
} from "@kipscope/shared";
import type { SeriesRequest } from "./chart/tiles.ts";

/** A response that is not ok, with its HTTP status and error code (design R4). */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

async function getJson<T>(url: string, abort?: AbortSignal): Promise<T> {
  const res = await fetch(url, abort ? { signal: abort } : {});
  if (!res.ok) {
    // A proxy or a crashed server may answer without an ApiError body.
    const body = (await res.json().catch(() => undefined)) as Partial<ApiError> | undefined;
    const error = body?.error;
    if (typeof error?.code === "string" && typeof error.message === "string") {
      throw new ApiRequestError(res.status, error.code, error.message);
    }
    throw new ApiRequestError(res.status, `http_${res.status}`, res.statusText);
  }
  return (await res.json()) as T;
}

/** One page of the server-side search; the explorer searches the full catalog locally instead. */
export function fetchSignalPage(q: string, abort?: AbortSignal): Promise<SignalPage> {
  return getJson(`/api/signals?${new URLSearchParams({ q, limit: "100" })}`, abort);
}

/** The whole catalog in catalog order (design E3); 503 `catalog_unavailable` before its first load. */
export function fetchCatalog(abort?: AbortSignal): Promise<CatalogSnapshot> {
  return getJson("/api/catalog", abort);
}

/** Looks up metadata of one signal by exact ID. */
export async function signalInfo(id: string): Promise<SignalInfo | undefined> {
  const name = id.slice(id.indexOf("/") + 1);
  const page = await fetchSignalPage(name);
  return page.items.find((s) => s.id === id);
}

export function fetchSeries(r: SeriesRequest, abort: AbortSignal): Promise<SeriesResult> {
  const params = new URLSearchParams({
    signal: r.signalId,
    from: r.from,
    to: r.to,
    target: String(r.target),
  });
  return getJson(`/api/series?${params}`, abort);
}

/** Value of one signal at time `t` (decimal ns) from its raw neighbours (design S3, C8). */
export function fetchCursorValue(
  signalId: string,
  t: string,
  mode: ValuesMode,
  abort: AbortSignal,
): Promise<CursorValueResult> {
  return getJson(`/api/value?${new URLSearchParams({ signal: signalId, t, mode })}`, abort);
}

export function fetchExtent(signalId: string): Promise<Extent> {
  return getJson(`/api/extent?${new URLSearchParams({ signal: signalId })}`);
}

/** True when `body` has the shape of a `CommandResult` (design H6). */
function isCommandResult(body: unknown): body is CommandResult {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  if (b.ok === true) return typeof b.revision === "number";
  return b.ok === false && typeof b.code === "string" && typeof b.message === "string";
}

/**
 * Posts a command. Never rejects (design H6): a failed fetch resolves to code `network`, an answer
 * that is not a command result (a proxy page, a 5xx, a foreign body) to `bad_response`.
 */
export async function sendCommand(command: CommandInput): Promise<CommandResult> {
  let res: Response;
  try {
    res = await fetch("/api/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, code: "network", message: message || "request failed" };
  }
  if (res.status === 200 || res.status === 400 || res.status === 422) {
    const body: unknown = await res.json().catch(() => undefined);
    if (isCommandResult(body)) return body;
  }
  return { ok: false, code: "bad_response", message: `HTTP ${res.status}: ${res.statusText}` };
}
