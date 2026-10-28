/**
 * The scan bound (speed-up-whole-scans B1, B2, scope "Scan bound"): span first, then one shared
 * row count per range. Times in the stubs are by hand: 1 h = 3.6e12 ns.
 */
import { describe, expect, it } from "vitest";
import type { DataSource, Scope } from "../src/datasource.ts";
import { createScanBound, TooWideError } from "../src/scanBound.ts";

const H = 3_600_000_000_000n;
const MIN = 60_000_000_000n;

/** A stub whose `refCount` answers `answer.rows` (or fails once with `answer.fail`) and records its calls. */
function stub() {
  const calls: { dataRef: string; scope: Scope | undefined }[] = [];
  const answer = { rows: 200, fail: false, delayMs: 0 };
  const source: Pick<DataSource, "refCount"> = {
    refCount: async (dataRef, scope) => {
      calls.push({ dataRef, scope });
      if (answer.delayMs > 0) await new Promise((r) => setTimeout(r, answer.delayMs));
      if (answer.fail) {
        answer.fail = false;
        throw new Error("boom");
      }
      return answer.rows;
    },
  };
  return { source, calls, answer };
}

const range = (from: bigint, to: bigint): Scope => ({ dataRef: "car", from, to });

/** The rejection of a promise, or undefined when it resolved. */
async function refusal(promise: Promise<unknown>): Promise<TooWideError | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    if (error instanceof TooWideError) return error;
    throw error;
  }
}

describe("createScanBound", () => {
  it("refuses wide spans without a query and counts each range once", async () => {
    const { source, calls, answer } = stub();
    const bound = createScanBound(source, { rows: 100, spanNs: H });
    expect(bound.rows).toBe(100);
    expect(bound.spanNs).toBe(H);

    // 2 h is above the 1 h span: refused with the span, no count.
    const wide = await refusal(bound.check("car", range(0n, 2n * H)));
    expect(wide).toBeInstanceOf(TooWideError);
    expect(wide?.span).toBe(2n * H);
    expect(wide?.maxSpan).toBe(H);
    expect(wide?.rows).toBeUndefined();
    expect(calls).toHaveLength(0);

    // 1 h is within the span, but 200 rows are over 100: refused with the rows after one count.
    const heavy = await refusal(bound.check("car", range(0n, H)));
    expect(heavy).toBeInstanceOf(TooWideError);
    expect(heavy?.rows).toBe(200);
    expect(heavy?.limit).toBe(100);
    expect(heavy?.span).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ dataRef: "car", scope: range(0n, H) });

    // The same range again: refused from the shared count, no further call.
    const again = await refusal(bound.check("car", range(0n, H)));
    expect(again?.rows).toBe(200);
    expect(calls).toHaveLength(1);

    // Another range with 50 rows passes after one count.
    answer.rows = 50;
    await bound.check("car", range(H, 2n * H));
    expect(calls).toHaveLength(2);
    expect(calls[1]?.scope).toEqual(range(H, 2n * H));
    // ... and its count is shared too.
    expect(await bound.count("car", range(H, 2n * H))).toBe(50);
    expect(calls).toHaveLength(2);
  });

  it("passes at exactly the limit and the span", async () => {
    const { source, answer } = stub();
    answer.rows = 100;
    const bound = createScanBound(source, { rows: 100, spanNs: H });
    await bound.check("car", range(0n, H));
  });

  it("counts a whole data ref without a range", async () => {
    const { source, calls, answer } = stub();
    answer.rows = 5;
    const bound = createScanBound(source, { rows: 100, spanNs: H });
    // No range: the span counts as unbounded, the count alone decides, with no scope argument.
    await bound.check("car");
    expect(calls).toEqual([{ dataRef: "car", scope: undefined }]);
    answer.rows = 500;
    const other = await refusal(bound.check("othercar"));
    expect(other?.rows).toBe(500);
    expect(other?.limit).toBe(100);
    expect(calls.map((c) => c.dataRef)).toEqual(["car", "othercar"]);
    // The count of a whole data ref is its own key, apart from any range.
    await bound.count("car", range(0n, 10n * MIN));
    expect(calls).toHaveLength(3);
  });

  it("shares concurrent checks and does not keep a failure", async () => {
    const { source, calls, answer } = stub();
    answer.rows = 10;
    answer.delayMs = 10;
    const bound = createScanBound(source, { rows: 100, spanNs: H });
    // Three at once: one count (single flight).
    await Promise.all([
      bound.check("car", range(0n, H)),
      bound.check("car", range(0n, H)),
      bound.count("car", range(0n, H)),
    ]);
    expect(calls).toHaveLength(1);

    // A failing count is passed on to everyone waiting and then dropped: the next check asks again.
    answer.fail = true;
    const results = await Promise.allSettled([
      bound.check("car", range(H, 2n * H)),
      bound.check("car", range(H, 2n * H)),
    ]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(calls).toHaveLength(2);
    await bound.check("car", range(H, 2n * H));
    expect(calls).toHaveLength(3);
  });

  it("keeps a count for 5 minutes", async () => {
    const { source, calls, answer } = stub();
    answer.rows = 10;
    let now = 1_000_000;
    const bound = createScanBound(source, { rows: 100, spanNs: H }, () => now);
    await bound.check("car", range(0n, H));
    now += 4 * 60_000 + 59_000;
    await bound.check("car", range(0n, H));
    expect(calls).toHaveLength(1);
    // After 5 min the range is counted again; a live range may have crossed the budget by then.
    now += 2_000;
    answer.rows = 300;
    const late = await refusal(bound.check("car", range(0n, H)));
    expect(late?.rows).toBe(300);
    expect(calls).toHaveLength(2);
  });

  it("keeps at most 256 ranges and drops the least recently used", async () => {
    const { source, calls, answer } = stub();
    answer.rows = 1;
    const bound = createScanBound(source, { rows: 100, spanNs: H });
    // 256 ranges fill it; touching the first makes the second the least recently used.
    for (let i = 0; i < 256; i++)
      await bound.count("car", range(BigInt(i) * MIN, BigInt(i + 1) * MIN));
    expect(calls).toHaveLength(256);
    await bound.count("car", range(0n, MIN));
    expect(calls).toHaveLength(256);
    // A 257th range drops the second one.
    await bound.count("car", range(1000n * MIN, 1001n * MIN));
    expect(calls).toHaveLength(257);
    await bound.count("car", range(0n, MIN));
    expect(calls).toHaveLength(257);
    await bound.count("car", range(MIN, 2n * MIN));
    expect(calls).toHaveLength(258);
  });
});
