import {
  type CommandInput,
  type CommandResult,
  type CursorName,
  DEFAULT_EVENT_FILTER,
  type DiagEvent,
  EMPTY_WORKSPACE,
  type EventList,
  isTimeseries,
  mergeEvents,
  navAnchor,
  type OpenReport,
  panBy,
  parseSignalId,
  placeSignals,
  type RenderError,
  resolveTimeNav,
  type SignalInfo,
  shownName,
  signalColor,
  spanAround,
  type Workspace,
  zoomAround,
} from "@kipscope/shared";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Acknowledger } from "./ack.ts";
import { runPlan } from "./addSignals.ts";
import { ApiRequestError, fetchExtent, openView, sendCommand, signalInfo } from "./api.ts";
import { barTarget, resetSignals } from "./bar/bar.ts";
import { OptionBar } from "./bar/OptionBar.tsx";
import {
  type AnyDragSource,
  canAdd,
  canAddAny,
  canDrop,
  DRAG_THRESHOLD_PX,
  DROP_NEW_BELOW,
  type DragSource,
  type DropState,
  type DropTarget,
  dropCommand,
  dropStateFor,
  dropTargetOf,
  eventsDrop,
  eventsDropMany,
  ghostPosition,
  isCopy,
  isLegendSource,
} from "./chart/drag.ts";
import { type Insets, mergeInsets } from "./chart/insets.ts";
import { liveCursor } from "./chart/live.ts";
import { TimeseriesWindow } from "./chart/TimeseriesWindow.tsx";
import { clampRange, extentRange, historyKey, type Range, ZoomHistory } from "./chart/zoom.ts";
import { EventsPanel } from "./events/EventsPanel.tsx";
import { shownEvents, useEvents } from "./events/eventsData.ts";
import { resolveTarget } from "./explorer/format.ts";
import { NEW_WINDOW, SignalExplorer } from "./explorer/SignalExplorer.tsx";
import { ignoreFileDrops } from "./filedrop.ts";
import { StatusBar } from "./footer/StatusBar.tsx";
import { useMeta } from "./footer/useMeta.ts";
import { isTextField, type NavKey, NavRepeat, navKey } from "./keys.ts";
import {
  isEventsKey,
  isSidebarKey,
  loadSidebar,
  loadSidebarPart,
  SIDEBAR_WIDTH_PX,
  type SidebarPart,
  type SidebarState,
  saveSidebar,
  saveSidebarPart,
} from "./layout/sidebar.ts";
import { useLive } from "./live.ts";
import { holdNoSelect } from "./noselect.ts";
import { stripDataRef } from "./time/strip.ts";
import { centreRange, stepDrive } from "./time/stripGeometry.ts";
import {
  loadedDensity,
  type StripDrop,
  type StripEvents,
  type StripNavigate,
  TimeStrip,
} from "./time/TimeStrip.tsx";
import { ValuesWindow } from "./values/ValuesWindow.tsx";
import { cleanAddress, startupView } from "./views/link.ts";
import { openNotice } from "./views/notice.ts";
import { WindowBoundary } from "./WindowBoundary.tsx";

/** A running legend-row (design D5), values-row (C7) or explorer-row drag; `active` once the pointer moved past the threshold. */
interface Drag {
  source: AnyDragSource;
  label: string;
  startX: number;
  startY: number;
  active: boolean;
  x: number;
  y: number;
  copy: boolean;
  target?: DropTarget | undefined;
}

/** Start-up open from the address (add-saved-views V7): retry pause while the catalog loads, and how long to wait for it. */
const STARTUP_RETRY_MS = 1000;
const STARTUP_CATALOG_WAIT_MS = 60_000;

/** Auto-scroll band below the top row and above the status strip (design C7, L3), and its top speed per frame. */
const EDGE_PX = 48;
const EDGE_SCROLL_PX = 24;

/** The explorer selection a drag carries (two or more signals, M4); undefined for one row. */
function selectionOf(source: AnyDragSource): readonly string[] | undefined {
  return isLegendSource(source) ? undefined : source.signalIds;
}

/** Drop target under a viewport point: a window section, the "+ New window" strip or the free area
 * below the windows (design B1). */
function targetAt(x: number, y: number): DropTarget | undefined {
  return dropTargetOf(document.elementFromPoint(x, y)?.closest("[data-window-id],[data-drop]"));
}

/** A cursor line placed or dragged but not yet in the workspace (design C2). */
interface CursorPreview {
  cursor: CursorName;
  t: bigint;
}

/** Optional `dropState` prop; absent rather than undefined (exactOptionalPropertyTypes). */
const dropProp = (state: DropState | undefined) => (state ? { dropState: state } : {});
/** Optional `events` prop of a timeseries window, likewise. */
const eventsProp = (events: readonly DiagEvent[] | undefined) => (events ? { events } : {});

const toRange = (r: { from: string; to: string }): Range => ({
  from: BigInt(r.from),
  to: BigInt(r.to),
});

const sameRange = (a: Range, b: Range) => a.from === b.from && a.to === b.to;

/** localStorage, or undefined where even reading the property throws (blocked site data). */
function localStore(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** History and pending-navigation key of a window in the current workspace (shared "*" while linked). */
const navKeyOf = (ws: { linkTime: boolean } | undefined, windowId: string) =>
  historyKey(ws?.linkTime ?? true, windowId);

/**
 * A navigation step sent but not yet shown (design N6), per history key: the next step starts from
 * `range`. `chain` holds the server range it started from and every range sent since; a server
 * range outside it is someone else's change and ends the entry.
 */
interface PendingNav {
  windowId: string;
  range: Range;
  chain: Range[];
}

/** Loads the events of one data ref and its events-line signals (design V9) and reports the list to
 * App, which keeps one per data ref; renders nothing. */
function EventsLoader({
  dataRef,
  signalsKey,
  onList,
}: {
  dataRef: string;
  /** The data ref's events-line signals joined with ",". */
  signalsKey: string;
  onList: (dataRef: string, list: EventList | undefined) => void;
}) {
  const signals = useMemo(() => (signalsKey ? signalsKey.split(",") : []), [signalsKey]);
  const list = useEvents(dataRef, signals);
  useEffect(() => onList(dataRef, list), [dataRef, list, onList]);
  useEffect(() => () => onList(dataRef, undefined), [dataRef, onList]);
  return null;
}

/** Data ref of a signal ID, or undefined. */
const dataRefOf = (signalId: string) => parseSignalId(signalId)?.dataRef;

/** Zoom and pan steps of the navigation keys from a view (design N6); home and goTo are not steps. */
function navStep(key: NavKey, view: Range, a: bigint | undefined): Range | undefined {
  switch (key) {
    case "in":
      return zoomAround(view, 0.5, navAnchor(view, a));
    case "out":
      return zoomAround(view, 2, navAnchor(view, a));
    case "left":
      return panBy(view, -0.5);
    case "right":
      return panBy(view, 0.5);
    case "pageLeft":
      return panBy(view, -1);
    case "pageRight":
      return panBy(view, 1);
    default:
      return undefined;
  }
}

export function App() {
  const [live, send] = useLive();
  const [message, setMessage] = useState<string | undefined>();
  // An info notice in the strip's message slot, e.g. the open notice (add-saved-views V7); a new
  // error replaces it.
  const [notice, setNoticeState] = useState<{ text: string; title?: string } | undefined>();
  const setNotice = useCallback((text: string, title?: string) => {
    setMessage(undefined);
    setNoticeState({ text, ...(title !== undefined ? { title } : {}) });
  }, []);
  useEffect(() => {
    if (message !== undefined) setNoticeState(undefined);
  }, [message]);
  const dismissMessage = useCallback(() => {
    setMessage(undefined);
    setNoticeState(undefined);
  }, []);

  // Explorer sidebar (design L1): loaded once, saved on every change, per browser.
  const [sidebar, setSidebar] = useState<SidebarState>(() => loadSidebar(localStore()));
  useEffect(() => saveSidebar(localStore(), sidebar), [sidebar]);
  const toggleSidebar = useCallback(
    () => setSidebar((s) => (s === "open" ? "collapsed" : "open")),
    [],
  );
  const openSidebar = useCallback(() => setSidebar("open"), []);
  const sidebarOpen = sidebar === "open";
  // The part under the sidebar's switch (design V11): per browser like the sidebar itself.
  const [part, setPart] = useState<SidebarPart>(() => loadSidebarPart(localStore()));
  useEffect(() => saveSidebarPart(localStore(), part), [part]);
  // Bumped to focus the events filter field (key `e`, the strip's count; spec "Switch and key e").
  const [eventsFocus, setEventsFocus] = useState(0);
  const openEvents = useCallback(() => {
    setSidebar("open");
    setPart("events");
    setEventsFocus((n) => n + 1);
  }, []);

  // Signal metadata seen in the explorer or looked up for signals already in the workspace.
  const infos = useRef(new Map<string, SignalInfo>());
  const [, setInfoVersion] = useState(0);
  const remember = useCallback((signals: SignalInfo[]) => {
    let added = false;
    for (const s of signals) {
      if (!infos.current.has(s.id)) {
        infos.current.set(s.id, s);
        added = true;
      }
    }
    if (added) setInfoVersion((v) => v + 1);
  }, []);
  const info = useCallback((id: string) => infos.current.get(id), []);
  const unitOf = useCallback((id: string) => infos.current.get(id)?.unit, []);

  const workspace = live.workspace;
  const meta = useMeta(live.connected);
  const windows = workspace?.windows ?? [];
  const linked = workspace?.linkTime ?? true;

  // Events (design V9): one unfiltered list per data ref of the strip and the timeseries windows,
  // filtered here once per revision with the workspace filter for strip, windows and panel.
  const eventFilter = workspace?.eventFilter ?? DEFAULT_EVENT_FILTER;
  const eventSignals = workspace?.eventSignals ?? [];
  const stripRef = workspace ? stripDataRef(workspace) : undefined;
  const windowRefs = new Map<string, string[]>();
  for (const w of windows) {
    if (!isTimeseries(w)) continue;
    const refs = new Set(w.signals.flatMap((s) => dataRefOf(s.signalId) ?? []));
    windowRefs.set(w.id, [...refs].sort());
  }
  const eventRefsKey = [
    ...new Set([...(stripRef ? [stripRef] : []), ...[...windowRefs.values()].flat()]),
  ]
    .sort()
    .join(",");
  const windowRefsKey = [...windowRefs].map(([id, refs]) => `${id}:${refs.join("+")}`).join(",");
  const [eventLists, setEventLists] = useState<ReadonlyMap<string, EventList>>(new Map());
  const onEventList = useCallback((dataRef: string, list: EventList | undefined) => {
    setEventLists((prev) => {
      if (prev.get(dataRef) === list) return prev;
      const next = new Map(prev);
      if (list) next.set(dataRef, list);
      else next.delete(dataRef);
      return next;
    });
  }, []);
  const shownByRef = useMemo(
    () => new Map([...eventLists].map(([ref, list]) => [ref, shownEvents(list, eventFilter)])),
    [eventLists, eventFilter],
  );
  // The union over a window's data refs; one data ref passes its array as is.
  // biome-ignore lint/correctness/useExhaustiveDependencies: windowRefsKey stands for windowRefs
  const windowEvents = useMemo(() => {
    const out = new Map<string, readonly DiagEvent[]>();
    for (const [id, refs] of windowRefs) {
      const parts = refs.flatMap((r) => {
        const shown = shownByRef.get(r);
        return shown ? [shown] : [];
      });
      const [first] = parts;
      if (first) out.set(id, parts.length === 1 ? first : mergeEvents(...parts));
    }
    return out;
  }, [shownByRef, windowRefsKey]);
  const stripList = stripRef ? eventLists.get(stripRef) : undefined;
  const stripShown = stripRef ? shownByRef.get(stripRef) : undefined;
  const stripEvents = useMemo<StripEvents | undefined>(
    () => (stripList && stripShown ? { shown: stripShown, total: stripList.total } : undefined),
    [stripList, stripShown],
  );

  // The marked window, the explorer's add target (design L5, L6): view state of this tab. A removed
  // window clears it; the render resolves it too, so a stale ID never reaches the explorer.
  const [marked, setMarked] = useState<string | undefined>();
  const target = resolveTarget(marked ?? NEW_WINDOW, windows);
  const markedId = target === NEW_WINDOW ? undefined : target;
  useEffect(() => {
    if (marked !== markedId) setMarked(markedId);
  }, [marked, markedId]);
  const onMark = useCallback((windowId: string) => setMarked(windowId), []);
  const onTarget = useCallback((t: string) => setMarked(t === NEW_WINDOW ? undefined : t), []);
  const signalIds = [...new Set(windows.flatMap((w) => w.signals.map((s) => s.signalId)))];
  const missingKey = signalIds.filter((id) => !infos.current.has(id)).join(",");
  useEffect(() => {
    for (const id of missingKey ? missingKey.split(",") : []) {
      signalInfo(id).then((s) => s && remember([s]));
    }
  }, [missingKey, remember]);

  const liveRef = useRef(live);
  liveRef.current = live;
  const colorOf = useCallback(
    (id: string) => signalColor(workspace ?? EMPTY_WORKSPACE, id),
    // A new workspace object per revision redraws windows when colours change.
    [workspace],
  );
  // The explorer's SNA dot takes the chart colour only for signals shown in a window (E5);
  // other signals have no chart colour yet, so the dot falls back to --sna.
  const shownKey = signalIds.join(",");
  const explorerColorOf = useCallback(
    (id: string) => (shownKey.split(",").includes(id) ? colorOf(id) : undefined),
    [shownKey, colorOf],
  );

  const command = useCallback(async (input: CommandInput): Promise<CommandResult> => {
    const result = await sendCommand(input);
    setMessage(result.ok ? undefined : `${result.code}: ${result.message}`);
    return result;
  }, []);

  // A window created by "+ Values window" or a drop on "+ New window" is scrolled into view once the
  // workspace shows it (the effect below the window list refs).
  const [reveal, setReveal] = useState<string | undefined>();
  const barCommand = useCallback(
    async (input: CommandInput): Promise<CommandResult> => {
      const result = await command(input);
      if (result.ok && input.type === "window.create" && result.created) setReveal(result.created);
      return result;
    },
    [command],
  );

  const addSignal = async (signal: SignalInfo, target: string) => {
    let windowId = target;
    if (target === NEW_WINDOW) {
      try {
        // While linked, a new window takes the shared range (design D6); otherwise the extent.
        // Values windows have no range, so a timeseries window must exist to take it from.
        const range =
          linked && windows.some(isTimeseries)
            ? undefined
            : extentRange([await fetchExtent(signal.id)]);
        // Untitled: the header shows "Window <n>", which cannot go stale when signals move.
        const created = await command({
          type: "window.create",
          ...(range ? { from: range.from.toString(), to: range.to.toString() } : {}),
        });
        if (!created.ok || !created.created) return;
        windowId = created.created;
        setReveal(windowId);
      } catch (e) {
        setMessage(e instanceof Error ? e.message : String(e));
        return;
      }
    }
    await command({ type: "window.addSignal", windowId, signalId: signal.id });
  };
  // The drag listeners outlive a render; they add through the current function.
  const addSignalRef = useRef(addSignal);
  addSignalRef.current = addSignal;

  // A selection of two or more (D-066): placed on the live workspace (placeSignals), sent in order.
  const addSignals = async (signalIds: string[], target: string) => {
    const only = signalIds.length === 1 ? infos.current.get(signalIds[0] ?? "") : undefined;
    if (only) return addSignal(only, target);
    const ws = liveRef.current.workspace;
    if (!ws) return;
    const targetWindow =
      target === NEW_WINDOW ? undefined : ws.windows.find((w) => w.id === target);
    if (target !== NEW_WINDOW && !targetWindow) return;
    const plan = placeSignals(signalIds, targetWindow, unitOf);
    // Today's new-window rule per created window: while linked, the shared range once a timeseries
    // window exists (the first one this add creates counts); otherwise its signals' extent.
    const linkedNow = ws.linkTime ?? true;
    let haveTimeseries = ws.windows.some(isTimeseries);
    try {
      const created = await runPlan(plan, targetWindow?.id, {
        command,
        rangeFor: async (ids) => {
          if (linkedNow && haveTimeseries) return undefined;
          haveTimeseries = true;
          return extentRange(await Promise.all(ids.map((id) => fetchExtent(id))));
        },
      });
      if (created[0]) setReveal(created[0]);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };
  const addSignalsRef = useRef(addSignals);
  addSignalsRef.current = addSignals;

  // Values row onto "+ New window" while no timeseries window exists: create plus move (design C6).
  const moveToNewWindow = async (source: DragSource, copy: boolean) => {
    try {
      const range = extentRange([await fetchExtent(source.signalId)]);
      if (!range) return;
      const created = await command({
        type: "window.create",
        from: range.from.toString(),
        to: range.to.toString(),
      });
      if (!created.ok || !created.created) return;
      setReveal(created.created);
      await command({
        type: "window.moveSignal",
        windowId: source.windowId,
        assignmentId: source.assignmentId,
        targetWindowId: created.created,
        ...(copy ? { copy: true } : {}),
      });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };
  const moveToNewWindowRef = useRef(moveToNewWindow);
  moveToNewWindowRef.current = moveToNewWindow;

  // Zoom history (design D6): one shared stack while linked, else one per window.
  const histories = useRef(new Map<string, ZoomHistory>());
  const [, setHistoryVersion] = useState(0);
  const historyOf = useCallback((key: string) => {
    let h = histories.current.get(key);
    if (!h) {
      h = new ZoomHistory();
      histories.current.set(key, h);
    }
    return h;
  }, []);
  const setRange = useCallback(
    (windowId: string, r: Range) => {
      const c = clampRange(r);
      return command({
        type: "window.setRange",
        windowId,
        from: c.from.toString(),
        to: c.to.toString(),
      });
    },
    [command],
  );
  const onZoomed = useCallback(
    (windowId: string, previous: Range) => {
      historyOf(historyKey(liveRef.current.workspace?.linkTime ?? true, windowId)).push(
        clampRange(previous),
      );
      setHistoryVersion((v) => v + 1);
    },
    [historyOf],
  );
  // Navigation steps on their way (design N6), keyed like the history.
  const pendingNav = useRef(new Map<string, PendingNav>());
  useEffect(() => {
    for (const [key, p] of pendingNav.current) {
      const w = workspace?.windows.find((x) => x.id === p.windowId);
      const shown = w && isTimeseries(w) ? toRange(w.range) : undefined;
      if (!shown || sameRange(shown, p.range) || !p.chain.some((r) => sameRange(r, shown)))
        pendingNav.current.delete(key);
    }
  }, [workspace]);
  /** The range a navigation step starts from: the pending one, else the server's. */
  const navView = useCallback((windowId: string): Range | undefined => {
    const w = liveRef.current.workspace?.windows.find((x) => x.id === windowId);
    if (!w || !isTimeseries(w)) return undefined;
    return (
      pendingNav.current.get(navKeyOf(liveRef.current.workspace, windowId))?.range ??
      toRange(w.range)
    );
  }, []);
  /**
   * One navigation step (design S5): clamps, pushes the view it leaves when `push`, sends one
   * setRange. Returns whether it sent one (add-strip-navigation S9).
   */
  const navigate = useCallback(
    (windowId: string, r: Range, push: boolean): boolean => {
      const w = liveRef.current.workspace?.windows.find((x) => x.id === windowId);
      if (!w || !isTimeseries(w)) return false;
      const key = navKeyOf(liveRef.current.workspace, windowId);
      const pending = pendingNav.current.get(key);
      const view = pending?.range ?? toRange(w.range);
      const next = clampRange(r);
      if (sameRange(next, view)) return false;
      if (push) {
        historyOf(key).push(view);
        setHistoryVersion((v) => v + 1);
      }
      const entry = { windowId, range: next, chain: [...(pending?.chain ?? [view]), next] };
      pendingNav.current.set(key, entry);
      const drop = () => {
        if (pendingNav.current.get(key) === entry) pendingNav.current.delete(key);
      };
      setRange(windowId, next).then(
        (result) => {
          if (!result.ok) drop();
        },
        (e: unknown) => {
          drop();
          setMessage(e instanceof Error ? e.message : String(e));
        },
      );
      return true;
    },
    [historyOf, setRange],
  );
  /** One strip step on the bar target (S9): `next` maps its current view to the new range. */
  const stripNavigate = useCallback<StripNavigate>(
    (next, push) => {
      const ws = liveRef.current.workspace;
      const target = ws && barTarget(ws);
      const view = target && navView(target.id);
      const r = view && next(view);
      return target && r ? navigate(target.id, r, push) : false;
    },
    [navView, navigate],
  );
  /** An events row click (V8): centre the bar target on the event, span kept, one history entry. */
  const onCentre = useCallback(
    (t: bigint) => {
      stripNavigate((view) => centreRange(view, t), true);
    },
    [stripNavigate],
  );
  const onBack = useCallback(
    (windowId: string) => {
      const r = histories.current
        .get(historyKey(liveRef.current.workspace?.linkTime ?? true, windowId))
        ?.back();
      if (!r) return;
      pendingNav.current.delete(navKeyOf(liveRef.current.workspace, windowId));
      setHistoryVersion((v) => v + 1);
      void setRange(windowId, r);
    },
    [setRange],
  );
  // Reset to the extents of the window's signals, or of `signalIds` (the bar while linked, design C5).
  const onReset = useCallback(
    async (windowId: string, signalIds?: string[]) => {
      const w = liveRef.current.workspace?.windows.find((x) => x.id === windowId);
      if (!w || !isTimeseries(w)) return;
      const ids = [...new Set(signalIds ?? w.signals.map((s) => s.signalId))];
      if (ids.length === 0) return;
      try {
        // A signal without data (or unknown after a restart) has no extent; the others still count.
        const results = await Promise.allSettled(ids.map((id) => fetchExtent(id)));
        const extents = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
        const extent = extentRange(extents);
        if (!extent) {
          const failed = results.find((r) => r.status === "rejected");
          if (failed) throw failed.reason;
          return;
        }
        // A step still on its way (Home right after `+`) is superseded, not compared against the
        // range the window showed before the await: the reset leaves the latest view (pending, else
        // the server's) as one history entry and becomes the pending range, so the step's late
        // result neither ends it nor wins.
        navigate(windowId, extent, true);
      } catch (e) {
        setMessage(e instanceof Error ? e.message : String(e));
      }
    },
    [navigate],
  );

  // Cursors (design C2): timeseries windows draw the preview over the committed time; release or the
  // click gate commits one cursor.set, and the preview ends once the workspace shows that time.
  const [cursorPreview, setCursorPreview] = useState<CursorPreview | undefined>();
  const committedA = workspace?.cursors?.a;
  const committedB = workspace?.cursors?.b;
  const cursors = useMemo(() => {
    const c: { a?: bigint; b?: bigint } = {};
    if (committedA !== undefined) c.a = BigInt(committedA);
    if (committedB !== undefined) c.b = BigInt(committedB);
    if (cursorPreview) c[cursorPreview.cursor] = cursorPreview.t;
    return c;
  }, [committedA, committedB, cursorPreview]);
  useEffect(() => {
    setCursorPreview((p) =>
      p && (p.cursor === "a" ? committedA : committedB) === p.t.toString() ? undefined : p,
    );
  }, [committedA, committedB]);
  const onCursorPreview = useCallback((cursor: CursorName, t: bigint | undefined) => {
    setCursorPreview((p) =>
      t !== undefined ? { cursor, t } : p?.cursor === cursor ? undefined : p,
    );
  }, []);
  const onCursorCommit = useCallback(
    async (cursor: CursorName, t: bigint) => {
      setCursorPreview({ cursor, t });
      let ok = false;
      try {
        ok = (await command({ type: "cursor.set", cursor, t: t.toString() })).ok;
      } catch (e) {
        setMessage(e instanceof Error ? e.message : String(e));
      }
      // A refused command leaves the line at the committed time; a time that was committed already
      // changes no cursor, so the effect above would not end the preview.
      const shown = liveRef.current.workspace?.cursors?.[cursor] === t.toString();
      if (!ok || shown)
        setCursorPreview((p) => (p?.cursor === cursor && p.t === t ? undefined : p));
    },
    [command],
  );
  const cursorsRef = useRef(cursors);
  cursorsRef.current = cursors;

  // "Go to" and span presets act on the bar target (design S5, D-024).
  // The Go to error is remembered so clearing the field drops only that message.
  const goToMessageRef = useRef<string | undefined>(undefined);
  const onGoTo = useCallback(
    (text: string): string | undefined => {
      const ws = liveRef.current.workspace;
      const target = ws && barTarget(ws);
      const view = target && navView(target.id);
      let error: string | undefined;
      if (!target || !view) {
        error = "Go to needs a timeseries window";
      } else {
        try {
          navigate(target.id, resolveTimeNav(text, { view, cursors: cursorsRef.current }), true);
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
        }
      }
      const previous = goToMessageRef.current;
      goToMessageRef.current = error;
      if (error !== undefined) setMessage(error);
      else if (previous !== undefined) setMessage((m) => (m === previous ? undefined : m));
      return error;
    },
    [navView, navigate],
  );
  const onGoToClear = useCallback(() => {
    const goToMessage = goToMessageRef.current;
    goToMessageRef.current = undefined;
    if (goToMessage !== undefined) setMessage((m) => (m === goToMessage ? undefined : m));
  }, []);
  const onSpan = useCallback(
    (span: bigint) => {
      const ws = liveRef.current.workspace;
      const target = ws && barTarget(ws);
      const view = target && navView(target.id);
      if (!target || !view) return;
      navigate(target.id, spanAround(span, navAnchor(view, cursorsRef.current.a)), true);
    },
    [navView, navigate],
  );

  // Plot insets (natural, per window): every window gets the widest left and right inset, so the
  // same timestamp sits at the same x in all windows.
  const [natural, setNatural] = useState<ReadonlyMap<string, Insets>>(new Map());
  const onInsets = useCallback((windowId: string, next: Insets) => {
    setNatural((prev) => {
      const old = prev.get(windowId);
      if (old && old.left === next.left && old.right === next.right) return prev;
      return new Map(prev).set(windowId, next);
    });
  }, []);
  const windowKey = windows.map((w) => w.id).join(",");
  useEffect(() => {
    const ids = new Set(windowKey.split(","));
    setNatural((prev) =>
      [...prev.keys()].every((id) => ids.has(id))
        ? prev
        : new Map([...prev].filter(([id]) => ids.has(id))),
    );
  }, [windowKey]);
  const { left: maxLeft, right: maxRight } = mergeInsets(
    windows.filter(isTimeseries).map((w) => w.id),
    natural,
  );
  const insets = useMemo(() => ({ left: maxLeft, right: maxRight }), [maxLeft, maxRight]);

  // A running signal drag (below); navigation keys wait while it runs.
  const [drag, setDrag] = useState<Drag | undefined>();
  const dragRef = useRef<Drag | undefined>(undefined);

  // Backspace steps back in the timeseries window under the pointer, else in the window zoomed last.
  // The navigation keys (design N6) act on the window under the pointer, else the bar target.
  const hovered = useRef<string | undefined>(undefined);
  const navRepeat = useRef(new NavRepeat());
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const el = e.target instanceof Element ? e.target.closest("[data-window-id]") : null;
      hovered.current = el?.getAttribute("data-window-id") ?? undefined;
    };
    // Pointer left the page: no window is under it any more.
    const onOut = (e: PointerEvent) => {
      if (!e.relatedTarget) hovered.current = undefined;
    };
    const onNavKey = (e: KeyboardEvent) => {
      const key = navKey(e, document.activeElement);
      if (!key || dragRef.current) return;
      if (key === "goTo") {
        const field = document.getElementById("go-to");
        if (!(field instanceof HTMLInputElement)) return;
        e.preventDefault();
        field.focus();
        field.select();
        return;
      }
      const ws = liveRef.current.workspace;
      if (!ws) return;
      if (key === "prevDrive" || key === "nextDrive") {
        // The drives belong to the strip, which shows the bar target, not the hovered window (S9).
        const target = barTarget(ws);
        if (!target) return;
        e.preventDefault();
        if (e.repeat) return;
        const dataRef = stripDataRef(ws);
        const density = dataRef ? loadedDensity(dataRef) : undefined;
        const drives = density?.drives;
        const view = navView(target.id);
        const drive = drives && view && stepDrive(drives, view, key === "nextDrive" ? 1 : -1);
        if (drive) navigate(target.id, { from: BigInt(drive.from), to: BigInt(drive.to) }, true);
        return;
      }
      const hoveredId = ws.windows.some((w) => w.id === hovered.current && isTimeseries(w))
        ? hovered.current
        : undefined;
      const id = hoveredId ?? barTarget(ws)?.id;
      if (!id) return;
      e.preventDefault();
      if (key === "home") {
        // Reset as the bar does (D-024): linked, the extents of all timeseries signals.
        if (!e.repeat) void onReset(id, ws.linkTime ? resetSignals(ws) : undefined);
        return;
      }
      const step = navRepeat.current.step(e.repeat, e.timeStamp);
      const view = navView(id);
      const next = view && navStep(key, view, cursorsRef.current.a);
      if (step === "skip" || !next) return;
      navigate(id, next, step === "push");
    };
    const onKey = (e: KeyboardEvent) => {
      if (isSidebarKey(e, document.activeElement)) {
        // Not during a drag: the list would change width under the pointer.
        if (dragRef.current) return;
        e.preventDefault();
        if (!e.repeat) toggleSidebar();
        return;
      }
      if (isEventsKey(e, document.activeElement)) {
        if (dragRef.current) return;
        e.preventDefault();
        if (!e.repeat) openEvents();
        return;
      }
      if (e.key !== "Backspace") return onNavKey(e);
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (isTextField(document.activeElement)) return;
      const ws = liveRef.current.workspace;
      const id = [hovered.current, ws?.lastZoomed].find(
        (x) => x && ws?.windows.some((w) => w.id === x && isTimeseries(w)),
      );
      if (!id) return;
      e.preventDefault();
      onBack(id);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerout", onOut);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("keydown", onKey);
    };
  }, [onBack, onReset, navView, navigate, toggleSidebar, openEvents]);

  // Drag and drop of legend rows (design D5) and explorer rows, with pointer events on the document.
  const mainRef = useRef<HTMLElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const update = useCallback((d: Drag | undefined) => {
    dragRef.current = d;
    setDrag(d);
  }, []);
  useEffect(() => {
    if (!reveal || !windowKey.split(",").includes(reveal)) return;
    setReveal(undefined);
    mainRef.current
      ?.querySelector(`[data-window-id="${CSS.escape(reveal)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [reveal, windowKey]);
  const onDragStart = useCallback(
    (source: AnyDragSource, event: React.PointerEvent) => {
      if (event.button !== 0 || dragRef.current) return;
      const info = infos.current.get(source.signalId);
      const many = selectionOf(source);
      const label = many ? `${many.length} signals` : info ? shownName(info) : source.signalId;
      const d: Drag = {
        source,
        label,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        x: event.clientX,
        y: event.clientY,
        copy: false,
      };
      dragRef.current = d;
      // Copy mode follows the modifiers of this drag's latest pointer or key event only (isCopy),
      // so an Alt drag earlier leaves nothing behind.
      let frame = 0;
      // From the press on: a pointer moving off the grip would otherwise select text.
      const releaseSelect = holdNoSelect();
      // No live cursor while a row is dragged (live-cursor "When L is hidden").
      const releaseLive = liveCursor.suspend();

      // Pointer near the visible top (below the top row) or bottom (above the status strip)
      // of the window list scrolls it, faster the closer. On the strip itself it rests (C7).
      const autoScroll = () => {
        frame = 0;
        const cur = dragRef.current;
        const main = mainRef.current;
        if (!cur?.active || !main) return;
        const box = main.getBoundingClientRect();
        const listTop = barRef.current?.getBoundingClientRect().bottom ?? Math.max(box.top, 0);
        const listBottom =
          dropRef.current?.getBoundingClientRect().top ?? Math.min(box.bottom, window.innerHeight);
        const top = listTop + EDGE_PX;
        const bottom = listBottom - EDGE_PX;
        const depth =
          cur.y < top ? cur.y - top : cur.y > bottom && cur.y < listBottom ? cur.y - bottom : 0;
        if (depth === 0) return;
        const before = main.scrollTop;
        main.scrollTop +=
          Math.sign(depth) * Math.ceil(Math.min(Math.abs(depth) / EDGE_PX, 1) * EDGE_SCROLL_PX);
        if (main.scrollTop !== before) frame = requestAnimationFrame(autoScroll);
      };
      // Scrolling moves windows under a resting pointer; the target follows.
      const onScroll = () => {
        const cur = dragRef.current;
        if (cur?.active) update({ ...cur, target: targetAt(cur.x, cur.y) });
      };
      // The wheel scrolls the page while dragging instead of zooming the window under the
      // pointer: stopped before it reaches the plot's own wheel handler, default kept.
      const onWheel = (e: WheelEvent) => {
        if (dragRef.current?.active) e.stopPropagation();
      };

      const finish = () => {
        cancelAnimationFrame(frame);
        releaseSelect();
        releaseLive();
        mainRef.current?.removeEventListener("scroll", onScroll);
        window.removeEventListener("wheel", onWheel, true);
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", finish);
        document.removeEventListener("keydown", onKey, true);
        document.removeEventListener("keyup", onKeyUp, true);
        document.removeEventListener("contextmenu", onMenu, true);
        window.removeEventListener("blur", finish);
        update(undefined);
      };
      const onMove = (e: PointerEvent) => {
        const cur = dragRef.current;
        if (!cur) return;
        const moved =
          Math.hypot(e.clientX - cur.startX, e.clientY - cur.startY) >= DRAG_THRESHOLD_PX;
        if (!cur.active && !moved) return;
        update({
          ...cur,
          active: true,
          x: e.clientX,
          y: e.clientY,
          copy: isCopy(source, e),
          target: targetAt(e.clientX, e.clientY),
        });
        if (!frame) frame = requestAnimationFrame(autoScroll);
      };
      const onUp = (e: PointerEvent) => {
        const cur = dragRef.current;
        finish();
        if (!cur?.active) return;
        const target = targetAt(e.clientX, e.clientY);
        const ws = liveRef.current.workspace;
        if (!target || !ws) return;
        // Any signal dropped on the strip goes on the events line (V10); nothing moves.
        const many = selectionOf(cur.source);
        if (many) {
          if (target.kind === "events") {
            // Each new state signal of the selection in list order, until the first refusal (L5).
            const ids = eventsDropMany(many, (id) => infos.current.get(id), ws);
            void (async () => {
              for (const signalId of ids) {
                if (!(await command({ type: "events.addSignal", signalId })).ok) return;
              }
            })();
            return;
          }
          if (!canAddAny(many, target, ws.windows)) return;
          void addSignalsRef.current(
            [...many],
            target.kind === "new" ? NEW_WINDOW : target.windowId,
          );
          return;
        }
        if (target.kind === "events") {
          const signalId = cur.source.signalId;
          if (eventsDrop(infos.current.get(signalId), ws).ok)
            void command({ type: "events.addSignal", signalId });
          return;
        }
        if (!isLegendSource(cur.source)) {
          const signal = infos.current.get(cur.source.signalId);
          if (!signal || !canAdd(signal.id, target, ws.windows, unitOf)) return;
          void addSignalRef.current(signal, target.kind === "new" ? NEW_WINDOW : target.windowId);
          return;
        }
        const cmd = dropCommand(cur.source, target, ws.windows, unitOf, {
          altKey: e.altKey,
          ctrlKey: e.ctrlKey,
        });
        if (!cmd) return;
        // A values row onto "new" with no timeseries window to take the range from: the server cannot
        // create the window, so App creates it at the signal's extent and moves into it (design C6).
        if (target.kind === "new" && !ws.windows.some(isTimeseries)) {
          void moveToNewWindowRef.current(cur.source, isCopy(cur.source, e));
          return;
        }
        void command(cmd).then((r) => {
          if (r.ok && r.createdWindow) setReveal(r.createdWindow);
        });
      };
      const onModifier = (e: KeyboardEvent) => {
        const cur = dragRef.current;
        if ((e.key === "Alt" || e.key === "Control") && cur?.active) {
          update({ ...cur, copy: isCopy(source, e) });
        }
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          finish();
        } else onModifier(e);
      };
      const onKeyUp = onModifier;
      // Ctrl+drag on macOS would open the context menu.
      const onMenu = (e: Event) => e.preventDefault();
      mainRef.current?.addEventListener("scroll", onScroll);
      window.addEventListener("wheel", onWheel, { capture: true, passive: true });
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", finish);
      document.addEventListener("keydown", onKey, true);
      document.addEventListener("keyup", onKeyUp, true);
      document.addEventListener("contextmenu", onMenu, true);
      window.addEventListener("blur", finish);
    },
    [command, unitOf, update],
  );

  // Option bar (design C5): Back and Reset zoom act on the window zoomed last, else the first one.
  const barWindow = workspace ? barTarget(workspace) : undefined;
  // A stale state without options still renders (design S3).
  const digits = workspace?.options?.digits ?? 3;
  const diff = workspace?.cursors?.diff ?? false;
  const canGoBack = (windowId: string | undefined) =>
    windowId !== undefined && (histories.current.get(historyKey(linked, windowId))?.size ?? 0) > 0;

  const activeDrag = drag?.active ? drag : undefined;
  const legendDrag = activeDrag !== undefined && isLegendSource(activeDrag.source);
  const dropStateOf = (windowId: string): DropState | undefined =>
    activeDrag && dropStateFor(activeDrag.source, windowId, windows, unitOf);
  const dropActionProp = activeDrag && !legendDrag ? { dropAction: "add" as const } : {};
  // Over the strip: what a drop on the events line would do (V10).
  const dragMany = activeDrag && selectionOf(activeDrag.source);
  // A selection over the strip (M4): the one new state signal's name, else "<k> signals".
  const selectionStripDrop = (ids: readonly string[], ws: Workspace): StripDrop => {
    const fresh = eventsDropMany(ids, (id) => infos.current.get(id), ws);
    const one = fresh.length === 1 ? infos.current.get(fresh[0] ?? "") : undefined;
    if (fresh.length === 0) return { name: `${ids.length} signals`, ok: false, reason: "none_new" };
    return { name: one ? shownName(one) : `${fresh.length} signals`, ok: true };
  };
  const stripDrop: StripDrop | undefined =
    activeDrag?.target?.kind === "events" && workspace
      ? dragMany
        ? selectionStripDrop(dragMany, workspace)
        : {
            name: activeDrag.label,
            ...eventsDrop(infos.current.get(activeDrag.source.signalId), workspace),
          }
      : undefined;
  const overValid =
    activeDrag?.target !== undefined &&
    (stripDrop
      ? stripDrop.ok
      : isLegendSource(activeDrag.source)
        ? canDrop(activeDrag.source, activeDrag.target, windows, unitOf)
        : dragMany
          ? canAddAny(dragMany, activeDrag.target, windows)
          : canAdd(activeDrag.source.signalId, activeDrag.target, windows, unitOf));
  const newTarget = activeDrag?.target?.kind === "new" ? activeDrag.target : undefined;
  const belowOver = newTarget?.place === "below";
  const stripOver = newTarget !== undefined && !belowOver;
  // Over another window that already shows the dragged signal (all of a selection): say why the
  // drop is refused.
  const over = activeDrag?.target?.kind === "window" ? activeDrag.target.windowId : undefined;
  const dragIds = activeDrag ? (dragMany ?? [activeDrag.source.signalId]) : [];
  const overShown =
    activeDrag !== undefined &&
    !(isLegendSource(activeDrag.source) && over === activeDrag.source.windowId) &&
    windows.some(
      (w) => w.id === over && dragIds.every((id) => w.signals.some((s) => s.signalId === id)),
    );

  // Render acknowledgement (design H6): one Acknowledger per tab; `send` is stable.
  const ackRef = useRef<Acknowledger | undefined>(undefined);
  ackRef.current ??= new Acknowledger(send);
  const ack = ackRef.current;
  const onReady = useCallback(
    (windowId: string, revision: number, errors: RenderError[]) =>
      ack.report(windowId, revision, errors),
    [ack],
  );
  useEffect(() => {
    if (workspace)
      ack.setState(
        live.revision,
        workspace.windows.map((w) => w.id),
      );
  }, [live.revision, workspace, ack]);
  useEffect(() => {
    if (live.connected) ack.reconnected();
  }, [live.connected, ack]);

  // A file dropped anywhere on the page would navigate the tab away (design H8).
  useEffect(() => ignoreFileDrops(document), []);

  // Open notice (add-saved-views V7): shown once the push of the open's revision brings the title.
  const [opened, setOpened] = useState<{
    revision: number;
    report: OpenReport | undefined;
    warnings: readonly string[];
  }>();
  const onOpened = useCallback((result: CommandResult, warnings: readonly string[] = []) => {
    if (!result.ok) setMessage(`${result.code}: ${result.message}`);
    else setOpened({ revision: result.revision, report: result.report, warnings });
  }, []);
  useEffect(() => {
    if (!opened || live.revision < opened.revision) return;
    const shown = openNotice(workspace?.view?.title ?? "view", opened.report, opened.warnings);
    setNotice(shown.text, shown.title);
    setOpened(undefined);
  }, [opened, live.revision, workspace, setNotice]);
  const viewTitle = workspace?.view?.title;
  useEffect(() => {
    document.title = viewTitle ? `${viewTitle} · KIPscope` : "KIPscope";
  }, [viewTitle]);

  // Start-up from the address (V7): `#view=` or `?view=` opens once the live channel is connected;
  // until the catalog's first load the server refuses with `catalog_unavailable` and the open is
  // retried. Then the address loses that part, so a reload does not open it again.
  const startup = useRef(false);
  useEffect(() => {
    if (!live.connected || startup.current) return;
    startup.current = true;
    void (async () => {
      let asked: Awaited<ReturnType<typeof startupView>>;
      try {
        asked = await startupView(location);
      } catch (e) {
        setMessage(`Cannot read the view link: ${e instanceof Error ? e.message : String(e)}`);
        history.replaceState(null, "", cleanAddress(location));
        return;
      }
      if (!asked) return;
      const body = "name" in asked ? asked : { view: asked.view as object };
      const deadline = Date.now() + STARTUP_CATALOG_WAIT_MS;
      for (;;) {
        let result: CommandResult;
        try {
          result = await openView(body);
        } catch (e) {
          const waiting = e instanceof ApiRequestError && e.code === "catalog_unavailable";
          if (waiting && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, STARTUP_RETRY_MS));
            continue;
          }
          setMessage(e instanceof Error ? e.message : String(e));
          break;
        }
        if (!result.ok && result.code === "catalog_unavailable" && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, STARTUP_RETRY_MS));
          continue;
        }
        onOpened(result);
        break;
      }
      history.replaceState(null, "", cleanAddress(location));
    })();
  }, [live.connected, onOpened]);

  // The drag ghost is placed after layout, once its size is known, so it stays inside the viewport.
  const ghostRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ghostRef.current;
    if (!el || !activeDrag) return;
    const at = ghostPosition(
      activeDrag,
      el.offsetWidth,
      el.offsetHeight,
      window.innerWidth,
      window.innerHeight,
    );
    el.style.left = `${at.left}px`;
    el.style.top = `${at.top}px`;
  });

  const appClass = [
    "app",
    !sidebarOpen && "sidebar-collapsed",
    activeDrag && "dragging",
    activeDrag && !overValid && "drag-invalid",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={appClass}
      style={{ "--sidebar-width": `${SIDEBAR_WIDTH_PX}px` } as React.CSSProperties}
    >
      {eventRefsKey
        .split(",")
        .filter(Boolean)
        .map((ref) => (
          <EventsLoader
            key={ref}
            dataRef={ref}
            signalsKey={eventSignals.filter((id) => dataRefOf(id) === ref).join(",")}
            onList={onEventList}
          />
        ))}
      <SignalExplorer
        windows={windows}
        onAdd={addSignal}
        onAddMany={addSignals}
        onSeen={remember}
        onDragStart={onDragStart}
        dragging={activeDrag !== undefined}
        colorOf={explorerColorOf}
        digits={digits}
        target={target}
        onTarget={onTarget}
        open={sidebarOpen}
        onOpen={openSidebar}
        part={part}
        onPart={setPart}
      >
        <EventsPanel
          list={stripList}
          filter={eventFilter}
          signals={eventSignals}
          info={info}
          range={barWindow ? toRange(barWindow.range) : undefined}
          onCommand={command}
          onCentre={onCentre}
          focus={eventsFocus}
        />
      </SignalExplorer>
      <div className="workspace">
        <main ref={mainRef}>
          {/* The top row (design L3) and the time strip (adopt-design-language T8), sticky together
              while the list scrolls. */}
          <div className="top-area" ref={barRef}>
            <div className="option-bar-slot">
              <button
                type="button"
                className="sidebar-toggle"
                aria-expanded={sidebarOpen}
                title={sidebarOpen ? "Hide signals (s)" : "Show signals (s)"}
                onClick={toggleSidebar}
              >
                Signals
              </button>
              {workspace && (
                <OptionBar
                  workspace={workspace}
                  target={barWindow}
                  canGoBack={canGoBack(barWindow?.id)}
                  onCommand={barCommand}
                  onBack={onBack}
                  onGoTo={onGoTo}
                  onGoToClear={onGoToClear}
                  onSpan={onSpan}
                  onReset={() => {
                    if (barWindow) void onReset(barWindow.id, resetSignals(workspace));
                  }}
                  onOpened={onOpened}
                  onNotice={setNotice}
                  onMessage={setMessage}
                />
              )}
            </div>
            <TimeStrip
              workspace={workspace ?? EMPTY_WORKSPACE}
              navigate={barWindow ? stripNavigate : undefined}
              events={stripEvents}
              onOpenEvents={openEvents}
              drop={stripDrop}
            />
          </div>
          <div className="window-grid">
            {windows.map((w) => (
              <WindowBoundary key={w.id} windowId={w.id} revision={live.revision} onReady={onReady}>
                {isTimeseries(w) ? (
                  <TimeseriesWindow
                    window={w}
                    revision={live.revision}
                    rangeSets={live.rangeSets}
                    info={info}
                    colorOf={colorOf}
                    onCommand={command}
                    onReady={onReady}
                    onZoomed={onZoomed}
                    onReset={onReset}
                    onDragStart={onDragStart}
                    insets={insets}
                    onInsets={onInsets}
                    cursors={cursors}
                    committed={workspace?.cursors ?? EMPTY_WORKSPACE.cursors}
                    digits={digits}
                    diff={diff}
                    onCursorPreview={onCursorPreview}
                    onCursorCommit={onCursorCommit}
                    marked={w.id === markedId}
                    onMark={onMark}
                    linked={linked}
                    {...eventsProp(windowEvents.get(w.id))}
                    {...dropProp(dropStateOf(w.id))}
                    {...dropActionProp}
                  />
                ) : (
                  <ValuesWindow
                    window={w}
                    revision={live.revision}
                    cursors={workspace?.cursors ?? EMPTY_WORKSPACE.cursors}
                    dragging={cursorPreview !== undefined}
                    digits={digits}
                    info={info}
                    colorOf={colorOf}
                    onCommand={command}
                    onReady={onReady}
                    onDragStart={onDragStart}
                    marked={w.id === markedId}
                    onMark={onMark}
                    {...dropProp(dropStateOf(w.id))}
                    {...dropActionProp}
                  />
                )}
              </WindowBoundary>
            ))}
          </div>
          {workspace && windows.length === 0 && !activeDrag && (
            <p className="hint">No windows yet. Search a signal and add it to a new window.</p>
          )}
          {/* The free area below the windows (design B1, B2): always rendered so nothing moves at
              drag start; during a drag a second "+ New window" zone filling what the list leaves. */}
          <div
            className={`drop-below${activeDrag ? " drop" : ""}${belowOver ? " over" : ""}`}
            {...(activeDrag ? { "data-drop": DROP_NEW_BELOW } : {})}
          >
            {activeDrag && "+ New window"}
          </div>
        </main>
        {/* Below the window list, not over it, so it stays at the viewport bottom wherever the list
            is scrolled and never covers a window (C7). Outside a drag it shows connection, revision,
            the last message and the footer; during a drag it is the "+ New window" zone at the same
            size, so nothing moves under the pointer when a drag starts (L3, add-footer F5). */}
        <StatusBar
          connected={live.connected}
          revision={live.revision}
          message={message ?? notice?.text}
          messageTone={message === undefined && notice ? "info" : "error"}
          messageTitle={message ?? notice?.title}
          onDismissMessage={dismissMessage}
          measurement={workspace?.measurement}
          meta={meta.meta}
          metaStale={meta.stale}
          dragging={activeDrag !== undefined}
          over={stripOver}
          dropRef={dropRef}
        />
      </div>
      {activeDrag && (
        <div className="drag-ghost" ref={ghostRef}>
          <span className="swatch" style={{ background: colorOf(activeDrag.source.signalId) }} />
          {activeDrag.label}
          <span className="drag-mode">
            {overValid
              ? !legendDrag || stripDrop
                ? " · add"
                : activeDrag.copy
                  ? " · copy"
                  : " · move"
              : ""}
          </span>
          {overShown && <span className="drag-note">· Already shown</span>}
        </div>
      )}
    </div>
  );
}
