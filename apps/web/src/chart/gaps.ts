import {
  GAP_REFRESH_MS,
  type GapInfo,
  holdsSample,
  type LoggerGap,
  MAX_GAP_SIGNALS,
  parseSignalId,
  type SeriesResult,
} from "@kipscope/shared";
import { useCallback, useSyncExternalStore } from "react";
import { fetchGaps } from "../api.ts";

/** A failed gap info is fetched again after this long while a window still asks for it (G7). */
export const GAP_RETRY_MS = 30_000;

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
}

/** The IDs once each, first occurrence first. */
const keyOf = (signalIds: readonly string[]) => [...new Set(signalIds)].join("\n");
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

/**
 * Gap info per data ref for one browser tab (design G7, improve-query-priority P8): one request in
 * flight per data ref, shared by every window, naming the first MAX_GAP_SIGNALS signals the
 * windows ask for; a newly asked signal starts a fetch at once (or right after the one in
 * flight). A failure is kept as an error and fetched again every `retryMs` while any window still
 * asks for that data ref. A loaded info is fetched again every `refreshMs` while asked for
 * (G9 (c)): replaced only by a different answer, kept on a failure without an error.
 */
export class GapInfoStore {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<() => void>();
  // States by signal ID key, stable until one of their data refs changes (useSyncExternalStore).
  private readonly snapshots = new Map<string, { refs: string[]; state: GapInfoState }>();

  private readonly fetchInfo: (dataRef: string, signals: readonly string[]) => Promise<GapInfo>;
  private readonly retryMs: number;
  private readonly refreshMs: number;

  constructor(
    fetchInfo: (dataRef: string, signals: readonly string[]) => Promise<GapInfo> = fetchGaps,
    retryMs = GAP_RETRY_MS,
    refreshMs = GAP_REFRESH_MS,
  ) {
    this.fetchInfo = fetchInfo;
    this.retryMs = retryMs;
    this.refreshMs = refreshMs;
  }

  /** Asks for `signalIds` until the returned release is called; `listener` hears every change. */
  ask(signalIds: readonly string[], listener: () => void): () => void {
    const refs = byDataRef(idsOf(keyOf(signalIds)));
    this.listeners.add(listener);
    for (const [ref, ids] of refs) {
      let entry = this.entries.get(ref);
      if (!entry) {
        entry = { loading: false, asks: new Map(), named: new Set() };
        this.entries.set(ref, entry);
      }
      for (const id of ids) entry.asks.set(id, (entry.asks.get(id) ?? 0) + 1);
      // A loaded info whose refetch fell due while nobody asked is fetched again now.
      if (!entry.loading && entry.retry === undefined && entry.refresh === undefined)
        this.load(ref, entry);
      this.follow(ref, entry);
    }
    return () => {
      this.listeners.delete(listener);
      for (const [ref, ids] of refs) {
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

  /** The state of `signalIds`' data refs; the same object until one of them changes. */
  state(signalIds: readonly string[]): GapInfoState {
    const key = keyOf(signalIds);
    let snapshot = this.snapshots.get(key);
    if (!snapshot) {
      const infos = new Map<string, GapInfo>();
      const errors: GapInfoState["errors"] = [];
      let settled = true;
      const refs = byDataRef(idsOf(key));
      for (const [ref, ids] of refs) {
        const entry = this.entries.get(ref);
        if (entry?.info) infos.set(ref, entry.info);
        if (entry && this.covered(entry, ids)) continue;
        if (entry?.error !== undefined) errors.push({ dataRef: ref, message: entry.error });
        else settled = false;
      }
      snapshot = { refs: [...refs.keys()], state: { infos, errors, settled } };
      this.snapshots.set(key, snapshot);
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
  private follow(ref: string, entry: Entry): void {
    this.invalidate(ref);
    // With a fetch in flight, its answer handler checks again (`next`).
    if (!entry.loading && toName(entry).some((id) => !entry.named.has(id))) this.load(ref, entry);
  }

  private load(ref: string, entry: Entry): void {
    clearTimeout(entry.retry);
    clearTimeout(entry.refresh);
    delete entry.retry;
    delete entry.refresh;
    const names = toName(entry);
    const named = new Set(names);
    entry.loading = true;
    this.fetchInfo(ref, names).then(
      (info) => {
        entry.loading = false;
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
        // A failed refetch of the signals named before keeps the loaded info and tries again at
        // the next interval; a failure for a new signal is an error for its window.
        if (entry.info && names.every((id) => entry.named.has(id))) {
          this.next(ref, entry);
          return;
        }
        entry.error = error instanceof Error ? error.message : String(error);
        entry.retry = setTimeout(() => {
          delete entry.retry;
          if (entry.asks.size > 0) this.load(ref, entry);
        }, this.retryMs);
        this.changed(ref);
      },
    );
  }

  /** After a fetch: at once for a signal asked meanwhile, else the next refetch. */
  private next(ref: string, entry: Entry): void {
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
 * Gap info of the data refs of `signalIds` from the tab's store; asks for those signals while the
 * component is mounted. Never holds back a draw: a signal without its period yet splits at logger
 * gaps only until the answer is in (P8).
 */
export function useGapInfo(signalIds: readonly string[]): GapInfoState {
  const key = keyOf(signalIds);
  const subscribe = useCallback(
    (onChange: () => void) => gapInfoStore.ask(idsOf(key), onChange),
    [key],
  );
  const snapshot = useCallback(() => gapInfoStore.state(idsOf(key)), [key]);
  return useSyncExternalStore(subscribe, snapshot);
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
