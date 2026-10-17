# Design

## Jan's decisions that stay (quoted, not changed)

- **D-058:** „the events line is great. however we need a filter. it can get super overwhelming. the filter also needs cli. it needs human way of thinking too." Answers: Q1 default filter `active changes`; Q2 the events list is a sidebar tab.
- **D-059:** „Cursor readouts (A, B, L; legends and values window) show the state name where the value has one"; „Only signals listed in `kipscope.yaml` go to the events line automatically".
- **D-064:** „One filter string in UI, CLI and workspace (`events.setFilter`) … default `active changes` … Pins in a 6 px lane of the strip (grouped within 6 px), lines and glyphs in the charts (click sets A, Shift+click B), Events sidebar tab."

None of them stands in the way. The scope `In view | All` is list view state, not a filter: strip, charts, the CLI and the workspace filter are untouched, and the panel still says how many events the filter hides (D-058 brief: "filtering never hides silently"). A row click setting A follows D-064's glyph click.

Jan (2026-10-17): „events need an expert, yes i think its cluttered hard to use too"; the list should focus on what is in view; „my hints are ideas … do not take my words as hard fact".

## Context

Today (archived `add-events`, design V8): the panel stacks heading, field, description, six presets, category chips, ECU chips and the events-line signals above a list of every shown event of the strip's data ref (smart451 with the shipped project file: 63 of 477 with the default filter; Jan's workspace with BRK_LMP: 669 total). Rows inside the bar target's range get a 2 px accent border; a row click centres the view. Rows are two lines with ellipsis. All 55 DTCs share one time, the fault memory readout (2026-10-15 07:27:12.135 local).

How measurement tools handle this, and what this change takes from them:

- **CANoe / CANape trace and event windows:** the trace follows the measurement cursor; stepping moves the cursor to the next entry and the trace highlights it. → `n`/`p` put cursor A on the next/previous event; the row at A is highlighted and scrolled into view.
- **ODIS / Xentry DTC lists:** a DTC readout is a snapshot of the fault memory per ECU (code, status, text), not a timeline of onsets. → one `Fault memory read` row per ECU and readout time, expandable; hollow marks.
- **PlotJuggler / Grafana annotations:** markers carry their meaning in colour and style, explained once in a legend; the list next to a plot shows what is in the plotted range. → an events key line; the list scoped to the view with counts of what lies outside.

## Goals / Non-Goals

Goals: a novice finds the events of the drive on screen without scrolling or typing; an expert steps through them with the values at each one in the values window; rows readable in a 240 px sidebar; fault memory reads honest; marker meaning visible without hovering. One or two rounds, web only.

Non-goals: see proposal "Out of scope".

## Decisions

### P1: List scope (pinned, new `apps/web/src/events/prefs.ts`, `EventsPanel.tsx`) — proposal E-1

```ts
export type EventsScope = "view" | "all";
export const EVENTS_SCOPE_KEY = "kipscope.eventsScope";
export const EVENTS_REFINE_KEY = "kipscope.eventsRefine";
/** Unknown, missing or throwing storage → "view". */
export function loadEventsScope(storage: Pick<Storage, "getItem"> | undefined): EventsScope;
/** Never throws. */
export function saveEventsScope(storage: Pick<Storage, "setItem"> | undefined, scope: EventsScope): void;
/** "open" → true; anything else, missing or throwing → false. */
export function loadRefineOpen(storage: Pick<Storage, "getItem"> | undefined): boolean;
export function saveRefineOpen(storage: Pick<Storage, "setItem"> | undefined, open: boolean): void;
```

Local storage per browser, like the sidebar part (`layout/sidebar.ts`); not in the workspace (no command, no revision, the CLI and other tabs unaffected). `add-saved-views` may later carry it; not here.

"In view" = `range.from ≤ t < range.to` of the bar target's range (the panel's `range` prop, as today's accent border). Without a bar target (no timeseries window) the `In view` segment is disabled (`title` `In view: needs a window with a time range`) and the list shows all.

### P2: Pure list helpers (pinned, `apps/web/src/events/list.ts`)

```ts
/** A DTC row is a fault memory read: its time is when the memory was read, not when the fault occurred (data fact: smart451's 55 DTCs share one time). */
export function isRead(e: DiagEvent): boolean;                       // e.kind === "dtc"
export type ListItem =
  | { kind: "event"; event: DiagEvent }
  | { kind: "read"; t: string; source: string; events: DiagEvent[] };   // ≥ 2 consecutive DTCs, same source and t
/** Events in time order → items; consecutive DTCs of one source at one t (≥ 2) join one read item. Pure. */
export function listItems(events: readonly DiagEvent[]): ListItem[];
/** Consecutive items of one local date (formatDate), replaces the DiagEvent version. */
export function dayBands(items: readonly ListItem[]): { day: string; items: ListItem[] }[];
/** Events with range.from ≤ t < range.to; and the counts and nearest events before and after. */
export function inView(events: readonly DiagEvent[], range: Range): DiagEvent[];
export function outside(events: readonly DiagEvent[], range: Range): { earlier: number; later: number; before?: DiagEvent; after?: DiagEvent };
/** E-2: from a (when range.from ≤ a < range.to) the first event with t > a (dir 1) or the last with t < a (dir −1);
 *  without such an a, the first with t ≥ range.from (1) or the last with t < range.to (−1). Pure. */
export function stepEvent(events: readonly DiagEvent[], range: Range, a: bigint | undefined, dir: 1 | -1): DiagEvent | undefined;
/** Row name: kind `signal` → source (the shown name); name starting with `<source>.` → name; else `<source> <name>`. */
export function rowName(e: DiagEvent): string;
/** Read item line 2: `<source> · <per category of item.events, most severe first: "<n> <one|many>", joined ", "> · <k> DTCs read`,
 *  k = DTCs of the same source and t in `all` (the unfiltered list). */
export function readSummary(item: Extract<ListItem, { kind: "read" }>, all: readonly DiagEvent[]): string;
```

`listRows` (cap 500 events) is applied to the events before `listItems`; unchanged otherwise. Events at one time are one stop for `stepEvent` (strict `>`/`<`), so a fault memory read is one step.

### P3: Panel layout (pinned, `EventsPanel.tsx`, `events.css`) — proposal E-4

```
[ Signals | Events ]
EVENTS                 [In view 15 | All 63]     11 px caps label; segmented switch, counts tabular
Active faults and state changes · 414 hidden      muted 11 px, wraps; typed filter: preview or error (--error)
(Active & changes)(Faults)(Changes)(Logger)(Everything)(Off)     presets, wrap (unchanged F5)
▸ Refine   active changes                         disclosure button 22 px; closed: the filter in mono, ellipsis
  [ field ] · category chips · ECU chips · ON THE EVENTS LINE …  (open: today's V8 controls, unchanged)
───────────────────────────────────────────
↑ 9 earlier                          [‹] [›]      list head, sticky; ‹ › 22 px, titles "Previous event: put cursor A on it · p" / "Next … · n"
── Wed 2026-10-14 ────────────────────────
▮ 18:59:47.679                 State change      line 1: glyph, time to the ms, category label (muted, right)
  BMS.contactor closed → open · after a gap       line 2: name (mono) + text, wraps, no ellipsis
…
↓ 39 later
───────────────────────────────────────────
▮ Fault ▮ Stored ┆ Change ┊ Other ▯ Fault memory read     key line (P6), muted 10 px, wraps
```

- Hidden count: `list.total − shown.length` (shown = passing the previewed filter), ` · <k> hidden` only when k > 0.
- Switch counts: `In view <k>` (shown events in range), `All <n>` (shown events). `aria-pressed` on the active segment; a click saves the scope (P1).
- `↑ <k> earlier` / `↓ <k> later`: only in scope `view` with a range and k > 0; a click calls `onJump(before.t | after.t, "a")`; `title` `Earlier events: put cursor A on the nearest one · p` / `Later events: put cursor A on the nearest one · n`.
- `‹` / `›`: `stepEvent(shown, range, cursorA, ∓1)` → `onJump(t, "a")`; disabled without a range or without a result.
- Empty in view: `No events in view` between the earlier and later buttons; the existing empty texts otherwise.
- Refine: closed by default; its open state saved (P1). The focus request (`focus` prop bumped by `e` and the strip count) opens it, then focuses and selects the field. `aria-expanded` on the button.

### P4: Rows (pinned, `EventsPanel.tsx`, `events.css`)

- **Event row** (`button.events-row`): line 1 `span.events-glyph` (filled in `markColor`; hollow for `isRead`, P5), `formatTime(t, 3)`, `span.events-cat` = `CATEGORY_TEXT[c].label` (margin-left auto, muted 10 px). Line 2 `span.events-body`: `span.events-name` (mono) `rowName(e)`, a space, the text (change: `<from> → <to>`), for an inferred change a muted ` · after a gap`. `.events-body { white-space: normal; overflow-wrap: anywhere; }`, no `text-overflow`, no `nowrap` anywhere in the row. `title` = `eventTitle(e)` (P5).
- **Read row** (`div.events-read`): a `button.events-row` (line 1 hollow glyph, time, `Fault memory read`; line 2 `readSummary`) and a sibling `button.events-expand` (20 px, `▸`/`▾`, `aria-expanded`, `title` `Fault memory read: show its DTCs`), expansion kept in panel state per `t|source`, closed by default. Expanded: one `div.events-dtc` per event: name (mono), status (`e.status`), then the text, wrapping; not clickable.
- **Click** (event and read rows): `onJump(BigInt(t), shiftKey ? "b" : "a")`.
- **Current:** rows whose `t` equals cursor A (`cursorA` prop) get class `current` (background `var(--accent-soft)`). When cursor A changes and the panel is shown, the first current row is scrolled into view (`block: "nearest"`). The accent left border for rows in range stays only in scope `all`.

### P5: Marks (pinned, `apps/web/src/events/marks.ts`)

```ts
export interface Mark { x0: number; x1: number; events: DiagEvent[]; category: EventCategory; read: boolean; drawn: Rect; hit: Rect }
// read: every event of the mark is a DTC (isRead). drawn width: max(events.length > 1 || read ? PIN_W_MANY : PIN_W, x1 − x0 + PIN_W).
export const READ_LINE = "Fault memory read at this time; when a fault first occurred is unknown";
/** Inline style of a pin or glyph: read → { background: "var(--panel)", boxShadow: `inset 0 0 0 1px ${markColor(category)}` }; else { background: markColor(category) }. */
export function markStyle(m: Mark): { background: string; boxShadow?: string };
/** The one-event tooltip (V4 lines), plus READ_LINE last for a DTC. markTitle uses it for one event. */
export function eventTitle(e: DiagEvent): string;
```

`markTitle` for several events: after line 1, `READ_LINE` when any event is a DTC; then the event lines as today. Canvas lines (`drawEventLines`) are unchanged: faults are solid and every fault is a DTC, so the key explains them.

Users: `TimeStrip.tsx` pins `style={{ left, width, ...markStyle(m) }}`; `TimeseriesWindow.tsx` `placeEventGlyphs`: `Object.assign(glyph.style, markStyle(m))` in place of the background assignment. Nothing else in those files.

### P6: Key line (pinned, `EventsPanel.tsx`, `events.css`)

`div.events-key` at the panel's bottom, outside the scrolling list: five items, each a 6 × 10 px sample and a word: `Fault` (fault colour, solid left border 2 px), `Stored` (stored colour, solid), `Change` (change colour, dashed), `Other` (info colour, dotted), `Fault memory read` (hollow glyph in the fault colour). `title` on the line: `Event key: colours of pins and glyphs, line styles in the plots; hollow means the time a fault memory was read` (W1 of add-guidance, ≤ 140 characters).

### P7: Steps and jumps in App (pinned, `App.tsx`, `keys.ts`) — proposal E-2

```ts
// keys.ts: NavKey gains "prevEvent" | "nextEvent"; navKey maps "p" → prevEvent, "n" → nextEvent (same rules: no Ctrl/Meta/Alt, not in text fields).
// App.tsx:
/** E-2: if t lies outside the bar target's range, centre it there (span kept, one window.setRange, history push);
 *  then cursor.set {cursor, t} through onCursorCommit. Replaces onCentre. */
const onJump = useCallback((t: bigint, cursor: CursorName) => void, [...]);
```

`onNavKey`: `prevEvent`/`nextEvent` like the drive keys: bar target, its view (`navView`), `stripShown` (the shown events of the strip's data ref), `cursorsRef.current.a`, `stepEvent`; once per press (`e.repeat` ignored); nothing sent without a target, view or result. Two revisions when the view moves (range, then cursor), one otherwise; Back restores the range, not the cursor (cursors are not in the zoom history).

`EventsPanel` props: `onCentre` removed; `onJump(t: bigint, cursor: CursorName)`, `cursorA: bigint | undefined` added. `StripEvents` gains `describe: string` (App: `describeEventFilter(appliedFilter(eventFilter))`) for the count's tooltip (P8).

### P8: Strip count (pinned, `TimeStrip.tsx`)

Text unchanged (`<shown> of <total> events`). Its tooltip is `add-guidance`'s `HINTS.eventsCount(shown, total, sentence)` (`<shown> events match the filter (<sentence>), <total> in the recording · click to open the list · e`) with `sentence` = `StripEvents.describe`; if this change is built first, it writes that text through a local helper that `add-guidance` then moves into `hints.ts`. Its click opens the panel, the Refine section and focuses the field (P3). All new titles in `events/*` follow `add-guidance`'s wording rule W1 (`<Name>: <what it does> · <key>`, sentence case, no closing period, ≤ 140 characters).

## Shared files (parallel changes)

| File | This change | Other change |
|---|---|---|
| `apps/web/src/chart/TimeseriesWindow.tsx` | `placeEventGlyphs`: one style line (P5) | `add-gap-display` (being built: inputs, `drawClear` bands, readouts). Build after it lands; no overlap in functions. |
| `apps/web/src/App.tsx` | events block: `onCentre` → `onJump`, panel props, `StripEvents.describe`, `n`/`p` in `onNavKey` | `add-guidance` (target window highlight), `add-saved-views` (save/share). Keep edits inside the events block and `onNavKey`. |
| `apps/web/src/time/TimeStrip.tsx` | pin style spread, `describe` passed to the count's tooltip, count click opens Refine | `add-guidance` owns the count's tooltip text (`HINTS.eventsCount`); the second change to build merges. |
| `apps/web/src/keys.ts` | `NavKey` + two cases (`n`, `p`) | `add-guidance` adds `isHelpKey` (`?`); its shortcut list should name `n`/`p` once both are in. |
| `add-guidance` manual, `## Events` | not written here | kept short on purpose; whichever change builds second adds one line each: `In view`/`All`, `n`/`p`, hollow = fault memory read. |
| `apps/web/src/events/*`, `events.css` | ours only | — |

No `packages/shared`, `apps/server`, `apps/cli` or `styles.css` edits; no new payload or command.

## Numbers: what if off by a factor of two

- **Read item from 2 DTCs:** 1 would turn every single DTC into a group of one (an extra click for nothing); 4 would leave groups of 2–3 as separate rows that still share one readout time (the hollow glyph and tooltip still say it).
- **Hollow mark min width 5 px (`PIN_W_MANY`), inset 1 px:** 3 px leaves a 1 px hole that reads as filled; 10 px widens the strip's 8 px hit and covers neighbours. 2 px inset at 5 px leaves a 1 px hole, too.
- **Expand button 20 px:** 10 px is hard to hit; 40 px takes a sixth of the 224 px row.
- **List cap 500 (unchanged):** in view it rarely applies (smart451's busiest 20 min hold 15 shown events).
- **Wrapping rows:** smart451's longest text is 164 characters (`P0D1A16`), about 4 lines at 224 px; twice that is 8 lines on one row, still readable; in view lists are short.

## Risks / Trade-offs

- [Moving A destroys a set measurement] → B stays; Shift+click sets B instead; E-2 asks Jan. Without moving A, stepping would need a second cursor kind in every chart (`TimeseriesWindow.tsx`, shared with `add-gap-display`).
- [Two revisions per out-of-view jump] → accepted; both are single commands; the CLI's `--wait` is unaffected (no CLI path).
- [In view hides context] → `↑ k earlier`, `↓ k later` and the switch's `All n` keep it visible; strip pins still show the whole recording.
- [Not every DTC source is a readout] → today every `dtc` row comes from a UDS fault memory read (data fact); a future source with onset times would need a kind or detail to tell them apart (finding to Jan then).
- [Keys `n`/`p` on non-US layouts] → letters exist on every layout without modifiers, unlike `[`/`]` (AltGr on German).

## Follow-ups (not in this change)

- Decoder (other repo): onset or freeze-frame time of DTCs, so faults can be matched to drives.
- Hover link row ↔ pin/glyph (highlight the mark of the hovered row).
- `All` scope scrolls to the view when the range changes.
- CLI: `events list` marks DTC rows as reads; `--in-view` with the UI's bar target.
- Scope and Refine state in saved views (`add-saved-views`).
- A drive headline and "latest drive" (persona item 1) with the drives of `/api/density`.

## Open questions for Jan (proposals, numbered E-n until Jan decides)

- **E-1 List scope:** (a) switch `In view | All`, default In view, kept per browser (recommended); (b) in view only, no switch; (c) all, scrolled to the view.
- **E-2 Stepping:** (a) `n`/`p`, `‹ ›` and row click move cursor A to the event, centre only when outside (recommended); (b) they only centre the view and highlight the row, cursors untouched; (c) a separate event cursor line in the charts (more work, shares `TimeseriesWindow.tsx`).
- **E-3 Fault memory reads:** (a) one `Fault memory read` row per ECU and time, expandable; hollow marks; tooltip line (recommended); (b) keep one row per DTC with a "read" tag; (c) a separate fault memory table at the panel top, DTCs removed from the timeline list.
- **E-4 Declutter:** (a) field, chips and events-line signals in a `Refine` section, closed by default; description, hidden count and presets stay visible (recommended); (b) field visible, only chips folded; (c) all visible, tighter spacing.

## Ledger entry on archive (proposed for `docs/decisions.md`, number assigned by the lead)

- Events usability: list scoped to the bar target's view (`In view | All`, local storage `kipscope.eventsScope`, default view), `↑ earlier`/`↓ later` jumps, `n`/`p` and row click put A on an event and centre only outside the view; DTCs are fault memory reads (one row per ECU and time, hollow marks, `READ_LINE`); Refine section closed by default; rows wrap; key line; strip count tooltip.

## Jan's answers (2026-10-17)

Jan: „all recommended“. E-1 to E-4 are decided as recommended in this design; the lead numbers them as D-nnn on archive.
