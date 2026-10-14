import { describe, expect, it } from "vitest";
import { applyCommand } from "../src/apply.ts";
import { Command, type CommandInput, EMPTY_WORKSPACE, type Workspace } from "../src/workspace.ts";

const ctx = { signalExists: (id: string) => id.startsWith("car/") };

function run(state: Workspace, input: CommandInput) {
  return applyCommand(state, Command.parse(input), ctx);
}

function ok(state: Workspace, input: CommandInput) {
  const result = run(state, input);
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result;
}

const create = { type: "window.create", from: "0", to: "1000" } as const;

describe("applyCommand", () => {
  it("creates windows with stable IDs and default display", () => {
    const r1 = ok(EMPTY_WORKSPACE, create);
    const r2 = ok(r1.workspace, { ...create, title: "Second", mode: "step" });
    expect(r1.created).toBe("w1");
    expect(r2.created).toBe("w2");
    expect(r2.workspace.windows).toEqual([
      {
        id: "w1",
        kind: "timeseries",
        range: { from: "0", to: "1000" },
        display: { mode: "line", envelope: false },
        signals: [],
      },
      {
        id: "w2",
        kind: "timeseries",
        title: "Second",
        range: { from: "0", to: "1000" },
        display: { mode: "step", envelope: false },
        signals: [],
      },
    ]);
  });

  it("adds and removes signals with assignment IDs", () => {
    const w = ok(EMPTY_WORKSPACE, create).workspace;
    const added = ok(w, { type: "window.addSignal", windowId: "w1", signalId: "car/A" });
    expect(added.created).toBe("a2");
    expect(added.workspace.windows[0]?.signals).toEqual([{ id: "a2", signalId: "car/A" }]);
    const removed = ok(added.workspace, {
      type: "window.removeSignal",
      windowId: "w1",
      assignmentId: "a2",
    });
    expect(removed.workspace.windows[0]?.signals).toEqual([]);
  });

  it("sets range and display of one window only", () => {
    let s = ok(EMPTY_WORKSPACE, create).workspace;
    s = ok(s, create).workspace;
    s = ok(s, { type: "window.setRange", windowId: "w1", from: "10", to: "20" }).workspace;
    s = ok(s, { type: "window.setDisplay", windowId: "w1", envelope: true }).workspace;
    expect(s.windows[0]).toMatchObject({
      range: { from: "10", to: "20" },
      display: { mode: "line", envelope: true },
    });
    expect(s.windows[1]).toMatchObject({
      range: { from: "0", to: "1000" },
      display: { mode: "line", envelope: false },
    });
  });

  it("removes windows", () => {
    const s = ok(EMPTY_WORKSPACE, create).workspace;
    expect(ok(s, { type: "window.remove", windowId: "w1" }).workspace.windows).toEqual([]);
  });

  it("rejects unknown IDs and leaves the state unchanged", () => {
    const s = ok(EMPTY_WORKSPACE, create).workspace;
    const frozen = structuredClone(s);
    const cases: [CommandInput, string][] = [
      [{ type: "window.remove", windowId: "w9" }, "unknown_window"],
      [{ type: "window.addSignal", windowId: "w9", signalId: "car/A" }, "unknown_window"],
      [{ type: "window.addSignal", windowId: "w1", signalId: "other/A" }, "unknown_signal"],
      [{ type: "window.removeSignal", windowId: "w1", assignmentId: "a9" }, "unknown_assignment"],
      [{ type: "window.setRange", windowId: "w1", from: "5", to: "5" }, "invalid_range"],
      [{ type: "window.create", from: "5", to: "1" }, "invalid_range"],
    ];
    for (const [input, code] of cases) {
      const result = run(s, input);
      expect(result).toMatchObject({ ok: false, code });
    }
    expect(s).toEqual(frozen);
  });

  it("allows at most 50 distinct signals across windows", () => {
    let s = ok(ok(EMPTY_WORKSPACE, create).workspace, create).workspace;
    for (let i = 0; i < 50; i++) {
      const windowId = i % 2 ? "w1" : "w2";
      s = ok(s, { type: "window.addSignal", windowId, signalId: `car/S${i}` }).workspace;
    }
    const over = run(s, { type: "window.addSignal", windowId: "w1", signalId: "car/S50" });
    expect(over).toMatchObject({ ok: false, code: "signal_limit" });
    // A signal already shown elsewhere does not count again.
    const again = ok(s, { type: "window.addSignal", windowId: "w1", signalId: "car/S0" });
    expect(again.workspace.windows[0]?.signals).toHaveLength(26);
  });
});
