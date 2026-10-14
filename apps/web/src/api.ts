import type {
  ApiError,
  CatalogSnapshot,
  CommandInput,
  CommandResult,
  Extent,
  SeriesResult,
  SignalInfo,
  SignalPage,
} from "@letsview/shared";
import type { LoadRequest } from "./chart/loader.ts";

async function getJson<T>(url: string, abort?: AbortSignal): Promise<T> {
  const res = await fetch(url, abort ? { signal: abort } : {});
  const body = await res.json();
  if (!res.ok) {
    const { error } = body as ApiError;
    throw new Error(`${error.code}: ${error.message}`);
  }
  return body as T;
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

export function fetchSeries(r: LoadRequest, abort: AbortSignal): Promise<SeriesResult> {
  const params = new URLSearchParams({
    signal: r.signalId,
    from: r.from,
    to: r.to,
    target: String(r.target),
  });
  return getJson(`/api/series?${params}`, abort);
}

export function fetchExtent(signalId: string): Promise<Extent> {
  return getJson(`/api/extent?${new URLSearchParams({ signal: signalId })}`);
}

export async function sendCommand(command: CommandInput): Promise<CommandResult> {
  const res = await fetch("/api/commands", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(command),
  });
  return res.json() as Promise<CommandResult>;
}
