import type { TimeseriesWindow } from "@letsview/shared";
import { describe, expect, it } from "vitest";
import { draggedHeight, heightCommand } from "../src/chart/height.ts";

function win(height?: number): TimeseriesWindow {
  return {
    id: "w1",
    kind: "timeseries",
    range: { from: "0", to: "10" },
    display: { mode: "line", envelope: false },
    signals: [],
    ...(height === undefined ? {} : { height }),
  };
}

describe("height drag", () => {
  it("clamps a dragged height to 120-1200 px", () => {
    expect(draggedHeight(280, -230)).toBe(120); // 50 -> 120
    expect(draggedHeight(280, 4720)).toBe(1200); // 5000 -> 1200
    expect(draggedHeight(280, 200.4)).toBe(480); // rounded
    expect(draggedHeight(280, 200.6)).toBe(481);
    expect(draggedHeight(300, -180)).toBe(120); // exact lower bound
    expect(draggedHeight(1000, 200)).toBe(1200); // exact upper bound
    expect(draggedHeight(280, 0)).toBe(280);
  });

  it("sends one setHeight only when the height changed", () => {
    // Stored height: no command.
    expect(heightCommand(win(400), 400)).toBe(undefined);
    // Height absent means the default of 280 px.
    expect(heightCommand(win(), 280)).toBe(undefined);
    expect(heightCommand(win(), 281)).toEqual({
      type: "window.setHeight",
      windowId: "w1",
      height: 281,
    });
    expect(heightCommand(win(400), 280)).toEqual({
      type: "window.setHeight",
      windowId: "w1",
      height: 280,
    });
    expect(heightCommand(win(400), 120)).toEqual({
      type: "window.setHeight",
      windowId: "w1",
      height: 120,
    });
  });
});
