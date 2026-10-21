import { describe, expect, it } from "vitest";
import { trimCases } from "../src/caseTrim.ts";

/** L(n) of case-handoff "Balanced trim": sessions c0 … c<n−1>, an origin, a pad and an unknown key. */
interface Doc {
  cases: { id: string }[];
  current?: number;
  origin: { tool: string };
  pad: string;
  x: number;
}
const L = (n: number, current?: number): Doc => ({
  cases: Array.from({ length: n }, (_, i) => ({ id: `c${i}` })),
  ...(current === undefined ? {} : { current }),
  origin: { tool: "t" },
  pad: "60s",
  x: 1,
});
/** The spec's encoder: one character per session. */
const counting = () => {
  const calls = { n: 0 };
  const encode = (doc: Doc) => {
    calls.n++;
    return "x".repeat(doc.cases.length);
  };
  return { calls, encode };
};
const ids = (doc: Doc) => doc.cases.map((c) => c.id);
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `c${from + i}`);

describe("balanced trim (fix-handoff-findings X1)", () => {
  it("keeps the short side", async () => {
    const { calls, encode } = counting();
    const input = { ...L(3540), current: 2 };
    const out = await trimCases(input, { maxChars: 213, encode });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // Both predecessors stay although the long side is cut: c0 … c212 are 213 sessions.
    expect(ids(out.doc)).toEqual(range(0, 212));
    expect(out.doc.current).toBe(2);
    expect(out.dropped).toEqual({ before: 0, after: 3327 });
    expect(out.doc.origin).toEqual({ tool: "t" });
    expect(out.doc.pad).toBe("60s");
    expect(out.doc.x).toBe(1);
    expect(out.text).toBe("x".repeat(213));
    expect(calls.n).toBeLessThanOrEqual(14);
    // The input is not changed.
    expect(input.cases).toHaveLength(3540);
  });

  it("drops the side before on a tie", async () => {
    const a = await trimCases({ ...L(5), current: 2 }, { maxChars: 3, encode: counting().encode });
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(ids(a.doc)).toEqual(["c1", "c2", "c3"]);
      expect(a.doc.current).toBe(1);
      expect(a.dropped).toEqual({ before: 1, after: 1 });
    }
    const b = await trimCases({ ...L(10), current: 5 }, { maxChars: 5, encode: counting().encode });
    expect(b.ok).toBe(true);
    if (b.ok) {
      expect(ids(b.doc)).toEqual(range(3, 7));
      expect(b.doc.current).toBe(2);
      expect(b.dropped).toEqual({ before: 3, after: 2 });
    }
  });

  it("trims with current at either edge", async () => {
    const first = await trimCases(
      { ...L(10), current: 0 },
      { maxChars: 4, encode: counting().encode },
    );
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(ids(first.doc)).toEqual(range(0, 3));
      expect(first.doc.current).toBe(0);
      expect(first.dropped).toEqual({ before: 0, after: 6 });
    }
    const last = await trimCases(
      { ...L(10), current: 9 },
      { maxChars: 4, encode: counting().encode },
    );
    expect(last.ok).toBe(true);
    if (last.ok) {
      expect(ids(last.doc)).toEqual(range(6, 9));
      expect(last.doc.current).toBe(3);
      expect(last.dropped).toEqual({ before: 6, after: 0 });
    }
  });

  it("leaves a fitting catalog alone and refuses one that cannot fit", async () => {
    const input = { ...L(10), current: 4 };
    const fits = await trimCases(input, { maxChars: 10, encode: counting().encode });
    expect(fits.ok).toBe(true);
    if (fits.ok) {
      expect(fits.doc).toBe(input);
      expect(fits.dropped).toEqual({ before: 0, after: 0 });
      expect(fits.text).toHaveLength(10);
    }
    const never = await trimCases(input, { maxChars: 0, encode: counting().encode });
    expect(never).toEqual({ ok: false, code: "link_too_long", chars: 1 });
  });

  it("accepts an async encoder and a missing current as 0", async () => {
    const out = await trimCases(L(10), {
      maxChars: 2,
      encode: async (doc) => "x".repeat(doc.cases.length),
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(ids(out.doc)).toEqual(["c0", "c1"]);
      expect(out.doc.current).toBe(0);
    }
  });

  it("throws a RangeError for no sessions or a current outside them", async () => {
    const options = { maxChars: 10, encode: counting().encode };
    await expect(trimCases(L(0), options)).rejects.toThrow(RangeError);
    await expect(trimCases({ ...L(3), current: 3 }, options)).rejects.toThrow(RangeError);
    await expect(trimCases({ ...L(3), current: -1 }, options)).rejects.toThrow(RangeError);
    await expect(trimCases({ ...L(3), current: 1.5 }, options)).rejects.toThrow(RangeError);
  });
});
