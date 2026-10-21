## MODIFIED Requirements

### Requirement: Align from an event
While linked, a strip pin's context menu and an events-list row SHALL offer `Align sessions to this event`, which SHALL send `case.align` with that event's match and `at` its time; the Align menu SHALL offer `Session start`, `Session end` and `Anchor from the finder` (disabled when no session has an anchor) and show the event in event mode. Align to an event SHALL be offered only on a shown event (pin, events-list row or fault-memory read), so a source without an events table (`source.events` `none`) and a workspace without events-line signals offer it nowhere. Origin: Jan's tuned dashboard („every session has an event, the dashboard is tuned to it", exploration); D-086 Q4; offered only on an event: finder finding (issue #1, comment 2026-10-21), state changes of events-line signals still being events.

#### Scenario: Row action
- **WHEN** the events list renders a DTC row at 05:00:00 while a case is linked, and the same row without a case
- **THEN** the first has an `Align` action that sends `case.align {align: {mode: "event", event: {kind: "dtc", …}}, at: "1790830800000000000"}`; the second has none
- **Evidence:** `apps/web/test/eventsPanel.test.ts` › "offers Align on an event row"

#### Scenario: No events, no Align
- **WHEN** a case is linked, the events list renders an empty events answer (`total` 0, no events-line signals), and `alignItems` gets align `start` for C4
- **THEN** the list holds no `Align` action, and the Align menu items are exactly `Session start`, `Session end` and `Anchor from the finder`
- **Evidence:** `apps/web/test/eventsPanel.test.ts` › "offers no Align without events"; `apps/web/test/sessionBar.test.ts` › "offers start, end, anchor and the chosen event"

#### Scenario: Align on smart451
- **WHEN** on smart451 the user right-clicks the first ignition pin of drive 1, chooses `Align sessions to this event`, zooms to ±30 s around it, and presses `]`
- **THEN** the Align menu reads the event, and drive 2 shows its first ignition change at the same place in the window (header times ±30 s around it), or the message `No <name> in this session; aligned to its start.`
- **Evidence:** UI check on smart451 (one screenshot before and after the step)
