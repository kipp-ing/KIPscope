import {
  type CommandInput,
  type CommandResult,
  type Density,
  type DiagEvent,
  scopeKey,
  type Workspace,
  type WorkspaceScope,
  widenScope,
} from "@kipscope/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchDensity } from "../api.ts";
import { barTarget } from "../bar/bar.ts";
import { useLiveCursor } from "../chart/live.ts";
import { clampRange, type Range } from "../chart/zoom.ts";
import { groupMarks, type Mark, markStyle, markTitle } from "../events/marks.ts";
import { HINTS } from "../help/hints.ts";
import { holdNoSelect } from "../noselect.ts";
import { formatRange } from "./axis.ts";
import { NO_SCOPE, SCOPE_HINTS, scopeRange, scopeText } from "./scope.ts";
import { formatSpan, RETRY_MS, stripBars, stripDataRef, stripLabel } from "./strip.ts";
import {
  barTitle,
  brushRange,
  centreRange,
  driveRects,
  driveTitle,
  hitZone,
  jumpRange,
  markerX,
  panRange,
  type Rect,
  resizeRange,
  type StripAction,
  StripGesture,
  type Track,
  trackOf,
  wholeRange,
  windowRects,
  xOf,
  type Zone,
} from "./stripGeometry.ts";
import "./strip.css";

/** App → TimeStrip (S9): runs one strip step on the bar target; `next` maps its current view (pending or server) to the new range. Returns whether a command was sent; `refused` runs when the server refused it. */
export type StripNavigate = (
  next: (view: Range) => Range | undefined,
  push: boolean,
  refused?: () => void,
) => boolean;

/** Densities loaded so far, per data ref or scope (densityKey), for the page's life (design T8):
 *  one fetch per data ref, and one per scope (add-scope Z9). */
const densities = new Map<string, Density>();

/** Cache key of a density: the scope's key while the workspace has a scope, else the data ref. */
function densityKey(dataRef: string, scope: WorkspaceScope | undefined): string {
  return scope ? scopeKey(scope) : dataRef;
}

/** The key an answer belongs to: the scope it was computed for, else its data ref. */
function answerKey(d: Density): string {
  return d.scope ? scopeKey({ dataRef: d.dataRef, ...d.scope }) : d.dataRef;
}

/** The density of `dataRef` (within `scope`) if the strip loaded it (design S9: the drive keys read it). */
export function loadedDensity(dataRef: string, scope?: WorkspaceScope): Density | undefined {
  return densities.get(densityKey(dataRef, scope));
}

type Load =
  | { key: string; state: "loading" }
  | { key: string; state: "failed"; message: string }
  | { key: string; state: "loaded"; density: Density };

/** Fetches the density of `dataRef` (of the scope, when set), retrying a failure every RETRY_MS while the key stays. */
function useDensity(
  dataRef: string | undefined,
  scope: WorkspaceScope | undefined,
): Load | undefined {
  const [load, setLoad] = useState<Load>();
  // Bumped by the retry timer; a changed key fetches at once through its own dependency.
  const [attempt, setAttempt] = useState(0);
  const key = dataRef === undefined ? undefined : densityKey(dataRef, scope);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is the retry trigger; key stands for dataRef and scope
  useEffect(() => {
    if (dataRef === undefined || key === undefined) return;
    const cached = densities.get(key);
    if (cached) {
      setLoad({ key, state: "loaded", density: cached });
      return;
    }
    // A retry keeps "Recording unavailable" until it succeeds, so the strip does not flicker.
    setLoad((prev) =>
      prev?.key === key && prev.state === "failed" ? prev : { key, state: "loading" },
    );
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    fetchDensity(dataRef, abort.signal).then(
      (density) => {
        // The server answers for its scope at that moment; an answer for another scope is kept
        // for its own key, and this key is asked again later.
        densities.set(answerKey(density), density);
        if (answerKey(density) === key) setLoad({ key, state: "loaded", density });
        else if (!abort.signal.aborted)
          timer = setTimeout(() => setAttempt((n) => n + 1), RETRY_MS);
      },
      (error: unknown) => {
        if (abort.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        setLoad({ key, state: "failed", message });
        timer = setTimeout(() => setAttempt((n) => n + 1), RETRY_MS);
      },
    );
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [key, attempt]);

  return key !== undefined && load?.key === key ? load : undefined;
}

/** The shown events of the strip's data ref and their total before the filter (add-events V3, V5). */
export interface StripEvents {
  shown: readonly DiagEvent[];
  total: number;
  /** The events filter as a sentence, for the count's tooltip (add-guidance H5); absent without a filter. */
  sentence?: string | undefined;
}

/** A signal dragged over the strip (add-events V10): eventsDrop's answer and the signal's name. */
export type StripDrop = { name: string } & (
  | { ok: true }
  | { ok: false; reason: "no_states" | "already_listed" | "none_new" }
);

/** Head text of a drag over the strip (time-strip "Signal drop on the strip"). */
export function stripDropText(d: StripDrop): string {
  if (d.ok) return `Drop to mark state changes of ${d.name}`;
  if (d.reason === "none_new") return `None of ${d.name} has new named states`;
  return d.reason === "no_states"
    ? `${d.name} has no named states`
    : `${d.name} is already on the events line`;
}

/** Tooltip spans of the pins: each hit rect cut at the midpoints to its overlapping neighbours, so
 *  the tooltip under the pointer belongs to the pin a click hits (nearest centre, design V3). */
function pinTipRects(marks: readonly Mark[]): Rect[] {
  const centre = (r: Rect) => (r.left + r.right) / 2;
  return marks.map(({ hit }, i) => {
    const prev = marks[i - 1]?.hit;
    const next = marks[i + 1]?.hit;
    const left = prev ? Math.max(hit.left, (centre(prev) + centre(hit)) / 2) : hit.left;
    const right = next ? Math.min(hit.right, (centre(hit) + centre(next)) / 2) : hit.right;
    return { left, right: Math.max(left, right) };
  });
}

/** Pointer shape per hit zone while no gesture runs (design S7). */
const ZONE_CURSOR: Record<Zone["kind"], string> = {
  pin: "pointer",
  bars: "pointer",
  drive: "pointer",
  body: "grab",
  edge: "ew-resize",
};

/** Pointer shape per running drag (design S7). */
const DRAG_CURSOR = { brush: "crosshair", pan: "grabbing", resize: "ew-resize" } as const;

/** Preview of a running drag: the brushed pixels, or the panned or resized range. */
type DragPreview = { kind: "brush"; x0: number; x1: number } | { kind: "range"; range: Range };

/** One press on the track, from pointerdown to release, Escape or cancel. */
interface Press {
  pointerId: number;
  /** Range shown at the press: pan and resize previews compute from it (design S8). */
  base: Range | undefined;
  onKey: (e: KeyboardEvent) => void;
  releaseSelect?: () => void;
}

/** A range the strip sent, shown until the bar target's server range leaves `base` (design S8). */
interface Committed {
  range: Range;
  base: string;
}

/** A vertical marker over the bars (design S10): A and B with a flag, L without. */
function Marker({ name, x, px }: { name: "a" | "b" | "l"; x: number; px: number }) {
  return (
    <div className={`time-strip-marker ${name}`} style={{ left: x }}>
      {name !== "l" && (
        <span className={x + 10 > px ? "time-strip-flag flip" : "time-strip-flag"}>
          {name.toUpperCase()}
        </span>
      )}
    </div>
  );
}

/** L's marker in its own component, so the frame-rate updates of L do not re-render the bars. */
function LiveMarker({ tr }: { tr: Track }) {
  const t = useLiveCursor()?.t;
  const x = t === undefined ? undefined : markerX(tr, t);
  return x === undefined ? null : <Marker name="l" x={x} px={tr.px} />;
}

/**
 * Time strip below the option bar (design T8, S5–S10 of add-strip-navigation): the density of
 * the shown recording over its whole extent, the bar target's range as a window, the drives and
 * the cursor markers. With `navigate`, clicks jump, drags zoom, the window pans and resizes, a
 * double-click shows the whole recording and a click on a drive fits it. Event pins (add-events V3)
 * mark the shown events in a lane at the top of the bars; a click on one centres it. The head counts
 * the events (V5) and, while a signal is dragged over the strip, says what a drop does (V10).
 */
export function TimeStrip({
  workspace,
  navigate,
  events,
  onOpenEvents,
  drop,
  mode,
  onScopeCommand,
}: {
  workspace: Workspace;
  navigate?: StripNavigate | undefined;
  /** Absent while the events of the strip's data ref load. */
  events?: StripEvents | undefined;
  /** Opens the sidebar on the Events tab with the filter field focused (the head count's click). */
  onOpenEvents?: (() => void) | undefined;
  /** Set while a signal is dragged over the strip. */
  drop?: StripDrop | undefined;
  /** The server's catalog mode (meta); Clear shows in full mode only, `No scope set` in scoped mode (add-scope Z12). */
  mode?: "full" | "scoped" | undefined;
  /** Sends Widen's `scope.set` and Clear's `scope.clear`; absent → no scope buttons. */
  onScopeCommand?: ((command: CommandInput) => Promise<CommandResult>) | undefined;
}) {
  const scope = workspace.scope;
  const dataRef = stripDataRef(workspace);
  const load = useDensity(dataRef, scope);
  // A scope command on its way: Widen and Clear wait for its result.
  const [scopePending, setScopePending] = useState(false);
  const targetWindow = barTarget(workspace);
  const target = targetWindow?.range;
  const range = target ? { from: BigInt(target.from), to: BigInt(target.to) } : undefined;
  const targetKey = target ? `${targetWindow?.id} ${target.from} ${target.to}` : "";
  const density = load?.state === "loaded" ? load.density : undefined;

  const trackRef = useRef<HTMLDivElement>(null);
  const [px, setPx] = useState(0);
  const [gesture] = useState(() => new StripGesture());
  const pressRef = useRef<Press>(undefined);
  // What navigate returned for the last click: a double-click replaces that step (design S8).
  const lastClickSent = useRef(false);
  const [drag, setDrag] = useState<DragPreview>();
  const [committed, setCommitted] = useState<Committed>();
  const [hoverDrive, setHoverDrive] = useState<number>();

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setPx(el.clientWidth));
    observer.observe(el);
    setPx(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  // Unmount ends a running press without sending.
  useEffect(
    () => () => {
      const p = pressRef.current;
      pressRef.current = undefined;
      p?.releaseSelect?.();
      if (p) window.removeEventListener("keydown", p.onKey, true);
    },
    [],
  );

  const tr = density && px > 0 ? trackOf(density, px) : undefined;
  const drives = density?.drives ?? [];
  const shownEvents = events?.shown;
  const marks = useMemo(() => {
    if (!density || px <= 0 || !shownEvents) return [];
    const t = trackOf(density, px);
    return groupMarks(shownEvents, (ns) => xOf(t, ns), px);
  }, [density, px, shownEvents]);
  const pinHits = useMemo(() => marks.map((m) => m.hit), [marks]);
  const pinTips = useMemo(
    () => pinTipRects(marks).map((rect, i) => ({ rect, title: markTitle(marks[i] as Mark) })),
    [marks],
  );
  const interactive = navigate !== undefined && density !== undefined && tr !== undefined;

  // The server range moved away from the committed step's base: drop the step for good, so a
  // later "Back" to that base shows the server range, not the step again (design S8).
  if (committed && committed.base !== targetKey) setCommitted(undefined);
  const shown =
    drag?.kind === "range"
      ? drag.range
      : committed && committed.base === targetKey
        ? committed.range
        : range;
  const labelRange =
    drag?.kind === "brush" && tr ? (brushRange(tr, drag.x0, drag.x1) ?? shown) : shown;

  let info: string;
  if (dataRef === undefined) info = mode === "scoped" ? NO_SCOPE : "No signal shown";
  else if (density) info = stripLabel(density, labelRange);
  else if (load?.state === "failed") info = "Recording unavailable";
  else info = "Loading recording…";

  /** Ends the press: releases capture, text selection and the Escape listener; drops the drag preview. */
  const endPress = () => {
    const p = pressRef.current;
    if (!p) return;
    pressRef.current = undefined;
    p.releaseSelect?.();
    window.removeEventListener("keydown", p.onKey, true);
    const el = trackRef.current;
    if (el?.hasPointerCapture(p.pointerId)) el.releasePointerCapture(p.pointerId);
    setDrag(undefined);
  };

  /** Escape or pointercancel: the running gesture sends nothing (design S8). */
  const cancelPress = () => {
    gesture.cancel();
    endPress();
  };

  const point = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  /**
   * Sends one strip step; shows the sent range until the target's server range changes, or until
   * the server refuses the step (the server range then stays, so the strip shows it again).
   */
  const commit = (next: (view: Range) => Range | undefined, push: boolean): boolean => {
    if (!navigate) return false;
    const out: { range: Range | undefined; step: Committed | undefined } = {
      range: undefined,
      step: undefined,
    };
    const sent = navigate(
      (view) => {
        out.range = next(view);
        return out.range;
      },
      push,
      () => setCommitted((c) => (c === out.step ? undefined : c)),
    );
    // App's navigate sends the clamped range; show exactly that.
    out.step =
      sent && out.range
        ? { range: scopeRange(clampRange(out.range), scope), base: targetKey }
        : undefined;
    setCommitted(out.step);
    return sent;
  };

  const apply = (a: StripAction, t: Track, d: Density) => {
    switch (a.kind) {
      case "jump":
        lastClickSent.current = commit((view) => jumpRange(t, a.x, view), true);
        break;
      case "centre": {
        const first = marks[a.pin]?.events[0];
        lastClickSent.current = first
          ? commit((view) => centreRange(view, BigInt(first.t)), true)
          : false;
        break;
      }
      case "fit": {
        const drive = d.drives[a.drive];
        lastClickSent.current = drive
          ? commit(() => ({ from: BigInt(drive.from), to: BigInt(drive.to) }), true)
          : false;
        break;
      }
      case "whole":
        // Replaces the first click's step: no second history entry if that click sent one.
        commit(() => wholeRange(d), !lastClickSent.current);
        lastClickSent.current = false;
        break;
      case "brush":
        commit(() => brushRange(t, a.x0, a.x1), true);
        break;
      case "pan":
        commit((view) => panRange(t, view, a.dx), true);
        break;
      case "resize":
        commit((view) => resizeRange(t, view, a.side, a.dx), true);
        break;
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive || e.button !== 0) return;
    e.preventDefault();
    endPress();
    const { x, y } = point(e);
    gesture.down(x, y, hitZone(tr, x, y, shown, drives, pinHits), e.timeStamp);
    e.currentTarget.setPointerCapture(e.pointerId);
    const onKey = (k: KeyboardEvent) => {
      if (k.key !== "Escape") return;
      k.preventDefault();
      k.stopPropagation();
      cancelPress();
    };
    window.addEventListener("keydown", onKey, true);
    pressRef.current = { pointerId: e.pointerId, base: shown, onKey };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive) return;
    const el = e.currentTarget;
    const { x, y } = point(e);
    const p = pressRef.current;
    if (p) {
      if (p.pointerId !== e.pointerId) return;
      const a = gesture.move(x, y);
      if (!a || (a.kind !== "brush" && a.kind !== "pan" && a.kind !== "resize")) return;
      p.releaseSelect ??= holdNoSelect();
      el.style.cursor = DRAG_CURSOR[a.kind];
      if (a.kind === "brush") setDrag({ kind: "brush", x0: a.x0, x1: a.x1 });
      else if (p.base) {
        const moved =
          a.kind === "pan" ? panRange(tr, p.base, a.dx) : resizeRange(tr, p.base, a.side, a.dx);
        setDrag({ kind: "range", range: moved });
      }
      return;
    }
    const zone = hitZone(tr, x, y, shown, drives, pinHits);
    el.style.cursor = ZONE_CURSOR[zone.kind];
    setHoverDrive(zone.kind === "drive" ? zone.index : undefined);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = pressRef.current;
    if (!p || p.pointerId !== e.pointerId) return;
    const { x, y } = point(e);
    const a = gesture.up(x, y, e.timeStamp);
    endPress();
    if (!interactive) return;
    e.currentTarget.style.cursor = ZONE_CURSOR[hitZone(tr, x, y, shown, drives, pinHits).kind];
    if (a) apply(a, tr, density);
  };

  const onPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pressRef.current?.pointerId === e.pointerId) cancelPress();
  };

  const win = tr && shown ? windowRects(tr, shown)?.drawn : undefined;
  const brush =
    drag?.kind === "brush" && tr
      ? {
          left: Math.max(0, Math.min(drag.x0, drag.x1)),
          right: Math.min(tr.px, Math.max(drag.x0, drag.x1)),
        }
      : undefined;
  const cursorX = (t: string | undefined) =>
    tr && t !== undefined ? markerX(tr, BigInt(t)) : undefined;
  const xa = cursorX(workspace.cursors.a);
  const xb = cursorX(workspace.cursors.b);

  /** Sends one scope command; the buttons stay disabled until its result arrives. */
  const sendScope = (command: CommandInput) => {
    if (!onScopeCommand || scopePending) return;
    setScopePending(true);
    onScopeCommand(command).finally(() => setScopePending(false));
  };

  return (
    <div
      className={`time-strip${drop ? (drop.ok ? " drop-target" : " drop-refused") : ""}`}
      data-drop="events"
      {...(density
        ? {
            title: `${density.dataRef} · ${formatRange(BigInt(density.first), BigInt(density.last))}`,
          }
        : {})}
    >
      <div className="time-strip-head">
        {scope ? (
          <>
            <span className="section-label">SCOPE</span>
            <span className="time-strip-scope" title={scopeText(scope)}>
              {scopeText(scope)}
            </span>
            {onScopeCommand && (
              <button
                type="button"
                className="time-strip-button"
                title={SCOPE_HINTS.widen}
                disabled={scopePending}
                onClick={() => sendScope({ type: "scope.set", ...widenScope(scope) })}
              >
                Widen
              </button>
            )}
            {onScopeCommand && mode === "full" && (
              <button
                type="button"
                className="time-strip-button"
                title={SCOPE_HINTS.clear}
                disabled={scopePending}
                onClick={() => sendScope({ type: "scope.clear" })}
              >
                Clear
              </button>
            )}
          </>
        ) : (
          <span className="section-label">TIME</span>
        )}
        {drop ? (
          <span className={`time-strip-drop${drop.ok ? "" : " refused"}`}>
            {stripDropText(drop)}
          </span>
        ) : (
          labelRange && (
            <span className="time-strip-range">{formatRange(labelRange.from, labelRange.to)}</span>
          )
        )}
        {events && events.total > 0 && (
          <button
            type="button"
            className="time-strip-events"
            title={HINTS.eventsCount(events.shown.length, events.total, events.sentence)}
            {...(onOpenEvents ? { onClick: onOpenEvents } : {})}
          >
            {`${events.shown.length.toLocaleString("en-US")} of ${events.total.toLocaleString("en-US")} events`}
          </button>
        )}
        <span
          className="time-strip-info"
          {...(density
            ? {
                title: density.scope
                  ? SCOPE_HINTS.info(
                      formatSpan(BigInt(density.scope.to) - BigInt(density.scope.from)),
                      formatSpan(BigInt(density.width)),
                    )
                  : HINTS.stripInfo(
                      formatSpan(BigInt(density.last) - BigInt(density.first)),
                      formatSpan(BigInt(density.width)),
                    ),
              }
            : load?.state === "failed"
              ? { title: load.message }
              : {})}
        >
          {info}
        </span>
      </div>
      <div
        ref={trackRef}
        className="time-strip-track"
        style={interactive ? undefined : { cursor: "default" }}
        {...(interactive
          ? {
              onPointerDown,
              onPointerMove,
              onPointerUp,
              onPointerCancel,
              onLostPointerCapture: onPointerCancel,
              onPointerLeave: () => setHoverDrive(undefined),
            }
          : {})}
      >
        <div className="time-strip-bars" aria-hidden="true">
          {density &&
            stripBars(density, shown).map((bar, i) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: bars are positional buckets of one density
                key={i}
                className={bar.shown ? "shown" : undefined}
                style={{ height: bar.height }}
                title={barTitle(density, i)}
              />
            ))}
        </div>
        <div className="time-strip-pins" aria-hidden="true">
          {marks.map((m, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: pins are positional in one grouping
              key={i}
              className="time-strip-pin"
              style={{
                left: m.drawn.left,
                width: m.drawn.right - m.drawn.left,
                ...markStyle(m),
              }}
            />
          ))}
        </div>
        {win && (
          <div
            className="time-strip-window"
            style={{ left: win.left, width: win.right - win.left }}
          />
        )}
        {brush && (
          <div
            className="time-strip-brush"
            style={{ left: brush.left, width: brush.right - brush.left }}
          />
        )}
        {tr && xa !== undefined && <Marker name="a" x={xa} px={tr.px} />}
        {tr && xb !== undefined && <Marker name="b" x={xb} px={tr.px} />}
        {tr && <LiveMarker tr={tr} />}
        <div className="time-strip-pin-hits">
          {pinTips.map(({ rect, title }, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: pins are positional in one grouping
              key={i}
              style={{ left: rect.left, width: rect.right - rect.left }}
              title={title}
            />
          ))}
        </div>
        <div className="time-strip-drives">
          {density &&
            tr &&
            driveRects(tr, drives).map(({ drawn, hit }, i) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: drives are positional in one density
                key={i}
                className={hoverDrive === i ? "time-strip-drive hover" : "time-strip-drive"}
                style={{ left: hit.left, width: hit.right - hit.left }}
                title={driveTitle(density, i)}
              >
                <span
                  className="time-strip-drive-bar"
                  style={{ left: drawn.left - hit.left, width: drawn.right - drawn.left }}
                />
              </span>
            ))}
        </div>
      </div>
    </div>
  );
}
