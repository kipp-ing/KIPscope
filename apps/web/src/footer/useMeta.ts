import type { ServerMeta } from "@kipscope/shared";
import { useEffect, useRef, useState } from "react";
import { fetchMeta } from "../api.ts";

/** Interval of the meta refresh (app-footer "Meta refresh"). */
export const META_POLL_MS = 30_000;

/**
 * Server meta for the footer (design F3): fetched on mount, every META_POLL_MS and when `connected`
 * turns true. Keeps the last meta; `stale` after a failed fetch until the next one succeeds.
 */
export function useMeta(connected: boolean): { meta?: ServerMeta; stale: boolean } {
  const [state, setState] = useState<{ meta?: ServerMeta; stale: boolean }>({ stale: false });
  const load = useRef<() => void>(() => {});

  useEffect(() => {
    const abort = new AbortController();
    load.current = () => {
      fetchMeta(abort.signal).then(
        (meta) => setState({ meta, stale: false }),
        () => {
          if (!abort.signal.aborted) setState((s) => ({ ...s, stale: true }));
        },
      );
    };
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
