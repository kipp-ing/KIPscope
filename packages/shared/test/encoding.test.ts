import { describe, expect, it } from "vitest";
import { decodeTimes, encodeTimes } from "../src/encoding.ts";
import { fromIso, NS_PER_S, TIME_MAX, TIME_MIN } from "../src/time.ts";

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

  it("round-trips times across the full time bounds", () => {
    const times = [TIME_MIN, TIME_MIN + 1n, 0n, TIME_MAX - 1n, TIME_MAX];
    const encoded = JSON.parse(JSON.stringify(encodeTimes(times)));
    expect(decodeTimes(encoded)).toEqual(times);
    // Offsets are numbers up to 2^53 - 1 ns and decimal strings beyond, by that rule alone.
    const limit = 2n ** 53n - 1n;
    const t0 = BigInt(encoded.t0);
    encoded.dt.forEach((dt: number | string, i: number) => {
      const offset = (times[i] as bigint) - t0;
      const small = offset <= limit && offset >= -limit;
      expect(typeof dt).toBe(small ? "number" : "string");
      expect(String(dt)).toBe(offset.toString());
    });
    // At least the far end really travels as strings.
    expect(encoded.dt.some((dt: unknown) => typeof dt === "string")).toBe(true);
    expect(encoded.dt.some((dt: unknown) => typeof dt === "number")).toBe(true);
  });

  it("rejects malformed offsets", () => {
    for (const bad of [0.5, 2 ** 53, "1e3", "abc"]) {
      expect(() => decodeTimes({ t0: "0", dt: [bad] }), String(bad)).toThrow(RangeError);
    }
  });
});
