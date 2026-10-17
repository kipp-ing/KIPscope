## MODIFIED Requirements

### Requirement: Stable "Add to" target
The explorer's "Add to" target SHALL be the marked window (workspace-layout "Marked window"), held by window ID, or "New window" while none is marked. It SHALL change only by the user's own act (a click on a window header, or a choice in the "Add to" select, which shows and sets the same mark), or fall back to "New window" when its window is removed. Creating, renaming or reordering windows, drops, cursor clicks, new revisions and query changes SHALL NOT change it. The add button SHALL name its target; Enter adds to the same target. Origin: D-020 („The "Add to" target stays where the user put it"); D-022 ("a removed target falls back to "New window""); D-027 („the user marks a window, and adds go there. The user's own act of marking sets the target").

#### Scenario: Target survives window changes
- **WHEN** windows `w1` and `w2` exist, the user marks `w2`, then a third window is created (via "New window" add or the CLI) and `w1` is renamed
- **THEN** the target is still `w2`, and the next add (button or Enter) lands in `w2`
- **Evidence:** `apps/web/test/explorer.test.ts` › "keeps the Add to target by window ID while windows change"; UI check (add T_SET after creating another window; screenshot shows it in the marked window)

#### Scenario: Removed target falls back
- **WHEN** the marked window is removed, by its menu or because a move emptied it
- **THEN** the target becomes "New window", the select shows it and no window is marked
- **Evidence:** `apps/web/test/explorer.test.ts` › "keeps the Add to target by window ID while windows change"; UI check (screenshot after dragging the marked window's only signal into another window)

#### Scenario: Add button names its target
- **WHEN** the user points at a row's add button with target `w2` titled `Speeds`
- **THEN** its tooltip and accessible name read `Add to Speeds` (`Add to new window` for "New window")
- **Evidence:** UI check (screenshot of the tooltip)

#### Scenario: Select and header mark the same window
- **WHEN** the user marks `Window 1` by a click on its header, then chooses `Window 2` in the "Add to" select, then chooses "New window"
- **THEN** after the click the select shows `Window 1` and Window 1 shows the mark; after the choice the mark is on Window 2 only; after "New window" no window shows the mark
- **Evidence:** UI check on smart451 at 1440×900 (screenshot after each step)
