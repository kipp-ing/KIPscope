import { useLayoutEffect, useRef } from "react";
import { tabSeriesCache } from "./cache.ts";
import { gapInfoStore } from "./gaps.ts";
import { forgetExtents } from "./overview.ts";

let current: string | undefined;

/**
 * The tab's series tiles, extents and gap info answer for one scope (add-scope Z12): the first
 * call with another scope key forgets them, so every later load asks the server under the new
 * scope. Every window calls it before it loads again; later calls with the same key do nothing.
 * True when the key changed (not on the tab's first call).
 */
export function enterScope(key: string): boolean {
  if (key === current) return false;
  const first = current === undefined;
  current = key;
  if (first) return false;
  tabSeriesCache().clear();
  forgetExtents();
  gapInfoStore.reload();
  return true;
}

/**
 * A window's part of a scope change: before its loads of the commit, the tab's caches follow
 * `key` (`enterScope`), then `rescope` runs when `key` differs from the last commit's (not on
 * mount), so the window's failed loads ask again under the new scope (add-scope Z12).
 */
export function useScopeChange(key: string, rescope: () => void): void {
  const seen = useRef(key);
  const latest = useRef(rescope);
  latest.current = rescope;
  useLayoutEffect(() => {
    enterScope(key);
    if (seen.current === key) return;
    seen.current = key;
    latest.current();
  }, [key]);
}
