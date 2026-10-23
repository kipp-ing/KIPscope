import {
  computedValueAt,
  computeRows,
  decodeTimes,
  fromIso,
  NO_GAPS,
  parseFormula,
  type RawSeries,
  type SeriesResult,
} from "@kipscope/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { Catalog } from "../src/catalog.ts";
import type { DataSource, RawPoint, SourceAdapter } from "../src/datasource.ts";
import { completeSource, coreOnly } from "../src/fallbacks.ts";
import { WorkspaceStore } from "../src/workspace.ts";
import { memoryAdapter } from "./scopeApp.ts";
import { testCatalog, testDataSource } from "./testdb.ts";

const SIG_A = "Fast_100h.SIG_A";
const SPEED = "Sna_800h.SPEED";
const RPM = "Sna_800h.RPM";
const SIG_B = "Fast_100h.SIG_B";
const SIG_C = "Fast_100h.SIG_C";
const manyNames = (count: number) =>
  Array.from({ length: count }, (_, i) => `Many_700h.S${String(i).padStart(4, "0")}`);
// SIG_A: 5 ms from 2026-10-01T00:00:00Z over 10 h, sin(n / 1000). SPEED: n * 100 ms from 02:00:00,
// value n mod 100 (511 = SNA for n in [300, 499]). RPM: n * 1 s from 02:00:00, value 10 n (n = 0 … 3).
const T0 = fromIso("2026-10-01T00:00:00Z");
const S = fromIso("2026-10-01T02:00:00Z");
const MS = 1_000_000n;
const SEC = 1_000_000_000n;

const workspace = () => new WorkspaceStore({ signalExists: () => true, hasStates: () => false });

/** Counts every call to the source, by method name. */
function spied(source: DataSource) {
  const calls: string[] = [];
  const proxy = new Proxy(source, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        calls.push(String(prop));
        return value.apply(target, args);
      };
    },
  });
  return { source: proxy, calls };
}

const rows = (body: SeriesResult) => {
  if (body.kind !== "raw") throw new Error("expected a raw series");
  return decodeTimes(body.t).map((t, i) => ({ t, v: body.v[i] as number | null }));
};

describe("computed signals over HTTP (test DB)", () => {
  const real = testDataSource();
  const { source, calls } = spied(real);
  const catalog = testCatalog(real);
  const app = buildApp({ catalog, source, workspace: workspace() });
  beforeAll(() => catalog.refresh());
  afterAll(() => app.close());

  const get = async (url: string, query: Record<string, string>) => {
    const res = await app.inject({ url, query });
    return { status: res.statusCode, body: res.json() };
  };
  const computed = (extra: Record<string, string> = {}) => ({
    signal: "testcar/=c1",
    formula: `${SPEED} - ${RPM}`,
    ...extra,
  });
  const range = {
    from: "2026-10-01T02:00:00Z",
    to: "2026-10-01T02:00:03Z",
    target: "5000",
  };

  // By hand: SPEED n = 0 … 29 at S + n·100 ms (value n); RPM 0, 10, 20 at S, S + 1 s, S + 2 s.
  it("serves a computed series of two inputs", async () => {
    // Rows at the SPEED times (RPM shares every tenth): n − 10 · ⌊n / 10⌋ = n mod 10.
    const res = await get("/api/series", { ...computed(), ...range });
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("raw");
    expect(res.body.signalId).toBe("testcar/=c1");
    expect(res.body.from).toBe(S.toString());
    expect(res.body.to).toBe((S + 3n * SEC).toString());
    expect(rows(res.body)).toEqual(
      Array.from({ length: 30 }, (_, n) => ({ t: S + BigInt(n) * 100n * MS, v: n % 10 })),
    );
    // No data before the range; after: both inputs have a point at S + 3 s (30 − 30).
    expect(res.body.before).toBeUndefined();
    expect(res.body.after).toEqual({ t: (S + 3n * SEC).toString(), v: 0 });
  });

  // spec computed-signals "Series equals the per-row rule" (three inputs)
  it("serves a computed series", async () => {
    const formula = `${SIG_A} - ${SIG_B} + ${SIG_C}`;
    const window = { from: "2026-10-01T02:00:00Z", to: "2026-10-01T02:00:02Z", target: "5000" };
    const ask = (query: Record<string, string>) => get("/api/series", { ...query, ...window });
    const [sum, a, b, c] = await Promise.all([
      ask({ signal: "testcar/=c1", formula }),
      ask({ signal: `testcar/${SIG_A}` }),
      ask({ signal: `testcar/${SIG_B}` }),
      ask({ signal: `testcar/${SIG_C}` }),
    ]);
    expect(sum.status).toBe(200);
    expect(sum.body.kind).toBe("raw");
    expect(sum.body.signalId).toBe("testcar/=c1");
    const input = (r: RawSeries) => ({
      points: decodeTimes(r.t).map((t, i) => ({ t, v: r.v[i] as number | null })),
      ...(r.before && { seed: { t: BigInt(r.before.t), v: r.before.v } }),
    });
    const parsed = parseFormula(formula);
    if (!parsed.ok) throw new Error(parsed.message);
    const expected = computeRows(parsed.ast, [input(a.body), input(b.body), input(c.body)]);
    expect(expected.length).toBe(400);
    expect(rows(sum.body)).toEqual(expected);
    // By hand from the seed's formulas: value n = sin(n/1000) − 2 sin(n/2000) + 3 sin(n/3000)
    // at n = 1,440,000 + k (5 ms from the start, S is 7,200 s after it).
    const got = rows(sum.body);
    for (const k of [0, 1, 200, 399]) {
      const n = 1_440_000 + k;
      const want = Math.sin(n / 1000) - 2 * Math.sin(n / 2000) + 3 * Math.sin(n / 3000);
      expect(got[k]?.t, `row ${k}`).toBe(S + BigInt(k) * 5n * MS);
      expect(got[k]?.v as number, `row ${k}`).toBeCloseTo(want, 6);
    }
  });

  it("aggregates the exact rows into buckets", async () => {
    const inputs = { signal: "testcar/=c1", formula: `${SIG_A} - ${SPEED}` };
    const window = { from: "2026-10-01T02:00:00Z", to: "2026-10-01T02:00:02Z" };
    const [wide, raw] = await Promise.all([
      get("/api/series", { ...inputs, ...window, target: "50" }),
      get("/api/series", { ...inputs, ...window, target: "5000" }),
    ]);
    expect(wide.body.kind).toBe("buckets");
    const exact = rows(raw.body).flatMap((r) => (r.v === null ? [] : [r.v]));
    const b = wide.body;
    const sum = (list: number[]) => list.reduce((x, y) => x + y, 0);
    expect(sum(b.count)).toBe(exact.length);
    expect(sum(b.sna)).toBe(0);
    // The extremes of the exact rows survive in the buckets (D-102: no grid that loses them).
    expect(Math.min(...b.min)).toBe(Math.min(...exact));
    expect(Math.max(...b.max)).toBe(Math.max(...exact));
    const width = BigInt(b.width);
    for (const start of decodeTimes(b.t)) expect(start % width).toBe(0n);
  });

  // spec computed-signals "Refused requests"
  it("refuses bad computed requests", async () => {
    const reqs: [string, Record<string, string>, number, string, string][] = [
      [
        "no formula",
        { signal: "testcar/=c1", ...range },
        400,
        "invalid_request",
        "a computed signal needs formula",
      ],
      [
        "unknown input",
        computed({ formula: `${SIG_A} - Nope_1h.X`, ...range }),
        404,
        "unknown_signal",
        "not in this list",
      ],
      [
        "state input",
        computed({ formula: "Ign_A20h.MODE + 1", ...range }),
        422,
        "not_numeric_signal",
        "",
      ],
      [
        "nine names",
        computed({ formula: manyNames(9).join(" + "), ...range }),
        400,
        "invalid_formula",
        "At most 8 signals (with nested ones): 9",
      ],
      [
        "plain signal with a formula",
        { signal: `testcar/${SIG_A}`, formula: SIG_A, ...range },
        400,
        "invalid_request",
        "formula goes with a computed signal only",
      ],
      [
        "syntax",
        computed({ formula: `${SIG_A} %`, ...range }),
        400,
        "invalid_formula",
        'Unexpected "%" at 17',
      ],
      [
        "no signal named",
        computed({ formula: "2 * 3", ...range }),
        400,
        "invalid_formula",
        "Use at least one signal",
      ],
      [
        "short names are not known to the server",
        computed({ formula: "SIG_A - SPEED", ...range }),
        404,
        "unknown_signal",
        "not in this list",
      ],
      [
        "flat limit: 2,001 characters",
        computed({ formula: `${SIG_A}${" ".repeat(2001 - SIG_A.length)}`, ...range }),
        400,
        "invalid_formula",
        "characters",
      ],
    ];
    for (const [label, query, status, code, message] of reqs) {
      const res = await get("/api/series", query);
      expect(res.status, label).toBe(status);
      expect(res.body.error.code, label).toBe(code);
      if (message) expect(res.body.error.message, label).toContain(message);
    }
    // a and b are no parameters any more and get no special handling (D-108): ignored like any
    // unknown query parameter.
    for (const extra of [{ a: SIG_A }, { b: SPEED }]) {
      const res = await get("/api/series", { ...computed({ formula: SIG_A, ...range }), ...extra });
      expect(res.status, JSON.stringify(extra)).toBe(200);
    }
    // The unknown input is named by its ID; so is the state input.
    expect(
      (await get("/api/series", computed({ formula: `${SIG_A} - Nope_1h.X`, ...range }))).body.error
        .signalId,
    ).toBe("testcar/Nope_1h.X");
    expect(
      (await get("/api/series", computed({ formula: "Ign_A20h.MODE + 1", ...range }))).body.error
        .signalId,
    ).toBe("testcar/Ign_A20h.MODE");

    // The same refusals on /api/value and /api/extent.
    for (const [url, extra] of [
      ["/api/value", { t: "2026-10-01T02:00:01Z" }],
      ["/api/extent", {}],
    ] as const) {
      const base = computed(extra);
      expect((await get(url, { ...base, formula: `${SIG_A} %` })).body.error.code, url).toBe(
        "invalid_formula",
      );
      expect((await get(url, { ...base, formula: `${SIG_A} - Nope_1h.X` })).status, url).toBe(404);
      expect((await get(url, { ...base, formula: "Ign_A20h.MODE + 1" })).body.error.code, url).toBe(
        "not_numeric_signal",
      );
      expect(
        (await get(url, { ...base, formula: manyNames(9).join(" + ") })).body.error.message,
        url,
      ).toBe("At most 8 signals (with nested ones): 9");
      expect((await get(url, { signal: base.signal, ...extra })).body.error.message, url).toBe(
        "a computed signal needs formula",
      );
      expect(
        (await get(url, { signal: `testcar/${SPEED}`, formula: SIG_A, ...extra })).body.error
          .message,
        url,
      ).toBe("formula goes with a computed signal only");
    }
  });

  // spec computed-signals "Injected text refused"
  it("never passes formula text on to the source", async () => {
    calls.length = 0;
    const res = await get("/api/series", {
      ...computed({ formula: `${SIG_A} + 1); DROP TABLE signals --` }),
      ...range,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_formula");
    expect(res.body.error.message).toBe('Unexpected ")" at 20');
    expect(calls).toEqual([]);
  });

  // spec computed-signals "Value and extent"
  it("answers a computed value of three inputs and its extent", async () => {
    const formula = `${SIG_A} - ${SIG_B} + ${SIG_C}`;
    const parsed = parseFormula(formula);
    if (!parsed.ok) throw new Error(parsed.message);
    // Between rows of the 5 ms inputs: S + 2.5 ms.
    const t = (S + 2_500_000n).toString();
    for (const mode of ["step", "line"] as const) {
      const ask = (query: Record<string, string>) => get("/api/value", { ...query, t, mode });
      const sum = await ask({ signal: "testcar/=c1", formula });
      const inputs = await Promise.all(
        [SIG_A, SIG_B, SIG_C].map((n) => ask({ signal: `testcar/${n}` })),
      );
      expect(sum.status, mode).toBe(200);
      type Wire = { t: string; v: number | null };
      const neighbours = inputs.map((r) => {
        const at = r.body.at as Wire | undefined;
        const next = r.body.next as Wire | undefined;
        return {
          ...(at && { at: { t: BigInt(at.t), v: at.v } }),
          ...(next && { next: { t: BigInt(next.t), v: next.v } }),
        };
      });
      const want = computedValueAt(BigInt(t), mode, parsed.ast, neighbours, NO_GAPS);
      expect(want.value.kind, mode).toBe(mode === "step" ? "held" : "interpolated");
      expect(sum.body.value, mode).toEqual(want.value);
      expect(sum.body.signalId).toBe("testcar/=c1");
      expect(sum.body.at, mode).toEqual({ t: want.at?.t.toString(), v: want.at?.v });
    }
    // Extent: the latest first and the latest last of the three; all three run 00:00:00 … 09:59:59.995.
    const extent = await get("/api/extent", { signal: "testcar/=c1", formula });
    expect(extent.status).toBe(200);
    expect(extent.body).toEqual({
      signalId: "testcar/=c1",
      first: T0.toString(),
      last: (T0 + 35_999_995n * MS).toString(),
    });
  });

  it("answers a computed value and extent", async () => {
    const value = (t: string, mode?: string) =>
      get("/api/value", { ...computed(), t, ...(mode && { mode }) });
    // t = S + 150 ms: SPEED holds n = 1 (value 1), next n = 2 (value 2); RPM holds 0 (n = 0) and
    // contributes that at the next computed point. at (S + 100 ms, 1 − 0), next (S + 200 ms, 2 − 0).
    const t = (S + 150n * MS).toString();
    const line = await value(t);
    expect(line.status).toBe(200);
    expect(line.body).toEqual({
      signalId: "testcar/=c1",
      t,
      mode: "line",
      at: { t: (S + 100n * MS).toString(), v: 1 },
      next: { t: (S + 200n * MS).toString(), v: 2 },
      value: { kind: "interpolated", value: 1.5 },
    });
    const step = await value(t, "step");
    expect(step.body.mode).toBe("step");
    expect(step.body.value).toEqual({ kind: "held", value: 1 });
    // On a computed point: SPEED n = 10 (10) and RPM n = 1 (10) at S + 1 s.
    const on = await value((S + SEC).toString());
    expect(on.body.value).toEqual({ kind: "raw", value: 0 });
    // Inside SPEED's SNA run (n = 350): SNA, in both modes.
    const sna = (S + 35n * SEC + 50n * MS).toString();
    expect((await value(sna)).body.value).toEqual({ kind: "sna" });
    expect((await value(sna, "step")).body.value).toEqual({ kind: "sna" });
    // Before every input has a point: none.
    const early = await value((S - SEC).toString());
    expect(early.body.value).toEqual({ kind: "none", reason: "before_first" });

    // Extent: the later of the firsts and the later of the lasts. SIG_A runs 00:00:00 … 09:59:59.995,
    // SPEED 02:00:00 … 02:01:39.9.
    const extent = await get("/api/extent", computed({ formula: `${SIG_A} - ${SPEED}` }));
    expect(extent.status).toBe(200);
    expect(extent.body).toEqual({
      signalId: "testcar/=c1",
      first: S.toString(),
      last: (T0 + 35_999_995n * MS).toString(),
    });
  });
});

describe("computed signals over a source with the required methods only", () => {
  const base = fromIso("2026-10-01T00:00:00Z");
  /** Points per input; the first input at even, the second at odd nanoseconds after `base`. */
  const sizes = { "A.X": 100_001, "B.Y": 10 };
  const calls: { name: string; limit: number | undefined }[] = [];
  let startedAtFirstAnswer = 0;
  const adapter: SourceAdapter = {
    info: { kind: "memory", database: "stub", table: "rows" },
    ping: async () => {},
    listSignals: async () => [
      { dataRef: "car", name: "A.X" },
      { dataRef: "car", name: "B.Y" },
    ],
    raw: async (ref, _from, _to, limit) => {
      calls.push({ name: ref.name, limit });
      // Answer late, so that a sequential reader could not have started the other input yet.
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (startedAtFirstAnswer === 0) startedAtFirstAnswer = calls.length;
      const n = sizes[ref.name as keyof typeof sizes];
      const odd = ref.name === "B.Y" ? 1n : 0n;
      const all: RawPoint[] = Array.from({ length: n }, (_, i) => ({
        t: base + BigInt(i) * 2n + odd,
        v: 1,
      }));
      return limit === undefined ? all : all.slice(0, limit);
    },
    before: async () => undefined,
    after: async () => undefined,
    buckets: async () => [],
    refBuckets: async () => [],
  };
  const source = completeSource(adapter);
  const catalog = new Catalog(source, async () => new Map());
  const app = buildApp({ catalog, source, workspace: workspace() });
  beforeAll(() => catalog.refresh());
  afterAll(() => app.close());
  const ask = () =>
    app.inject({
      url: "/api/series",
      query: {
        signal: "car/=c1",
        formula: "A.X - B.Y",
        from: "2026-10-01T00:00:00Z",
        to: "2026-10-01T01:00:00Z",
        target: "1000",
      },
    });

  // spec data-source "Row cap": 200,000 rows for all inputs, an even share (100,000) each
  it("answers computed_too_large from the fallback", async () => {
    sizes["A.X"] = 100_001;
    sizes["B.Y"] = 10;
    calls.length = 0;
    startedAtFirstAnswer = 0;
    const res = await ask();
    expect(res.statusCode).toBe(422);
    const { error } = res.json();
    expect(error.code).toBe("computed_too_large");
    expect(error.message).toBe("more than 100,000 rows of A.X in this range: zoom in");
    // One wave: both reads started before either answered, each with the share plus one.
    expect(startedAtFirstAnswer).toBe(2);
    expect(
      calls
        .filter((c) => c.limit === 100_001)
        .map((c) => c.name)
        .sort(),
    ).toEqual(["A.X", "B.Y"]);
  });

  it("answers a computed series at exactly the share of each input", async () => {
    sizes["A.X"] = 100_000;
    sizes["B.Y"] = 100_000;
    const res = await ask();
    expect(res.statusCode).toBe(200);
    expect(res.json().kind).toBe("buckets");
  });
});

describe("computed signals hold an input within its period (memory source)", () => {
  // A.X every 10 ms over 3 s (value n); B.Y every 10 ms in [0, 1 s) (value 1000 + n) and in
  // [2 s, 3 s) (value 2000 + n): measured period 10 ms, so b holds 30 ms. Core only: the fallback.
  const base = fromIso("2026-10-02T00:00:00Z");
  const at = (n: number) => base + BigInt(n) * 10n * MS;
  const signals = [
    {
      dataRef: "car",
      name: "A.X",
      rows: Array.from({ length: 300 }, (_, n): [bigint, number] => [at(n), n]),
    },
    {
      dataRef: "car",
      name: "B.Y",
      rows: [
        ...Array.from({ length: 100 }, (_, n): [bigint, number] => [at(n), 1000 + n]),
        ...Array.from({ length: 100 }, (_, i): [bigint, number] => [at(200 + i), 2200 + i]),
      ],
    },
  ];
  const source = completeSource(coreOnly(memoryAdapter(signals) as SourceAdapter));
  const catalog = new Catalog(source, async () => new Map());
  const app = buildApp({ catalog, source, workspace: workspace() });
  beforeAll(() => catalog.refresh());
  afterAll(() => app.close());

  // spec computed-signals "Hold limit" (route wiring: hold limits come from the gap info)
  it("leaves no rows where b is older than three periods", async () => {
    const res = await app.inject({
      url: "/api/series",
      query: {
        signal: "car/=c1",
        formula: "A.X - B.Y",
        from: "2026-10-02T00:00:00Z",
        to: "2026-10-02T00:00:03Z",
        target: "5000",
      },
    });
    expect(res.statusCode).toBe(200);
    const got = rows(res.json());
    // b's last point of the first run is n = 99 (0.99 s); it holds until 0.99 s + 30 ms = n = 102.
    // The second run starts at n = 200. Values: n − (1000 + n), n − 1099, n − (2200 + n − 200).
    const expected = [
      ...Array.from({ length: 100 }, (_, n) => ({ t: at(n), v: -1000 })),
      ...[100, 101, 102].map((n) => ({ t: at(n), v: n - 1099 })),
      ...Array.from({ length: 100 }, (_, i) => ({ t: at(200 + i), v: 200 + i - (2200 + i) })),
    ];
    expect(got).toEqual(expected);
  });
});
