/**
 * Calls every source method that takes a scope (design Z1 of add-scope), once with a scope and once
 * without, for the query-text tests of the ClickHouse adapter (`clickhouse.scope.test.ts`) and the
 * ADX adapter (`adx.test.ts`). The unscoped form passes no trailing argument at all, so the same
 * calls run against the adapter as it was before the scope existed (`fixtures/clickhouse.unscoped.json`).
 */
import type { Scope, SeriesRef, SourceAdapter, StateChangeRule } from "../src/datasource.ts";
import { B } from "./conformance/fixture.ts";

const S = 1_000_000_000n;

/** The scope of design Z4's S2: {conf-a, B + 5 s, B + 35 s}. */
export const SCOPE_S2: Scope = { dataRef: "conf-a", from: B + 5n * S, to: B + 35n * S };

const ramp: SeriesRef = { dataRef: "conf-a", name: "Lin.RAMP", sna: [] };
const mode: SeriesRef = { dataRef: "conf-a", name: "State.MODE", sna: [{ lo: 14.5, hi: 15.5 }] };
const door: SeriesRef = { dataRef: "conf-a", name: "Diag.door", sna: [], text: true };
const labels: StateChangeRule = { kind: "labels", values: [0, 3], tolerance: 0.5 };

/** The calls, by label; each one passes `scope` (and nothing after it) only when it has one. */
export const SCOPED_CALLS: Record<string, (s: SourceAdapter, scope?: Scope) => Promise<unknown>> = {
  listSignals: (s, scope) => (scope ? s.listSignals(scope) : s.listSignals()),
  before: (s, scope) => (scope ? s.before(ramp, B + 40n * S, scope) : s.before(ramp, B + 40n * S)),
  after: (s, scope) => (scope ? s.after(ramp, B, scope) : s.after(ramp, B)),
  "refBuckets with times": (s, scope) =>
    scope ? s.refBuckets("conf-a", 60n * S, true, scope) : s.refBuckets("conf-a", 60n * S, true),
  "refBuckets counts": (s, scope) =>
    scope ? s.refBuckets("conf-a", 60n * S, false, scope) : s.refBuckets("conf-a", 60n * S, false),
  refCount: async (s, scope) => (scope ? s.refCount?.("conf-a", scope) : s.refCount?.("conf-a")),
  loggerGaps: async (s, scope) =>
    scope ? s.loggerGaps?.("conf-a", S, 2n * S, scope) : s.loggerGaps?.("conf-a", S, 2n * S),
  "stateChanges by labels": async (s, scope) =>
    scope ? s.stateChanges?.(mode, labels, 100, scope) : s.stateChanges?.(mode, labels, 100),
  "stateChanges by text": async (s, scope) =>
    scope
      ? s.stateChanges?.(door, { kind: "text" }, 100, scope)
      : s.stateChanges?.(door, { kind: "text" }, 100),
  events: async (s, scope) =>
    scope ? s.events?.("conf-a", 100, scope) : s.events?.("conf-a", 100),
  // Optional methods: an adapter without them answers nothing here; completeSource(adapter) has them all.
  extent: async (s, scope) => (scope ? s.extent?.(ramp, scope) : s.extent?.(ramp)),
  refExtent: async (s, scope) => (scope ? s.refExtent?.("conf-a", scope) : s.refExtent?.("conf-a")),
  firstTimes: async (s, scope) =>
    scope
      ? s.firstTimes?.("conf-a", ["Lin.RAMP", "Sna.CODE"], 1001, scope)
      : s.firstTimes?.("conf-a", ["Lin.RAMP", "Sna.CODE"], 1001),
};
