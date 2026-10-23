## ADDED Requirements

### Requirement: Patience hint on a slow Unlink
While an Unlink is still on its way 1000 ms after the click, the session bar's title slot SHALL show `HINTS.unlinkSlow` (`Unlinking: reading the whole vehicle's time range; this can take a few seconds`) in a `role="status"` element that exists, empty, from the click on. Link, steps and other commands SHALL NOT show it. Origin: D-113; place: the open note's slot (X4a, DW7); 1000 ms: design "Delay".

#### Scenario: Patience hint helpers
- **WHEN** the pure helper `patienceHintFor(action)` gets `"Unlinking…"`, `"Linking…"` and `undefined`; and, with fake timers, `startPatienceTimer(show)` is started and the clock advanced by 999 ms, then by 1 ms more, then by 5000 ms more; a second timer is started and cancelled after 500 ms, then the clock advanced by 5000 ms; a third is cancelled after it fired
- **THEN** `patienceHintFor` gives `true`, `false`, `false`; the first `show` has not been called after 999 ms and has been called exactly once after 1000 ms and still once after 6000 ms; the second `show` is never called; cancelling the third after it fired throws nothing and calls nothing; `UNLINK_HINT_DELAY_MS` is `1000`
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "starts the Unlink hint after the delay, only for Unlink"

#### Scenario: Patience hint markup
- **WHEN** the session bar is rendered to static markup for linked C4 with `progress` true, `actionPending` `"Unlinking…"` and `unlinkHint` true; the same with `unlinkHint` false; unlinked C4 with `progress` true, `actionPending` `"Linking…"` and `unlinkHint` true; and linked C4 without any of them
- **THEN** the first holds inside `slot-title`, after `slot-title-text`, one `session-unlink-hint` element with `role="status"`, the text and the `title` `HINTS.unlinkSlow`; the second holds that element with `role="status"` and no text; the third and the fourth hold no `session-unlink-hint`; all four hold the same slot elements in the same order
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "shows the Unlink hint in the title slot"

#### Scenario: Hint wording
- **WHEN** the hints table is read
- **THEN** `HINTS.unlinkSlow` equals `Unlinking: reading the whole vehicle's time range; this can take a few seconds` and passes the wording rule (W1: starts with a capital, at most 140 characters, no closing period)
- **Evidence:** `apps/web/test/hints.test.ts` › "words the Unlink patience hint (D-113)" and › "keeps every hint within the wording rule"

### Requirement: Patience hint ends with Unlinking… and moves nothing
The hint SHALL go in the render in which `Unlinking…` goes (revision rendered, refused, failed, or replaced by a newer pending state), so an Unlink done within 1000 ms never shows it. It sits after the title text, truncates with `…` (full text as tooltip), and no slot of the context row changes its box. Origin: D-113; fixed boxes: D-095.

#### Scenario: Slow Unlink on smart451
- **WHEN** a catalog from `kipscope case drives smart451` is open at 1440×900, linked, no Unlink of smart451 ran on this server in the last 5 minutes (the extent cache's lifetime), and the UI user installs on the page a capture `pointerdown` listener on the action button that stores `t0 = performance.now()`, and a `MutationObserver` on the context row (subtree, attributes, characterData, childList) that records on every mutation: `t = performance.now() - t0`, the action button's text, the `session-unlink-hint` element's presence, `role` and text, the row's height, and the `getBoundingClientRect()` x and width of `slot-title`, `slot-duration` and the action button; then clicks `Unlink` with a real pointer click, waits until the row reads `VEHICLE`, clicks `Link` with a real pointer click and waits until it reads `SESSION`
- **THEN** in the Unlink run: every entry with `t` < 950 ms has no hint text; the first entry with hint text has 950 ≤ `t` ≤ 1500 ms, `role="status"` and the text of `HINTS.unlinkSlow`, and the button reads `Unlinking…` in it and in every later entry with hint text; the first entry whose button reads `Link` has no `session-unlink-hint`; the whole Unlink takes more than 3 s (else the run did not test a slow Unlink and is repeated after the cache expired). In the Link run no entry has a `session-unlink-hint`. In every entry the row is 32 px high and the three boxes keep their x and width (±1 px). `kipscope state` shows `case.linked` false after the first wait and true after the second
- **Evidence:** UI check on smart451 (the observer's record printed from the page, filtered to distinct entries, with the Unlink's total time; `kipscope state` after each wait; one screenshot about 5 s after the Unlink click showing the hint beside the title and `Unlinking…`). No test hook or throttling.

#### Scenario: Warm Unlink on smart451
- **WHEN** right after "Slow Unlink on smart451" (within the extent cache's 5 minutes), with the same observer, the UI user clicks `Unlink` again with a real pointer click and waits until the row reads `VEHICLE`
- **THEN** the record and the Unlink's total time are reported; if the Unlink took less than 950 ms, no entry has hint text; if it took longer, the hint follows the rules of the slow run and the fast case rests on "Patience hint helpers"
- **Evidence:** UI check on smart451 (the record and the total time, printed from the page)
