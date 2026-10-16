import { resolve } from "node:path";
import { createClient } from "@clickhouse/client";
import { REPO_ROOT } from "../src/config.ts";

/**
 * Runs once before all test files: checks that the test ClickHouse answers and holds the seed
 * (`drivecar/Drv_A10h.WAKE`, the newest seed data), so a stopped or stale database fails with one message, not per test.
 */
export default async function setup() {
  try {
    process.loadEnvFile(resolve(REPO_ROOT, ".env"));
  } catch {
    // No .env: the defaults below apply, as in testdb.ts.
  }
  const url = process.env.TEST_CLICKHOUSE_URL || "http://localhost:8124";
  const client = createClient({
    url,
    username: process.env.TEST_CLICKHOUSE_USER || "kipscope",
    password: process.env.TEST_CLICKHOUSE_PASSWORD ?? "kipscope",
    request_timeout: 5000,
  });
  try {
    const result = await client.query({
      query:
        "SELECT count() FROM sdlog.signals WHERE vehicle = 'drivecar' AND signal = 'Drv_A10h.WAKE'",
      format: "TabSeparated",
    });
    if (Number((await result.text()).trim()) < 1) throw new Error("not seeded");
  } catch {
    throw new Error(
      `test ClickHouse at ${url} is not reachable or not seeded: run \`docker compose up -d\` and \`pnpm --filter @kipscope/server seed:test\``,
    );
  } finally {
    await client.close().catch(() => undefined);
  }
}
