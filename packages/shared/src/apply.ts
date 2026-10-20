import { type CaseEntry, caseScope } from "./case.ts";
import { applyCaseCommand } from "./caseApply.ts";
import { DEFAULT_EVENT_FILTER, formatEventFilter, parseEventFilter } from "./eventFilter.ts";
import { clampToScope } from "./scope.ts";
import { parseSignalId } from "./signals.ts";
import { fromIso, TIME_MAX, TIME_MIN, toIso } from "./time.ts";
import { MIN_SPAN_NS } from "./timenav.ts";
import { parseViewDoc, rebindView } from "./views.ts";
import {
  type Command,
  type CommandErrorCode,
  DEFAULT_DISPLAY,
  EMPTY_WORKSPACE,
  isTimeseries,
  MAX_EVENT_SIGNALS,
  MAX_MEASUREMENT_META,
  MAX_SIGNALS,
  MAX_UNITS,
  MAX_WINDOWS,
  type Measurement,
  type OpenReport,
  SIGNAL_COLORS,
  type TimeRange,
  type TimeseriesWindow,
  unitKey,
  type ValuesWindow,
  type Workspace,
  type WorkspaceScope,
  type WorkspaceWindow,
  windowUnits,
} from "./workspace.ts";

export interface ApplyContext {
  /** Whether a signal ID exists in the catalog. */
  signalExists(signalId: string): boolean;
  /** Unit of a signal; when absent, the unit limit per window is not checked. */
  unitOf?(signalId: string): string | undefined;
  /** Whether a signal has states (catalog: SignalInfo.states present), design E8. */
  hasStates(signalId: string): boolean;
  /** Whether the catalog has loaded; view.open needs it (absent = ready). */
  catalogReady?(): boolean;
  /** Scoped mode (KIPSCOPE_CATALOG=scoped): scope.clear and catalog-checked commands need a scope. */
  scopeRequired?: boolean;
  /** The open catalog's entries and what the server resolved for a case command (add-case-open K6, K9). */
  case?: {
    entry(index: number): CaseEntry | undefined;
    /** case.go/step/align: the target's alignment point, resolved by the server (K9). */
    alignAt?: string;
    alignFallback?: boolean;
    /** case.unlink: the vehicle's extent [from, to), resolved by the server (K9). */
    extent?: { from: string; to: string };
  };
}

export type ApplyResult =
  | {
      ok: true;
      workspace: Workspace;
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

const fail = (code: CommandErrorCode, message: string): ApplyResult => ({
  ok: false,
  code,
  message,
});

function checkRange(from: string, to: string): ApplyResult | undefined {
  return BigInt(to) > BigInt(from) ? undefined : fail("invalid_range", "to must be after from");
}

/** Distinct signal IDs across all windows. */
export function distinctSignals(workspace: Workspace): Set<string> {
  return new Set(workspace.windows.flatMap((w) => w.signals.map((s) => s.signalId)));
}

/** Palette index used by the fewest signals in `colors`; lowest index on ties. */
function leastUsedColor(colors: Record<string, number>): number {
  const counts = SIGNAL_COLORS.map(() => 0);
  for (const index of Object.values(colors)) counts[index] = (counts[index] ?? 0) + 1;
  return counts.indexOf(Math.min(...counts));
}

/** Drops colour entries of signals that are in no window. */
function pruneColors(workspace: Workspace): Workspace {
  const signals = distinctSignals(workspace);
  const colors = Object.fromEntries(
    Object.entries(workspace.colors).filter(([signalId]) => signals.has(signalId)),
  );
  return { ...workspace, colors };
}

/** Range of `lastZoomed`, else of the first timeseries window. */
function referenceRange(state: Workspace): TimeRange | undefined {
  const timeseries = state.windows.filter(isTimeseries);
  return (timeseries.find((w) => w.id === state.lastZoomed) ?? timeseries[0])?.range;
}

/** Gives every timeseries window `range`; values windows have none. */
function linkRange(windows: WorkspaceWindow[], range: TimeRange): WorkspaceWindow[] {
  return windows.map((w) => (isTimeseries(w) ? { ...w, range } : w));
}

/**
 * `too_many_units` if adding `signalId` to timeseries window `w` would exceed MAX_UNITS;
 * unchecked without `unitOf` and for values windows.
 */
function checkUnits(
  w: WorkspaceWindow,
  signalId: string,
  ctx: ApplyContext,
): ApplyResult | undefined {
  const unitOf = ctx.unitOf?.bind(ctx);
  if (!unitOf || !isTimeseries(w) || windowUnits(w, unitOf, signalId).length <= MAX_UNITS)
    return undefined;
  const names = new Map<string, string>();
  for (const s of w.signals) {
    const unit = unitOf(s.signalId)?.trim();
    const key = unitKey(s.signalId, unit);
    if (!names.has(key)) names.set(key, unit || `${s.signalId} (no unit)`);
  }
  return fail(
    "too_many_units",
    `a window shows at most ${MAX_UNITS} units (has: ${[...names.values()].join(", ")})`,
  );
}

const caseOpen = (): ApplyResult =>
  fail("case_open", "a catalog is open: Unlink and Link set the scope");

const scopeRequired = (): ApplyResult =>
  fail("scope_required", "set a scope first: no signal list is loaded without one");

/** Whether `t` (decimal ns) lies in the scope's [from, to); true without a scope. */
function inScope(t: string | bigint, scope: WorkspaceScope | undefined): boolean {
  if (!scope) return true;
  const n = BigInt(t);
  return n >= BigInt(scope.from) && n < BigInt(scope.to);
}

/** A range moved into the scope (design Z6); unchanged without one. */
function clampRange(range: TimeRange, scope: WorkspaceScope | undefined) {
  return scope ? clampToScope(range, scope) : { range, clamped: false };
}

/** Every timeseries window clamped into the scope; `clamped` when one range changed. */
function clampWindows(windows: WorkspaceWindow[], scope: WorkspaceScope) {
  let clamped = false;
  const next = windows.map((w) => {
    if (!isTimeseries(w)) return w;
    const c = clampToScope(w.range, scope);
    clamped ||= c.clamped;
    return c.clamped ? { ...w, range: c.range } : w;
  });
  return { windows: next, clamped };
}

/** Sets `measurement` normalised: empty fields, an empty meta and an empty measurement absent. */
function withMeasurement(state: Workspace, measurement: Measurement): Workspace {
  const next: Measurement = {};
  if (measurement.name) next.name = measurement.name;
  if (measurement.object) next.object = measurement.object;
  if (measurement.meta?.length) next.meta = measurement.meta;
  const { measurement: _removed, ...rest } = state;
  return Object.keys(next).length > 0 ? { ...rest, measurement: next } : rest;
}

/** Sets `eventSignals`; absent when empty. */
function withEventSignals(state: Workspace, eventSignals: string[]): Workspace {
  const { eventSignals: _removed, ...rest } = state;
  return eventSignals.length > 0 ? { ...rest, eventSignals } : rest;
}

/**
 * view.open (design V2): the document replaces the workspace; IDs continue from `state.nextId`,
 * window signals follow the rules of window.addSignal, and what is left out goes into the report.
 */
function openView(
  state: Workspace,
  command: Extract<Command, { type: "view.open" }>,
  ctx: ApplyContext,
): ApplyResult {
  const notReady = ctx.catalogReady?.() === false;
  const catalogUnavailable = () =>
    fail("catalog_unavailable", "the signal catalog has not loaded yet");
  // In scoped mode a missing scope is the answer, not the missing full catalog.
  if (notReady && !ctx.scopeRequired) return catalogUnavailable();
  const parsed = parseViewDoc(command.view);
  if (!parsed.ok) return fail(parsed.code, parsed.message);
  const ns = (iso: string) => fromIso(iso).toString();
  // In a case workspace the view is a layout for the catalog (add-case-open K6, K8): rebound to
  // the current session's data ref, its windows at the whole session, the case and scope kept.
  const held = state.case;
  const rebound = held ? rebindView(parsed.doc, held.entry.dataRef) : undefined;
  const doc = rebound?.doc ?? parsed.doc;
  const session = held && caseScope(held.entry, BigInt(held.pad));
  // The command's scope (resolved by the server, design Z10), else the document's.
  const scope: WorkspaceScope | undefined = held
    ? (state.scope ?? session)
    : (command.scope ??
      (doc.scope && {
        dataRef: doc.scope.dataRef,
        from: ns(doc.scope.from),
        to: ns(doc.scope.to),
      }));
  if (!scope && ctx.scopeRequired) return scopeRequired();
  if (notReady) return catalogUnavailable();
  const report: OpenReport = {
    missing: [],
    skipped: [],
    warnings: [...parsed.warnings, ...(rebound?.warnings ?? [])],
  };
  let nextId = state.nextId;
  const otherRef = (signalId: string) =>
    scope !== undefined && parseSignalId(signalId)?.dataRef !== scope.dataRef;

  // IDs in document order: all windows first, then the assignments.
  let windows: WorkspaceWindow[] = doc.windows.map((d) => {
    const id = `w${nextId++}`;
    const title = d.title ? { title: d.title } : {};
    if (d.kind === "values") return { id, kind: "values", ...title, mode: d.mode, signals: [] };
    return {
      id,
      kind: "timeseries",
      ...title,
      range: session ? { from: session.from, to: session.to } : { from: ns(d.from), to: ns(d.to) },
      display: { mode: d.mode, envelope: d.envelope },
      signals: [],
      ...(d.height !== undefined && { height: d.height }),
    };
  });

  const missing = new Set<string>();
  const kept = new Set<string>();
  windows = windows.map((window, index) => {
    let w = window;
    for (const signalId of doc.windows[index]?.signals ?? []) {
      const skip = (reason: OpenReport["skipped"][number]["reason"]) =>
        report.skipped.push({ signalId, window: index, reason });
      if (otherRef(signalId)) skip("out_of_scope");
      else if (!ctx.signalExists(signalId)) missing.add(signalId);
      else if (w.signals.some((s) => s.signalId === signalId)) skip("already_in_window");
      else if (!kept.has(signalId) && kept.size >= MAX_SIGNALS) skip("signal_limit");
      else if (checkUnits(w, signalId, ctx)) skip("too_many_units");
      else {
        w = { ...w, signals: [...w.signals, { id: `a${nextId++}`, signalId }] };
        kept.add(signalId);
      }
    }
    return w;
  });
  report.missing = [...missing].sort();

  const first = windows.find(isTimeseries)?.range;
  if (
    doc.linkTime &&
    first &&
    windows.some((w) => isTimeseries(w) && (w.range.from !== first.from || w.range.to !== first.to))
  ) {
    windows = linkRange(windows, first);
    report.warnings.push("time axes are linked: ranges aligned to the first window");
  }
  let cursors = doc.cursors;
  if (scope) {
    const c = clampWindows(windows, scope);
    windows = c.windows;
    if (c.clamped) report.warnings.push("ranges clamped to the scope");
    for (const name of ["a", "b"] as const) {
      const t = cursors[name];
      if (t === undefined || inScope(fromIso(t), scope)) continue;
      const { [name]: _dropped, ...rest } = cursors;
      cursors = rest;
      report.warnings.push(`cursor ${name.toUpperCase()} outside the scope dropped`);
    }
  }

  // The document's colours first, so the others take the least used of what remains.
  const colors: Record<string, number> = {};
  const fromDoc = (id: string) => doc.colors?.[id];
  for (const id of kept) {
    const index = fromDoc(id);
    if (
      index !== undefined &&
      Number.isInteger(index) &&
      index >= 0 &&
      index < SIGNAL_COLORS.length
    )
      colors[id] = index;
  }
  for (const id of kept) if (!(id in colors)) colors[id] = leastUsedColor(colors);

  let workspace: Workspace = {
    ...EMPTY_WORKSPACE,
    windows,
    nextId,
    linkTime: doc.linkTime,
    colors,
    cursors: {
      ...(cursors.a !== undefined && { a: ns(cursors.a) }),
      ...(cursors.b !== undefined && { b: ns(cursors.b) }),
      diff: cursors.diff,
    },
    options: { digits: doc.digits },
  };
  workspace = withMeasurement(workspace, doc.measurement ?? {});

  const filter = doc.events?.filter;
  if (filter !== undefined) {
    const parsedFilter = parseEventFilter(filter);
    if (!parsedFilter.ok) {
      report.warnings.push(`event filter "${filter}" ignored: ${parsedFilter.message}`);
    } else {
      const normal = formatEventFilter(parsedFilter.filter);
      if (normal !== DEFAULT_EVENT_FILTER) workspace.eventFilter = normal;
    }
  }
  let eventSignals = [...new Set(doc.events?.signals ?? [])];
  const outside = eventSignals.filter(otherRef);
  if (outside.length > 0) {
    report.warnings.push(
      `events-line signals of another data ref than the scope's left out: ${outside.join(", ")}`,
    );
    eventSignals = eventSignals.filter((id) => !otherRef(id));
  }
  if (eventSignals.length > MAX_EVENT_SIGNALS) {
    report.warnings.push(
      `the events line holds at most ${MAX_EVENT_SIGNALS} signals: ${eventSignals.length - MAX_EVENT_SIGNALS} left out`,
    );
  }
  workspace = withEventSignals(workspace, eventSignals.slice(0, MAX_EVENT_SIGNALS));

  workspace.view = {
    ...(command.name !== undefined && { name: command.name }),
    title: doc.title,
    ...(doc.note !== undefined && { note: doc.note }),
    modified: false,
  };
  if (scope) workspace.scope = scope;
  if (held) {
    // Unlinked: the new windows' offsets for Link, as case.unlink keeps them.
    const linkedRanges: Record<string, TimeRange> = {};
    for (const w of workspace.windows) {
      if (!isTimeseries(w)) continue;
      linkedRanges[w.id] = {
        from: (BigInt(w.range.from) - BigInt(held.alignAt)).toString(),
        to: (BigInt(w.range.to) - BigInt(held.alignAt)).toString(),
      };
    }
    const { linkedRanges: _old, ...kept } = held;
    workspace.case = held.linked ? kept : { ...kept, linkedRanges };
  }
  return { ok: true, workspace, report };
}

/**
 * Applies one validated command. Pure: returns a new workspace and never mutates the input, so a
 * rejected command leaves the state unchanged and undo can keep previous states. Any accepted
 * command other than view.open and view.markSaved marks an open view modified.
 */
export function applyCommand(state: Workspace, command: Command, ctx: ApplyContext): ApplyResult {
  const result = applyOne(state, command, ctx);
  const view = result.ok ? result.workspace.view : undefined;
  if (!result.ok || !view || command.type === "view.open" || command.type === "view.markSaved")
    return result;
  return { ...result, workspace: { ...result.workspace, view: { ...view, modified: true } } };
}

function applyOne(state: Workspace, command: Command, ctx: ApplyContext): ApplyResult {
  const updateWindow = (
    windowId: string,
    update: (w: WorkspaceWindow) => WorkspaceWindow | ApplyResult,
  ): ApplyResult => {
    const index = state.windows.findIndex((w) => w.id === windowId);
    const current = state.windows[index];
    if (!current) return fail("unknown_window", `unknown window: ${windowId}`);
    const next = update(current);
    if ("ok" in next) return next;
    const windows = state.windows.with(index, next);
    return { ok: true, workspace: { ...state, windows } };
  };

  const cursorOutside = (cursor: string): ApplyResult => {
    const scope = state.scope as WorkspaceScope;
    return fail(
      "out_of_scope",
      `cursor ${cursor.toUpperCase()} outside the scope ${toIso(BigInt(scope.from))} … ${toIso(BigInt(scope.to))}`,
    );
  };

  const notOnValues = (w: ValuesWindow): ApplyResult =>
    fail("invalid_command", `${command.type} does not apply to values window ${w.id}`);

  switch (command.type) {
    case "window.create": {
      if (state.windows.length >= MAX_WINDOWS)
        return fail("window_limit", `a workspace holds at most ${MAX_WINDOWS} windows`);
      const id = `w${state.nextId}`;
      const title = command.title?.trim();
      if (command.kind === "values") {
        const window: ValuesWindow = {
          id,
          kind: "values",
          mode: command.mode === "step" ? "step" : "line",
          signals: [],
        };
        if (title) window.title = title;
        const workspace = {
          ...state,
          windows: [...state.windows, window],
          nextId: state.nextId + 1,
        };
        return { ok: true, workspace, created: id };
      }
      let range: TimeRange;
      const hasRange = command.from !== undefined && command.to !== undefined;
      let clamped = false;
      if (command.from !== undefined && command.to !== undefined) {
        const invalid = checkRange(command.from, command.to);
        if (invalid) return invalid;
        ({ range, clamped } = clampRange({ from: command.from, to: command.to }, state.scope));
      } else {
        const shared = state.linkTime ? state.windows.find(isTimeseries)?.range : undefined;
        if (!shared) return fail("invalid_range", "from and to are required");
        range = shared;
      }
      const window: TimeseriesWindow = {
        id,
        kind: "timeseries",
        range,
        display: {
          mode: command.mode ?? DEFAULT_DISPLAY.mode,
          envelope: command.envelope ?? DEFAULT_DISPLAY.envelope,
        },
        signals: [],
      };
      if (title) window.title = title;
      const existing = hasRange && state.linkTime ? linkRange(state.windows, range) : state.windows;
      const workspace: Workspace = {
        ...state,
        windows: [...existing, window],
        nextId: state.nextId + 1,
      };
      if (hasRange) workspace.lastZoomed = id;
      return { ok: true, workspace, created: id, ...(clamped && { clamped: true }) };
    }

    case "window.remove": {
      if (!state.windows.some((w) => w.id === command.windowId)) {
        return fail("unknown_window", `unknown window: ${command.windowId}`);
      }
      const workspace = pruneColors({
        ...state,
        windows: state.windows.filter((w) => w.id !== command.windowId),
      });
      if (workspace.lastZoomed === command.windowId) delete workspace.lastZoomed;
      return { ok: true, workspace };
    }

    case "window.addSignal": {
      if (ctx.scopeRequired && !state.scope) return scopeRequired();
      if (!ctx.signalExists(command.signalId)) {
        return fail("unknown_signal", `unknown signal: ${command.signalId}`);
      }
      const signals = distinctSignals(state);
      if (!signals.has(command.signalId) && signals.size >= MAX_SIGNALS) {
        return fail("signal_limit", `at most ${MAX_SIGNALS} distinct signals per workspace`);
      }
      const id = `a${state.nextId}`;
      const result = updateWindow(command.windowId, (w) => {
        if (w.signals.some((s) => s.signalId === command.signalId)) {
          return fail(
            "already_in_window",
            `window ${w.id} already shows signal ${command.signalId}`,
          );
        }
        return (
          checkUnits(w, command.signalId, ctx) ?? {
            ...w,
            signals: [...w.signals, { id, signalId: command.signalId }],
          }
        );
      });
      if (!result.ok) return result;
      const colors =
        command.signalId in state.colors
          ? state.colors
          : { ...state.colors, [command.signalId]: leastUsedColor(state.colors) };
      return {
        ok: true,
        workspace: { ...result.workspace, nextId: state.nextId + 1, colors },
        created: id,
      };
    }

    case "window.removeSignal": {
      const result = updateWindow(command.windowId, (w) => {
        if (!w.signals.some((s) => s.id === command.assignmentId)) {
          return fail("unknown_assignment", `unknown signal assignment: ${command.assignmentId}`);
        }
        return { ...w, signals: w.signals.filter((s) => s.id !== command.assignmentId) };
      });
      return result.ok ? { ok: true, workspace: pruneColors(result.workspace) } : result;
    }

    case "window.moveSignal": {
      const source = state.windows.find((w) => w.id === command.windowId);
      if (!source) return fail("unknown_window", `unknown window: ${command.windowId}`);
      const assignment = source.signals.find((s) => s.id === command.assignmentId);
      if (!assignment) {
        return fail("unknown_assignment", `unknown signal assignment: ${command.assignmentId}`);
      }
      let nextId = state.nextId;
      let windows = state.windows;
      let targetId: string;
      let createdWindow: string | undefined;
      if (command.targetWindowId === undefined) {
        let window: TimeseriesWindow;
        if (isTimeseries(source)) {
          window = {
            id: `w${nextId}`,
            kind: "timeseries",
            range: source.range,
            display: { ...source.display },
            signals: [],
          };
          if (source.height !== undefined) window.height = source.height;
        } else {
          const range = referenceRange(state);
          if (!range) {
            return fail(
              "invalid_range",
              "no timeseries window to take the new window's range from",
            );
          }
          window = {
            id: `w${nextId}`,
            kind: "timeseries",
            range,
            display: { ...DEFAULT_DISPLAY },
            signals: [],
          };
        }
        targetId = window.id;
        createdWindow = targetId;
        nextId++;
        windows = [...windows, window];
      } else {
        const target = state.windows.find((w) => w.id === command.targetWindowId);
        if (!target) return fail("unknown_window", `unknown window: ${command.targetWindowId}`);
        if (target.signals.some((s) => s.signalId === assignment.signalId)) {
          return fail(
            "already_in_window",
            `window ${target.id} already shows signal ${assignment.signalId}`,
          );
        }
        const tooMany = checkUnits(target, assignment.signalId, ctx);
        if (tooMany) return tooMany;
        targetId = target.id;
      }
      const created = command.copy ? `a${nextId++}` : undefined;
      const placed = created ? { id: created, signalId: assignment.signalId } : assignment;
      windows = windows.map((w) => {
        if (w.id === targetId) return { ...w, signals: [...w.signals, placed] };
        if (w.id === source.id && !command.copy) {
          return { ...w, signals: w.signals.filter((s) => s.id !== assignment.id) };
        }
        return w;
      });
      let workspace: Workspace = { ...state, windows, nextId };
      // A move that empties its source removes it like window.remove (L7); a copy never does.
      const emptied =
        !command.copy && windows.find((w) => w.id === source.id)?.signals.length === 0;
      if (emptied) {
        workspace = pruneColors({
          ...workspace,
          windows: windows.filter((w) => w.id !== source.id),
        });
        if (workspace.lastZoomed === source.id) delete workspace.lastZoomed;
      }
      return {
        ok: true,
        workspace,
        ...(created && { created }),
        ...(createdWindow && { createdWindow }),
        ...(emptied && { removedWindow: source.id }),
      };
    }

    case "window.setRange": {
      const target = state.windows.find((w) => w.id === command.windowId);
      if (!target) return fail("unknown_window", `unknown window: ${command.windowId}`);
      if (!isTimeseries(target)) return notOnValues(target);
      const invalid = checkRange(command.from, command.to);
      if (invalid) return invalid;
      const { range, clamped } = clampRange({ from: command.from, to: command.to }, state.scope);
      const windows = state.linkTime
        ? linkRange(state.windows, range)
        : state.windows.with(state.windows.indexOf(target), { ...target, range });
      return {
        ok: true,
        workspace: { ...state, windows, lastZoomed: target.id },
        ...(clamped && { clamped: true }),
      };
    }

    case "workspace.setLinkTime": {
      if (!command.linked) return { ok: true, workspace: { ...state, linkTime: false } };
      const reference = referenceRange(state);
      const windows = reference ? linkRange(state.windows, reference) : state.windows;
      return { ok: true, workspace: { ...state, windows, linkTime: true } };
    }

    case "window.rename":
      return updateWindow(command.windowId, (w) => {
        const title = command.title.trim();
        if (title) return { ...w, title };
        const { title: _removed, ...rest } = w;
        return rest;
      });

    case "window.setHeight":
      return updateWindow(command.windowId, (w) =>
        isTimeseries(w) ? { ...w, height: command.height } : notOnValues(w),
      );

    case "window.setDisplay":
      return updateWindow(command.windowId, (w) => {
        if (!isTimeseries(w)) {
          if (command.envelope !== undefined || command.mode === "markers") {
            return fail("invalid_command", `values window ${w.id} takes mode line or step only`);
          }
          return command.mode ? { ...w, mode: command.mode } : w;
        }
        return {
          ...w,
          display: {
            mode: command.mode ?? w.display.mode,
            envelope: command.envelope ?? w.display.envelope,
          },
        };
      });

    case "cursor.set":
      if (!inScope(command.t, state.scope)) return cursorOutside(command.cursor);
      return {
        ok: true,
        workspace: { ...state, cursors: { ...state.cursors, [command.cursor]: command.t } },
      };

    case "cursor.move": {
      const current = state.cursors[command.cursor];
      if (current === undefined) {
        return fail("cursor_off", `cursor ${command.cursor.toUpperCase()} is off`);
      }
      const t = BigInt(current) + BigInt(command.by);
      if (t < TIME_MIN || t > TIME_MAX) {
        return fail("invalid_command", `time outside ${toIso(TIME_MIN)} … ${toIso(TIME_MAX)}`);
      }
      if (!inScope(t, state.scope)) return cursorOutside(command.cursor);
      return {
        ok: true,
        workspace: { ...state, cursors: { ...state.cursors, [command.cursor]: t.toString() } },
      };
    }

    case "cursor.remove": {
      const { [command.cursor]: _removed, ...cursors } = state.cursors;
      return { ok: true, workspace: { ...state, cursors } };
    }

    case "cursor.setDiff":
      return {
        ok: true,
        workspace: { ...state, cursors: { ...state.cursors, diff: command.diff } },
      };

    case "workspace.setOptions": {
      const options = { ...state.options };
      if (command.digits !== undefined) options.digits = command.digits;
      return { ok: true, workspace: { ...state, options } };
    }

    case "measurement.set": {
      const measurement = { ...state.measurement };
      if (command.name !== undefined) measurement.name = command.name;
      if (command.object !== undefined) measurement.object = command.object;
      return { ok: true, workspace: withMeasurement(state, measurement) };
    }

    case "measurement.setMeta": {
      const meta = state.measurement?.meta ?? [];
      const index = meta.findIndex((e) => e.key === command.key);
      let next = meta;
      if (!command.value) next = meta.filter((e) => e.key !== command.key);
      else if (index >= 0) next = meta.with(index, { key: command.key, value: command.value });
      else if (meta.length >= MAX_MEASUREMENT_META) {
        return fail(
          "measurement_limit",
          `measurement info holds at most ${MAX_MEASUREMENT_META} meta entries`,
        );
      } else next = [...meta, { key: command.key, value: command.value }];
      return { ok: true, workspace: withMeasurement(state, { ...state.measurement, meta: next }) };
    }

    case "measurement.clear":
      return { ok: true, workspace: withMeasurement(state, {}) };

    case "events.setFilter": {
      const parsed = parseEventFilter(command.filter);
      if (!parsed.ok) return fail("invalid_filter", parsed.message);
      const filter = formatEventFilter(parsed.filter);
      const { eventFilter: _removed, ...rest } = state;
      // The default is stored as no field (design E8).
      const workspace = filter === DEFAULT_EVENT_FILTER ? rest : { ...rest, eventFilter: filter };
      return { ok: true, workspace };
    }

    case "events.addSignal": {
      if (ctx.scopeRequired && !state.scope) return scopeRequired();
      const id = command.signalId;
      const listed = state.eventSignals ?? [];
      if (!ctx.signalExists(id)) return fail("unknown_signal", `unknown signal: ${id}`);
      if (!ctx.hasStates(id)) return fail("not_state_signal", `signal ${id} has no states`);
      if (listed.includes(id))
        return fail("already_listed", `signal ${id} is already on the events line`);
      if (listed.length >= MAX_EVENT_SIGNALS) {
        return fail(
          "event_signal_limit",
          `the events line holds at most ${MAX_EVENT_SIGNALS} signals`,
        );
      }
      return { ok: true, workspace: withEventSignals(state, [...listed, id]) };
    }

    case "events.removeSignal": {
      const listed = state.eventSignals ?? [];
      if (!listed.includes(command.signalId))
        return fail("not_listed", `signal ${command.signalId} is not on the events line`);
      const rest = listed.filter((id) => id !== command.signalId);
      return { ok: true, workspace: withEventSignals(state, rest) };
    }

    case "view.open":
      return openView(state, command, ctx);

    case "scope.set": {
      if (state.case) return caseOpen();
      const { dataRef, from, to } = command;
      if (!dataRef || dataRef.includes("/"))
        return fail("invalid_command", "a data ref is non-empty and holds no /");
      if (BigInt(to) - BigInt(from) < MIN_SPAN_NS)
        return fail("invalid_command", `to must be at least ${MIN_SPAN_NS} ns after from`);
      const scope = { dataRef, from, to };
      const { windows, clamped } = clampWindows(state.windows, scope);
      const cursors = { ...state.cursors };
      for (const name of ["a", "b"] as const) {
        const t = cursors[name];
        if (t !== undefined && !inScope(t, scope)) delete cursors[name];
      }
      return {
        ok: true,
        workspace: { ...state, windows, cursors, scope },
        ...(clamped && { clamped: true }),
      };
    }

    case "scope.clear": {
      if (state.case) return caseOpen();
      if (ctx.scopeRequired) return scopeRequired();
      const { scope: _removed, ...rest } = state;
      return { ok: true, workspace: rest };
    }

    case "case.go":
    case "case.step":
    case "case.unlink":
    case "case.align":
      return applyCaseCommand(state, command, ctx);

    case "view.markSaved":
      return {
        ok: true,
        workspace: {
          ...state,
          view: {
            name: command.name,
            title: command.title,
            ...(command.note && { note: command.note }),
            modified: false,
          },
        },
      };
  }
}
