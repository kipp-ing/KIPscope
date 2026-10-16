import type { WorkspaceWindow } from "./workspace.ts";
import { isTimeseries, MAX_UNITS, unitKey, windowUnits } from "./workspace.ts";

/** One placed signal: into the target window, or into the k-th window this add creates (0-based). */
export interface PlacementStep {
  signalId: string;
  into: "target" | number;
}

export interface PlacementPlan {
  /** In input order. Window k is created right before its first step. */
  steps: PlacementStep[];
  /** Number of windows to create (max `into` + 1, 0 when none). */
  windows: number;
  /** Signals the target already shows, in input order; never placed. */
  skipped: string[];
}

/** A window with these unit keys takes `key` if it shows it already or has room for one more. */
const fits = (units: Set<string>, key: string): boolean => units.has(key) || units.size < MAX_UNITS;

/**
 * D-066 with lead default L4. `target` undefined means "+ New window": window 0 is created for the
 * first signal. A timeseries target and every created window hold at most MAX_UNITS unit keys
 * (windowUnits/unitKey, a signal without unit is its own key), the target's existing signals
 * included; a values target takes every unit. Each signal goes into the first window where it fits:
 * the target, then created windows in creation order; if none fits, a new window. Repeated IDs in
 * `signalIds` count once (first occurrence). Pure.
 */
export function placeSignals(
  signalIds: readonly string[],
  target: WorkspaceWindow | undefined,
  unitOf: (signalId: string) => string | undefined,
): PlacementPlan {
  const steps: PlacementStep[] = [];
  const skipped: string[] = [];
  const shown = new Set(target?.signals.map((s) => s.signalId));
  // Undefined for a values target: it takes every unit.
  const targetUnits =
    target && isTimeseries(target) ? new Set(windowUnits(target, unitOf)) : undefined;
  const created: Set<string>[] = [];
  const seen = new Set<string>();
  for (const signalId of signalIds) {
    if (seen.has(signalId)) continue;
    seen.add(signalId);
    if (shown.has(signalId)) {
      skipped.push(signalId);
      continue;
    }
    const key = unitKey(signalId, unitOf(signalId));
    if (target && (!targetUnits || fits(targetUnits, key))) {
      targetUnits?.add(key);
      steps.push({ signalId, into: "target" });
      continue;
    }
    let k = created.findIndex((units) => fits(units, key));
    if (k < 0) {
      k = created.length;
      created.push(new Set());
    }
    created[k]?.add(key);
    steps.push({ signalId, into: k });
  }
  return { steps, windows: created.length, skipped };
}
