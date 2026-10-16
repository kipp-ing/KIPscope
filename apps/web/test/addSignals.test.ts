import type { CommandInput, CommandResult, PlacementPlan } from "@kipscope/shared";
import { describe, expect, it } from "vitest";
import { runPlan } from "../src/addSignals.ts";

describe("runPlan", () => {
  it("creates each window before its first signal and stops at the first refusal", async () => {
    const plan: PlacementPlan = {
      steps: [
        { signalId: "c/A", into: 0 },
        { signalId: "c/B", into: 0 },
        { signalId: "c/C", into: 0 },
      ],
      windows: 1,
      skipped: [],
    };
    const sent: CommandInput[] = [];
    const command = async (input: CommandInput): Promise<CommandResult> => {
      sent.push(input);
      if (input.type === "window.create") return { ok: true, revision: 1, created: "w7" };
      if (input.type === "window.addSignal" && input.signalId === "c/B") {
        return { ok: false, code: "signal_limit", message: "at most 50 signals" };
      }
      return { ok: true, revision: 2 };
    };
    const asked: string[][] = [];
    const rangeFor = async (ids: string[]) => {
      asked.push(ids);
      return { from: 5n, to: 9n };
    };
    const created = await runPlan(plan, "w1", { command, rangeFor });
    expect(asked).toEqual([["c/A", "c/B", "c/C"]]);
    expect(sent).toEqual([
      { type: "window.create", from: "5", to: "9" },
      { type: "window.addSignal", windowId: "w7", signalId: "c/A" },
      { type: "window.addSignal", windowId: "w7", signalId: "c/B" },
    ]);
    expect(created).toEqual(["w7"]);
  });

  it("sends target steps to the target and creates a window without range when none applies", async () => {
    const plan: PlacementPlan = {
      steps: [
        { signalId: "c/A", into: "target" },
        { signalId: "c/B", into: 0 },
      ],
      windows: 1,
      skipped: [],
    };
    const sent: CommandInput[] = [];
    const command = async (input: CommandInput): Promise<CommandResult> => {
      sent.push(input);
      return input.type === "window.create"
        ? { ok: true, revision: 1, created: "w8" }
        : { ok: true, revision: 2 };
    };
    const created = await runPlan(plan, "w1", { command, rangeFor: async () => undefined });
    expect(sent).toEqual([
      { type: "window.addSignal", windowId: "w1", signalId: "c/A" },
      { type: "window.create" },
      { type: "window.addSignal", windowId: "w8", signalId: "c/B" },
    ]);
    expect(created).toEqual(["w8"]);
  });
});
