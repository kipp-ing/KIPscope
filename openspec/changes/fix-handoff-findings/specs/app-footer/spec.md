## MODIFIED Requirements

### Requirement: Server meta
The server SHALL answer `GET /api/meta` with the `ServerMeta` of design F2: the repo's short git commit at server start (`null` without git) and whether tracked files had uncommitted changes, the start time, the source's kind (the adapter's own kind, `clickhouse` or `adx`), database and table with its reachability and whether it has an events table (`events`, events "Events table in meta"), and the catalog's state (`loaded`, `loading`, `failed`), size, load time and, when not loaded, its reason. Origin: Jan („useful meta info"); concept §10 („Fehler … müssen erkennbar bleiben"); kind per source: add-adx-source (data-source "Source selection"); `events`: finder finding (issue #1, comment 2026-10-21).

#### Scenario: Reachable source
- **WHEN** the app is built against the test database with a loaded catalog, build info `{commit: "7c1e2a9", dirty: true}` and a ping that resolves, and `GET /api/meta` is sent
- **THEN** the answer is 200 with `build.commit` `7c1e2a9`, `build.dirty` true, `source` `{kind: "clickhouse", database, table}` from the config with `reachable` true, an ISO `checkedAt` and `events` one of `table`, `none`, `unknown`, and `catalog.state` `loaded` with `size` equal to `GET /api/catalog`'s item count
- **Evidence:** `apps/server/test/meta.http.test.ts` › "reports build, source and catalog"

#### Scenario: ADX source
- **WHEN** the app is built with an ADX adapter on the emulator (database `kipscope_test`, default layout) and `GET /api/meta` is sent
- **THEN** `source` is `{kind: "adx", database: "kipscope_test", table: "signals"}` with `reachable` true, and the answer contains neither the cluster URL nor any token
- **Evidence:** `apps/server/test/adx.test.ts` › "reports the ADX source in meta"

#### Scenario: Catalog not loaded
- **WHEN** `GET /api/meta` is sent before the first catalog load finished, and again after a load failed
- **THEN** `catalog.state` is `loading`, then `failed`, `size` 0, and `reason` equals the catalog's `unavailableReason`
- **Evidence:** `apps/server/test/meta.http.test.ts` › "reports a catalog that has not loaded"

#### Scenario: Build info
- **WHEN** `readBuildInfo` runs with a git runner that prints `7c1e2a9` for `rev-parse` and ` M apps/web/src/App.tsx` for `status`, with one that prints nothing for `status`, and with one that throws
- **THEN** it returns commit `7c1e2a9` dirty true, commit `7c1e2a9` dirty false, and commit `null` dirty false
- **Evidence:** `apps/server/test/meta.http.test.ts` › "reads the commit and the dirty flag from git"

#### Scenario: Real server
- **WHEN** the dev server runs from a clean checkout and `curl -s localhost:7310/api/meta | jq -c '[.build.commit, .source.database, .source.reachable, .catalog.state, .source.events]'` runs
- **THEN** it prints the output of `git rev-parse --short=7 HEAD` and `"sdlog"`, `true`, `"loaded"`, `"table"`
- **Evidence:** the `curl` command (lead, tunnel up)
