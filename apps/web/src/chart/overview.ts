import type { Extent } from "@letsview/shared";
import { fetchExtent } from "../api.ts";
import { LOAD_INTERVAL_MS, type LoaderOptions } from "./loader.ts";

/** Per signal: its extent, fetched once per tab (Z2). */
const extents = new Map<string, Promise<Extent>>();

/** The signal's extent, fetched once per tab; a failed fetch is forgotten, so a later call tries again. */
export function signalExtent(signalId: string): Promise<Extent> {
  const known = extents.get(signalId);
  if (known) return known;
  const extent = fetchExtent(signalId);
  extents.set(signalId, extent);
  extent.catch(() => {
    if (extents.get(signalId) === extent) extents.delete(signalId);
  });
  return extent;
}

/** Options of every timeseries window's loader. */
export const WINDOW_LOADER_OPTIONS: LoaderOptions = {
  loadIntervalMs: LOAD_INTERVAL_MS,
  extent: signalExtent,
  prefetch: true,
};
