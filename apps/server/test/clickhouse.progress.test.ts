import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testClient, testSource } from "./testdb.ts";

// A view that reads 1,150 rows at 10 ms each: about 14 s, so ClickHouse sends about 135 progress
// headers (20 KB) before the first body byte, well past Node's default 16 KiB header limit.
const VIEW = `CREATE OR REPLACE VIEW sdlog.slow_signals AS
  SELECT 'slow' AS vehicle, 'S' AS signal, toDateTime64(number, 9, 'UTC') AS utc,
         toFloat64(number) AS value, '' AS text
  FROM numbers(1150) WHERE sleepEachRow(0.01) = 0 SETTINGS max_block_size = 1`;

describe("progress headers of a long query (design D7)", () => {
  const client = testClient();
  beforeAll(() => client.command({ query: VIEW }));
  afterAll(async () => {
    await client.command({ query: "DROP VIEW IF EXISTS sdlog.slow_signals" });
    await client.close();
  });

  it("a query longer than 16 KiB of progress headers completes without Header overflow", async () => {
    const S = 1_000_000_000n;
    const result = await testSource("slow_signals").loggerGaps("slow", S / 2n, S * 2n);
    expect(result).toEqual({ gaps: [], last: 1149n * S });
  }, 25_000);
});
