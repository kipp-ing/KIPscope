# Spec Delta

## MODIFIED Requirements

### Requirement: Navigation stops at the scope edge
While the workspace has a scope, every navigation (keys, wheel, "Go to", presets, Home, Back, strip actions, drive keys) SHALL end inside it through the server's clamp, and none SHALL change the scope. When a result carries `clamped`, the message line SHALL show `Stopped at the scope edge. Widen shows more.`; with a linked catalog `Stopped at the session edge. Unlink shows the whole vehicle.`, and in an object scope `Stopped at the end of the vehicle's data.` Origin: D-078 („navigation stops there, widening it is an explicit step"); the ADX feedback item 4; session and vehicle wording: D-086 (Unlink replaces Widen in a case workspace).

#### Scenario: Message on a clamped result
- **WHEN** the UI's command handler gets `{ok: true, revision: 9, clamped: true}` for a `window.setRange`, and then `{ok: true, revision: 10}`
- **THEN** the first sets the message `Stopped at the scope edge. Widen shows more.`, and the second sets none
- **Evidence:** `apps/web/test/zoom.test.ts` › "reports a range stopped at the scope edge"

#### Scenario: Message in a case workspace
- **WHEN** the handler gets `{ok: true, revision: 9, clamped: true}` for a `window.setRange` in a workspace with a linked catalog, and again with the catalog unlinked
- **THEN** it shows `Stopped at the session edge. Unlink shows the whole vehicle.`, then `Stopped at the end of the vehicle's data.`
- **Evidence:** `apps/web/test/zoom.test.ts` › "reports a range stopped at the session edge"

#### Scenario: Zoom out and pan on smart451
- **WHEN** a smart451 window shows 14:50 – 15:10 local inside a scope of 14:00 – 16:00, and the user presses `-` three times, then Shift+`→` twice, then types `2026-10-12` into "Go to"
- **THEN** the header shows 14:40 – 15:20, 14:20 – 15:40, then 14:00 – 16:00 with the message; the pans leave it at 14:00 – 16:00 (span kept, at the edge); "Go to" also gives 14:00 – 16:00 with the message; the scope in the strip head is unchanged throughout
- **Evidence:** UI check on smart451 (header and message after each step)
