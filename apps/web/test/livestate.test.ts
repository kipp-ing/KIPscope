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

  it("keeps favourites apart from the workspace state", () => {
    const state = {
      type: "state",
      revision: 4,
      workspace: EMPTY_WORKSPACE,
    } as LiveServerMessage;
    let live: LiveState = { connected: true, revision: -1, rangeSets: 0 };
    // The workspace is not there yet and no star is known.
    expect(live.favourites).toBeUndefined();
    live = applyLiveMessage(live, state);
    const before = live;
    live = applyLiveMessage(live, { type: "favourites", names: ["A.B"] });
    expect(live.favourites).toEqual(["A.B"]);
    expect(live.revision).toBe(4);
    expect(live.workspace).toBe(before.workspace);
    expect(live.rangeSets).toBe(before.rangeSets);
    expect(live.lastOpen).toBe(before.lastOpen);
    expect(live.summary).toBe(before.summary);
    expect(live.clientId).toBe(before.clientId);

    // A later state push moves the revision and leaves the favourites; a newer message replaces them.
    live = applyLiveMessage(live, { ...state, revision: 5 } as LiveServerMessage);
    expect(live.revision).toBe(5);
    expect(live.favourites).toEqual(["A.B"]);
    live = applyLiveMessage(live, { type: "favourites", names: [], error: "unreadable" });
    expect(live.favourites).toEqual([]);
    expect(live.revision).toBe(5);
    // A hello and a summary keep them too.
    live = applyLiveMessage(live, { type: "favourites", names: ["C.D", "A.B"] });
    live = applyLiveMessage(live, { type: "hello", clientId: "c1" } as LiveServerMessage);
    expect(live.favourites).toEqual(["C.D", "A.B"]);
    expect(live.revision).toBe(5);
  });
});
