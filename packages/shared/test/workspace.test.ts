import { describe, expect, it } from "vitest";
import { Command, RenderedMessage } from "../src/workspace.ts";

describe("Command schema", () => {
  it("accepts valid commands and normalizes times to decimal nanoseconds", () => {
    const cmd = Command.parse({
      type: "window.create",
      from: "2026-10-13T09:00:00Z",
      to: "1791889200000000000",
    });
    expect(cmd).toEqual({
      type: "window.create",
      from: "1791882000000000000",
      to: "1791889200000000000",
    });
    expect(Command.parse({ type: "window.setDisplay", windowId: "w1", mode: "step" })).toEqual({
      type: "window.setDisplay",
      windowId: "w1",
      mode: "step",
    });
  });

  it("rejects malformed commands", () => {
    const bad = [
      {},
      { type: "window.explode" },
      { type: "window.remove" },
      { type: "window.remove", windowId: "" },
      { type: "window.addSignal", windowId: "w1" },
      { type: "window.setRange", windowId: "w1", from: "yesterday", to: "0" },
      { type: "window.setDisplay", windowId: "w1", mode: "bars" },
      { type: "window.setDisplay", windowId: "w1", envelope: "yes" },
    ];
    for (const input of bad) expect(Command.safeParse(input).success).toBe(false);
  });

  it("validates render acknowledgements", () => {
    expect(
      RenderedMessage.safeParse({ type: "rendered", revision: 3, status: "complete" }).success,
    ).toBe(true);
    expect(
      RenderedMessage.safeParse({ type: "rendered", revision: -1, status: "complete" }).success,
    ).toBe(false);
    expect(
      RenderedMessage.safeParse({ type: "rendered", revision: 1, status: "done" }).success,
    ).toBe(false);
  });
});
