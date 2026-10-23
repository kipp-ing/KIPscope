## ADDED Requirements

### Requirement: Unlink and Link show progress
From the click on `Unlink` (`case.unlink`) or `Link` (`case.go {index: current}`) until the result's revision is rendered, or the command is refused or fails, the context row SHALL have `aria-busy="true"` and show the progress line of DW4, and the action button SHALL read `Unlinking…` or `Linking…`, disabled, in the action slot's 64 × 24 px box with its text not clipped. The other slots keep their text. Origin: D-112 (2); box: D-095; line: DW4, D-094.

#### Scenario: Pending action helper
- **WHEN** the pure helper `pendingAction(c, input)` gets linked C4 with `case.unlink`; unlinked C4 with `case.go {index: 1}`; linked C4 with `case.go {index: 2}`; linked C4 with `case.step {by: 1}`; unlinked C4 with `case.unlink`; and linked C4 with `case.align {align: {mode: "end"}}`
- **THEN** it gives `"Unlinking…"`, `"Linking…"`, `undefined`, `undefined`, `undefined` and `undefined`
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "names the pending Unlink and Link"

#### Scenario: Pending action markup
- **WHEN** the session bar is rendered to static markup for linked C4 with `progress` true and `actionPending` `"Unlinking…"`, for unlinked C4 with `progress` true and `actionPending` `"Linking…"`, and for linked C4 without either
- **THEN** the first holds a `slot-action` button with the text `Unlinking…` and `disabled`, the second one with `Linking…` and `disabled`, both a `context-row` with `aria-busy="true"` and one `session-progress`; the third holds `Unlink`, not disabled, no `aria-busy` and no `session-progress`; all three hold the same slot elements in the same order
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "shows Unlinking… and Linking… while pending"

#### Scenario: Unlink and Link on smart451
- **WHEN** a catalog from `kipscope case drives smart451` is open at 1440×900, linked, and the UI user installs a `MutationObserver` on the context row (subtree, attributes, characterData, childList) that records, on every mutation, the action button's text, its `disabled`, its `getBoundingClientRect()` width and height, the row's `aria-busy` and whether `.session-progress` exists; then clicks `Unlink` with a real pointer click, waits until the row reads `VEHICLE`, clicks `Link` with a real pointer click and waits until it reads `SESSION`
- **THEN** the record holds, after the Unlink click and before the first `Link` text, at least one entry `Unlinking…`, disabled, `aria-busy` `true`, progress line present; after the Link click and before the next `Unlink` text at least one entry `Linking…` with the same; the last entry reads `Unlink`, enabled, no `aria-busy`, no progress line; every entry measures 64 × 24 px (±1 px); `kipscope state` shows `case.linked` false after the first wait and true after the second
- **Evidence:** UI check on smart451 (the observer's record printed from the page, filtered to distinct entries; `kipscope state` after each wait; one screenshot after each wait). The reload on carserver is fast, so the record, not a screenshot, is the evidence of the pending state; no test hook or throttling is used.

### Requirement: Pending Unlink and Link end on their own outcome
A refusal or failure of Unlink or Link SHALL restore `Unlink` or `Link`, enabled, without the progress line and `aria-busy`; the refusal goes to the message line as today. The pending state SHALL end only by its own command's outcome or by a newer case command that starts a pending state of its own; a newer case command that starts none (a `]` while unlinked) SHALL NOT end or orphan it. Origin: necessary consequence of D-112 (2) and of DW4's end rule (D-094).

#### Scenario: Which commands start a pending state
- **WHEN** the pure helper `startsPending(c, pending, input)` gets unlinked C4 with `case.step {by: 1}`; unlinked C4 with `case.go {index: 1}`; linked C4 at current 0 with `case.unlink`; linked C4 at current 0 with `case.step {by: 1}`; linked C4 at current 3 (the last) with `case.step {by: 1}`; and linked C4 with `case.align {align: {mode: "end"}}`
- **THEN** it gives `false`, `true`, `true`, `true`, `false` and `false` (true exactly when `pendingTarget` or `pendingAction` gives a value)
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "starts a pending state only for a target or an action"; reviewer reads `App.tsx` `caseCommand`: the sequence that guards `settle` is bumped only when `startsPending` is true
