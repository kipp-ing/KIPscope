import { z } from "zod";
import { fromIso, parseTimestamp } from "./time.ts";

/** Maximum number of distinct signals across all windows (spec workspace-state). */
export const MAX_SIGNALS = 50;

/** Time input: decimal nanoseconds since the epoch or ISO-8601; output: decimal-ns string. */
export const TimeInput = z.string().transform((value, ctx) => {
  try {
    return (/^-?\d+$/.test(value) ? parseTimestamp(value) : fromIso(value)).toString();
  } catch (error) {
    ctx.addIssue({ code: "custom", message: (error as Error).message });
    return z.NEVER;
  }
});

export const DisplayMode = z.enum(["line", "step", "markers"]);
export type DisplayMode = z.infer<typeof DisplayMode>;

export interface Display {
  mode: DisplayMode;
  /** Min/max envelope in aggregated views; off by default. */
  envelope: boolean;
}

export const DEFAULT_DISPLAY: Display = { mode: "line", envelope: false };

/** Half-open time range [from, to) as decimal-ns strings. */
export interface TimeRange {
  from: string;
  to: string;
}

export interface SignalAssignment {
  /** Stable ID of this signal's place in the window. */
  id: string;
  signalId: string;
}

export interface TimeseriesWindow {
  id: string;
  kind: "timeseries";
  title?: string;
  range: TimeRange;
  display: Display;
  signals: SignalAssignment[];
}

export interface Workspace {
  windows: TimeseriesWindow[];
  /** Counter for stable IDs (`w1`, `a2`, …); part of the state so applying commands stays pure. */
  nextId: number;
}

export const EMPTY_WORKSPACE: Workspace = { windows: [], nextId: 1 };

const Id = z.string().min(1).max(200);

export const Command = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("window.create"),
    title: z.string().max(200).optional(),
    from: TimeInput,
    to: TimeInput,
    mode: DisplayMode.optional(),
    envelope: z.boolean().optional(),
  }),
  z.object({ type: z.literal("window.remove"), windowId: Id }),
  z.object({ type: z.literal("window.addSignal"), windowId: Id, signalId: Id }),
  z.object({ type: z.literal("window.removeSignal"), windowId: Id, assignmentId: Id }),
  z.object({ type: z.literal("window.setRange"), windowId: Id, from: TimeInput, to: TimeInput }),
  z.object({
    type: z.literal("window.setDisplay"),
    windowId: Id,
    mode: DisplayMode.optional(),
    envelope: z.boolean().optional(),
  }),
]);
export type Command = z.infer<typeof Command>;
/** Command as a caller writes it (times may be ISO). */
export type CommandInput = z.input<typeof Command>;

export type CommandErrorCode =
  | "invalid_command"
  | "unknown_window"
  | "unknown_assignment"
  | "unknown_signal"
  | "signal_limit"
  | "invalid_range";

export type CommandResult =
  | { ok: true; revision: number; created?: string }
  | { ok: false; code: CommandErrorCode; message: string };

/** Messages on `WS /api/live`. */
export type LiveServerMessage =
  | { type: "hello"; clientId: string }
  | { type: "state"; revision: number; workspace: Workspace };

export interface RenderError {
  windowId?: string;
  signalId?: string;
  message: string;
}

export const RenderedMessage = z.object({
  type: z.literal("rendered"),
  revision: z.number().int().min(0),
  status: z.enum(["complete", "error"]),
  errors: z
    .array(
      z.object({
        windowId: z.string().optional(),
        signalId: z.string().optional(),
        message: z.string(),
      }),
    )
    .optional(),
});
export type RenderedMessage = z.infer<typeof RenderedMessage>;

export interface ClientRenderStatus {
  clientId: string;
  connectedAt: string;
  rendered?: { revision: number; status: "complete" | "error"; errors: RenderError[]; at: string };
}

export interface RenderStatus {
  /** Current workspace revision. */
  revision: number;
  clients: ClientRenderStatus[];
}
