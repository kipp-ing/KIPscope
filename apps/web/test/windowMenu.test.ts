import { describe, expect, it } from "vitest";
import { windowMenuItems } from "../src/window/WindowMenu.tsx";

describe("window menu", () => {
  it("offers display mode and min/max in the menu", () => {
    // Line mode, envelope off: Line checked without a command, Step and Markers send the mode.
    const line = windowMenuItems("w1", { mode: "line", envelope: false });
    expect(line.map((i) => i.label)).toEqual([
      "Line",
      "Step",
      "Markers",
      "Min/max",
      "Rename",
      "Remove window",
    ]);
    expect(line.map((i) => i.role)).toEqual([
      "menuitemradio",
      "menuitemradio",
      "menuitemradio",
      "menuitemcheckbox",
      "menuitem",
      "menuitem",
    ]);
    expect(line.map((i) => i.checked)).toEqual([true, false, false, false, undefined, undefined]);
    // The checked mode sends nothing.
    expect(line[0]?.command).toBeUndefined();
    expect(line[1]?.command).toEqual({ type: "window.setDisplay", windowId: "w1", mode: "step" });
    expect(line[2]?.command).toEqual({
      type: "window.setDisplay",
      windowId: "w1",
      mode: "markers",
    });
    // Min/max off: the item turns it on.
    expect(line[3]?.command).toEqual({
      type: "window.setDisplay",
      windowId: "w1",
      envelope: true,
    });
    // Rename and Remove are actions of the menu, not commands.
    expect(line[4]?.action).toBe("rename");
    expect(line[5]?.action).toBe("remove");

    // Step mode: Step is the checked one without a command, Line sends mode line.
    const step = windowMenuItems("w1", { mode: "step", envelope: false });
    expect(step.map((i) => i.checked).slice(0, 3)).toEqual([false, true, false]);
    expect(step[1]?.command).toBeUndefined();
    expect(step[0]?.command).toEqual({ type: "window.setDisplay", windowId: "w1", mode: "line" });

    // Envelope on: the checkbox is checked and the item turns it off.
    const on = windowMenuItems("w2", { mode: "line", envelope: true });
    expect(on[3]?.checked).toBe(true);
    expect(on[3]?.command).toEqual({
      type: "window.setDisplay",
      windowId: "w2",
      envelope: false,
    });

    // A values window has no display: Rename and Remove window only.
    const values = windowMenuItems("w3", undefined);
    expect(values.map((i) => i.label)).toEqual(["Rename", "Remove window"]);
    expect(values.map((i) => i.role)).toEqual(["menuitem", "menuitem"]);
  });
});
