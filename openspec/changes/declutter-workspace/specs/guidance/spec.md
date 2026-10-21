## MODIFIED Requirements

### Requirement: Help panel
The app SHALL have a help panel with two tabs, *Manual* and *Keys*. It SHALL be non-modal: windows, top row and signal list stay usable while it is open. It SHALL sit at the right, between the top row and the status strip, at most 360 px wide, and close with its × button, with the key or button that opened it, or with Esc. Its "?" button SHALL be the top row's last item at every width (never an item of the "⋯" menu). Origin: Jan 2026-10-17 („we need a manual"); placement: proposal G-1 … G-4, D-072 (G-3) (design H7); "?" always in the row: D-092 (mock `Compact.dc.html`).

#### Scenario: Open, use, close
- **WHEN** on smart451 at 1440×900 the user clicks the "?" button at the end of the top row, then clicks cursor A's pill while the panel is open, then presses Esc
- **THEN** the panel opens on the Manual tab, at most 360 px wide (`getBoundingClientRect().width`), its top at or below the top row's bottom and its bottom at or above the status strip's top; the A pill click still switches A on (revision +1); after Esc the panel is gone
- **Evidence:** UI check on smart451 at 1440×900 (screenshot with the panel open, rects, revision before and after)

#### Scenario: Top row still one line
- **WHEN** the six-window setup is shown with the sidebar open at 1000×557 and at 1440×900
- **THEN** the sidebar button, "Reset", "⋯" and "?" (26 px tall) share one `getBoundingClientRect().top` (±1 px) in each viewport, "?" is the row's last item, and the "⋯" menu holds no Help item
- **Evidence:** UI check on smart451 at both sizes (tops, screenshot)

### Requirement: Tooltip on every control
Every control and badge in the top row, the context row, the time strip, the windows, the sidebar switch and the explorer's search area SHALL have a tooltip (the element list is in the scenario "Coverage in the app"). All tooltip texts SHALL come from one table (`help/hints.ts`) and follow wording rule W1 of design H5 of `add-guidance`. The events panel's internals are excluded (`improve-events`). Origin: Jan 2026-10-17 („we need … hover explanations"); finding 4; design H5; icon-only controls: D-092 (an icon needs its tooltip more than a word did).

#### Scenario: Wording rule
- **WHEN** every entry of `HINTS` is evaluated with sample arguments (linked and unlinked, a title, raw/agg/part, a share)
- **THEN** each text is non-empty, at most 140 characters, does not end with `.`, starts with a capital letter, a digit, `+`, `[` or a lower-case tag word (`raw`, `agg`, `part`), and every key it names after ` · ` appears in `SHORTCUTS`
- **Evidence:** `apps/web/test/hints.test.ts` › "keeps every hint within the wording rule"

#### Scenario: No literal tooltips left
- **WHEN** every `.tsx` file under `apps/web/src` except `events/` is scanned for `title="` followed by a character other than `"`
- **THEN** no match is found
- **Evidence:** `apps/web/test/hints.test.ts` › "takes every tooltip from the hints table"

#### Scenario: Coverage in the app
- **WHEN** the six-window setup on smart451 is shown with A, B and Diff on, a values window and an open catalog, and a snippet lists every `button, select, input, label.toggle, .mode-tag, .sna-share, .mark-pill, .time-strip-track, [role=tab]` inside `.top-area`, `.window-grid`, the sidebar switch and the explorer's search area that has no non-empty `title` on itself or its two nearest ancestors
- **THEN** the list is empty
- **Evidence:** UI check on smart451 at 1440×900 (the snippet and its output)

### Requirement: Explained labels
The labels newcomers found cryptic SHALL be explained in their tooltips with the texts of design H5 of `add-guidance`, reworded where a control moved or changed: the window's mode tag, the SNA share, the strip's info (the track tooltip, starting `Time strip: `, naming the presence line instead of bars), the strip's cursor flags, the duration tag (`Duration (h:mm)`), the Events tab's count, "Link time axes", Back, Reset, the cursor pills and Diff. Origin: finding 4 (persona test: „13 of 669 events", „1 bar = 2 h", „Link time axes", „SNA 4.0 %" unclear; A/B/Diff unexplained); new places: D-092; presence line and flags: D-094; duration tag: D-093.

#### Scenario: Tooltips on smart451
- **WHEN** smart451 is shown with the default filter and a window shows `ICL_3A2h.SPEED_DISP` aggregated with an SNA share
- **THEN** the strip track's `title` has a line starting `Time strip: the whole recording (` that contains `the line shows where data exists` and neither `Each bar` nor `1 bar =`; cursor A's strip flag's `title` contains `click centres the view on A`; the Events tab's `title` contains `events match the filter` and `in the recording`; the mode tag's `title` starts with the tag text (`agg <w>:`, no ` · `) and contains `Zoom in for raw samples`; the SNA share's `title` contains `signal not available`; the B pill's `title` contains `Shift+click`; "Back" names `Backspace`, "Reset" names `Home`, and "Link time axes" says whether it is on
- **Evidence:** UI check on smart451 (the `title` values read with a snippet)

### Requirement: Next-step hints at the cursors
A timeseries window's legend header row ("Readout row" of `cursors`) SHALL show in its name cell the muted hint `Shift+click sets B` while A is on and B off, and `Diff shows Δ and Δt` while A and B are on and Diff off, covering no part of the plot and moving no column. Each hint SHALL stop for good in this browser once the workspace has shown B on, or Diff on. Origin: finding 4 (the novice's second click moved A; Diff found by guessing); default S1 of `add-guidance`; place: spec owner's default for D-092 (10) (the readout row is merged into the legend's column headers; the designer suggested the hints go there too), Jan can veto.

#### Scenario: Hints retire
- **WHEN** in a browser with no `kipscope.learned` entry the user clicks a plot (A), then Shift+clicks it (B), then switches Diff on and off, then switches B off
- **THEN** after the click the legend header reads `A <time>` and its name cell `Shift+click sets B`; after the Shift+click the name cell reads `Diff shows Δ and Δt` and no B hint; with Diff on neither; after Diff off and B off neither hint shows again
- **Evidence:** UI check on smart451 (screenshot after each of the first two steps, header text after the last); `apps/web/test/readout.test.ts` › "heads the legend columns with the cursor times" (the hint argument)

#### Scenario: Learned state survives blocked storage
- **WHEN** `hasLearned` and `learn` run with a storage stub whose access throws
- **THEN** neither throws; `hasLearned("b")` is false before and true after `learn("b")` within the page
- **Evidence:** `apps/web/test/helpStorage.test.ts` › "keeps learned hints when storage is blocked"

### Requirement: Explorer names the drag
The sidebar's `Signals` tab SHALL show after its label the catalog's signal count while the search is empty and the number of matches while searching, in tabular numbers, with the tooltip `Signals: <n> signals; drag a row onto a window, or press + · /` (searching: `Signals: <k> of <n> match; drag a row onto a window, or press + · /`). The explorer SHALL show no count or hint line of its own. The "Add to" select's tooltip SHALL say that a click on a window chooses it. Origin: finding 4 („no hint that rows can be dragged onto a window"); spec owner's default S5 of `add-guidance`; the hint sentence leaves the sidebar: D-092 (designer's inventory; mock `Main.dc.html` „Signals 415").

#### Scenario: Count line
- **WHEN** the catalog of smart451 is loaded and the search is empty, then the user types `V_ANZ` (`COMBI_412h.V_ANZ` exists in smart451)
- **THEN** the Signals tab reads `Signals <n>` (the catalog's count, 553 on 2026-10-17) with that tooltip and the explorer has no line ending `or press +`; then `Signals <k>` with `<k> of <n> match` in its tooltip; the tab's box is the same in both states (±1 px)
- **Evidence:** UI check on smart451 (tab text, tooltip and box in both states); `apps/web/test/sidebar.test.ts` › "counts the signals on the tab" (`sidebarTabs` with 553 signals and no query gives count `553` and the title `Signals: 553 signals; drag a row onto a window, or press + · /`; with 4 matches count `4` and `4 of 553 match` in the title)
