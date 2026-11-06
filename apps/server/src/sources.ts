import { AdxSource } from "./adx.ts";
import { MultiDatabaseSource } from "./adxRouter.ts";
import { azCliToken } from "./azcli.ts";
import { ClickHouseSource, createClickHouseClient } from "./clickhouse.ts";
import type { Config } from "./config.ts";
import type { SourceAdapter } from "./datasource.ts";
import { KustoClient } from "./kusto.ts";

/** The server's one source adapter, by `config.source.kind` (design C3, A-2 (a)). */
export function createAdapter(config: Config): SourceAdapter {
  const { source, mapping, events, queryTimeoutSeconds } = config;
  switch (source.kind) {
    case "clickhouse":
      return new ClickHouseSource(
        createClickHouseClient(source),
        mapping,
        queryTimeoutSeconds,
        events,
      );
    case "adx": {
      // One token provider for the cluster, so all databases share one cached token (design D2).
      // `none`: the loopback emulator, no Authorization header (design C6).
      const auth = source.auth === "azcli" ? { token: azCliToken(source.cluster) } : {};
      const sources = new Map<string, AdxSource>();
      // A hand-built config without the list (tests) reads as the one `mapping.database`.
      const databases = config.databases?.length ? config.databases : [mapping.database];
      for (const database of databases) {
        const own = config.mappings?.get(database) ?? { ...mapping, database };
        const client = new KustoClient({
          cluster: source.cluster,
          database: own.database,
          timeoutSeconds: queryTimeoutSeconds,
          ...auth,
        });
        // The database's own events table from `kipscope.yaml` wins over the shared one (design D3).
        const ownEvents = { ...events, table: own.eventsTable ?? events.table };
        sources.set(database, new AdxSource(client, own, ownEvents));
      }
      const [only] = sources.values();
      // One database: the bare source as before, refs stay bare (design D1, D2).
      if (sources.size === 1 && only) return only;
      return new MultiDatabaseSource(sources);
    }
  }
}
