import { AdxSource } from "./adx.ts";
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
    case "adx":
      return new AdxSource(
        new KustoClient({
          cluster: source.cluster,
          database: mapping.database,
          timeoutSeconds: queryTimeoutSeconds,
          // `none`: the loopback emulator, no Authorization header (design C6).
          ...(source.auth === "azcli" ? { token: azCliToken(source.cluster) } : {}),
        }),
        mapping,
        events,
      );
  }
}
