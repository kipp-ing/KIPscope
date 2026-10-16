## ADDED Requirements

### Requirement: Help panel
The app SHALL have a help panel with two tabs, *Manual* and *Keys*. It SHALL be non-modal: windows, top row and signal list stay usable while it is open. It SHALL sit at the right, between the top row and the status strip, at most 360 px wide, and close with its × button, with the key or button that opened it, or with Esc. Origin: Jan 2026-10-17 („we need a manual"); placement: proposal G-1 … G-4, pending G-3 (design H7).

#### Scenario: Open, use, close
- **WHEN** on smart451 at 1440×900 the user clicks the "?" button at the end of the top row, then clicks cursor A's pill while the panel is open, then presses Esc
- **THEN** the panel opens on the Manual tab, at most 360 px wide (`getBoundingClientRect().width`), its top at or below the top row's bottom and its bottom at or above the status strip's top; the A pill click still switches A on (revision +1); after Esc the panel is gone
- **Evidence:** UI check on smart451 at 1440×900 (screenshot with the panel open, rects, revision before and after)

#### Scenario: Top row still one line
- **WHEN** the six-window setup is shown with the sidebar open at 1000×557
- **THEN** the "?" button (26 px tall) has the same `getBoundingClientRect().top` (±1 px) as "Reset" and the "Signals" toggle
- **Evidence:** UI check on smart451 at 1000×557 (tops, screenshot)

### Requirement: Help key
Outside text fields, without Ctrl, Meta or Alt and while no drag runs, `?` SHALL open the help panel on the Keys tab, and close it when it is already open. In a text field `?` types. Origin: necessary consequence of a shortcut list that must be found without the mouse; key rule as for the other single-letter keys (`time-navigation` "Navigation keys").

#### Scenario: Key mapping
- **WHEN** `isHelpKey` gets `?` with no focus, `?` with the explorer search focused, `?` with Ctrl, and `/` with no focus
- **THEN** it returns true, false, false, false
- **Evidence:** `apps/web/test/keys.test.ts` › "opens help with ? outside text fields"

#### Scenario: Key in the app
- **WHEN** nothing has focus and the user presses `?`, then `?` again, then focuses the search and types `?`
- **THEN** the panel opens on the Keys tab, then closes; the search then holds `?` and no panel opens
- **Evidence:** UI check on smart451 (screenshot after the first `?`, the search text at the end)

### Requirement: Keyboard shortcut list
The Keys tab SHALL list every key and mouse gesture of the app from one table (`help/shortcuts.ts`), grouped as Anywhere, Time, Signal list, In a plot, Drag and drop and Time strip, with each key shown as a key cap. Every keyboard entry SHALL name the key events it stands for, and the app's key handlers SHALL recognise each of them. Origin: Jan 2026-10-17 („hover explanations"); finding 4 (Shift+click for B unknown); design H6.

#### Scenario: List matches the handlers
- **WHEN** every `probe` of every `SHORTCUTS` entry is checked against `navKey`, `isSearchKey`, `isSidebarKey`, `isEventsKey` and `isHelpKey` with no focused element
- **THEN** each probe is recognised by at least one of them, the navigation probes map to the step their entry names (`+` → `in`, Shift+`←` → `pageLeft`, `,` → `prevDrive`, …), and every key the handlers recognise for `+ = - ← → Home t , . / s e ?` appears in some probe
- **Evidence:** `apps/web/test/shortcuts.test.ts` › "lists every handled key and only handled keys"

#### Scenario: Keys tab on smart451
- **WHEN** the user presses `?`
- **THEN** the panel shows the six group headings in the order above, with an entry `Shift+click` that sets cursor B under "In a plot" and entries `,` and `.` for the previous and next drive under "Time", keys drawn as `kbd` elements
- **Evidence:** UI check on smart451 (screenshot of the Keys tab)

### Requirement: User manual
A user manual SHALL live in `docs/manual.md` and be shown in the help panel's Manual tab, starting with a list of its sections that jumps to each. It SHALL be task-oriented with the ten sections of design H8 in order (Start here … Words), use only the Markdown subset the app renders, and stay near 1,500 words (a goal). Origin: Jan 2026-10-17 („we need a manual"); task list from the lead's brief; design H8.

#### Scenario: Manual structure
- **WHEN** `docs/manual.md` is read and parsed with `parseMarkdown`
- **THEN** `unsupportedLines` returns no line, the `h2` headings are exactly the ten sections in order, and the word count is reported (goal 750–3,000 words)
- **Evidence:** `apps/web/test/manual.test.ts` › "has the task sections in order and only supported markdown"

#### Scenario: Renderer subset
- **WHEN** `parseMarkdown` gets `# T`, `## S`, a paragraph with `**bold**` and `` `Shift+click` ``, a `- ` list and a `1. ` list, and `unsupportedLines` gets a table row, a quote, an image and a fenced code line
- **THEN** it yields h1, h2, p (text, bold, code inlines), ul and ol blocks; `unsupportedLines` returns those four line numbers
- **Evidence:** `apps/web/test/manual.test.ts` › "parses the markdown subset"

#### Scenario: Answers the persona questions
- **WHEN** a reader looks in the manual for how to set cursor B, what `13 of 669 events` means, what `1 bar = 2 h` means, what "Link time axes" does, what `SNA 4.0 %` means, and where an added signal goes
- **THEN** each is answered in the section named in design H8 (Measure, Events, Read the display, Compare signals, Read the display, Chart a signal)
- **Evidence:** reviewer reads `docs/manual.md` against this list (one line per question with the quoted sentence)

#### Scenario: Manual in the app
- **WHEN** the user opens help and clicks "Measure" in the section list
- **THEN** the panel scrolls to the "Measure" heading; the text matches `docs/manual.md`, inline keys drawn as `kbd`
- **Evidence:** UI check on smart451 (screenshot)

### Requirement: Tooltip on every control
Every control and badge in the top row, the time strip, the windows and the explorer's search area SHALL have a tooltip (the element list is in the scenario "Coverage in the app"). All tooltip texts SHALL come from one table (`help/hints.ts`) and follow wording rule W1 of design H5. The events panel's internals are excluded (`improve-events`). Origin: Jan 2026-10-17 („we need … hover explanations"); finding 4; design H5.

#### Scenario: Wording rule
- **WHEN** every entry of `HINTS` is evaluated with sample arguments (linked and unlinked, a title, raw/agg/part, a share)
- **THEN** each text is non-empty, at most 140 characters, does not end with `.`, starts with a capital letter, a digit, `+`, `[` or a lower-case badge word (`raw`, `agg`, `part`), and every key it names after ` · ` appears in `SHORTCUTS`
- **Evidence:** `apps/web/test/hints.test.ts` › "keeps every hint within the wording rule"

#### Scenario: No literal tooltips left
- **WHEN** every `.tsx` file under `apps/web/src` except `events/` is scanned for `title="` followed by a character other than `"`
- **THEN** no match is found
- **Evidence:** `apps/web/test/hints.test.ts` › "takes every tooltip from the hints table"

#### Scenario: Coverage in the app
- **WHEN** the six-window setup on smart451 is shown with A, B and Diff on and a values window, and a snippet lists every `button, select, input, label.toggle, .badge, .sna-share, .mark-pill, .time-strip-info, .time-strip-events` inside `.top-area`, `.window-grid` and the explorer's search area that has no non-empty `title` on itself or its two nearest ancestors
- **THEN** the list is empty
- **Evidence:** UI check on smart451 at 1440×900 (the snippet and its output)

### Requirement: Explained labels
The labels newcomers found cryptic SHALL be explained in their tooltips with the texts of design H5: window badge, SNA share, strip info, strip events count, "Link time axes", Span, Back, Reset, the cursor pills and Diff. Origin: finding 4 (persona test: „13 of 669 events", „1 bar = 2 h", „Link time axes", „SNA 4.0 %" unclear; A/B/Diff unexplained).

#### Scenario: Tooltips on smart451
- **WHEN** smart451 is shown with the default filter and a window shows `COMBI_412h.V_ANZ` aggregated with an SNA share
- **THEN** the strip info's `title` starts `TIME: the whole recording (` and contains `Each bar is`; the events count's `title` contains `events match the filter` and `in the recording`; the badge's `title` starts `agg · ` and contains `Zoom in for raw samples`; the SNA share's `title` contains `signal not available`; the B pill's `title` contains `Shift+click`; "Back" names `Backspace` and "Reset" names `Home`
- **Evidence:** UI check on smart451 (the `title` values read with a snippet)

### Requirement: Next-step hints at the cursors
A timeseries window's readout row SHALL show the muted hint `Shift+click sets B` while A is on and B off, and `Diff shows Δ and Δt` while A and B are on and Diff off, covering no part of the plot. Each hint SHALL stop for good in this browser once the workspace has shown B on, or Diff on. Origin: finding 4 (the novice's second click moved A; Diff found by guessing); default S1, Jan can veto.

#### Scenario: Hints retire
- **WHEN** in a browser with no `kipscope.learned` entry the user clicks a plot (A), then Shift+clicks it (B), then switches Diff on and off, then switches B off
- **THEN** after the click the readout row shows `A <time>` and `Shift+click sets B`; after the Shift+click `Diff shows Δ and Δt` and no B hint; with Diff on neither; after Diff off and B off neither hint shows again
- **Evidence:** UI check on smart451 (screenshot after each of the first two steps, readout text after the last)

#### Scenario: Learned state survives blocked storage
- **WHEN** `hasLearned` and `learn` run with a storage stub whose access throws
- **THEN** neither throws; `hasLearned("b")` is false before and true after `learn("b")` within the page
- **Evidence:** `apps/web/test/helpStorage.test.ts` › "keeps learned hints when storage is blocked"

### Requirement: Start card
On the first open in a browser a "Start here" card SHALL sit at the top of the window list with the four steps and buttons pinned in design H7 ("Manual", "Keys", ×). × SHALL dismiss it for this browser; the help panel's "Show the start card again" brings it back; it SHALL be hidden during a drag. Origin: finding 4 („where to start on first open"); pending G-4.

#### Scenario: First open and dismiss
- **WHEN** smart451 is opened in a browser with no `kipscope.startCard` entry while the workspace holds windows, the user clicks "Keys", closes the panel, clicks × on the card and reloads
- **THEN** the card heads `Start here` with the four lines in order above the first window; "Keys" opens the panel on the Keys tab; after × and reload no card shows; after "Show the start card again" in the help panel it shows again
- **Evidence:** UI check on smart451 (screenshot of the card, after reload)

### Requirement: Empty workspace start
While the workspace has no window and no drag runs, the window area SHALL show the start card headed `No windows yet`, with the same four lines and buttons, without ×, whether or not the card was dismissed. It replaces the one-line hint. During a drag it SHALL be hidden, so the free area shows "+ New window" (`workspace-layout` "Drop below the windows"). Origin: finding 4; necessary consequence of G-4 (a card the user dismissed must still guide an empty workspace).

#### Scenario: Empty workspace
- **WHEN** the workspace is empty (`kipscope state` lists no window) after the card was dismissed, then the user drags `COMBI_412h.V_ANZ` from the explorer over the list area and releases there
- **THEN** before the drag the card heads `No windows yet` and has no ×; while dragging the card is hidden and the area reads "+ New window"; after the release one window shows V_ANZ and the card is gone
- **Evidence:** UI check on smart451 (screenshots before and while dragging)

### Requirement: Explorer names the drag
While the search is empty, the explorer's count line SHALL read `<n> signals · drag a row onto a window, or press +`; while searching it stays `<n> match(es)`. The "Add to" select's tooltip SHALL say that a click on a window chooses it. Origin: finding 4 („no hint that rows can be dragged onto a window"); spec owner's default S5.

#### Scenario: Count line
- **WHEN** the catalog of smart451 is loaded and the search is empty, then the user types `DVL`
- **THEN** the line reads `553 signals · drag a row onto a window, or press +` (the catalog's count), then `<k> matches`
- **Evidence:** UI check on smart451 (text of the line in both states)
