import { EMPTY_WORKSPACE, type LiveServerMessage } from "@kipscope/shared";
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

  it("keeps the last view open across later pushes", () => {
    const push = (revision: number, command?: "view.open" | "window.setRange") =>
      ({
        type: "state",
        revision,
        workspace: EMPTY_WORKSPACE,
        ...(command ? { command } : {}),
      }) as LiveServerMessage;
    let state: LiveState = { connected: true, revision: -1, rangeSets: 0 };
    // The state sent on connect (no command) never sets it.
    state = applyLiveMessage(state, push(0));
    expect(state.lastOpen).toBeUndefined();
    // A view.open push sets it.
    const open = push(1, "view.open");
    state = applyLiveMessage(state, open);
    expect(state.lastOpen).toEqual(open);
    expect(state.lastOpen?.revision).toBe(1);
    // Later pushes (also in the same batch) leave it in place while the revision moves on.
    state = applyLiveMessage(state, push(2, "window.setRange"));
    state = applyLiveMessage(state, push(3));
    expect(state.revision).toBe(3);
    expect(state.lastOpen?.revision).toBe(1);
    // A hello does not touch it either.
    state = applyLiveMessage(state, { type: "hello", clientId: "c1" } as LiveServerMessage);
    expect(state.lastOpen?.revision).toBe(1);
    // A newer open replaces it.
    state = applyLiveMessage(state, push(4, "view.open"));
    expect(state.lastOpen?.revision).toBe(4);
  });
});
