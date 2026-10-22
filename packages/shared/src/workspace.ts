import { z } from "zod";
import type { CaseEntry, WorkspaceCase } from "./case.ts";
import { MAX_FILTER_LENGTH } from "./eventFilter.ts";
import { fromIso, parseTimestamp, TIME_MAX, TIME_MIN, toIso } from "./time.ts";
import { MIN_SPAN_NS } from "./timenav.ts";
import type { WorkspaceSummary } from "./workspaces.ts";

/** Maximum number of distinct signals across all windows (spec workspace-state). */
export const MAX_SIGNALS = 50;

/** At most four units per window (D-019). */
export const MAX_UNITS = 4;

/** Windows of both kinds together per workspace (design H4). */
export const MAX_WINDOWS = 64;
/** Errors per render acknowledgement (design H4). */
export const MAX_RENDER_ERRORS = 50;
/** Characters per render error message (design H4). */
export const MAX_RENDER_ERROR_LENGTH = 500;

export const DEFAULT_PLOT_HEIGHT = 280;
export const MIN_PLOT_HEIGHT = 120;
export const MAX_PLOT_HEIGHT = 1200;

/** Signal palette (D-055): Okabe-Ito, then four colours ≥ 3:1 on white; Workspace.colors holds indices. */
export const SIGNAL_COLORS = [
  "#0072B2",
  "#E69F00",
  "#009E73",
  "#D55E00",
  "#CC79A7",
  "#56B4E9",
  "#332288",
  "#882255",
  "#999933",
  "#8C564B",
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

export const CursorName = z.enum(["a", "b"]);
export type CursorName = z.infer<typeof CursorName>;

/** Cursor A/B (decimal-ns strings; absent = off) and diff mode. */
export interface CursorState {
  a?: string;
  b?: string;
  diff: boolean;
}

/** "Between points" mode of a values window: line → linear, step → hold (concept §6). */
export const ValuesMode = z.enum(["line", "step"]);
export type ValuesMode = z.infer<typeof ValuesMode>;

/** Window that lists the signals' values at the cursors; no range, display or height (D-023). */
export interface ValuesWindow {
  id: string;
  kind: "values";
  title?: string;
  /** Default "line". */
  mode: ValuesMode;
  signals: SignalAssignment[];
}

export type WorkspaceWindow = TimeseriesWindow | ValuesWindow;

/** Significant digits of human-readable values (D-026; 4 is the option). */
export const Digits = z.union([z.literal(3), z.literal(4)]);
export type Digits = z.infer<typeof Digits>;

/** User options (concept §8); for now only the digits. */
export interface WorkspaceOptions {
  digits: Digits;
}

/** Measurement info limits (design F6): characters of name and object, meta key and value. */
export const MAX_MEASUREMENT_TEXT = 120;
export const MAX_MEASUREMENT_KEY = 40;
export const MAX_MEASUREMENT_VALUE = 200;
/** Meta entries per measurement. */
export const MAX_MEASUREMENT_META = 8;
/** Starts with a letter; letters, digits, space, _ . - */
export const MEASUREMENT_KEY = /^\p{L}[\p{L}\p{N} _.-]*$/u;

export interface MeasurementEntry {
  key: string;
  value: string;
}

/** User-defined info about the measurement under investigation; empty fields are absent. */
export interface Measurement {
  name?: string;
  /** Vehicle or device under test. */
  object?: string;
  /** Unique keys in order; absent when empty. */
  meta?: MeasurementEntry[];
}

/** Signals on the events line at most (design E8, D-059). */
export const MAX_EVENT_SIGNALS = 8;

/**
 * View limits of design V1, defined here so the command schema needs no import cycle; views.ts
 * re-exports them.
 */
/** User view names: file-safe, no leading dash, no underscore. */
export const VIEW_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const MAX_VIEW_TITLE = 120;
export const MAX_VIEW_NOTE = 2_000;

/** The view the workspace came from or was saved as; absent for a fresh workspace. */
export interface OpenView {
  /** Saved view name; absent when opened from a link that was not saved here. */
  name?: string;
  title: string;
  note?: string;
  /** True after any accepted command other than view.open / view.markSaved. */
  modified: boolean;
}

/** The workspace's scope (D-078); decimal-ns strings like TimeRange; to − from ≥ MIN_SPAN_NS. */
export interface WorkspaceScope {
  dataRef: string;
  from: string;
  to: string;
  /** The vehicle's full extent after Unlink (add-case-open K11). */
  object?: true;
}

/**
 * Case schemas of add-case-open K2, defined here so the command schema needs no import cycle;
 * case.ts re-exports them.
 */
/** What "Align to this event" stores (K7). text only for state changes (category "change"). */
export const EventMatch = z.strictObject({
  kind: z.string().min(1).max(64),
  source: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  text: z.string().max(200).optional(),
});
export type EventMatch = z.infer<typeof EventMatch>;

export const CaseAlign = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("start") }),
  z.strictObject({ mode: z.literal("end") }),
  z.strictObject({ mode: z.literal("anchor") }),
  z.strictObject({ mode: z.literal("event"), event: EventMatch }),
]);
export type CaseAlign = z.infer<typeof CaseAlign>;

export const isTimeseries = (w: WorkspaceWindow): w is TimeseriesWindow => w.kind === "timeseries";

export interface Workspace {
  windows: WorkspaceWindow[];
  /** Counter for stable IDs (`w1`, `a2`, …); part of the state so applying commands stays pure. */
  nextId: number;
  /** Linked time axes (D-017): while true, all timeseries windows have the same range. */
  linkTime: boolean;
  /**
   * Timeseries window whose range was set last by window.create (with a range) or
   * window.setRange.
   */
  lastZoomed?: string;
  /** Palette index per signal ID that is in at least one window. */
  colors: Record<string, number>;
  /** Cursors A/B and diff mode (D-023). */
  cursors: CursorState;
  options: WorkspaceOptions;
  /** Measurement info (design F6); absent when empty. */
  measurement?: Measurement;
  /** Event filter in normal form (D-058); absent = DEFAULT_EVENT_FILTER. */
  eventFilter?: string;
  /** Events-line signal IDs in order, at most MAX_EVENT_SIGNALS (D-059); absent when empty. */
  eventSignals?: string[];
  /** Open view (saved-views, design V2); absent for a fresh workspace. */
  view?: OpenView;
  /** One data ref and one time window that bound every source query (D-078); absent = none. */
  scope?: WorkspaceScope;
  /** The open catalog (add-case-open K2, K6); the entries stay in GET /api/case. */
  case?: WorkspaceCase;
}

export const EMPTY_WORKSPACE: Workspace = {
  windows: [],
  nextId: 1,
  linkTime: true,
  colors: {},
  cursors: { diff: false },
  options: { digits: 3 },
};

/**
 * Display title: the title, else from the stable ID "Window <n>" (timeseries) or "Values <n>"
 * (values), e.g. w6 → "Window 6".
 */
export function windowTitle(w: WorkspaceWindow): string {
  return w.title ?? `${w.kind === "values" ? "Values" : "Window"} ${w.id.replace(/^w/, "")}`;
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
  w: WorkspaceWindow,
  unitOf: (signalId: string) => string | undefined,
  extra?: string,
): string[] {
  const ids = w.signals.map((s) => s.signalId);
  if (extra !== undefined) ids.push(extra);
  return [...new Set(ids.map((id) => unitKey(id, unitOf(id))))];
}

const Id = z.string().min(1).max(200);

/** A data ref: non-empty, no "/" (the separator of signal IDs). */
export const DataRef = Id.refine((s) => !s.includes("/"), { message: "a data ref holds no /" });

/** to − from ≥ MIN_SPAN_NS for decimal-ns strings (scope.set, view.open scope). */
const scopeSpanOk = (s: { from: string; to: string }) =>
  BigInt(s.to) - BigInt(s.from) >= MIN_SPAN_NS;
const SCOPE_SPAN_MESSAGE = `to must be at least ${MIN_SPAN_NS} ns after from`;

/** Scope of scope.set and view.open (design Z5). */
const ScopeInput = z
  .object({ dataRef: DataRef, from: TimeInput, to: TimeInput })
  .refine(scopeSpanOk, { message: SCOPE_SPAN_MESSAGE });

/** Trimmed text of at most `max` characters without control characters; "" clears. */
const MeasurementText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((s) => !/\p{Cc}/u.test(s), { message: "no line breaks or control characters" });

export const Command = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("window.create"),
      /** Default "timeseries". */
      kind: z.enum(["timeseries", "values"]).optional(),
      title: z.string().max(200).optional(),
      from: TimeInput.optional(),
      to: TimeInput.optional(),
      mode: DisplayMode.optional(),
      envelope: z.boolean().optional(),
    })
    .refine((c) => (c.from === undefined) === (c.to === undefined), {
      message: "from and to must be given together",
    })
    .refine(
      (c) =>
        c.kind !== "values" ||
        (c.from === undefined &&
          c.to === undefined &&
          c.envelope === undefined &&
          c.mode !== "markers"),
      { message: "a values window takes no from, to or envelope, and mode line or step only" },
    ),
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
  z.object({ type: z.literal("cursor.set"), cursor: CursorName, t: TimeInput }),
  /** Moves a cursor by signed nanoseconds. */
  z.object({
    type: z.literal("cursor.move"),
    cursor: CursorName,
    by: z.string().regex(/^-?\d{1,20}$/),
  }),
  z.object({ type: z.literal("cursor.remove"), cursor: CursorName }),
  z.object({ type: z.literal("cursor.setDiff"), diff: z.boolean() }),
  z.object({ type: z.literal("workspace.setOptions"), digits: Digits.optional() }),
  z
    .object({
      type: z.literal("measurement.set"),
      name: MeasurementText(MAX_MEASUREMENT_TEXT).optional(),
      object: MeasurementText(MAX_MEASUREMENT_TEXT).optional(),
    })
    .refine((c) => c.name !== undefined || c.object !== undefined, {
      message: "name or object is required",
    }),
  z.object({
    type: z.literal("measurement.setMeta"),
    key: z.string().trim().max(MAX_MEASUREMENT_KEY).regex(MEASUREMENT_KEY, {
      message: "key must start with a letter and hold only letters, digits, space, _ . -",
    }),
    value: MeasurementText(MAX_MEASUREMENT_VALUE),
  }),
  z.object({ type: z.literal("measurement.clear") }),
  z.object({ type: z.literal("events.setFilter"), filter: z.string().max(MAX_FILTER_LENGTH) }),
  z.object({ type: z.literal("events.addSignal"), signalId: Id }),
  z.object({ type: z.literal("events.removeSignal"), signalId: Id }),
  /**
   * Replaces the workspace with a view document (design V2); `name` when it is a saved view;
   * `scope` resolved by the server or given by the caller (design Z5, Z10).
   */
  z.object({
    type: z.literal("view.open"),
    view: z.record(z.string(), z.unknown()),
    name: z.string().regex(VIEW_NAME).optional(),
    scope: ScopeInput.optional(),
  }),
  /** Marks the open view as saved under `name`; changes nothing but `view`. */
  z.object({
    type: z.literal("view.markSaved"),
    name: z.string().regex(VIEW_NAME),
    title: z.string().trim().min(1).max(MAX_VIEW_TITLE),
    note: z.string().max(MAX_VIEW_NOTE).optional(),
  }),
  /** Sets the scope (design Z6): windows clamped into it, cursors outside it removed. */
  z
    .object({ type: z.literal("scope.set"), dataRef: DataRef, from: TimeInput, to: TimeInput })
    .refine(scopeSpanOk, { message: SCOPE_SPAN_MESSAGE }),
  z.object({ type: z.literal("scope.clear") }),
  /** Goes to a catalog entry (0-based) and links (add-case-open K6). */
  z.object({ type: z.literal("case.go"), index: z.number().int().min(0) }),
  z.object({ type: z.literal("case.step"), by: z.union([z.literal(-1), z.literal(1)]) }),
  z.object({ type: z.literal("case.unlink") }),
  /** `at`: the chosen event's time (UI); absent: the server resolves the point (K9). */
  z.object({ type: z.literal("case.align"), align: CaseAlign, at: TimeInput.optional() }),
]);
export type Command = z.infer<typeof Command>;
/** Command as a caller writes it (times may be ISO). */
export type CommandInput = z.input<typeof Command>;
export type CommandType = Command["type"];

export type CommandErrorCode =
  | "invalid_command"
  | "unknown_window"
  | "unknown_assignment"
  | "unknown_signal"
  | "signal_limit"
  | "invalid_range"
  | "already_in_window"
  | "too_many_units"
  | "cursor_off"
  | "window_limit"
  | "measurement_limit"
  | "invalid_filter"
  | "not_state_signal"
  | "already_listed"
  | "event_signal_limit"
  | "not_listed"
  | "invalid_view"
  | "unsupported_version"
  | "catalog_unavailable"
  /** A data ref the requester may not see (add-multiuser M6, M7). */
  | "forbidden_data"
  /** Scoped mode: the command needs a scope and the workspace has none (design Z6). */
  | "scope_required"
  /** A cursor time outside the scope (design Z6). */
  | "out_of_scope"
  /** A case command in a workspace without a catalog (add-case-open K6). */
  | "no_case"
  /** case.step past the first or last session, case.go with index ≥ count. */
  | "case_end"
  /** case.step, case.align or case.unlink while unlinked. */
  | "case_unlinked"
  /** scope.set or scope.clear while a catalog is open (Q-6 (a)). */
  | "case_open"
  /** case.align event without `at` and no match in the current session. */
  | "no_matching_event"
  /** Client only: the request did not reach the server (never sent by the server). */
  | "network"
  /** Client only: the answer was not a command result (never sent by the server). */
  | "bad_response";

export type CommandResult =
  | {
      ok: true;
      revision: number;
      created?: string;
      createdWindow?: string;
      removedWindow?: string;
      /** view.open only. */
      report?: OpenReport;
      /** The command moved a range into the scope (design Z6). */
      clamped?: true;
      /** case.go/step: signals the target session's list lacks (after rebinding), unique, sorted. */
      missing?: string[];
      /** case.go/step/align: the mode could not be resolved; aligned to the session start. */
      alignFallback?: true;
    }
  | { ok: false; code: CommandErrorCode; message: string };

/** What view.open left out (design V2). */
export interface OpenReport {
  /** Window signals the catalog does not know, unique, sorted. */
  missing: string[];
  /** Known signals left out; window = index in the document's windows. */
  skipped: {
    signalId: string;
    window: number;
    /** out_of_scope: a signal of another data ref than the scope's (design Q-2 (a)). */
    reason: "too_many_units" | "signal_limit" | "already_in_window" | "out_of_scope";
  }[];
  warnings: string[];
}

/** Messages on `WS /api/live`. */
export type LiveServerMessage =
  | { type: "hello"; clientId: string }
  /** The workspace this connection serves, with this connection's user's rights (add-multiuser M8). */
  | { type: "summary"; summary: WorkspaceSummary }
  | {
      type: "state";
      revision: number;
      workspace: Workspace;
      /** Type of the command that made this revision; absent on the state sent on connect. */
      command?: CommandType;
    }
  /** The connection's user's favourites, after the connect `state` and per change (add-favourites F4). */
  | { type: "favourites"; names: string[]; error?: string };

export const RenderError = z.object({
  windowId: z.string().max(200).optional(),
  signalId: z.string().max(200).optional(),
  message: z.string().max(MAX_RENDER_ERROR_LENGTH),
});
export type RenderError = z.infer<typeof RenderError>;

export const RenderedMessage = z.object({
  type: z.literal("rendered"),
  revision: z.number().int().min(0),
  status: z.enum(["complete", "error"]),
  errors: z.array(RenderError).max(MAX_RENDER_ERRORS).optional(),
});
export type RenderedMessage = z.infer<typeof RenderedMessage>;

export interface ClientRenderStatus {
  clientId: string;
  /** The user of the connection (add-multiuser M4). */
  user?: string;
  connectedAt: string;
  rendered?: { revision: number; status: "complete" | "error"; errors: RenderError[]; at: string };
}

export interface RenderStatus {
  /** Current workspace revision. */
  revision: number;
  clients: ClientRenderStatus[];
}

const NsTime = z.string().regex(/^-?\d{1,20}$/);
const ExactText = (max: number) => z.string().max(max).exactOptional();

const SignalAssignmentSchema = z.strictObject({ id: Id, signalId: Id });
const NsRange = z.strictObject({ from: NsTime, to: NsTime });

const CaseEntrySchema: z.ZodType<CaseEntry> = z.strictObject({
  id: z.string().min(1).max(256),
  object: z.string().min(1).max(128),
  dataRef: Id,
  kind: z.string().max(32).exactOptional(),
  from: NsTime,
  to: NsTime,
  title: z.string().max(120).exactOptional(),
  meta: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .exactOptional(),
  anchor: NsTime.exactOptional(),
});

const WorkspaceCaseSchema: z.ZodType<WorkspaceCase> = z.strictObject({
  catalogId: z.string().regex(/^[a-z0-9]{10}$/),
  count: z.number().int().min(1),
  current: z.number().int().min(0),
  linked: z.boolean(),
  pad: NsTime,
  align: CaseAlign,
  alignAt: NsTime,
  linkedRanges: z.record(Id, NsRange).exactOptional(),
  entry: CaseEntrySchema,
});

/** zod schema of a whole Workspace (state file, design V4); unknown keys rejected. */
export const WorkspaceSchema: z.ZodType<Workspace> = z.strictObject({
  windows: z
    .array(
      z.discriminatedUnion("kind", [
        z.strictObject({
          id: Id,
          kind: z.literal("timeseries"),
          title: ExactText(200),
          range: z.strictObject({ from: NsTime, to: NsTime }),
          display: z.strictObject({ mode: DisplayMode, envelope: z.boolean() }),
          signals: z.array(SignalAssignmentSchema),
          height: z.number().int().min(MIN_PLOT_HEIGHT).max(MAX_PLOT_HEIGHT).exactOptional(),
        }),
        z.strictObject({
          id: Id,
          kind: z.literal("values"),
          title: ExactText(200),
          mode: ValuesMode,
          signals: z.array(SignalAssignmentSchema),
        }),
      ]),
    )
    .max(MAX_WINDOWS),
  nextId: z.number().int().min(1),
  linkTime: z.boolean(),
  lastZoomed: Id.exactOptional(),
  colors: z.record(
    Id,
    z
      .number()
      .int()
      .min(0)
      .max(SIGNAL_COLORS.length - 1),
  ),
  cursors: z.strictObject({
    a: NsTime.exactOptional(),
    b: NsTime.exactOptional(),
    diff: z.boolean(),
  }),
  options: z.strictObject({ digits: Digits }),
  measurement: z
    .strictObject({
      name: ExactText(MAX_MEASUREMENT_TEXT),
      object: ExactText(MAX_MEASUREMENT_TEXT),
      meta: z
        .array(
          z.strictObject({
            key: z.string().max(MAX_MEASUREMENT_KEY),
            value: z.string().max(MAX_MEASUREMENT_VALUE),
          }),
        )
        .max(MAX_MEASUREMENT_META)
        .exactOptional(),
    })
    .exactOptional(),
  eventFilter: z.string().max(MAX_FILTER_LENGTH).exactOptional(),
  eventSignals: z.array(Id).max(MAX_EVENT_SIGNALS).exactOptional(),
  view: z
    .strictObject({
      name: z.string().max(64).exactOptional(),
      title: z.string().max(MAX_VIEW_TITLE),
      note: ExactText(MAX_VIEW_NOTE),
      modified: z.boolean(),
    })
    .exactOptional(),
  scope: z
    .strictObject({
      dataRef: Id,
      from: NsTime,
      to: NsTime,
      object: z.literal(true).exactOptional(),
    })
    .exactOptional(),
  case: WorkspaceCaseSchema.exactOptional(),
});
