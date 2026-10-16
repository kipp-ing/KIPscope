import { EMPTY_WORKSPACE, type LiveServerMessage } from "@letsview/shared";
import { describe, expect, it } from "vitest";
import { applyLiveMessage, type LiveState } from "../src/live.ts";

describe("applyLiveMessage", () => {
  it("counts range commands from state pushes", () => {
    const push = (revision: number, command?: "window.setRange" | "window.rename") =>
      ({
        type: "state",
        revision,
        workspace: EMPTY_WORKSPACE,
        ...(command ? { command } : {}),
      }) as LiveServerMessage;
    let state: LiveState = { connected: true, revision: -1, rangeSets: 0 };
    state = applyLiveMessage(state, push(1, "window.setRange"));
    expect(state.rangeSets).toBe(1);
    expect(state.revision).toBe(1);
    state = applyLiveMessage(state, push(2, "window.rename"));
    expect(state.rangeSets).toBe(1);
    state = applyLiveMessage(state, push(3));
    expect(state.rangeSets).toBe(1);
    expect(state.revision).toBe(3);
  });
});
