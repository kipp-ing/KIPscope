# scope Specification

## Purpose
The scope of a workspace is one data ref and a half-open time window `[from, to)`. It bounds every source query the workspace causes and is the hard edge of navigation (D-078). This capability covers its shape and commands, the invariants and the clamp rule, the catalog modes, how routes resolve and enforce it, and the "Widen" step.

Test data used below: the ClickHouse test DB's `testcar` holds rows from 2026-10-01T00:00:00Z to 10:00:00Z. T1 = 2026-10-01T01:00:00Z = `1790816400000000000`, T2 = 02:00:00Z = `1790820000000000000`.

## Requirements

### Requirement: Scope in the workspace
The workspace SHALL hold an optional `scope` (design Z5), set by `scope.set {dataRef, from, to}` and removed by `scope.clear`, each with one revision, and saved and restored with the workspace. `scope.set` SHALL be rejected with `invalid_command` unless the data ref is non-empty without `/`, the times lie within the command bounds and `to − from` is at least 100 ns. Origin: D-078 („a scope (one data ref and one time window)"); issue #1 item 2.

#### Scenario: Set, clear, bad input
- **WHEN** on a fresh workspace `applyCommand` gets `scope.set {dataRef: "testcar", from: T1, to: T2}`, then `scope.clear`, then `scope.set` with `to` = `from`, with `from` after `to`, with span 99 ns, and with `dataRef: "a/b"`
- **THEN** the first gives `scope` `{dataRef: "testcar", from: "1790816400000000000", to: "1790820000000000000"}`; the second removes the field; each of the last four fails `invalid_command` and leaves the workspace unchanged
- **Evidence:** `packages/shared/test/apply.test.ts` › "sets and clears the scope"

#### Scenario: Scope over HTTP and after a restart
- **WHEN** a caller posts `{"type":"scope.set","dataRef":"testcar","from":"2026-10-01T01:00:00Z","to":"2026-10-01T02:00:00Z"}` to the test server, reads `GET /api/workspace`, and a new store is built from the same state dir
- **THEN** the command is accepted with a new revision, `workspace.scope` is `{dataRef: "testcar", from: "1790816400000000000", to: "1790820000000000000"}`, and the restored workspace holds the same scope
- **Evidence:** `apps/server/test/scope.http.test.ts` › "sets the scope over HTTP"; `apps/server/test/persist.test.ts` › "restores workspace and revision" (workspace with a scope)

### Requirement: Ranges and cursors stay in the scope
While a scope is set, every timeseries window range SHALL lie within it and every cursor in `[from, to)`. Range commands SHALL be clamped by the rule of design Z6 (span kept, shifted inside; a wider span becomes the scope), with `clamped: true` when changed. Cursor commands outside SHALL be rejected with `out_of_scope`, and `scope.set` SHALL clamp every window and drop cursors outside. Origin: D-078 („navigation stops there"); issue #1 item 4.

#### Scenario: Clamp rule
- **WHEN** `clampToScope` gets scope [100, 200) and the ranges [120, 150), [80, 110), [190, 230), [50, 250) and [100, 200)
- **THEN** it gives [120, 150) unchanged, [100, 130) clamped, [170, 200) clamped, [100, 200) clamped and [100, 200) unchanged
- **Evidence:** `packages/shared/test/scope.test.ts` › "clamps a range into the scope keeping its span"

#### Scenario: Commands inside the scope
- **WHEN** a workspace with scope [T1, T2) on `testcar` and one timeseries window at [T1 + 10 min, T1 + 20 min) gets `window.setRange` to [T1 − 5 min, T1 + 5 min), then to [T1, T2 + 1 h), then `cursor.set a` at T2, then `cursor.set a` at T1 + 1 min followed by `scope.set` [T1 + 30 min, T2)
- **THEN** the first gives [T1, T1 + 10 min) with `clamped: true`; the second [T1, T2) with `clamped: true`; the third fails `out_of_scope` and the revision is unchanged; after the last, cursor A is gone and the window range is [T1 + 30 min, T2)
- **Evidence:** `packages/shared/test/apply.test.ts` › "keeps windows and cursors inside the scope"

#### Scenario: No scope, no change
- **WHEN** the same commands run on a workspace without a scope
- **THEN** each range is applied as given, no result carries `clamped`, and the cursor is set at T2
- **Evidence:** `packages/shared/test/apply.test.ts` › "keeps windows and cursors inside the scope"

### Requirement: Widen
"Widen" (UI) and `scope widen` (CLI) SHALL send one `scope.set` with `widenScope(scope)`: one scope span added on each side, clamped to 1900 … 2262. Origin: D-078 („widening it is an explicit step"); step size: design Q-3 (a).

#### Scenario: Widen steps
- **WHEN** `widenScope` gets [T1, T2), then the result again, and a scope that starts at 1900-01-01T00:00:00Z
- **THEN** it gives [T1 − 1 h, T2 + 1 h), then [T1 − 4 h, T2 + 4 h), and for the third a scope that still starts at 1900-01-01T00:00:00Z
- **Evidence:** `packages/shared/test/scope.test.ts` › "widens by one span on each side"

### Requirement: Catalog modes
`KIPSCOPE_CATALOG` SHALL select `full` (default: today's start-up catalog and prefetches) or `scoped`; any other value SHALL stop the server naming the variable and both values. In scoped mode the server SHALL load, prefetch and poll nothing at start except a restored scope's signal list. Origin: issue #1 item 2 („No signal list is loaded at startup. The list loads on demand for the active scope").

#### Scenario: Configuration
- **WHEN** `loadConfig` runs without `KIPSCOPE_CATALOG`, with `scoped`, and with `lazy`
- **THEN** the mode is `full`, then `scoped`; the third throws naming `KIPSCOPE_CATALOG`, `full` and `scoped`
- **Evidence:** `apps/server/test/config.test.ts` › "reads the catalog mode and the scope pad"

#### Scenario: Scoped start without a scope
- **WHEN** a test server in scoped mode starts on a recording adapter with no state file, waits 1 s, and then gets `GET /api/catalog`, `GET /api/density?dataRef=testcar`, `GET /api/meta` and `POST /api/commands {type: "scope.clear"}`
- **THEN** the adapter received only `ping` calls; the first two answer 409 `scope_required`; meta has `catalog` `{mode: "scoped", state: "no_scope", size: 0}`; the command answers 422 `scope_required`
- **Evidence:** `apps/server/test/scope.http.test.ts` › "loads nothing at start in scoped mode"

### Requirement: Scoped mode needs a scope
In scoped mode without a scope, every route that reads the source SHALL answer 409 `scope_required`, and `scope.clear`, `window.addSignal`, `events.addSignal` and a `view.open` that resolves no scope SHALL be rejected with `scope_required`. Origin: issue #1 acceptance („no query runs without both a data ref and a time filter").

#### Scenario: Commands without a scope
- **WHEN** `applyCommand` with `scopeRequired` gets, on a workspace without scope, `scope.clear`, `window.addSignal` for an existing window, and `view.open` of a document with only a values window; and `window.rename` of that window
- **THEN** the first three fail `scope_required` and leave the workspace unchanged; the rename is accepted
- **Evidence:** `packages/shared/test/apply.test.ts` › "refuses catalog commands without a scope in scoped mode"

### Requirement: A scope's signal list loads first
`scope.set`, and a `view.open` that resolves a scope, SHALL load that scope's signal list before they are applied and SHALL check signals and units against it; when the load fails they SHALL answer 503 `catalog_unavailable` and leave the workspace unchanged. Other commands SHALL be checked against the list of the workspace's scope, else the full catalog. Origin: issue #1 item 2 („`signalExists` and the unit check … answer against that scope") and item 3.

#### Scenario: Set then add
- **WHEN** on the test server (full mode) `scope.set {testcar, T1, T2}` is posted, then `GET /api/catalog`, then `window.create` and `window.addSignal` with `testcar/Fast_100h.SIG_A` and with `othercar/Fast_100h.SIG_A`
- **THEN** the set answers 200 only after the source's `listSignals` was called with that scope; the catalog lists only `testcar` signals and carries `scope` `{testcar, T1, T2}`; the first add is accepted, the second rejected `unknown_signal`
- **Evidence:** `apps/server/test/scope.http.test.ts` › "loads the scope's signal list before applying scope.set"

#### Scenario: Load fails
- **WHEN** a stub source fails `listSignals` for a scope and `scope.set` with that scope is posted
- **THEN** the answer is 503 `catalog_unavailable` with a `reason`, and the revision and `workspace.scope` are unchanged
- **Evidence:** `apps/server/test/scope.http.test.ts` › "leaves the workspace unchanged when the scope's list fails"

### Requirement: Routes are bounded by the scope
While the workspace has a scope, every route that reads the source SHALL bound its queries by it (design Z10). A signal or data ref of another data ref, a series range that misses the scope and a value time outside it SHALL answer 409 `out_of_scope`; a series range SHALL be intersected with the scope. Origin: D-078 („Every source query is bounded by the scope"); issue #1 item 4.

#### Scenario: Bounded routes on the test DB
- **WHEN** the scope is {testcar, T1, T2} and `GET /api/series?signal=testcar/Fast_100h.SIG_A&from=2026-10-01T00:00:00Z&to=2026-10-01T10:00:00Z`, `GET /api/extent?signal=testcar/Fast_100h.SIG_A`, `GET /api/value?signal=testcar/Fast_100h.SIG_A&t=2026-10-01T03:00:00Z`, `GET /api/density?dataRef=othercar` and `GET /api/series?signal=othercar/Fast_100h.SIG_A&from=…&to=…` are sent
- **THEN** every point or bucket start of the series lies in [T1, T2); the extent's `first` ≥ T1 and `last` < T2; the last three answer 409 `out_of_scope`
- **Evidence:** `apps/server/test/scope.http.test.ts` › "bounds the routes by the scope"

### Requirement: No unbounded query in scoped mode
In scoped mode, no source query except `ping` SHALL run without both the scope's data ref and its time bounds: every call that takes `scope` SHALL get one, and every `raw`, `buckets` and `count` SHALL get a range inside a held scope. A call that breaks this SHALL be refused before it reaches the adapter and logged once per method as a bug. Origin: issue #1 acceptance („In scoped mode, no query runs without both a data ref and a time filter"); D-078 („nothing scans a data ref's whole history").

#### Scenario: Every route and background task
- **WHEN** a test server in scoped mode runs on a recording adapter, once with every method and once reduced to its required methods, and the test sends `scope.set {testcar, T1, T2}`, opens a view with `testcar` signals, reads `/api/catalog`, `/api/signals?q=sig`, `/api/series`, `/api/value`, `/api/extent`, `/api/density`, `/api/gaps`, `/api/events` with an events-line signal, posts `/api/catalog/refresh`, and lets one gap-info poll run (fake timers)
- **THEN** every recorded adapter call is `ping`, or carries `scope` `{testcar, T1, T2}`, or (for `raw`, `buckets`, `count`) has `T1 ≤ from` and `to ≤ T2`
- **Evidence:** `apps/server/test/scope.http.test.ts` › "sends no query without a data ref and a time range in scoped mode"

#### Scenario: Guard
- **WHEN** the scoped-mode guard holds scope {testcar, T1, T2} and gets `listSignals()` without scope, `raw` for `testcar` over [T1, T2 + 1 s), and `refExtent("testcar", {testcar, T1, T2})`
- **THEN** the first two throw `ScopeGuardError` without calling the adapter, one log line names each method, and the third reaches the adapter
- **Evidence:** `apps/server/test/scope.test.ts` › "refuses unbounded calls before the adapter"

### Requirement: Scope pad
`KIPSCOPE_SCOPE_PAD` SHALL be a CLI duration of at least 0 (default `1h`) and pad a scope derived from a view on each side (saved-views "Open sets the scope"). Any other value SHALL stop the server with a message naming the variable. Origin: issue #1 item 3 („padded by a configurable amount such as `KIPSCOPE_SCOPE_PAD`"); concept §9 („Vor-/Nachlauf"); default: design (spec owner's default).

#### Scenario: Pad values
- **WHEN** `loadConfig` runs without `KIPSCOPE_SCOPE_PAD`, with `30min`, with `0s`, with `-1h` and with `1d`
- **THEN** the pad is 3,600,000,000,000 ns, then 1,800,000,000,000, then 0; the last two throw naming `KIPSCOPE_SCOPE_PAD`
- **Evidence:** `apps/server/test/config.test.ts` › "reads the catalog mode and the scope pad"

### Requirement: Scope in the meta
`GET /api/meta` SHALL report the catalog `mode` and, with a scope, that scope and the state and size of its signal list (design Z5). Origin: necessary consequence (the footer and `scope show` must tell which list is loaded).

#### Scenario: Meta with a scope
- **WHEN** the test server (full mode) has scope {testcar, T1, T2} with its list loaded and `GET /api/meta` is sent
- **THEN** `catalog` is `{mode: "full", state: "loaded", size: <number of testcar signals with rows in [T1, T2)>, loadedAt, scope: {dataRef: "testcar", from: "1790816400000000000", to: "1790820000000000000"}}`
- **Evidence:** `apps/server/test/meta.http.test.ts` › "reports the scope and its signal list"

### Requirement: Scoped mode on real data
A server in scoped mode SHALL open a 2 h scope on a large data ref with its signal list and plots, each query well under the source timeout. Origin: issue #1 acceptance („Opening a `#view=` link for one data ref and a 1–2 h window against a large ADX table loads the signal list and plots"); goal numbers: design "Numbers".

#### Scenario: carserver in scoped mode
- **WHEN** the lead starts a second server with `KIPSCOPE_CATALOG=scoped` against carserver and runs `kipscope scope set smart451 "2026-10-13 14:00" "2026-10-13 16:00"`, then opens a `#view=` link of a 20 min window on smart451
- **THEN** the start log shows no catalog load; the `scope set` call exits 0; the explorer lists the scope's signals and the windows draw; goal, measured and reported but not pass/fail: the `scope set` call returns within 3 s
- **Evidence:** lead's manual check (log lines, CLI output with its time, one screenshot)

### Requirement: Scope commands while a catalog is open
While the workspace has an open catalog, `scope.set` and `scope.clear` SHALL be rejected with `case_open` and leave the workspace unchanged; the case commands (case-navigation) set the scope instead. Origin: Q-6 (a): Unlink and Link replace Widen and Clear in a case workspace (D-086).

#### Scenario: Refused while a catalog is open
- **WHEN** a workspace opened from C4 gets `scope.set {testcar, T1, T2}` and `scope.clear` through `applyCommand`, and `kipscope scope widen` runs against it
- **THEN** both commands fail `case_open` with the revision unchanged, and the CLI exits 1 with `error.code` `case_open`
- **Evidence:** `packages/shared/test/apply.test.ts` › "refuses scope commands while a catalog is open"; `apps/cli/test/cli.test.ts` › "opens, steps and unlinks a catalog"
