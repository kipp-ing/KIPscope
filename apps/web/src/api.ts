import {
  type ApiError,
  type CalendarDensity,
  type CaseCatalog,
  type CasePreview,
  type CatalogSnapshot,
  CLASS_HEADER,
  type CommandErrorCode,
  type CommandInput,
  type CommandResult,
  type ComputedDef,
  type CreateWorkspaceAnswer,
  type CreateWorkspaceRequest,
  type CursorValueResult,
  computedParams,
  computedRef,
  type Density,
  type EventList,
  type Extent,
  type FavouritesChange,
  type GapInfo,
  type ImportViewRequest,
  type Me,
  type SaveViewRequest,
  type SeriesResult,
  type ServerMeta,
  type SignalInfo,
  type SignalPage,
  type TimeRange,
  type ValuesMode,
  type ViewSummary,
  type WorkspaceAnswer,
  type WorkspaceList,
  type WorkspaceShare,
} from "@kipscope/shared";
import type { SeriesRequest } from "./chart/tiles.ts";
import { apiPath, withWorkspace } from "./workspaces/apiPath.ts";

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

/**
 * The server is still loading its catalog or the scope's signal list (503 `catalog_unavailable`):
 * a loading state to retry soon, not an error.
 */
export function isCatalogLoading(error: unknown): boolean {
  return (
    error instanceof ApiRequestError && error.status === 503 && error.code === "catalog_unavailable"
  );
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

/** The request header of the `preload` query class (add-case-open K10). */
const PRELOAD_HEADERS = { [CLASS_HEADER]: "preload" };

/** GET of an API path; workspace-resolving paths go to the page's workspace (add-multiuser M12). */
async function getJson<T>(
  url: string,
  abort?: AbortSignal,
  headers?: Record<string, string>,
): Promise<T> {
  const res = await fetch(apiPath(url), {
    ...(abort ? { signal: abort } : {}),
    ...(headers ? { headers } : {}),
  });
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

/** What a request for one catalog entry adds (add-case-open K10, K14): `case=<n>`, the preload class. */
export interface CaseRequestOptions {
  /** 0-based catalog index: bounded by that entry's scope instead of the workspace's. */
  case?: number;
  /** Sends `X-KIPscope-Class: preload`. */
  preload?: boolean;
}

// Computed signals (add-computed-signals C11): the workspace's definitions by ID, so a request for
// `<dataRef>/=<id>` carries its formula and inputs; the server keeps no definitions per request.
const computedDefs = new Map<string, ComputedDef>();

/** Replaces the definitions requests for computed IDs read (on every live state). */
export function setComputedDefs(defs: readonly ComputedDef[]): void {
  computedDefs.clear();
  for (const def of defs) computedDefs.set(def.id, def);
}

/** The definition of a computed signal ID by its `=<id>` part (any data ref); undefined otherwise. */
export function computedDefOf(signalId: string): ComputedDef | undefined {
  const ref = computedRef(signalId);
  return ref === undefined ? undefined : computedDefs.get(ref.id);
}

/**
 * Adds `formula`, `a`, `b` of a computed `signalId` to `params` (C8); a computed ID without a
 * definition gives the error to reject with, before any request.
 */
function addComputed(params: URLSearchParams, signalId: string): ApiRequestError | undefined {
  if (computedRef(signalId) === undefined) return undefined;
  const def = computedDefOf(signalId);
  if (!def) {
    return new ApiRequestError(0, "unknown_computed", `no computed signal ${signalId}`);
  }
  const p = computedParams(def);
  params.set("formula", p.formula);
  params.set("a", p.a);
  if (p.b !== undefined) params.set("b", p.b);
  return undefined;
}

export function fetchSeries(
  r: SeriesRequest & CaseRequestOptions,
  abort: AbortSignal,
): Promise<SeriesResult> {
  const params = new URLSearchParams({
    signal: r.signalId,
    from: r.from,
    to: r.to,
    target: String(r.target),
  });
  const refused = addComputed(params, r.signalId);
  if (refused) return Promise.reject(refused);
  if (r.case !== undefined) params.set("case", String(r.case));
  return getJson(`/api/series?${params}`, abort, r.preload ? PRELOAD_HEADERS : undefined);
}

/** Value of one signal at time `t` (decimal ns) from its raw neighbours (design S3, C8). */
export function fetchCursorValue(
  signalId: string,
  t: string,
  mode: ValuesMode,
  abort: AbortSignal,
): Promise<CursorValueResult> {
  const params = new URLSearchParams({ signal: signalId, t, mode });
  const refused = addComputed(params, signalId);
  if (refused) return Promise.reject(refused);
  return getJson(`/api/value?${params}`, abort);
}

export function fetchExtent(
  signalId: string,
  options: CaseRequestOptions & { abort?: AbortSignal } = {},
): Promise<Extent> {
  const params = new URLSearchParams({ signal: signalId });
  const refused = addComputed(params, signalId);
  if (refused) return Promise.reject(refused);
  if (options.case !== undefined) params.set("case", String(options.case));
  return getJson(
    `/api/extent?${params}`,
    options.abort,
    options.preload ? PRELOAD_HEADERS : undefined,
  );
}

/** `from` and `to` of a time range as query parameters. */
function appendRange(params: URLSearchParams, range: TimeRange | undefined): void {
  if (!range) return;
  params.set("from", range.from);
  params.set("to", range.to);
}

/**
 * Rows per bucket of one data ref over its whole recording, for the time strip (design T8); with
 * `range` over that part of the scope only (add-case-open K10, K11: the work window's drives).
 */
export function fetchDensity(
  dataRef: string,
  signal?: AbortSignal,
  range?: TimeRange,
): Promise<Density> {
  const params = new URLSearchParams({ dataRef });
  appendRange(params, range);
  return getJson(`/api/density?${params}`, signal);
}

/**
 * Rows per hour and the drives of one calendar window of a data ref (add-range-picker R2, R10):
 * `from` and `to` as decimal ns, ≤ 32 d apart, on the minute grid; cut to the scope by the server.
 */
export function fetchCalendar(
  dataRef: string,
  window: { from: bigint; to: bigint },
  signal?: AbortSignal,
): Promise<CalendarDensity> {
  const params = new URLSearchParams({
    dataRef,
    from: window.from.toString(),
    to: window.to.toString(),
  });
  return getJson(`/api/calendar?${params}`, signal);
}

/**
 * Logger gaps and signal periods of one data ref (add-gap-display G6, G7), with the measured
 * periods of the named `signals` (improve-query-priority P7).
 */
export function fetchGaps(
  dataRef: string,
  signals: readonly string[],
  abort?: AbortSignal,
  window?: TimeRange,
): Promise<GapInfo> {
  const params = new URLSearchParams({ dataRef });
  for (const s of signals) params.append("signal", s);
  // Only in an object scope: its work window (add-case-open K11).
  appendRange(params, window);
  return getJson(`/api/gaps?${params}`, abort);
}

/** All events of one data ref with the state changes of its events-line signals, no filter (add-events V9). */
export function fetchEvents(
  dataRef: string,
  signals: readonly string[],
  abort?: AbortSignal,
  window?: TimeRange,
): Promise<EventList> {
  const params = new URLSearchParams({ dataRef });
  for (const s of signals) params.append("signal", s);
  appendRange(params, window);
  return getJson(`/api/events?${params}`, abort);
}

// Catalogs (add-case-open K10, K14).

/** The open catalog of the page's workspace; immutable for one `catalogId`; 404 `no_case`. */
export function fetchCase(abort?: AbortSignal): Promise<CaseCatalog> {
  return getJson("/api/case", abort);
}

/** Scope and alignment point of catalog entry `index`; the server warms that session (K13). */
export function fetchCasePreview(index: number, abort: AbortSignal): Promise<CasePreview> {
  return getJson(
    `/api/case/preview?${new URLSearchParams({ index: String(index) })}`,
    abort,
    PRELOAD_HEADERS,
  );
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
    res = await fetch(apiPath("/api/commands"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, code: "network", message: message || "request failed" };
  }
  const body: unknown = await res.json().catch(() => undefined);
  if ((res.status === 200 || res.status === 400 || res.status === 422) && isCommandResult(body)) {
    return body;
  }
  // The guard refuses before the command runs (add-multiuser M6): `read_only`, `forbidden`,
  // `forbidden_data`, … as an ApiError; the strip shows its code like a command's.
  const error = !res.ok ? requestError(res, body) : undefined;
  if (error && !error.code.startsWith("http_")) {
    const message = String(error.details?.message ?? error.message);
    return { ok: false, code: error.code as CommandErrorCode, message };
  }
  return { ok: false, code: "bad_response", message: `HTTP ${res.status}: ${res.statusText}` };
}

// Saved views (add-saved-views V6, V7).

async function sendJson<T>(url: string, method: "POST" | "DELETE", body?: unknown): Promise<T> {
  const res = await fetch(apiPath(url), {
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
  // Saving reads the page's workspace; the path alone is also the workspace-independent list.
  return sendJson(withWorkspace("/api/views"), "POST", req);
}

/** Opens a view as one `view.open` command; a refused open resolves to its command result. */
export async function openView(body: OpenViewBody): Promise<CommandResult> {
  const res = await fetch(apiPath("/api/views/open"), {
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

// Favourites (add-favourites F9): per user, never prefixed.

/**
 * Stars or unstars names and answers the stored list; the list the UI shows arrives as a live
 * `favourites` message, sent only when the change changed it. A refused or failed request throws
 * ApiRequestError with its `code` (`favourites_unreadable`, …).
 */
export async function changeFavourites(change: FavouritesChange): Promise<{ names: string[] }> {
  const res = await fetch("/api/favourites", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(change),
  });
  const data: unknown = await res.json().catch(() => undefined);
  if (!res.ok) throw requestError(res, data);
  return data as { names: string[] };
}

// Identity and workspaces (add-multiuser M7); workspace-independent, never prefixed.

/** The signed-in user with roles and the share switch; read once at start (M12). */
export function fetchMe(abort?: AbortSignal): Promise<Me> {
  return getJson("/api/me", abort);
}

/** The user's own workspaces, latest first. */
export async function listWorkspaces(abort?: AbortSignal): Promise<WorkspaceList> {
  return getJson("/api/workspaces", abort);
}

/** One workspace; 404 `unknown_workspace`, 403 `forbidden` without the open right. */
export function fetchWorkspace(id: string, abort?: AbortSignal): Promise<WorkspaceAnswer> {
  return getJson(`/api/workspaces/${encodeURIComponent(id)}`, abort);
}

/**
 * Creates a workspace, with a view opened in it, or reuses a free one (`reuse`, M4). A refused
 * open answers no workspace and the open's command result (M7); a refused request (403
 * `forbidden_data`, 409 `workspace_limit`) rejects.
 */
export async function createWorkspace(
  req: CreateWorkspaceRequest = {},
): Promise<Partial<CreateWorkspaceAnswer>> {
  const res = await fetch("/api/workspaces", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  });
  const data: unknown = await res.json().catch(() => undefined);
  if (res.ok) return data as CreateWorkspaceAnswer;
  if (isCommandResult(data)) return { result: data };
  throw requestError(res, data);
}

/**
 * Opens a catalog (a link's code, a JWS, or a plain document) in a new workspace (K10). A refused
 * catalog rejects with its code and message (`invalid_catalog`, `signature_required`, …).
 */
export async function openCases(
  cases: string | Record<string, unknown>,
): Promise<CreateWorkspaceAnswer> {
  const res = await fetch("/api/workspaces", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ open: { cases } }),
  });
  const data: unknown = await res.json().catch(() => undefined);
  if (!res.ok) throw requestError(res, data);
  return data as CreateWorkspaceAnswer;
}

export function shareWorkspace(id: string, share: WorkspaceShare): Promise<WorkspaceAnswer> {
  return sendJson(`/api/workspaces/${encodeURIComponent(id)}/share`, "POST", { share });
}
