import { describe, expect, it } from "vitest";
import { decodeTimes, encodeTimes } from "../src/encoding.ts";
import { fromIso, NS_PER_S } from "../src/time.ts";

describe("encodeTimes / decodeTimes", () => {
  it("round-trips nanosecond timestamps over a 10-hour range exactly", () => {
    const start = fromIso("2026-10-14T08:00:00.123456789Z");
    const tenHours = 10n * 3600n * NS_PER_S;
    const times = [start, start + 1n, start + 5_000_001n, start + tenHours - 7n, start + tenHours];
    const encoded = JSON.parse(JSON.stringify(encodeTimes(times)));
    expect(decodeTimes(encoded)).toEqual(times);
    expect(encoded.t0).toBe(start.toString());
  });

  it("allows negative offsets for unsorted input", () => {
    const times = [10n, 3n];
    expect(decodeTimes(encodeTimes(times))).toEqual(times);
  });

  it("encodes an empty list", () => {
    expect(decodeTimes(encodeTimes([]))).toEqual([]);
  });

  it("rejects offsets beyond 2^53 ns", () => {
    expect(() => encodeTimes([0n, 2n ** 53n])).toThrow(RangeError);
    expect(() => decodeTimes({ t0: "0", dt: [0.5] })).toThrow(RangeError);
  });
});
