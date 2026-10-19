import {
  CATEGORY_TEXT,
  type CommandInput,
  type EventList,
  type RenderError,
} from "@kipscope/shared";
import type { Io } from "./run.ts";

/** Exit code per outcome (design L3). */
export const EXIT = {
  ok: 0,
  rejected: 1,
  usage: 2,
  unreachable: 3,
  timeout: 4,
  render_error: 5,
  no_ui: 6,
  unavailable: 7,
} as const;
export type Outcome = keyof typeof EXIT;

export interface RenderWait {
  status: "complete" | "error" | "no_ui" | "timeout";
  /** Revision waited for. */
  target: number;
  /** Acknowledged revision that ended the wait (complete or error). */
  revision?: number;
  clientId?: string;
  /** Present for status "error". */
  errors?: RenderError[];
  waitedMs: number;
}

export interface CliOutput {
  /** exitCode === 0 */
  ok: boolean;
  outcome: Outcome;
  /** EXIT[outcome] */
  exitCode: number;
  /** The session the call served (add-multiuser M13). */
  session?: string;
  /** Commands only. */
  accepted?: boolean;
  /** As sent (times as decimal ns). */
  command?: CommandInput;
  /** After an accepted command; for `wait` the target; for `state` the current. */
  revision?: number;
  created?: string;
  createdWindow?: string;
  /** A move that emptied its source window removed it. */
  removedWindow?: string;
  /** --wait and `wait`. */
  render?: RenderWait;
  /** Reads: the server's body (state: {revision, workspace, render}). */
  data?: unknown;
  /** Local times with offset (design S2). */
  local?: Record<string, unknown>;
  error?: { code: string; message: string; candidates?: string[] };
}

/** Thrown anywhere below run(); run turns it into a CliOutput. */
export class CliError extends Error {
  readonly outcome: Exclude<Outcome, "ok">;
  readonly code: string;
  readonly candidates?: string[];

  constructor(
    outcome: Exclude<Outcome, "ok">,
    code: string,
    message: string,
    candidates?: string[],
  ) {
    super(message);
    this.name = "CliError";
    this.outcome = outcome;
    this.code = code;
    if (candidates !== undefined) this.candidates = candidates;
  }
}

/** One JSON line on stdout; on failure also `kipscope: <outcome>: <code>: <message>` on stderr. */
export function printOutput(out: CliOutput, io: Io, pretty: boolean): void {
  io.stdout(pretty ? JSON.stringify(out, null, 2) : JSON.stringify(out));
  if (out.ok) return;
  const code = out.error?.code ?? out.outcome;
  const message = out.error?.message ?? renderMessage(out.render) ?? out.outcome;
  io.stderr(`kipscope: ${out.outcome}: ${code}: ${message}`);
}

function renderMessage(render: RenderWait | undefined): string | undefined {
  if (render === undefined) return undefined;
  return `render ${render.status} for revision ${render.target} after ${render.waitedMs} ms`;
}

/** `data` of `events list`: the body of GET /api/events plus the filter in words (design C1). */
export type EventListData = EventList & { description: string };

/**
 * Lines of `events list --table` (design C1): local time, category, source, name, text (a change
 * as `<from> → <to>`), padded to the widest cell; then the skipped signals and, last, the count line.
 */
export function eventTable(data: EventListData, localT: string[]): string {
  const rows = data.events.map((e, i) => [
    tableTime(localT[i] ?? e.t),
    CATEGORY_TEXT[e.category].label,
    e.source,
    e.name,
    e.category === "change" && e.from ? `${e.from.text} → ${e.text}` : e.text,
  ]);
  const widths = rows.reduce<number[]>(
    (w, row) => row.map((cell, c) => Math.max(w[c] ?? 0, cell.length)),
    [],
  );
  const lines = rows.map((row) =>
    row
      .map((cell, c) => cell.padEnd(widths[c] ?? 0))
      .join("  ")
      .trimEnd(),
  );
  for (const s of data.skipped) lines.push(`skipped: ${s.signalId} (${s.reason})`);
  lines.push(
    `${data.events.length} of ${data.total} events · ${data.filter ?? ""} · ${data.description}`,
  );
  return lines.join("\n");
}

/** formatLocal with offset, at least to the millisecond so the column stays aligned. */
function tableTime(local: string): string {
  // "YYYY-MM-DD HH:MM:SS" is 19 characters; a fraction, if any, follows it.
  return local[19] === "." ? local : `${local.slice(0, 19)}.000${local.slice(19)}`;
}
