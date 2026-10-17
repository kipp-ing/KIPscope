import type { EventMapping, TableMapping } from "../src/config.ts";

/** Kusto emulator for the ADX tests (`docker compose --profile adx up -d` + `seed:adx`); never a real cluster. */
export const TEST_ADX_DATABASE = "kipscope_test";

export function testAdxUrl(): string {
  return (process.env.TEST_ADX_URL || "http://127.0.0.1:8125").replace(/\/+$/, "");
}

/** Default ADX layout of design C5. */
export const adxMapping: TableMapping = {
  database: TEST_ADX_DATABASE,
  table: "signals",
  dataRef: "dataref",
  signal: "signal",
  time: "timestamp",
  value: "value",
  text: "text",
};

export const adxEventMapping: EventMapping = {
  table: "events",
  source: "source",
  kind: "kind",
  name: "name",
  value: "value",
  text: "text",
  detail: "detail",
};

/** Kusto management command (v1 REST) on the emulator, for tests that read `.show queries`. */
export async function adxMgmt(csl: string, db = TEST_ADX_DATABASE): Promise<unknown[][]> {
  const response = await fetch(`${testAdxUrl()}/v1/rest/mgmt`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", Accept: "application/json" },
    body: JSON.stringify({ db, csl }),
  });
  if (!response.ok) throw new Error(`${csl}: HTTP ${response.status} ${await response.text()}`);
  const answer = (await response.json()) as { Tables: { Rows: unknown[][] }[] };
  return answer.Tables[0]?.Rows ?? [];
}
