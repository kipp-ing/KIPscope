# Proposal

## Why

The persona test of 2026-10-17 ([docs/feedback/2026-10-17-personas.md](../../../docs/feedback/2026-10-17-personas.md)) found that newcomers can use KIPscope but cannot discover how to:
- **Where did my window go (novice, boss):** a new window lands at the bottom of 17 windows. The novice scrolled to find it, and the boss gave up looking.
- **Newcomer cues (novice, boss):** A/B/Diff are not explained. The novice's second click moved A, but Shift+click sets B. Nothing says that rows can be dragged onto a window. "13 of 669 events", "1 bar = 2 h", "Link time axes" and "SNA 4.0 %" are cryptic. Nothing says where to start on first open.

Jan (2026-10-17) on these findings: „3. the window the signal goes to maybe could be the window clicked last and (new) outline highlighted or so. 4 yes. we need a manual and hover explanations." He also said: „my hints are ideas. new and better ideas might come up, do not take my words as hard fact."

What the code does today (design.md, Context):
- The "Add to" target is set only by a click on a window's header or by the explorer's select.
- The mark is a 1 px light-sky frame plus an "Add to" pill.
- Every path that creates a window already calls `scrollIntoView({block: "nearest"})`, but nothing tests this and nothing says which window is new.
- An add into a marked window that is scrolled out of sight shows nothing at all.
- Most controls already have native tooltips. Their wording is uneven, and the cryptic labels, gestures and keys are not explained anywhere.

## What Changes

- **Add target (proposal G-1, G-2):** a click anywhere in a window marks it as the "Add to" target. The mark is a stronger 2 px accent frame and keeps the "Add to" pill. A window created by an add or a drop is scrolled fully into view and flashes once. An explorer add into an existing window also reveals and flashes that window. New windows do not become the target (D-020, D-027 unchanged).
- **Hover explanations:** one module holds every tooltip text, written to one rule (`<Name>: <what it does> · <key>`). Every control and badge of the top row, the windows, the time strip and the explorer foot gets one. The cryptic labels are explained in place: badge, SNA share, strip scale, events count, "Link time axes" and Span. Two next-step hints sit in the chart readout row: `Shift+click sets B` and `Diff shows Δ and Δt`. Each retires once the user has used B or Diff in this browser.
- **Help panel and keys (G-3):** a "?" button at the end of the top row and the `?` key open a non-modal help panel on the right. It has two tabs: *Manual* and *Keys*. The keys list comes from one table, `shortcuts.ts`, and a test checks it against the real key handlers.
- **User manual:** `docs/manual.md`, task-oriented and about 1,500 words. Its sections are start, find a signal, chart it, compare, measure, move in time, events, read the display, and words. It is bundled into the app with Vite's `?raw` and drawn by a small Markdown-subset renderer, so it needs no new dependency.
- **First open and empty state (G-4):** a "Start here" card sits at the top of the window list and shows four moves plus links to the manual and the keys. It shows on the first open in a browser until dismissed, and it is always the empty-workspace state. It replaces the one-line "No windows yet" hint. On an empty search, the explorer's count line names the drag gesture.

**Out of scope (follow-up list in design.md, "Follow-ups"):**
- custom fast tooltips with key chips
- a guided coach-mark tour
- descriptions in the explorer rows
- "latest drive" / fit to data on open (finding 1, a drives change)
- an events "in view" filter (finding 2, `improve-events`)
- clearing the mark with a click on its pill
- search in the manual
- a CLI `kipscope manual`
- a German manual
- tooltip wording inside the events panel (`improve-events`)
- a status-strip tip line

## Capabilities

### New Capabilities

- `guidance`: help panel, help key and button, manual content and rendering, keyboard shortcut list and its check, tooltip coverage and wording, explained labels, next-step hints, start card and empty state, explorer gesture hint.

### Modified Capabilities

- `workspace-layout`: "Marked window" (a click anywhere in a window marks it; stronger frame). The empty-workspace hint becomes the start card (`guidance`).
- `signal-catalog`: "Stable "Add to" target" and ""Add to" target ignores other changes" (a click inside a window is the user's act of marking).
- `timeseries-window`: "New windows scroll into view" covers every window this tab creates and the target of every explorer add: revealed fully (below the top row) and flashed.
- `design-language`: new "Flash look", "Help panel look", "Start card look".

## Impact

- `apps/web/src`:
  - new `help/` (`hints.ts`, `shortcuts.ts`, `markdown.ts`, `storage.ts`, `HelpPanel.tsx`, `StartCard.tsx`, `help.css`) and `reveal.ts`
  - `App.tsx` (mark on click, reveal and flash, help and start card, `?` key and button)
  - `keys.ts` (`isHelpKey`)
  - `chart/TimeseriesWindow.tsx`, `values/ValuesWindow.tsx`, `window/WindowTitle.tsx`, `window/WindowMenu.tsx`, `bar/OptionBar.tsx`, `time/TimeStrip.tsx`, `explorer/SignalExplorer.tsx`, `footer/StatusBar.tsx` (titles from `hints.ts`)
  - `chart/window.css` (mark, flash and next-hint rules)
- `docs/manual.md` (new, written by an engineer from the outline in design.md H8).
- No server, CLI, shared-package or workspace changes. No new dependency.

## Depends on

- **`add-gap-display`** (being built now): it writes `chart/TimeseriesWindow.tsx`, `chart/build.ts`, `values/*` and `styles.css`. Build this change after it is archived; the manual's "Read the display" section describes its `no data` cells and grey bands.
- **Specced in parallel:** `improve-events` (events panel) and `add-saved-views` (save/share a view). Shared files are named in design.md, "Shared files".
