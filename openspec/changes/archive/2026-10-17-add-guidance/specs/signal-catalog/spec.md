## MODIFIED Requirements

### Requirement: Stable "Add to" target
The explorer's "Add to" target SHALL be the marked window (workspace-layout "Marked window"), held by window ID, or "New window" while none is marked. It SHALL change only by the user's own act: a click that ends inside a window, or a choice in the "Add to" select, which shows and sets the same mark. It SHALL fall back to "New window" when its window is removed. The select's tooltip SHALL say that a click on a window chooses it. Origin: D-020 (target stays); D-022 (fallback); D-027 (marking sets the target); Jan 2026-10-17 („the window clicked last"), pending G-1.

#### Scenario: Removed target falls back
- **WHEN** the marked window is removed, by its menu or because a move emptied it
- **THEN** the target becomes "New window", the select shows it and no window is marked
- **Evidence:** `apps/web/test/explorer.test.ts` › "keeps the Add to target by window ID while windows change"; UI check (screenshot after dragging the marked window's only signal into another window)

#### Scenario: Select and header mark the same window
- **WHEN** the user marks `Window 1` by a click into its plot (or its header), then chooses `Window 2` in the "Add to" select, then chooses "New window"
- **THEN** after the click the select shows `Window 1` and Window 1 shows the mark; after the choice the mark is on Window 2 only; after "New window" no window shows the mark
- **Evidence:** UI check on smart451 at 1440×900 (screenshot after each step)

### Requirement: "Add to" target ignores other changes
Creating, renaming or reordering windows, drops, drags, new revisions and query changes SHALL NOT change the "Add to" target. A window created by an explorer add or a drop SHALL NOT become the target. Origin: D-020 („The "Add to" target stays where the user put it; creating, renaming or reordering windows does not move it"); D-027 (marking, not „follow the new window"); pending G-2 (design.md). Cursor clicks inside a window now mark it (workspace-layout "Marked window", pending G-1).

#### Scenario: Target survives window changes
- **WHEN** windows `w1` and `w2` exist, the user marks `w2`, then a third window is created (via "New window" add or the CLI) and `w1` is renamed
- **THEN** the target is still `w2`, and the next add (button or Enter) lands in `w2`
- **Evidence:** `apps/web/test/explorer.test.ts` › "keeps the Add to target by window ID while windows change"; UI check (add T_SET after creating another window; screenshot shows it in the marked window)

#### Scenario: New window is not the target
- **WHEN** no window is marked and the user adds `BRK_1A0h.WSPD_FL` with Enter
- **THEN** a new window shows WSPD_FL, is scrolled into view and flashes, the "Add to" select still shows "New window" and no window is marked
- **Evidence:** UI check on smart451 (screenshot within 1 s of Enter, the select's value)
