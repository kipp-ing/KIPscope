import type { GapInfo, LoggerGap } from "@kipscope/shared";
import { useCallback, useSyncExternalStore } from "react";
import { fetchGaps } from "../api.ts";

/** A failed gap info is fetched again after this long while a window still asks for it (G7). */
export const GAP_RETRY_MS = 30_000;

/** The gap info of a window's data refs (design G7). */
export interface GapInfoState {
  infos: ReadonlyMap<string, GapInfo>;
  errors: { dataRef: string; message: string }[];
  /** Every data ref loaded or failed. */
  settled: boolean;
}

interface Entry {
  info?: GapInfo;
  /** The last failure; kept while the retry runs, dropped on success. */
  error?: string;
  loading: boolean;
  retry?: ReturnType<typeof setTimeout>;
  /** Windows asking for this data ref. */
  wanted: number;
}

const keyOf = (dataRefs: readonly string[]) => [...new Set(dataRefs)].sort().join("\n");
const refsOf = (key: string) => (key === "" ? [] : key.split("\n"));

/**
 * Gap info per data ref for one browser tab (design G7): one request in flight per data ref,
 * shared by every window; a loaded info is kept for the tab's life; a failure is kept as an error
 * and fetched again every `retryMs` while any window still asks for that data ref.
 */
export class GapInfoStore {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<() => void>();
  // States by data ref key, stable until one of their data refs changes (useSyncExternalStore).
  private readonly snapshots = new Map<string, GapInfoState>();

  private readonly fetchInfo: (dataRef: string) => Promise<GapInfo>;
  private readonly retryMs: number;

  constructor(
    fetchInfo: (dataRef: string) => Promise<GapInfo> = fetchGaps,
    retryMs = GAP_RETRY_MS,
  ) {
    this.fetchInfo = fetchInfo;
    this.retryMs = retryMs;
  }

  /** Asks for `dataRefs` until the returned release is called; `listener` hears every change. */
  ask(dataRefs: readonly string[], listener: () => void): () => void {
    const refs = refsOf(keyOf(dataRefs));
    this.listeners.add(listener);
    for (const ref of refs) {
      let entry = this.entries.get(ref);
      if (!entry) {
        entry = { loading: false, wanted: 0 };
        this.entries.set(ref, entry);
      }
      entry.wanted++;
      if (!entry.info && !entry.loading && entry.retry === undefined) this.load(ref, entry);
    }
    return () => {
      this.listeners.delete(listener);
      for (const ref of refs) {
        const entry = this.entries.get(ref);
        if (entry) entry.wanted--;
      }
    };
  }

  /** The state of `dataRefs`; the same object until one of them changes. */
  state(dataRefs: readonly string[]): GapInfoState {
    const key = keyOf(dataRefs);
    let state = this.snapshots.get(key);
    if (!state) {
      const infos = new Map<string, GapInfo>();
      const errors: GapInfoState["errors"] = [];
      let settled = true;
      for (const ref of refsOf(key)) {
        const entry = this.entries.get(ref);
        if (entry?.info) infos.set(ref, entry.info);
        else if (entry?.error !== undefined) errors.push({ dataRef: ref, message: entry.error });
        else settled = false;
      }
      state = { infos, errors, settled };
      this.snapshots.set(key, state);
    }
    return state;
  }

  private load(ref: string, entry: Entry): void {
    entry.loading = true;
    this.fetchInfo(ref).then(
      (info) => {
        entry.loading = false;
        entry.info = info;
        delete entry.error;
        this.changed(ref);
      },
      (error: unknown) => {
        entry.loading = false;
        entry.error = error instanceof Error ? error.message : String(error);
        entry.retry = setTimeout(() => {
          delete entry.retry;
          if (entry.wanted > 0) this.load(ref, entry);
        }, this.retryMs);
        this.changed(ref);
      },
    );
  }

  private changed(ref: string): void {
    for (const key of this.snapshots.keys()) {
      if (refsOf(key).includes(ref)) this.snapshots.delete(key);
    }
    for (const listener of [...this.listeners]) listener();
  }
}

/** The tab's gap info, shared by all windows (like the strip's densities). */
export const gapInfoStore = new GapInfoStore();

/** Gap info of `dataRefs` from the tab's store; asks for them while the component is mounted. */
export function useGapInfo(dataRefs: readonly string[]): GapInfoState {
  const key = keyOf(dataRefs);
  const subscribe = useCallback(
    (onChange: () => void) => gapInfoStore.ask(refsOf(key), onChange),
    [key],
  );
  const snapshot = useCallback(() => gapInfoStore.state(refsOf(key)), [key]);
  return useSyncExternalStore(subscribe, snapshot);
}

/** The logger gaps that meet the view [from, to], clipped to it (time order kept). Pure. */
export function bandsIn(logger: readonly LoggerGap[], from: bigint, to: bigint): LoggerGap[] {
  const bands: LoggerGap[] = [];
  for (const gap of logger) {
    if (gap.to <= from || gap.from >= to) continue;
    bands.push({ from: gap.from > from ? gap.from : from, to: gap.to < to ? gap.to : to });
  }
  return bands;
}
