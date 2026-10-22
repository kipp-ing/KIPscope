## MODIFIED Requirements

### Requirement: Event rows readable
A row SHALL show the category glyph, the local time to the ms and the category in words, then the event's name without a repeated source and its text (a change `<from> → <to>`, an inferred one with ` · after a gap`), wrapping and never cut with an ellipsis (design P4). Origin: persona test 2026-10-17 (novice: "event text cut off in the narrow list", "show the description in the list, not only on hover"); D-058 („human way of thinking"); sidebar width: D-095.

#### Scenario: Row names
- **WHEN** `rowName` runs for a signal event (source `IgnMode`, name `DCU_1F4h.IgnMode`), a state event (source `BMS`, name `BMS.contactor`), a DTC (`BMS`, `P0CA700`) and an NRC (`BMS`, `SID 22`)
- **THEN** `IgnMode`, `BMS.contactor`, `BMS P0CA700`, `BMS SID 22`
- **Evidence:** `apps/web/test/eventsPanel.test.ts` › "names rows without a repeated source"

#### Scenario: Longest text on smart451
- **WHEN** on smart451 at 1440×900 the sidebar is open (248 px wide), the filter is `all`, window 1 shows 2026-10-15 07:17:12–07:37:12 local and the user expands the `Fault memory read` row
- **THEN** the line of `P0D1A16` shows its whole 164-character text over several lines (no `…`; its element's `scrollWidth` ≤ `clientWidth`), and no row in the list has `text-overflow: ellipsis`
- **Evidence:** UI check on smart451 at 1440×900 (screenshot, `scrollWidth`/`clientWidth` read in the page)

## ADDED Requirements

### Requirement: Events count on the Events tab
While the strip's data ref has events, the sidebar's `Events` tab SHALL show after its label the number of events matching the filter, in tabular figures, with the tooltip `HINTS.eventsCount` (or the work window's "nearby" tooltip under a vehicle scope); without events the label alone. The tab's box SHALL NOT change with the number. `e` keeps opening the list with `Refine` open. Origin: D-058 („filtering never hides silently"); D-092 (strip head dropped; mock „Events 2").

#### Scenario: Tab count
- **WHEN** `sidebarTabs` gets events `{shown: 43, total: 629, sentence: "Active faults and state changes"}`, then `{shown: 0, total: 0}`, then 1,234 shown of 2,000
- **THEN** the Events tab's count is `43` with a title containing `43 events match the filter` and `629 in the recording`; then no count; then `1,234`
- **Evidence:** `apps/web/test/sidebar.test.ts` › "shows the events count on the tab"

#### Scenario: Count on smart451
- **WHEN** smart451 is shown at 1440×900 with the shipped project file and the default filter, then at 1000×557 with the sidebar open, and the user switches the events filter preset
- **THEN** the Events tab shows the number `/api/events` gives as the filtered total for smart451 (43 on 2026-10-17) at both sizes, fully visible, with the tooltip of `HINTS.eventsCount`; after the preset change the number changes and both tabs keep their boxes (±1 px)
- **Evidence:** UI check on smart451 (screenshots at both sizes, tooltip text, tab boxes before and after)
