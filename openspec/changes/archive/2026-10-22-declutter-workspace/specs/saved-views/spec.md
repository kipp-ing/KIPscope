## MODIFIED Requirements

### Requirement: Title of the open view
The top row SHALL show a **Views** button and, when the workspace has an open view, its title with a `•` while it is modified and its note as tooltip; the browser tab title SHALL be `<title> · KIPscope`, else `KIPscope`. Origin: persona test (boss: „a title", no story on screen); concept §9 („Lesezeichen mit Notiz").

#### Scenario: Title and modified dot
- **WHEN** a view "Drive 3" with a note is opened, then cursor A is moved, then the view is saved with Ctrl+S
- **THEN** after the open the top row shows `Drive 3` without dot and the tab title is `Drive 3 · KIPscope`; after the move it shows `Drive 3 •`; after Ctrl+S (no form) the dot is gone and the revision rose by one
- **Evidence:** UI check on smart451 (three screenshots of the top row); `packages/shared/test/apply.test.ts` › "marks the open view modified"; `apps/web/test/views.test.ts` › "titles the top row and the browser tab" (`titleParts` and `documentTitle` for no view, a clean and a modified view)

#### Scenario: Top row stays one line
- **WHEN** a view titled with 120 characters is open with the six-window setup and the sidebar open, at 1440×900 and at 1000×557
- **THEN** every control of the top row has the same `getBoundingClientRect().top` (±1 px) in each viewport; the title text is at least `10ch` wide (rect width ≥ its computed `min-width`, which is `10ch`) and ends in an ellipsis with the full title in its tooltip and in the tab title; at both sizes Digits and "+ Values window" are not displayed in the row and the "⋯" menu holds both; "Share…" is in the row at both sizes and never in the "⋯" menu
- **Evidence:** UI check on smart451: the UI user measures `getBoundingClientRect().top` of every displayed top-row item in a 1000×557 iframe and at 1440×900 (tops, title width and computed `min-width` per viewport, one screenshot each); `apps/web/test/views.test.ts` › "keeps the title at least ten characters" (`titleMinChars` gives 10 for 120 characters, 7 for `Drive 3`)

### Requirement: Top-row overflow menu
The top row SHALL end with "Share…", a "⋯" button (`aria-label` `More`) and "?" at every width. The "⋯" menu SHALL hold Digits and "+ Values window" and nothing else; "Share…" SHALL never move into it. The row never wraps at 1000×557 with the sidebar open nor at 1440×900 (the view title shrinks first, `10ch` at least). Each item SHALL stay usable by keyboard. Origin: round-2 UI finding of `add-saved-views` (851 px needed, 728 px available); design V7 "Top-row overflow rule"; Digits and "+ Values window" always in "⋯" and "?" in the row: D-092 (7) (supersedes D-071's width rule for them), mock `Compact.dc.html`; Share in the row at every width: D-095 (critic 15, supersedes the compact-width move of D-092's mock and the Share overflow item of D-086's M12).

#### Scenario: Overflow menu by keyboard
- **WHEN** at 1000×557 with the sidebar open the user does, in order:
  1. tabs to "⋯" and presses Enter
  2. changes Digits to 4 with the arrow keys
  3. tabs to "+ Values window" and presses Enter
  4. presses Shift+Tab until "Share…" in the row has focus and presses Enter, then presses Escape
- **THEN**
  - Enter opens the menu with focus on the Digits select
  - the workspace's digits become 4, and a new values window appears
  - "Share…" opens its popover from the row
  - the Escape closes the popover with focus on "Share…"
  - "⋯" has `aria-haspopup="menu"`, with `aria-expanded` true while open and false after
- **Evidence:** UI check on smart451 (focused element and `aria-expanded` read from the page after each step, `kipscope state` for digits and windows; one screenshot with the menu open)

#### Scenario: Share in the row when there is room
- **WHEN** the six-window setup is open with the sidebar open at 1440×900 and at 1000×557, and the user opens "⋯"
- **THEN** "Share…" is in the top row before "⋯", "⋯" and "?" are displayed after it, every top-row item has the same `getBoundingClientRect().top` (±1 px), and the menu holds Digits and "+ Values window" but not "Share…", at both sizes
- **Evidence:** UI check on smart451 at both sizes (tops read from the page; one screenshot with the menu open per size); `apps/web/test/bar.test.ts` › "renders the top row in order" (no Share item in the menu markup)

