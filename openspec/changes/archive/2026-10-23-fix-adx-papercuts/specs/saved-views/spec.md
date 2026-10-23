## MODIFIED Requirements

### Requirement: Top-row overflow menu
The top row SHALL end with "Share…", a "⋯" button (`aria-label` `More`) and "?" at every width. The "⋯" menu SHALL hold Digits (the segmented control of `number-format` "Digits option") and "+ Values window" and nothing else; "Share…" SHALL never move into it. The row never wraps at 1000×557 with the sidebar open nor at 1440×900 (the view title shrinks first, `10ch` at least). Each item SHALL stay usable by keyboard; opening the menu SHALL focus its first control that is not `tabindex="-1"`, which is the checked Digits button. Origin: round-2 UI finding of `add-saved-views` (851 px needed, 728 px available); design V7 "Top-row overflow rule"; Digits and "+ Values window" always in "⋯" and "?" in the row: D-092 (7) (supersedes D-071's width rule for them), mock `Compact.dc.html`; Share in the row at every width: D-095 (critic 15, supersedes the compact-width move of D-092's mock and the Share overflow item of D-086's M12); Digits as a segmented control: D-112 (1).

#### Scenario: Overflow menu by keyboard
- **WHEN** at 1000×557 with the sidebar open and digits 3 the user does, in order:
  1. tabs to "⋯" and presses Enter
  2. presses ArrowRight
  3. tabs to "+ Values window" and presses Enter
  4. presses Shift+Tab until "Share…" in the row has focus and presses Enter, then presses Escape
- **THEN**
  - Enter opens the menu with focus on the Digits button `3` (checked)
  - ArrowRight moves focus to `4`, checks it, and the menu stays open
  - the workspace's digits become 4, and a new values window appears
  - "Share…" opens its popover from the row
  - the Escape closes the popover with focus on "Share…"
  - "⋯" has `aria-haspopup="menu"`, with `aria-expanded` true while open and false after
- **Evidence:** UI check on smart451 (focused element and `aria-expanded` read from the page after each step, `kipscope state` for digits and windows; one screenshot with the menu open)

#### Scenario: Share in the row when there is room
- **WHEN** the six-window setup is open with the sidebar open at 1440×900 and at 1000×557, and the user opens "⋯"
- **THEN** "Share…" is in the top row before "⋯", "⋯" and "?" are displayed after it, every top-row item has the same `getBoundingClientRect().top` (±1 px), and the menu holds Digits and "+ Values window" but not "Share…", at both sizes
- **Evidence:** UI check on smart451 at both sizes (tops read from the page; one screenshot with the menu open per size); `apps/web/test/bar.test.ts` › "renders the top row in order" (no Share item in the menu markup)
