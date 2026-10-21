## ADDED Requirements

### Requirement: Own range of an unlinked window
While "Link time axes" is off, each timeseries window's header SHALL show its own range in its range slot as small muted start and duration (range-picker "Start and duration"), equal to the plotted range also during a preview, truncated first, the formatter's `tip` as tooltip. Origin: D-092 (1) („a window with link off shows its own range"); D-093; D-095; preview: "Header shows the plotted range". A linked window's header is `declutter-workspace`'s.

#### Scenario: Own range text
- **WHEN** `ownRangeText` gets 2026-10-13T13:06:03Z–13:18:33Z with link off, and the same with link on
- **THEN** `26-10-13 15:06  0:12 h` with the tooltip `Tue 2026-10-13 15:06 · Duration 12 min`, then nothing
- **Evidence:** `apps/web/test/rangeLine.test.ts` › "shows a window's own range only while unlinked"

#### Scenario: Two unlinked windows
- **WHEN** "Link time axes" is off on smart451, window 1 shows a 20 min range and window 2 was zoomed to 2026-10-13 15:08:00 – 15:09:00, then window 2 is wheel-zoomed once
- **THEN** window 1's header shows its 20 min range (`… 0:20 h`), window 2's header `26-10-13 15:08  0:01 h`, then its new range matching its axis during and after the zoom; the range button shows window 2's range
- **Evidence:** UI check on smart451 at 1440×900 (screenshot of both headers and the button after each step)

## MODIFIED Requirements

### Requirement: Option bar
Above the windows, an option bar SHALL stay visible while the window list scrolls. It SHALL hold, in this order: the cursor toggles "A", "B" and "Diff" (cursors spec), "Link time axes", the range button (range-picker), "Back", "Reset", the digits option (number-format) and "+ Values window". Origin: D-023 (cursor toggles, diff mode, "Link time axes", zoom back and reset in a bar); D-025 (one "Back", one "Reset"); D-027 (time navigation); D-026 (digits option); D-092 (1), (2) (range button, no Span select).

#### Scenario: Scrolled down
- **WHEN** six windows exist and the list is scrolled to the end
- **THEN** the option bar is fully visible above the windows with its controls in that order, and neither the row nor its ⋯ menu holds a Span select
- **Evidence:** UI check (screenshot of the row and of the open ⋯ menu)

### Requirement: Linked time zoom
While the time axes are linked, wheel zoom, wheel pan, rectangle zoom, double-click reset, history back, "Reset", navigation keys and the range picker in or for any window SHALL change the time range of all windows. During a wheel, pan or key gesture in one window, every linked window SHALL show and load the previewed range in the same frame, each at its own resolution; the range command SHALL still be sent once, by the gesture's window. While unlinked, each window SHALL keep its own range. Origin: D-017; D-027; D-041; D-092.

#### Scenario: Zoom one of two linked windows
- **WHEN** "Link time axes" is on, window 1 shows `ICL_3A2h.SPEED_DISP`, window 2 shows `DCU_2B8h.HTR_HV_Volt`, and the user Ctrl+wheel-zooms in window 1
- **THEN** within 1 s window 2's time axis shows the same range as window 1 and its curve is reloaded for it
- **Evidence:** UI check (screenshot of both axes); `packages/shared/test/apply.test.ts` › "applies a range to all windows while linked"

#### Scenario: Linked windows follow the gesture
- **WHEN** the two linked windows have rested 2 s on one hour and one Ctrl+wheel event arrives over window 1 (design T1 of change `improve-zoom-speed`)
- **THEN** window 2 draws the new range in its first stroke burst within 50 ms of the wheel event: from the cache with no further burst when its tiles are cached (zoom out, steps 3–4), as a placeholder followed by its sharp data within 200 ms when they are not (zoom in, step 2); one `window.setRange` command is sent, about 300 ms after the event
- **Evidence:** UI timing check (design T1, per-window `bursts` and per-signal `series`); `apps/web/test/linkedPreview.test.ts` › "shows the own preview, else the linked shared one, else the server range" and "publishes synchronously and clears only for the current source"

#### Scenario: Zoom one of two unlinked windows
- **WHEN** the user switches "Link time axes" off and zooms window 1
- **THEN** window 2 keeps its time range, also during the gesture
- **Evidence:** UI check (screenshot); `packages/shared/test/apply.test.ts` › "applies a range to one window while unlinked"; `apps/web/test/linkedPreview.test.ts` › "shows the own preview, else the linked shared one, else the server range"

### Requirement: Zoom history
Each committed wheel zoom, wheel pan, rectangle zoom, double-click reset, "Reset", navigation key, range picker apply, time-strip action and drive key SHALL be recorded; the option bar's "Back" and the Backspace key SHALL return to the previous range, up to 50 steps. While linked, all windows SHALL share one history; while unlinked, each window has its own. "Back" SHALL be disabled when there is no previous range. Origin: D-018; D-025; D-027; D-057 (strip actions as "Go to"; a strip double-click replaces its first click's entry); D-092.

#### Scenario: Two steps back
- **WHEN** the user zooms a SPEED_DISP window from its full extent into the morning of 2026-10-13, then into 09:56–09:58, then presses Backspace twice with the pointer over the window
- **THEN** the window shows the morning range, then the full extent, and the bar's "Back" is disabled
- **Evidence:** UI check (screenshots of the range button after each step); `apps/web/test/zoom.test.ts` › "keeps a bounded zoom history", "shares one history while linked"

#### Scenario: Strip steps back
- **WHEN** a smart451 window at its full extent gets a strip drag over one local day, then a click on a drive segment, then Backspace twice with the pointer over the window
- **THEN** the window shows the dragged day, then the full extent; if the browser tool cannot drag, the drag is replaced by `.` (a drive key) and the check runs the same way
- **Evidence:** UI check on smart451 at 1440×900 (range button after each step)
