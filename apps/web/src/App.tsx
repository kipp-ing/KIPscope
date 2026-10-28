import {
  type CommandInput,
  type CommandResult,
  type CursorName,
  computedInfos,
  DEFAULT_EVENT_FILTER,
  type DiagEvent,
  describeEventFilter,
  EMPTY_WORKSPACE,
  type EventList,
  isComputedId,
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
  scopeKey,
  shownName,
  signalColor,
  type TimeRange,
  type Workspace,
  type WorkspaceCase,
  type WorkspaceScope,
  zoomAround,
} from "@kipscope/shared";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Acknowledger } from "./ack.ts";
import { runPlan } from "./addSignals.ts";
import {
  fetchExtent,
  isCatalogLoading,
  sendCommand,
  serverLimits,
  setComputedDefs,
  signalInfo,
} from "./api.ts";
import { barTarget, resetSignals } from "./bar/bar.ts";
import { OptionBar, RangeButton } from "./bar/OptionBar.tsx";
import { type OverflowTail, OverflowTailContext } from "./bar/OverflowMenu.tsx";
import { useCaseCatalog } from "./case/catalog.ts";
import { SessionBar } from "./case/SessionBar.tsx";
import {
  caseResultEvents,
  endsOpenNote,
  openNoteText,
  type PendingAction,
  patienceHintFor,
  pendingAction,
  pendingTarget,
  startPatienceTimer,
  startsPending,
} from "./case/sessionBar.ts";
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
import { GAP_LOADING_RETRY_MS } from "./chart/gaps.ts";
import { type Insets, mergeInsets } from "./chart/insets.ts";
import { liveCursor } from "./chart/live.ts";
import { TimeseriesWindow } from "./chart/TimeseriesWindow.tsx";
import {
  clampRange,
  extentRange,
  type Range,
  settleStep,
  workspaceHistoryKey,
  ZoomHistory,
} from "./chart/zoom.ts";
import { EventsPanel } from "./events/EventsPanel.tsx";
import { appliedFilter, shownEvents, useEvents } from "./events/eventsData.ts";
import { stepEvent } from "./events/list.ts";
import { resolveTarget } from "./explorer/format.ts";
import { NEW_WINDOW, SignalExplorer } from "./explorer/SignalExplorer.tsx";
import type { TabEvents } from "./explorer/tabs.ts";
import { ignoreFileDrops, openDroppedCatalog } from "./filedrop.ts";
import { StatusBar } from "./footer/StatusBar.tsx";
import { useMeta } from "./footer/useMeta.ts";
import { HelpPanel } from "./help/HelpPanel.tsx";
import { HINTS } from "./help/hints.ts";
import { ScopeCard } from "./help/ScopeCard.tsx";
import { StartCard } from "./help/StartCard.tsx";
import { dismissStart, hasLearned, learn, showStartAgain, startDismissed } from "./help/storage.ts";
import { caseStepKey, isHelpKey, isTextField, type NavKey, NavRepeat, navKey } from "./keys.ts";
import {
  isEventsKey,
  isSidebarKey,
  loadSidebar,
  loadSidebarPart,
  type SidebarPart,
  type SidebarState,
  saveSidebar,
  saveSidebarPart,
  sidebarWidthPx,
} from "./layout/sidebar.ts";
import { useLive } from "./live.ts";
import { holdNoSelect } from "./noselect.ts";
import { NeighbourPreload } from "./preload/preload.ts";
import { FLASH_MS, markTarget, revealDelta } from "./reveal.ts";
import { ScopeRow } from "./time/ScopeRow.tsx";
import { resultStripEvents, scopeRange } from "./time/scope.ts";
import { nearbyHint, stripDataRef } from "./time/strip.ts";
import { centreRange, stepDrive } from "./time/stripGeometry.ts";
import {
  loadedDrives,
  type StripDrop,
  type StripEvents,
  type StripNavigate,
  TimeStrip,
  useWorkWindow,
} from "./time/TimeStrip.tsx";
import { ValuesWindow } from "./values/ValuesWindow.tsx";
import {
  documentTitle,
  nextStrip,
  openedElsewhere,
  type StripEvent,
  type StripItem,
} from "./views/notice.ts";
import { WindowBoundary } from "./WindowBoundary.tsx";
import { GatePage } from "./workspaces/Gate.tsx";
import { gateOf } from "./workspaces/gate.ts";
import type { Startup } from "./workspaces/startup.ts";

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
  scope,
  window,
  view,
  onList,
}: {
  dataRef: string;
  /** The data ref's events-line signals joined with ",". */
  signalsKey: string;
  /** The workspace's scope: a scope change loads again (add-case-open, no page load per session). */
  scope: WorkspaceScope | undefined;
  /** In an object scope: the work window the events cover (K11). */
  window: TimeRange | undefined;
  /** The bar target's shown range: asked once a work window answered too wide (object-view). */
  view: TimeRange | undefined;
  onList: (dataRef: string, list: EventList | undefined) => void;
}) {
  const signals = useMemo(() => (signalsKey ? signalsKey.split(",") : []), [signalsKey]);
  const list = useEvents(dataRef, signals, scope, window, view);
  useEffect(() => onList(dataRef, list), [dataRef, list, onList]);
  useEffect(() => () => onList(dataRef, undefined), [dataRef, onList]);
  return null;
}

/**
 * The case a case command leaves, for its result's message (add-case-open K14): a step or go links,
 * Unlink unlinks, Align keeps its new mode; the answer's state push may come later.
 */
function caseAfter(
  open: WorkspaceCase | undefined,
  input: CommandInput,
): WorkspaceCase | undefined {
  if (!open) return undefined;
  if (input.type === "case.unlink") return { ...open, linked: false };
  if (input.type === "case.align") return { ...open, align: input.align };
  if (input.type === "case.go" || input.type === "case.step") return { ...open, linked: true };
  return open;
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

/** The page of one workspace, after the start-up chose it (add-multiuser M12). */
export function App({ start }: { start: Extract<Startup, { kind: "ready" }> }) {
  const [live, send] = useLive(start.workspace);
  // The strip's message slot (add-saved-views V7 round 2): one error or info notice; any new one
  // replaces it, so an open clears an older error.
  const [strip, setStrip] = useState<StripItem | undefined>();
  const toStrip = useCallback((event: StripEvent) => setStrip((s) => nextStrip(s, event)), []);
  const setMessage = useCallback((text: string) => toStrip({ kind: "error", text }), [toStrip]);
  const setNotice = useCallback(
    (text: string, title?: string) =>
      toStrip({ kind: "notice", text, ...(title !== undefined ? { title } : {}) }),
    [toStrip],
  );
  const dismissMessage = useCallback(() => toStrip({ kind: "dismiss" }), [toStrip]);

  // Explorer sidebar (design L1): loaded once, saved on every change, per browser.
  const [sidebar, setSidebar] = useState<SidebarState>(() => loadSidebar(localStore()));
  useEffect(() => saveSidebar(localStore(), sidebar), [sidebar]);
  const toggleSidebar = useCallback(
    () => setSidebar((s) => (s === "open" ? "collapsed" : "open")),
    [],
  );
  const openSidebar = useCallback(() => setSidebar("open"), []);
  const sidebarOpen = sidebar === "open";
  // 248 px, 208 px below a 1200 px viewport (design DW22); follows the viewport.
  const [sidebarWidth, setSidebarWidth] = useState(() => sidebarWidthPx(window.innerWidth));
  useEffect(() => {
    const onResize = () => setSidebarWidth(sidebarWidthPx(window.innerWidth));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
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

  // Help panel (add-guidance H7): the "?" button opens the manual, the `?` key the keys; either
  // closes an open panel.
  const [help, setHelp] = useState<"manual" | "keys" | undefined>();
  const toggleHelp = useCallback(
    (tab: "manual" | "keys") => setHelp((h) => (h ? undefined : tab)),
    [],
  );
  const closeHelp = useCallback(() => setHelp(undefined), []);
  // The start card (H7): shown until dismissed in this browser, and always on an empty workspace.
  const [startHidden, setStartHidden] = useState(startDismissed);
  const onDismissStart = useCallback(() => {
    dismissStart();
    setStartHidden(true);
  }, []);
  const onShowStart = useCallback(() => {
    showStartAgain();
    setStartHidden(false);
  }, []);
  // "?" is always the top row's last item, never in the "⋯" menu (design DW8).
  const helpTail = useMemo<OverflowTail>(
    () => ({
      row: (
        <button
          type="button"
          className="help-button"
          aria-label="Help"
          title={HINTS.help}
          onClick={() => toggleHelp("manual")}
        >
          ?
        </button>
      ),
    }),
    [toggleHelp],
  );

  // Signal metadata seen in the explorer or looked up for signals already in the workspace.
  const infos = useRef(new Map<string, SignalInfo>());
  const [, setInfoVersion] = useState(0);
  /** The signal list in use: the explorer's last loaded catalog (computed infos, C11). */
  const [listInUse, setListInUse] = useState<readonly SignalInfo[]>([]);
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

  // Computed signals (add-computed-signals C11): on every state, the infos of the definitions on the
  // list in use replace the previous ones (an edit changes the ID, a rename the shown name), and
  // requests read the definitions. Set during render, so this render's windows request with them.
  const computedDefs = workspace?.computed;
  const computed = useMemo(
    () => computedInfos(computedDefs ?? [], listInUse, workspace?.scope?.dataRef),
    [computedDefs, listInUse, workspace?.scope?.dataRef],
  );
  const placedComputed = useRef<readonly SignalInfo[]>([]);
  if (placedComputed.current !== computed) {
    for (const id of infos.current.keys()) if (isComputedId(id)) infos.current.delete(id);
    for (const s of computed) infos.current.set(s.id, s);
    placedComputed.current = computed;
    setComputedDefs(computedDefs ?? []);
  }
  const onSeen = useCallback(
    (signals: SignalInfo[]) => {
      setListInUse(signals);
      remember(signals);
    },
    [remember],
  );
  // The scope's identity: windows load again and the footer's meta follows on a change (add-scope Z12).
  const workspaceScope = scopeKey(workspace?.scope);
  const meta = useMeta(live.connected, workspaceScope);
  // Scoped mode without a scope (B8): the Scope card shows, timeseries windows ask nothing.
  const noScope = meta.meta?.catalog.mode === "scoped" && !workspace?.scope;

  // Next-step hints (H7, S1) retire for good once the workspace has shown B on, or Diff on.
  const [learned, setLearned] = useState(() => ({ b: hasLearned("b"), diff: hasLearned("diff") }));
  const bOn = workspace?.cursors?.b !== undefined;
  const diffOn = workspace?.cursors?.diff === true;
  useEffect(() => {
    if (bOn) learn("b");
    if (diffOn) learn("diff");
    if (bOn || diffOn) setLearned((l) => ({ b: l.b || bOn, diff: l.diff || diffOn }));
  }, [bOn, diffOn]);
  const nextHints = useMemo(() => ({ b: !learned.b, diff: !learned.diff }), [learned]);
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
  // For `n`/`p` in the key handler (improve-events P7), which reads it at the press.
  const stripShownRef = useRef(stripShown);
  stripShownRef.current = stripShown;
  // The filter in plain words for the count's tooltip (H5), lower-cased inside its parentheses;
  // absent when it lets every event through.
  const filterSentence = useMemo(() => {
    const text = describeEventFilter(appliedFilter(eventFilter));
    return text === "All events" ? undefined : text.charAt(0).toLowerCase() + text.slice(1);
  }, [eventFilter]);
  const stripEvents = useMemo<StripEvents | undefined>(
    () =>
      stripList && stripShown
        ? {
            shown: stripShown,
            total: stripList.total,
            ...(filterSentence && { sentence: filterSentence }),
          }
        : undefined,
    [stripList, stripShown, filterSentence],
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
  // Computed IDs are never looked up: their infos come from the definitions (C11).
  const missingKey = signalIds
    .filter((id) => !infos.current.has(id) && !isComputedId(id))
    .join(",");
  // A server still loading its catalog (503 `catalog_unavailable`) is asked again soon; any other
  // failure leaves the metadata unknown (the window shows the bare ID), never an unhandled rejection.
  useEffect(() => {
    let active = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const look = (id: string) =>
      signalInfo(id).then(
        (s) => active && s && remember([s]),
        (error: unknown) => {
          if (active && isCatalogLoading(error))
            timers.push(setTimeout(() => look(id), GAP_LOADING_RETRY_MS));
        },
      );
    for (const id of missingKey ? missingKey.split(",") : []) look(id);
    return () => {
      active = false;
      for (const t of timers) clearTimeout(t);
    };
  }, [missingKey, remember]);

  const liveRef = useRef(live);
  liveRef.current = live;
  // The open catalog's entries (add-case-open K14): the strip's marks.
  const caseCatalog = useCaseCatalog(workspace?.case?.catalogId);
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

  // Neighbour preload (add-case-open K13): one per tab; every command of the tab cancels it.
  const preloadRef = useRef<NeighbourPreload | undefined>(undefined);
  preloadRef.current ??= new NeighbourPreload();
  const preload = preloadRef.current;
  useEffect(() => {
    const detach = preload.listen(window);
    return () => {
      detach();
      preload.dispose();
    };
  }, [preload]);
  useEffect(() => preload.state(live.revision), [preload, live.revision]);

  // The message the latest command result put in the line (a clamp, a fallback, missing signals,
  // add-case-open K14): it ends as the next command is sent, so only the latest result's message
  // stays (until its ✕); that command's result may show its own.
  const resultNotice = useRef<string | undefined>(undefined);
  // The open's report in the session bar (fix-handoff-findings X4a): it stays until the session is
  // left (an accepted case.go, case.step or case.unlink) or its ✕; a reload drops it.
  const [openNote, setOpenNote] = useState<string | undefined>();
  const showResult = useCallback(
    (events: readonly StripEvent[]) => {
      for (const event of events) {
        toStrip(event);
        if (event.kind === "notice") resultNotice.current = event.text;
      }
    },
    [toStrip],
  );
  /** Sends a command and shows its result in the strip; `quiet` keeps a refusal out of it. */
  const dispatch = useCallback(
    async (input: CommandInput, quiet: boolean): Promise<CommandResult> => {
      preload.cancel();
      const shown = resultNotice.current;
      if (shown !== undefined) {
        resultNotice.current = undefined;
        toStrip({ kind: "dismiss", tone: "info", text: shown });
      }
      const result = await sendCommand(input);
      // An accepted command ends an older error; a notice stays. A range moved into the scope
      // says so (add-scope Z12), in a case workspace the session's or vehicle's edge (K14).
      const open = liveRef.current.workspace?.case;
      const events = input.type.startsWith("case.")
        ? caseResultEvents(result, caseAfter(open, input), (id) => {
            const s = infos.current.get(id);
            return s && shownName(s);
          })
        : resultStripEvents(result, open);
      showResult(quiet && !result.ok ? [] : events);
      if (endsOpenNote(input, result)) setOpenNote(undefined);
      return result;
    },
    [toStrip, showResult, preload],
  );
  const command = useCallback((input: CommandInput) => dispatch(input, false), [dispatch]);
  // The computed editor shows its refusals in its own error line (improve-formula-editor F11), so
  // none reaches the strip: no chip outlives the editor or shows beside the next one.
  const editorCommand = useCallback((input: CommandInput) => dispatch(input, true), [dispatch]);
  // A case step or go on its way (design DW4): the session bar shows its target's slots at once,
  // the progress line and the strip's skeleton bars run until the result's revision is rendered
  // (Acknowledger.onRendered) or the command is refused. Unlink and Link on their way show
  // `Unlinking…`/`Linking…` with the same progress line and end the same way (D-112).
  const [pending, setPending] = useState<number | undefined>();
  const [progress, setProgress] = useState(false);
  const [actionPending, setActionPending] = useState<PendingAction | undefined>();
  const pendingRef = useRef<number | undefined>(undefined);
  const actionPendingRef = useRef<PendingAction | undefined>(undefined);
  /** The latest case command that started a pending state; an older one's result no longer ends
   *  it, and a command that starts none (a `]` while unlinked) leaves it alone. */
  const pendingSeq = useRef(0);
  /** The revision the pending step or action waits for, once its result is in. */
  const awaitedRevision = useRef<number | undefined>(undefined);
  const renderedRevision = useRef(-1);
  // A pending Unlink still on its way after UNLINK_HINT_DELAY_MS shows the patience hint in the
  // session bar until `Unlinking…` goes (D-113).
  const [unlinkHint, setUnlinkHint] = useState(false);
  const cancelHint = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cancelHint.current?.(), []);
  const endStep = useCallback(() => {
    pendingRef.current = undefined;
    actionPendingRef.current = undefined;
    awaitedRevision.current = undefined;
    cancelHint.current?.();
    cancelHint.current = undefined;
    setPending(undefined);
    setActionPending(undefined);
    setUnlinkHint(false);
    setProgress(false);
  }, []);
  // The session bar sends without waiting; its result goes to the message line like any command.
  const caseCommand = useCallback(
    (input: CommandInput) => {
      const open = liveRef.current.workspace?.case;
      const starts = open !== undefined && startsPending(open, pendingRef.current, input);
      const seq = starts ? ++pendingSeq.current : undefined;
      if (open && starts) {
        const target = pendingTarget(open, pendingRef.current, input);
        const action = pendingAction(open, input);
        pendingRef.current = target;
        actionPendingRef.current = action;
        awaitedRevision.current = undefined;
        cancelHint.current?.();
        cancelHint.current = patienceHintFor(action)
          ? startPatienceTimer(() => setUnlinkHint(true))
          : undefined;
        setPending(target);
        setActionPending(action);
        setUnlinkHint(false);
        setProgress(true);
      }
      const settle = (result: CommandResult | undefined) => {
        if (seq !== pendingSeq.current) return;
        if (pendingRef.current === undefined && actionPendingRef.current === undefined) return;
        if (!result?.ok || renderedRevision.current >= result.revision) endStep();
        else awaitedRevision.current = result.revision;
      };
      command(input).then(settle, () => settle(undefined));
    },
    [command, endStep],
  );

  // Windows this tab created, and the target of an explorer add, are scrolled into view and flash
  // once the workspace lists them (add-guidance H3; the effect below the window list refs). Drops
  // onto an existing window and CLI changes reveal nothing.
  const [reveal, setReveal] = useState<{ ids: string[] } | undefined>();
  const revealWindows = useCallback((ids: string[]) => {
    if (ids.length > 0) setReveal({ ids });
  }, []);
  const barCommand = useCallback(
    async (input: CommandInput): Promise<CommandResult> => {
      const result = await command(input);
      if (result.ok && input.type === "window.create" && result.created)
        revealWindows([result.created]);
      return result;
    },
    [command, revealWindows],
  );

  /** Adds one signal; `drop`: a drop, which reveals a created window but not an existing target. */
  const addSignal = async (signal: SignalInfo, target: string, drop = false) => {
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
        revealWindows([windowId]);
      } catch (e) {
        setMessage(e instanceof Error ? e.message : String(e));
        return;
      }
    }
    const added = await command({ type: "window.addSignal", windowId, signalId: signal.id });
    // A refused add reveals nothing new (H3).
    if (added.ok && target !== NEW_WINDOW && !drop) revealWindows([windowId]);
  };
  // The drag listeners outlive a render; they add through the current function.
  const addSignalRef = useRef(addSignal);
  addSignalRef.current = addSignal;

  // A selection of two or more (D-066): placed on the live workspace (placeSignals), sent in order.
  const addSignals = async (signalIds: string[], target: string, drop = false) => {
    const only = signalIds.length === 1 ? infos.current.get(signalIds[0] ?? "") : undefined;
    if (only) return addSignal(only, target, drop);
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
    // Revealed (H3): the windows created, also those of an add that failed later, and the target
    // once a signal went into it (not for a drop).
    const created: string[] = [];
    let intoTarget = false;
    try {
      await runPlan(plan, targetWindow?.id, {
        command: async (input) => {
          const result = await command(input);
          if (result.ok && input.type === "window.create" && result.created)
            created.push(result.created);
          if (result.ok && input.type === "window.addSignal" && input.windowId === target)
            intoTarget = true;
          return result;
        },
        rangeFor: async (ids) => {
          if (linkedNow && haveTimeseries) return undefined;
          haveTimeseries = true;
          return extentRange(await Promise.all(ids.map((id) => fetchExtent(id))));
        },
      });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
    revealWindows([...(intoTarget && !drop ? [target] : []), ...created]);
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
      revealWindows([created.created]);
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
      historyOf(workspaceHistoryKey(liveRef.current.workspace, windowId)).push(
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
      pendingNav.current.get(workspaceHistoryKey(liveRef.current.workspace, windowId))?.range ??
      toRange(w.range)
    );
  }, []);
  /**
   * One navigation step (design S5): clamps, sends one setRange and, once the server accepted it,
   * pushes the view it left when `push`. A refused step (`read_only`, `forbidden_data`, …) pushes
   * nothing, ends its pending range and calls `refused`, so the page stays at the server's range.
   * Returns whether it sent one (add-strip-navigation S9).
   */
  const navigate = useCallback(
    (windowId: string, r: Range, push: boolean, refused?: () => void): boolean => {
      const w = liveRef.current.workspace?.windows.find((x) => x.id === windowId);
      if (!w || !isTimeseries(w)) return false;
      const key = workspaceHistoryKey(liveRef.current.workspace, windowId);
      const pending = pendingNav.current.get(key);
      const view = pending?.range ?? toRange(w.range);
      const next = clampRange(r);
      if (sameRange(next, view)) return false;
      // The server moves the range into the scope (add-scope Z6); the step expects that range and
      // still sends `next`, so a step at the edge reports `clamped` (the message, Z12).
      const expected = scopeRange(next, liveRef.current.workspace?.scope);
      const pushView = push && !sameRange(expected, view);
      const entry = {
        windowId,
        range: expected,
        chain: [...(pending?.chain ?? [view]), expected],
      };
      pendingNav.current.set(key, entry);
      const drop = () => {
        if (pendingNav.current.get(key) === entry) pendingNav.current.delete(key);
      };
      settleStep(() => setRange(windowId, next), {
        accepted: () => {
          if (!pushView) return;
          historyOf(key).push(view);
          setHistoryVersion((v) => v + 1);
        },
        refused: () => {
          drop();
          refused?.();
        },
      }).catch((e: unknown) => setMessage(e instanceof Error ? e.message : String(e)));
      return true;
    },
    [historyOf, setRange, setMessage],
  );
  /** One strip step on the bar target (S9): `next` maps its current view to the new range. */
  const stripNavigate = useCallback<StripNavigate>(
    (next, push, refused) => {
      const ws = liveRef.current.workspace;
      const target = ws && barTarget(ws);
      const view = target && navView(target.id);
      const r = view && next(view);
      return target && r ? navigate(target.id, r, push, refused) : false;
    },
    [navView, navigate],
  );
  const onBack = useCallback(
    (windowId: string) => {
      const history = histories.current.get(
        workspaceHistoryKey(liveRef.current.workspace, windowId),
      );
      const r = history?.back();
      if (!history || !r) return;
      pendingNav.current.delete(workspaceHistoryKey(liveRef.current.workspace, windowId));
      setHistoryVersion((v) => v + 1);
      // A refused Back keeps the entry, since the window still shows the range it left.
      settleStep(() => setRange(windowId, r), {
        refused: () => {
          history.push(r);
          setHistoryVersion((v) => v + 1);
        },
      }).catch((e: unknown) => setMessage(e instanceof Error ? e.message : String(e)));
    },
    [setRange, setMessage],
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
    [navigate, setMessage],
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
    [command, setMessage],
  );
  const cursorsRef = useRef(cursors);
  cursorsRef.current = cursors;
  /**
   * An event jump (improve-events P7, E-2): a t outside the bar target's view centres it there
   * (span kept, one history entry), then cursor.set puts the cursor on t.
   */
  const onJump = useCallback(
    (t: bigint, cursor: CursorName) => {
      stripNavigate(
        (view) => (t >= view.from && t < view.to ? undefined : centreRange(view, t)),
        true,
      );
      void onCursorCommit(cursor, t);
    },
    [stripNavigate, onCursorCommit],
  );

  // "Go to" and the range picker act on the bar target (design S5, D-024).
  // A refused text's reason is returned for the picker's result line only, never posted to the
  // message line (add-range-picker R10), so it shows once.
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
      return error;
    },
    [navView, navigate],
  );
  // Kept as pinned in R11; with nothing posted to the message line there is nothing to dismiss.
  const onGoToClear = useCallback(() => {}, []);
  // The range picker (add-range-picker R11): open state for the keys, the typed "Go to" text kept
  // across opens, and Go as one range command with one history entry, as the strip's commands.
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerOpenRef = useRef(false);
  pickerOpenRef.current = pickerOpen;
  const [typed, setTyped] = useState("");
  const onApply = useCallback(
    (r: Range) => {
      stripNavigate(() => r, true);
    },
    [stripNavigate],
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
      const key = navKey(e, document.activeElement, pickerOpenRef.current);
      if (!key || dragRef.current) return;
      const ws = liveRef.current.workspace;
      if (!ws) return;
      if (key === "goTo") {
        // Opens the picker with "Go to" focused and selected (OptionBar); nothing without a
        // timeseries window.
        if (!barTarget(ws)) return;
        e.preventDefault();
        setPickerOpen(true);
        return;
      }
      if (key === "prevDrive" || key === "nextDrive") {
        // The drives belong to the strip, which shows the bar target, not the hovered window (S9).
        const target = barTarget(ws);
        if (!target) return;
        e.preventDefault();
        if (e.repeat) return;
        const dataRef = stripDataRef(ws);
        // In an object scope the work window's drives (add-case-open K14).
        const drives = dataRef ? loadedDrives(dataRef, ws.scope) : undefined;
        const view = navView(target.id);
        const drive = drives && view && stepDrive(drives, view, key === "nextDrive" ? 1 : -1);
        if (drive) navigate(target.id, { from: BigInt(drive.from), to: BigInt(drive.to) }, true);
        return;
      }
      if (key === "prevEvent" || key === "nextEvent") {
        // The strip's events, stepped on the bar target's view from cursor A (P7), once per press.
        const target = barTarget(ws);
        if (!target) return;
        e.preventDefault();
        if (e.repeat) return;
        const view = navView(target.id);
        const events = stripShownRef.current;
        const dir = key === "nextEvent" ? 1 : -1;
        const next = view && events && stepEvent(events, view, cursorsRef.current.a, dir);
        if (next) onJump(BigInt(next.t), "a");
        return;
      }
      if (key === "cursorA" || key === "cursorB") {
        // Centres the bar target's span on the cursor as its strip flag does (design DW23): one
        // window.setRange, one history entry; nothing while that cursor is off.
        const t = cursorsRef.current[key === "cursorA" ? "a" : "b"];
        if (t === undefined || !barTarget(ws)) return;
        e.preventDefault();
        if (e.repeat) return;
        stripNavigate((view) => centreRange(view, t), true);
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
      if (isHelpKey(e, document.activeElement)) {
        if (dragRef.current) return;
        e.preventDefault();
        if (!e.repeat) toggleHelp("keys");
        return;
      }
      // While the range picker is open no key changes a range (add-range-picker R11); its own
      // fields and Esc handle the keys.
      if (pickerOpenRef.current) return;
      // `[` and `]` step the open catalog while linked (add-case-open K14), once per press.
      const step = caseStepKey(e, document.activeElement, liveRef.current.workspace?.case);
      if (step) {
        if (dragRef.current) return;
        e.preventDefault();
        if (!e.repeat) caseCommand(step);
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
  }, [
    onBack,
    onReset,
    navView,
    navigate,
    onJump,
    stripNavigate,
    toggleSidebar,
    openEvents,
    toggleHelp,
    caseCommand,
  ]);

  // Drag and drop of legend rows (design D5) and explorer rows, with pointer events on the document.
  const mainRef = useRef<HTMLElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const update = useCallback((d: Drag | undefined) => {
    dragRef.current = d;
    setDrag(d);
  }, []);
  // Reveal (H3): once the workspace lists every window to reveal, two frames later (the tiles laid
  // out) the first is scrolled fully into view below the top row and each flashes for FLASH_MS.
  // The attribute is set on the element, so React never overwrites it.
  const flashTimers = useRef(new Map<Element, number>());
  useEffect(() => {
    if (!reveal) return;
    const listed = new Set(windowKey.split(","));
    if (!reveal.ids.every((id) => listed.has(id))) return;
    setReveal(undefined);
    const ids = reveal.ids;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const main = mainRef.current;
        if (!main) return;
        const tiles = ids.flatMap((id) => {
          const el = main.querySelector(`[data-window-id="${CSS.escape(id)}"]`);
          return el ? [el] : [];
        });
        const first = tiles[0]?.getBoundingClientRect();
        if (first) {
          const box = main.getBoundingClientRect();
          const top = barRef.current?.getBoundingClientRect().bottom ?? box.top;
          main.scrollTop += revealDelta(first, { top, bottom: box.bottom });
        }
        for (const el of tiles) {
          const timers = flashTimers.current;
          clearTimeout(timers.get(el));
          // A tile still flashing starts over.
          el.removeAttribute("data-flash");
          void (el as HTMLElement).offsetWidth;
          el.setAttribute("data-flash", "");
          timers.set(
            el,
            window.setTimeout(() => {
              el.removeAttribute("data-flash");
              timers.delete(el);
            }, FLASH_MS),
          );
        }
      }),
    );
  }, [reveal, windowKey]);
  useEffect(() => {
    const timers = flashTimers.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
    };
  }, []);
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
            true,
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
          void addSignalRef.current(
            signal,
            target.kind === "new" ? NEW_WINDOW : target.windowId,
            true,
          );
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
          if (r.ok && r.createdWindow) revealWindows([r.createdWindow]);
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
    [command, unitOf, update, revealWindows],
  );

  // Option bar (design C5): Back and Reset zoom act on the window zoomed last, else the first one.
  const barWindow = workspace ? barTarget(workspace) : undefined;
  // In an object scope the work window around the bar target's range (add-case-open K11): strip
  // drives, events and pins cover it.
  const workWindow = useWorkWindow(
    workspace?.scope,
    barWindow ? toRange(barWindow.range) : undefined,
  );
  // The strip's events, counted on the sidebar's Events tab (design DW14); under a vehicle scope
  // with "nearby" as tooltip.
  const eventsTab = useMemo<TabEvents | undefined>(
    () =>
      stripEvents && {
        shown: stripEvents.shown.length,
        total: stripEvents.total,
        ...(stripEvents.sentence !== undefined && { sentence: stripEvents.sentence }),
        ...(workspace?.scope?.object && workWindow && { nearby: nearbyHint(workWindow) }),
      },
    [stripEvents, workspace?.scope?.object, workWindow],
  );
  // A stale state without options still renders (design S3).
  const digits = workspace?.options?.digits ?? 3;
  const diff = workspace?.cursors?.diff ?? false;
  const canGoBack = (windowId: string | undefined) =>
    windowId !== undefined &&
    (histories.current.get(workspaceHistoryKey(workspace, windowId))?.size ?? 0) > 0;

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
  // A `complete` acknowledgement of the current revision starts the neighbour preload (K13).
  ackRef.current ??= new Acknowledger((message) => {
    const sent = send(message);
    const ws = liveRef.current.workspace;
    if (ws && message.revision === liveRef.current.revision)
      preload.rendered(message.revision, ws, message.status);
    return sent;
  });
  const ack = ackRef.current;
  ack.onRendered = (revision) => {
    renderedRevision.current = revision;
    const awaited = awaitedRevision.current;
    if (awaited !== undefined && revision >= awaited) endStep();
  };
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

  // A file dropped anywhere on the page would navigate the tab away (design H8); a dropped catalog
  // opens in a new workspace (add-case-open K14).
  useEffect(
    () =>
      ignoreFileDrops(document, (files) => {
        const [file] = files;
        if (!file) return;
        openDroppedCatalog(file).then(
          (opened) => {
            if (!opened) setMessage(`${file.name} holds no catalog of sessions`);
          },
          (e: unknown) => setMessage(e instanceof Error ? e.message : String(e)),
        );
      }),
    [setMessage],
  );

  // Own opens (add-saved-views V7 round 3): a `view.open` push whose revision is none of this tab's
  // open results was opened elsewhere and replaces the strip's item. The push can beat the HTTP
  // answer, so it is decided only while no own open is in flight; one that waits is decided when
  // the last own open settles.
  const own = useRef({ pending: 0, revisions: new Set<number>() });
  const decidedOpen = useRef<number | undefined>(undefined);
  const decideOpen = useCallback(() => {
    const push = liveRef.current.lastOpen;
    if (!push || own.current.pending > 0 || decidedOpen.current === push.revision) return;
    decidedOpen.current = push.revision;
    const text = openedElsewhere(push, own.current.revisions);
    if (text !== undefined) toStrip({ kind: "notice", text });
  }, [toStrip]);
  const lastOpenRevision = live.lastOpen?.revision;
  useEffect(() => {
    if (lastOpenRevision !== undefined) decideOpen();
  }, [lastOpenRevision, decideOpen]);
  /** Sends an open of this tab: counted as in flight until it settles, its revision kept as own. */
  const trackOpen = useCallback(
    async <T,>(request: () => Promise<T>, revisionOf: (result: T) => number | undefined) => {
      own.current.pending++;
      try {
        const result = await request();
        const revision = revisionOf(result);
        if (revision !== undefined) own.current.revisions.add(revision);
        return result;
      } finally {
        own.current.pending--;
        decideOpen();
      }
    },
    [decideOpen],
  );

  // Open notice (add-saved-views V7): shown once the push of the open's revision brings the title.
  const [opened, setOpened] = useState<{
    revision: number;
    report: OpenReport | undefined;
    warnings: readonly string[];
  }>();
  const onOpened = useCallback(
    (result: CommandResult, warnings: readonly string[] = []) => {
      if (!result.ok) setMessage(`${result.code}: ${result.message}`);
      else {
        // The menu's opens report here once settled: their push is this tab's own.
        own.current.revisions.add(result.revision);
        setOpened({ revision: result.revision, report: result.report, warnings });
      }
    },
    [setMessage],
  );
  useEffect(() => {
    if (!opened || live.revision < opened.revision) return;
    toStrip({
      kind: "opened",
      title: workspace?.view?.title ?? "view",
      report: opened.report,
      warnings: opened.warnings,
    });
    setOpened(undefined);
  }, [opened, live.revision, workspace, toStrip]);
  const tabTitle = documentTitle(workspace);
  useEffect(() => {
    document.title = tabTitle;
  }, [tabTitle]);

  // Start-up from the address (add-multiuser M12): the start-up opened a `#view=` or `?view=` link
  // in a new workspace, or fell back to what `/` gives with the open's error.
  const startup = useRef(false);
  useEffect(() => {
    if (startup.current) return;
    startup.current = true;
    if (start.message !== undefined) setMessage(start.message);
    if (start.opened) onOpened(start.opened);
  }, [start, onOpened, setMessage]);
  // A catalog's open (add-case-open K10, K14), by link or by a dropped file: its missing signals,
  // fallback and warnings in the message line, once the workspace and its case arrived.
  const casesShown = useRef(false);
  const openedCase = workspace?.case;
  useEffect(() => {
    const report = start.cases;
    if (casesShown.current || !report || !openedCase) return;
    casesShown.current = true;
    const nameOf = (id: string) => {
      const s = infos.current.get(id);
      return s && shownName(s);
    };
    // The open's report goes into the session bar's note only, not the message line (design DW7).
    setOpenNote(openNoteText(report, openedCase, nameOf));
  }, [start, openedCase]);

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

  // The live channel closed for good (4403, 4404), or the workspace has no grant yet on a server:
  // the gate page replaces the workspace (M12). The empty grant lifts with the next `summary`.
  const gate =
    live.closed !== undefined
      ? gateOf(live.closed)
      : live.summary
        ? gateOf({ summary: live.summary }, start.me)
        : undefined;
  if (gate) return <GatePage gate={gate} me={start.me} />;

  return (
    <div
      className={appClass}
      style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}
    >
      {eventRefsKey
        .split(",")
        .filter(Boolean)
        .map((ref) => (
          <EventsLoader
            key={ref}
            dataRef={ref}
            signalsKey={eventSignals.filter((id) => dataRefOf(id) === ref).join(",")}
            scope={workspace?.scope}
            window={ref === workspace?.scope?.dataRef ? workWindow : undefined}
            view={barWindow?.range}
            onList={onEventList}
          />
        ))}
      <SignalExplorer
        scope={workspace?.scope}
        session={workspace?.case ? workspace.case.current + 1 : undefined}
        windows={windows}
        onAdd={addSignal}
        onAddMany={addSignals}
        onSeen={onSeen}
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
        eventsTab={eventsTab}
        favourites={live.favourites}
        computed={computed}
        computedDefs={computedDefs ?? []}
        onCommand={editorCommand}
      >
        <EventsPanel
          list={stripList}
          filter={eventFilter}
          signals={eventSignals}
          info={info}
          range={barWindow ? toRange(barWindow.range) : undefined}
          onCommand={command}
          onJump={onJump}
          cursorA={cursors.a}
          focus={eventsFocus}
          nearby={workspace?.scope?.object ? workWindow : undefined}
          caseLinked={workspace?.case?.linked === true}
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
                aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
                aria-expanded={sidebarOpen}
                title={HINTS.sidebarToggle(sidebarOpen)}
                onClick={toggleSidebar}
              >
                {/* Panel icon of the mock (Main.dc.html), design DW8. */}
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <line x1="9" y1="4" x2="9" y2="20" />
                </svg>
              </button>
              {workspace ? (
                <OverflowTailContext.Provider value={helpTail}>
                  <OptionBar
                    workspace={workspace}
                    target={barWindow}
                    canGoBack={canGoBack(barWindow?.id)}
                    onCommand={barCommand}
                    onBack={onBack}
                    onGoTo={onGoTo}
                    onGoToClear={onGoToClear}
                    range={barWindow ? toRange(barWindow.range) : undefined}
                    rangeLoaded
                    pickerOpen={pickerOpen}
                    onPickerOpen={setPickerOpen}
                    typed={typed}
                    onTyped={setTyped}
                    onApply={onApply}
                    onReset={() => {
                      if (barWindow) void onReset(barWindow.id, resetSignals(workspace));
                    }}
                    onOpened={onOpened}
                    trackOpen={trackOpen}
                    onNotice={setNotice}
                    onMessage={setMessage}
                    workspaceId={start.workspace}
                    summary={live.summary}
                    me={start.me}
                  />
                </OverflowTailContext.Provider>
              ) : (
                // Before the first workspace state: the range button's box, showing "…".
                <div className="option-bar">
                  <RangeButton range={undefined} loaded={false} hint={HINTS.goTo(true)} />
                </div>
              )}
            </div>
            {/* The context row (design DW3): the session bar for a case, with skeletons from the
                first paint of an opening /open#cases= page; else the scope row; else nothing. */}
            {workspace?.case || (start.cases && !workspace) ? (
              <SessionBar
                caseState={workspace?.case}
                scope={workspace?.scope}
                pending={pending}
                progress={progress}
                actionPending={actionPending}
                unlinkHint={unlinkHint}
                onCommand={caseCommand}
                openNote={openNote}
                onDismissNote={() => setOpenNote(undefined)}
              />
            ) : (
              workspace?.scope && (
                <ScopeRow
                  scope={workspace.scope}
                  mode={meta.meta?.catalog.mode}
                  onScopeCommand={command}
                />
              )
            )}
            <TimeStrip
              workspace={workspace ?? EMPTY_WORKSPACE}
              navigate={barWindow ? stripNavigate : undefined}
              events={stripEvents}
              drop={stripDrop}
              mode={meta.meta?.catalog.mode}
              onScopeCommand={command}
              caseCatalog={caseCatalog}
              workWindow={workWindow}
              stepping={progress && actionPending === undefined}
            />
          </div>
          {/* Scoped mode without a scope (scope "Scope card"): the card first; an open catalog
              always sets a scope. */}
          {workspace && noScope && meta.meta && (
            <ScopeCard
              workspace={workspace}
              pad={BigInt(meta.meta.limits?.scopePad ?? serverLimits().scopePad)}
              onCommand={command}
              hidden={activeDrag !== undefined}
            />
          )}
          {/* Hidden during a drag but kept in place, so nothing below it moves (B1, B2). */}
          {workspace && (windows.length === 0 || !startHidden) && (
            <StartCard
              empty={windows.length === 0}
              hidden={activeDrag !== undefined}
              onDismiss={onDismissStart}
              onHelp={setHelp}
            />
          )}
          {/* Any click that ends inside a window marks it (H1); a drag between windows ends on
              the grid or higher and marks nothing. Keyboard marking is the "Add to" select. */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: delegated click, see above */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: delegated click, see above */}
          <div
            className="window-grid"
            onClick={(e) => {
              const id = markTarget(e.target as Element);
              if (id) onMark(id);
            }}
          >
            {windows.map((w) => (
              <WindowBoundary key={w.id} windowId={w.id} revision={live.revision} onReady={onReady}>
                {isTimeseries(w) ? (
                  <TimeseriesWindow
                    window={w}
                    revision={live.revision}
                    rangeSets={live.rangeSets}
                    scopeKey={workspaceScope}
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
                    nextHints={nextHints}
                    noScope={noScope}
                    {...eventsProp(windowEvents.get(w.id))}
                    {...dropProp(dropStateOf(w.id))}
                    {...dropActionProp}
                  />
                ) : (
                  <ValuesWindow
                    window={w}
                    revision={live.revision}
                    scopeKey={workspaceScope}
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
          message={strip?.text}
          messageTone={strip?.tone ?? "error"}
          messageTitle={strip?.title ?? strip?.text}
          onDismissMessage={dismissMessage}
          measurement={workspace?.measurement}
          meta={meta.meta}
          me={start.me}
          metaStale={meta.stale}
          dragging={activeDrag !== undefined}
          over={stripOver}
          dropRef={dropRef}
        />
      </div>
      {help && (
        <HelpPanel tab={help} onTab={setHelp} onClose={closeHelp} onShowStart={onShowStart} />
      )}
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
