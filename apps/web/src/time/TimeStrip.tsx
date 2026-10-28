import {
  type CaseCatalog,
  type CommandInput,
  type CommandResult,
  type Density,
  type DiagEvent,
  type Drive,
  formatSpan,
  parseSignalId,
  scopeKey,
  type TimeRange,
  type Workspace,
  type WorkspaceScope,
} from "@kipscope/shared";
import { type CSSProperties, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { errorText, fetchDensity, isTooWide } from "../api.ts";
import { barTarget } from "../bar/bar.ts";
import { alignToEvent } from "../case/sessionBar.ts";
import { useGapInfo } from "../chart/gaps.ts";
import { useLiveCursor } from "../chart/live.ts";
import { clampRange, type Range } from "../chart/zoom.ts";
import { groupMarks, type Mark, markTitle, stripPin } from "../events/marks.ts";
import { HINTS } from "../help/hints.ts";
import { holdNoSelect } from "../noselect.ts";
import { formatDate, formatTime } from "./axis.ts";
import { NO_SCOPE, SCOPE_HINTS, scopeRange } from "./scope.ts";
import {
  densityRetryMs,
  nextWorkWindow,
  RETRY_MS,
  scopeDensity,
  stripDataRef,
  stripLabel,
  TOO_WIDE_NOTE,
} from "./strip.ts";
import {
  bothRange,
  brushRange,
  caseMarks,
  caseMarkTitle,
  centreRange,
  dayTicks,
  driveRects,
  driveTitle,
  endLabels,
  FLAG_AB_FACE_W,
  FLAG_FACE_W,
  hitZone,
  hoverText,
  jumpRange,
  markerX,
  panRange,
  presence,
  type Rect,
  resizeRange,
  type StripAction,
  type StripFlag,
  StripGesture,
  stripFlags,
  type Track,
  tOf,
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

/** The density of `dataRef` (within `scope`) if the strip loaded it (design S9: the drive keys read it); an object scope's track needs none. */
export function loadedDensity(dataRef: string, scope?: WorkspaceScope): Density | undefined {
  if (scope?.object) return scopeDensity(scope);
  return densities.get(densityKey(dataRef, scope));
}

/** Detail densities of object scopes (add-case-open K11), per scope key and work window, least recently used first. */
const details = new Map<string, Density>();
/** Detail densities kept in the tab, like the server's LRU 8. */
const MAX_DETAILS = 8;
/** The detail density the strip shows last, per object scope key: the drive keys step through it. */
const shownDetails = new Map<string, Density>();

/** Cache key of a detail density. */
const detailKey = (scope: WorkspaceScope, w: TimeRange) => `${scopeKey(scope)}\n${w.from} ${w.to}`;

function rememberDetail(key: string, d: Density): void {
  details.delete(key);
  details.set(key, d);
  for (const old of details.keys()) {
    if (details.size <= MAX_DETAILS) break;
    details.delete(old);
  }
}

/**
 * The drives the strip shows for `dataRef` (design S9: `,` `.` step through them): in an object
 * scope those of the work window's detail density (add-case-open K14), else the density's.
 */
export function loadedDrives(
  dataRef: string,
  scope?: WorkspaceScope,
): readonly Drive[] | undefined {
  if (scope?.object) return shownDetails.get(scopeKey(scope))?.drives;
  return loadedDensity(dataRef, scope)?.drives;
}

/**
 * The work window an object scope holds for the bar target's range (add-case-open K11): kept while
 * the range stays inside it, so panning asks nothing new; undefined outside an object scope or
 * without a range. App passes it to the strip and the events.
 */
export function useWorkWindow(
  scope: WorkspaceScope | undefined,
  view: { from: bigint; to: bigint } | undefined,
): TimeRange | undefined {
  const [held, setHeld] = useState<{ key: string; window: TimeRange }>();
  if (!scope?.object || !view) return undefined;
  const key = scopeKey(scope);
  const kept = held?.key === key ? held.window : undefined;
  const window = nextWorkWindow(kept, view, scope);
  // The same bounds again (a view the scope cuts) keep the held window: no render loop.
  if (kept && window.from === kept.from && window.to === kept.to) return kept;
  setHeld({ key, window });
  return window;
}

/** Work-window keys whose detail density answered `too_wide`: the shown range is asked instead. */
const tooWideDetails = new Set<string>();

type Detail = { key: string; density: Density } | { key: string; tooWide: string };

/**
 * Fetches the detail density of a work window (K11), retried every RETRY_MS while it stays; a
 * `too_wide` work window once more as the shown range `view` (object-view "Gaps and events follow
 * the view"), a too-wide shown range not again until it changes.
 */
function useDetailDensity(
  dataRef: string | undefined,
  scope: WorkspaceScope | undefined,
  window: TimeRange | undefined,
  view: TimeRange | undefined,
): Detail | undefined {
  const windowKey =
    dataRef !== undefined && scope?.object && window ? detailKey(scope, window) : undefined;
  // Bumped when the work window answered too wide: the next render asks the shown range.
  const [, setNarrowed] = useState(0);
  const narrow = windowKey !== undefined && view !== undefined && tooWideDetails.has(windowKey);
  const range = narrow ? view : window;
  const key = windowKey !== undefined && scope && range ? detailKey(scope, range) : undefined;
  const [loaded, setLoaded] = useState<Detail>();
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is the retry trigger; key stands for dataRef, scope and the range
  useEffect(() => {
    if (key === undefined || dataRef === undefined || !scope || !range) return;
    const show = (density: Density) => {
      shownDetails.set(scopeKey(scope), density);
      setLoaded({ key, density });
    };
    const cached = details.get(key);
    if (cached) {
      rememberDetail(key, cached);
      show(cached);
      return;
    }
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    fetchDensity(dataRef, abort.signal, range).then(
      (density) => {
        rememberDetail(key, density);
        if (!abort.signal.aborted) show(density);
      },
      (error: unknown) => {
        if (abort.signal.aborted) return;
        if (!isTooWide(error)) {
          timer = setTimeout(() => setAttempt((n) => n + 1), RETRY_MS);
        } else if (!narrow && windowKey !== undefined && view !== undefined) {
          tooWideDetails.add(windowKey);
          setNarrowed((n) => n + 1);
        } else {
          shownDetails.delete(scopeKey(scope));
          setLoaded({ key, tooWide: errorText(error) });
        }
      },
    );
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [key, attempt]);

  return key !== undefined && loaded?.key === key ? loaded : undefined;
}

type Load =
  | { key: string; state: "loading" }
  | { key: string; state: "failed"; message: string }
  | { key: string; state: "tooWide"; message: string }
  | { key: string; state: "loaded"; density: Density };

/**
 * Fetches the density of `dataRef` (of the scope, when set), retrying a failure every RETRY_MS
 * while the key stays; a `too_wide` answer is asked again only when the key or `shown` (the shown
 * range) changes. An object scope asks nothing: its track spans the scope (object-view B5).
 */
function useDensity(
  dataRef: string | undefined,
  scope: WorkspaceScope | undefined,
  shown: string,
): Load | undefined {
  const [load, setLoad] = useState<Load>();
  // Bumped by the retry timer; a changed key fetches at once through its own dependency.
  const [attempt, setAttempt] = useState(0);
  const object = scope?.object === true;
  const key = dataRef === undefined ? undefined : densityKey(dataRef, scope);
  const tooWideKey = load?.state === "tooWide" ? load.key : undefined;

  // A too-wide strip asks again once the shown range changed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: shown is the trigger
  useEffect(() => {
    if (tooWideKey !== undefined) setAttempt((n) => n + 1);
  }, [shown]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is the retry trigger; key stands for dataRef and scope
  useEffect(() => {
    if (dataRef === undefined || key === undefined || object) return;
    const cached = densities.get(key);
    if (cached) {
      setLoad({ key, state: "loaded", density: cached });
      return;
    }
    // A retry keeps "Recording unavailable" until it succeeds, so the strip does not flicker.
    setLoad((prev) =>
      prev?.key === key && (prev.state === "failed" || prev.state === "tooWide")
        ? prev
        : { key, state: "loading" },
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
        const message = errorText(error);
        const retry = densityRetryMs(error);
        setLoad({ key, state: retry === undefined ? "tooWide" : "failed", message });
        if (retry !== undefined) timer = setTimeout(() => setAttempt((n) => n + 1), retry);
      },
    );
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [key, attempt]);

  const scopeTrack = useMemo(
    () => (object && scope ? scopeDensity(scope) : undefined),
    [object, scope],
  );
  if (key === undefined) return undefined;
  if (scopeTrack) return { key, state: "loaded", density: scopeTrack };
  return load?.key === key ? load : undefined;
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

/** Note text of a drag over the strip (time-strip "Signal drop on the strip"). */
export function stripDropText(d: StripDrop): string {
  if (d.ok) return `Drop to mark state changes of ${d.name}`;
  if (d.reason === "none_new") return `None of ${d.name} has new named states`;
  return d.reason === "no_states"
    ? `${d.name} has no named states`
    : `${d.name} is already on the events line`;
}

/** Tooltip spans of the pins: each hit rect cut at the midpoints to its overlapping neighbours, so
 *  the tooltip under the pointer belongs to the pin a click hits (nearest centre, design DW20). */
function pinTipRects(hits: readonly Rect[]): Rect[] {
  const centre = (r: Rect) => (r.left + r.right) / 2;
  return hits.map((hit, i) => {
    const prev = hits[i - 1];
    const next = hits[i + 1];
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
  session: "pointer",
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

/** L's line in its own component, so the frame-rate updates of L do not re-render the strip (S10). */
function LiveLine({ tr }: { tr: Track }) {
  const t = useLiveCursor()?.t;
  const x = t === undefined ? undefined : markerX(tr, t);
  return x === undefined ? null : <div className="strip-line l" style={{ left: x }} />;
}

/** The hover hairline and the time below the strip (DW10, DW19) in their own component: a pointer
 *  move re-renders only this. `show` receives its setter. */
function HoverTime({
  tr,
  spanNs,
  show,
}: {
  tr: Track;
  spanNs: bigint;
  show: RefObject<((x: number | undefined) => void) | undefined>;
}) {
  const [x, setX] = useState<number>();
  useEffect(() => {
    show.current = setX;
    return () => {
      show.current = undefined;
    };
  }, [show]);
  if (x === undefined) return null;
  return (
    <>
      <div className="strip-hover-line" style={{ left: x }} />
      <div className="strip-hover" style={{ left: x }}>
        {hoverText(tOf(tr, x), spanNs)}
      </div>
    </>
  );
}

/** The clock of a flag's tooltip (DW18): `HH:MM:SS.mmm`, with `YY-MM-DD ` before it at an edge. */
const flagClock = (t: bigint, edge: boolean) =>
  edge ? `${formatDate(t).slice(2)} ${formatTime(t, 3)}` : formatTime(t, 3);

/** aria-label of a strip flag (time-strip "Cursor markers on the strip"). */
function flagLabel(f: StripFlag): string {
  if (f.name === "AB") {
    return f.edge
      ? `Cursors A and B lie ${f.edge} the strip: bring them into view`
      : "Bring cursors A and B into view";
  }
  return f.edge
    ? `Cursor ${f.name} lies ${f.edge} the strip: bring it into view`
    : `Bring cursor ${f.name} into view`;
}

/** Tooltip of a strip flag: HINTS.stripFlag (view, outside, before, after) or HINTS.stripFlagAB. */
function flagTitle(f: StripFlag, a: bigint | undefined, b: bigint | undefined, view?: Range) {
  const edge = f.edge !== undefined;
  if (f.name === "AB") {
    return a !== undefined && b !== undefined
      ? HINTS.stripFlagAB(flagClock(a, edge), flagClock(b, edge))
      : "";
  }
  const t = f.name === "A" ? a : b;
  if (t === undefined) return "";
  const where = f.edge ?? (view && view.from <= t && t <= view.to ? "view" : "outside");
  return HINTS.stripFlag(f.name, flagClock(t, edge), where);
}

/** A cursor flag (DW19): a button over the track's lower part with the face and, at an edge, a caret. */
function Flag({
  flag,
  title,
  onClick,
}: {
  flag: StripFlag;
  title: string;
  onClick: (() => void) | undefined;
}) {
  const faceW = flag.name === "AB" ? FLAG_AB_FACE_W : FLAG_FACE_W;
  const faceLeft = flag.x - flag.hit.left - faceW / 2;
  return (
    <button
      type="button"
      className={`strip-flag ${flag.name.toLowerCase()}`}
      style={{ left: flag.hit.left, width: flag.hit.right - flag.hit.left }}
      aria-label={flagLabel(flag)}
      title={title}
      disabled={onClick === undefined}
      // A flag starts no strip gesture.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
    >
      <span className="strip-flag-face" style={{ left: faceLeft, width: faceW }}>
        {flag.name === "AB" ? "A·B" : flag.name}
      </span>
      {flag.edge && (
        <span
          className={`strip-flag-caret ${flag.edge}`}
          style={{ left: flag.edge === "before" ? faceLeft - 7 : faceLeft + faceW + 2 }}
        />
      )}
    </button>
  );
}

/**
 * Time strip below the context row (design T8, S5–S10 of add-strip-navigation; one 28 px row
 * between two end-label slots, declutter-workspace DW10, DW19, D-094, D-095): over the shown
 * recording's whole extent the data presence line with its breaks, the drives (none while a
 * catalog is linked), event pins in the top lane (DW20), day labels while unlinked, the bar
 * target's range as a window, and the cursor lines with flags that bring a cursor into view. With
 * `navigate`, clicks jump, drags zoom, the window pans and resizes, a double-click shows the whole
 * recording, a click on a drive fits it and one on a pin centres it. The info is the track's
 * tooltip; states and, while a signal is dragged over the strip, what a drop does (V10) show as a
 * note inside the track.
 */
export function TimeStrip({
  workspace,
  navigate,
  events,
  drop,
  mode,
  onScopeCommand,
  caseCatalog,
  workWindow,
  stepping,
}: {
  workspace: Workspace;
  navigate?: StripNavigate | undefined;
  /** Absent while the events of the strip's data ref load. */
  events?: StripEvents | undefined;
  /** Set while a signal is dragged over the strip. */
  drop?: StripDrop | undefined;
  /** The server's catalog mode (meta); `No scope set` in scoped mode without a scope (add-scope Z12). */
  mode?: "full" | "scoped" | undefined;
  /** Sends a mark's `case.go` and a pin's `case.align`. */
  onScopeCommand?: ((command: CommandInput) => Promise<CommandResult>) | undefined;
  /** The open catalog (add-case-open K14): its sessions of the vehicle are marks in an object scope. */
  caseCatalog?: CaseCatalog | undefined;
  /** In an object scope: the work window of the bar target's range (`useWorkWindow`). */
  workWindow?: TimeRange | undefined;
  /** A case step on its way (DW4): the loading state until its density is loaded. */
  stepping?: boolean | undefined;
}) {
  const scope = workspace.scope;
  const open = workspace.case;
  const linked = open?.linked === true;
  const object = scope?.object === true;
  const dataRef = stripDataRef(workspace);
  const targetWindow = barTarget(workspace);
  const target = targetWindow?.range;
  const load = useDensity(dataRef, scope, target ? `${target.from} ${target.to}` : "");
  const detail = useDetailDensity(dataRef, scope, object ? workWindow : undefined, target);
  // Logger gaps of the strip's data ref from the windows' shared gap info (DW10): the signals of
  // that data ref the windows show, so no request of its own; none shown, breaks at empty buckets only.
  const gapIds = useMemo(
    () =>
      dataRef === undefined
        ? []
        : workspace.windows.flatMap((w) =>
            w.signals.map((s) => s.signalId).filter((id) => parseSignalId(id)?.dataRef === dataRef),
          ),
    [workspace.windows, dataRef],
  );
  const gapInfo = useGapInfo(gapIds, scopeKey(scope), object ? workWindow : undefined, target);
  const loggerJson = dataRef === undefined ? undefined : gapInfo.infos.get(dataRef)?.logger;
  const logger = useMemo(
    () => loggerJson?.map((g) => ({ from: BigInt(g.from), to: BigInt(g.to) })),
    [loggerJson],
  );
  // The pin a right click opened `Align sessions to this event` for (K14), and where.
  const [pinMenu, setPinMenu] = useState<{ pin: number; x: number }>();
  const range = target ? { from: BigInt(target.from), to: BigInt(target.to) } : undefined;
  const targetKey = target ? `${targetWindow?.id} ${target.from} ${target.to}` : "";
  const density = load?.state === "loaded" ? load.density : undefined;
  // Loading (DW4, time-strip "Time strip states"): while a step runs, and while the density of the
  // current key loads: no presence line, drives, pins, window or flags.
  const loading =
    dataRef !== undefined &&
    load?.state !== "failed" &&
    load?.state !== "tooWide" &&
    (stepping === true || !density);

  const trackRef = useRef<HTMLDivElement>(null);
  const [px, setPx] = useState(0);
  const [gesture] = useState(() => new StripGesture());
  const pressRef = useRef<Press>(undefined);
  // What navigate returned for the last click: a double-click replaces that step (design S8).
  const lastClickSent = useRef(false);
  const [drag, setDrag] = useState<DragPreview>();
  const [committed, setCommitted] = useState<Committed>();
  const [hoverDrive, setHoverDrive] = useState<number>();
  const showHover = useRef<(x: number | undefined) => void>(undefined);

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

  const tr = density && px > 0 && !loading ? trackOf(density, px) : undefined;
  // In an object scope the drive row and the presence line show the work window's detail
  // (object-view "Catalog marks on the strip"); a linked session is the drive, so none then (D-094).
  const detailDensity = detail && "density" in detail ? detail.density : undefined;
  const driveDensity = object ? detailDensity : density;
  const drives = linked ? [] : (driveDensity?.drives ?? []);
  const sessions = useMemo(
    () =>
      tr && object && scope && open && caseCatalog?.catalogId === open.catalogId
        ? caseMarks(tr, caseCatalog.entries, scope.dataRef, open.current)
        : [],
    [tr, object, scope, open, caseCatalog],
  );
  const sessionHits = useMemo(() => sessions.map((m) => m.hit), [sessions]);
  const shownEvents = events?.shown;
  const marks = useMemo(() => {
    if (!density || px <= 0 || !shownEvents || loading) return [];
    const t = trackOf(density, px);
    return groupMarks(shownEvents, (ns) => xOf(t, ns), px);
  }, [density, px, shownEvents, loading]);
  const pins = useMemo(() => marks.map(stripPin), [marks]);
  const pinHits = useMemo(() => pins.map((p) => p.hit), [pins]);
  const pinTips = useMemo(
    () => pinTipRects(pinHits).map((rect, i) => ({ rect, title: markTitle(marks[i] as Mark) })),
    [pinHits, marks],
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

  // The strip's span (DW19): the scope's bounds, else the recording's first and last row.
  const span =
    scope && !object
      ? { from: BigInt(scope.from), to: BigInt(scope.to) }
      : density
        ? { from: BigInt(density.first), to: BigInt(density.last) }
        : undefined;
  const ends = dataRef !== undefined && span ? endLabels(span.from, span.to) : undefined;

  // The track's tooltip (DW10): the info line and the hint while loaded; the state else.
  let note: string | undefined;
  let trackTitle: string;
  if (dataRef === undefined) {
    note = mode === "scoped" ? NO_SCOPE : "No signal shown";
    trackTitle = note;
  } else if (load?.state === "failed") {
    note = "Recording unavailable";
    trackTitle = load.message;
  } else if (load?.state === "tooWide") {
    note = TOO_WIDE_NOTE;
    trackTitle = load.message;
  } else if (detail && "tooWide" in detail && !loading) {
    note = TOO_WIDE_NOTE;
    trackTitle = detail.tooWide;
  } else if (density && !loading) {
    // An object scope spans the catalog's sessions, no window the user set (object-view).
    const hint =
      density.scope && !object
        ? SCOPE_HINTS.info(formatSpan(BigInt(density.scope.to) - BigInt(density.scope.from)))
        : HINTS.stripInfo(formatSpan(BigInt(density.last) - BigInt(density.first)));
    trackTitle = `${stripLabel(object && scope ? scope : density, labelRange)}\n${hint}`;
  } else {
    note = "Loading recording…";
    trackTitle = note;
  }

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
      case "session": {
        const mark = sessions[a.mark];
        if (mark && onScopeCommand) void onScopeCommand({ type: "case.go", index: mark.index });
        lastClickSent.current = false;
        break;
      }
      case "fit": {
        const drive = drives[a.drive];
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
    showHover.current?.(undefined);
    const { x, y } = point(e);
    setPinMenu(undefined);
    gesture.down(x, y, hitZone(tr, x, y, shown, drives, pinHits, sessionHits), e.timeStamp);
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
    // Over a flag (it hangs below the track) the hairline gives way to the flag's own tooltip.
    const onFlag = e.target instanceof Element && e.target.closest(".strip-flag") !== null;
    showHover.current?.(onFlag || x < 0 || x > tr.px ? undefined : x);
    const zone = hitZone(tr, x, y, shown, drives, pinHits, sessionHits);
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
    e.currentTarget.style.cursor =
      ZONE_CURSOR[hitZone(tr, x, y, shown, drives, pinHits, sessionHits).kind];
    if (a) apply(a, tr, density);
  };

  const onPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pressRef.current?.pointerId === e.pointerId) cancelPress();
  };

  /** Right click on a pin while linked: the menu `Align sessions to this event` (K14). */
  const onContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!tr || !open?.linked || !onScopeCommand) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const zone = hitZone(tr, x, e.clientY - rect.top, shown, drives, pinHits, sessionHits);
    if (zone.kind !== "pin") return;
    e.preventDefault();
    setPinMenu({ pin: zone.index, x });
  };

  // The menu closes on Escape and on any press outside it.
  useEffect(() => {
    if (!pinMenu) return;
    const onKey = (k: KeyboardEvent) => {
      if (k.key === "Escape") setPinMenu(undefined);
    };
    const onDown = (p: PointerEvent) => {
      if (!(p.target instanceof Element && p.target.closest(".time-strip-menu")))
        setPinMenu(undefined);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [pinMenu]);
  // Unlink, a step or new pins end the menu.
  if (pinMenu && (!open?.linked || !marks[pinMenu.pin])) setPinMenu(undefined);

  const win = tr && shown ? windowRects(tr, shown) : undefined;
  const brush =
    drag?.kind === "brush" && tr
      ? {
          left: Math.max(0, Math.min(drag.x0, drag.x1)),
          right: Math.min(tr.px, Math.max(drag.x0, drag.x1)),
        }
      : undefined;
  // In an object scope the line exists only inside the work window (its detail density).
  const lineDensity = object ? detailDensity : density;
  const lines = tr && lineDensity ? presence(tr, lineDensity, logger, shown) : undefined;
  const days = tr && span && !linked ? dayTicks(tr, span.from, span.to) : [];
  const cursorT = (t: string | undefined) => (t === undefined ? undefined : BigInt(t));
  const ta = cursorT(workspace.cursors.a);
  const tb = cursorT(workspace.cursors.b);
  const cursors = tr ? stripFlags(tr, ta, tb) : undefined;

  /** A flag click centres the bar target's span on its cursor (A·B: on both), as a pin click does. */
  const flagClick = (f: StripFlag): (() => void) | undefined => {
    if (!navigate) return undefined;
    if (f.name === "AB") {
      return ta !== undefined && tb !== undefined
        ? () => commit((view) => bothRange(view, ta, tb), true)
        : undefined;
    }
    const t = f.name === "A" ? ta : tb;
    return t === undefined ? undefined : () => commit((view) => centreRange(view, t), true);
  };

  return (
    <div
      className={`time-strip${drop ? (drop.ok ? " drop-target" : " drop-refused") : ""}`}
      data-drop="events"
    >
      <span className="strip-end left" title={ends?.left.title}>
        {ends?.left.text}
      </span>
      <div
        ref={trackRef}
        className="time-strip-track"
        title={trackTitle}
        style={interactive ? undefined : { cursor: "default" }}
        {...(interactive
          ? {
              onPointerDown,
              onPointerMove,
              onPointerUp,
              onPointerCancel,
              onLostPointerCapture: onPointerCancel,
              onPointerLeave: () => {
                setHoverDrive(undefined);
                showHover.current?.(undefined);
              },
              onContextMenu,
            }
          : {})}
      >
        {days.map(({ x, text }) => (
          <span key={x} className="strip-day" style={{ left: x }} aria-hidden="true">
            <span className="strip-day-label">{text}</span>
          </span>
        ))}
        <div className="strip-baseline" aria-hidden="true" />
        {lines?.runs.map((r) => (
          <span
            key={r.left}
            className={r.shown ? "strip-run shown" : "strip-run"}
            style={{ left: r.left, width: r.right - r.left }}
            aria-hidden="true"
          />
        ))}
        {tr &&
          driveRects(tr, drives).map(({ drawn, hit }, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: drives are positional in one density
              key={i}
              className={hoverDrive === i ? "time-strip-drive hover" : "time-strip-drive"}
              style={{ left: hit.left, width: hit.right - hit.left }}
              title={driveDensity ? driveTitle(driveDensity, i) : undefined}
            >
              <span
                className="time-strip-drive-bar"
                style={{ left: drawn.left - hit.left, width: drawn.right - drawn.left }}
              />
            </span>
          ))}
        {open &&
          caseCatalog &&
          sessions.map(({ index, drawn, hit, left }) => {
            const entry = caseCatalog.entries[index];
            return (
              entry && (
                <span
                  key={index}
                  className="time-strip-session"
                  style={{ left: hit.left, width: hit.right - hit.left }}
                  title={caseMarkTitle(entry, index, open.count)}
                >
                  <span
                    className={left ? "time-strip-session-bar left" : "time-strip-session-bar"}
                    style={{ left: drawn.left - hit.left, width: drawn.right - drawn.left }}
                  />
                </span>
              )
            );
          })}
        {lines?.breaks.map((b) => (
          <span
            key={b.left}
            className="strip-break"
            style={{ left: b.left, width: b.right - b.left }}
            title={b.title}
          />
        ))}
        {pins.map((p, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: pins are positional in one grouping
            key={i}
            className={`strip-pin ${p.shape}`}
            style={
              {
                left: p.drawn.left,
                width: p.drawn.right - p.drawn.left,
                "--pin": p.color,
              } as CSSProperties
            }
            aria-hidden="true"
          />
        ))}
        {win && (
          <div
            className="time-strip-window"
            style={{ left: win.drawn.left, width: win.drawn.right - win.drawn.left }}
          />
        )}
        {win?.caret && (
          <span
            className="strip-caret"
            style={{ left: (win.drawn.left + win.drawn.right) / 2 }}
            aria-hidden="true"
          />
        )}
        {brush && (
          <div
            className="time-strip-brush"
            style={{ left: brush.left, width: brush.right - brush.left }}
          />
        )}
        {cursors?.lines.map(({ name, x }) => (
          <div key={name} className={`strip-line ${name.toLowerCase()}`} style={{ left: x }} />
        ))}
        {tr && <LiveLine tr={tr} />}
        <div className="time-strip-pin-hits">
          {pinTips.map(({ rect, title }, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: pins are positional in one grouping
              key={i}
              className="pin-hit"
              style={{ left: rect.left, width: rect.right - rect.left }}
              title={title}
            />
          ))}
        </div>
        {tr && span && <HoverTime tr={tr} spanNs={span.to - span.from} show={showHover} />}
        {cursors?.flags.map((f) => (
          <Flag key={f.name} flag={f} title={flagTitle(f, ta, tb, shown)} onClick={flagClick(f)} />
        ))}
        {(drop || note) && (
          <span
            className={`time-strip-note${drop ? (drop.ok ? " drop" : " drop refused") : loading ? " loading" : ""}`}
          >
            {drop ? stripDropText(drop) : note}
          </span>
        )}
        {pinMenu && marks[pinMenu.pin] && (
          <div
            className="time-strip-menu"
            role="menu"
            style={{ left: pinMenu.x }}
            // Not a strip gesture: the press belongs to the menu.
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const first = marks[pinMenu.pin]?.events[0];
                setPinMenu(undefined);
                if (first && onScopeCommand) void onScopeCommand(alignToEvent(first));
              }}
            >
              Align sessions to this event
            </button>
          </div>
        )}
      </div>
      <span className="strip-end right" title={ends?.right.title}>
        {ends?.right.text}
      </span>
    </div>
  );
}
