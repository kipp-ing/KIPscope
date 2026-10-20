import type { Extent } from "@kipscope/shared";
import { fetchExtent } from "../api.ts";
import { SCOPE_STORES } from "./gaps.ts";
import { LOAD_INTERVAL_MS, type LoaderOptions } from "./loader.ts";

/**
 * Per scope key, least recently entered first: each signal's extent, fetched once per scope (Z2,
 * K12). An extent answers for the scope it was fetched in.
 */
const scopes = new Map<string, Map<string, Promise<Extent>>>();
let currentKey = "";

/** The extents of `key`, made the most recently used; the least recently used beyond 4 is dropped. */
function storeOf(key: string): Map<string, Promise<Extent>> {
  let store = scopes.get(key);
  if (store) scopes.delete(key);
  else store = new Map();
  scopes.set(key, store);
  for (const oldest of scopes.keys()) {
    if (scopes.size <= SCOPE_STORES) break;
    scopes.delete(oldest);
  }
  return store;
}

/** The workspace's scope key changed (`enterScope`): later extents answer for it. */
export function enterExtentScope(key: string): void {
  currentKey = key;
  storeOf(key);
}

/**
 * The signal's extent, fetched once per tab and scope; a failed fetch is forgotten, so a later
 * call tries again.
 */
export function signalExtent(signalId: string): Promise<Extent> {
  const extents = scopes.get(currentKey) ?? storeOf(currentKey);
  const known = extents.get(signalId);
  if (known) return known;
  const extent = fetchExtent(signalId);
  extents.set(signalId, extent);
  extent.catch(() => {
    if (extents.get(signalId) === extent) extents.delete(signalId);
  });
  return extent;
}

/** Forgets every extent of every scope. */
export function forgetExtents(): void {
  scopes.clear();
}

/** Options of every timeseries window's loader. */
export const WINDOW_LOADER_OPTIONS: LoaderOptions = {
  loadIntervalMs: LOAD_INTERVAL_MS,
  extent: signalExtent,
  prefetch: true,
  retry: true,
};
