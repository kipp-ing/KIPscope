import { parseTimestamp, type Timestamp } from "./time.ts";

/**
 * Timestamps on the wire: `t0` as decimal nanoseconds plus per-point offsets in nanoseconds as
 * JSON numbers (design D3). Offsets are exact up to 2^53 ns (~104 days).
 */
export interface EncodedTimes {
  t0: string;
  dt: number[];
}

const MAX_OFFSET = BigInt(Number.MAX_SAFE_INTEGER);

export function encodeTimes(times: readonly Timestamp[]): EncodedTimes {
  const t0 = times[0] ?? 0n;
  const dt = times.map((t) => {
    const offset = t - t0;
    if (offset > MAX_OFFSET || offset < -MAX_OFFSET) {
      throw new RangeError(`time offset ${offset} ns exceeds exact float range`);
    }
    return Number(offset);
  });
  return { t0: t0.toString(), dt };
}

export function decodeTimes(encoded: EncodedTimes): Timestamp[] {
  const t0 = parseTimestamp(encoded.t0);
  return encoded.dt.map((offset) => {
    if (!Number.isSafeInteger(offset)) throw new RangeError(`invalid time offset: ${offset}`);
    return t0 + BigInt(offset);
  });
}
