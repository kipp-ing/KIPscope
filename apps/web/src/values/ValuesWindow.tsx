import type {
  CommandInput,
  CommandResult,
  CursorState,
  Digits,
  RenderError,
  SignalInfo,
  ValuesMode,
  ValuesWindow as WindowState,
} from "@letsview/shared";
import type React from "react";
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import "../chart/window.css";
import "./values.css";
import { fetchCursorValue } from "../api.ts";
import type { DragSource, DropState } from "../chart/drag.ts";
import { LIVE_REST_MS, useLiveCursor } from "../chart/live.ts";
import { WindowMenu } from "../window/WindowMenu.tsx";
import { MARKED_HINT, markFromHeader, WindowTitle } from "../window/WindowTitle.tsx";
import { type Cell, deltaCell, formatCell, headerTimes, loadingCell, NO_VALUE } from "./format.ts";
import {
  cellState,
  type FetchValue,
  liveRequests,
  Rest,
  ValueLoader,
  type ValueState,
  valueErrors,
  valueRequests,
} from "./loader.ts";

const fetchValue: FetchValue = (r, abort) => fetchCursorValue(r.signalId, r.t, r.mode, abort);

const HINT_TARGET = "Drop to move · Alt/Ctrl+drop to copy";
const HINT_ADD = "Drop to add";

/** Gap between the header's cursor times (values.css). */
const TIMES_GAP = 6;

let canvas: CanvasRenderingContext2D | null | undefined;

/** Rendered width of `text` in a CSS `font`. */
function textWidth(text: string, font: string): number {
  canvas ??= document.createElement("canvas").getContext("2d");
  if (!canvas) return 0;
  canvas.font = font;
  return canvas.measureText(text).width;
}

/** Room for the cursor times: the header without the controls, the 6ch title minimum and the gaps (L4). */
interface TimesRoom {
  width: number;
  font: string;
}

function measureRoom(header: HTMLElement): TimesRoom {
  const style = getComputedStyle(header);
  const controls = header.querySelector(".window-controls")?.getBoundingClientRect().width ?? 0;
  const times = header.querySelector(".cursor-times");
  const font = times ? getComputedStyle(times).font : style.font;
  const gap = Number.parseFloat(style.columnGap) || 0;
  const titleMin = textWidth("000000", style.font);
  return { width: header.clientWidth - controls - titleMin - 3 * gap, font };
}

interface Props {
  window: WindowState;
  revision: number;
  /** Committed state, not the preview. */
  cursors: CursorState;
  /** A cursor line is being dragged: dim the cells. */
  dragging: boolean;
  /** Significant digits of the values (workspace option, number-format). */
  digits: Digits;
  info: (signalId: string) => SignalInfo | undefined;
  colorOf: (signalId: string) => string;
  onCommand: (command: CommandInput) => Promise<CommandResult>;
  onReady: (windowId: string, revision: number, errors: RenderError[]) => void;
  onDragStart: (source: DragSource, event: React.PointerEvent) => void;
  dropState?: DropState;
  dropAction?: "add";
  /** This window is the explorer's add target (L5). */
  marked: boolean;
  /** A click on the header outside the controls; App marks the window. */
  onMark: (windowId: string) => void;
}

/**
 * One value cell (state from cellState): "—" while its cursor is off, the request's error, the
 * loading state until the value for the current time arrives, then the value.
 */
function ValueCell({
  state,
  unit,
  digits,
}: {
  state: ValueState | undefined;
  unit: string | undefined;
  digits: Digits;
}) {
  if (state?.status === "error") {
    return (
      <td className="value error" title={state.error}>
        failed: {state.error}
      </td>
    );
  }
  const r = state?.result;
  const cell = formatCell(r?.value, r?.at, r?.next, unit, digits);
  return <CellView cell={state?.status === "loading" ? loadingCell(cell) : cell} />;
}

/**
 * One L cell (design L7): empty while L is unset, the last value dimmed while L moves (`moving`)
 * or its lookup loads, `—` with the message when the lookup failed.
 */
function LiveValueCell({
  state,
  set,
  moving,
  unit,
  digits,
}: {
  state: ValueState | undefined;
  set: boolean;
  moving: boolean;
  unit: string | undefined;
  digits: Digits;
}) {
  if (!set) return <td className="value" />;
  const r = state?.result;
  const cell: Cell =
    state?.status === "error"
      ? { text: NO_VALUE, title: `failed: ${state.error}` }
      : formatCell(r?.value, r?.at, r?.next, unit, digits);
  return <CellView cell={moving || state?.status === "loading" ? loadingCell(cell) : cell} />;
}

function CellView({ cell }: { cell: Cell }) {
  return (
    <td
      className={`value${cell.sna ? " sna-value" : ""}${cell.loading ? " loading" : ""}`}
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
  digits,
  info,
  colorOf,
  onCommand,
  onReady,
  onDragStart,
  dropState,
  dropAction,
  marked,
  onMark,
}: Props) {
  const [renaming, setRenaming] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const [room, setRoom] = useState<TimesRoom>({ width: Number.POSITIVE_INFINITY, font: "" });
  useLayoutEffect(() => {
    const header = headerRef.current;
    const controls = header?.querySelector(".window-controls");
    if (!header || !controls) return;
    const observer = new ResizeObserver(() => setRoom(measureRoom(header)));
    observer.observe(header);
    // The controls change width without the header ("Between points" hides with Diff on).
    observer.observe(controls);
    return () => observer.disconnect();
  }, []);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const loader = useMemo(() => new ValueLoader(fetchValue, rerender), []);
  useEffect(() => () => loader.dispose(), [loader]);

  const diff = cursors.diff;
  // B's column while B is on; Diff adds Δ (D-031).
  const showB = cursors.b !== undefined || diff;
  const requests = useMemo(
    () => valueRequests(w.signals, cursors, w.mode),
    [w.signals, cursors, w.mode],
  );
  useEffect(() => loader.update(requests), [loader, requests]);
  const requestOf = new Map(requests.map((r) => [r.key, r]));

  // --- render acknowledgement -----------------------------------------------------------------

  const settled = loader.settled(requests);
  const errors = valueErrors(w.id, requests, loader);
  const errorKey = JSON.stringify(errors);
  // biome-ignore lint/correctness/useExhaustiveDependencies: errors are tracked via errorKey
  useEffect(() => {
    if (settled) onReady(w.id, revision, errors);
  }, [settled, revision, errorKey, w.id, onReady]);

  // --- live cursor (design L7): exact values at L once it rests, outside the acknowledgement -----

  const live = useLiveCursor();
  const liveT = live === undefined ? undefined : String(live.t);
  const [rested, setRested] = useState<string | undefined>(undefined);
  const rest = useMemo(() => new Rest<string>(LIVE_REST_MS, setRested), []);
  useEffect(() => () => rest.dispose(), [rest]);
  useEffect(() => rest.push(liveT), [rest, liveT]);
  const liveLoader = useMemo(() => new ValueLoader(fetchValue, rerender), []);
  useEffect(() => () => liveLoader.dispose(), [liveLoader]);
  const lRequests = useMemo(
    () => liveRequests(w.signals, rested, w.mode),
    [w.signals, rested, w.mode],
  );
  useEffect(() => liveLoader.update(lRequests), [liveLoader, lRequests]);
  const liveRequestOf = new Map(lRequests.map((r) => [r.key, r]));

  // --- view -----------------------------------------------------------------------------------

  const a = cursors.a === undefined ? undefined : BigInt(cursors.a);
  const b = cursors.b === undefined ? undefined : BigInt(cursors.b);
  const times = headerTimes(
    a,
    b,
    diff,
    (texts) =>
      texts.reduce((sum, text) => sum + textWidth(text, room.font), 0) +
        TIMES_GAP * (texts.length - 1) <=
      room.width,
  );
  const hint = dropState === "target" ? (dropAction === "add" ? HINT_ADD : HINT_TARGET) : undefined;

  return (
    <section
      className={`window values-window${marked ? " marked" : ""}${dropState ? ` drop-${dropState}` : ""}${dragging ? " dimmed" : ""}`}
      data-window-id={w.id}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the keyboard path to mark is the explorer's "Add to" select (L5) */}
      <header
        ref={headerRef}
        className={`window-header${showB ? " diff" : ""}`}
        title={marked ? MARKED_HINT : undefined}
        onClick={(e) => markFromHeader(e, w.id, onMark)}
      >
        <WindowTitle
          key={w.title ?? ""}
          window={w}
          editing={renaming}
          onEditing={setRenaming}
          onCommand={onCommand}
        />
        <span className="cursor-times">
          {times.map((t) => (
            <span key={t.text.slice(0, 2)} className="cursor-time" title={t.title}>
              {t.text}
            </span>
          ))}
        </span>
        <div className="window-controls" title="">
          <label>
            {/* Hidden in a narrow header (values.css); the select keeps the name. */}
            <span className="mode-word">Between points</span>
            <select
              aria-label="Between points"
              title="Between points"
              value={w.mode}
              onChange={(e) => {
                onCommand({
                  type: "window.setDisplay",
                  windowId: w.id,
                  mode: e.target.value as ValuesMode,
                });
                // A focused select swallows the navigation keys (keys.ts).
                e.currentTarget.blur();
              }}
            >
              <option value="line">linear</option>
              <option value="step">hold</option>
            </select>
          </label>
          <WindowMenu
            onRename={() => setRenaming(true)}
            onRemove={() => onCommand({ type: "window.remove", windowId: w.id })}
          />
        </div>
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
              <th className="value">A</th>
              {showB && <th className="value">B</th>}
              {diff && <th className="value">Δ</th>}
              <th className="value">L</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {w.signals.map((s) => {
              const meta = info(s.signalId);
              const name = meta?.name ?? s.signalId;
              const keyA = `${s.id}|a`;
              const keyB = `${s.id}|b`;
              const keyL = `${s.id}|l`;
              const stateA = cellState(loader.get(keyA), requestOf.get(keyA));
              const stateB = cellState(loader.get(keyB), requestOf.get(keyB));
              const unit = meta?.unit;
              const delta = deltaCell(stateA?.result?.value, stateB?.result?.value, unit, digits);
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
                  <ValueCell state={stateA} unit={unit} digits={digits} />
                  {showB && <ValueCell state={stateB} unit={unit} digits={digits} />}
                  {diff && (
                    <CellView
                      cell={
                        stateA && stateB && [stateA, stateB].some((x) => x.status === "loading")
                          ? loadingCell(delta)
                          : delta
                      }
                    />
                  )}
                  <LiveValueCell
                    state={cellState(liveLoader.get(keyL), liveRequestOf.get(keyL))}
                    set={liveT !== undefined}
                    moving={liveT !== rested}
                    unit={unit}
                    digits={digits}
                  />
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
