import {
  type CommandInput,
  type CommandResult,
  type CursorName,
  EMPTY_WORKSPACE,
  isTimeseries,
  type RenderError,
  type SignalInfo,
  signalColor,
} from "@letsview/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchExtent, sendCommand, signalInfo } from "./api.ts";
import { barTarget, resetSignals } from "./bar/bar.ts";
import { OptionBar } from "./bar/OptionBar.tsx";
import {
  type AnyDragSource,
  canAdd,
  canDrop,
  DRAG_THRESHOLD_PX,
  type DragSource,
  type DropState,
  type DropTarget,
  dropCommand,
  dropStateFor,
  isCopy,
  isLegendSource,
} from "./chart/drag.ts";
import { type Insets, mergeInsets } from "./chart/insets.ts";
import { TimeseriesWindow } from "./chart/TimeseriesWindow.tsx";
import { clampRange, extentRange, historyKey, type Range, ZoomHistory } from "./chart/zoom.ts";
import { NEW_WINDOW, SignalExplorer } from "./explorer/SignalExplorer.tsx";
import { isTextField } from "./keys.ts";
import { useLive } from "./live.ts";
import { ValuesWindow } from "./values/ValuesWindow.tsx";

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

/** Auto-scroll band below the option bar and above the drop zone (design C7), and its top speed per frame. */
const EDGE_PX = 48;
const EDGE_SCROLL_PX = 24;

/** Drop target under a viewport point: a window section or the "+ New window" zone. */
function targetAt(x: number, y: number): DropTarget | undefined {
  const el = document.elementFromPoint(x, y)?.closest("[data-window-id],[data-drop]");
  const windowId = el?.getAttribute("data-window-id");
  if (windowId) return { kind: "window", windowId };
  return el?.getAttribute("data-drop") === "new" ? { kind: "new" } : undefined;
}

/** A cursor line placed or dragged but not yet in the workspace (design C2). */
interface CursorPreview {
  cursor: CursorName;
  t: bigint;
}

/** Optional `dropState` prop; absent rather than undefined (exactOptionalPropertyTypes). */
const dropProp = (state: DropState | undefined) => (state ? { dropState: state } : {});

const toRange = (r: { from: string; to: string }): Range => ({
  from: BigInt(r.from),
  to: BigInt(r.to),
});

export function App() {
  const [live, send] = useLive();
  const [message, setMessage] = useState<string | undefined>();

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
  const windows = workspace?.windows ?? [];
  const linked = workspace?.linkTime ?? true;
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
  const onBack = useCallback(
    (windowId: string) => {
      const r = histories.current
        .get(historyKey(liveRef.current.workspace?.linkTime ?? true, windowId))
        ?.back();
      if (!r) return;
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
        const target = clampRange(extent);
        const current = toRange(w.range);
        if (target.from === current.from && target.to === current.to) return;
        historyOf(historyKey(liveRef.current.workspace?.linkTime ?? true, windowId)).push(current);
        setHistoryVersion((v) => v + 1);
        await setRange(windowId, target);
      } catch (e) {
        setMessage(e instanceof Error ? e.message : String(e));
      }
    },
    [historyOf, setRange],
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

  // Backspace steps back in the timeseries window under the pointer, else in the window zoomed last.
  const hovered = useRef<string | undefined>(undefined);
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const el = e.target instanceof Element ? e.target.closest("[data-window-id]") : null;
      hovered.current = el?.getAttribute("data-window-id") ?? undefined;
    };
    // Pointer left the page: no window is under it any more.
    const onOut = (e: PointerEvent) => {
      if (!e.relatedTarget) hovered.current = undefined;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Backspace" || e.altKey || e.ctrlKey || e.metaKey) return;
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
  }, [onBack]);

  // Drag and drop of legend rows (design D5) and explorer rows, with pointer events on the document.
  const [drag, setDrag] = useState<Drag | undefined>();
  const dragRef = useRef<Drag | undefined>(undefined);
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
      const label = infos.current.get(source.signalId)?.name ?? source.signalId;
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

      // Pointer near the visible top (below the option bar) or bottom (above the drop zone)
      // of the window list scrolls it, faster the closer. On the drop zone itself it rests (C7).
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
        if (!cur.active) window.getSelection()?.removeAllRanges();
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
  const canGoBack = (windowId: string | undefined) =>
    windowId !== undefined && (histories.current.get(historyKey(linked, windowId))?.size ?? 0) > 0;

  const activeDrag = drag?.active ? drag : undefined;
  const legendDrag = activeDrag !== undefined && isLegendSource(activeDrag.source);
  const dropStateOf = (windowId: string): DropState | undefined =>
    activeDrag && dropStateFor(activeDrag.source, windowId, windows, unitOf);
  const dropActionProp = activeDrag && !legendDrag ? { dropAction: "add" as const } : {};
  const overValid =
    activeDrag?.target !== undefined &&
    (isLegendSource(activeDrag.source)
      ? canDrop(activeDrag.source, activeDrag.target, windows, unitOf)
      : canAdd(activeDrag.source.signalId, activeDrag.target, windows, unitOf));
  // Over another window that already shows the dragged signal: say why the drop is refused.
  const over = activeDrag?.target?.kind === "window" ? activeDrag.target.windowId : undefined;
  const overShown =
    activeDrag !== undefined &&
    !(isLegendSource(activeDrag.source) && over === activeDrag.source.windowId) &&
    windows.some(
      (w) => w.id === over && w.signals.some((s) => s.signalId === activeDrag.source.signalId),
    );

  // Render acknowledgement: a revision counts as rendered once every window reported it.
  const ready = useRef(new Map<string, { revision: number; errors: RenderError[] }>());
  const lastSent = useRef(-1);
  const acknowledge = useCallback(() => {
    const { revision, workspace } = liveRef.current;
    if (!workspace || revision === lastSent.current) return;
    const reports = workspace.windows.map((w) => ready.current.get(w.id));
    if (reports.some((r) => r?.revision !== revision)) return;
    const errors = reports.flatMap((r) => r?.errors ?? []);
    lastSent.current = revision;
    send({ type: "rendered", revision, status: errors.length ? "error" : "complete", errors });
  }, [send]);
  const onReady = useCallback(
    (windowId: string, revision: number, errors: RenderError[]) => {
      ready.current.set(windowId, { revision, errors });
      acknowledge();
    },
    [acknowledge],
  );
  useEffect(() => {
    if (live.revision >= 0) acknowledge();
  }, [live.revision, acknowledge]);
  useEffect(() => {
    if (!live.connected) lastSent.current = -1;
  }, [live.connected]);

  const appClass = ["app", activeDrag && "dragging", activeDrag && !overValid && "drag-invalid"]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={appClass}>
      <SignalExplorer
        windows={windows}
        onAdd={addSignal}
        onSeen={remember}
        onDragStart={onDragStart}
        dragging={activeDrag !== undefined}
        colorOf={explorerColorOf}
      />
      <div className="workspace">
        <main ref={mainRef}>
          <header className="topbar">
            <h1>letsview</h1>
            <span className={`conn ${live.connected ? "ok" : "down"}`}>
              {live.connected ? `connected · revision ${live.revision}` : "disconnected"}
            </span>
            {message && (
              <button type="button" className="message" onClick={() => setMessage(undefined)}>
                {message} ✕
              </button>
            )}
          </header>
          {workspace && (
            <div className="option-bar-slot" ref={barRef}>
              <OptionBar
                workspace={workspace}
                target={barWindow}
                canGoBack={canGoBack(barWindow?.id)}
                onCommand={barCommand}
                onBack={onBack}
                onReset={() => {
                  if (barWindow) void onReset(barWindow.id, resetSignals(workspace));
                }}
              />
            </div>
          )}
          {windows.map((w) =>
            isTimeseries(w) ? (
              <TimeseriesWindow
                key={w.id}
                window={w}
                revision={live.revision}
                info={info}
                colorOf={colorOf}
                onCommand={command}
                onReady={onReady}
                onZoomed={onZoomed}
                canGoBack={canGoBack(w.id)}
                onBack={onBack}
                onReset={onReset}
                onDragStart={onDragStart}
                insets={insets}
                onInsets={onInsets}
                cursors={cursors}
                onCursorPreview={onCursorPreview}
                onCursorCommit={onCursorCommit}
                {...dropProp(dropStateOf(w.id))}
                {...dropActionProp}
              />
            ) : (
              <ValuesWindow
                key={w.id}
                window={w}
                revision={live.revision}
                cursors={workspace?.cursors ?? EMPTY_WORKSPACE.cursors}
                dragging={cursorPreview !== undefined}
                info={info}
                colorOf={colorOf}
                onCommand={command}
                onReady={onReady}
                onDragStart={onDragStart}
                {...dropProp(dropStateOf(w.id))}
                {...dropActionProp}
              />
            ),
          )}
          {workspace && windows.length === 0 && (
            <p className="hint">No windows yet. Search a signal and add it to a new window.</p>
          )}
        </main>
        {activeDrag && (
          // Below the window list, not over it: the list shrinks by the zone's height, so the zone
          // stays at the viewport bottom wherever the list is scrolled and never covers a window (C7).
          <div
            ref={dropRef}
            className={`drop-new${activeDrag.target?.kind === "new" ? " over" : ""}`}
            data-drop="new"
          >
            + New window
          </div>
        )}
      </div>
      {activeDrag && (
        <div className="drag-ghost" style={{ left: activeDrag.x + 12, top: activeDrag.y + 12 }}>
          <span className="swatch" style={{ background: colorOf(activeDrag.source.signalId) }} />
          {activeDrag.label}
          <span className="drag-mode">
            {overValid ? (!legendDrag ? " · add" : activeDrag.copy ? " · copy" : " · move") : ""}
          </span>
          {overShown && <span className="drag-note">· Already shown</span>}
        </div>
      )}
    </div>
  );
}
