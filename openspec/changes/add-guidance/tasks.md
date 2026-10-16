# Tasks

## Before you start

- Start after `add-gap-display` is archived (design "Shared files").
- Round 1 runs groups 1–4 in parallel against the interfaces pinned in design H1–H8. Engineers stub the other side until it lands:
  - 1.1 imports `HelpPanel`, `StartCard`, `storage.ts` (3.1) and `HINTS.help` (2.1)
  - 2.1 imports `SHORTCUTS` (3.1) only in its test
- The tester writes group 5 test-first, in parallel.
- Round 2 is for findings only.

Write areas (disjoint):
- **1.1:**
  - `apps/web/src/App.tsx`, `apps/web/src/reveal.ts` (new)
  - `apps/web/src/keys.ts`: only the call site in App; `isHelpKey` itself is 3.1
- **2.1:**
  - `apps/web/src/help/hints.ts` (new)
  - `apps/web/src/chart/TimeseriesWindow.tsx`, `apps/web/src/values/ValuesWindow.tsx`, `apps/web/src/window/WindowTitle.tsx`, `apps/web/src/window/WindowMenu.tsx`
  - `apps/web/src/bar/OptionBar.tsx`, `apps/web/src/time/TimeStrip.tsx` (titles only), `apps/web/src/explorer/SignalExplorer.tsx`, `apps/web/src/footer/StatusBar.tsx`
  - `apps/web/src/chart/window.css`
- **3.1:**
  - `apps/web/src/help/{shortcuts.ts,markdown.ts,storage.ts,HelpPanel.tsx,StartCard.tsx,help.css}` (all new)
  - `apps/web/src/keys.ts` (`isHelpKey`)
- **4.1:** `docs/manual.md` (new)
- **5.1:**
  - `apps/web/test/{reveal,hints,shortcuts,manual,helpStorage}.test.ts` (new)
  - `apps/web/test/keys.test.ts`

Not touched: `apps/web/src/events/*` (`improve-events`), any server, CLI or `packages/shared` file.

## 1. App: mark, reveal, flash, help wiring

- [ ] 1.1 Mark, reveal, flash and help wiring (H1, H3, H7).
  - **Reproduce first.** Before changing anything, take a UI check with 17 windows, no mark, and an Enter add, and note in the report whether today's reveal scrolled and whether the window was fully visible.
  - **Helpers.** New `reveal.ts` with `markTarget`, `revealDelta` and `FLASH_MS`.
  - **Mark on click.** `.window-grid` `onClick` → `markTarget` → `onMark`.
  - **Reveal state.** `reveal` becomes `{ ids }`, set by:
    - every create path (all created IDs)
    - `addSignal`/`addSignals` into an existing target
  - **Reveal effect.** After two animation frames: scroll `main` by `revealDelta` (view top = `.top-area` bottom), set `data-flash` on each tile, and remove it after `FLASH_MS`. Drops onto existing windows and CLI windows are excluded.
  - **Help wiring:**
    - a "?" button (`aria-label="Help"`, `title={HINTS.help}`) at the end of `.option-bar-slot`
    - `help` state; `isHelpKey` in `onKey` before `onNavKey`, not during a drag
    - `HelpPanel` rendered while open
    - `StartCard` as `<main>`'s first child after `.top-area`, replacing `<p class="hint">`, hidden during a drag
    - an effect calling `learn("b")` and `learn("diff")`
    - `nextHints` passed to `TimeseriesWindow`
  - **Verify:** `pnpm --filter @kipscope/web build && pnpm lint`.
  - **Scenarios (UI user):**
    - workspace-layout: "A click anywhere marks", "Other gestures do not mark"
    - signal-catalog: "New window is not the target"
    - timeseries-window: "Explorer add among seventeen windows", "Add into a marked window out of sight", "Selection creates two windows", "Drop on an existing window"
    - guidance: "Open, use, close", "Key in the app", "First open and dismiss", "Empty workspace"

## 2. Tooltips and hints

- [ ] 2.1 Hints table and every title (H2, H4, H5, H7 next hints).
  - **Hints table.** New `help/hints.ts` exactly as the H5 table.
  - **Titles from the table.** Replace every literal `title="…"` and every inline tooltip string in the files of this write area with `HINTS` entries, including `MARKED_HINT` → `HINTS.windowHeader(marked)`.
  - **New titles:**
    - strip info and events count (TimeStrip, `title` only, label text unchanged)
    - badge (`HINTS.badge`)
    - SNA share
    - the "Add to" select (`HINTS.target`)
    - the explorer count line on an empty search (S5)
    - one grip text for both grips
  - **`TimeseriesWindow`:** the `nextHints` prop and the two `.next-hint` spans in the readout row.
  - **`window.css`:**
    - the mark rule (H2)
    - the flash rule and keyframes with reduced motion (H4)
    - `.next-hint` (muted, 11 px)
  - **Verify:** `pnpm --filter @kipscope/web build && pnpm lint && pnpm --filter @kipscope/web test`.
  - **Scenarios:**
    - guidance: "Coverage in the app", "Tooltips on smart451", "Hints retire", "Count line"
    - workspace-layout: "Mark and add", "Values window marked"
    - design-language: "Flash on a new window", "Reduced motion"

## 3. Help panel, shortcuts, manual renderer, start card

- [ ] 3.1 Help components (H6, H7, H8).
  - **`shortcuts.ts`:** `SHORTCUTS` with probes, exactly as H6.
  - **`markdown.ts`:** `parseMarkdown` and `unsupportedLines`.
  - **`storage.ts`:** start card and learned flags, with try/catch.
  - **`HelpPanel.tsx`:**
    - tabs, ×, Esc
    - section list with jump links, `?raw` import of `docs/manual.md`, inline `kbd`/`code`
    - Keys tab grouped from `SHORTCUTS`
    - "Show the start card again"
  - **`StartCard.tsx`:** the pinned texts, `empty` variant.
  - **`help.css`:** panel, card and `kbd` looks.
  - **`keys.ts`:** `isHelpKey`.
  - **Verify:** `pnpm --filter @kipscope/web build && pnpm lint`.
  - **Scenarios:**
    - guidance: "Keys tab on smart451", "Manual in the app", "Top row still one line"
    - design-language: "Help panel look", "Card look"

## 4. Manual text

- [ ] 4.1 Write `docs/manual.md` from the outline in design H8.
  - English, about 1,500 words, Markdown subset only, ten `##` sections in order.
  - Every term as in the Words section.
  - Facts checked against the main specs and the running app, not invented. For example, the numbers in the Measure example come from smart451.
  - The six persona questions are answered (guidance "Answers the persona questions").
  - **Verify:** `pnpm --filter @kipscope/web test` (`manual.test.ts`); the reviewer checks the six answers.

## 5. Tests

- [ ] 5.1 Web tests, written test-first:
  - `reveal.test.ts`:
    - "finds the window of a click"
    - "scrolls a window fully into view below the top row"
  - `hints.test.ts`:
    - "keeps every hint within the wording rule"
    - "takes every tooltip from the hints table" (scans `apps/web/src/**/*.tsx` except `events/` with `node:fs`)
  - `shortcuts.test.ts`:
    - "lists every handled key and only handled keys"
  - `manual.test.ts`:
    - "parses the markdown subset"
    - "has the task sections in order and only supported markdown" (reads `docs/manual.md`; reports the word count)
  - `helpStorage.test.ts`:
    - "keeps learned hints when storage is blocked"
  - `keys.test.ts`:
    - "opens help with ? outside text fields"
  - Existing tests stay green unchanged.
  - **Verify:** `pnpm --filter @kipscope/web test`.

## UI check (UI user, smart451, 1440×900 unless named)

- First dismiss the start card once, or use a fresh profile for "First open and dismiss".
- Build the 17-window setup with the CLI.
- guidance:
  - "Open, use, close", "Top row still one line" (1000×557), "Key in the app", "Keys tab on smart451", "Manual in the app"
  - "Coverage in the app", "Tooltips on smart451", "Hints retire", "First open and dismiss", "Empty workspace", "Count line"
- workspace-layout: "Mark and add", "Values window marked", "No mark, new windows", "A click anywhere marks", "Other gestures do not mark", "Refused add keeps the target".
- signal-catalog: "Select and header mark the same window", "New window is not the target", "Removed target falls back".
- timeseries-window: "Values window below the fold", "Drop below a short list", "Explorer add among seventeen windows", "Add into a marked window out of sight", "Selection creates two windows", "Drop on an existing window".
- design-language: "Flash on a new window", "Reduced motion", "Help panel look", "Card look".
- Gestures the automation cannot drive (real drags, Shift+click): report `not_run` with the unit-test evidence.
