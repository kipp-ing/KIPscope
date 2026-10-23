## MODIFIED Requirements

### Requirement: Catalog loads until it succeeds
While a catalog in use has never loaded, the server SHALL load it again by itself 1, 2, 4, 8 and 16 s after the first five failures in a row and 30 s after each later one, and SHALL stop once a load succeeds. A later failed refresh SHALL keep the loaded catalog and start no background retry. In full mode this holds for the full catalog from the start. In both modes it holds for the signal list of the scope of every workspace with a live client, from the moment the first client connects or the scope changes; no scope list SHALL load at start. Origin: D-042 (carserver's 23:00 reboot) and necessary consequence: without it, a start while the tunnel is down answers 503 to every series request until someone posts a refresh. Numbers: design H5. Scoped mode: the ADX feedback item 2 (no list at start). Open workspaces instead of one restored scope: necessary consequence of many workspaces (thousands of stored workspaces must not load their lists at start).

#### Scenario: Source down at start
- **WHEN** the catalog's source fails its first four loads at once and answers the fifth (fake timers)
- **THEN** the loads start at 0, 1, 3, 7 and 15 s, the catalog has loaded after the fifth, and no further load starts within the next 120 s
- **Evidence:** `apps/server/test/catalog.test.ts` › "keeps loading the catalog with backoff until it succeeds"

#### Scenario: Restart with the tunnel down
- **WHEN** the lead stops the carserver tunnel, restarts the KIPscope server, and starts the tunnel again 20 s later
- **THEN** within 35 s of the tunnel coming back, `curl -s localhost:7310/api/catalog | jq '.items | length'` prints the signal count, without a manual refresh
- **Evidence:** lead's manual check (command output)

#### Scenario: Restored scope in scoped mode
- **WHEN** a test server in scoped mode starts from two workspace files with scopes {testcar, T1, T2} and {othercar, T1, T2}, waits 5 s, then a live client connects to the first workspace while its recording source fails `listSignals` twice and then answers (fake timers)
- **THEN** no `listSignals` runs during the first 5 s; after the connect the source gets `listSignals` with {testcar, T1, T2} at 0, 1 and 3 s and never without a scope or with othercar's scope, and `GET /api/w/<first>/catalog` then answers 200 with `scope` {testcar, T1, T2}
- **Evidence:** `apps/server/test/scope.http.test.ts` › "keeps an open workspace's scope list loaded"
