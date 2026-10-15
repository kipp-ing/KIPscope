## ADDED Requirements

### Requirement: Move and copy a signal
A command SHALL move a signal assignment from one window to another, or copy it when asked. A move SHALL keep the assignment's ID; a copy SHALL create a new one. A target that already shows the signal (including the source itself) SHALL reject the command with `already_in_window`. A window emptied by a move SHALL be removed ("Window emptied by a move is removed"). Origin: D-017 („Signale zwischen zwei anzeigen hin und her“); concept §4, §7; D-027.

#### Scenario: Move keeps ID and colour
- **WHEN** window `w1` shows assignment `a2` of signal S and `window.moveSignal {windowId: w1, assignmentId: a2, targetWindowId: w3}` is applied
- **THEN** `w1` no longer shows `a2`, `w3` ends with `{id: a2, signalId: S}`, and S's colour index is unchanged
- **Evidence:** `packages/shared/test/apply.test.ts` › "moves a signal keeping assignment ID and colour"

#### Scenario: Copy
- **WHEN** the same command is applied with `copy: true`
- **THEN** `w1` still shows `a2`, `w3` gets a new assignment whose ID is returned as `created`, and the distinct-signal count does not change
- **Evidence:** `packages/shared/test/apply.test.ts` › "copies a signal with a new assignment ID"

#### Scenario: Emptied window removed
- **WHEN** the only signal of a window is moved away
- **THEN** the window is no longer in the workspace and the result names it as `removedWindow`
- **Evidence:** `packages/shared/test/apply.test.ts` › "removes a window emptied by a move"

#### Scenario: Target already shows the signal
- **WHEN** the target window already shows signal S, or the target is the source window
- **THEN** the command is rejected with `already_in_window` and the revision does not change
- **Evidence:** `packages/shared/test/apply.test.ts` › "rejects a move into a window that already shows the signal"

### Requirement: Window emptied by a move is removed
A `window.moveSignal` without `copy` that takes the last signal out of its source window SHALL remove that window, of any kind, in the same command and revision, exactly as `window.remove` would (including clearing `lastZoomed` when it named that window). The result SHALL carry `removedWindow` with its ID. A copy, `window.removeSignal` and a rejected move SHALL NOT remove a window. Origin: D-027 („A window emptied by a move is removed automatically").

#### Scenario: Last signal into another window
- **WHEN** timeseries window `w1` shows only `a2` and `w3` exists, and `window.moveSignal {windowId: w1, assignmentId: a2, targetWindowId: w3}` is applied
- **THEN** the revision rises by exactly one, `w1` is gone, `w3` shows `a2`, and the result is `{ok: true, revision, removedWindow: "w1"}`
- **Evidence:** `packages/shared/test/apply.test.ts` › "removes a window emptied by a move"

#### Scenario: Values window emptied
- **WHEN** a values window shows one signal and it is moved into a timeseries window
- **THEN** the values window is gone and named as `removedWindow`
- **Evidence:** `packages/shared/test/apply.test.ts` › "removes a window emptied by a move"

#### Scenario: Only signal into a new window
- **WHEN** timeseries window `w1` in step mode with height 400 shows only `a2`, and `window.moveSignal` without `targetWindowId` is applied
- **THEN** one revision later a new window with `w1`'s range, step mode and height 400 shows `a2`, `w1` is gone, and the result carries both `createdWindow` (the new ID) and `removedWindow: "w1"`
- **Evidence:** `packages/shared/test/apply.test.ts` › "moves the only signal into a new window and removes the source"

#### Scenario: Copy, remove and refused moves keep the window
- **WHEN** a window's only signal is copied elsewhere; another window's only signal is removed with `window.removeSignal`; and a third window's only signal is moved into a window that already shows it
- **THEN** all three windows stay (the second with no signals), no result carries `removedWindow`, and the refused move leaves the revision unchanged
- **Evidence:** `packages/shared/test/apply.test.ts` › "keeps a window emptied by removeSignal, a copy or a refused move"

#### Scenario: Window zoomed last is emptied
- **WHEN** "Link time axes" is off, `w1` and `w2` have different ranges, `w1` was zoomed last, and `w1`'s only signal is moved into `w2`
- **THEN** `w1` is gone, `lastZoomed` is absent, and `w2` keeps its range
- **Evidence:** `packages/shared/test/apply.test.ts` › "clears lastZoomed when a move removes that window"

#### Scenario: Over HTTP
- **WHEN** a caller posts such an emptying `window.moveSignal` to `POST /api/commands`
- **THEN** the answer is `{ok: true, revision, removedWindow: "<id>"}` and `GET /api/workspace` no longer lists that window
- **Evidence:** `apps/server/test/workspace.http.test.ts` › "returns the window a move removed"

## REMOVED Requirements

### Requirement: Move and copy a signal between windows
**Reason**: Its rule "A window emptied by a move SHALL stay" is superseded by D-027 („A window emptied by a move is removed automatically"); a MODIFIED block cannot drop its scenario "Emptied window stays".
**Migration**: Replaced by "Move and copy a signal" (same rules and scenarios, emptied window removed) and "Window emptied by a move is removed".
