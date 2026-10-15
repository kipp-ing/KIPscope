# Spec Delta

Base: the main spec after `add-cursors` is archived. This delta touches only "Render acknowledgement", which `add-cursors` leaves unchanged.

## MODIFIED Requirements

### Requirement: Render acknowledgement
Connected browsers SHALL report the highest revision they have fully rendered, including whether its data loaded, also for revisions that change nothing visible. `GET /api/render-status` SHALL return the current revision and every browser whose live connection is open: client ID, connection time and its last acknowledgement (revision, `complete` or `error`, errors, time). Acknowledgements above the current revision SHALL be ignored. Origin: D-005, D-011 (D8); concept §7 (CLI wait).

#### Scenario: Rendered after load
- **WHEN** a command adds a signal and the browser has loaded its data and drawn it
- **THEN** the server reports that revision as rendered with data complete
- **Evidence:** UI check via the CLI: `letsview --wait signal add <w> smart451/BS_200h.DVL` exits 0 with `render.status` `complete` (cli "Waiting for the open UI", scenario "Real UI")

#### Scenario: Rendered with load error
- **WHEN** the data for a revision failed to load
- **THEN** the server reports that revision as rendered with an error, not as complete
- **Evidence:** `apps/server/test/workspace.http.test.ts` › "reports rendered revisions, complete and with errors" (server side; the browser side is unchanged since `add-timeseries-skeleton`)

#### Scenario: Render status over HTTP
- **WHEN** a client connects to `WS /api/live`, acknowledges revision R as `complete`, then R + 1 as `error` with one error, then revision 999 that does not exist, and finally disconnects
- **THEN** `GET /api/render-status` lists the client with R, then with R + 1, `error` and that error, still R + 1 after the 999, and no longer lists it after the disconnect
- **Evidence:** `apps/server/test/workspace.http.test.ts` › "reports rendered revisions, complete and with errors" (existing)

#### Scenario: Revision without visible change
- **WHEN** the UI is open on real data and `letsview --wait link off` and `letsview --wait window rename <w> Speeds` run
- **THEN** both exit 0 with `render.status` `complete`
- **Evidence:** UI check (both CLI outputs)
