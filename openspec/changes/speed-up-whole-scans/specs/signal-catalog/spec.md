## MODIFIED Requirements

### Requirement: Explorer follows the scope
The explorer SHALL load the catalog again whenever the workspace's scope changes (`scopeKey`), and SHALL drop an answer whose `scope` is not the current one. In scoped mode without a scope it SHALL show `No scope set. Open a view link or run kipscope scope set REF FROM TO.` instead of the list and SHALL not retry until the scope changes. While an answer has `partial`, it SHALL show `Signals of session <k>` above the list (tooltip: the vehicle's full list is not loaded while unlinked, speed-up-whole-scans Q-4) and load the catalog again every 10 s until an answer has no `partial`. Origin: necessary consequence of "Catalog contents" (the browser holds the list, signal-catalog design E3); the ADX feedback item 2; partial: object-view "Signal list loads lazily" (D-086).

#### Scenario: Reload on scope change
- **WHEN** the explorer's loader is fed the scopes "", then {testcar, T1, T2}, then the same again, then {testcar, T1 − 1 h, T2 + 1 h}, and the answer for the second scope arrives after the third scope was set
- **THEN** it fetches the catalog three times (no fetch for the repeated scope) and shows only the third answer
- **Evidence:** `apps/web/test/explorer.test.ts` › "reloads the catalog when the scope changes"

#### Scenario: No scope in the UI
- **WHEN** the dev server runs a second instance with `KIPSCOPE_CATALOG=scoped` and no state file, the UI is opened against it, and then `kipscope scope set smart451 "2026-10-13 14:00" "2026-10-13 16:00"` runs
- **THEN** the explorer first shows the "No scope set" text, then, without a reload, the scope's signals; searching `volt` finds signals of the scope (`DCU_1F4h.COMP_HV_Volt` is not in the smart451 catalog any more; corrected by the lead 2026-10-20)
- **Evidence:** UI check (two screenshots of the explorer)

#### Scenario: Partial list
- **WHEN** the loader (fake timers) gets an answer with `partial` for an object scope, then after 10 s one without
- **THEN** it shows the note with the session's position, fetches again after 10 s, then shows the full list without the note and fetches no more
- **Evidence:** `apps/web/test/explorer.test.ts` › "reloads while the list is partial"
