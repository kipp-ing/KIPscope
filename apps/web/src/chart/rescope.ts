import type { WorkspaceScope } from "@kipscope/shared";
import { useLayoutEffect, useRef, useState } from "react";
import { tabSeriesCache } from "./cache.ts";
import { gapInfoStore } from "./gaps.ts";
import { enterExtentScope } from "./overview.ts";

let current: string | undefined;

/**
 * The scope a `scopeKey` names (`<dataRef>|<from>|<to>[|object]`), undefined for "" (no scope).
 * The data ref may hold "|", so the times are read from the end.
 */
export function scopeOfKey(key: string): WorkspaceScope | undefined {
  if (key === "") return undefined;
  const object = key.endsWith("|object");
  const parts = (object ? key.slice(0, -"|object".length) : key).split("|");
  const to = parts.pop() ?? "";
  const from = parts.pop() ?? "";
  return { dataRef: parts.join("|"), from, to, ...(object ? { object: true as const } : {}) };
}

/**
 * The tab's series tiles, extents and gap info follow the workspace's scope (add-case-open K12):
 * nothing is cleared; the cache stores and answers by the scope's rules, and the extents of the 4
 * most recent scope keys are kept. Every window calls it before it loads again; later calls with
 * the same key do nothing. True when the key changed (not on the tab's first call).
 */
export function enterScope(key: string): boolean {
  if (key === current) return false;
  const first = current === undefined;
  current = key;
  tabSeriesCache().setScope(scopeOfKey(key));
  enterExtentScope(key);
  gapInfoStore.enter(key);
  return !first;
}

/** Test seam: forgets the tab's scope key, so the next `enterScope` is a first call again. */
export function resetScopeForTest(): void {
  current = undefined;
}

/** True, and remembers `key`, when it differs from the last key seen (starts at `initialKey`). */
export function scopeChangeWatcher(initialKey: string): (key: string) => boolean {
  let seen = initialKey;
  return (key) => {
    if (key === seen) return false;
    seen = key;
    return true;
  };
}

/**
 * A window's part of a scope change: before its loads of the commit, the tab's caches follow
 * `key` (`enterScope`), then `rescope` runs when `key` differs from the last commit's (not on
 * mount), so the window asks again under the new scope and the cache answers what it may (K12).
 */
export function useScopeChange(key: string, rescope: () => void): void {
  const [changed] = useState(() => scopeChangeWatcher(key));
  const latest = useRef(rescope);
  latest.current = rescope;
  useLayoutEffect(() => {
    enterScope(key);
    if (changed(key)) latest.current();
  }, [key, changed]);
}
