import type {
  ApiError,
  CatalogSnapshot,
  CommandInput,
  CommandResult,
  CursorValueResult,
  Density,
  EventList,
  Extent,
  GapInfo,
  ImportViewRequest,
  SaveViewRequest,
  SeriesResult,
  ServerMeta,
  SignalInfo,
  SignalPage,
  ValuesMode,
  ViewSummary,
} from "@kipscope/shared";
import type { SeriesRequest } from "./chart/tiles.ts";

/** A response that is not ok, with its HTTP status and error code (design R4). */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  /** The whole `error` object of the answer, e.g. `existing` of a 409 `view_exists` (add-saved-views V6). */
  readonly details: Record<string, unknown> | undefined;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(`${code}: ${message}`);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** The error of a response that is not ok, from its parsed body (a proxy or a crashed server may answer without an ApiError body). */
function requestError(res: Response, body: unknown): ApiRequestError {
  const error = (body as Partial<ApiError> | undefined)?.error;
  if (typeof error?.code === "string" && typeof error.message === "string") {
    return new ApiRequestError(
      res.status,
      error.code,
      error.message,
      error as unknown as Record<string, unknown>,
    );
  }
  return new ApiRequestError(res.status, `http_${res.status}`, res.statusText);
}

async function getJson<T>(url: string, abort?: AbortSignal): Promise<T> {
  const res = await fetch(url, abort ? { signal: abort } : {});
  if (!res.ok) throw requestError(res, await res.json().catch(() => undefined));
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

/** Rows per bucket of one data ref over its whole recording, for the time strip (design T8). */
export function fetchDensity(dataRef: string, signal?: AbortSignal): Promise<Density> {
  return getJson(`/api/density?${new URLSearchParams({ dataRef })}`, signal);
}

/**
 * Logger gaps and signal periods of one data ref (add-gap-display G6, G7), with the measured
 * periods of the named `signals` (improve-query-priority P7).
 */
export function fetchGaps(
  dataRef: string,
  signals: readonly string[],
  abort?: AbortSignal,
): Promise<GapInfo> {
  const params = new URLSearchParams({ dataRef });
  for (const s of signals) params.append("signal", s);
  return getJson(`/api/gaps?${params}`, abort);
}

/** All events of one data ref with the state changes of its events-line signals, no filter (add-events V9). */
export function fetchEvents(
  dataRef: string,
  signals: readonly string[],
  abort?: AbortSignal,
): Promise<EventList> {
  const params = new URLSearchParams({ dataRef });
  for (const s of signals) params.append("signal", s);
  return getJson(`/api/events?${params}`, abort);
}

/** Build, source and catalog state of the running server for the footer (design F2). */
export function fetchMeta(abort?: AbortSignal): Promise<ServerMeta> {
  return getJson("/api/meta", abort);
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

// Saved views (add-saved-views V6, V7).

async function sendJson<T>(url: string, method: "POST" | "DELETE", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data: unknown = await res.json().catch(() => undefined);
  if (!res.ok) throw requestError(res, data);
  return data as T;
}

/** What `POST /api/views/open` opens: a saved view by name or a whole document (a link). */
export type OpenViewBody = { name: string } | { view: object };

export interface SaveViewResult {
  view: ViewSummary;
  revision: number;
}

export interface ImportViewResult {
  view: ViewSummary;
  warnings: string[];
  opened?: CommandResult;
}

/** The saved views, newest first, "Before last open" last. */
export async function listViews(abort?: AbortSignal): Promise<ViewSummary[]> {
  return (await getJson<{ views: ViewSummary[] }>("/api/views", abort)).views;
}

/** Saves the open workspace; 409 `view_exists` (with `details.existing`) unless `overwrite`. */
export function saveView(req: SaveViewRequest): Promise<SaveViewResult> {
  return sendJson("/api/views", "POST", req);
}

/** Opens a view as one `view.open` command; a refused open resolves to its command result. */
export async function openView(body: OpenViewBody): Promise<CommandResult> {
  const res = await fetch("/api/views/open", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data: unknown = await res.json().catch(() => undefined);
  if (isCommandResult(data)) return data;
  throw requestError(res, data);
}

export function deleteView(name: string): Promise<{ deleted: string }> {
  return sendJson(`/api/views/${encodeURIComponent(name)}`, "DELETE");
}

/** Stores a YAML or JSON view text under its name, opened at once with `open`. */
export function importView(req: ImportViewRequest): Promise<ImportViewResult> {
  return sendJson("/api/views/import", "POST", req);
}

/** Address of a view's YAML file; `download` makes the browser save it as `<name>.kipscope.yaml`. */
export function viewFileUrl(name: string, download: boolean): string {
  return `/api/views/${encodeURIComponent(name)}${download ? "?download=1" : ""}`;
}
