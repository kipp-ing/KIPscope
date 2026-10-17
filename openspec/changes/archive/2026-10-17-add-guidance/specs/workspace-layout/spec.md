## MODIFIED Requirements

### Requirement: Marked window
The user SHALL mark a window by a click that ends inside it, anywhere: header, title, plot (where the click also places cursor A or B), legend, values table or a control. The user can also choose it in the explorer's "Add to" select. At most one window is marked. A drag that starts in one window and ends in another, and a drop, SHALL NOT mark. The marked window SHALL show its frame 2 px wide in the accent (`#0284c7`: 1 px border plus a 1 px outer ring, so nothing moves) and an "Add to" pill (accent soft fill, accent ink) after its title. The pill SHALL NOT be truncated and SHALL NOT move the header's controls, and the header's truncation order stays (range first, then the title). Explorer adds by Enter or a row's add button SHALL go to the marked window, or to a new window while none is marked. Origin: D-027 („the user marks a window, and adds go there"); Jan 2026-10-17 („the window the signal goes to maybe could be the window clicked last and (new) outline highlighted"), pending G-1 (design.md); pill: D-055 (mock pill `#e0f2fe` / `#075985`); frame colour changed from the mock's `#7dd3fc`, pending G-1.

#### Scenario: Mark and add
- **WHEN** the six-window setup is shown, the user clicks the empty part of window 4's header, then presses `/`, types `T_SET` and presses Enter
- **THEN** window 4's border colour is `rgb(2, 132, 199)` and its `box-shadow` contains `rgb(2, 132, 199) 0px 0px 0px 1px`; its header shows the "Add to" pill with background `rgb(224, 242, 254)` after the title; no other window shows either; `CLIM_A1.T_SET` appears in window 4; the number of windows is still six
- **Evidence:** UI check on smart451 at 1440×900 (screenshot after the click and after Enter, computed values)

#### Scenario: Values window marked
- **WHEN** the user clicks the title of a values window once and adds `ICL_3A2h.SPEED_DISP` with the row's add button
- **THEN** the values window is marked (ring frame and "Add to" pill) and lists SPEED_DISP; with A, B and Diff on in a 480 px values window with a 40-character title, the cursor times still follow "Cursor times drop their date" and Δt stays visible
- **Evidence:** UI check on smart451 (screenshot of both states)

#### Scenario: No mark, new windows
- **WHEN** no window is marked and the user adds `BRK_1A0h.WSPD_FL` and then `ENG_5E0h.T_ENG` with Enter
- **THEN** each lands in its own new window, and neither new window is marked
- **Evidence:** UI check on smart451 (screenshot after the second Enter)

#### Scenario: A click anywhere marks
- **WHEN** window 2 is marked and the user clicks into window 3's plot, then into window 5's legend row, then window 6's mode select
- **THEN** after the plot click window 3 is the only marked window, cursor A moved to the click, and the "Add to" select shows window 3; after the legend click window 5; after the select window 6
- **Evidence:** UI check on smart451 (screenshot after each click, the select's value)

#### Scenario: Other gestures do not mark
- **WHEN** window 2 is marked and the user scrolls the list, presses `+` and `←` with the pointer over window 3, drags a legend row from window 3 onto window 4, and drags an explorer row onto window 5
- **THEN** window 2 is still the only marked window and the "Add to" select still shows it
- **Evidence:** UI check on smart451 (screenshot after the last step)

#### Scenario: Click target helper
- **WHEN** `markTarget` gets a fake element whose `closest("[data-window-id]")` returns an element with `data-window-id` `w7`, one whose `closest` returns null, and null
- **THEN** it returns `w7`, undefined, undefined
- **Evidence:** `apps/web/test/reveal.test.ts` › "finds the window of a click"

#### Scenario: Refused add keeps the target
- **WHEN** the marked window shows four units and the user adds `ENG_2E8h.MOT_SPD_D` with Enter
- **THEN** the add is rejected with `too_many_units` in the status strip, no new window is created and the mark stays
- **Evidence:** UI check on smart451 (screenshot, window count before and after)
