import type { WorkspaceScope } from "@kipscope/shared";
import { TooWideError } from "./scanBound.ts";

/** A work window the routes refuse (400 `invalid_request`, add-case-open K10, K11). */
export class WorkWindowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkWindowError";
  }
}

/**
 * Parses and checks a work window for an object scope (400 invalid_request texts of K10/K11);
 * undefined outside one. In an object scope `from` and `to` are required (`WorkWindowError`), `to`
 * after `from`, at most `maxSpanNs` apart (`TooWideError`, scope "Scan bound"); the window is cut
 * to the scope and must overlap it.
 */
export function workWindowOf(
  query: { from?: bigint | undefined; to?: bigint | undefined },
  scope: WorkspaceScope | undefined,
  maxSpanNs: bigint,
): { from: bigint; to: bigint } | undefined {
  if (!scope?.object) return undefined;
  const { from, to } = query;
  if (from === undefined || to === undefined) {
    throw new WorkWindowError("from and to are required in an object scope (the work window)");
  }
  if (to <= from) throw new WorkWindowError("to must be after from");
  if (to - from > maxSpanNs) throw new TooWideError({ span: to - from, maxSpan: maxSpanNs });
  const lo = from > BigInt(scope.from) ? from : BigInt(scope.from);
  const hi = to < BigInt(scope.to) ? to : BigInt(scope.to);
  if (hi <= lo) throw new WorkWindowError("the work window lies outside the scope");
  return { from: lo, to: hi };
}
