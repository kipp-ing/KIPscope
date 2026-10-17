# Proposal

## Why

All three persona testers (`docs/feedback/2026-10-17-personas.md`, T5 "faults and state changes during that drive": novice ~70 % sure, expert "partly") struggled with events:

- The list shows every event of the recording that passes the filter (669 on Jan's workspace) from 2026-10-11 on; rows inside the shown range only get a 2 px accent border. Nobody found "the events of this drive" without scrolling (agreed 3/3).
- Ten rows of controls (heading, field, description, six presets, up to eight category chips, ECU chips, events-line signals) sit above the list in a 240 px sidebar; on a 723 px high viewport the list starts below the middle of the screen.
- Rows cut the name and text with an ellipsis; the text is only in the tooltip (novice: "event text cut off in the narrow list", "show the description in the list, not only on hover"). Names repeat the source (`IgnMode DCU_1F4h.IgnMode`, `BMS BMS.contactor`).
- "13 of 669 events" in the strip head was unclear to the novice; nothing explains pin colours, line dashes or what a glyph means without hovering.
- Data fact (expert): all 55 DTCs of smart451 carry 2026-10-15 07:27:12.135 local, the time the fault memory was **read**, not when a fault occurred; they cannot be matched to a drive. The UI shows them as 55 events "at" that time, which reads as if 13 faults happened at once.

Jan (2026-10-17): „events need an expert, yes i think its cluttered hard to use too." He confirmed: the events list should focus on what is in view. And: „my hints are ideas. new and better ideas might come up, do not take my words as hard fact."

Decisions that stay (quoted in design.md): D-058, D-059, D-064. Nothing in this change changes the filter grammar, the default filter, the categories, the endpoint or the workspace fields.

## What Changes

- **Events in view (proposal E-1):** the list shows by default only the events inside the bar target's range, with a switch `In view <k> | All <n>` (kept per browser tab, like the sidebar part). Above the in-view rows `↑ <k> earlier`, below them `↓ <k> later`: a click jumps to the nearest event outside the view.
- **Step through events (proposal E-2):** `n` / `p` (and `‹` `›` buttons at the list head) put cursor A on the next / previous shown event, from cursor A when it lies in the view, else from the view's edge; the view is centred (span kept) only when the event lies outside it. A row click does the same for its event (Shift+click: cursor B), like a glyph click (D-064). The row(s) at cursor A are highlighted and scrolled into view, so list and charts stay in sync (trace-window behaviour of CANoe/CANape).
- **Fault memory reads (proposal E-3):** a DTC row's time is the readout time. DTCs of one ECU read at one time become one list row `Fault memory read` (`BMS · 13 active faults · 55 DTCs read`), expandable to its DTCs with their status; pins and glyphs made only of DTCs are drawn hollow; tooltips say `Fault memory read at this time; when a fault first occurred is unknown`. Data unchanged; fixing the decoder is another repo.
- **Decluttered panel (proposal E-4):** heading with the switch, the filter in words with `<k> hidden`, the presets; the filter field, category and ECU chips and the events-line signals move into a `Refine` section, closed by default (opened by `e` and by the strip count, kept per tab).
- **Readable rows:** line 1 glyph, time, category in words; line 2 the event's name (source only where it adds something) and its text, wrapping instead of cutting.
- **Marker meaning:** a one-line key under the list (colour and line style per kind, hollow = fault memory read); the strip count gets a tooltip saying what the numbers are.

**Out of scope** (follow-ups, see design "Follow-ups"): a decoder fix for DTC onset times or freeze-frame data; CLI changes (`events list` keeps its output); hover link from a row to its pin and glyph; an events lane or table per chart window; per-window event filters; auto-scroll of the `All` list to the view; saving the scope in the workspace or a saved view; snapping the cursor to events while dragging; event search by time; anything in the filter grammar, the categories, `/api/events` or the strip layout (55 px, 6 px lane).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `events`: "Events panel" and "Events list" rewritten (scope, refine section, rows, row click); new "Events in view", "Step to an event", "Event rows readable", "Fault memory reads", "Events key".
- `event-filter`: "Filter field" lives in the Refine section.
- `time-strip`: "Event pins" (hollow fault memory reads), "Pin tooltips" (readout line), "Events count in the strip head" (tooltip).
- `timeseries-window`: "Event marks in the plot" (hollow glyphs for fault memory reads).
- `workspace-layout`: "Signals and Events in the sidebar" (`e` opens the Refine section).

## Impact

- `apps/web/src/events/*` (panel, list helpers, marks, CSS, new `prefs.ts`), `apps/web/src/keys.ts` (`n`, `p`), `apps/web/src/App.tsx` (jump and step wiring), `apps/web/src/time/TimeStrip.tsx` (pin style, count tooltip), one function in `apps/web/src/chart/TimeseriesWindow.tsx` (glyph style).
- No change to `packages/shared`, `apps/server`, `apps/cli` or the workspace format.
- Builds after `add-gap-display` (shares `TimeseriesWindow.tsx`); write areas against `add-guidance` and `add-saved-views` in design.md "Shared files".
