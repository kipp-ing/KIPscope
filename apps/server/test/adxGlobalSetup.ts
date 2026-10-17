import { resolve } from "node:path";
import { REPO_ROOT } from "../src/config.ts";
import { TEST_ADX_DATABASE, testAdxUrl } from "./adxdb.ts";

/**
 * Runs once before the ADX test files: checks that the Kusto emulator answers and holds the seed
 * (`signals` with the 17,082 rows of the conformance fixture and the function `KSignals()`), so a
 * stopped or unseeded emulator fails with one message, not per test.
 */
export default async function setup() {
  try {
    process.loadEnvFile(resolve(REPO_ROOT, ".env"));
  } catch {
    // No .env: the default URL applies.
  }
  const url = testAdxUrl();
  const count = async (csl: string) => {
    const response = await fetch(`${url}/v1/rest/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", Accept: "application/json" },
      body: JSON.stringify({ db: TEST_ADX_DATABASE, csl }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const answer = (await response.json()) as { Tables: { Rows: unknown[][] }[] };
    return Number(answer.Tables[0]?.Rows[0]?.[0]);
  };
  try {
    if ((await count("signals | count")) !== 17_082) throw new Error("stale seed");
    if ((await count("KSignals() | count")) !== 17_082) throw new Error("stale seed");
    if ((await count("events | count")) !== 6) throw new Error("stale seed");
  } catch {
    throw new Error(
      `Kusto emulator at ${url} is not reachable or not seeded: run \`docker compose --profile adx up -d\` and \`pnpm --filter @kipscope/server seed:adx\``,
    );
  }
}
