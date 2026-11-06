/**
 * The two-server check of add-adx-databases 4.4, in process on the Kusto emulator (needs `seed:adx`:
 * `kipscope_test` and `kipscope_test2` both hold the conformance fixture): the config, `createAdapter`
 * and the app are wired as `main.ts` wires them, no server process. One config reads
 * `KIPSCOPE_ADX_DATABASES=kipscope_test,kipscope_test2`, the other `KIPSCOPE_ADX_DATABASE=kipscope_test`.
 * Expected values come from the fixture definition (conformance/fixture.ts), never from the code.
 */
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";
import { createAdapter } from "../src/sources.ts";
import { TEST_ADX_DATABASE, testAdxUrl } from "./adxdb.ts";
import { type ScopeApp, scopeApp } from "./scopeApp.ts";

const SECOND = "kipscope_test2";
// B = 2026-10-05T00:00:00Z; the scope covers the first 10 min, where all six conf-a signals have rows.
const FROM = "2026-10-05T00:00:00Z";
const TO = "2026-10-05T00:10:00Z";
// Lin.RAMP: value 100 + n 10 ms steps in [B + 1 s, B + 2 s): 100 … 199 (fixture C7).
const RAMP_VALUES = Array.from({ length: 100 }, (_, i) => 100 + i);
const CONF_A = ["Beat.HB", "Diag.door", "Fine.NS", "Lin.RAMP", "Sna.CODE", "State.MODE"];

const env = (databases: Record<string, string>) => ({
  KIPSCOPE_SOURCE: "adx",
  KIPSCOPE_ADX_CLUSTER: testAdxUrl(),
  KIPSCOPE_ADX_AUTH: "none",
  ...databases,
});

const apps: ScopeApp[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

async function start(databases: Record<string, string>) {
  const adapter = createAdapter(loadConfig(env(databases), "/repo/kipscope"));
  const t = await scopeApp({ adapter, mode: "scoped" });
  apps.push(t);
  return t;
}
const scopeTo = (t: ScopeApp, dataRef: string) =>
  t.command({ type: "scope.set", dataRef, from: FROM, to: TO });
const idsOf = async (t: ScopeApp): Promise<string[]> =>
  ((await t.get("/api/signals?q=")).body.items as { id: string }[]).map((i) => i.id).sort();
const rampOf = async (t: ScopeApp, dataRef: string) => {
  const res = await t.get(
    `/api/series?signal=${dataRef}/Lin.RAMP&from=2026-10-05T00:00:01Z&to=2026-10-05T00:00:02Z&target=1000`,
  );
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
};

describe("two databases on the emulator (4.4)", () => {
  it("opens a scope a:<ref>, shows the databases and lists signals", async () => {
    const t = await start({ KIPSCOPE_ADX_DATABASES: `${TEST_ADX_DATABASE},${SECOND}` });
    const meta = (await t.get("/api/meta")).body;
    expect(meta.source).toMatchObject({
      kind: "adx",
      database: `${TEST_ADX_DATABASE}, ${SECOND}`,
      databases: [TEST_ADX_DATABASE, SECOND],
      reachable: true,
    });

    for (const db of [TEST_ADX_DATABASE, SECOND]) {
      const set = await scopeTo(t, `${db}:conf-a`);
      expect(set.status, JSON.stringify(set.body)).toBe(200);
      // Only this database's six conf-a signals, under qualified IDs.
      expect(await idsOf(t)).toEqual(CONF_A.map((n) => `${db}:conf-a/${n}`).sort());
      const ramp = await rampOf(t, `${db}:conf-a`);
      expect(ramp.kind).toBe("raw");
      expect(ramp.v).toEqual(RAMP_VALUES);
    }

    // A bare ref names no database: refused, nothing is set.
    const bare = await scopeTo(t, "conf-a");
    expect(bare.status).toBeGreaterThanOrEqual(400);
    expect(bare.body.ok).toBe(false);
  });

  it("keeps one database as before", async () => {
    const t = await start({ KIPSCOPE_ADX_DATABASE: TEST_ADX_DATABASE });
    const meta = (await t.get("/api/meta")).body;
    expect(meta.source).toMatchObject({
      kind: "adx",
      database: TEST_ADX_DATABASE,
      databases: [TEST_ADX_DATABASE],
      reachable: true,
    });
    // Bare refs: the scope, the IDs and the series are exactly those of before this change.
    const set = await scopeTo(t, "conf-a");
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(await idsOf(t)).toEqual(CONF_A.map((n) => `conf-a/${n}`).sort());
    expect((await rampOf(t, "conf-a")).v).toEqual(RAMP_VALUES);
    // A qualified ref is a data ref that does not exist in the table: no signals.
    const qualified = await scopeTo(t, `${TEST_ADX_DATABASE}:conf-a`);
    if (qualified.status === 200) expect(await idsOf(t)).toEqual([]);
  });
});
