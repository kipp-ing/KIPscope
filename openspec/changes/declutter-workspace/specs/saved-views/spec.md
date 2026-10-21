## MODIFIED Requirements

### Requirement: Title of the open view
The top row SHALL show a **Views** button and, when the workspace has an open view, its title with a `•` while it is modified and its note as tooltip; the browser tab title SHALL be `<title> · KIPscope`, else `KIPscope`. Origin: persona test (boss: „a title", no story on screen); concept §9 („Lesezeichen mit Notiz").

#### Scenario: Title and modified dot
- **WHEN** a view "Drive 3" with a note is opened, then cursor A is moved, then the view is saved with Ctrl+S
- **THEN** after the open the top row shows `Drive 3` without dot and the tab title is `Drive 3 · KIPscope`; after the move it shows `Drive 3 •`; after Ctrl+S (no form) the dot is gone and the revision rose by one
- **Evidence:** UI check on smart451 (three screenshots of the top row); `packages/shared/test/apply.test.ts` › "marks the open view modified"; `apps/web/test/views.test.ts` › "titles the top row and the browser tab" (`titleParts` and `documentTitle` for no view, a clean and a modified view)

#### Scenario: Top row stays one line
- **WHEN** a view titled with 120 characters is open with the six-window setup and the sidebar open, at 1440×900 and at 1000×557
- **THEN** every control of the top row has the same `getBoundingClientRect().top` (±1 px) in each viewport; the title text is at least `10ch` wide (rect width ≥ its computed `min-width`, which is `10ch`) and ends in an ellipsis with the full title in its tooltip and in the tab title; at both sizes Digits and "+ Values window" are not displayed in the row and the "⋯" menu holds both; "Share…" is in the row at 1440×900 and in the "⋯" menu at 1000×557
- **Evidence:** UI check on smart451: the UI user measures `getBoundingClientRect().top` of every displayed top-row item in a 1000×557 iframe and at 1440×900 (tops, title width and computed `min-width` per viewport, one screenshot each); `bar/bar.css` comment names the measured threshold for Share and the row width after the move; `apps/web/test/views.test.ts` › "keeps the title at least ten characters" (`titleMinChars` gives 10 for 120 characters, 7 for `Drive 3`)

### Requirement: Top-row overflow menu
The top row SHALL end with a "⋯" button (`aria-label` `More`) followed by "?" at every width. Its menu SHALL always hold Digits and "+ Values window"; below a measured container width (the threshold at which the row with "Share…" would no longer fit one line at 1000×557 with the sidebar open, written into the comment in `bar/bar.css`) it SHALL also hold "Share…", which then leaves the row. So the row never wraps at 1000×557 with the sidebar open nor at 1440×900. Each item SHALL stay usable by keyboard. Origin: round-2 UI finding of `add-saved-views` (851 px needed, 728 px available); design V7 "Top-row overflow rule"; "Share…" as an overflow item: exploration „'Share…' in the overflow menu", accepted by D-086 (add-multiuser design M12); Digits and "+ Values window" always in "⋯" and "?" in the row: D-092 (7) (supersedes D-071's width rule for them), mock `Compact.dc.html`.

#### Scenario: Overflow menu by keyboard
- **WHEN** at 1000×557 with the sidebar open the user does, in order:
  1. tabs to "⋯" and presses Enter
  2. changes Digits to 4 with the arrow keys
  3. tabs to "+ Values window" and presses Enter
  4. opens "⋯" again, tabs to "Share…" and presses Enter, then presses Escape twice
- **THEN**
  - Enter opens the menu with focus on the Digits select
  - the workspace's digits become 4, and a new values window appears
  - "Share…" opens its popover
  - the Escapes close the popover and the menu, with focus on "⋯"
  - "⋯" has `aria-haspopup="menu"`, with `aria-expanded` true while open and false after
- **Evidence:** UI check on smart451 (focused element and `aria-expanded` read from the page after each step, `kipscope state` for digits and windows; one screenshot with the menu open)

#### Scenario: Share in the row when there is room
- **WHEN** the six-window setup is open with the sidebar open at 1440×900, and the user opens "⋯"
- **THEN** "Share…" is in the top row before "⋯", "⋯" and "?" are displayed after it, every top-row item has the same `getBoundingClientRect().top` (±1 px), and the menu holds Digits and "+ Values window" but not "Share…"
- **Evidence:** UI check on smart451 (tops read from the page; one screenshot with the menu open)
