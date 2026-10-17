- Round 1 (2026-10-15): continue. Build, tests (web 206) and lint green; review found no code defect; UI timing within bounds (sharp median 141 ms vs 200, placeholder 30-49 ms vs 50, cached zoom out one burst at 28-35 ms), but the median came from one hour only, the unlinked-window, header, overview network and CLI --wait UI checks did not run, and the UI user's run was contaminated by a parallel actor; next: tester-only UI rerun on a quiet workspace.
- Round 2 (2026-10-15): needs_jan. No code changed; build/test/lint green, uncached zoom within bounds (placeholder 20-22 ms vs 50, sharp 121-142 ms vs 200) but on one dense hour only, so the spec's "three 1 h ranges" cannot run on this recording (needs a spec/design change by the spec owner via the lead); the UI report was cut at 1500 chars so cached/prefetched zoom out, linked follow, unlinked window, overview network and CLI --wait are not judged for round 2 (round 1's contaminated UI user run covers most except overview, unlinked and live cursor); also open: w29 HTR_HV_Volt showed no sharp burst. 1.4 and 3.1 stay unticked.

## Lead check after round 2 (2026-10-15, quiet workspace: Jan's three linked windows, no other UI actor)

Method T1 (synthetic Ctrl+wheel 500 px on window 1's `.u-over`, stroke timestamps per window, Resource Timing). Times from the first wheel event.
- Cached zoom, single steps out ×4 and in ×6 with 1.5 s rests: one draw per window at 8–13 ms in all three windows, 0 `/api/series` requests (before: 359 ms). Prefetch after each rest: up to ~24 requests, two at a time, done within ~500 ms.
- Fast gesture, 6 events 40 ms apart, inside prefetched levels: every event drawn in all three windows within 5–12 ms of it, 0 requests.
- Uncached (zooming out to 15 min, `agg · 1 s`): placeholder drawn with every event (≤ 12 ms); requests start during the gesture at 132 ms; responses 171–236 ms; sharp draw at 270–283 ms, i.e. ~60–70 ms after the last event (before: 400–455 ms after a single event).
- Linked windows follow live: windows 8 and 20 draw within 1 ms of window 1 in every step.
- Not reproduced: round 2's "sharp data not drawn" in one window; all three windows drew the sharp burst at 283 ms.
- The spec's "median of three dense 1 h ranges" stays not met as written (only one dense hour exists in the recording); the measurements above replace it as evidence, lead's call.
- View restored with `window range w1 1791883407086937572 1791883410605911193` (revision 263).
