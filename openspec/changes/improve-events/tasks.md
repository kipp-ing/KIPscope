# Tasks

Web only. Build after `add-gap-display` is committed (it shares `chart/TimeseriesWindow.tsx`, see design "Shared files"). All tasks build in one round against the interfaces pinned in design P1–P8; engineers of 2.1 and 3.1 may stub the helpers of 1.1 until it is in. The tester writes group 4 test-first, in parallel. Jan's answers to E-1…E-4 come before the round; a different answer changes only the named task.

- 1.1: `apps/web/src/events/list.ts`, `events/prefs.ts` (new), `events/marks.ts`
- 2.1: `apps/web/src/events/EventsPanel.tsx`, `events/events.css`
- 3.1: `apps/web/src/App.tsx` (events block, `onNavKey`), `apps/web/src/keys.ts`, `apps/web/src/time/TimeStrip.tsx`, `apps/web/src/chart/TimeseriesWindow.tsx` (`placeEventGlyphs` only)
- 4.1: `apps/web/test/eventsPanel.test.ts`, `eventMarks.test.ts`, `keys.test.ts`, `eventsPrefs.test.ts` (new)

## 1. Pure helpers (apps/web/src/events)

- [ ] 1.1 List, prefs and marks (P1, P2, P5): `isRead`, `ListItem`, `listItems`, `dayBands` over items, `inView`, `outside`, `stepEvent`, `rowName`, `readSummary` in `list.ts`; new `prefs.ts` (scope and Refine state, never throwing); `Mark.read`, read width ≥ `PIN_W_MANY`, `READ_LINE`, `markStyle`, `eventTitle`, readout line in `markTitle`. Verify: `pnpm --filter @kipscope/web build`; scenarios "Items and bands", "View math", "Step math", "Row names", "Read summary", "Scope stored", "Hollow marks", "Pin geometry", "Tooltip text". (E-1 b: drop the scope prefs; E-3 b/c: `listItems` without read items.)

## 2. Events panel (apps/web/src/events)

- [ ] 2.1 Panel and rows (P3, P4, P6): heading with the scope switch and counts, description with ` · <k> hidden`, presets, `Refine` disclosure (closed by default, focus request opens it) holding field, chips and events-line signals; list head with `↑ earlier`, `‹` `›`; rows of P4 (wrapping, `rowName`, category label, hollow glyph for reads), read rows with expand button and DTC lines; `current` rows at cursor A scrolled into view; `↓ later`; key line. Props: `onJump`, `cursorA` in place of `onCentre`. Verify: scenarios "Panel on smart451", "Refine section", "In view on smart451", "No time window", "Longest text on smart451", "Readout on smart451", "Key on smart451", "Long list", "Typing and Enter". (E-4 b/c: field outside Refine.)

## 3. Wiring (App, keys, strip, chart)

- [ ] 3.1 Jumps, keys and marks (P5, P7, P8): `onJump` (centre only outside the range, then `cursor.set`), panel props, `StripEvents.describe`; `n`/`p` in `navKey` and `onNavKey` (once per press, `stepEvent` over `stripShown`); strip pins, the count's tooltip per P8 (add-guidance wording) and its Refine-opening click; `placeEventGlyphs` uses `markStyle`. Verify: `pnpm build && pnpm test && pnpm lint`; scenarios "Row click centres", "Stepping on smart451", "The list follows cursor A", "Pins on smart451", "Count on smart451", "Marks on smart451", "Switch and key e". (E-2 b: `onJump` centres only and sets no cursor; `n`/`p` dropped or centring only.)

## 4. Tests (tester)

- [ ] 4.1 Unit tests named in the scenarios: `eventsPanel.test.ts` ("caps the list at 500 rows" with items, "groups DTCs of one readout", "groups rows by local day", "keeps the events of the view", "steps from cursor A or the view's edge", "names rows without a repeated source", "summarises a fault memory read", "shows all without a range"); `eventMarks.test.ts` ("draws fault memory reads hollow", "formats pin tooltips" with the readout line, "clusters events into pins" unchanged); `keys.test.ts` (`n`, `p` in "maps navigation keys outside text fields"); new `eventsPrefs.test.ts` ("loads and saves scope and refine state"). Verify: `pnpm --filter @kipscope/web test`.

## On archive

- [ ] Lead: copy the ledger entry of design.md into `docs/decisions.md` with the numbers Jan's answers get (E-1…E-4 become D-numbers assigned by the lead).
