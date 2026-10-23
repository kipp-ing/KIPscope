# saved-views delta

T1 = 2026-10-01T01:00:00Z = `1790816400000000000`, T2 = 02:00:00Z = `1790820000000000000`.

## MODIFIED Requirements

### Requirement: Open needs the catalog
Opening a view SHALL need the signal list it is checked against. A view that resolves a scope (saved-views "Open sets the scope") SHALL first load that scope's list, and answer 503 `catalog_unavailable` and change nothing when that load fails. A view that resolves no scope SHALL need the full catalog in full mode, answering 503 `catalog_unavailable` while it has never loaded, and SHALL be refused with `scope_required` in scoped mode. Origin: necessary consequence (without a list every signal would count as missing); the ADX feedback item 3 („The scope's signal list loads before the view's signals are checked").

#### Scenario: Catalog not loaded
- **WHEN** the test server's full catalog has never loaded and a view with only a values window and no cursors (no scope) is opened
- **THEN** the answer is 503 `catalog_unavailable` and the revision is unchanged
- **Evidence:** `apps/server/test/views.http.test.ts` › "refuses to open before the catalog loads"

#### Scenario: Scope list loads first
- **WHEN** the full catalog has never loaded, and a view with one `testcar` timeseries window [T1 + 10 min, T1 + 20 min) is opened on the test server (pad 1 h); separately the same open runs while the stub source fails `listSignals` for that scope
- **THEN** the first answers 200 after the source's `listSignals` was called with scope {testcar, T1 − 50 min, T1 + 80 min}, and its report's `missing` is checked against that list; the second answers 503 `catalog_unavailable` and the revision is unchanged
- **Evidence:** `apps/server/test/views.http.test.ts` › "loads the scope's list before checking the view"

## ADDED Requirements

### Requirement: Scope in a view document
A view document SHALL accept an optional `scope` `{dataRef, from, to}` (ISO UTC to the ns), written after `data` by `workspaceToView` and `linkViewDoc` when the workspace has a scope, and SHALL stay `version: 1`. A `scope` whose `to` is not after `from` SHALL be refused with `invalid_view`. Origin: the ADX feedback item 3 („may carry an explicit optional `scope`"; „The view v1 link format does not change"); concept §8; D-070 (unknown keys dropped with a warning).

#### Scenario: Round trip with a scope
- **WHEN** a workspace with scope {testcar, T1, T2} and one window is turned into a document, written as YAML, read with `parseViewDoc`, and opened; and the same document is read by a parser without the `scope` key in its known keys
- **THEN** the YAML holds `scope:` with `dataRef: testcar`, `from: 2026-10-01T01:00:00Z`, `to: 2026-10-01T02:00:00Z` right after `data`, `version` is 1, and the opened workspace has the same scope; the older parser reads it with the warning `unknown key "scope" ignored`
- **Evidence:** `packages/shared/test/views.test.ts` › "round-trips the scope of a view"

#### Scenario: Canonical form without scope unchanged
- **WHEN** the server writes the document of design V1's example (no scope)
- **THEN** the file text equals the example byte for byte
- **Evidence:** `apps/server/test/views.test.ts` › "writes the canonical YAML form" (unchanged)

### Requirement: Open sets the scope
Opening a view, a `#view=` link or `?view=<name>` SHALL set the workspace's scope in both modes (design Q-1 (a)): the command's `scope`, else the document's, else `viewScope` (design Z8: the first signal's data ref and the union of window ranges and cursors, padded by `KIPSCOPE_SCOPE_PAD`). A view without a data ref or a time sets none. Origin: the ADX feedback item 3; D-078 („shows one case at a time").

#### Scenario: Derived scope
- **WHEN** `viewScope` gets, with pad 1 h, a document whose windows are `testcar` [T1, T1 + 10 min) and [T1 + 30 min, T1 + 40 min) with cursor A at T1 + 50 min; one whose first window shows `othercar/X.Y` and second `testcar/X.Y`; one with only a values window and no cursor; and one with `scope` {testcar, T1, T2}
- **THEN** it gives {testcar, T1 − 1 h, T1 + 50 min + 1 ns + 1 h}; a scope on `othercar`; undefined; and {testcar, T1, T2} unpadded
- **Evidence:** `packages/shared/test/scope.test.ts` › "derives the scope of a view"

### Requirement: View clamped into its scope
On open, window ranges SHALL be clamped into the scope with the warning `ranges clamped to the scope`, and cursors outside it SHALL be dropped with a warning naming the cursor. Origin: scope "Ranges and cursors stay in the scope" (the invariant holds after every command).

#### Scenario: Explicit scope smaller than the windows
- **WHEN** a view with `scope` {testcar, T1, T2}, a window [T1 − 30 min, T1 + 10 min) and cursor B at T2 + 1 min is opened
- **THEN** the window shows [T1, T1 + 40 min), cursor B is off, and `report.warnings` holds `ranges clamped to the scope` and `cursor B outside the scope dropped`
- **Evidence:** `packages/shared/test/apply.test.ts` › "opens a view into its scope"

#### Scenario: Link opens with a scope on real data
- **WHEN** with a 20 min window on smart451 in full mode, "Copy link" is used, the scope is cleared, and a new tab opens the link
- **THEN** every tab shows the window again, and the strip head shows `SCOPE smart451` with the window's range padded by 1 h on each side
- **Evidence:** UI check on smart451 (screenshot of the strip head and header)

### Requirement: Signals of another data ref on open
On open, a window signal whose data ref is not the scope's SHALL be left out and listed in `report.skipped` with reason `out_of_scope` and its window index. An events-line signal of another data ref SHALL be dropped with one warning. Origin: D-078 (one data ref per case); design Q-2 (a).

#### Scenario: Two data refs in one view
- **WHEN** a view whose first window shows `testcar/Fast_100h.SIG_A` and `othercar/Fast_100h.SIG_A` is opened on the test server
- **THEN** the scope is on `testcar`, the window shows only the `testcar` signal, and `report.skipped` is `[{"signalId":"othercar/Fast_100h.SIG_A","window":0,"reason":"out_of_scope"}]`
- **Evidence:** `apps/server/test/views.http.test.ts` › "skips signals of another data ref"
