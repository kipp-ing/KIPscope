## ADDED Requirements

### Requirement: Catalog loads until it succeeds
While the catalog has never loaded, the server SHALL load it again by itself 1, 2, 4, 8 and 16 s after the first five failures in a row and 30 s after each later one, and SHALL stop once a load succeeds. A later failed refresh SHALL keep the loaded catalog and start no background retry. Origin: D-042 (carserver's 23:00 reboot) and necessary consequence: without it, a start while the tunnel is down answers 503 to every series request until someone posts a refresh. Numbers: design H5.

#### Scenario: Source down at start
- **WHEN** the catalog's source fails its first four loads at once and answers the fifth (fake timers)
- **THEN** the loads start at 0, 1, 3, 7 and 15 s, the catalog has loaded after the fifth, and no further load starts within the next 120 s
- **Evidence:** `apps/server/test/catalog.test.ts` › "keeps loading the catalog with backoff until it succeeds"

#### Scenario: Restart with the tunnel down
- **WHEN** the lead stops the carserver tunnel, restarts the letsview server, and starts the tunnel again 20 s later
- **THEN** within 35 s of the tunnel coming back, `curl -s localhost:7310/api/catalog | jq '.items | length'` prints the signal count, without a manual refresh
- **Evidence:** lead's manual check (command output)

### Requirement: One catalog load at a time
A refresh that starts while a catalog load runs SHALL wait for that load and report its outcome instead of starting a second one. Origin: necessary consequence of the background load (two parallel loads would race to replace the catalog). Design H5.

#### Scenario: Refresh during a load
- **WHEN** a catalog refresh is called twice before the first finishes
- **THEN** the source's signal list is queried once and both calls resolve after it
- **Evidence:** `apps/server/test/catalog.test.ts` › "shares one load between concurrent refreshes"

### Requirement: DBC warnings per load
Each catalog load SHALL log every DBC file it skipped, once per load, for start-up, background and manual (`POST /api/catalog/refresh`) loads alike; warnings of earlier loads SHALL NOT repeat or accumulate. Origin: necessary consequence: today refresh warnings are never logged and the list only grows. Design H5.

#### Scenario: Two loads with one bad file
- **WHEN** a catalog whose metadata loader reports one skipped file per load is refreshed twice
- **THEN** the warning is logged exactly twice, once per load
- **Evidence:** `apps/server/test/catalog.test.ts` › "logs DBC warnings once per load"
