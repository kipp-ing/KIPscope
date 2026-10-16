import type { ServerMeta } from "@kipscope/shared";
import { useEffect, useRef, useState } from "react";
import { fetchMeta } from "../api.ts";

/** Interval of the meta refresh (app-footer "Meta refresh"). */
export const META_POLL_MS = 30_000;

type MetaState = { meta?: ServerMeta; stale: boolean };

/**
 * Returns a `load` that fetches the meta on each call. Only the answer of the latest call reaches
 * `apply`; an older fetch that settles after a newer one was started is dropped, so a slow poll
 * cannot overwrite a newer meta or stale flag.
 */
export function metaLoader(
  fetch: (signal: AbortSignal) => Promise<ServerMeta>,
  apply: (update: (s: MetaState) => MetaState) => void,
  signal: AbortSignal,
): () => void {
  let latest = 0;
  return () => {
    const call = ++latest;
    const current = () => call === latest && !signal.aborted;
    fetch(signal).then(
      (meta) => {
        if (current()) apply(() => ({ meta, stale: false }));
      },
      () => {
        if (current()) apply((s) => ({ ...s, stale: true }));
      },
    );
  };
}

/**
 * Server meta for the footer (design F3): fetched on mount, every META_POLL_MS and when `connected`
 * turns true. Keeps the last meta; `stale` after a failed fetch until the next one succeeds.
 */
export function useMeta(connected: boolean): MetaState {
  const [state, setState] = useState<MetaState>({ stale: false });
  const load = useRef<() => void>(() => {});

  useEffect(() => {
    const abort = new AbortController();
    load.current = metaLoader(fetchMeta, setState, abort.signal);
    load.current();
    const timer = setInterval(() => load.current(), META_POLL_MS);
    return () => {
      abort.abort();
      clearInterval(timer);
      load.current = () => {};
    };
  }, []);

  // A restarted server has a new start time and maybe a new commit (app-footer "Refetch on reconnect").
  useEffect(() => {
    if (connected) load.current();
  }, [connected]);

  return state;
}
