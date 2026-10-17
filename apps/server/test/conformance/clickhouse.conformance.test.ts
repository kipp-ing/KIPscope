import { ClickHouseSource } from "../../src/clickhouse.ts";
import { testClient, testEventMapping, testMapping } from "../testdb.ts";
import { describeConformance } from "./suite.ts";

const signals = { ...testMapping, table: "conf_signals" };

describeConformance({
  name: "clickhouse",
  adapter: () =>
    new ClickHouseSource(testClient(), signals, 30, { ...testEventMapping, table: "conf_events" }),
  eventsMissing: () =>
    new ClickHouseSource(testClient(), signals, 30, { ...testEventMapping, table: "nope" }),
});
