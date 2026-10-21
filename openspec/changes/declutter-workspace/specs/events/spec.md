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
