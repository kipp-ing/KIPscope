import type { Density, Workspace } from "@kipscope/shared";
import { useEffect, useState } from "react";
import { fetchDensity } from "../api.ts";
import { barTarget } from "../bar/bar.ts";
import { formatRange } from "./axis.ts";
import { RETRY_MS, stripBars, stripDataRef, stripLabel } from "./strip.ts";
import "./strip.css";

/** Densities loaded so far, per data ref, for the page's life (design T8): one fetch per data ref. */
const densities = new Map<string, Density>();

type Load =
  | { dataRef: string; state: "loading" }
  | { dataRef: string; state: "failed"; message: string }
  | { dataRef: string; state: "loaded"; density: Density };

/** Fetches the density of `dataRef`, retrying a failure every RETRY_MS while the data ref stays. */
function useDensity(dataRef: string | undefined): Load | undefined {
  const [load, setLoad] = useState<Load>();
  // Bumped by the retry timer; a changed data ref fetches at once through its own dependency.
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is the retry trigger
  useEffect(() => {
    if (dataRef === undefined) return;
    const cached = densities.get(dataRef);
    if (cached) {
      setLoad({ dataRef, state: "loaded", density: cached });
      return;
    }
    // A retry keeps "Recording unavailable" until it succeeds, so the strip does not flicker.
    setLoad((prev) =>
      prev?.dataRef === dataRef && prev.state === "failed" ? prev : { dataRef, state: "loading" },
    );
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    fetchDensity(dataRef, abort.signal).then(
      (density) => {
        densities.set(dataRef, density);
        setLoad({ dataRef, state: "loaded", density });
      },
      (error: unknown) => {
        if (abort.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        setLoad({ dataRef, state: "failed", message });
        timer = setTimeout(() => setAttempt((n) => n + 1), RETRY_MS);
      },
    );
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [dataRef, attempt]);

  return dataRef !== undefined && load?.dataRef === dataRef ? load : undefined;
}

/**
 * Time strip below the option bar (design T8): the density of the shown recording over its whole
 * extent, the bar target's range marked in the accent. Display only, no click handlers.
 */
export function TimeStrip({ workspace }: { workspace: Workspace }) {
  const dataRef = stripDataRef(workspace);
  const load = useDensity(dataRef);
  const target = barTarget(workspace)?.range;
  const range = target ? { from: BigInt(target.from), to: BigInt(target.to) } : undefined;
  const density = load?.state === "loaded" ? load.density : undefined;

  let info: string;
  if (dataRef === undefined) info = "No signal shown";
  else if (density) info = stripLabel(density, range);
  else if (load?.state === "failed") info = "Recording unavailable";
  else info = "Loading recording…";

  return (
    <div
      className="time-strip"
      {...(density
        ? {
            title: `${density.dataRef} · ${formatRange(BigInt(density.first), BigInt(density.last))}`,
          }
        : {})}
    >
      <div className="time-strip-head">
        <span className="section-label">TIME</span>
        {range && <span className="time-strip-range">{formatRange(range.from, range.to)}</span>}
        <span
          className="time-strip-info"
          {...(load?.state === "failed" ? { title: load.message } : {})}
        >
          {info}
        </span>
      </div>
      <div className="time-strip-bars" aria-hidden="true">
        {density &&
          stripBars(density, range).map((bar, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: bars are positional buckets of one density
              key={i}
              className={bar.shown ? "shown" : undefined}
              style={{ height: bar.height }}
            />
          ))}
      </div>
    </div>
  );
}
