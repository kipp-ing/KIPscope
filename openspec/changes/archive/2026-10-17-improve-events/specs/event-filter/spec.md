## MODIFIED Requirements

### Requirement: Filter field
The filter field SHALL sit in the Events panel's `Refine` section and hold the workspace filter. While the user types, the description line, the hidden count, the heading counts and the list SHALL preview the typed filter (an invalid one shows its error and keeps the last list); Enter SHALL send `events.setFilter` and the field then shows the normal form; Escape or leaving the field SHALL restore the workspace filter. Origin: D-058 (UI and CLI share the filter); preview: add-events design F5; place: proposal E-4.

#### Scenario: Typing and Enter
- **WHEN** on smart451 the `Refine` section is open, the field holds `active changes`, the user appends ` Contactor` and presses Enter; then types `faults "` and presses Escape
- **THEN** while typing the line reads `Active faults and state changes · mentioning “contactor”` followed by ` · <k> hidden` with the count of hidden events; after Enter the field shows `active changes Contactor`, the revision rose by one, and `Refine` shows it when closed; while `faults "` is typed the line shows the unterminated-quote error in the error colour; after Escape the field shows `active changes Contactor` again
- **Evidence:** UI check on smart451 at 1440×900 (screenshots of the panel)
