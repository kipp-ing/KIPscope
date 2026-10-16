import { type Digits, formatQuantity, type SignalInfo } from "@kipscope/shared";
import { useSyncExternalStore } from "react";
import type { Cell } from "../values/format.ts";
import { snapCursorTime } from "./cursors.ts";
import { type ReadoutValue, readoutCell } from "./readout.ts";
import type { Range } from "./zoom.ts";

/** Max distance in CSS px from the pointer to a curve for it to be near (D-032, doubled by D-052: 16 px). */
export const NEAR_PX = 16;
/** Line width in px of the near signal; normal series width is 1.5. */
export const HIGHLIGHT_WIDTH = 3;
/** Alpha of every other signal of the hovered window while one is near. */
export const FADE_ALPHA = 0.3;
/** Distance in px between the near signal's curve point and its label. */
export const LABEL_GAP_PX = 6;
/** The values window looks L up once the pointer rested this long (design L7). */
export const LIVE_REST_MS = 150;

/** The live cursor L (D-032): the time under the pointer in the hovered window. */
export interface LiveCursor {
  windowId: string; // the hovered window (owner)
  t: bigint; // L, ns
  near?: string; // assignment id of the highlighted signal in the owner window
}

const same = (a: LiveCursor | undefined, b: LiveCursor | undefined) =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    a.windowId === b.windowId &&
    a.t === b.t &&
    a.near === b.near);

/**
 * Browser-local store of L (design L1): the hovered window writes it, every window and the
 * values window read it. No command, no revision. Sets are coalesced per animation frame.
 */
export class LiveStore {
  private current: LiveCursor | undefined;
  private queued: LiveCursor | undefined;
  private frame: number | undefined;
  private holds = 0;
  private readonly listeners = new Set<() => void>();
  private readonly raf: (fn: () => void) => number;
  private readonly caf: (id: number) => void;

  constructor(raf?: (fn: () => void) => number, caf?: (id: number) => void) {
    // Looked up at call time: the singleton is built where no animation frame exists (tests).
    this.raf = raf ?? ((fn) => requestAnimationFrame(fn));
    this.caf = caf ?? ((id) => cancelAnimationFrame(id));
  }

  /** Snapshot; the same object until windowId, t or near changes. */
  get = (): LiveCursor | undefined => this.current;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Queues next; published in the next animation frame, the last call of a frame wins. Ignored while suspended. */
  set(next: LiveCursor): void {
    if (this.holds > 0) return;
    this.queued = next;
    if (this.frame === undefined) this.frame = this.raf(() => this.flush());
  }

  /** Clears now and drops a queued set; with windowId only if the current or queued owner is that window. */
  clear(windowId?: string): void {
    if (windowId === undefined || this.queued?.windowId === windowId) this.drop();
    if (windowId === undefined || this.current?.windowId === windowId) this.publish(undefined);
  }

  /** Clears and keeps L unset until every returned release has run (counted; release is idempotent). */
  suspend(): () => void {
    this.holds++;
    this.clear();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holds--;
    };
  }

  private drop() {
    if (this.frame !== undefined) this.caf(this.frame);
    this.frame = undefined;
    this.queued = undefined;
  }

  private flush() {
    const next = this.queued;
    this.frame = undefined;
    this.queued = undefined;
    if (next) this.publish(next);
  }

  private publish(next: LiveCursor | undefined) {
    if (same(this.current, next)) return;
    this.current = next;
    for (const listener of [...this.listeners]) listener();
  }
}

/** The one L of this browser tab. */
export const liveCursor = new LiveStore();

/** The current L (re-renders each published frame). */
export function useLiveCursor(store: LiveStore = liveCursor): LiveCursor | undefined {
  return useSyncExternalStore(store.subscribe, store.get);
}

/** near of windowId's L, else undefined (re-renders only when it changes). */
export function useLiveNear(windowId: string, store: LiveStore = liveCursor): string | undefined {
  return useSyncExternalStore(store.subscribe, () => {
    const live = store.get();
    return live?.windowId === windowId ? live.near : undefined;
  });
}

/**
 * L at a pointer offset (`u.posToVal(x, "x")`, ns from origin): snapped and kept inside the
 * half-open shown range exactly like a click, so a click without moving places A at L (L2).
 */
export function liveTime(offset: number, origin: bigint, shown: Range): bigint {
  return snapCursorTime(origin + BigInt(Math.round(offset)), shown.to - shown.from, shown);
}

/** The L legend cell (L4): empty without L, else the readout cell of the drawn value. */
export function liveCell(
  v: ReadoutValue | undefined,
  set: boolean,
  unit: string | undefined,
  digits: Digits,
  info?: SignalInfo,
): Cell {
  return set ? readoutCell(v, unit, digits, info) : { text: "" };
}

/**
 * The candidate whose curve y (CSS px, each on its own scale) is nearest to the pointer, at most
 * maxPx away; on equal distance the later one in legend order (L5).
 */
export function nearestSignal(
  candidates: readonly { key: string; y: number }[],
  pointerY: number,
  maxPx: number = NEAR_PX,
): string | undefined {
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const { key, y } of candidates) {
    const distance = Math.abs(y - pointerY);
    if (distance <= maxPx && distance <= bestDistance) {
      best = key;
      bestDistance = distance;
    }
  }
  return best;
}

/** The number of a readout value; undefined for SNA, no value and loading (L5: no candidate). */
export const numberOf = (v: ReadoutValue | undefined): number | undefined =>
  v && "value" in v ? v.value : undefined;

/**
 * Near candidates (L5): each signal's curve y in plot CSS px on its own scale (toY is
 * `u.valToPos`). Skipped: no scale (envelope edges, Q3), no number (SNA, gap, loading) or y
 * outside [0, plotHeight]. Legend order is kept for nearestSignal's tie rule.
 */
export function liveCandidates(
  signals: readonly { key: string; scale: string | undefined; value: ReadoutValue | undefined }[],
  toY: (value: number, scale: string) => number,
  plotHeight: number,
): { key: string; y: number }[] {
  const candidates: { key: string; y: number }[] = [];
  for (const { key, scale, value } of signals) {
    const n = numberOf(value);
    if (scale === undefined || n === undefined) continue;
    const y = toY(n, scale);
    if (y >= 0 && y <= plotHeight) candidates.push({ key, y });
  }
  return candidates;
}

/**
 * Whether a mouse up republishes L at its position (L8, D-033): only after a press on the plot
 * (down) that moved less than thresholdPx, i.e. a click; after a drag L stays cleared.
 */
export function shouldRepublishLive(
  down: { x: number; y: number } | undefined,
  up: { x: number; y: number },
  thresholdPx: number,
): boolean {
  return down !== undefined && Math.hypot(up.x - down.x, up.y - down.y) < thresholdPx;
}

/** Text of the highlight label (L6): the number with SI prefix and unit, no kind; none without a number. */
export function liveLabelText(
  v: ReadoutValue | undefined,
  unit: string | undefined,
  digits: Digits,
): string | undefined {
  switch (v?.kind) {
    case "raw":
    case "interpolated":
    case "held":
    case "aggregated":
      return formatQuantity(v.value, unit, digits);
    default:
      return undefined;
  }
}

/**
 * Top-left of the label in plot CSS px (L6): right of and above the curve point by gap; left of
 * it if it would cross the right edge, below it if it would cross the top; then kept inside.
 */
export function labelPosition(
  point: { x: number; y: number },
  size: { width: number; height: number },
  plot: { width: number; height: number },
  gap: number = LABEL_GAP_PX,
): { left: number; top: number } {
  let left = point.x + gap;
  if (left + size.width > plot.width) left = point.x - gap - size.width;
  let top = point.y - gap - size.height;
  if (top < 0) top = point.y + gap;
  const clamp = (v: number, max: number) => Math.max(0, Math.min(v, max));
  return {
    left: clamp(left, plot.width - size.width),
    top: clamp(top, plot.height - size.height),
  };
}
