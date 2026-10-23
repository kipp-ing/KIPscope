import type { ApplyContext, ApplyResult } from "./apply.ts";
import {
  alignPoint,
  type CaseAlign,
  type CaseCatalog,
  type CaseEntry,
  caseScope,
  rebindSignalId,
  type WorkspaceCase,
} from "./case.ts";
import { computedInputIds, computedRef, withComputed } from "./computed.ts";
import { clampToScope } from "./scope.ts";
import { parseSignalId } from "./signals.ts";
import { toIso } from "./time.ts";
import {
  type Command,
  type CommandErrorCode,
  isTimeseries,
  type TimeRange,
  type Workspace,
  type WorkspaceScope,
} from "./workspace.ts";

type CaseCommand = Extract<
  Command,
  { type: "case.go" | "case.step" | "case.unlink" | "case.align" }
>;

const fail = (code: CommandErrorCode, message: string): ApplyResult => ({
  ok: false,
  code,
  message,
});

const noCase = () => fail("no_case", "this workspace has no open catalog");
const unlinked = (type: string) =>
  fail("case_unlinked", `${type} needs a linked session: Link first`);

const sub = (a: string, b: string) => (BigInt(a) - BigInt(b)).toString();
const add = (a: string, b: string) => (BigInt(a) + BigInt(b)).toString();

/** Whether `t` (decimal ns) lies in the scope's [from, to). */
const inScope = (t: string, scope: WorkspaceScope) =>
  BigInt(t) >= BigInt(scope.from) && BigInt(t) < BigInt(scope.to);

/**
 * The timeseries windows' ranges after a step to a session with point `targetAlignAt` and scope
 * `targetScope` (K6): linked, each range's offset from `case.alignAt`; unlinked, the window's
 * `linkedRanges` (a window without one gets the whole target scope); moved onto `targetAlignAt`
 * and clamped into `targetScope`. Used by case.go and the preload.
 */
export function caseRanges(
  workspace: Workspace,
  targetAlignAt: string,
  targetScope: WorkspaceScope,
): Record<string, { range: TimeRange; clamped: boolean }> {
  const c = workspace.case;
  const out: Record<string, { range: TimeRange; clamped: boolean }> = {};
  for (const w of workspace.windows) {
    if (!isTimeseries(w)) continue;
    const offset =
      c === undefined
        ? undefined
        : c.linked
          ? { from: sub(w.range.from, c.alignAt), to: sub(w.range.to, c.alignAt) }
          : c.linkedRanges?.[w.id];
    if (offset === undefined) {
      out[w.id] = { range: { from: targetScope.from, to: targetScope.to }, clamped: false };
      continue;
    }
    const moved = { from: add(offset.from, targetAlignAt), to: add(offset.to, targetAlignAt) };
    out[w.id] = clampToScope(moved, targetScope);
  }
  return out;
}

/**
 * Moves every window signal, colour key and events-line signal of `fromRef` to `toRef` by name
 * (K8); assignment IDs and colour indexes stay. Other data refs stay unless `dropOthers`, then
 * they are left out and named in `dropped`. A rebound signal already in its window is left out.
 */
function rebind(
  ws: Workspace,
  fromRef: string,
  toRef: string,
  dropOthers: boolean,
): { workspace: Workspace; dropped: string[] } {
  const dropped = new Set<string>();
  const move = (id: string): string | undefined => {
    const ref = parseSignalId(id)?.dataRef;
    if (ref === fromRef) return rebindSignalId(id, toRef);
    if (dropOthers && ref !== toRef) {
      dropped.add(id);
      return undefined;
    }
    return id;
  };
  const windows = ws.windows.map((w) => {
    const seen = new Set<string>();
    const signals = w.signals.flatMap((s) => {
      const signalId = move(s.signalId);
      if (signalId === undefined || seen.has(signalId)) return [];
      seen.add(signalId);
      return [{ id: s.id, signalId }];
    });
    return { ...w, signals };
  });
  const colors: Record<string, number> = {};
  for (const [id, index] of Object.entries(ws.colors)) {
    const next = move(id);
    if (next !== undefined && !(next in colors)) colors[next] = index;
  }
  const { eventSignals: _old, ...rest } = ws;
  const eventSignals = [...new Set((ws.eventSignals ?? []).flatMap((id) => move(id) ?? []))];
  const workspace: Workspace = { ...rest, windows, colors };
  if (eventSignals.length > 0) workspace.eventSignals = eventSignals;
  return { workspace, dropped: [...dropped].sort() };
}

/**
 * A layout workspace (the user's latest, or an opened view) moved onto `toRef` (K8, K9 step 3):
 * signals of `fromRef` rebound, signals of any other data ref left out with a warning.
 */
export function rebindLayout(
  layout: Workspace,
  fromRef: string,
  toRef: string,
): { workspace: Workspace; warnings: string[] } {
  const { workspace, dropped } = rebind(layout, fromRef, toRef, true);
  const warnings =
    dropped.length > 0
      ? [`signals of another data ref than ${fromRef} left out: ${dropped.join(", ")}`]
      : [];
  return { workspace, warnings };
}

/** Window signals the list lacks, unique, sorted. */
function missingSignals(ws: Workspace, known: (signalId: string) => boolean): string[] {
  const ids = new Set(ws.windows.flatMap((w) => w.signals.map((s) => s.signalId)));
  return [...ids].filter((id) => !known(id)).sort();
}

export interface OpenCaseInput {
  catalog: CaseCatalog;
  current: number;
  pad: bigint;
  align: CaseAlign;
  alignAt: string;
  alignFallback?: boolean;
  /** Already rebound (K8). */
  layout?: Workspace;
  /** Set when the layout workspace had a case. */
  layoutAlignAt?: string;
  known: (signalId: string) => boolean;
}

/**
 * The workspace of a catalog open (K9 step 4): the current session's scope; the layout's windows
 * at their offsets from `layoutAlignAt` moved onto `alignAt` (clamped), or at the whole scope when
 * the layout had no case; cursors moved alike and dropped outside the scope; linked.
 */
export function openCase(input: OpenCaseInput): { workspace: Workspace; missing: string[] } {
  const entry = input.catalog.entries[input.current] as CaseEntry;
  const scope = caseScope(entry, input.pad);
  const layout = input.layout;
  const {
    scope: _scope,
    case: _case,
    ...base
  } = layout ?? {
    windows: [],
    nextId: 1,
    linkTime: true,
    colors: {},
    cursors: { diff: false },
    options: { digits: 3 as const },
  };
  const shift = (t: string) =>
    input.layoutAlignAt === undefined ? t : add(sub(t, input.layoutAlignAt), input.alignAt);
  const windows = base.windows.map((w) => {
    if (!isTimeseries(w)) return w;
    const range =
      input.layoutAlignAt === undefined
        ? { from: scope.from, to: scope.to }
        : clampToScope({ from: shift(w.range.from), to: shift(w.range.to) }, scope).range;
    return { ...w, range };
  });
  const cursors = { ...base.cursors };
  for (const name of ["a", "b"] as const) {
    const t = cursors[name];
    if (t === undefined) continue;
    const moved = shift(t);
    if (input.layoutAlignAt !== undefined && inScope(moved, scope)) cursors[name] = moved;
    else delete cursors[name];
  }
  const workspaceCase: WorkspaceCase = {
    catalogId: input.catalog.catalogId,
    count: input.catalog.entries.length,
    current: input.current,
    linked: true,
    pad: input.pad.toString(),
    align: input.align,
    alignAt: input.alignAt,
    entry,
  };
  const workspace: Workspace = { ...base, windows, cursors, scope, case: workspaceCase };
  // A computed signal is known iff its definition is and its inputs are on its data ref (C7).
  const known = (id: string): boolean => {
    const ref = computedRef(id);
    if (!ref) return input.known(id);
    const def = workspace.computed?.find((d) => d.id === ref.id);
    return def !== undefined && computedInputIds(def, ref.dataRef).every(input.known);
  };
  return { workspace, missing: missingSignals(workspace, known) };
}

/** case.go to `index` (K6): offsets kept, signals rebound, cursors moved, linked. */
function goTo(state: Workspace, c: WorkspaceCase, index: number, ctx: ApplyContext): ApplyResult {
  if (index >= c.count)
    return fail("case_end", `no session ${index + 1}: the catalog has ${c.count}`);
  const target = ctx.case?.entry(index);
  if (target === undefined) return fail("case_end", `no session ${index + 1} in the catalog`);
  const pad = BigInt(c.pad);
  const scope = caseScope(target, pad);
  const point = alignPoint(target, c.align);
  const alignAt = ctx.case?.alignAt ?? point.t;
  const fallback =
    ctx.case?.alignAt !== undefined ? ctx.case.alignFallback === true : point.fallback;

  const fromRef = state.scope?.dataRef ?? c.entry.dataRef;
  const moved =
    fromRef === target.dataRef ? state : rebind(state, fromRef, target.dataRef, false).workspace;
  const ranges = caseRanges(state, alignAt, scope);
  const clamped = Object.values(ranges).some((r) => r.clamped);
  const windows = moved.windows.map((w) => {
    const r = ranges[w.id];
    return isTimeseries(w) && r !== undefined ? { ...w, range: r.range } : w;
  });
  const cursors = { ...moved.cursors };
  for (const name of ["a", "b"] as const) {
    const t = cursors[name];
    if (t === undefined) continue;
    const next = add(sub(t, c.alignAt), alignAt);
    if (inScope(next, scope)) cursors[name] = next;
    else delete cursors[name];
  }
  const { linkedRanges: _ranges, ...kept } = c;
  const workspace: Workspace = {
    ...moved,
    windows,
    cursors,
    scope,
    case: { ...kept, current: index, linked: true, alignAt, entry: target },
  };
  // Computed signals count as missing when an input is (C7).
  const checks = withComputed(ctx, workspace.computed);
  const missing = missingSignals(workspace, (id) =>
    parseSignalId(id)?.dataRef !== target.dataRef ? true : checks.signalExists(id),
  );
  return {
    ok: true,
    workspace,
    ...(clamped && { clamped: true }),
    ...(missing.length > 0 && { missing }),
    ...(fallback && { alignFallback: true }),
  };
}

/** case.go, case.step, case.unlink and case.align on a workspace (K6, K7). */
export function applyCaseCommand(
  state: Workspace,
  command: CaseCommand,
  ctx: ApplyContext,
): ApplyResult {
  const c = state.case;
  if (c === undefined) return noCase();
  switch (command.type) {
    case "case.go":
      return goTo(state, c, command.index, ctx);

    case "case.step": {
      if (!c.linked) return unlinked(command.type);
      const index = c.current + command.by;
      if (index < 0) return fail("case_end", "this is the first session of the catalog");
      if (index >= c.count) return fail("case_end", "this is the last session of the catalog");
      return goTo(state, c, index, ctx);
    }

    case "case.unlink": {
      if (!c.linked) return unlinked(command.type);
      const extent = ctx.case?.extent;
      const scope = state.scope ?? caseScope(c.entry, BigInt(c.pad));
      if (extent === undefined)
        return fail("invalid_command", "case.unlink needs the vehicle's extent from the server");
      const from = BigInt(extent.from) < BigInt(scope.from) ? extent.from : scope.from;
      const to = BigInt(extent.to) > BigInt(scope.to) ? extent.to : scope.to;
      const linkedRanges: Record<string, TimeRange> = {};
      for (const w of state.windows) {
        if (isTimeseries(w))
          linkedRanges[w.id] = {
            from: sub(w.range.from, c.alignAt),
            to: sub(w.range.to, c.alignAt),
          };
      }
      return {
        ok: true,
        workspace: {
          ...state,
          scope: { dataRef: scope.dataRef, from, to, object: true },
          case: { ...c, linked: false, linkedRanges },
        },
      };
    }

    case "case.align": {
      if (!c.linked) return unlinked(command.type);
      let alignAt: string;
      let fallback = false;
      if (command.at !== undefined) {
        const scope = state.scope;
        if (scope && !inScope(command.at, scope))
          return fail(
            "out_of_scope",
            `${toIso(BigInt(command.at))} lies outside the session ${toIso(BigInt(scope.from))} … ${toIso(BigInt(scope.to))}`,
          );
        alignAt = command.at;
      } else if (command.align.mode === "event") {
        if (ctx.case?.alignAt === undefined || ctx.case.alignFallback)
          return fail(
            "no_matching_event",
            `no ${command.align.event.name} in this session: choose an event in it`,
          );
        alignAt = ctx.case.alignAt;
      } else {
        const point = alignPoint(c.entry, command.align);
        alignAt = ctx.case?.alignAt ?? point.t;
        fallback =
          ctx.case?.alignAt !== undefined ? ctx.case.alignFallback === true : point.fallback;
      }
      return {
        ok: true,
        workspace: { ...state, case: { ...c, align: command.align, alignAt } },
        ...(fallback && { alignFallback: true }),
      };
    }
  }
}
