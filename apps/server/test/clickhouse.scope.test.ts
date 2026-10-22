import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ClickHouseSource } from "../src/clickhouse.ts";
import type { EventMapping, TableMapping } from "../src/config.ts";
import { SCOPE_S2, SCOPED_CALLS } from "./scopeCalls.ts";

// A client that records every query text and its parameters and answers no rows, so the
// texts are checked without a database (the conformance cases run the real queries).
const mapping: TableMapping = {
  database: "sdlog",
  table: "conf_signals",
  dataRef: "vehicle",
  signal: "signal",
  time: "utc",
  value: "value",
  text: "text",
};
const events: EventMapping = {
  table: "conf_events",
  source: "source",
  kind: "kind",
  name: "name",
  value: "value",
  text: "text",
  detail: "detail",
};

type Recorded = Record<string, { query: string; params: Record<string, string> }[]>;

async function record(scope?: typeof SCOPE_S2): Promise<Recorded> {
  let label = "";
  const recorded: Recorded = {};
  const client = {
    query: async (o: { query: string; query_params?: Record<string, unknown> }) => {
      const list = recorded[label] ?? [];
      recorded[label] = list;
      list.push({
        query: o.query,
        params: Object.fromEntries(
          Object.entries(o.query_params ?? {}).map(([k, v]) => [k, String(v)]),
        ),
      });
      return { json: async () => [] };
    },
  };
  const source = new ClickHouseSource(client as never, mapping, 30, events);
  for (const [name, call] of Object.entries(SCOPED_CALLS)) {
    label = name;
    await call(source, scope);
  }
  return recorded;
}

describe("ClickHouse queries with a scope (add-scope Z3)", () => {
  it("puts the data ref and both time bounds into every scoped query", async () => {
    const recorded = await record(SCOPE_S2);
    // Every method has its queries recorded; the optional ones are native here, except `series`,
    // which ClickHouse takes from the server's fallback (it sends nothing for it).
    expect(Object.keys(recorded).sort()).toEqual(
      Object.keys(SCOPED_CALLS)
        .filter((method) => method !== "series")
        .sort(),
    );
    expect(recorded.series).toBeUndefined();
    const from = String(SCOPE_S2.from);
    const to = String(SCOPE_S2.to);
    for (const [method, queries] of Object.entries(recorded)) {
      expect(queries.length, method).toBeGreaterThan(0);
      for (const { query, params } of queries) {
        const name = (value: string) =>
          Object.entries(params).find(([, v]) => v === value)?.[0] ?? `<no parameter ${value}>`;
        const where = `${method}: ${query}`;
        // The data ref is a bound parameter compared with the data-ref column.
        expect(query, where).toMatch(
          new RegExp(`\\bvehicle\\s*=\\s*\\{${name("conf-a")}:String\\}`),
        );
        // Both bounds are bound parameters: utc >= from and utc < to (not <=).
        expect(query, where).toMatch(
          new RegExp(`\\butc\\s*>=\\s*[\\w]*\\(?\\{${name(from)}:Int64\\}`),
        );
        expect(query, where).toMatch(
          new RegExp(`\\butc\\s*<(?!=)\\s*[\\w]*\\(?\\{${name(to)}:Int64\\}`),
        );
        // Nothing is spliced into the text: no value of the scope appears in it.
        expect(query, where).not.toContain(from);
        expect(query, where).not.toContain(to);
      }
    }
  });

  it("sends the same queries as before for unscoped calls", async () => {
    // fixtures/clickhouse.unscoped.json holds the texts and parameters of the same calls as the
    // adapter sent them before the scope existed (recorded from the commit before add-scope).
    const golden = JSON.parse(
      readFileSync(new URL("./fixtures/clickhouse.unscoped.json", import.meta.url), "utf8"),
    ) as Recorded;
    expect(await record(undefined)).toEqual(golden);
  });

  it("lists the signals of a scope with one grouped query", async () => {
    const recorded = await record(SCOPE_S2);
    expect(recorded.listSignals).toHaveLength(1);
    expect(recorded.listSignals?.[0]?.query).toMatch(/GROUP BY/i);
  });
});
