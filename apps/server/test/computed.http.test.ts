import {
  computeRows,
  decodeTimes,
  fromIso,
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

const withoutB = ({ b: _b, ...rest }: Record<string, string>) => rest;

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
    formula: "a - b",
    a: SPEED,
    b: RPM,
    ...extra,
  });
  const range = {
    from: "2026-10-01T02:00:00Z",
    to: "2026-10-01T02:00:03Z",
    target: "5000",
  };

  // spec computed-signals "Series equals the per-row rule"
  it("serves a computed series", async () => {
    // By hand: SPEED n = 0 … 29 at S + n·100 ms (value n); RPM 0, 10, 20 at S, S + 1 s, S + 2 s.
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

  it("serves the rule applied to the inputs' raw points", async () => {
    const window = { from: "2026-10-01T02:00:00Z", to: "2026-10-01T02:00:02Z", target: "5000" };
    const ask = (query: Record<string, string>) => get("/api/series", { ...query, ...window });
    const [diff, a, b] = await Promise.all([
      ask({ signal: "testcar/=c1", formula: "a - b", a: SIG_A, b: SPEED }),
      ask({ signal: `testcar/${SIG_A}` }),
      ask({ signal: `testcar/${SPEED}` }),
    ]);
    expect(diff.status).toBe(200);
    expect(diff.body.kind).toBe("raw");
    const input = (r: RawSeries) => ({
      points: decodeTimes(r.t).map((t, i) => ({ t, v: r.v[i] as number | null })),
      ...(r.before && { seed: { t: BigInt(r.before.t), v: r.before.v } }),
    });
    const parsed = parseFormula("a - b");
    if (!parsed.ok) throw new Error(parsed.message);
    const expected = computeRows(parsed.ast, input(a.body), input(b.body));
    expect(expected.length).toBe(400);
    expect(rows(diff.body)).toEqual(expected);
    expect(diff.body.signalId).toBe("testcar/=c1");
  });

  it("aggregates the exact rows into buckets", async () => {
    const inputs = { signal: "testcar/=c1", formula: "a - b", a: SIG_A, b: SPEED };
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

  // spec computed-signals "Refused requests", "Injected text refused"
  it("refuses bad computed requests", async () => {
    const reqs: [string, Record<string, string>, number, string, Record<string, string>?][] = [
      ["no formula", { signal: "testcar/=c1", a: SPEED, ...range }, 400, "invalid_request"],
      ["no a", { signal: "testcar/=c1", formula: "a", ...range }, 400, "invalid_request"],
      ["unknown name", computed({ formula: "a - c", ...range }), 400, "invalid_formula"],
      ["no b", withoutB({ ...computed(), ...range }), 400, "invalid_formula"],
      [
        "unknown input",
        computed({ a: "Nope_1h.X", ...range }),
        404,
        "unknown_signal",
        { signalId: "testcar/Nope_1h.X" },
      ],
      [
        "state input",
        computed({ a: "Ign_A20h.MODE", ...range }),
        422,
        "not_numeric_signal",
        { signalId: "testcar/Ign_A20h.MODE" },
      ],
      [
        "plain signal with a formula",
        { signal: `testcar/${SPEED}`, formula: "a", ...range },
        400,
        "invalid_request",
      ],
    ];
    for (const [label, query, status, code, extra] of reqs) {
      const res = await get("/api/series", query);
      expect(res.status, label).toBe(status);
      expect(res.body.error.code, label).toBe(code);
      if (extra?.signalId) expect(res.body.error.signalId, label).toBe(extra.signalId);
    }
    // The messages.
    expect(
      (await get("/api/series", computed({ formula: "a - c", ...range }))).body.error.message,
    ).toBe('Unknown name "c": use a, b, numbers, + - * / ( ), abs, min, max');
    expect((await get("/api/series", computed({ b: "", formula: "a - b", ...range }))).status).toBe(
      400,
    );
    expect(
      (await get("/api/series", { signal: "testcar/=c1", a: SPEED, ...range })).body.error.message,
    ).toBe("a computed signal needs formula and a");
    expect(
      (await get("/api/series", computed({ a: "Nope_1h.X", ...range }))).body.error.message,
    ).toContain("not in this list");

    // The same refusals on /api/value and /api/extent.
    for (const [url, extra] of [
      ["/api/value", { t: "2026-10-01T02:00:01Z" }],
      ["/api/extent", {}],
    ] as const) {
      const base = computed(extra);
      expect((await get(url, { ...base, formula: "a - c" })).body.error.code, url).toBe(
        "invalid_formula",
      );
      expect((await get(url, { ...base, a: "Nope_1h.X" })).status, url).toBe(404);
      expect((await get(url, { ...base, a: "Ign_A20h.MODE" })).body.error.code, url).toBe(
        "not_numeric_signal",
      );
      const noFormula = { signal: base.signal, a: SPEED, ...extra };
      expect((await get(url, noFormula)).body.error.code, url).toBe("invalid_request");
      expect(
        (await get(url, { signal: `testcar/${SPEED}`, formula: "a", ...extra })).body.error.code,
        url,
      ).toBe("invalid_request");
    }
  });

  it("never passes formula text on to the source", async () => {
    calls.length = 0;
    const res = await get("/api/series", {
      ...computed({ formula: "a + 1); DROP TABLE signals --" }),
      ...range,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_formula");
    expect(res.body.error.message).toBe('Unexpected ")" at 6');
    expect(calls).toEqual([]);
  });

  // spec computed-signals "Value and extent"
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
    const extent = await get("/api/extent", computed({ a: SIG_A, b: SPEED }));
    expect(extent.status).toBe(200);
    expect(extent.body).toEqual({
      signalId: "testcar/=c1",
      first: S.toString(),
      last: (T0 + 35_999_995n * MS).toString(),
    });
  });
});

describe("computed signals over a source with the required methods only", () => {
  const A: RawPoint[] = Array.from({ length: 200_001 }, (_, i) => ({ t: BigInt(i), v: 1 }));
  const calls: { name: string; limit: number | undefined }[] = [];
  const adapter: SourceAdapter = {
    info: { kind: "memory", database: "stub", table: "rows" },
    ping: async () => {},
    listSignals: async () => [
      { dataRef: "car", name: "A.X" },
      { dataRef: "car", name: "B.Y" },
    ],
    raw: async (ref, _from, _to, limit) => {
      calls.push({ name: ref.name, limit });
      const all = ref.name === "A.X" ? A : [{ t: 5n, v: 2 }];
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

  // spec data-source "Row cap"
  it("answers computed_too_large from the fallback", async () => {
    const res = await app.inject({
      url: "/api/series",
      query: {
        signal: "car/=c1",
        formula: "a - b",
        a: "A.X",
        b: "B.Y",
        from: "2026-10-01T00:00:00Z",
        to: "2026-10-01T01:00:00Z",
        target: "1000",
      },
    });
    expect(res.statusCode).toBe(422);
    const { error } = res.json();
    expect(error.code).toBe("computed_too_large");
    expect(error.message).toBe("more than 200,000 rows of A.X in this range: zoom in");
    // The fallback read each input once with the bound one row above the cap.
    expect(
      calls
        .filter((c) => c.limit === 200_001)
        .map((c) => c.name)
        .sort(),
    ).toEqual(["A.X", "B.Y"]);
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
        formula: "a - b",
        a: "A.X",
        b: "B.Y",
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
