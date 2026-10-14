import {
  type CommandInput,
  type CommandResult,
  EMPTY_WORKSPACE,
  type RenderError,
  type SignalInfo,
  signalColor,
} from "@letsview/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchExtent, sendCommand, signalInfo } from "./api.ts";
import {
  type AnyDragSource,
  canAdd,
  canDrop,
  DRAG_THRESHOLD_PX,
  type DropState,
  type DropTarget,
  dropCommand,
  dropStateFor,
  isLegendSource,
} from "./chart/drag.ts";
import { type Insets, mergeInsets } from "./chart/insets.ts";
import { TimeseriesWindow } from "./chart/TimeseriesWindow.tsx";
import { clampRange, extentRange, historyKey, type Range, ZoomHistory } from "./chart/zoom.ts";
import { isTextField } from "./keys.ts";
import { useLive } from "./live.ts";
import { NEW_WINDOW, SignalExplorer } from "./SignalExplorer.tsx";

/** A running legend-row (design D5) or explorer-row drag; `active` once the pointer moved past the threshold. */
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

/** Auto-scroll zone at the top and bottom edge of the window list, and its top speed per frame. */
const EDGE_PX = 48;
const EDGE_SCROLL_PX = 24;

/** Drop target under a viewport point: a window section or the "+ New window" zone. */
function targetAt(x: number, y: number): DropTarget | undefined {
  const el = document.elementFromPoint(x, y)?.closest("[data-window-id],[data-drop]");
  const windowId = el?.getAttribute("data-window-id");
  if (windowId) return { kind: "window", windowId };
  return el?.getAttribute("data-drop") === "new" ? { kind: "new" } : undefined;
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

  const command = useCallback(async (input: CommandInput): Promise<CommandResult> => {
    const result = await sendCommand(input);
    setMessage(result.ok ? undefined : `${result.code}: ${result.message}`);
    return result;
  }, []);

  const addSignal = async (signal: SignalInfo, target: string) => {
    let windowId = target;
    if (target === NEW_WINDOW) {
      try {
        // While linked, a new window takes the shared range (design D6); otherwise the extent.
        const range =
          linked && windows.length > 0 ? undefined : extentRange([await fetchExtent(signal.id)]);
        // Untitled: the header shows "Window <n>", which cannot go stale when signals move.
        const created = await command({
          type: "window.create",
          ...(range ? { from: range.from.toString(), to: range.to.toString() } : {}),
        });
        if (!created.ok || !created.created) return;
        windowId = created.created;
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
  const onReset = useCallback(
    async (windowId: string) => {
      const w = liveRef.current.workspace?.windows.find((x) => x.id === windowId);
      if (!w || w.signals.length === 0) return;
      try {
        const ids = [...new Set(w.signals.map((s) => s.signalId))];
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
    windows.map((w) => w.id),
    natural,
  );
  const insets = useMemo(() => ({ left: maxLeft, right: maxRight }), [maxLeft, maxRight]);

  // Backspace steps back in the window under the pointer, else in the window zoomed last.
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
        (x) => x && ws?.windows.some((w) => w.id === x),
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
  const update = useCallback((d: Drag | undefined) => {
    dragRef.current = d;
    setDrag(d);
  }, []);
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
      // Only a legend drag can copy; Alt/Ctrl change nothing for an explorer drag.
      const legend = isLegendSource(source);
      let frame = 0;

      // Pointer near the top or bottom edge of the window list scrolls it, faster the closer.
      const autoScroll = () => {
        frame = 0;
        const cur = dragRef.current;
        const main = mainRef.current;
        if (!cur?.active || !main) return;
        const box = main.getBoundingClientRect();
        const top = Math.max(box.top, 0) + EDGE_PX;
        const bottom = Math.min(box.bottom, window.innerHeight) - EDGE_PX;
        const depth = cur.y < top ? cur.y - top : cur.y > bottom ? cur.y - bottom : 0;
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
          copy: legend && (e.altKey || e.ctrlKey),
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
        if (cmd) void command(cmd);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          finish();
        } else if (legend && (e.key === "Alt" || e.key === "Control") && dragRef.current?.active) {
          update({ ...dragRef.current, copy: true });
        }
      };
      const onKeyUp = (e: KeyboardEvent) => {
        const cur = dragRef.current;
        if (legend && (e.key === "Alt" || e.key === "Control") && cur?.active) {
          update({ ...cur, copy: e.altKey || e.ctrlKey });
        }
      };
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
      />
      <main ref={mainRef}>
        <header className="topbar">
          <h1>letsview</h1>
          <span className={`conn ${live.connected ? "ok" : "down"}`}>
            {live.connected ? `connected · revision ${live.revision}` : "disconnected"}
          </span>
          {workspace && (
            <label className="link-time" title="While on, zooming one window zooms all windows">
              <input
                type="checkbox"
                checked={linked}
                onChange={(e) =>
                  void command({ type: "workspace.setLinkTime", linked: e.target.checked })
                }
              />
              Link time axes
            </label>
          )}
          {message && (
            <button type="button" className="message" onClick={() => setMessage(undefined)}>
              {message} ✕
            </button>
          )}
        </header>
        {windows.map((w) => (
          <TimeseriesWindow
            key={w.id}
            window={w}
            revision={live.revision}
            info={info}
            colorOf={colorOf}
            onCommand={command}
            onReady={onReady}
            onZoomed={onZoomed}
            canGoBack={(histories.current.get(historyKey(linked, w.id))?.size ?? 0) > 0}
            onBack={onBack}
            onReset={onReset}
            onDragStart={onDragStart}
            insets={insets}
            onInsets={onInsets}
            {...dropProp(dropStateOf(w.id))}
            {...dropActionProp}
          />
        ))}
        {activeDrag && (
          <div
            className={`drop-new${activeDrag.target?.kind === "new" ? " over" : ""}`}
            data-drop="new"
          >
            + New window
          </div>
        )}
        {workspace && windows.length === 0 && (
          <p className="hint">No windows yet. Search a signal and add it to a new window.</p>
        )}
      </main>
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
