import { fromIso, NS_PER_MS } from "@letsview/shared";
import { describe, expect, it } from "vitest";
import {
  clampRange,
  extentRange,
  historyKey,
  ZOOM_HISTORY_LIMIT,
  ZoomHistory,
} from "../src/chart/zoom.ts";

const MIN = -2_208_988_800_000_000_000n; // 1900-01-01T00:00:00Z
const MAX = 9_223_286_400_000_000_000n; // 2262-04-11T00:00:00Z

describe("clampRange", () => {
  it("clamps ranges into the time bounds", () => {
    const inside = { from: 1000n, to: 5000n };
    expect(clampRange(inside)).toEqual(inside);
    expect(clampRange({ from: MIN, to: MAX })).toEqual({ from: MIN, to: MAX });
    // Shifted back in, span kept.
    expect(clampRange({ from: MIN - 1000n, to: MIN + 9000n })).toEqual({
      from: MIN,
      to: MIN + 10_000n,
    });
    expect(clampRange({ from: MAX - 9000n, to: MAX + 1000n })).toEqual({
      from: MAX - 10_000n,
      to: MAX,
    });
    // Wider than the bounds: the bounds.
    expect(clampRange({ from: MIN * 2n, to: MAX })).toEqual({ from: MIN, to: MAX });
    // The live bug values from window w23.
    expect(
      clampRange({ from: -29_473_328_485_867_940_608n, to: 62_083_631_947_910_636_800n }),
    ).toEqual({ from: MIN, to: MAX });
    // 40 doublings of a day never leave the bounds.
    let r = {
      from: 1_791_800_000_000_000_000n,
      to: 1_791_800_000_000_000_000n + 86_400_000_000_000n,
    };
    for (let i = 0; i < 40; i++) {
      const mid = (r.from + r.to) / 2n;
      const span = r.to - r.from;
      r = clampRange({ from: mid - span, to: mid + span });
      expect(r.from >= MIN && r.to <= MAX).toBe(true);
    }
  });
});

describe("extentRange", () => {
  it("computes the extent range rounded up to the next millisecond", () => {
    const first = fromIso("2026-10-11T12:34:24.824Z");
    const last = fromIso("2026-10-13T13:17:33.2204Z"); // 33.220400 s
    const r = extentRange([{ first: first.toString(), last: last.toString() }]);
    expect(r).toEqual({ from: first, to: fromIso("2026-10-13T13:17:33.221Z") });
    // A last point exactly on a millisecond ends one millisecond later (half-open).
    const exact = fromIso("2026-10-13T13:17:33.221Z");
    expect(extentRange([{ first: "0", last: exact.toString() }])?.to).toBe(exact + NS_PER_MS);
    // Union of several signals: earliest first, latest last.
    const union = extentRange([
      { first: "5000000", last: "9000000" },
      { first: "1000000", last: "6000000" },
    ]);
    expect(union).toEqual({ from: 1_000_000n, to: 10_000_000n });
    expect(extentRange([])).toBeUndefined();
  });
});

describe("ZoomHistory", () => {
  const r = (n: number) => ({ from: BigInt(n), to: BigInt(n) + 10n });

  it("keeps a bounded zoom history", () => {
    const h = new ZoomHistory(3);
    expect(h.back()).toBeUndefined();
    for (const n of [1, 2, 3, 4]) h.push(r(n));
    expect(h.size).toBe(3);
    expect([h.back(), h.back(), h.back(), h.back()]).toEqual([r(4), r(3), r(2), undefined]);
    // The same range twice in a row is recorded once.
    h.push(r(7));
    h.push(r(7));
    expect(h.size).toBe(1);
    // Default limit: 50 steps.
    expect(ZOOM_HISTORY_LIMIT).toBe(50);
    const big = new ZoomHistory();
    for (let n = 0; n < 60; n++) big.push(r(n));
    expect(big.size).toBe(50);
    expect(big.back()).toEqual(r(59));
  });

  it("shares one history while linked", () => {
    expect(historyKey(true, "w1")).toBe(historyKey(true, "w2"));
    expect(historyKey(false, "w1")).not.toBe(historyKey(false, "w2"));
    expect(historyKey(false, "w1")).not.toBe(historyKey(true, "w1"));
    const histories = new Map<string, ZoomHistory>();
    const get = (linked: boolean, id: string) => {
      const k = historyKey(linked, id);
      const h = histories.get(k) ?? new ZoomHistory();
      histories.set(k, h);
      return h;
    };
    get(true, "w1").push(r(1));
    expect(get(true, "w2").back()).toEqual(r(1));
    get(false, "w1").push(r(2));
    expect(get(false, "w2").back()).toBeUndefined();
    expect(get(false, "w1").back()).toEqual(r(2));
  });
});
