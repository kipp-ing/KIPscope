/**
 * The conformance suite (design C7 of add-adx-source): every case runs twice per adapter, as is
 * (`<name> native`) and reduced to its required methods (`<name> core only`). Expected values come from
 * the fixture definition (`fixture.ts`) and the numbers in the data-source spec, never from a source.
 */
import {
  computeRows,
  decodeTimes,
  parseFormula,
  type SeriesResult,
  TIME_MAX,
  TIME_MIN,
} from "@kipscope/shared";
import { describe, expect, it } from "vitest";
import { queryComputed } from "../../src/computed.ts";
import type {
  ComputedInputRef,
  ComputedRef,
  DataSource,
  Scope,
  SeriesRef,
  SnaRange,
  SourceAdapter,
  StateChangeRule,
} from "../../src/datasource.ts";
import { completeSource, coreOnly } from "../../src/fallbacks.ts";
import { B, FIXTURE_COUNTS, FIXTURE_SIGNALS, fixtureEvents } from "./fixture.ts";

export interface ConformanceTarget {
  /** "clickhouse", "adx". */
  name: string;
  /** An adapter over the seeded conformance tables. */
  adapter: () => SourceAdapter;
  /** The same, with the events table configured as `nope`. */
  eventsMissing?: () => SourceAdapter;
}

const MS = 1_000_000n;
const S = 1_000_000_000n;

const ref = (
  dataRef: string,
  name: string,
  sna: readonly SnaRange[] = [],
  text?: boolean,
): SeriesRef => (text === undefined ? { dataRef, name, sna } : { dataRef, name, sna, text });
const ramp = ref("conf-a", "Lin.RAMP");
const beat = ref("conf-a", "Beat.HB");

/** The Sna.CODE ranges of the conformance tests: 7 is SNA (fixture.ts). */
const snaCode = ref("conf-a", "Sna.CODE", [{ lo: 6.5, hi: 7.5 }]);

/**
 * A computed ref over `conf-a`; `inputs` in the order the formula names them; `hold`: hold limits in
 * ns by input name.
 */
function computedOf(
  formula: string,
  inputs: readonly SeriesRef[],
  hold: Record<string, bigint> = {},
): ComputedRef {
  const parsed = parseFormula(formula);
  if (!parsed.ok) throw new Error(`${formula}: ${parsed.message}`);
  return {
    dataRef: "conf-a",
    ast: parsed.ast,
    inputs: inputs.map((r): ComputedInputRef => {
      const holdNs = hold[r.name];
      return holdNs === undefined ? { ...r } : { ...r, holdNs };
    }),
  };
}

/** Times and values of a raw result; fails on buckets. */
function rawRows(result: SeriesResult): { t: bigint; v: number | null }[] {
  if (result.kind !== "raw") throw new Error("expected a raw series");
  return decodeTimes(result.t).map((t, i) => ({ t, v: result.v[i] as number | null }));
}

/**
 * The three scopes of design Z4 of add-scope over the C7 fixture, all on `conf-a`.
 * SC (B + 170 s … 280 s) cuts the `Beat.HB` run on both sides and holds the logger gap (200 s … 260 s)
 * and two `Diag.door` rows. SC2 (B + 5 s … 35 s) holds four signals, and `conf-b/Lin.RAMP` lies in the
 * same times but is another data ref. SC3 (B + 230 s … 280 s) starts inside the logger gap.
 */
const SC: Scope = { dataRef: "conf-a", from: B + 170n * S, to: B + 280n * S };
const SC2: Scope = { dataRef: "conf-a", from: B + 5n * S, to: B + 35n * S };
const SC3: Scope = { dataRef: "conf-a", from: B + 230n * S, to: B + 280n * S };

const sortedTimes = (list: bigint[] | undefined) =>
  [...(list ?? [])].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));

const byId = (a: { dataRef: string; name: string }, b: { dataRef: string; name: string }) =>
  a.dataRef === b.dataRef ? (a.name < b.name ? -1 : 1) : a.dataRef < b.dataRef ? -1 : 1;

/** Registers every case twice: `<name> native` and `<name> core only`. */
export function describeConformance(target: ConformanceTarget): void {
  for (const mode of ["native", "core only"] as const) {
    describe(`${target.name} ${mode}`, () => {
      const make = (adapter: SourceAdapter): DataSource =>
        completeSource(mode === "native" ? adapter : coreOnly(adapter));
      const source = make(target.adapter());

      it("holds the fixture", async () => {
        const listed = await source.listSignals();
        expect(listed.length).toBe(FIXTURE_SIGNALS.length);
        const a = await source.refExtent("conf-a");
        const b = await source.refExtent("conf-b");
        expect(a?.count).toBe(FIXTURE_COUNTS.confATimed);
        expect(b?.count).toBe(FIXTURE_COUNTS.confB);
      });

      it("lists signals with their text flag", async () => {
        const raw = await source.listSignals();
        const listed = raw
          .map((s) => ({ dataRef: s.dataRef, name: s.name, text: s.text === true }))
          .sort(byId);
        expect(listed).toEqual(FIXTURE_SIGNALS);
        // No unit without a unit column (add-adx-row-metadata, data-source "No unit without a unit column").
        expect(raw.every((s) => !("unit" in s))).toBe(true);
      });

      it("never returns rows without a time", async () => {
        const points = await source.raw(ramp, TIME_MIN, TIME_MAX);
        expect(points.length).toBe(10_000);
        expect(points.some((p) => p.v === -1)).toBe(false);
        expect(await source.count(ramp, TIME_MIN, TIME_MAX)).toBe(10_000);
        expect(await source.extent(ramp)).toEqual({ first: B, last: B + 9999n * 10n * MS });
        expect((await source.refExtent("conf-a"))?.count).toBe(17_069);
        const times = await source.firstTimes("conf-a", ["Lin.RAMP"], 20_000);
        expect(times.get("Lin.RAMP")?.length).toBe(10_000);
      });

      it("keeps times exact", async () => {
        const fine = ref("conf-a", "Fine.NS");
        const at = (k: number) => B + 123_456_700n + BigInt(k) * 1100n;
        const all = await source.raw(fine, TIME_MIN, TIME_MAX);
        expect(all.length).toBe(1000);
        expect(all.map((p) => p.t)).toEqual(Array.from({ length: 1000 }, (_, k) => at(k)));
        expect(all.map((p) => p.v)).toEqual(Array.from({ length: 1000 }, (_, k) => k));
        const bound = B + 123_456_701n;
        expect(await source.before(fine, bound)).toEqual({ t: at(0), v: 0 });
        expect(await source.after(fine, bound)).toEqual({ t: at(1), v: 1 });
        // Bounds between two ticks of 100 ns: only the point at B + 123,457,800 lies in the range.
        const between = await source.raw(fine, bound, B + 123_457_801n);
        expect(between).toEqual([{ t: at(1), v: 1 }]);
      });

      it("reads raw points in a half-open range", async () => {
        const points = await source.raw(ramp, B + S, B + 2n * S);
        expect(points.length).toBe(100);
        expect(points[0]).toEqual({ t: B + S, v: 100 });
        expect(points[99]).toEqual({ t: B + S + 990n * MS, v: 199 });
        for (let i = 1; i < points.length; i++) {
          expect((points[i] as { t: bigint }).t > (points[i - 1] as { t: bigint }).t).toBe(true);
        }
        expect(points.some((p) => p.t === B + 2n * S)).toBe(false);
      });

      it("limits raw to the earliest points", async () => {
        const points = await source.raw(ramp, TIME_MIN, TIME_MAX, 1001);
        expect(points.length).toBe(1001);
        expect(points[0]).toEqual({ t: B, v: 0 });
        expect(points[1000]).toEqual({ t: B + 10n * S, v: 1000 });
        expect(points.map((p) => p.v)).toEqual(Array.from({ length: 1001 }, (_, n) => n));
      });

      it("finds the neighbours before and after", async () => {
        expect(await source.before(ramp, B + S)).toEqual({ t: B + 990n * MS, v: 99 });
        expect(await source.after(ramp, B + S)).toEqual({ t: B + S, v: 100 });
        expect(await source.before(ramp, B)).toBeUndefined();
        expect(await source.after(ramp, B + 100n * S)).toBeUndefined();
      });

      it("aggregates buckets on the floor grid", async () => {
        const buckets = await source.buckets(ramp, B + 500n * MS, B + 2500n * MS, S);
        expect(buckets.map((b) => b.start)).toEqual([B, B + S, B + 2n * S]);
        expect(buckets.map((b) => b.count)).toEqual([50, 100, 50]);
        expect(buckets.map((b) => b.sna)).toEqual([0, 0, 0]);
        expect(buckets.map((b) => b.mean)).toEqual([74.5, 149.5, 224.5]);
        expect(buckets.map((b) => b.min)).toEqual([50, 100, 200]);
        expect(buckets.map((b) => b.max)).toEqual([99, 199, 249]);
      });

      it("floors bucket starts before 1970", async () => {
        const buckets = await source.buckets(ref("conf-b", "Span.FAR"), -2n * S, S, S);
        expect(buckets.map((b) => b.start)).toEqual([-2_000_000_000n, 0n]);
        expect(buckets.map((b) => b.count)).toEqual([1, 1]);
        expect(buckets.map((b) => b.mean)).toEqual([1, 2]);
      });

      it("reports SNA as null and in bucket counts", async () => {
        const sna = ref("conf-a", "Sna.CODE", [{ lo: 6.5, hi: 7.5 }]);
        const points = await source.raw(sna, TIME_MIN, TIME_MAX);
        expect(points.length).toBe(100);
        points.forEach((p, n) => {
          expect(p.t).toBe(B + BigInt(n) * S);
          expect(p.v).toBe(n >= 40 && n <= 49 ? null : n % 5);
        });
        const buckets = await source.buckets(sna, B, B + 100n * S, 10n * S);
        expect(buckets.length).toBe(10);
        buckets.forEach((b, i) => {
          expect(b.start).toBe(B + BigInt(i) * 10n * S);
          if (i === 4) {
            expect(b).toEqual({
              start: b.start,
              count: 0,
              sna: 10,
              mean: null,
              min: null,
              max: null,
            });
          } else {
            expect(b).toEqual({ start: b.start, count: 10, sna: 0, mean: 2, min: 0, max: 4 });
          }
        });
        expect(await source.before(sna, B + 45n * S)).toEqual({ t: B + 44n * S, v: null });
      });

      it("counts the rows of a data ref per bucket", async () => {
        const withTimes = (await source.refBuckets("conf-a", 60n * S, true)).sort((x, y) =>
          x.start < y.start ? -1 : 1,
        );
        expect(withTimes.length).toBe(10);
        expect(withTimes.reduce((sum, b) => sum + b.count, 0)).toBe(17_069);
        expect(withTimes[3]).toEqual({
          start: B + 180n * S,
          count: 202,
          first: B + 180n * S,
          last: B + 200n * S,
        });
        expect(withTimes[4]).toEqual({
          start: B + 240n * S,
          count: 401,
          first: B + 260n * S,
          last: B + 299n * S + 900n * MS,
        });
        const counts = (await source.refBuckets("conf-a", 60n * S, false)).sort((x, y) =>
          x.start < y.start ? -1 : 1,
        );
        expect(counts.map((b) => [b.start, b.count])).toEqual(
          withTimes.map((b) => [b.start, b.count]),
        );
        expect(counts.every((b) => b.first === undefined && b.last === undefined)).toBe(true);
      });

      it("answers empty for an unknown signal", async () => {
        const nope = ref("conf-a", "Nope.X");
        expect(await source.raw(nope, TIME_MIN, TIME_MAX)).toEqual([]);
        expect(await source.buckets(nope, TIME_MIN, TIME_MAX, S)).toEqual([]);
        expect(await source.before(nope, TIME_MAX)).toBeUndefined();
        expect(await source.after(nope, TIME_MIN)).toBeUndefined();
        expect(await source.count(nope, TIME_MIN, TIME_MAX)).toBe(0);
      });

      it("counts points", async () => {
        expect(await source.count(ramp, TIME_MIN, TIME_MAX)).toBe(10_000);
        expect(await source.count(ramp, B + S, B + 2n * S)).toBe(100);
        expect(await source.count(ramp, B + S, B + S)).toBe(0);
        expect(await source.count(ref("conf-b", "Lin.RAMP"), TIME_MIN, TIME_MAX)).toBe(10);
      });

      it("finds the extent", async () => {
        expect(await source.extent(ramp)).toEqual({ first: B, last: B + 9999n * 10n * MS });
        expect(await source.extent(ref("conf-b", "Span.FAR"))).toEqual({
          first: -1_500_000_000n,
          last: 500_000_000n,
        });
        expect(await source.extent(ref("conf-a", "Nope.X"))).toBeUndefined();
      });

      it("answers a series", async () => {
        // Expected values from the fixture definition: Lin.RAMP n at B + n·10 ms with value n,
        // Sna.CODE n at B + n s, Diag.door closed/closed/open/open/closed at B + 0, 90, 180, 270, 360 s.
        const rampAt = (n: number) => ({ t: B + BigInt(n) * 10n * MS, v: n });

        // (a) 100 points at target 100: raw with both edges, outside the range.
        const width = 10_204_082n; // ceil(1 s / 98), as querySeries computes it for target 100
        expect(await source.series(ramp, B + S, B + 2n * S, 100, width)).toEqual({
          kind: "raw",
          points: Array.from({ length: 100 }, (_, i) => rampAt(100 + i)),
          before: rampAt(99),
          after: rampAt(200),
        });

        // (b) one point more than the target: buckets on the floor grid k * width, 100 points in all.
        const over = await source.series(ramp, B + S, B + 2n * S, 99, width);
        expect(over.kind).toBe("buckets");
        if (over.kind !== "buckets") return;
        const expectedStarts = new Map<bigint, number[]>();
        for (let n = 100; n < 200; n++) {
          const t = B + BigInt(n) * 10n * MS;
          const start = t - (t % width);
          expectedStarts.set(start, [...(expectedStarts.get(start) ?? []), n]);
        }
        expect(over.buckets.map((b) => b.start)).toEqual([...expectedStarts.keys()]);
        expect(over.buckets.map((b) => b.count)).toEqual(
          [...expectedStarts.values()].map((values) => values.length),
        );
        expect(over.buckets.reduce((sum, b) => sum + b.count, 0)).toBe(100);
        expect(over.buckets.map((b) => b.sna)).toEqual(over.buckets.map(() => 0));
        expect(over.buckets.map((b) => b.min)).toEqual(
          [...expectedStarts.values()].map((values) => Math.min(...values)),
        );
        expect(over.buckets.map((b) => b.max)).toEqual(
          [...expectedStarts.values()].map((values) => Math.max(...values)),
        );

        // (c) 10,000 points at target 11: 10 buckets of 10 s, 1,000 points each.
        const tenS = 10n * S;
        const wide = await source.series(ramp, B, B + 100n * S, 11, tenS);
        expect(wide.kind).toBe("buckets");
        if (wide.kind === "buckets") {
          expect(wide.buckets).toEqual(
            Array.from({ length: 10 }, (_, i) => ({
              start: B + BigInt(i) * tenS,
              count: 1000,
              sna: 0,
              mean: 1000 * i + 499.5,
              min: 1000 * i,
              max: 1000 * i + 999,
            })),
          );
        }

        // (d) SNA points count towards the target and come back as null values; edges are SNA-aware.
        const sna = ref("conf-a", "Sna.CODE", [{ lo: 6.5, hi: 7.5 }]);
        expect(await source.series(sna, B + 40n * S, B + 50n * S, 20, tenS)).toEqual({
          kind: "raw",
          points: Array.from({ length: 10 }, (_, i) => ({ t: B + BigInt(40 + i) * S, v: null })),
          before: { t: B + 39n * S, v: 4 },
          after: { t: B + 50n * S, v: 0 },
        });

        // (e) a text signal: points and edges carry the row text.
        const door = ref("conf-a", "Diag.door", [], true);
        expect(await source.series(door, B + 100n * S, B + 200n * S, 10, 12n * S)).toEqual({
          kind: "raw",
          points: [{ t: B + 180n * S, v: 0, text: "open" }],
          before: { t: B + 90n * S, v: 0, text: "closed" },
          after: { t: B + 270n * S, v: 0, text: "open" },
        });

        // (f) in the scope SC2 the edge before B + 5 s is absent although B + 4.99 s has a point.
        const scoped = await source.series(ramp, B + 5n * S, B + 6n * S, 100, width, SC2);
        expect(scoped).toEqual({
          kind: "raw",
          points: Array.from({ length: 100 }, (_, i) => rampAt(500 + i)),
          after: rampAt(600),
        });
        expect("before" in scoped && scoped.before !== undefined).toBe(false);

        // (g) an unknown signal: raw, no points, no edges.
        const none = await source.series(ref("conf-a", "Nope.X"), B, B + 100n * S, 100, tenS);
        expect(none.kind).toBe("raw");
        if (none.kind === "raw") {
          expect(none.points).toEqual([]);
          expect(none.before).toBeUndefined();
          expect(none.after).toBeUndefined();
        }
      });

      it("finds the extent and row count of a data ref", async () => {
        expect(await source.refExtent("conf-a")).toEqual({
          count: 17_069,
          first: B,
          last: B + 599n * S + 900n * MS,
        });
        expect(await source.refExtent("conf-b")).toEqual({
          count: 12,
          first: -1_500_000_000n,
          last: B + 9n * S,
        });
        expect(await source.refExtent("nope")).toBeUndefined();
        // refCount only has to change when rows are added; rows without a time may count.
        expect([17_069, 17_070]).toContain(await source.refCount("conf-a"));
        expect(await source.refCount("nope")).toBe(0);
      });

      it("finds logger gaps", async () => {
        const a = await source.loggerGaps("conf-a", S, 2n * S);
        expect(a.gaps).toEqual([
          { from: B + 200n * S, to: B + 260n * S },
          { from: B + 500n * S, to: B + 502n * S },
        ]);
        expect(a.last).toBe(B + 599n * S + 900n * MS);
        const b = await source.loggerGaps("conf-b", S, 2n * S);
        expect(b.gaps).toEqual([
          { from: -1_500_000_000n, to: 500_000_000n },
          { from: 500_000_000n, to: B },
        ]);
        expect(b.last).toBe(B + 9n * S);
        const none = await source.loggerGaps("nope", S, 2n * S);
        expect(none.gaps).toEqual([]);
        expect(none.last).toBeUndefined();
      });

      it("samples the first times", async () => {
        const times = await source.firstTimes("conf-a", ["Lin.RAMP", "Sna.CODE", "Nope.X"], 1001);
        expect([...times.keys()].sort()).toEqual(["Lin.RAMP", "Sna.CODE"]);
        const sorted = (list: bigint[] | undefined) =>
          [...(list ?? [])].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
        expect(sorted(times.get("Lin.RAMP"))).toEqual(
          Array.from({ length: 1001 }, (_, n) => B + BigInt(n) * 10n * MS),
        );
        expect(sorted(times.get("Sna.CODE"))).toEqual(
          Array.from({ length: 100 }, (_, n) => B + BigInt(n) * S),
        );

        // Every call to the adapter except firstTimes itself is a query; none may happen for [].
        const adapter = target.adapter();
        const calls: string[] = [];
        const counting = new Proxy(adapter, {
          get(obj, key, receiver) {
            const member = Reflect.get(obj, key, receiver);
            if (typeof member !== "function" || key === "firstTimes") return member;
            return (...args: unknown[]) => {
              calls.push(String(key));
              return member.apply(obj, args);
            };
          },
        });
        const none = await make(counting).firstTimes("conf-a", [], 1001);
        expect(none.size).toBe(0);
        expect(calls).toEqual([]);
      });

      it("finds state changes", async () => {
        const mode = ref("conf-a", "State.MODE", [{ lo: 14.5, hi: 15.5 }]);
        const by: StateChangeRule = { kind: "labels", values: [0, 3], tolerance: 0.5 };
        const t = (ns: bigint) => ns.toString();
        const rows = await source.stateChanges(mode, by, 1000);
        expect(rows).toEqual([
          { t: t(B), value: 0, text: "" },
          {
            t: t(B + 10n * S),
            value: 3,
            text: "",
            prev: { t: t(B + 9n * S + 900n * MS), value: 0, text: "" },
          },
          {
            t: t(B + 40n * S),
            value: 0,
            text: "",
            prev: { t: t(B + 39n * S + 900n * MS), value: 3, text: "" },
          },
        ]);
        expect(await source.stateChanges(mode, by, 2)).toEqual(rows.slice(0, 2));

        const door = ref("conf-a", "Diag.door", [], true);
        expect(await source.stateChanges(door, { kind: "text" }, 1000)).toEqual([
          { t: t(B), value: 0, text: "closed" },
          {
            t: t(B + 180n * S),
            value: 0,
            text: "open",
            prev: { t: t(B + 90n * S), value: 0, text: "closed" },
          },
          {
            t: t(B + 360n * S),
            value: 0,
            text: "closed",
            prev: { t: t(B + 270n * S), value: 0, text: "open" },
          },
        ]);
        expect(await source.stateChanges(ref("conf-a", "Nope.X"), { kind: "text" }, 10)).toEqual(
          [],
        );
      });

      // The scoped cases (design Z4 of add-scope): the answer is as if the source held only the rows
      // of the scope's data ref with from <= time < to. Expected values come from the fixture definition.

      it("lists the signals of a scope", async () => {
        const listed = (scope: Scope) =>
          source
            .listSignals(scope)
            .then((list) =>
              list
                .map((s) => ({ dataRef: s.dataRef, name: s.name, text: s.text === true }))
                .sort(byId),
            );
        expect(await listed(SC)).toEqual([
          { dataRef: "conf-a", name: "Beat.HB", text: false },
          { dataRef: "conf-a", name: "Diag.door", text: true },
        ]);
        // No `conf-b/Lin.RAMP`, although it has rows at the same times.
        expect(await listed(SC2)).toEqual([
          { dataRef: "conf-a", name: "Beat.HB", text: false },
          { dataRef: "conf-a", name: "Lin.RAMP", text: false },
          { dataRef: "conf-a", name: "Sna.CODE", text: false },
          { dataRef: "conf-a", name: "State.MODE", text: false },
        ]);
      });

      it("bounds the data-ref methods by a scope", async () => {
        // SC holds Beat.HB k = 1700 … 2000 (301 rows) and 2600 … 2799 (200) and Diag.door at 180, 270 s.
        expect(await source.refExtent("conf-a", SC)).toEqual({
          count: 503,
          first: B + 170n * S,
          last: B + 279n * S + 900n * MS,
        });
        expect(await source.refCount("conf-a", SC)).toBe(503);
        const buckets = (await source.refBuckets("conf-a", 60n * S, true, SC)).sort((x, y) =>
          x.start < y.start ? -1 : 1,
        );
        expect(buckets).toEqual([
          { start: B + 120n * S, count: 100, first: B + 170n * S, last: B + 179n * S + 900n * MS },
          { start: B + 180n * S, count: 202, first: B + 180n * S, last: B + 200n * S },
          { start: B + 240n * S, count: 201, first: B + 260n * S, last: B + 279n * S + 900n * MS },
        ]);
        const gaps = await source.loggerGaps("conf-a", S, 2n * S, SC);
        expect(gaps.gaps).toEqual([{ from: B + 200n * S, to: B + 260n * S }]);
        expect(gaps.last).toBe(B + 279n * S + 900n * MS);
        // SC3 starts inside the logger gap: the pause is no gap in it.
        const inside = await source.loggerGaps("conf-a", S, 2n * S, SC3);
        expect(inside.gaps).toEqual([]);
        expect(inside.last).toBe(B + 279n * S + 900n * MS);

        const expected = fixtureEvents()
          .filter((e) => e.dataRef === "conf-a" && e.t !== null && e.t >= SC.from && e.t < SC.to)
          .map((e) => ({
            t: String(e.t),
            source: e.source,
            kind: e.kind,
            name: e.name,
            value: e.value,
            text: e.text,
            detail: e.detail,
          }));
        expect(expected.map((e) => [e.name, e.text, e.t])).toEqual([
          ["Diag.door", "open", String(B + 180n * S)],
        ]);
        const inScope = await source.events("conf-a", 100, SC);
        const none = await source.events("conf-a", 100, SC2);
        if (mode === "core only") {
          expect(inScope).toBeUndefined();
          expect(none).toBeUndefined();
        } else {
          expect(inScope).toEqual(expected);
          expect(none).toEqual([]);
        }
      });

      it("bounds the signal methods by a scope", async () => {
        // SC2 holds Lin.RAMP n = 500 … 3,499 at B + n·10 ms.
        expect(await source.extent(ramp, SC2)).toEqual({
          first: B + 5n * S,
          last: B + 34n * S + 990n * MS,
        });
        expect(await source.extent(ref("conf-a", "Fine.NS"), SC2)).toBeUndefined();
        expect(await source.before(ramp, B + 5n * S, SC2)).toBeUndefined();
        expect(await source.before(ramp, B + 40n * S, SC2)).toEqual({
          t: B + 34n * S + 990n * MS,
          v: 3499,
        });
        expect(await source.after(ramp, B, SC2)).toEqual({ t: B + 5n * S, v: 500 });
        expect(await source.after(ramp, B + 35n * S, SC2)).toBeUndefined();
      });

      it("samples the first times in a scope", async () => {
        const times = await source.firstTimes(
          "conf-a",
          ["Lin.RAMP", "Sna.CODE", "Beat.HB", "Nope.X"],
          1001,
          SC2,
        );
        expect([...times.keys()].sort()).toEqual(["Beat.HB", "Lin.RAMP", "Sna.CODE"]);
        expect(sortedTimes(times.get("Lin.RAMP"))).toEqual(
          Array.from({ length: 1001 }, (_, n) => B + 5n * S + BigInt(n) * 10n * MS),
        );
        // Sna.CODE n = 5 … 34 (30 rows), Beat.HB k = 50 … 349 (300 rows).
        expect(sortedTimes(times.get("Sna.CODE"))).toEqual(
          Array.from({ length: 30 }, (_, n) => B + BigInt(n + 5) * S),
        );
        expect(sortedTimes(times.get("Beat.HB"))).toEqual(
          Array.from({ length: 300 }, (_, k) => B + BigInt(k + 50) * 100n * MS),
        );
      });

      it("finds state changes in a scope", async () => {
        const t = (ns: bigint) => ns.toString();
        // State.MODE n = 50 … 349: 0 (n < 100), 3 (< 300), 15 = SNA (< 305), 3 after; the SNA run is no change.
        const mode = ref("conf-a", "State.MODE", [{ lo: 14.5, hi: 15.5 }]);
        const by: StateChangeRule = { kind: "labels", values: [0, 3], tolerance: 0.5 };
        expect(await source.stateChanges(mode, by, 100, SC2)).toEqual([
          { t: t(B + 5n * S), value: 0, text: "" },
          {
            t: t(B + 10n * S),
            value: 3,
            text: "",
            prev: { t: t(B + 9n * S + 900n * MS), value: 0, text: "" },
          },
        ]);
        // Diag.door is open at both of its rows in SC: the first row, and no change after it.
        const door = ref("conf-a", "Diag.door", [], true);
        expect(await source.stateChanges(door, { kind: "text" }, 100, SC)).toEqual([
          { t: t(B + 180n * S), value: 0, text: "open" },
        ]);
      });

      it("lists events in order", async () => {
        const expected = fixtureEvents()
          .filter((e) => e.dataRef === "conf-a" && e.t !== null)
          .sort(
            (x, y) =>
              Number((x.t as bigint) - (y.t as bigint)) ||
              (x.kind < y.kind ? -1 : x.kind > y.kind ? 1 : 0) ||
              (x.source < y.source ? -1 : x.source > y.source ? 1 : 0) ||
              (x.name < y.name ? -1 : x.name > y.name ? 1 : 0),
          )
          .map((e) => ({
            t: String(e.t),
            source: e.source,
            kind: e.kind,
            name: e.name,
            value: e.value,
            text: e.text,
            detail: e.detail,
          }));
        expect(expected.map((e) => e.name)).toEqual([
          "Diag.door",
          "Diag.door",
          "P0AA100",
          "P0CA700",
          "SID 22",
        ]);
        const all = await source.events("conf-a", 100);
        const two = await source.events("conf-a", 2);
        const other = await source.events("conf-b", 100);
        if (mode === "core only") {
          // `events` is a capability: reduced to the required methods the adapter has none.
          expect(all).toBeUndefined();
          return;
        }
        expect(all).toEqual(expected);
        expect(two).toEqual(expected.slice(0, 2));
        expect(other).toEqual([]);
      });

      it.skipIf(target.eventsMissing === undefined)(
        "answers no events without an events table",
        async () => {
          const missing = make((target.eventsMissing as () => SourceAdapter)());
          expect(await missing.events("conf-a", 100)).toBeUndefined();
        },
      );

      // Computed signals (computed-signals, data-source "Computed series method"): the same rows
      // `native` (the adapter's computedSeries) and `core only` (the fallback from raw points).
      const diffRef = () => computedOf("Lin.RAMP - Sna.CODE", [ramp, snaCode]);

      it("computes a difference per row with edges", async () => {
        const result = await queryComputed(
          source,
          diffRef(),
          "conf-a/=c1",
          B + S,
          B + 2n * S,
          1000,
        );
        // Ramp n at B + n·10 ms is 100 + k at B + 1 s + k·10 ms; Sna.CODE holds 1 (n = 1): 99 + k.
        expect(rawRows(result)).toEqual(
          Array.from({ length: 100 }, (_, k) => ({ t: B + S + BigInt(k) * 10n * MS, v: 99 + k })),
        );
        if (result.kind !== "raw") return;
        expect(result.signalId).toBe("conf-a/=c1");
        // before: the computed point at the latest seed (ramp 99 at B + 990 ms, Sna.CODE 0 at B).
        expect(result.before).toEqual({ t: String(B + 990n * MS), v: 99 });
        // after: at B + 2 s both inputs have a point: 200 - 2.
        expect(result.after).toEqual({ t: String(B + 2n * S), v: 198 });
      });

      it("computes one input per row", async () => {
        const abs = computedOf("abs(Lin.RAMP - 5000)", [ramp]);
        const result = await queryComputed(
          source,
          abs,
          "conf-a/=c2",
          B + 49_900n * MS,
          B + 50_100n * MS,
          1000,
        );
        // n = 4990 … 5009 at B + n·10 ms.
        expect(rawRows(result)).toEqual(
          Array.from({ length: 20 }, (_, i) => ({
            t: B + BigInt(4990 + i) * 10n * MS,
            v: Math.abs(4990 + i - 5000),
          })),
        );
        expect(rawRows(result).map((r) => r.v)).toEqual([
          10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
        ]);
      });

      // spec computed-signals "Three inputs"
      it("computes three inputs per row", async () => {
        const three = computedOf("Lin.RAMP + Sna.CODE * 100 - Beat.HB", [ramp, snaCode, beat]);
        const result = await queryComputed(
          source,
          three,
          "conf-a/=c5",
          B + S,
          B + 1_200n * MS,
          1000,
        );
        // Lin.RAMP is 100 + k at B + 1 s + k·10 ms; Sna.CODE holds 1 (x 100); Beat.HB is 0 at
        // B + 1 s and 1 from B + 1.1 s: 200 + k for k = 0 … 9, then 199 + k for k = 10 … 19.
        expect(rawRows(result)).toEqual(
          Array.from({ length: 20 }, (_, k) => ({
            t: B + S + BigInt(k) * 10n * MS,
            v: k < 10 ? 200 + k : 199 + k,
          })),
        );
        if (result.kind !== "raw") return;
        expect(result.signalId).toBe("conf-a/=c5");
        // One scan or three raw reads give the same rows as the rule on the inputs' raw points.
        const a = await source.raw(ramp, B, B + 3n * S);
        const b = await source.raw(snaCode, B, B + 3n * S);
        const c = await source.raw(beat, B, B + 3n * S);
        const rule = computeRows(three.ast, [{ points: a }, { points: b }, { points: c }]);
        expect(rule.filter((r) => r.t >= B + S && r.t < B + 1_200n * MS)).toEqual(
          rawRows(result).map((r) => ({ t: r.t, v: r.v })),
        );
      });

      it("computes SNA from either input", async () => {
        const result = await queryComputed(
          source,
          diffRef(),
          "conf-a/=c1",
          B + 49_500n * MS,
          B + 50_500n * MS,
          1000,
        );
        // Sna.CODE n = 49 is SNA (7) up to B + 50 s; from there n = 50 gives 0: ramp 5000 … 5049.
        const rows = rawRows(result);
        expect(rows.map((r) => r.t)).toEqual(
          Array.from({ length: 100 }, (_, k) => B + 49_500n * MS + BigInt(k) * 10n * MS),
        );
        expect(rows.slice(0, 50).every((r) => r.v === null)).toBe(true);
        expect(rows.slice(50).map((r) => r.v)).toEqual(
          Array.from({ length: 50 }, (_, j) => 5000 + j),
        );
      });

      it("gives SNA for non-finite results", async () => {
        // Sna.CODE is 0 at B: 0 / 0 is NaN, k / 0 is Infinity; held for the whole second.
        const result = await queryComputed(
          source,
          computedOf("Lin.RAMP / Sna.CODE", [ramp, snaCode]),
          "conf-a/=c3",
          B,
          B + S,
          1000,
        );
        const rows = rawRows(result);
        expect(rows.map((r) => r.t)).toEqual(
          Array.from({ length: 100 }, (_, k) => B + BigInt(k) * 10n * MS),
        );
        expect(rows.every((r) => r.v === null)).toBe(true);
      });

      it("holds an input only within its hold limit", async () => {
        // b (Sna.CODE, 1 at B + 1 s) holds 500 ms: rows B + 1 s … B + 1.5 s, 51 of them.
        const held = computedOf("Lin.RAMP - Sna.CODE", [ramp, snaCode], { "Sna.CODE": 500n * MS });
        const result = await queryComputed(source, held, "conf-a/=c1", B + S, B + 2n * S, 1000);
        expect(rawRows(result)).toEqual(
          Array.from({ length: 51 }, (_, k) => ({ t: B + S + BigInt(k) * 10n * MS, v: 99 + k })),
        );
        if (result.kind !== "raw") return;
        // The seed of b (B + 0, 990 ms old at the latest seed time) is stale: no before edge.
        expect(result.before).toBeUndefined();
        // b has a fresh point at B + 2 s again.
        expect(result.after).toEqual({ t: String(B + 2n * S), v: 198 });
      });

      it("gives no rows while an input has no data", async () => {
        const result = await queryComputed(
          source,
          computedOf("Lin.RAMP - Nope.X", [ramp, ref("conf-a", "Nope.X")]),
          "conf-a/=c4",
          B + S,
          B + 2n * S,
          1000,
        );
        expect(rawRows(result)).toEqual([]);
        if (result.kind !== "raw") return;
        expect(result.before).toBeUndefined();
        expect(result.after).toBeUndefined();
      });

      it("buckets computed rows exactly", async () => {
        const answer = await source.computedSeries(diffRef(), B, B + 100n * S, 100, 10n * S);
        expect(answer.kind).toBe("buckets");
        if (answer.kind !== "buckets") return;
        // Ramp n = 1000·i … 1000·i + 999 minus Sna.CODE (second mod 5, mean 2); bucket 4 is all
        // SNA (Sna.CODE is 7 from B + 40 s to B + 50 s).
        expect(answer.buckets).toEqual(
          Array.from({ length: 10 }, (_, i) =>
            i === 4
              ? { start: B + 40n * S, count: 0, sna: 1000, mean: null, min: null, max: null }
              : {
                  start: B + BigInt(i) * 10n * S,
                  count: 1000,
                  sna: 0,
                  mean: 1000 * i + 497.5,
                  min: 1000 * i,
                  max: 1000 * i + 995,
                },
          ),
        );
        // The same through queryComputed: buckets of the answer's width, no edges.
        const viaQuery = await queryComputed(source, diffRef(), "conf-a/=c1", B, B + 100n * S, 100);
        expect(viaQuery.kind).toBe("buckets");
        if (viaQuery.kind === "buckets")
          expect(
            viaQuery.count.reduce((x, y) => x + y, 0) + viaQuery.sna.reduce((x, y) => x + y, 0),
          ).toBe(10_000);
      });

      it("computes at shared times", async () => {
        const answer = await source.computedSeries(diffRef(), B, B + 3n * S, 1000, 3n * MS);
        expect(answer.kind).toBe("raw");
        if (answer.kind !== "raw") return;
        // 300 rows: Sna.CODE rows at B, B + 1 s, B + 2 s share their times with Lin.RAMP rows.
        expect(answer.points).toHaveLength(300);
        expect(answer.points[0]).toEqual({ t: B, v: 0 });
        expect(answer.points[99]).toEqual({ t: B + 990n * MS, v: 99 });
        expect(answer.points[100]).toEqual({ t: B + S, v: 99 });
        expect(answer.points[299]).toEqual({ t: B + 2990n * MS, v: 297 });
        // ...each equal to the rule applied to the same raw points.
        const a = await source.raw(ramp, B, B + 3n * S);
        const b = await source.raw(snaCode, B, B + 3n * S);
        expect(answer.points).toEqual(computeRows(diffRef().ast, [{ points: a }, { points: b }]));
      });

      it("rejects an aborted call", async () => {
        const reason = new Error("stopped by the conformance test");
        const controller = new AbortController();
        controller.abort(reason);
        const { signal } = controller;
        await expect(source.raw(ramp, TIME_MIN, TIME_MAX, undefined, signal)).rejects.toBe(reason);
        await expect(source.buckets(ramp, TIME_MIN, TIME_MAX, S, signal)).rejects.toBe(reason);
        await expect(
          source.firstTimes("conf-a", ["Lin.RAMP", "Sna.CODE"], 1001, undefined, signal),
        ).rejects.toBe(reason);
      });
    });
  }
}
