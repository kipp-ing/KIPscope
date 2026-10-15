import { useSyncExternalStore } from "react";
import type { Range } from "./zoom.ts";

/** The preview range of a gesture, shown by every linked window (design Z9, D-041). */
export interface SharedPreview {
  /** Window whose gesture previews the range. */
  source: string;
  range: Range;
}

/** Tab singleton like `liveCursor` (live.ts); never workspace state, never sent to the server. */
export class LinkedPreviewStore {
  private current: SharedPreview | undefined;
  private readonly listeners = new Set<() => void>();

  /** Snapshot; the same object until the source or the range changes. */
  get = (): SharedPreview | undefined => this.current;

  /** Replaces the shared preview (the latest gesture wins) and notifies subscribers synchronously. */
  publish(source: string, range: Range): void {
    const current = this.current;
    if (
      current?.source === source &&
      current.range.from === range.from &&
      current.range.to === range.to
    )
      return;
    this.current = { source, range };
    this.notify();
  }

  /** Clears it only when `source` is the current source; notifies when it cleared. */
  clear(source: string): void {
    if (this.current?.source !== source) return;
    this.current = undefined;
    this.notify();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify() {
    for (const listener of [...this.listeners]) listener();
  }
}

/** The one shared preview of this browser tab. */
export const linkedPreview = new LinkedPreviewStore();

/** The current shared preview (re-renders on each publish and clear). */
export function useLinkedPreview(
  store: LinkedPreviewStore = linkedPreview,
): SharedPreview | undefined {
  return useSyncExternalStore(store.subscribe, store.get);
}

/** The range a window shows: its own preview, else (linked, another source) the shared one, else the server range. */
export function shownRange(
  windowId: string,
  own: Range | undefined,
  shared: SharedPreview | undefined,
  linked: boolean,
  server: Range,
): Range {
  if (own) return own;
  if (linked && shared && shared.source !== windowId) return shared.range;
  return server;
}
