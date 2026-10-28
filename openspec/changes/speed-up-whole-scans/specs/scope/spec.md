## MODIFIED Requirements

### Requirement: Catalog modes
`KIPSCOPE_CATALOG` SHALL select `scoped` (default) or `full`; any other value SHALL stop the server naming the variable and both values. In scoped mode the server SHALL load, prefetch and poll nothing at start except a restored scope's signal list. `full` (the start-up catalog of every data ref, its prefetches and polls) SHALL be an explicit opt-in for small sources only, and the scan bound ("Scan bound") SHALL hold in it too. Origin: D-117 („im see stochern über alles ist ja quatsch": KIPscope never scans a source's whole data); the ADX feedback item 2 („No signal list is loaded at startup"); `full` kept for the test DB and demos: Questions for Jan Q-1 (default).

#### Scenario: Configuration
- **WHEN** `loadConfig` runs without `KIPSCOPE_CATALOG`, with `full`, and with `lazy`
- **THEN** the mode is `scoped`, then `full`; the third throws naming `KIPSCOPE_CATALOG`, `full` and `scoped`
- **Evidence:** `apps/server/test/config.test.ts` › "reads the catalog mode and the scope pad"

#### Scenario: Scoped start without a scope
- **WHEN** a test server in scoped mode starts on a recording adapter with no state file, waits 1 s, and then gets `GET /api/catalog`, `GET /api/density?dataRef=testcar`, `GET /api/meta` and `POST /api/commands {type: "scope.clear"}`
- **THEN** the adapter received only `ping` calls; the first two answer 409 `scope_required`; meta has `catalog` `{mode: "scoped", state: "no_scope", size: 0}`; the command answers 422 `scope_required`
- **Evidence:** `apps/server/test/scope.http.test.ts` › "loads nothing at start in scoped mode"

#### Scenario: Default start on carserver
- **WHEN** the lead starts the dev server against carserver with Jan's `.env` (no `KIPSCOPE_CATALOG`)
- **THEN** the start log names catalog mode `scoped` and shows no catalog load and no density or gap prefetch, and `curl -s localhost:7310/api/meta | jq -c .catalog` prints `{"mode":"scoped","state":"no_scope","size":0}` while no workspace holds a scope
- **Evidence:** lead's check (log lines, `curl` output)

### Requirement: Scoped mode needs a scope
In scoped mode without a scope, every route that reads the source SHALL answer 409 `scope_required`, except `GET /api/density` with `dataRef`, `from` and `to`, whose source calls carry `{dataRef, from, to}` as their scope and which the scan bound applies to like any other. `scope.clear`, `window.addSignal`, `events.addSignal` and a `view.open` that resolves no scope SHALL be rejected with `scope_required`. Origin: the ADX feedback acceptance („no query runs without both a data ref and a time filter"); the density exception: D-117 (`case drives` as the local way to find sessions without the search tool; a request window is a data ref and a time window).

#### Scenario: Commands without a scope
- **WHEN** `applyCommand` with `scopeRequired` gets, on a workspace without scope, `scope.clear`, `window.addSignal` for an existing window, and `view.open` of a document with only a values window; and `window.rename` of that window
- **THEN** the first three fail `scope_required` and leave the workspace unchanged; the rename is accepted
- **Evidence:** `packages/shared/test/apply.test.ts` › "refuses catalog commands without a scope in scoped mode"

#### Scenario: Density of a window without a scope
- **WHEN** a scoped-mode test server on a recording adapter has no scope and gets `GET /api/density?dataRef=drivecar&from=2026-10-02T00:00:00Z&to=2026-10-03T00:00:00Z`, then `GET /api/density?dataRef=drivecar`
- **THEN** the first answers 200 with the drives of that day and every recorded adapter call is `ping` or carries scope `{drivecar, 2026-10-02T00:00Z, 2026-10-03T00:00Z}`; the second answers 409 `scope_required`
- **Evidence:** `apps/server/test/scope.http.test.ts` › "answers a bounded density without a scope in scoped mode"

## ADDED Requirements

### Requirement: Scan bound
Before a source call that reads every row of a data ref in a range (`listSignals`, `refBuckets`, `loggerGaps`, `refExtent`), the server SHALL check that range:
- If the span `to − from` is above `KIPSCOPE_SCAN_SPAN` (a CLI duration, default `7d`), the request is refused with no source call. Without a range (full mode, no scope) the span counts as unbounded and the next check alone decides.
- Otherwise `refCount(dataRef, range)`, shared by every check of the same range and kept 5 min, must be at most `KIPSCOPE_SCAN_ROWS` (a positive integer, default 150,000,000).

The calendar's vehicle-days split a day above the bound into parts instead of refusing it (range-picker "Calendar days counted at the lowest priority"). A refused check SHALL answer 422 `too_wide` (HTTP) or a command result `too_wide` (422), with the text of "Too wide answers", within the time of that one count. It SHALL never time out at the source. Invalid values of either variable SHALL stop the server naming the variable.

Origin: D-117 („a bound per query with a visible ‚too wide' answer"). Numbers: design B1: 150 M rows at the slowest measured whole-range rate, 11.6 M rows/s (`uniqExact` of one day, 114.9 M rows, 9.9 s), take about 13 s, under half the 30 s limit, and admit one day of smart451 (114.9 M rows on 2026-10-27). 7 d: a count over 8 days took 1.5 s.

#### Scenario: Bound values
- **WHEN** `loadConfig` runs without both variables; with `KIPSCOPE_SCAN_ROWS=1000` and `KIPSCOPE_SCAN_SPAN=1h`; with `KIPSCOPE_SCAN_ROWS=0`; with `KIPSCOPE_SCAN_ROWS=1e6`; and with `KIPSCOPE_SCAN_SPAN=-1d`
- **THEN** the bound is 150,000,000 rows and 604,800,000,000,000 ns, then 1,000 rows and 3,600,000,000,000 ns; the last three throw naming the variable
- **Evidence:** `apps/server/test/config.test.ts` › "reads the scan bound"

#### Scenario: Limits in the meta
- **WHEN** the test server runs with `KIPSCOPE_SCAN_ROWS=1000`, `KIPSCOPE_SCAN_SPAN=1h` and `KIPSCOPE_SCOPE_PAD=30min`, and `GET /api/meta` is sent
- **THEN** `limits` is `{scanRows: 1000, scanSpan: "3600000000000", scopePad: "1800000000000"}`
- **Evidence:** `apps/server/test/meta.http.test.ts` › "reports the scan limits"

#### Scenario: Span and rows
- **WHEN** a stub source answers `refCount` 200 for every range, the bound is 100 rows and 1 h, and the check runs for `{car, 0, 2 h}`, for `{car, 0, 1 h}` twice, and, after the stub answers 50, for `{car, 1 h, 2 h}`
- **THEN** the first is refused as `too_wide` with span 2 h and no `refCount` call; the second is refused as `too_wide` with 200 rows after one `refCount` call, and the third makes no further call; the fourth passes after one `refCount` call
- **Evidence:** `apps/server/test/scanBound.test.ts` › "refuses wide spans without a query and counts each range once"

#### Scenario: Too wide over HTTP
- **WHEN** the test server runs in full mode with `KIPSCOPE_SCAN_ROWS=1000` and no scope, and `/api/density?dataRef=testcar`, `/api/gaps?dataRef=testcar` and `/api/value?signal=testcar/Fast_100h.SIG_A&t=2026-10-01T01:30:00Z` are sent
- **THEN** each answers 422 with `error.code` `too_wide`, `error.limit` `"1000"`, `error.rows` the source's unscoped `refCount` of testcar as a decimal string, and the message of "Too wide answers"
- **Evidence:** `apps/server/test/scanBound.http.test.ts` › "answers too_wide on the routes"

#### Scenario: One day of smart451
- **WHEN** the lead sets scope `smart451 2026-10-27T00:00:00Z 2026-10-28T00:00:00Z` on the dev server (carserver, defaults), then `smart451 2026-10-20T00:00:00Z 2026-10-27T00:00:00Z`, then `smart451 2026-10-11T00:00:00Z 2026-10-28T00:00:00Z`
- **THEN** the first is accepted; the second answers `too_wide` naming its rows (more than 150,000,000); the third answers `too_wide` naming its span (17 d); the second and third each answer within 5 s and none answers 502
- **Evidence:** CLI output with times (`time kipscope scope set …`), reported in `rounds.md`

### Requirement: Too wide answers
A `too_wide` answer SHALL carry `error.rows` and `error.limit` (decimal strings) when the row count decided, or `error.span` and `error.maxSpan` (decimal ns) when the span did. Its message SHALL be `too wide: <rows> rows, more than the <limit> a query may read; choose a shorter range` or `too wide: <span> is more than the <maxSpan> a query may span; choose a shorter range`, with counts in groups of three digits separated by `,` and spans as the strip writes them. Origin: concept §10 („Ladezustände, Fehler und unvollständige Ergebnisse müssen erkennbar bleiben"); D-117.

#### Scenario: Texts
- **WHEN** `tooWideText` gets `{rows: "230000000", limit: "150000000"}` and `{span: "1468800000000000", maxSpan: "604800000000000"}`
- **THEN** it gives `too wide: 230,000,000 rows, more than the 150,000,000 a query may read; choose a shorter range` and `too wide: 17 d is more than the 7 d a query may span; choose a shorter range`
- **Evidence:** `packages/shared/test/scope.test.ts` › "words a too-wide answer"

### Requirement: A too-wide scope is refused
`scope.set`, Widen (one `scope.set`), a `view.open` that resolves a scope, and a case step or Link SHALL load the target scope's signal list only through the scan bound. When that bound refuses, they SHALL be rejected with `too_wide` and leave the workspace unchanged. Origin: D-117 (a scope everywhere, bounded); "A scope's signal list loads first" (the list is a scan of the scope).

#### Scenario: Set and widen beyond the bound
- **WHEN** the test server runs with `KIPSCOPE_SCAN_ROWS` set to N, the number of testcar rows in [T1, T2), `scope.set {testcar, T1, T2}` is posted, then a Widen (`scope.set` with `widenScope`), then `kipscope scope set testcar "2026-10-01 02:00" "2026-10-01 12:00"`
- **THEN** the first is accepted; the second answers 422 `too_wide` with the message of "Too wide answers" and the scope stays {testcar, T1, T2} at the same revision; the CLI call exits 1 with `error.code` `too_wide` and the message on stderr
- **Evidence:** `apps/server/test/scanBound.http.test.ts` › "refuses a scope wider than the bound"; `apps/cli/test/cli.test.ts` › "reports a too-wide scope"

### Requirement: Scope card
In scoped mode, a workspace without a scope SHALL show a "Set a scope" card at the top of the window list:
- **Data ref** field, prefilled with the data ref of the first window's first signal. Its suggestions are the data refs of the workspace's signals.
- **From** and **To** fields, which accept what `kipscope` time arguments accept. They are prefilled with `windowsScope(workspace, pad)`: the windows' ranges and cursors, padded by `KIPSCOPE_SCOPE_PAD`, the rule a view without a scope uses.
- **Set scope** button, which sends one `scope.set`. A refusal (`too_wide`, `catalog_unavailable`, `invalid_command`) shows its message under the button, and the fields keep their text.
- The lines `Open a session from the search tool, or drop a catalog file here.` and `CLI: kipscope scope set REF FROM TO · kipscope case drives REF FROM TO`.

The card SHALL go when a scope is set.

Each timeseries window SHALL meanwhile show `No scope set` in the muted colour in its plot, send no series request, and report no render error. Origin: D-117 („Without the search tool, a scope is set by hand or with the CLI"); concept §10; the prefill rule: D-082 (a view without scope gets one derived from its windows).

#### Scenario: Card fields and set
- **WHEN** the Scope card renders a workspace without scope whose window `w1` shows `testcar/Fast_100h.SIG_A` over [T1 + 10 min, T1 + 20 min) with pad 1 h, the user clicks **Set scope**, and the stub answers `too_wide` with a message
- **THEN** the fields read `testcar`, the local text of T1 − 50 min and of T1 + 80 min; the click sends exactly `{type: "scope.set", dataRef: "testcar", from: "1790813400000000000", to: "1790821200000000000"}`; the message shows under the button and the fields keep their text
- **Evidence:** `apps/web/test/scopeCard.test.ts` › "prefills the scope from the windows and shows a refusal"

#### Scenario: Windows without a scope
- **WHEN** a timeseries window renders in scoped mode with meta `catalog.state` `no_scope`
- **THEN** its plot shows `No scope set`, no `/api/series` request is sent, and its render acknowledgement carries no error
- **Evidence:** `apps/web/test/scopeCard.test.ts` › "keeps windows quiet without a scope"

#### Scenario: Card on carserver
- **WHEN** the UI user opens Jan's workspace (windows on smart451, no scope) on the scoped dev server at 1440×900, sets To to a time 2 d after From and clicks **Set scope**, then sets From and To to 2026-10-27 00:00 and 2026-10-28 00:00 local and clicks again
- **THEN** the card shows; the first click shows a `too wide:` message under the button; after the second the card goes, the context row reads `SCOPE smart451` and the windows draw; no window shows an error box before or after
- **Evidence:** UI check (one screenshot per step)

### Requirement: Real data runs in a scope
`pnpm smoke` SHALL create its own workspace on the server it checks, with a scope and one timeseries window. It does this with one `POST /api/workspaces {open: {view}}` sent by the script itself (not by the page), taking `--scope REF FROM TO` (default `smart451 2026-10-27T00:00:00Z 2026-10-28T00:00:00Z`) and the signal `--signal ID` (default `smart451/BMS.cell_voltage_max`). It SHALL open that workspace at `/w/<id>`, run its checks with the page's writes still blocked, and delete the workspace at the end, also after a failure. Real-data scenarios in this change's deltas name the scope they run in. Origin: D-117 (no whole-data scans, so no check can run without a scope); the crash guard (docs/team.md) must not change the user's workspace.

#### Scenario: Smoke twice on carserver
- **WHEN** the crash guard runs `pnpm build`, then `pnpm smoke` and `pnpm smoke --preview`, twice in a row, against the scoped dev server on carserver
- **THEN** all four runs pass; each prints the workspace it created and deleted, and `GET /api/workspaces` afterwards lists no workspace the smoke created
- **Evidence:** the four outputs (shortened in `rounds.md`)
