import {
  type CommandInput,
  type CommandResult,
  type WorkspaceScope,
  widenScope,
} from "@kipscope/shared";
import { useState } from "react";
import { timesSlot } from "../case/sessionBar.ts";
import { SCOPE_HINTS, scopeText } from "./scope.ts";
import { formatSpan } from "./strip.ts";

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
 * declutter-workspace DW3, DW17): the session bar's slots with `SCOPE`, the data ref, the scope's
 * local times, its span, Widen and, in full mode, Clear. Arrows and position stay as hidden
 * placeholders, so the slots line up with the session bar's.
 */
export function ScopeRow({ scope, mode, onScopeCommand }: ScopeRowProps) {
  // A scope command on its way: Widen and Clear wait for its result.
  const [pending, setPending] = useState(false);
  const from = BigInt(scope.from);
  const to = BigInt(scope.to);
  const times = timesSlot(from, to);

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
        <span className="slot-title-text" title={scopeText(scope)}>
          {scope.dataRef}
        </span>
      </span>
      <span className="slot-times" title={times.timesTooltip}>
        {times.weekday !== undefined && <span className="slot-weekday">{times.weekday}</span>}
        {times.weekday !== undefined ? ` ${times.times ?? ""}` : times.times}
        {times.plusOne && <sup className="slot-plus">+1</sup>}
      </span>
      <span className="slot-duration">{formatSpan(to - from)}</span>
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
