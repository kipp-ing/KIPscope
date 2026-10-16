import type { CommandInput, CommandResult, PlacementPlan } from "@kipscope/shared";

export interface AddDeps {
  command: (input: CommandInput) => Promise<CommandResult>;
  /** Range of a created window: undefined → none (linked with a timeseries window present);
   *  else extentRange of the extents of `signalIds` (union). May throw (fetch). */
  rangeFor: (signalIds: string[]) => Promise<{ from: bigint; to: bigint } | undefined>;
}

/**
 * Sends the plan in step order: before the first step into created window k, `window.create`
 * (with rangeFor(all signals of window k)); then `window.addSignal` into the target ID or the created
 * window's ID. Stops at the first result with ok false (its message stays shown, since `command`
 * sets it) or the first thrown error (rethrown). Returns the IDs of the windows created.
 */
export async function runPlan(
  plan: PlacementPlan,
  targetId: string | undefined,
  deps: AddDeps,
): Promise<string[]> {
  const created: string[] = [];
  for (const step of plan.steps) {
    let windowId: string | undefined;
    if (step.into === "target") {
      windowId = targetId;
    } else {
      const k = step.into;
      if (created[k] === undefined) {
        const ids = plan.steps.filter((s) => s.into === k).map((s) => s.signalId);
        const range = await deps.rangeFor(ids);
        // Untitled: the header shows "Window <n>", as for a single "New window" add.
        const result = await deps.command({
          type: "window.create",
          ...(range ? { from: range.from.toString(), to: range.to.toString() } : {}),
        });
        if (!result.ok || !result.created) return created;
        created[k] = result.created;
      }
      windowId = created[k];
    }
    if (windowId === undefined) return created;
    const result = await deps.command({
      type: "window.addSignal",
      windowId,
      signalId: step.signalId,
    });
    if (!result.ok) return created;
  }
  return created;
}
