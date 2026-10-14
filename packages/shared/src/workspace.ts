import { z } from "zod";
import { fromIso, parseTimestamp, TIME_MAX, TIME_MIN, toIso } from "./time.ts";

/** Maximum number of distinct signals across all windows (spec workspace-state). */
export const MAX_SIGNALS = 50;

/** At most four units per window (D-019). */
export const MAX_UNITS = 4;

export const DEFAULT_PLOT_HEIGHT = 280;
export const MIN_PLOT_HEIGHT = 120;
export const MAX_PLOT_HEIGHT = 1200;

/** Signal palette; Workspace.colors holds indices into it. */
export const SIGNAL_COLORS = [
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#9333ea",
  "#ea580c",
  "#0891b2",
  "#be185d",
  "#4d7c0f",
  "#ca8a04",
  "#475569",
] as const;

/**
 * Time input: decimal nanoseconds since the epoch or ISO-8601, within [TIME_MIN, TIME_MAX];
 * output: decimal-ns string.
 */
export const TimeInput = z.string().transform((value, ctx) => {
  let t: bigint;
  try {
    t = /^-?\d+$/.test(value) ? parseTimestamp(value) : fromIso(value);
  } catch (error) {
    ctx.addIssue({ code: "custom", message: (error as Error).message });
    return z.NEVER;
  }
  if (t < TIME_MIN || t > TIME_MAX) {
    ctx.addIssue({
      code: "custom",
      message: `time outside ${toIso(TIME_MIN)} … ${toIso(TIME_MAX)}`,
    });
    return z.NEVER;
  }
  return t.toString();
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
  /** Plot height in CSS px; absent means DEFAULT_PLOT_HEIGHT. */
  height?: number;
}

export interface Workspace {
  windows: TimeseriesWindow[];
  /** Counter for stable IDs (`w1`, `a2`, …); part of the state so applying commands stays pure. */
  nextId: number;
  /** Linked time axes (D-017): while true, all windows have the same range. */
  linkTime: boolean;
  /** Window whose range was set last by window.create (with a range) or window.setRange. */
  lastZoomed?: string;
  /** Palette index per signal ID that is in at least one window. */
  colors: Record<string, number>;
}

export const EMPTY_WORKSPACE: Workspace = { windows: [], nextId: 1, linkTime: true, colors: {} };

/** Display title: the title, else "Window <n>" from the stable ID (w6 → "Window 6"). */
export function windowTitle(w: TimeseriesWindow): string {
  return w.title ?? `Window ${w.id.replace(/^w/, "")}`;
}

/** Colour of a signal: SIGNAL_COLORS[colors[signalId]], or SIGNAL_COLORS[0] if unknown. */
export function signalColor(workspace: Workspace, signalId: string): string {
  return SIGNAL_COLORS[workspace.colors[signalId] ?? 0] ?? SIGNAL_COLORS[0];
}

/** Unit key of a signal: its trimmed unit, or "s:<signalId>" when it has none (own scale). */
export function unitKey(signalId: string, unit: string | undefined): string {
  const trimmed = unit?.trim();
  return trimmed ? trimmed : `s:${signalId}`;
}

/** Distinct unit keys of a window's signals (plus an optional extra signal), in signal order. */
export function windowUnits(
  w: TimeseriesWindow,
  unitOf: (signalId: string) => string | undefined,
  extra?: string,
): string[] {
  const ids = w.signals.map((s) => s.signalId);
  if (extra !== undefined) ids.push(extra);
  return [...new Set(ids.map((id) => unitKey(id, unitOf(id))))];
}

const Id = z.string().min(1).max(200);

export const Command = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("window.create"),
      title: z.string().max(200).optional(),
      from: TimeInput.optional(),
      to: TimeInput.optional(),
      mode: DisplayMode.optional(),
      envelope: z.boolean().optional(),
    })
    .refine((c) => (c.from === undefined) === (c.to === undefined), {
      message: "from and to must be given together",
    }),
  z.object({ type: z.literal("window.rename"), windowId: Id, title: z.string().max(200) }),
  z.object({
    type: z.literal("window.setHeight"),
    windowId: Id,
    height: z.number().int().min(MIN_PLOT_HEIGHT).max(MAX_PLOT_HEIGHT),
  }),
  z.object({
    type: z.literal("window.moveSignal"),
    windowId: Id,
    assignmentId: Id,
    targetWindowId: Id.optional(),
    copy: z.boolean().optional(),
  }),
  z.object({ type: z.literal("workspace.setLinkTime"), linked: z.boolean() }),
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
  | "invalid_range"
  | "already_in_window"
  | "too_many_units";

export type CommandResult =
  | { ok: true; revision: number; created?: string; createdWindow?: string }
  | { ok: false; code: CommandErrorCode; message: string };

/** Messages on `WS /api/live`. */
export type LiveServerMessage =
  | { type: "hello"; clientId: string }
  | { type: "state"; revision: number; workspace: Workspace };

export const RenderError = z.object({
  windowId: z.string().optional(),
  signalId: z.string().optional(),
  message: z.string(),
});
export type RenderError = z.infer<typeof RenderError>;

export const RenderedMessage = z.object({
  type: z.literal("rendered"),
  revision: z.number().int().min(0),
  status: z.enum(["complete", "error"]),
  errors: z.array(RenderError).optional(),
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
