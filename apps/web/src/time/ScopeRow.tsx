import {
  type CommandInput,
  type CommandResult,
  type WorkspaceScope,
  widenScope,
} from "@kipscope/shared";
import { useState } from "react";
import { timesSlot } from "../case/sessionBar.ts";
import { DurationTag } from "./Duration.tsx";
import { SCOPE_HINTS } from "./scope.ts";

/** Placeholders of the session bar's arrows and position: same boxes, never seen (DW3). */
const HIDDEN = { visibility: "hidden" } as const;

export interface ScopeRowProps {
  scope: WorkspaceScope;
  /** The server's catalog mode (meta); Clear shows in full mode only (add-scope Z12). */
  mode: "full" | "scoped" | undefined;
  /** Sends Widen's `scope.set` and Clear's `scope.clear`; absent → no buttons. */
  onScopeCommand?: (command: CommandInput) => Promise<CommandResult>;
}

/**
 * The context row of a scope without an open catalog (time-strip "Strip scope controls",
 * declutter-workspace DW3, DW17): the session bar's slots with `SCOPE`, the data ref (its start
 * and duration in the tooltip), the scope's duration, Widen and, in full mode, Clear; no start slot
 * (D-095). Arrows and position stay as hidden placeholders, so the slots line up with the session
 * bar's.
 */
export function ScopeRow({ scope, mode, onScopeCommand }: ScopeRowProps) {
  // A scope command on its way: Widen and Clear wait for its result.
  const [pending, setPending] = useState(false);
  const times = timesSlot(BigInt(scope.from), BigInt(scope.to));

  /** Sends one scope command; the buttons stay disabled until its result arrives. */
  const send = (command: CommandInput) => {
    if (!onScopeCommand || pending) return;
    setPending(true);
    onScopeCommand(command).finally(() => setPending(false));
  };

  return (
    <div className="context-row scope-row">
      <span className="slot-label">SCOPE</span>
      <span className="session-arrow" aria-hidden="true" style={HIDDEN} />
      <span className="session-menu" aria-hidden="true" style={HIDDEN}>
        <span className="session-position" />
      </span>
      <span className="session-arrow" aria-hidden="true" style={HIDDEN} />
      <span className="slot-title">
        <span
          className="slot-title-text"
          title={`${scope.dataRef} · ${times.startTooltip} · ${times.duration}`}
        >
          {scope.dataRef}
        </span>
      </span>
      <span className="slot-duration">
        <DurationTag text={times.duration} title={times.durationTooltip} />
      </span>
      {onScopeCommand && (
        <button
          type="button"
          className="time-strip-button slot-action"
          title={SCOPE_HINTS.widen}
          disabled={pending}
          onClick={() => send({ type: "scope.set", ...widenScope(scope) })}
        >
          Widen
        </button>
      )}
      {onScopeCommand && mode === "full" && (
        <button
          type="button"
          className="time-strip-button slot-action"
          title={SCOPE_HINTS.clear}
          disabled={pending}
          onClick={() => send({ type: "scope.clear" })}
        >
          Clear
        </button>
      )}
    </div>
  );
}
