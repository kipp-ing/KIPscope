import {
  type CommandResult,
  clampToScope,
  type WorkspaceCase,
  type WorkspaceScope,
} from "@kipscope/shared";
import type { Range } from "../chart/zoom.ts";
import type { StripEvent } from "../views/notice.ts";
import { formatRange } from "./axis.ts";

/** Message of a range command the server moved into the scope (time-navigation, add-scope Z12). */
export const CLAMP_MESSAGE = "Stopped at the scope edge. Widen shows more.";
/** The same with a linked catalog, and in an object scope (time-navigation, add-case-open K14). */
export const SESSION_CLAMP_MESSAGE = "Stopped at the session edge. Unlink shows the whole vehicle.";
export const VEHICLE_CLAMP_MESSAGE = "Stopped at the end of the vehicle's data.";

/** The clamp message of a workspace: by its case, linked or not, else the scope's. */
export function clampMessage(c: Pick<WorkspaceCase, "linked"> | undefined): string {
  if (!c) return CLAMP_MESSAGE;
  return c.linked ? SESSION_CLAMP_MESSAGE : VEHICLE_CLAMP_MESSAGE;
}

/** Strip text in scoped mode without a scope (time-strip "Strip shows the scope"). */
export const NO_SCOPE = "No scope set";

/** Tooltips of the scope head (add-scope Z12). */
export const SCOPE_HINTS = {
  widen: "Widen the scope by its span on each side (one step; navigation never leaves the scope)",
  clear: "Clear the scope: the strip, catalog and queries cover whole recordings again",
  info: (span: string, width: string) =>
    `SCOPE: only this time window of one data ref is queried (${span}). Each bar is ${width}, its height the amount logged. Click to jump, drag to zoom, double-click for the whole scope`,
} as const;

/** The range the server leaves of `r` within `scope` (the clamp rule of add-scope Z6); `r` without a scope. */
export function scopeRange(r: Range, scope: WorkspaceScope | undefined): Range {
  if (!scope) return r;
  const { range } = clampToScope({ from: r.from.toString(), to: r.to.toString() }, scope);
  return { from: BigInt(range.from), to: BigInt(range.to) };
}

/** Head text of a scope: `<ref> · <from> – <to>` in local time, header format (add-scope Z12). */
export function scopeText(scope: WorkspaceScope): string {
  return `${scope.dataRef} · ${formatRange(BigInt(scope.from), BigInt(scope.to))}`;
}

/** Case notice texts this tab showed, combined texts included (add-case-open K14), oldest first. */
const caseNotices = new Set<string>();
/** Texts kept: only the latest can be in the slot; the rest bound the set. */
const CASE_NOTICES_KEPT = 16;

/** A case notice (K14), remembered so that `endedEvents` dismisses its exact text. */
export function caseNotice(text: string): StripEvent {
  caseNotices.delete(text);
  caseNotices.add(text);
  if (caseNotices.size > CASE_NOTICES_KEPT) {
    const oldest = caseNotices.values().next().value;
    if (oldest !== undefined) caseNotices.delete(oldest);
  }
  return { kind: "notice", text };
}

/**
 * What an accepted command without a message of its own does to the slot: it ends an older error,
 * an older clamp message and every case notice (K14); an info notice such as an open's stays.
 */
export function endedEvents(): StripEvent[] {
  const texts = new Set([
    CLAMP_MESSAGE,
    SESSION_CLAMP_MESSAGE,
    VEHICLE_CLAMP_MESSAGE,
    ...caseNotices,
  ]);
  return [
    { kind: "dismiss", tone: "error" },
    ...[...texts].map((text): StripEvent => ({ kind: "dismiss", text })),
  ];
}

/**
 * What a command result does to the strip's message slot: a refusal shows its code and message; a
 * result with `clamped` shows the clamp message of the workspace's case (`clampMessage`); any
 * other accepted command ends an older error, an older clamp message and any case notice
 * (`endedEvents`).
 */
export function resultStripEvents(
  result: CommandResult,
  c?: Pick<WorkspaceCase, "linked">,
): StripEvent[] {
  if (!result.ok) return [{ kind: "error", text: `${result.code}: ${result.message}` }];
  if (result.clamped)
    return [c ? caseNotice(clampMessage(c)) : { kind: "notice", text: CLAMP_MESSAGE }];
  return endedEvents();
}
