import type { TimeseriesWindow } from "@kipscope/shared";
import { describe, expect, it } from "vitest";
import {
  draggedHeight,
  heightCommand,
  startsHeightDrag,
  trackHeightDrag,
} from "../src/chart/height.ts";

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

  it("starts only on a primary press without Ctrl", () => {
    expect(startsHeightDrag({ button: 0, ctrlKey: false })).toBe(true);
    expect(startsHeightDrag({ button: 2, ctrlKey: false })).toBe(false); // right click
    expect(startsHeightDrag({ button: 1, ctrlKey: false })).toBe(false); // middle click
    expect(startsHeightDrag({ button: 0, ctrlKey: true })).toBe(false); // macOS Ctrl-click
  });
});

describe("trackHeightDrag", () => {
  const pointer = (type: string, clientY = 0) => {
    const event = new Event(type);
    Object.defineProperty(event, "clientY", { value: clientY });
    return event;
  };
  function drag() {
    const handle = new EventTarget();
    const calls = { move: [] as number[], end: 0, release: 0 };
    const dispose = trackHeightDrag(handle, {
      move: (y) => calls.move.push(y),
      end: () => {
        calls.end++;
      },
      release: () => {
        calls.release++;
      },
    });
    return { handle, calls, dispose };
  }

  it("ends a height drag on lost capture and on unmount", () => {
    // Lost capture alone ends the drag.
    const lost = drag();
    lost.handle.dispatchEvent(pointer("pointermove", 5));
    expect(lost.calls.move).toEqual([5]);
    lost.handle.dispatchEvent(pointer("lostpointercapture"));
    expect(lost.calls).toMatchObject({ end: 1, release: 1 });
    lost.handle.dispatchEvent(pointer("pointermove", 9));
    expect(lost.calls.move).toEqual([5]);

    // pointerup, then the lostpointercapture that browsers fire after it: still once.
    const up = drag();
    up.handle.dispatchEvent(pointer("pointerup"));
    up.handle.dispatchEvent(pointer("lostpointercapture"));
    expect(up.calls).toMatchObject({ end: 1, release: 1 });

    // Unmount before any pointer event releases without ending.
    const unmounted = drag();
    unmounted.dispose();
    unmounted.handle.dispatchEvent(pointer("pointermove", 7));
    unmounted.handle.dispatchEvent(pointer("pointerup"));
    expect(unmounted.calls).toEqual({ move: [], end: 0, release: 1 });
    // Disposing after an ended drag releases nothing more.
    lost.dispose();
    expect(lost.calls.release).toBe(1);
    expect(lost.calls.end).toBe(1);
  });
});
