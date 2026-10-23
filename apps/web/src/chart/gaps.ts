import {
  computedInputIds,
  computedRef,
  computedSignalGaps,
  GAP_REFRESH_MS,
  type GapInfo,
  holdsSample,
  type LoggerGap,
  MAX_GAP_SIGNALS,
  parseSignalId,
  type SeriesResult,
  type SignalGaps,
  signalGaps,
  type TimeRange,
  type WorkspaceScope,
  workWindow,
} from "@kipscope/shared";
import { useCallback, useSyncExternalStore } from "react";
import { computedDefOf, fetchGaps, isCatalogLoading } from "../api.ts";

/** Scope keys whose extents and gap info are kept (add-case-open K12; the server keeps 4 scope lists too). */
export const SCOPE_STORES = 4;

/** A failed gap info is fetched again after this long while a window still asks for it (G7). */
export const GAP_RETRY_MS = 30_000;
/** While the server still loads its catalog, gap info is fetched again after this long at most. */
export const GAP_LOADING_RETRY_MS = 2_000;

/** The gap info of a window's data refs (design G7). */
export interface GapInfoState {
  infos: ReadonlyMap<string, GapInfo>;
  errors: { dataRef: string; message: string }[];
  /**
   * Every data ref failed, or its last fetch named each of the window's signals among the data
   * ref's first MAX_GAP_SIGNALS asked (improve-query-priority P8).
   */
  settled: boolean;
}

interface Entry {
  info?: GapInfo;
  /** `info` as JSON: a refetch replaces it only when the answer differs (G9 (c)). */
  json?: string;
  /** The last failure; kept while the retry runs, dropped on success. */
  error?: string;
  loading: boolean;
  retry?: ReturnType<typeof setTimeout>;
  /** The next refetch of a loaded info. */
  refresh?: ReturnType<typeof setTimeout>;
  /** Windows asking per signal; insertion order is first asked first (P8). */
  asks: Map<string, number>;
  /** Signals named by the last successful fetch. */
  named: ReadonlySet<string>;
  /** The scope changed while a fetch was in flight: its answer is dropped and fetched again. */
  again?: true;
}

/**
 * The signals whose gap info `signalIds` need: a computed ID stands for its used inputs on its data
 * ref (add-computed-signals C11, C3), dropped while it has no definition.
 */
function gapSignals(signalIds: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of signalIds) {
    const ref = computedRef(id);
    if (ref === undefined) {
      out.push(id);
      continue;
    }
    const def = computedDefOf(id);
    if (def) out.push(...computedInputIds(def, ref.dataRef));
  }
  return out;
}

/** The gap signals of the IDs once each, first occurrence first. */
const keyOf = (signalIds: readonly string[]) => [...new Set(gapSignals(signalIds))].join("\n");
const idsOf = (key: string) => (key === "" ? [] : key.split("\n"));

/** `signalIds` by data ref, in order; IDs without a data ref are left out. */
function byDataRef(signalIds: readonly string[]): Map<string, string[]> {
  const refs = new Map<string, string[]>();
  for (const id of signalIds) {
    const dataRef = parseSignalId(id)?.dataRef;
    if (dataRef === undefined) continue;
    const ids = refs.get(dataRef);
    if (ids) ids.push(id);
    else refs.set(dataRef, [id]);
  }
  return refs;
}

/** The signals a fetch of `entry` names: the first MAX_GAP_SIGNALS asked (P8). */
const toName = (entry: Entry) => [...entry.asks.keys()].slice(0, MAX_GAP_SIGNALS);

/** Work windows of one data ref kept unasked per scope key (the server keeps 8, K11). */
const KEPT_WINDOWS = 8;

/** Fetches the gap info of a data ref; `window` only in an object scope (add-case-open K11). */
export type FetchGapInfo = (
  dataRef: string,
  signals: readonly string[],
  window?: TimeRange,
) => Promise<GapInfo>;

/** Where an entry belongs: the scope key, the data ref and, in an object scope, the work window. */
interface Place {
  scope: string;
  ref: string;
  window?: TimeRange | undefined;
}

const windowText = (w: TimeRange | undefined) => (w ? `${w.from}|${w.to}` : "");
const entryKey = (p: Place) => `${p.scope}\n${p.ref}\n${windowText(p.window)}`;

/**
 * Gap info per data ref for one browser tab (design G7, improve-query-priority P8): one request in
 * flight per data ref, shared by every window, naming the first MAX_GAP_SIGNALS signals the
 * windows ask for; a newly asked signal starts a fetch at once (or right after the one in
 * flight). A failure is kept as an error and fetched again every `retryMs` while any window still
 * asks for that data ref; a 503 `catalog_unavailable` is no error but loading, fetched again
 * within GAP_LOADING_RETRY_MS. A loaded info is fetched again every `refreshMs` while asked for
 * (G9 (c)): replaced only by a different answer, kept on a failure without an error.
 */
export class GapInfoStore {
  /** By entryKey: per scope key and data ref (and work window in an object scope, K12). */
  private readonly entries = new Map<string, Entry & { place: Place }>();
  private readonly listeners = new Set<() => void>();
  // States by place and signal ID key, stable until one of their entries changes (useSyncExternalStore).
  private readonly snapshots = new Map<string, { refs: string[]; state: GapInfoState }>();
  /** Scope keys whose gap info is kept, least recently used first (K12). */
  private readonly scopes: string[] = [];

  private readonly fetchInfo: FetchGapInfo;
  private readonly retryMs: number;
  private readonly refreshMs: number;

  constructor(
    fetchInfo: FetchGapInfo = (dataRef, signals, window) =>
      fetchGaps(dataRef, signals, undefined, window),
    retryMs = GAP_RETRY_MS,
    refreshMs = GAP_REFRESH_MS,
  ) {
    this.fetchInfo = fetchInfo;
    this.retryMs = retryMs;
    this.refreshMs = refreshMs;
  }

  /**
   * The workspace entered scope `key` (`enterScope`): it becomes the most recently used; the gap
   * info of the least recently used beyond SCOPE_STORES scope keys is forgotten unless asked (K12).
   */
  enter(key: string): void {
    const at = this.scopes.indexOf(key);
    if (at >= 0) this.scopes.splice(at, 1);
    this.scopes.push(key);
    while (this.scopes.length > SCOPE_STORES) {
      const dropped = this.scopes.shift();
      for (const [k, entry] of this.entries) {
        if (entry.place.scope === dropped && entry.asks.size === 0) this.drop(k, entry);
      }
    }
  }

  private drop(key: string, entry: Entry): void {
    clearTimeout(entry.retry);
    clearTimeout(entry.refresh);
    this.entries.delete(key);
    this.invalidate(key);
  }

  /**
   * Asks for `signalIds` under scope key `scope` (in an object scope with its work `window`) until
   * the returned release is called; `listener` hears every change.
   */
  ask(
    signalIds: readonly string[],
    listener: () => void,
    scope = "",
    window?: TimeRange,
  ): () => void {
    const refs = new Map(
      [...byDataRef(idsOf(keyOf(signalIds)))].map(([ref, ids]) => {
        const place: Place = { scope, ref, window };
        return [entryKey(place), { place, ids }] as const;
      }),
    );
    this.listeners.add(listener);
    for (const [ref, { place, ids }] of refs) {
      let entry = this.entries.get(ref);
      if (!entry) {
        entry = { loading: false, asks: new Map(), named: new Set(), place };
        this.entries.set(ref, entry);
        if (window) this.trimWindows(place);
      }
      for (const id of ids) entry.asks.set(id, (entry.asks.get(id) ?? 0) + 1);
      // A loaded info whose refetch fell due while nobody asked is fetched again now.
      if (!entry.loading && entry.retry === undefined && entry.refresh === undefined)
        this.load(ref, entry);
      this.follow(ref, entry);
    }
    return () => {
      this.listeners.delete(listener);
      for (const [ref, { ids }] of refs) {
        const entry = this.entries.get(ref);
        if (!entry) continue;
        for (const id of ids) {
          const n = (entry.asks.get(id) ?? 0) - 1;
          if (n > 0) entry.asks.set(id, n);
          else entry.asks.delete(id);
        }
        // A signal beyond the first MAX_GAP_SIGNALS may have moved up.
        if (entry.asks.size > 0) this.follow(ref, entry);
      }
    };
  }

  /** Keeps at most KEPT_WINDOWS unasked work windows of `place`'s scope and data ref. */
  private trimWindows(place: Place): void {
    const unasked = [...this.entries].filter(
      ([, e]) =>
        e.place.scope === place.scope &&
        e.place.ref === place.ref &&
        e.place.window !== undefined &&
        e.asks.size === 0,
    );
    for (const [k, entry] of unasked.slice(0, Math.max(0, unasked.length - KEPT_WINDOWS))) {
      this.drop(k, entry);
    }
  }

  /**
   * Fetches every asked entry again now (a fetch in flight drops its answer first), and forgets
   * entries nobody asks for.
   */
  reload(): void {
    for (const [ref, entry] of this.entries) {
      if (entry.asks.size === 0) this.drop(ref, entry);
      else if (entry.loading) entry.again = true;
      else this.load(ref, entry);
    }
  }

  /**
   * The state of `signalIds`' data refs under scope key `scope` (and work `window`); the same
   * object until one of them changes.
   */
  state(signalIds: readonly string[], scope = "", window?: TimeRange): GapInfoState {
    const key = keyOf(signalIds);
    const snapshotKey = `${scope}\n${windowText(window)}\n${key}`;
    let snapshot = this.snapshots.get(snapshotKey);
    if (!snapshot) {
      const infos = new Map<string, GapInfo>();
      const errors: GapInfoState["errors"] = [];
      let settled = true;
      const refs = byDataRef(idsOf(key));
      const keys: string[] = [];
      for (const [ref, ids] of refs) {
        const k = entryKey({ scope, ref, window });
        keys.push(k);
        const entry = this.entries.get(k);
        if (entry?.info) infos.set(ref, entry.info);
        if (entry && this.covered(entry, ids)) continue;
        if (entry?.error !== undefined) errors.push({ dataRef: ref, message: entry.error });
        else settled = false;
      }
      snapshot = { refs: keys, state: { infos, errors, settled } };
      this.snapshots.set(snapshotKey, snapshot);
    }
    return snapshot.state;
  }

  /**
   * Whether the last successful fetch named each of `ids`, except those asked beyond the first
   * MAX_GAP_SIGNALS. An ID not asked yet (a render before its window subscribed) is not covered.
   */
  private covered(entry: Entry, ids: readonly string[]): boolean {
    if (!entry.info) return false;
    const first = new Set(toName(entry));
    return ids.every((id) => entry.named.has(id) || (entry.asks.has(id) && !first.has(id)));
  }

  /** Fetches again, at once or after the fetch in flight, when a signal to name is not named yet. */
  private follow(ref: string, entry: Entry & { place: Place }): void {
    this.invalidate(ref);
    // With a fetch in flight, its answer handler checks again (`next`).
    if (!entry.loading && toName(entry).some((id) => !entry.named.has(id))) this.load(ref, entry);
  }

  private load(ref: string, entry: Entry & { place: Place }): void {
    clearTimeout(entry.retry);
    clearTimeout(entry.refresh);
    delete entry.retry;
    delete entry.refresh;
    const names = toName(entry);
    const named = new Set(names);
    entry.loading = true;
    // An answer of the scope before a `reload` is dropped and fetched again.
    const stale = () => {
      if (!entry.again) return false;
      delete entry.again;
      if (this.entries.get(ref) === entry && entry.asks.size > 0) this.load(ref, entry);
      return true;
    };
    const { place } = entry;
    (place.window
      ? this.fetchInfo(place.ref, names, place.window)
      : this.fetchInfo(place.ref, names)
    ).then(
      (info) => {
        entry.loading = false;
        if (stale()) return;
        const json = JSON.stringify(info);
        const fresh = !entry.info || json !== entry.json;
        const settledChanged =
          entry.error !== undefined ||
          named.size !== entry.named.size ||
          names.some((id) => !entry.named.has(id));
        entry.named = named;
        if (fresh) {
          entry.info = info;
          entry.json = json;
        }
        delete entry.error;
        this.next(ref, entry);
        if (fresh || settledChanged) this.changed(ref);
      },
      (error: unknown) => {
        entry.loading = false;
        if (stale()) return;
        // A failed refetch of the signals named before keeps the loaded info and tries again at
        // the next interval; a failure for a new signal is an error for its window.
        if (entry.info && names.every((id) => entry.named.has(id))) {
          this.next(ref, entry);
          return;
        }
        // The server still loads its catalog: not an error, the data ref stays unsettled and is
        // fetched again soon.
        const loading = isCatalogLoading(error);
        const hadError = entry.error !== undefined;
        if (loading) delete entry.error;
        else entry.error = error instanceof Error ? error.message : String(error);
        entry.retry = setTimeout(
          () => {
            delete entry.retry;
            if (entry.asks.size > 0) this.load(ref, entry);
          },
          loading ? Math.min(this.retryMs, GAP_LOADING_RETRY_MS) : this.retryMs,
        );
        if (!loading || hadError) this.changed(ref);
      },
    );
  }

  /** After a fetch: at once for a signal asked meanwhile, else the next refetch. */
  private next(ref: string, entry: Entry & { place: Place }): void {
    if (entry.asks.size > 0 && toName(entry).some((id) => !entry.named.has(id))) {
      this.load(ref, entry);
      return;
    }
    entry.refresh = setTimeout(() => {
      delete entry.refresh;
      if (entry.asks.size > 0) this.load(ref, entry);
    }, this.refreshMs);
  }

  private invalidate(ref: string): void {
    for (const [key, snapshot] of this.snapshots) {
      if (snapshot.refs.includes(ref)) this.snapshots.delete(key);
    }
  }

  private changed(ref: string): void {
    this.invalidate(ref);
    for (const listener of [...this.listeners]) listener();
  }
}

/** The tab's gap info, shared by all windows (like the strip's densities). */
export const gapInfoStore = new GapInfoStore();

/**
 * The work window to ask gap info for in an object scope (K11): `held` while it still contains
 * `view`, else the work window around `view`; undefined outside an object scope.
 */
export function heldWorkWindow(
  held: TimeRange | undefined,
  view: TimeRange,
  scope: WorkspaceScope | undefined,
): TimeRange | undefined {
  if (!scope?.object) return undefined;
  const inside =
    held !== undefined &&
    BigInt(held.from) <= BigInt(view.from) &&
    BigInt(view.to) <= BigInt(held.to);
  return inside ? held : workWindow(view, scope);
}

/**
 * Gap info of the data refs of `signalIds` under scope key `scope` (in an object scope of the work
 * `window`, K11) from the tab's store; asks for those signals while the component is mounted.
 * Never holds back a draw: a signal without its period yet splits at logger gaps only until the
 * answer is in (P8).
 */
export function useGapInfo(
  signalIds: readonly string[],
  scope = "",
  window?: TimeRange,
): GapInfoState {
  const key = keyOf(signalIds);
  const from = window?.from;
  const to = window?.to;
  const subscribe = useCallback(
    (onChange: () => void) =>
      gapInfoStore.ask(
        idsOf(key),
        onChange,
        scope,
        from !== undefined && to !== undefined ? { from, to } : undefined,
      ),
    [key, scope, from, to],
  );
  const snapshot = useCallback(
    () =>
      gapInfoStore.state(
        idsOf(key),
        scope,
        from !== undefined && to !== undefined ? { from, to } : undefined,
      ),
    [key, scope, from, to],
  );
  return useSyncExternalStore(subscribe, snapshot);
}

/**
 * Gaps of one signal from its data ref's gap info (`signalGaps`); a computed signal's from its
 * inputs' periods (C3), only logger gaps while its definition is unknown.
 */
export function gapsOf(info: GapInfo | undefined, signalId: string): SignalGaps {
  const ref = computedRef(signalId);
  const def = ref && computedDefOf(signalId);
  // An ID the gap info does not know gets its data ref's logger gaps and no period.
  return ref && def ? computedSignalGaps(info, ref.dataRef, def) : signalGaps(info, signalId);
}

/**
 * The logger gaps that meet the view [from, to], clipped to it (time order kept), without those
 * that hold a sample of one of `results` (stale, G9 (a)); `results` of the gaps' data ref only.
 * Pure.
 */
export function bandsIn(
  logger: readonly LoggerGap[],
  from: bigint,
  to: bigint,
  results: readonly SeriesResult[] = [],
): LoggerGap[] {
  const bands: LoggerGap[] = [];
  for (const gap of logger) {
    if (gap.to <= from || gap.from >= to) continue;
    if (results.some((r) => holdsSample(r, gap))) continue;
    bands.push({ from: gap.from > from ? gap.from : from, to: gap.to < to ? gap.to : to });
  }
  return bands;
}
