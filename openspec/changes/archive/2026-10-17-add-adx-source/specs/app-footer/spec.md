## MODIFIED Requirements

### Requirement: Server meta
The server SHALL answer `GET /api/meta` with the `ServerMeta` of design F2: the repo's short git commit at server start (`null` without git) and whether tracked files had uncommitted changes, the start time, the source's kind (the adapter's own kind, `clickhouse` or `adx`), database and table with its reachability, and the catalog's state (`loaded`, `loading`, `failed`), size, load time and, when not loaded, its reason. Origin: Jan („useful meta info"); concept §10 („Fehler … müssen erkennbar bleiben"); kind per source: add-adx-source (data-source "Source selection").

#### Scenario: Reachable source
- **WHEN** the app is built against the test database with a loaded catalog, build info `{commit: "7c1e2a9", dirty: true}` and a ping that resolves, and `GET /api/meta` is sent
- **THEN** the answer is 200 with `build.commit` `7c1e2a9`, `build.dirty` true, `source` `{kind: "clickhouse", database, table}` from the config with `reachable` true and an ISO `checkedAt`, and `catalog.state` `loaded` with `size` equal to `GET /api/catalog`'s item count
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
- **WHEN** the dev server runs from a clean checkout and `curl -s localhost:7310/api/meta | jq -c '[.build.commit, .source.database, .source.reachable, .catalog.state]'` runs
- **THEN** it prints the output of `git rev-parse --short=7 HEAD` and `"sdlog"`, `true`, `"loaded"`
- **Evidence:** the `curl` command (lead, tunnel up)

### Requirement: Automatic meta items
Right of the measurement info the footer SHALL show, per design F3: the data source (`ClickHouse sdlog`, `ADX <database>` for an ADX source, the kind as given for any other kind; ok colour when reachable, `… unreachable` in the error colour when not), the catalog (`<n> signals`, `catalog loading`, `catalog unavailable`), the browser's time zone (`Europe/Berlin`, UTC offset as tooltip) and the build (`7c1e2a9`, `7c1e2a9*` when dirty, none when the commit is `null`). Origin: Jan („useful meta info"); concept §8 (local time display), §10; ADX label: add-adx-source (the one UI change a second source needs).

#### Scenario: Items from meta
- **WHEN** `footerItems` gets a meta with a reachable `clickhouse` source on database `sdlog`, a loaded catalog of 1234 signals, commit `7c1e2a9` dirty, and the zone `Europe/Berlin` at offset +120 min
- **THEN** it returns, in this order, `ClickHouse sdlog` (ok), `1234 signals`, `Europe/Berlin` with a tooltip containing `UTC+02:00`, and `7c1e2a9*` with a tooltip containing `uncommitted changes`
- **Evidence:** `apps/web/test/footer.test.ts` › "turns meta into footer items"

#### Scenario: ADX and other kinds
- **WHEN** `footerItems` gets a reachable source of kind `adx` on database `kipscope_test`, then an unreachable one, then a reachable source of kind `memory` on database `fixture`
- **THEN** the source item reads `ADX kipscope_test` (ok), then `ADX kipscope_test unreachable` (error), then `memory fixture` (ok)
- **Evidence:** `apps/web/test/footer.test.ts` › "labels ADX and unknown source kinds"

#### Scenario: Unhappy states
- **WHEN** `footerItems` gets an unreachable source with error `connect ECONNREFUSED`, a `loading` catalog and commit `null`; then a `failed` catalog
- **THEN** it returns `ClickHouse sdlog unreachable` (error) with the error in its tooltip, `catalog loading` (muted) and no build item; then `catalog unavailable` (error) with the reason as tooltip
- **Evidence:** `apps/web/test/footer.test.ts` › "shows unreachable, loading and failed meta"

#### Scenario: Tunnel drop on real data
- **WHEN** the UI is open on carserver data, the lead stops the tunnel (`scripts/tunnel.sh stop`) and waits 35 s, then starts it and waits 35 s
- **THEN** the source item reads `ClickHouse sdlog unreachable` in the error colour after the first wait and `ClickHouse sdlog` in the ok colour after the second, without a reload
- **Evidence:** lead's manual check (screenshot after each wait)
