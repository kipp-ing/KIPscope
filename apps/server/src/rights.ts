import {
  buildSearchIndex,
  type Command,
  GRANT_ALL,
  GRANT_NONE,
  type Grant,
  type Granted,
  parseSignalId,
  parseViewDoc,
  type SearchIndex,
  type SignalInfo,
  type SignalPage,
  searchSignals,
  type WorkspaceRights,
  type WorkspaceShare,
} from "@kipscope/shared";
import { type Catalog, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./catalog.ts";
import type { IdentityConfig } from "./config.ts";

/**
 * Grant checks and workspace rights (add-multiuser M3, M6): pure functions the guard, the
 * registry and the routes share. KI.ping decides what a workspace may read (D-085); KIPscope only
 * holds and enforces the grant.
 */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** One Set per grant object (design "Numbers": O(1) per data ref). */
const grantSets = new WeakMap<Grant, ReadonlySet<string>>();

function setOf(objects: readonly string[], grant: Grant): ReadonlySet<string> {
  let set = grantSets.get(grant);
  if (!set) {
    set = new Set(objects);
    grantSets.set(grant, set);
  }
  return set;
}

/** true for "all"; else exact membership of the data ref (no patterns, no time part, D-086). */
export function covers(grant: Grant, dataRef: string): boolean {
  const { objects } = grant;
  if (objects === "all") return true;
  return setOf(objects, grant).has(dataRef);
}

/**
 * The grant the guard uses: GRANT_ALL with identity none; GRANT_NONE for a stored "all" with any
 * other identity (state carried over from local use never grants on a server); else as stored.
 */
export function effectiveGrant(stored: Grant, identity: IdentityConfig["kind"]): Grant {
  if (identity === "none") return GRANT_ALL;
  return stored.objects === "all" ? GRANT_NONE : stored;
}

/** A new workspace's grant: GRANT_ALL with identity none, else GRANT_NONE. */
export function initialGrant(identity: IdentityConfig["kind"]): Grant {
  return identity === "none" ? GRANT_ALL : GRANT_NONE;
}

/** What a client learns of a grant: "all", or the number of objects. */
export function grantedOf(grant: Grant): Granted {
  return grant.objects === "all" ? "all" : grant.objects.length;
}

const dataRefOf = (id: unknown): string | undefined =>
  typeof id === "string" ? parseSignalId(id)?.dataRef : undefined;

function unique(refs: readonly (string | undefined)[]): string[] {
  return [...new Set(refs.filter((r): r is string => r !== undefined))];
}

const listOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * Data refs a view document names: its scope, window signals and events signals. A document the
 * parser reads is taken as parsed; any other value as far as its shape goes, so a document that
 * will be refused anyway still names what it holds.
 */
export function dataRefsOfView(document: unknown): string[] {
  const parsed = parseViewDoc(document);
  if (parsed.ok) {
    const { doc } = parsed;
    return unique([
      doc.scope?.dataRef,
      ...doc.windows.flatMap((w) => w.signals.map(dataRefOf)),
      ...(doc.events?.signals ?? []).map(dataRefOf),
    ]);
  }
  if (!isRecord(document)) return [];
  const scope = isRecord(document.scope) ? document.scope.dataRef : undefined;
  const events = isRecord(document.events) ? document.events.signals : undefined;
  return unique([
    typeof scope === "string" ? scope : undefined,
    ...listOf(document.windows).flatMap((w) =>
      isRecord(w) ? listOf(w.signals).map(dataRefOf) : [],
    ),
    ...listOf(events).map(dataRefOf),
  ]);
}

/** Data refs a command names (design M6 table); a command that names none gives []. */
export function dataRefsOfCommand(command: Command): string[] {
  switch (command.type) {
    case "window.addSignal":
    case "events.addSignal":
      return unique([dataRefOf(command.signalId)]);
    case "scope.set":
      return [command.dataRef];
    case "view.open":
      // A caller-given scope opens on its data ref as much as the document's own.
      return unique([command.scope?.dataRef, ...dataRefsOfView(command.view)]);
    default:
      return [];
  }
}

/**
 * A user's rights on a workspace (design M6): by owner and share level only. There is no data
 * condition, since a workspace's data is always covered by its own grant (M3 invariant).
 */
export function workspaceRights(
  user: string,
  entry: { readonly record: { readonly owner: string; readonly share: WorkspaceShare } },
): WorkspaceRights | undefined {
  const { owner, share } = entry.record;
  if (owner === user) return { open: true, change: true, owner: true };
  if (share === "write") return { open: true, change: true, owner: false };
  if (share === "read") return { open: true, change: false, owner: false };
  return undefined;
}

/** A shared signal list as one workspace's grant shows it (design M6 "Filtered lists"). */
export interface CatalogView
  extends Pick<Catalog, "loadedAt" | "lastError" | "unavailableReason" | "refresh"> {
  /** Undefined for a signal outside the grant. */
  get(id: string): SignalInfo | undefined;
  /** Visible signals only. */
  all(): readonly SignalInfo[];
  /** Over visible signals; `total` counts them only. */
  search(q: string, offset: number, limit: number): SignalPage;
  snaRanges(id: string): ReturnType<Catalog["snaRanges"]>;
  /** Visible signals. */
  readonly size: number;
}

interface Visible {
  readonly signals: readonly SignalInfo[];
  readonly index: SearchIndex;
}

/** Visible signals per loaded list (keyed by its entries array, which a load replaces) and grant. */
const visibleCache = new WeakMap<readonly SignalInfo[], WeakMap<Grant, Visible>>();

function visibleOf(all: readonly SignalInfo[], grant: Grant): Visible {
  let byGrant = visibleCache.get(all);
  if (!byGrant) {
    byGrant = new WeakMap();
    visibleCache.set(all, byGrant);
  }
  let visible = byGrant.get(grant);
  if (!visible) {
    const signals = all.filter((s) => covers(grant, s.dataRef));
    visible = { signals, index: buildSearchIndex(signals) };
    byGrant.set(grant, visible);
  }
  return visible;
}

/**
 * The view of a shared list for `grant`: the list itself for "all", else one that hides the
 * signals of data refs outside the grant from lookups, lists, searches and counts. The list
 * itself, its loads and caches stay shared.
 */
export function catalogView(catalog: Catalog, grant: Grant): CatalogView {
  if (grant.objects === "all") return catalog;
  const visible = (id: string) => {
    const ref = parseSignalId(id)?.dataRef;
    return ref !== undefined && covers(grant, ref);
  };
  return {
    get loadedAt() {
      return catalog.loadedAt;
    },
    get lastError() {
      return catalog.lastError;
    },
    get unavailableReason() {
      return catalog.unavailableReason;
    },
    refresh: () => catalog.refresh(),
    get: (id) => (visible(id) ? catalog.get(id) : undefined),
    all: () => visibleOf(catalog.all(), grant).signals,
    search(q, offset = 0, limit = DEFAULT_PAGE_SIZE) {
      const matches = searchSignals(visibleOf(catalog.all(), grant).index, q).map((m) => m.signal);
      const size = Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);
      const items = matches.slice(offset, offset + size);
      return { items, total: matches.length, more: offset + items.length < matches.length };
    },
    snaRanges: (id) => (visible(id) ? catalog.snaRanges(id) : []),
    get size() {
      return visibleOf(catalog.all(), grant).signals.length;
    },
  };
}
