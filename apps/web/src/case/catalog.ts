import type { CaseCatalog } from "@kipscope/shared";
import { useEffect, useState } from "react";
import { fetchCase } from "../api.ts";

/** A failed catalog fetch is tried again after this long while the bar shows its case. */
export const CATALOG_RETRY_MS = 5_000;

/** Per catalogId: its catalog, fetched once per tab (immutable for one catalogId, K2). */
const catalogs = new Map<string, Promise<CaseCatalog>>();

/**
 * The catalog `catalogId` of the page's workspace (`GET /api/case`), fetched once per catalogId; a
 * failure, or an answer for another catalog, is forgotten, so a later call fetches again.
 */
export function loadCatalog(
  catalogId: string,
  fetchCatalog: (abort?: AbortSignal) => Promise<CaseCatalog> = fetchCase,
): Promise<CaseCatalog> {
  const known = catalogs.get(catalogId);
  if (known) return known;
  const loading = fetchCatalog().then((catalog) => {
    if (catalog.catalogId !== catalogId) throw new Error("the workspace holds another catalog");
    return catalog;
  });
  catalogs.set(catalogId, loading);
  loading.catch(() => {
    if (catalogs.get(catalogId) === loading) catalogs.delete(catalogId);
  });
  return loading;
}

/** Test seam: forgets every loaded catalog. */
export function forgetCatalogsForTest(): void {
  catalogs.clear();
}

/**
 * The entries of the open catalog `catalogId` (undefined without one or while loading); a failed
 * fetch is tried again every CATALOG_RETRY_MS.
 */
export function useCaseCatalog(catalogId: string | undefined): CaseCatalog | undefined {
  const [loaded, setLoaded] = useState<CaseCatalog | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is the retry trigger
  useEffect(() => {
    if (catalogId === undefined) return;
    let live = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    loadCatalog(catalogId).then(
      (catalog) => {
        if (live) setLoaded(catalog);
      },
      () => {
        if (live) retry = setTimeout(() => setAttempt((n) => n + 1), CATALOG_RETRY_MS);
      },
    );
    return () => {
      live = false;
      clearTimeout(retry);
    };
  }, [catalogId, attempt]);
  return loaded?.catalogId === catalogId ? loaded : undefined;
}
