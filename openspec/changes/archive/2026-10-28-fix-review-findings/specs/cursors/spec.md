## MODIFIED Requirements

### Requirement: Placing cursors by click
In a timeseries plot, a click without pointer movement (below 4 px) SHALL place cursor A at the clicked time, and a Shift+click SHALL place B. Both switch the cursor on if it was off. The click SHALL send one `cursor.set` once the double-click interval has passed. The line SHALL appear at once, and a double-click SHALL place no cursor. A window that closes while its click waits for the double-click interval SHALL drop that click: no `cursor.set` is sent and its line SHALL vanish from every window at once. Origin: concept §6 (cursors are placed in the windows); D-023; gesture choice in design C3; a closing window: review day 2026-10-28 T-07 (the gate dropped the click on unmount, but the line already shown in every window stayed as a ghost).

#### Scenario: Click and Shift+click
- **WHEN** A and B are off and the user clicks window 1 at about 13:08:01Z, then Shift+clicks at about 13:08:02Z
- **THEN** a line "A" appears at the first spot and a line "B" at the second, the option bar's A and B toggles are checked, and the revision rose by exactly two
- **Evidence:** UI check (screenshot, revision before and after)

#### Scenario: Double-click resets zoom only
- **WHEN** A is at 13:08:01.5Z and the user double-clicks window 1 elsewhere
- **THEN** the zoom resets as before ("Double-click resets zoom") and A stays at 13:08:01.5Z
- **Evidence:** `apps/web/test/cursors.test.ts` › "commits a click only after the double-click interval"; UI check (screenshot of the values window header before and after)

#### Scenario: Rectangle zoom still zooms
- **WHEN** the user drags a rectangle of about 200 px in window 1
- **THEN** the window zooms to the rectangle and no cursor moves
- **Evidence:** UI check (screenshot, cursor times in the values window header unchanged)

#### Scenario: Placed times are short
- **WHEN** a click lands at 1791896881512345678 ns in a window spanning 3 s
- **THEN** the cursor is placed at 1791896881512000000 (snapped to 1 ms, the largest power of ten in ns that is at most span/1000)
- **Evidence:** `apps/web/test/cursors.test.ts` › "snaps cursor times to a power of ten below a thousandth of the span"

#### Scenario: Waiting click of a closing window
- **WHEN** the click helper of a window (fake timer, interval 500 ms) gets a click for A at t = 10; then, before 500 ms, the window closes (the helper is disposed); then the fake timer runs past 500 ms; separately it gets a click for A at 10, then within the interval a click for B at 20, then the window closes; separately a click for A at 10 followed by a double-click
- **THEN** in the first case the preview callback was called with `(a, 10)` and then `(a, undefined)`, and the commit callback never; in the second, A is committed at once with 10 when B's click arrives, the preview gets `(b, 20)` and on close `(b, undefined)`, and B is never committed; in the third the preview ends with `(a, undefined)` and nothing is committed
- **Evidence:** `apps/web/test/cursors.test.ts` › "drops a waiting click and its line when the window closes"

#### Scenario: No ghost line on smart451
- **WHEN** on smart451 at 1440×900 two linked timeseries windows w1 and w2 are open, A is off, and the UI user runs one page script that dispatches a pointer click without movement on w2's plot (`pointerdown`, `mousedown`, `pointerup`, `mouseup`, `click` at the same point) and, in the same task, sends `POST /api/w/<id>/commands {type: "window.remove", windowId: "w2"}`; then waits 1 s (a real click and a removal by hand cannot fit into 500 ms, so the script stands in for them)
- **THEN** w2 is gone; w1 has no displayed `.cursor-line.cursor-a` (each has `style.display` `none` or none exists); the A toggle in the option bar is not checked; `kipscope state` shows no cursor A and a revision exactly one above the one before (the removal only)
- **Evidence:** UI check on smart451 (the script and its read-back printed from the page; `kipscope state` before and after; one screenshot of w1 after the wait)

### Requirement: Keys bring a cursor into view
Outside text fields and selects, without Ctrl, Meta or Alt, while no drag runs and the range picker is closed, Shift+A and Shift+B SHALL centre the bar target's span on cursor A or B (span kept) with one `window.setRange` and one history entry, as its strip flag does (time-strip "Cursor markers on the strip"); with that cursor off they SHALL do nothing. The Keys tab SHALL list them. With Caps Lock on, Shift+A and Shift+B SHALL do the same (the browser reports them as `a` and `b` with Shift), and A or B without Shift SHALL stay unbound. Origin: D-095 (critic 13: Shift+A / Shift+B bring A or B into view); Caps Lock: review day 2026-10-28 T-08 (`e.key` was compared literally, so Shift+A did nothing with Caps Lock on).

#### Scenario: Key mapping
- **WHEN** the key handler gets `A` with Shift, `B` with Shift, `a` without Shift, `A` with Shift and Ctrl, `A` with Shift in the explorer search, and `A` with Shift while the range picker is open
- **THEN** `cursorA`, `cursorB`, nothing for the last four (lower-case `a` stays unbound)
- **Evidence:** `apps/web/test/keys.test.ts` › "maps Shift+A and Shift+B to bring a cursor into view"; `apps/web/test/hints.test.ts` › "keeps every hint within the wording rule" (`Shift+A` and `Shift+B` in `SHORTCUTS`)

#### Scenario: Key mapping with Caps Lock
- **WHEN** the key handler gets `a` with Shift, `b` with Shift (Caps Lock on, Shift held), `A` without Shift and `B` without Shift (Caps Lock on, no Shift), `a` with Shift and Meta, and `b` with Shift while the range picker is open
- **THEN** `cursorA`, `cursorB`, and nothing for the last four
- **Evidence:** `apps/web/test/keys.test.ts` › "maps Shift+A and Shift+B with Caps Lock on"

#### Scenario: Keys on smart451
- **WHEN** at 1440×900 A is at 2026-10-13 15:09 local and B is off, window 1 shows a 20 min range on 2026-10-17, and the user presses Shift+A, then Shift+B, then Backspace
- **THEN** after Shift+A the range button shows a 20 min range centred on A (`26-10-13 14:59` and `0:20 h`), revision +1; Shift+B changes nothing (revision unchanged); Backspace returns to the range on 2026-10-17
- **Evidence:** UI check on smart451 (range button and revision after each key)
