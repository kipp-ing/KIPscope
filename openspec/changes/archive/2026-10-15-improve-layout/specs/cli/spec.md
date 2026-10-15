## ADDED Requirements

### Requirement: Removed window in the result
When an accepted command removed a window as a side effect (workspace-state "Window emptied by a move is removed"), the CLI's JSON result SHALL carry `removedWindow` with that window's ID, placed right after `createdWindow` in the key order. Origin: concept §7 („maschinenlesbare Ergebnisse", a caller must see what its command changed); D-027 (emptied window removed).

#### Scenario: Move empties a window
- **WHEN** against the test server `w1` shows only `testcar/Sna_800h.RPM`, `w3` exists, and `letsview signal move w1 RPM w3` runs
- **THEN** it exits 0, its output carries `"removedWindow":"w1"` after `revision`, and a following `letsview state` no longer lists `w1`
- **Evidence:** `apps/cli/test/cli.test.ts` › "reports the window a move removed"

#### Scenario: Copy reports no removal
- **WHEN** `letsview signal move w3 RPM new --copy` runs
- **THEN** the output carries `createdWindow` and `created` and no `removedWindow`
- **Evidence:** `apps/cli/test/cli.test.ts` › "reports the window a move removed"
