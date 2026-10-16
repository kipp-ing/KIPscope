## MODIFIED Requirements

### Requirement: Zoom history
Each committed wheel zoom, wheel pan, rectangle zoom, double-click reset, "Reset", navigation key, "Go to", span preset, time-strip action and drive key SHALL be recorded; the option bar's "Back" and the Backspace key SHALL return to the previous range, up to 50 steps. While linked, all windows SHALL share one history; while unlinked, each window has its own. "Back" SHALL be disabled when there is no previous range. Origin: D-018 ("zoom history back"); D-025 (one "Back", in the bar); D-027 (new navigation undone alike); D-057 (strip actions as "Go to"; a double-click on the strip replaces its first click's entry, `time-strip` "Double-click shows the whole recording").

#### Scenario: Two steps back
- **WHEN** the user zooms a V_ANZ window from its full extent into the morning of 2026-10-13, then into 09:56–09:58, then presses Backspace twice with the pointer over the window
- **THEN** the window shows the morning range, then the full extent, and the bar's "Back" is disabled
- **Evidence:** UI check (screenshots of the header after each step); `apps/web/test/zoom.test.ts` › "keeps a bounded zoom history", "shares one history while linked"

#### Scenario: Strip steps back
- **WHEN** a smart451 window at its full extent gets a strip drag over one local day, then a click on a drive segment, then Backspace twice with the pointer over the window
- **THEN** the window shows the dragged day, then the full extent; if the browser tool cannot drag, the drag is replaced by `.` (a drive key) and the check runs the same way
- **Evidence:** UI check on smart451 at 1440×900 (header after each step)
