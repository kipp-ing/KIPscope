import { describe, expect, it } from "vitest";
import { clampToScope, scopeKey, widenScope } from "../src/scope.ts";
import { TIME_MIN } from "../src/time.ts";
import { type ViewDoc, viewScope } from "../src/views.ts";
import type { WorkspaceScope } from "../src/workspace.ts";

const MIN = 60n * 1_000_000_000n;
const H = 60n * MIN;
/** 2026-10-01T01:00:00Z and 02:00:00Z in ns, by hand (1790816400 s and 1790820000 s). */
const T1 = 1790816400000000000n;
const T2 = 1790820000000000000n;

const range = (from: bigint, to: bigint) => ({ from: from.toString(), to: to.toString() });
const scopeOf = (dataRef: string, from: bigint, to: bigint): WorkspaceScope => ({
  dataRef,
  ...range(from, to),
});

describe("scope helpers (add-scope)", () => {
  it("clamps a range into the scope keeping its span", () => {
    const scope = scopeOf("testcar", 100n, 200n);
    const clamp = (f: bigint, t: bigint) => clampToScope(range(f, t), scope);
    expect(clamp(120n, 150n)).toEqual({ range: range(120n, 150n), clamped: false });
    expect(clamp(80n, 110n)).toEqual({ range: range(100n, 130n), clamped: true });
    // Span 40 kept at the end edge: [200 - 40, 200). (The scenario text says [170, 200), which has
    // span 30; design Z6's rule `t > T gives [T - s, T)` and "span kept" give [160, 200).)
    expect(clamp(190n, 230n)).toEqual({ range: range(160n, 200n), clamped: true });
    expect(clamp(50n, 250n)).toEqual({ range: range(100n, 200n), clamped: true });
    expect(clamp(100n, 200n)).toEqual({ range: range(100n, 200n), clamped: false });
  });

  it("widens by one span on each side", () => {
    const first = widenScope(scopeOf("testcar", T1, T2));
    expect(first).toEqual(scopeOf("testcar", T1 - H, T2 + H));
    // The span is now 3 h, so the next step adds 3 h on each side: 2 h, 6 h, 18 h, 54 h.
    const second = widenScope(first);
    expect(second).toEqual(scopeOf("testcar", T1 - 4n * H, T2 + 4n * H));
    // 1900-01-01T00:00:00Z is the lower time bound: the start stays there.
    const atBound = widenScope(scopeOf("testcar", TIME_MIN, TIME_MIN + H));
    expect(atBound.from).toBe("-2208988800000000000");
    expect(atBound.from).toBe(TIME_MIN.toString());
    expect(atBound.to).toBe((TIME_MIN + 2n * H).toString());
    expect(atBound.dataRef).toBe("testcar");
  });

  it("keys a scope by data ref and both times, empty without one", () => {
    expect(scopeKey(undefined)).toBe("");
    expect(scopeKey(scopeOf("testcar", T1, T2))).toBe(`testcar|${T1}|${T2}`);
    expect(scopeKey(scopeOf("testcar", T1, T2))).not.toBe(
      scopeKey(scopeOf("testcar", T1, T2 + 1n)),
    );
    expect(scopeKey(scopeOf("testcar", T1, T2))).not.toBe(scopeKey(scopeOf("othercar", T1, T2)));
  });
});

describe("scope of a view (add-scope Z8)", () => {
  const iso = (t: bigint) => new Date(Number(t / 1_000_000n)).toISOString().replace(".000Z", "Z");
  const ts = (signals: string[], from: bigint, to: bigint): ViewDoc["windows"][number] => ({
    kind: "timeseries",
    from: iso(from),
    to: iso(to),
    mode: "line",
    envelope: false,
    signals,
  });
  const doc = (windows: ViewDoc["windows"], over: Partial<ViewDoc> = {}): ViewDoc => ({
    kipscope: "view",
    version: 1,
    title: "T",
    data: [],
    linkTime: true,
    cursors: { diff: false },
    digits: 3,
    windows,
    ...over,
  });
  const PAD = H;

  it("derives the scope of a view", () => {
    // The union of both windows and the cursor, one hour of pad on each side; a cursor counts as
    // [t, t + 1 ns).
    const a = doc(
      [
        ts(["testcar/Fast_100h.SIG_A"], T1, T1 + 10n * MIN),
        ts(["testcar/Fast_100h.SIG_B"], T1 + 30n * MIN, T1 + 40n * MIN),
      ],
      { cursors: { a: iso(T1 + 50n * MIN), diff: false } },
    );
    expect(viewScope(a, PAD)).toEqual(scopeOf("testcar", T1 - H, T1 + 50n * MIN + 1n + H));

    // The first signal of the first window decides the data ref.
    const b = doc([
      ts(["othercar/X.Y"], T1, T1 + 10n * MIN),
      ts(["testcar/X.Y"], T1, T1 + 10n * MIN),
    ]);
    expect(viewScope(b, PAD)?.dataRef).toBe("othercar");

    // Only a values window and no cursor: no time, no scope.
    const c = doc([{ kind: "values", mode: "line", signals: ["testcar/X.Y"] }]);
    expect(viewScope(c, PAD)).toBeUndefined();

    // An explicit scope of the document is used as written, without pad.
    const d = doc([ts(["testcar/X.Y"], T1 + 10n * MIN, T1 + 20n * MIN)], {
      scope: { dataRef: "testcar", from: "2026-10-01T01:00:00Z", to: "2026-10-01T02:00:00Z" },
    });
    expect(viewScope(d, PAD)).toEqual(scopeOf("testcar", T1, T2));
  });

  it("derives no scope without a signal", () => {
    expect(viewScope(doc([ts([], T1, T1 + MIN)]), PAD)).toBeUndefined();
  });

  it("takes the data ref of the events-line signals when no window has a signal", () => {
    const d = doc([ts([], T1, T1 + MIN)], { events: { signals: ["testcar/Ign_A20h.MODE"] } });
    expect(viewScope(d, 0n)).toEqual(scopeOf("testcar", T1, T1 + MIN));
  });

  it("clamps the padded scope to the time bounds", () => {
    const d = doc([ts(["testcar/X.Y"], TIME_MIN + MIN, TIME_MIN + 2n * MIN)]);
    expect(viewScope(d, PAD)?.from).toBe(TIME_MIN.toString());
  });
});
