import {
  type CommandInput,
  type CommandResult,
  type CursorState,
  type RenderError,
  type SignalInfo,
  type ValuesMode,
  type ValuesWindow as WindowState,
  windowTitle,
} from "@letsview/shared";
import type React from "react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import "../chart/window.css";
import "./values.css";
import { fetchCursorValue } from "../api.ts";
import type { DragSource, DropState } from "../chart/drag.ts";
import { type Cell, deltaCell, formatCell, formatCursorTime, formatDeltaT } from "./format.ts";
import {
  type FetchValue,
  ValueLoader,
  type ValueState,
  valueErrors,
  valueRequests,
} from "./loader.ts";

const fetchValue: FetchValue = (r, abort) => fetchCursorValue(r.signalId, r.t, r.mode, abort);

const HINT_TARGET = "Drop to move · Alt/Ctrl+drop to copy";
const HINT_ADD = "Drop to add";

interface Props {
  window: WindowState;
  revision: number;
  /** Committed state, not the preview. */
  cursors: CursorState;
  /** A cursor line is being dragged: dim the cells. */
  dragging: boolean;
  info: (signalId: string) => SignalInfo | undefined;
  colorOf: (signalId: string) => string;
  onCommand: (command: CommandInput) => Promise<CommandResult>;
  onReady: (windowId: string, revision: number, errors: RenderError[]) => void;
  onDragStart: (source: DragSource, event: React.PointerEvent) => void;
  dropState?: DropState;
  dropAction?: "add";
}

/** Window title; a click turns it into a text field (Enter or blur saves, Esc cancels). */
function WindowTitle({
  window: w,
  onCommand,
}: {
  window: WindowState;
  onCommand: Props["onCommand"];
}) {
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);
  const title = windowTitle(w);
  if (!editing) {
    return (
      <button
        type="button"
        className="window-title"
        title={title}
        onClick={() => {
          cancelled.current = false;
          setEditing(true);
        }}
      >
        {title}
      </button>
    );
  }
  const save = (value: string) => {
    setEditing(false);
    if (cancelled.current) return;
    const next = value.trim();
    if (next !== (w.title ?? "")) onCommand({ type: "window.rename", windowId: w.id, title: next });
  };
  return (
    <input
      className="window-title-input"
      // biome-ignore lint/a11y/noAutofocus: the field appears on an explicit click on the title
      autoFocus
      defaultValue={w.title ?? ""}
      placeholder={title}
      maxLength={200}
      aria-label="Window title"
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => save(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** One value cell: the loaded value, the request's error, or "—" while off or not loaded yet. */
function ValueCell({ state, off }: { state: ValueState | undefined; off: boolean }) {
  if (state?.status === "error") {
    return (
      <td className="value error" title={state.error}>
        failed: {state.error}
      </td>
    );
  }
  const r = off ? undefined : state?.result;
  const cell = formatCell(r?.value, r?.at, r?.next);
  return <CellView cell={cell} loading={!off && state?.status !== "complete"} />;
}

function CellView({ cell, loading = false }: { cell: Cell; loading?: boolean }) {
  return (
    <td
      className={`value${cell.sna ? " sna-value" : ""}${loading ? " loading" : ""}`}
      title={cell.title}
    >
      {cell.text}
      {cell.tag && <span className="tag">{cell.tag}</span>}
    </td>
  );
}

/** A values window (design C4, C8, S4): the value of each signal at cursor A, and at B with Δ in diff mode. */
export function ValuesWindow({
  window: w,
  revision,
  cursors,
  dragging,
  info,
  colorOf,
  onCommand,
  onReady,
  onDragStart,
  dropState,
  dropAction,
}: Props) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const loader = useMemo(() => new ValueLoader(fetchValue, rerender), []);
  useEffect(() => () => loader.dispose(), [loader]);

  const diff = cursors.diff;
  const requests = useMemo(
    () => valueRequests(w.signals, cursors, w.mode),
    [w.signals, cursors, w.mode],
  );
  useEffect(() => loader.update(requests), [loader, requests]);

  // --- render acknowledgement -----------------------------------------------------------------

  const settled = loader.settled(requests);
  const errors = valueErrors(w.id, requests, loader);
  const errorKey = JSON.stringify(errors);
  // biome-ignore lint/correctness/useExhaustiveDependencies: errors are tracked via errorKey
  useEffect(() => {
    if (settled) onReady(w.id, revision, errors);
  }, [settled, revision, errorKey, w.id, onReady]);

  // --- view -----------------------------------------------------------------------------------

  const a = cursors.a === undefined ? undefined : BigInt(cursors.a);
  const b = cursors.b === undefined ? undefined : BigInt(cursors.b);
  const hint = dropState === "target" ? (dropAction === "add" ? HINT_ADD : HINT_TARGET) : undefined;

  return (
    <section
      className={`window values-window${dropState ? ` drop-${dropState}` : ""}${dragging ? " dimmed" : ""}`}
      data-window-id={w.id}
    >
      <header className="window-header">
        <WindowTitle key={w.title ?? ""} window={w} onCommand={onCommand} />
        <span className="cursor-time">
          {a === undefined ? "Cursor A off" : `A ${formatCursorTime(a)}`}
        </span>
        {diff && (
          <span className="cursor-time">
            {b === undefined ? "B off" : `B ${formatCursorTime(b)}`}
          </span>
        )}
        {diff && a !== undefined && b !== undefined && (
          <span className="cursor-time">Δt {formatDeltaT(b - a)}</span>
        )}
        <span className="spacer" />
        <label>
          Between points{" "}
          <select
            value={w.mode}
            onChange={(e) =>
              onCommand({
                type: "window.setDisplay",
                windowId: w.id,
                mode: e.target.value as ValuesMode,
              })
            }
          >
            <option value="line">linear</option>
            <option value="step">hold</option>
          </select>
        </label>
        <button type="button" onClick={() => onCommand({ type: "window.remove", windowId: w.id })}>
          Remove
        </button>
      </header>
      {w.signals.length === 0 ? (
        <ul className="signals">
          <li className="empty">Drop a signal here</li>
        </ul>
      ) : (
        <table className="values">
          <thead>
            <tr>
              <th>Signal</th>
              <th>Unit</th>
              <th className="value">A</th>
              {diff && <th className="value">B</th>}
              {diff && <th className="value">Δ</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {w.signals.map((s) => {
              const meta = info(s.signalId);
              const name = meta?.name ?? s.signalId;
              const stateA = loader.get(`${s.id}|a`);
              const stateB = loader.get(`${s.id}|b`);
              const valueA = a === undefined ? undefined : stateA?.result?.value;
              const valueB = b === undefined ? undefined : stateB?.result?.value;
              return (
                <tr key={s.id} title={meta?.description}>
                  <td>
                    <span
                      className="grip"
                      title="Drag onto another window"
                      onPointerDown={(e) =>
                        onDragStart({ windowId: w.id, assignmentId: s.id, signalId: s.signalId }, e)
                      }
                    >
                      <span className="swatch" style={{ background: colorOf(s.signalId) }} />
                      <span className="sig">{name}</span>
                    </span>
                  </td>
                  <td className="unit">{meta?.unit && `[${meta.unit}]`}</td>
                  <ValueCell state={stateA} off={a === undefined} />
                  {diff && <ValueCell state={stateB} off={b === undefined} />}
                  {diff && (
                    <CellView
                      cell={deltaCell(valueA, valueB)}
                      loading={
                        (a !== undefined && stateA?.status === "loading") ||
                        (b !== undefined && stateB?.status === "loading")
                      }
                    />
                  )}
                  <td>
                    <button
                      type="button"
                      className="link"
                      onClick={() =>
                        onCommand({
                          type: "window.removeSignal",
                          windowId: w.id,
                          assignmentId: s.id,
                        })
                      }
                    >
                      remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {hint && (
        <div className="drop-hint">
          <span>{hint}</span>
        </div>
      )}
    </section>
  );
}
