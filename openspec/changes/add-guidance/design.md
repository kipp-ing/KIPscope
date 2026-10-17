# Design: add-guidance

## Jan's words and the decisions that bind this change

- Jan (2026-10-17), on the persona findings: „3. the window the signal goes to maybe could be the window clicked last and (new) outline highlighted or so. 4 yes. we need a manual and hover explanations." Also: „my hints are ideas. new and better ideas might come up, do not take my words as hard fact."
- **D-020:** „The "Add to" target stays where the user put it; creating, renaming or reordering windows does not move it." (Why: „"Add to" jumping under the click is a reproduced bug"; power users 2026-10-14: „sticky global "Add to" led to adding to the wrong window".)
- **D-022:** „"Add to" target: held by window ID, changed only by the user; a removed target falls back to "New window"."
- **D-027:** „"Add to" goes to a marked window: the user marks a window, and adds go there. The user's own act of marking sets the target, so D-020's "the target stays where the user put it" still holds." (Jan's own idea „add to ist ein markiertes Fenster?", „instead of the testers' "follow the new window"".)
- **D-028:** „The marked window ("Add to" target) is view state of the browser tab, not workspace state."
- **D-055 Q2:** „the marked "Add to" window gets the ring frame and "Add to" pill of the mock" (mock: frame `#7dd3fc`, pill `#e0f2fe` / `#075985`); **D-056:** „the marked window is a ring frame plus an "Add to" pill".
- **D-024:** „Click in a chart sets cursor A, Shift+click sets B". **D-025:** wheel scrolls, Ctrl/Shift+wheel zooms; one Back, one Reset.

Nothing here changes a decision. Where Jan's new words go beyond a decision's literal text, the proposal is labelled G-n below; the delta specs are written as recommended and marked "pending G-n".

## Decisions for Jan (G-1 … G-4)

**G-1: Which click marks a window, and how the mark looks.**
- (a) **Recommended.** Any click that ends inside a window marks it. That covers the header, plot (it also places A), legend, values table and controls. A drag that ends in another window marks nothing, and neither does a drop. The frame becomes 2 px in the accent `#0284c7` instead of 1 px `#7dd3fc`, and the "Add to" pill stays.
- (b) Like (a), but clicks in a plot do not mark, so placing A or B never moves the target.
- (c) Header only, as today; only the frame becomes stronger.

Conflicts and why (a):
- (a) and (b) replace the spec scenario "Other gestures do not mark" and the "cursor clicks" clause of ""Add to" target ignores other changes". Both are spec wording, not decision text. D-020 and D-027 still hold, because a click is the user's own act and creating or renaming windows still moves nothing.
- The frame colour is D-055's mock colour, so changing it is Jan's call.
- Why (a): it is Jan's „window clicked last" and the simplest rule to explain („the window you last clicked"). The 2026-10-14 risk of „adding to the wrong window" is covered by the strong frame and by the reveal and flash on every add (H3), so an add can no longer land out of sight.

**G-2: Does a window created by an add become the target?**
- (a) **Recommended.** No. The target stays "New window"; the new window is revealed and flashes. To add more signals into it, the user clicks it (G-1).
- (b) Yes: a window created by an explorer add or a drop becomes the marked target. This supersedes D-020 („creating … windows does not move it") and reverses D-027's choice against „follow the new window".

Why (a): (b) fixes the novice's T2 (two windows instead of one) but breaks T4. There, four wheel speeds added after a speed chart would pile into the speed chart, the „wrong window" bug of 2026-10-14. An extra window costs one legend drag to undo, while a signal in the wrong chart is easy to miss.

**G-3: Where help lives.**
- (a) **Recommended.** A non-modal panel on the right (360 px), with the tabs *Manual* and *Keys*, a "?" button at the end of the top row and the `?` key. The windows stay usable while reading.
- (b) A third sidebar tab "Help" next to Signals | Events. It is cheaper, but it hides the signal list while the manual says „search a signal".
- (c) The manual as its own page in a new browser tab, with no in-app panel.

**G-4: First open.**
- (a) **Recommended.** A "Start here" card at the top of the window list. It shows until dismissed, remembered per browser, and is always the empty-workspace state.
- (b) Only the empty-workspace state. The persona test opened onto 17 windows, so a newcomer would see nothing.
- (c) A coach-mark tour that steps through the UI. It costs more than one round, so it goes to the follow-ups.

## Spec owner's defaults (not Jan's; Jan can veto each)

- **S1:**
  - The next-step hints sit in the chart readout row: `Shift+click sets B` while A is on and B off, and `Diff shows Δ and Δt` while A and B are on and Diff is off.
  - Each retires for good in this browser once the workspace has shown B on, or Diff on.
  - Why: the novice's „second click moved A" is fixed where the eye is at that moment, and experts lose the hint after one use.
- **S2:**
  - Every window this tab creates, and the target of every explorer add (`+`, Enter, selection), is revealed and flashes for `FLASH_MS` = 1,200 ms.
  - Drops onto an existing window neither scroll nor flash, because the pointer is already there.
  - Windows created by the CLI neither scroll nor flash.
- **S3:** tooltips stay native `title` attributes. They are accessible, cost nothing and show on disabled buttons in Chrome. Custom fast tooltips are a follow-up.
- **S4:** the manual is `docs/manual.md`, so it reads on GitHub too. It is bundled with `?raw` and needs no Markdown dependency. The Keys tab is generated from `shortcuts.ts`, not written in the manual, so the manual and the keys cannot drift apart.
- **S5:** on an empty search the explorer count line reads `<n> signals · drag a row onto a window, or press +`. While searching it stays `<n> matches` as today.

## Context (code read 2026-10-17)

- **Mark today:**
  - `App.tsx` holds `marked` (view state, `resolveTarget` falls back to `NEW_WINDOW` when the window is gone).
  - `onMark` is passed to both window kinds. `window/WindowTitle.tsx` `markFromHeader` marks only on a header click outside `.window-controls`, and the explorer's "Add to" `<select>` sets the same state.
  - The look (`chart/window.css`) is `.window.marked { border-color: var(--accent-ring) }`: a 1 px `#7dd3fc` frame on a slate-200 frame, plus the `.mark-pill` "Add to". The header's tooltip is `MARKED_HINT` „Adds from the explorer go here".
  - Default after load: no mark, so every `+`/Enter creates a new window. That is why the novice got two windows in T2.
- **Reveal today:**
  - `setReveal` is set on every create path: `barCommand` ("+ Values window"), `addSignal` to `NEW_WINDOW`, `addSignals` (first created), `moveToNewWindow`, and a drop with `createdWindow`.
  - An effect runs `scrollIntoView({block: "nearest"})` on `[data-window-id]` once `windowKey` lists the ID.
  - No test covers it, and the main spec names only "+ Values window" and drops.
  - So by code the novice's new window should have scrolled into view. The finding is marked unverified. Likely causes, to be confirmed by the UI check in task 1.1: the jump was not recognisable (17 look-alike `Window n` tiles, no flash); `nearest` aligns the window's bottom with the list's bottom, under any status-strip overlap, before the chart has drawn; or the first effect run happened before the tile had its final height.
  - A real gap: an explorer add into a marked window that is scrolled away reveals nothing.
- **Tooltips today:** about 45 `title` sites, most with sensible text, but:
  - uneven wording ("Drag to resize" vs "Drag to resize height"; chart mode `Line/Step/Markers` vs values `linear/hold`)
  - no explanation of the strip info `… · 1 bar = 2 h` (no title), the events count (no title), the badge (`agg · 2 s` → `aggregated · 2 s per point`) or the SNA share (no title)
  - nothing that names a key or gesture beyond the A/B pills and Go to
- **Keys today** (`keys.ts`, `App.tsx`, `layout/sidebar.ts`, explorer):
  - global: `/`, `s`, `e`, `t`, `+`/`=`, `-`, `←`/`→`, Shift+`←`/`→`, `Home`, `,`/`.`, `Backspace`
  - explorer: ↑/↓, Shift+↑/↓, Enter, Esc
  - Esc cancels a drag
  - `?` is free
- **Empty state today:** `<p class="hint">No windows yet. Search a signal and add it to a new window.</p>` while the workspace has no window and no drag runs.
- **No jsdom:** web tests run in Node, so the logic sits in pure helpers and the rest is UI checks.

## H1: Mark on click (pinned, `App.tsx`, new `apps/web/src/reveal.ts`)

- `reveal.ts` exports `markTarget(target: { closest(selector: string): { getAttribute(name: string): string | null } | null } | null): string | undefined`. It returns the `data-window-id` of the nearest `[data-window-id]` ancestor, or undefined.
- `App` puts `onClick={(e) => { const id = markTarget(e.target as Element); if (id) onMark(id); }}` on `.window-grid` (bubble phase). A `click` fires only when press and release hit the same element or a common ancestor, so a drag from one window into another ends on `.window-grid` or higher and marks nothing.
- `markFromHeader` and the header `onClick` stay. They are harmless duplicates; removing them is optional cleanup in task 2.1.
- The "Add to" select keeps setting and clearing the mark. Removing the marked window still falls back to "New window".

## H2: Mark look (pinned, `chart/window.css`)

```css
.window.marked { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
```

The border width stays 1 px, so nothing moves, and the shadow adds the second pixel outside. The "Add to" pill is unchanged. Under G-1 (c) the same rule applies.

## H3: Reveal and flash (pinned, `reveal.ts`, `App.tsx`)

- `export const FLASH_MS = 1200;`
- `export function revealDelta(win: {top: number; bottom: number}, view: {top: number; bottom: number}): number` returns the scroll delta for `<main>`:
  - 0 when `view.top ≤ win.top` and `win.bottom ≤ view.bottom`
  - `win.top − view.top` when the window is taller than the view or lies above it
  - otherwise `win.bottom − view.bottom`
  - `view.top` is the bottom of `.top-area`, the sticky top row plus strip; `view.bottom` is `<main>`'s bottom.
- App replaces the `scrollIntoView` effect. `reveal` becomes `{ ids: string[] }`: the windows to flash, the first one scrolled to. Once `windowKey` lists the first ID, App waits two animation frames so the tile is laid out, scrolls `main` by `revealDelta(…)`, and sets `data-flash=""` on each tile. It removes the attribute after `FLASH_MS`.
- The attribute is set imperatively on the `[data-window-id]` element so that React never overwrites it.
- Triggers (S2):
  - every path that sets `setReveal` today (all created windows of a selection add, not only the first)
  - `addSignal` and `addSignals` into an existing target, from `+`, Enter or a selection
- Drops onto an existing window do not trigger it, and neither do CLI changes.
- A failed add (refused command) reveals nothing new, but still reveals any window it created before the refusal.

## H4: Flash look (pinned, `chart/window.css`)

```css
.window[data-flash] { animation: window-flash 1.2s ease-out; }
@keyframes window-flash {
  from { box-shadow: 0 0 0 3px var(--accent-ring); background: var(--accent-soft); }
  to   { box-shadow: 0 0 0 0 transparent; background: var(--panel); }
}
@media (prefers-reduced-motion: reduce) {
  .window[data-flash] { animation: none; box-shadow: 0 0 0 3px var(--accent-ring); }
}
```

A marked window that flashes keeps its mark after the animation, because the `.marked` rule applies again.

## H5: Hints table (pinned, new `apps/web/src/help/hints.ts`)

`export const HINTS` is an object of strings and of functions that return strings. Components take every tooltip from it. No `title="…"` literal stays in `apps/web/src/**/*.tsx` except `title=""`, which suppresses inherited tooltips on `.window-controls`.

Wording rule W1:
- `<Name>: <what it does>`, optionally followed by ` · <key or gesture>`.
- Sentence case, no closing period, at most 140 characters.
- Names are spelled as on screen. Keys are spelled as in `shortcuts.ts` (`Shift+click`, `Ctrl/Cmd+click`, `Backspace`, `Home`).
- The words of the glossary (H8) are used throughout: *window* (never panel or chart for the tile), *cursor A/B*, *time range*, *Add to target*, *SNA*, *raw*, *aggregated*.

| id | text |
|---|---|
| `sidebarToggle(open)` | `Signals: hide the signal list · s` / `Signals: show the signal list · s` |
| `tabSignals` | `Signals: search and add signals · /` |
| `tabEvents` | `Events: faults and state changes, with a filter · e` |
| `search` | `Search: name, description or unit; parts of words match · /` |
| `target` | `Add to: where + and Enter put signals. Click a window to choose it; New window makes one` |
| `addButton(target)` | `Add to <target title>` / `Add to new window` (unchanged, signal-catalog "Add button names its target") |
| `cursor("a")` | `Cursor A: click in a plot to place it, drag its line to move it` |
| `cursor("b")` | `Cursor B: Shift+click in a plot to place it, drag its line to move it` |
| `cursorDisabled` | `Cursors need a timeseries window` |
| `diff` | `Diff: show B − A (Δ) and the time between them (Δt)` |
| `link` | `Link time axes: on, zooming or panning one window moves all windows; off, each keeps its own range` |
| `goTo(linked, title?)` | linked: `Go to: a time or range in all windows, e.g. 15:08, 15:07 .. 15:09, 1h, +10min · t`; unlinked: `Go to: a time or range in <title> · t` |
| `span(linked, title?)` | `Span: show this much time around cursor A, or the centre, in all windows` / `… in <title>` |
| `back(linked, title?, can)` | `Back: the previous time range of all windows · Backspace` / `… of <title> · Backspace`; `!can`: `Back: no earlier time range yet` |
| `reset(linked, title?)` | `Reset: show all data of every signal in all windows · Home` / `… in <title> · Home` |
| `digits` | `Digits: significant digits of all values (3 or 4)` |
| `valuesWindow` | `+ Values window: a table of values at cursors A and B; add signals as to any window` |
| `help` | `Help: manual and keyboard shortcuts · ?` |
| `windowHeader(marked)` | marked: `Add to target: + and Enter in the signal list add here`; else `Click anywhere in this window to make it the Add to target` |
| `windowTitle(title)` | `<title> · double-click to rename` (unchanged) |
| `badge(kind, width)` | raw: `raw: every recorded sample is drawn`; agg: `agg · <w>: aggregated, each point stands for <w> of data (min, mean, max). Zoom in for raw samples`; part: `part · <w>: some signals aggregated (<w> per point), others raw` |
| `range(full)` | `Time range shown: <full>` |
| `chartMode` | `Display mode: Line joins points, Step holds each value, Markers draws points only` |
| `valuesMode` | `Between points: linear interpolates, hold keeps the last value` |
| `windowMenu` | `Window menu: rename, remove` |
| `grip` | `Drag to resize the height` (both grips) |
| `legendDrag` | `Drag onto another window to move it; Alt/Ctrl+drop copies` |
| `legendUnit(unit, side)` | `[<unit>] · y axis <side>` |
| `sna(share)` | `<share>: of the points in view are SNA (signal not available, marked invalid by the sender); amber strip at the plot's foot` |
| `legendRemove` | `Remove from this window` |
| `stripInfo(recorded, width)` | `TIME: the whole recording (<recorded>). Each bar is <width>; its height shows how much was logged. Click a bar to jump, drag to zoom, double-click for all` |
| `eventsCount(shown, total, sentence)` | `<shown> events match the filter (<sentence>), <total> in the recording · click to open the list · e` |

Readout cells, cursor times, the strip's bar and drive tooltips, the footer items and the explorer hover card keep their current texts, which already follow their own requirements.

## H6: Shortcut table (pinned, new `apps/web/src/help/shortcuts.ts`)

```ts
export type ShortcutGroup = "Anywhere" | "Time" | "Signal list" | "In a plot" | "Drag and drop" | "Time strip";
export interface KeyProbe { key: string; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }
export interface Shortcut {
  group: ShortcutGroup;
  keys: string;        // as shown, e.g. "Shift+←  Shift+→"
  action: string;      // W1 wording, e.g. "Pan by the whole span"
  probe?: KeyProbe[];  // keyboard entries only: events the handlers must recognise
}
export const SHORTCUTS: Shortcut[];
```

Content:

**Anywhere**
- `/` search signals
- `s` show or hide the signal list
- `e` events
- `t` Go to
- `?` help
- `Backspace` Back
- `Esc` cancel a drag

**Time** (window under the pointer, else the bar target)
- `+` or `=` zoom in
- `-` zoom out
- `←`/`→` pan by half the span
- Shift+`←`/`→` pan by the whole span
- `Home` Reset
- `,`/`.` previous/next drive

**Signal list**
- ↑/↓ move
- Enter adds to the Add to target
- Shift+↑/↓ extends the selection
- Esc clears the search
- Ctrl/Cmd+click toggles a row
- Shift+click selects a range

**In a plot**
- click sets A
- Shift+click sets B
- drag selects a time range to zoom
- double-click resets the zoom
- Ctrl+wheel or Shift+wheel zooms
- wheel scrolls the page
- horizontal swipe pans
- drag a cursor line moves it
- drag the corner grip to resize

**Drag and drop**
- drag a signal row onto a window, the strip or "+ New window"
- Alt/Ctrl+drop copies a legend row

**Time strip**
- click a bar to jump
- drag to zoom
- drag the shown range to pan
- double-click shows all
- click a drive to fit it

The Keys tab renders the table grouped, with keys in `<kbd>`.

## H7: Help key, panel and start card (pinned, `keys.ts`, new `help/*`)

- `keys.ts`: `export function isHelpKey(e: KeyLike, focused: Element | null): boolean`. It is true for `e.key === "?"` without Ctrl, Meta or Alt, outside text fields (`isTextField`). `App.onKey` checks it before `onNavKey`, and it is ignored during a drag.
- `help/storage.ts`:
  - `startDismissed(): boolean`, `dismissStart(): void`, `showStartAgain(): void` (key `kipscope.startCard`)
  - `hasLearned(l: "b" | "diff"): boolean`, `learn(l): void` (key `kipscope.learned`, a JSON array)
  - every access goes through try/catch; when storage is blocked, the state lives for the page only
- `help/HelpPanel.tsx`: `HelpPanel({ tab, onTab, onClose, onShowStart }: { tab: "manual" | "keys"; onTab(t): void; onClose(): void; onShowStart(): void })`.
  - App renders it only while open.
  - It has a header "Help" with the tabs Manual and Keys and a × button.
  - The Manual tab shows a list of the `##` headings that jumps to each section, then the manual, then a button "Show the start card again".
  - Esc closes it while the focus is inside, or when no text field has focus and no drag runs.
- `help/StartCard.tsx`: `StartCard({ empty, onDismiss, onHelp }: { empty: boolean; onDismiss(): void; onHelp(t: "manual" | "keys"): void })`. Its text (pinned), a numbered list:
  1. "Find a signal: type in the search on the left ( / ). Rest on a row for its details."
  2. "Chart it: + or Enter adds to the window you last clicked (blue frame), else to a new one. Or drag the row onto a window."
  3. "Measure: click a plot for cursor A, Shift+click for B, then Diff for B − A."
  4. "Move in time: drag across a plot or the TIME strip to zoom; Back ( Backspace ) undoes."
  Below it the buttons "Manual" and "Keys", which open the help panel on that tab.
  - With `empty` it heads `No windows yet` and has no ×.
  - Otherwise it heads `Start here` and has a × button.
  - App renders it as the first child of `<main>` after `.top-area`. It shows when (`windows.length === 0` or `!startDismissed()`) and no drag runs, and it replaces `<p class="hint">`.
- `App`:
  - a 26 px "?" button with `aria-label="Help"` at the end of `.option-bar-slot`, after `OptionBar`
  - `help: "manual" | "keys" | undefined` state: the button opens `manual`, `?` opens `keys`, and pressing either again closes the panel
  - an effect that calls `learn("b")` when `workspace.cursors.b` is set and `learn("diff")` when `cursors.diff` is true
  - the prop `nextHints={{ b: !hasLearned("b"), diff: !hasLearned("diff") }}` passed to every `TimeseriesWindow`, recomputed when either is learned
- `TimeseriesWindow` (new optional prop `nextHints?: { b: boolean; diff: boolean }`), readout row:
  - after `A …` while A is on, B off and `nextHints.b`: `<span class="next-hint">Shift+click sets B</span>`
  - after the B time while A and B are on, Diff off and `nextHints.diff`: `<span class="next-hint">Diff shows Δ and Δt</span>`
  - `.next-hint` is muted 11 px, in `chart/window.css`
- `help/help.css`:
  - the panel: fixed at the right, from below `.top-area` to above the status strip, width `min(360px, 100vw − 32px)`, white, slate-200 left border, scrolling body
  - the start card: max 640 px wide, white, slate-200 frame, 6 px radius, 3 px accent left bar
  - kbd: slate-100 fill, 1 px slate-300 border, 4 px radius, monospace 11 px

## H8: Manual (pinned outline, `docs/manual.md`; renderer `help/markdown.ts`)

- **Renderer (Markdown subset):**
  - `parseMarkdown(src: string): Block[]`, where `Block = { type: "h1" | "h2" | "h3" | "p"; text: Inline[] } | { type: "ul" | "ol"; items: Inline[][] }` and `Inline = { type: "text" | "bold" | "code"; text: string }`.
  - `unsupportedLines(src: string): number[]` returns the 1-based numbers of lines that start with `|`, `>`, `![`, `<`, ```` ``` ```` or a 4-space indent.
  - `HelpPanel` maps blocks to elements with no `dangerouslySetInnerHTML`, giving `h2` an `id` from its text so the section list can jump to it. Inline `code` renders as `<kbd>` when it is at most 12 characters and has no space, otherwise as `<code>`.
- **Import:** `import manualText from "../../../../docs/manual.md?raw"` in `HelpPanel.tsx`, typed by `vite/client`.
- **Outline:** sections and their content, in the voice of the glossary, at most about 1,500 words in total. If it is half that, it is too thin to answer the persona questions; if it is twice that, nobody reads it.
  1. `# KIPscope manual`, one paragraph: what KIPscope is (recorded CAN and diagnostic data over time).
  2. `## Start here`: the screen parts, left to right and top to bottom:
     - signal list (Signals | Events)
     - top row (cursors, Link time axes, Go to, Span, Back, Reset, Digits, + Values window, ?)
     - TIME strip (whole recording, drives, events count)
     - windows
     - status strip
  3. `## Find a signal`:
     - `/`; parts of names, descriptions and units match
     - groups by sending ECU
     - the hover card fields; display names vs DBC names
  4. `## Chart a signal`:
     - `+` or Enter adds to the Add to target, which is the window you last clicked (blue frame and "Add to" pill) or a new window
     - drag a row onto a window, onto the strip, or onto "+ New window" at the bottom
     - several rows with Ctrl/Cmd+click and Shift+click; at most 4 units per window, the rest flows into new windows
     - the new window scrolls into view and flashes
     - move a legend row by dragging it, copy with Alt/Ctrl
  5. `## Compare signals`:
     - one window holds up to 4 units, one y axis each
     - Link time axes on: all windows show the same time
     - values window: many signals at the cursors
  6. `## Measure`:
     - click sets A, Shift+click sets B, drag the lines
     - Diff shows Δ (B − A) and Δt
     - L is the value under the pointer
     - state names (OFF)
     - a worked example: the acceleration of the persona test, Δt and Δv
  7. `## Move in time`:
     - drag in a plot to zoom; Ctrl/Shift+wheel
     - double-click resets
     - the strip: click, drag, the shown range, double-click, drives and `,`/`.`
     - Go to forms
     - Span
     - Back/Backspace, Reset/Home
  8. `## Events`:
     - pins on the strip and lines in the plots (click sets A)
     - the count `<shown> of <total>` means the filter's matches of the whole recording
     - the Events tab and filter words in short
     - this section is kept short: `improve-events` may change the panel
  9. `## Read the display`:
     - badge raw / agg · w / part
     - SNA: amber strip and share, never drawn as a value
     - `no data` and the grey bands of logger gaps (add-gap-display)
     - `1 bar = …` on the strip
     - loading and failed states
  10. `## Keys`: one paragraph: "Press ? in the app for every key and gesture."
  11. `## Words`: glossary, one line each:
      - window, timeseries window, values window, Add to target, cursor A / B, L, Δ, Δt
      - SNA, raw, aggregated, drive, event, data ref
- The manual uses only the subset, so `unsupportedLines(manual)` is empty, and every `##` heading above is present in this order.

## Shared files (parallel changes)

- **`add-gap-display` (building now):** `chart/TimeseriesWindow.tsx`, `values/ValuesWindow.tsx`, `values/format.ts`, `values/values.css`, `chart/build.ts`, `styles.css`. This change starts only after it is archived; until then, do not touch those files.
- **`improve-events` (specced in parallel):**
  - It owns `events/*`, the events panel's tooltips included. This change adds no title inside `events/`, and its tooltip audit excludes the events panel. `improve-events` should follow wording rule W1 (H5).
  - Shared: `time/TimeStrip.tsx`. This change adds only the `title` of the events count button (`HINTS.eventsCount`) and of `.time-strip-info`. If `improve-events` renames or re-scopes the count (for example to „in view"), it updates `HINTS.eventsCount` and the manual's Events section in the same task.
  - Shared: `keys.ts` (this change adds `isHelpKey`; `?` is taken) and `App.tsx`.
- **`add-saved-views` (specced in parallel):**
  - Shared: `App.tsx` and the top row. This change adds a 26 px "?" at the end of `.option-bar-slot`; a save/share control must keep design-language "One line at both viewports" at 1000×557 together with it.
  - Shared: `help/hints.ts`. New controls take their tooltip from it.
  - The manual gets a "Save and share" section from that change, not from this one.
- **Order:** whichever change is built second merges in `App.tsx`, `keys.ts`, `TimeStrip.tsx` and `hints.ts`, and the pacer names the order.

## Risks

- **Marking on plot clicks surprises a user who sets A in window 3 and then adds expecting window 2.** Mitigation: the 2 px frame, and every add reveals and flashes where it went (H3). Fallback: G-1 (b).
- **Flash noise for experts adding many signals.** It runs once per add and lasts 1.2 s with no motion under reduced motion. At 2.4 s it would still be acceptable; below 0.6 s it is easy to miss.
- **Top row width:** one more 26 px button. It is checked by the existing "One line at both viewports" scenario.
- **UI checks on a shared workspace:** the start card shows once per Chrome profile. The UI user dismisses it first, or checks it in a fresh profile.

## Follow-ups (not in this change)

1. Custom tooltips: 300 ms, styled, with key chips (`<kbd>`) and two lines (name, explanation).
2. A coach-mark tour (G-4 c) driven by the same `HINTS`.
3. The description as a second muted line in explorer rows (novice).
4. Open on the latest drive and "fit to data" (finding 1; builds on `drives` and `add-gap-display`).
5. Clearing the mark by a click on the "Add to" pill (×) or by Esc.
6. Search in the manual; deep links from tooltips into manual sections ("?" at the end of a tooltip).
7. `kipscope manual` / `kipscope keys` in the CLI from the same sources.
8. A German manual.
9. A status-strip tip line for gestures that cannot be hovered (wheel, swipe, Alt-drop).
10. Better default colours for overlapping lines (novice), and the wheel speeds in 1/min vs km/h (display names).

## Jan's answers (2026-10-17)

Jan: „all recommended“. G-1 to G-4 are decided as recommended in this design; the lead numbers them as D-nnn on archive.

## Note from add-saved-views (lead, 2026-10-17)

The top row now has an overflow rule (add-saved-views design V7, "Top-row overflow rule"): below a measured width, Digits and "+ Values window" move into a "⋯" menu, the row's last item. The "?" button of this change is pinned as the last item before "⋯" and must follow the same rule; re-check the one-line scenarios against it when this change is built.
