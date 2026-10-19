# signal-catalog delta

T1 = 2026-10-01T01:00:00Z = `1790816400000000000`, T2 = 02:00:00Z = `1790820000000000000`.

## MODIFIED Requirements

### Requirement: Catalog contents
The catalog SHALL list exactly the signals that have data in the source, per data reference (for vehicle data: the vehicle). Signals that exist only in metadata files SHALL NOT be listed. While the workspace has a scope, the catalog in use SHALL be that scope's list: exactly the signals of the scope's data ref with at least one row in the scope (`listSignals(scope)`), with the same metadata, display names and groups as the full catalog. Origin: concept §4; scope: issue #1 item 2 („The list loads on demand for the active scope"), D-078 („the catalog cover[s] the scope only").

#### Scenario: Signal defined in DBC without data
- **WHEN** a DBC file defines a signal that never occurs in the database
- **THEN** the catalog does not list it

#### Scenario: Signals of a scope
- **WHEN** a stub source holds `testcar/A.X` with rows only before T1, `testcar/B.Y` with rows in [T1, T2), and `othercar/B.Y` with rows in [T1, T2), and a catalog is loaded for scope {testcar, T1, T2}
- **THEN** it lists exactly `testcar/B.Y`, with the DBC unit of `B.Y` when a test DBC defines one, and the stub's `listSignals` got that scope
- **Evidence:** `apps/server/test/catalog.test.ts` › "lists the signals of a scope"

### Requirement: Catalog loads until it succeeds
While a catalog in use has never loaded, the server SHALL load it again by itself 1, 2, 4, 8 and 16 s after the first five failures in a row and 30 s after each later one, and SHALL stop once a load succeeds. A later failed refresh SHALL keep the loaded catalog and start no background retry. In full mode this holds for the full catalog from the start. In both modes it holds for the signal list of a scope restored at start. Origin: D-042 (carserver's 23:00 reboot) and necessary consequence: without it, a start while the tunnel is down answers 503 to every series request until someone posts a refresh. Numbers: design H5. Scoped mode: issue #1 item 2 (no list at start).

#### Scenario: Source down at start
- **WHEN** the catalog's source fails its first four loads at once and answers the fifth (fake timers)
- **THEN** the loads start at 0, 1, 3, 7 and 15 s, the catalog has loaded after the fifth, and no further load starts within the next 120 s
- **Evidence:** `apps/server/test/catalog.test.ts` › "keeps loading the catalog with backoff until it succeeds"

#### Scenario: Restart with the tunnel down
- **WHEN** the lead stops the carserver tunnel, restarts the KIPscope server, and starts the tunnel again 20 s later
- **THEN** within 35 s of the tunnel coming back, `curl -s localhost:7310/api/catalog | jq '.items | length'` prints the signal count, without a manual refresh
- **Evidence:** lead's manual check (command output)

#### Scenario: Restored scope in scoped mode
- **WHEN** a test server in scoped mode starts from a state file whose workspace has scope {testcar, T1, T2}, and its recording source fails `listSignals` twice and then answers (fake timers)
- **THEN** the source gets `listSignals` with that scope at 0, 1 and 3 s and never without a scope, and `GET /api/catalog` then answers 200 with `scope` {testcar, T1, T2}
- **Evidence:** `apps/server/test/scope.http.test.ts` › "keeps the restored scope's list loaded"

## ADDED Requirements

### Requirement: Explorer follows the scope
The explorer SHALL load the catalog again whenever the workspace's scope changes (`scopeKey`), and SHALL drop an answer whose `scope` is not the current one. In scoped mode without a scope it SHALL show `No scope set. Open a view link or run kipscope scope set REF FROM TO.` instead of the list and SHALL not retry until the scope changes. Origin: necessary consequence of "Catalog contents" (the browser holds the list, signal-catalog design E3); issue #1 item 2.

#### Scenario: Reload on scope change
- **WHEN** the explorer's loader is fed the scopes "", then {testcar, T1, T2}, then the same again, then {testcar, T1 − 1 h, T2 + 1 h}, and the answer for the second scope arrives after the third scope was set
- **THEN** it fetches the catalog three times (no fetch for the repeated scope) and shows only the third answer
- **Evidence:** `apps/web/test/explorer.test.ts` › "reloads the catalog when the scope changes"

#### Scenario: No scope in the UI
- **WHEN** the dev server runs a second instance with `KIPSCOPE_CATALOG=scoped` and no state file, the UI is opened against it, and then `kipscope scope set smart451 "2026-10-13 14:00" "2026-10-13 16:00"` runs
- **THEN** the explorer first shows the "No scope set" text, then, without a reload, the scope's signals; searching `volt` finds `DCU_1F4h.COMP_HV_Volt`
- **Evidence:** UI check (two screenshots of the explorer)

### Requirement: Footer count follows the scope
The footer's catalog count SHALL show the size of the catalog in use and SHALL be fetched again (`/api/meta`) whenever the workspace's scope key changes (Widen, Clear, open, `scope set`), not on a re-render with the same key. Origin: necessary consequence of "Catalog contents" (the catalog in use is the scope's list, D-078) and of the footer showing that catalog's size; finding of round 2 (stale footer count).

#### Scenario: Footer count follows the scope
- **WHEN** the meta loader runs on mount (answer size 2,300), the scope key is fed again unchanged, then changed to a wider scope (answer 9,100), then cleared (answer mode `full`, size 120,000)
- **THEN** the unchanged key fetches nothing, each change fetches once, and the footer state holds 2,300, then 9,100, then `full` with 120,000; in the UI on smart451 the footer count changes with each scope change without a page reload (follow-up round 1 saw 415, 551, 553, 415)
- **Evidence:** `apps/web/test/rescope.test.ts` › "footer count follows the scope"; UI check on smart451 (footer count after each step)
