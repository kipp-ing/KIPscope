/**
 * The conformance suite (design C7 of add-adx-source): every case runs twice per adapter, as is
 * (`<name> native`) and reduced to its required methods (`<name> core only`). Expected values come from
 * the fixture definition (`fixture.ts`) and the numbers in the data-source spec, never from a source.
 */
import { TIME_MAX, TIME_MIN } from "@kipscope/shared";
import { describe, expect, it } from "vitest";
import type {
  DataSource,
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
        const listed = (await source.listSignals())
          .map((s) => ({ dataRef: s.dataRef, name: s.name, text: s.text === true }))
          .sort(byId);
        expect(listed).toEqual(FIXTURE_SIGNALS);
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

      it("rejects an aborted call", async () => {
        const reason = new Error("stopped by the conformance test");
        const controller = new AbortController();
        controller.abort(reason);
        const { signal } = controller;
        await expect(source.raw(ramp, TIME_MIN, TIME_MAX, undefined, signal)).rejects.toBe(reason);
        await expect(source.buckets(ramp, TIME_MIN, TIME_MAX, S, signal)).rejects.toBe(reason);
        await expect(
          source.firstTimes("conf-a", ["Lin.RAMP", "Sna.CODE"], 1001, signal),
        ).rejects.toBe(reason);
      });
    });
  }
}
