import {
  type CommandInput,
  DEFAULT_PLOT_HEIGHT,
  MAX_PLOT_HEIGHT,
  MIN_PLOT_HEIGHT,
  type TimeseriesWindow,
} from "@letsview/shared";

/** Plot height after a vertical drag of dy CSS px from startHeight: rounded, clamped to
 * MIN_PLOT_HEIGHT..MAX_PLOT_HEIGHT. */
export function draggedHeight(startHeight: number, dy: number): number {
  return Math.min(MAX_PLOT_HEIGHT, Math.max(MIN_PLOT_HEIGHT, Math.round(startHeight + dy)));
}

/** The command for a released height drag: window.setHeight with this height, or undefined when it
 * equals the stored height (w.height ?? DEFAULT_PLOT_HEIGHT). */
export function heightCommand(w: TimeseriesWindow, height: number): CommandInput | undefined {
  if (height === (w.height ?? DEFAULT_PLOT_HEIGHT)) return undefined;
  return { type: "window.setHeight", windowId: w.id, height };
}
