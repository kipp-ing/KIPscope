## MODIFIED Requirements

### Requirement: Time strip
Below the context row (below the top row when there is none), sticking with them, the page SHALL show the time strip for the data ref of the bar target's first signal, else of the first signal in any window, as a track only: bars, event pins, the drive row and the shown-range window, with no head line, no `TIME` label and no range text (the range control shows the range). Its info `<shown> of <recorded> recorded · 1 bar = <width>`, spans in the largest of y (365 d), d, h, min, s, ms they reach, one decimal at most, no `.0`, SHALL be the first line of the track's tooltip (its second line the hint `Time strip: …`) and the last line of every bar's tooltip ("Strip tooltips"). While a signal is dragged over the strip, its drop text ("Signal drop on the strip") SHALL show inside the track's box. Pointer and keys act as "Strip actions are range commands" says. Origin: D-055 (time strip on); D-057 supersedes "Clicking does nothing"; no head line: D-092 (1) (the range button replaces the strip's range text) and the designer's finding (at 1000 px the range label collapsed to 0 px); goal height 44 px: mock `Main.dc.html` (×2 = 88 px would cost the plot share of "Screen use"; ×½ = 22 px is less than the 24 px bars).

#### Scenario: Strip on real data
- **WHEN** the six-window setup is shown on smart451 at 1440×900 and window 1 is zoomed from its full extent to a 20 min range
- **THEN** the strip shows no `TIME` label and no range text; the track's `title` starts with `… recorded · 1 bar = …` (or `… in scope · 1 bar = …` with a scope); its bars are grey where smart451 has data; after the zoom only the bars overlapping those 20 min are in `rgb(2, 132, 199)` (one or a few) and the track's `title` starts with `20 min of`; the strip is ≤ 56 px tall in both states (goal ≤ 44 px, reported)
- **Evidence:** UI check on smart451 at 1440×900 (screenshot before and after the zoom, the track's `title`, strip height)

### Requirement: Time strip states
Without a signal the track SHALL show `No signal shown` in the muted colour inside its box; while loading, skeleton bars (slate-200, 3 px high, no accent, no window) with the track tooltip `Loading recording…`; after a failure `Recording unavailable` in the muted colour inside the track's box, the failure as tooltip, retrying every 30 s; without a timeseries window no accent bars and no window. The strip SHALL be at most 56 px tall, the same in every state, and SHALL keep the plot share of `workspace-layout` "Screen use". Origin: necessary consequence (the strip must not move windows or hide data); 30 s: the load retry cap of D-042; 56 px: design T8 of `adopt-design-language`; loading state in the loaded state's box: D-092 („Layout never moves").

#### Scenario: Strip states
- **WHEN** the workspace has no window; then only a values window with one signal; then the source is unreachable at page load
- **THEN** the track shows `No signal shown`; then the bars with a track tooltip `<recorded> recorded · 1 bar = …` and no accent bars; then `Recording unavailable` in the muted colour, and the bars appear without a reload within 30 s after the source is back; the strip's height is the same in all three states (±0.5 px) and no window moves when it changes
- **Evidence:** UI check (screenshot per state, strip heights); `apps/web/test/strip.test.ts` › "takes the data ref of the target window, else of any window"

#### Scenario: Screen use with the strip
- **WHEN** the six-window setup is shown at 1000×557 with the sidebar open and the strip loaded
- **THEN** the plot share from design M1's snippet is at least 30 % (`workspace-layout` "Screen use")
- **Evidence:** UI check on smart451 at 1000×557 (snippet output, screenshot)

### Requirement: Strip tooltips
A bar SHALL have the tooltip `<local start> – <local end> · <rows>` with the strip's info as its second line, and a drive `Drive <k> of <n> · <local from> – <local to> · <span> · <rows>`, times as in the window header, rows as `no rows`, `1 row` or `<count with thousands commas> rows`. The window and markers SHALL NOT hide a bar's tooltip. Origin: D-057 („a bar's tooltip gives its time range and rows"); drive tooltip: necessary consequence of drives without names; the info line: D-092 (the strip head's info becomes the strip's tooltip).

#### Scenario: Tooltip text
- **WHEN** the tooltips of `drivecar`'s bar 12 and drive 1 are formatted in Europe/Berlin with the info `19 s of 6 d recorded · 1 bar = 3 h`, and of a bar with 0 and with 1 row
- **THEN** `2026-10-02 03:00:00 – 2026-10-02 03:05:00 · 30,030 rows` followed by the line `19 s of 6 d recorded · 1 bar = 3 h`, and `Drive 1 of 3 · 2026-10-02 03:00:00 – 2026-10-02 03:30:00 · 30 min · 177,180 rows`; `… · no rows`, `… · 1 row`
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "formats bar and drive tooltips"

#### Scenario: Tooltip under the window
- **WHEN** window 1 shows a 2 h range on smart451 and the pointer rests on a bar under the window
- **THEN** that bar's tooltip shows (the `title` of the element under the pointer names the bar's hour and ends with the strip's info line)
- **Evidence:** UI check on smart451 at 1440×900 (`document.elementFromPoint` at the bar's centre and its `title`, screenshot)

### Requirement: Strip shows the scope
While the workspace has a scope, the strip SHALL show the scope's data ref whatever the windows hold, and its info (the tooltip line of "Time strip") SHALL read `<shown> of <span> in scope · 1 bar = <width>`; in scoped mode without a scope the track SHALL show `No scope set`. Double-click, drive clicks and drive keys then act within the scope. Origin: issue #1 item 4 („The time strip … cover[s] only the scope's range"); D-078; info as tooltip: D-092.

#### Scenario: Label with a scope
- **WHEN** `stripLabel` gets the range [T1 + 10 min, T1 + 20 min), a density with `scope` [T1, T2) and width 30 s
- **THEN** it reads `10 min of 1 h in scope · 1 bar = 30 s`; without `scope` the label is the existing `… recorded …` text
- **Evidence:** `apps/web/test/strip.test.ts` › "labels the shown span within the scope"

#### Scenario: Data ref of the strip
- **WHEN** the strip's data-ref choice gets a workspace with scope on `testcar` whose only window shows `othercar/Fast_100h.SIG_A`, and the same workspace without scope
- **THEN** it gives `testcar`, then `othercar`
- **Evidence:** `apps/web/test/strip.test.ts` › "takes the scope's data ref"

### Requirement: Strip scope controls
With a scope and no open catalog, the context row SHALL show the scope in the session bar's slots: label `SCOPE`, the data ref in the title slot, the scope's local times in the times slot (as "Session times across midnight" of `case-navigation` formats them), its span in the duration slot, **Widen** (one `scope.set`, scope "Widen") in the action slot and, in full mode only, **Clear** (`scope.clear`) in a second 64 px action slot after it; no arrows and no position. While a catalog is open, the row SHALL show the session bar instead (case-navigation "Session bar"), with no Widen and no Clear. Without scope and catalog there SHALL be no context row. Origin: D-078 („widening it is an explicit step"); Clear: design Q-1 (a) of `add-scope`; session bar: D-086, Q-6 (a); same row and slots: D-092 (the strip head goes, „stable and clean").

#### Scenario: Scope on smart451
- **WHEN** Jan's view is open on smart451 in full mode with a scope of 2026-10-13 14:00 – 16:00 local, at 1440×900 and at 1000×557; the user double-clicks the strip, clicks **Widen**, then **Clear**
- **THEN** the context row reads `SCOPE smart451 Tue 2026-10-13  14:00:00 – 16:00:00 2 h Widen Clear` on one line (`SCOPE` left out at 1000×557) and the strip ≤ 56 px tall at both sizes; the double-click makes the shown range 14:00 – 16:00; after Widen the row reads 12:00:00 – 18:00:00 with Widen at the same x (±1 px) and the explorer reloaded; after Clear the context row is gone and the bars span the whole recording again
- **Evidence:** UI check on smart451 (one screenshot per step, strip height at both sizes)

#### Scenario: Head with a catalog
- **WHEN** the context row renders a workspace with a scope and an open catalog, linked and unlinked, and a workspace with neither
- **THEN** it renders the session bar in both case states and neither Widen nor Clear; for the third it renders nothing
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "renders the context row for a case, a scope or neither"

## REMOVED Requirements

### Requirement: Events count in the strip head
**Reason**: The strip head line is dropped (D-092; mock `Main.dc.html`: „Events 2" on the sidebar tab).
**Migration**: The count moves onto the sidebar's Events tab (`events` "Events count on the Events tab"), with the same tooltip; `e` still opens the list with `Refine` open.
