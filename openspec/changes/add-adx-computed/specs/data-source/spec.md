## MODIFIED Requirements

### Requirement: Computed method in the adapter guide
`docs/data-sources.md` SHALL list `computedSeries` as optional with its fallback, its row cap and the rule that an adapter compiles only the parsed formula, never text. It SHALL name both native implementations: ClickHouse (a window scan) and ADX (one KQL query with `scan`, chunked above 1,000,000 input rows). Origin: data-source "Adapter guide"; D-102; ADX: D-111.

#### Scenario: Guide lists the method
- **WHEN** `grep -n "computedSeries" docs/data-sources.md` runs
- **THEN** it prints at least one line, in the table of optional methods, naming the fallback and `200,000`; that table row's native column names both `ClickHouse` and `ADX`, and its notes name `scan` and `1,000,000`, and no longer read `ADX: fallback`
- **Evidence:** the command
