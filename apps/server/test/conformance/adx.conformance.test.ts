import { AdxSource } from "../../src/adx.ts";
import { KustoClient } from "../../src/kusto.ts";
import { adxEventMapping, adxMapping, TEST_ADX_DATABASE, testAdxUrl } from "../adxdb.ts";
import { describeConformance } from "./suite.ts";

const adapter = (events = adxEventMapping) =>
  new AdxSource(
    new KustoClient({
      cluster: testAdxUrl(),
      database: TEST_ADX_DATABASE,
      timeoutSeconds: 30,
    }),
    adxMapping,
    events,
  );

// Only in vitest.adx.config.ts (`pnpm --filter @kipscope/server test:adx`): needs the Kusto emulator.
describeConformance({
  name: "adx",
  adapter: () => adapter(),
  eventsMissing: () => adapter({ ...adxEventMapping, table: "nope" }),
});
