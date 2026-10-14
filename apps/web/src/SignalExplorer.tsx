import type { SignalInfo, SignalPage, TimeseriesWindow } from "@letsview/shared";
import { useEffect, useState } from "react";
import { searchSignals } from "./api.ts";
import { formatSnaValue } from "./chart/build.ts";

export const NEW_WINDOW = "new";

interface Props {
  windows: TimeseriesWindow[];
  onAdd: (signal: SignalInfo, target: string) => void;
  onSeen: (signals: SignalInfo[]) => void;
}

/** Searches the catalog by name, description, alias and unit (spec signal-catalog). */
export function SignalExplorer({ windows, onAdd, onSeen }: Props) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<SignalPage | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [target, setTarget] = useState(NEW_WINDOW);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchSignals(query, controller.signal).then(
        (result) => {
          setPage(result);
          setError(undefined);
          onSeen(result.items);
        },
        (e: unknown) => {
          if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
        },
      );
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, onSeen]);

  useEffect(() => {
    if (target !== NEW_WINDOW && !windows.some((w) => w.id === target)) setTarget(NEW_WINDOW);
  }, [windows, target]);

  return (
    <aside className="explorer">
      <h2>Signals</h2>
      <input
        type="search"
        placeholder="Search name, description, unit…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search signals"
      />
      <label className="target">
        Add to{" "}
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value={NEW_WINDOW}>New window</option>
          {windows.map((w) => (
            <option key={w.id} value={w.id}>
              {w.title ?? w.id}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="error">{error}</p>}
      {page && (
        <p className="count">
          {page.total} match{page.total === 1 ? "" : "es"}
          {page.more ? `, showing ${page.items.length}` : ""}
        </p>
      )}
      <ul>
        {page?.items.map((s) => (
          <li key={s.id}>
            <div className="row">
              <span className="name">{s.name}</span>
              {s.unit && <span className="unit">[{s.unit}]</span>}
              <button type="button" onClick={() => onAdd(s, target)}>
                Add
              </button>
            </div>
            {s.description && <div className="description">{s.description}</div>}
            {s.sna && (
              <div
                className="sna"
                title={`raw ${s.sna.map((c) => `${c.raw.toString(16).toUpperCase()}h`).join(", ")}`}
              >
                SNA {s.sna.map((c) => formatSnaValue(c.value)).join(", ")}
                {s.unit ? ` ${s.unit}` : ""}
              </div>
            )}
            <div className="ref">{s.dataRef}</div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
