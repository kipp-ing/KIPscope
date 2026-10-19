# time-navigation delta

## ADDED Requirements

### Requirement: Navigation stops at the scope edge
While the workspace has a scope, every navigation (keys, wheel, "Go to", presets, Home, Back, strip actions, drive keys) SHALL end inside it through the server's clamp, and none SHALL change the scope. When a result carries `clamped`, the message line SHALL show `Stopped at the scope edge. Widen shows more.` Origin: D-078 („navigation stops there, widening it is an explicit step"); issue #1 item 4.

#### Scenario: Message on a clamped result
- **WHEN** the UI's command handler gets `{ok: true, revision: 9, clamped: true}` for a `window.setRange`, and then `{ok: true, revision: 10}`
- **THEN** the first sets the message `Stopped at the scope edge. Widen shows more.`, and the second sets none
- **Evidence:** `apps/web/test/zoom.test.ts` › "reports a range stopped at the scope edge"

#### Scenario: Zoom out and pan on smart451
- **WHEN** a smart451 window shows 14:50 – 15:10 local inside a scope of 14:00 – 16:00, and the user presses `-` three times, then Shift+`→` twice, then types `2026-10-12` into "Go to"
- **THEN** the header shows 14:40 – 15:20, 14:20 – 15:40, then 14:00 – 16:00 with the message; the pans leave it at 14:00 – 16:00 (span kept, at the edge); "Go to" also gives 14:00 – 16:00 with the message; the scope in the strip head is unchanged throughout
- **Evidence:** UI check on smart451 (header and message after each step)

### Requirement: Windows load again on a scope change
When the workspace's scope key changes (Widen, Clear, open, `scope set`), every window SHALL request its data again, failed, loading and complete keys alike, SHALL keep what it shows until the new answer arrives, and SHALL drop a late answer of the old request. Origin: necessary consequence of scope "Routes are bounded by the scope" (data cut to the old scope, or a 409 `out_of_scope` under it, is wrong under the new one); finding of round 2 (windows did not re-query after Widen/Clear).

#### Scenario: Windows recover after Widen, Clear or open
- **WHEN** a series loader holds one key that failed (server down) and one complete key, and the scope changes, and both new requests answer
- **THEN** both keys are fetched again (4 calls in all), both end `complete` without an error, and the loader is settled; in the UI on smart451 a window that showed an error or the old scope's data shows the new scope's data after Widen and after Clear, without a reload
- **Evidence:** `apps/web/test/rescope.test.ts` › "windows recover after Widen, Clear or open"; UI check on smart451 (window after Widen and after Clear)
