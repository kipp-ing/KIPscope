# Design

## Context

See proposal.md for the why. Jan's words, quoted:

- **D-017:** „signalexplorer als liste mit hover infos. bei eingabe in suchliste filtern auch auf teile." Ledger: "The signal explorer is a list with details on hover." / "The explorer search filters on parts of the input (substring match), not only on whole names."
- **D-018:** "The window-workflow change also takes: explorer ranking and match highlighting without a hard cap, stable signal colours across windows, window rename, and window layout with keys (…)." The lead split the explorer part into this change; `improve-window-workflow` keeps the rest. Nothing of D-018 is changed by the split (lead, D-019).
- **D-020:** "Explorer rows can be dragged onto windows; a window that would reach a fifth unit is shown as refused, the same rule as for legend drags (D-019)." / "The explorer list is keyboard-driven: `/` focuses the search, arrow keys move, Enter adds, Esc clears." / „The "Add to" target stays where the user put it; creating, renaming or reordering windows does not move it.“
- **Concept §4:** „Ein Signalexplorer bietet Suche über Name, Beschreibung, Alias und Einheit. Vorhandene Metadaten werden angezeigt."

Current code: `Catalog.search` (server) already does case-insensitive substring per whitespace term, AND across name/description/alias/unit, in catalog order (name, dataRef), paged (default 50, max 200). The web calls `/api/signals?limit=100` 200 ms after the last keystroke; rows render description, SNA text and data reference inline. `parseDbc` reads `BO_` ID and name, `SG_` length/sign/factor/offset (for SNA only), unit, `CM_`, `VAL_` (kept in `DbcSignal.values`, never sent), `GenSigSNA`. `[min|max]` and the file a key came from are not kept.

### Data facts (checked 2026-10-14)

- carserver `smart451`: 428 signals (skeleton design). Test DB: 1,013 signals (add-sna-handling 3.1), of which 1,000 are `Many_700h.S0000–S0999`.
- h-can.dbc: `BO_ 1042 COMBI_412h` / `SG_ V_ANZ : 0|9@0+ (1,0) [0|510] "km/h"`, `CM_ "Indicated speed"`, `VAL_ 511 "SNV"`; `BO_ 1544 MS_608h` / `SG_ T_MOT : 0|8@1+ (1,-40) [-40|214] "°C"`, `CM_ "Motortemperatur"`, `VAL_ 255 "SNV"`; `BO_ 512 BS_200h` / `SG_ DVL : 21|14@0+ (0.5,0) [0|8191] "1/min"`, `CM_ "Wheel speed front left"`. hybrid-can.dbc: `SG_ PTC_HV_Volt … (0.1,0) [0|819] "V"`.
- h-can.dbc: 93 of 568 `SG_` lines have `[0|0]` (DBC convention: no range given) → shown as `not set`.

## Goals / Non-Goals

**Goals:** one-line rows, hover card with all DBC metadata, ranked substring search with highlights, every match reachable, list updates per keystroke, keys, explorer rows as a drag source including their drop branch (add, unit-limit refusal) on the window change's pointer drag.

**Non-Goals:** any change to legend-row drags (move/copy, their hint and states stay as `improve-window-workflow` D5 pins them), window titles in "Add to" (`improve-window-workflow`: `window.rename`, "Window n"), windows/axes/zoom/cursors (`improve-window-workflow` and the cursor change), live catalog reload in the browser, fuzzy matching, alias data, a unit-limit warning on the `+` button or Enter (the server's `too_many_units` message shows as today).

## Decisions

### E1: Filter in the browser over the whole catalog
The web loads the full catalog once (`GET /api/catalog`, E3) and ranks it synchronously on every keystroke with the shared `searchSignals` (E2); no debounce, no request per keystroke. `Catalog.search` on the server uses the same function, so `/api/signals` (CLI, `signalInfo` lookup) orders identically and keeps paging.
- Size: 428 signals × ~0.4 KB ≈ 170 KB once per page load; 10,000 ≈ 4 MB. ×2 (8 MB) is still a one-time LAN load; at ×100 the browser approach stops paying off and search goes back to the server (not now).
- Speed goal: ranking 10,000 signals < 50 ms (test bound). At 428 real signals that is ~2 ms. ×2 (100 ms at 10k) would be noticeable only at catalogs 20× larger than today.
- Alternative rejected: keep server search and drop the debounce — still one round trip per key (the observed lag) and still a page cap.

### E2: Ranking and highlights (`packages/shared/src/search.ts`)
- Terms: `query.toLowerCase().split(/\s+/).filter(Boolean)`. Empty → all signals, catalog order, tier 3, no ranges.
- Per term on lower-cased fields; `n` = name, `s` = part of `n` after the first `.` (whole `n` if none): tier 0 if `t === n || t === s`; 1 if `n.startsWith(t) || s.startsWith(t)`; 2 if `n.includes(t)`; 3 if description, alias or unit includes `t`; else no match (signal excluded). Signal tier = max over terms.
- Order: stable sort of catalog order (name `localeCompare`, then dataRef) by tier. The input array is assumed to be in catalog order (server and `/api/catalog` deliver it so).
- Highlights: for each term, every non-overlapping occurrence in name, unit and description; ranges half-open `[start, end)` in UTF-16 indices of the original string, sorted, overlapping or touching ranges merged. Lower-casing keeps string length for DBC text (ISO-8859-1); no special handling for other scripts.
- Precomputed lower-case fields: `buildSearchIndex` once per catalog, `searchSignals(index, query)` per keystroke.

### E3: Full catalog route
`GET /api/catalog` → `CatalogSnapshot` (catalog order, all fields), 503 `catalog_unavailable` before the first load (same check as `/api/signals`). The web loads it on mount; on error it shows the message and retries every 5 s until loaded (catalog loads asynchronously at server start). ×2 on 5 s is irrelevant to users. A server-side refresh becomes visible after a page reload (live reload out of scope). After loading, the explorer calls `onSeen(snapshot.items)` so `App` keeps resolving signal metadata as today.

### E4: DBC details (`SignalInfo.dbc`)
`parseDbc(text, file?)` additionally keeps per entry: message name and `BO_` ID, factor/offset (already parsed), `[min|max]` from the same `SG_` line (extend `LAYOUT` with `\[\s*(NUMBER)\s*\|\s*(NUMBER)\s*\]`), the `VAL_` table, and `file` when given. `loadDbcFiles` passes `basename(path)`. `Catalog.refresh` copies these into `SignalInfo.dbc` (shape in S1); `values` sorted by raw ascending; `[0|0]` is passed through as written (the web shows `not set`). Raw step is not a field: it is `|factor|`, computed in the web.

### E5: One-line rows
Row = `[dot] name … unit [+]`, height ≤ 24 px, name ellipsized (full name in the card), unit right-aligned and muted. Dot only when `sna` is present, coloured like the chart's SNA lanes, `title`/`aria-label` `SNA <values> <unit>` (existing `formatSnaValue`). The `+` button (`aria-label` per E10) calls `onAdd(signal, target)` as the old "Add" button. Must: one line per row, no description, SNA text or data reference in the list. Goals (measured and reported, not pass/fail): row height ≤ 24 px, ≥ 25 visible rows at 900 px window height; ×2 smaller (12) is today's density, ×2 larger (50) would need ~12 px rows, unreadable.

### E6: Render chunks instead of a cap
Render the first `CHUNK = 500` matches; below them a button "Show N more" (N = min(500, remaining)) renders the next chunk; the count line reads `N matches` plus `, showing M` while M < N. The rendered count resets to 500 on every query change. ArrowDown on the last rendered row renders the next chunk. 500 covers the real catalog (428) without the button; ×2 (1,000 rows) still renders in tens of ms, ÷2 (250) only adds a click on empty queries. Pure helper `visibleCount(total, shown)` in `apps/web/src/explorer/format.ts` for the test. No virtual scrolling (rows ≤ 500 at a time make it unnecessary). On real data (428 signals) the button never appears, so its evidence there is the helper test only.

### E7: Hover card
- Opens after `HOVER_DELAY_MS = 350` on `pointerenter` of a row, or 350 ms after a row becomes active by keyboard. While a card is open, entering another row (or moving the active row) switches the card immediately. Closes `HIDE_GRACE_MS = 150` after the pointer left both row and card, on Esc, on list scroll, and on query change. ×2 delay (700 ms) feels sluggish; ÷2 (175 ms) opens cards while sweeping. ×2 grace is harmless; ÷2 makes reaching the card with the pointer harder.
- Placed right of the explorer, top aligned to the row, clamped into the viewport; `max-height: 60vh`, the value table scrolls. `role="tooltip"`, the row gets `aria-describedby` while open. The card is reachable by pointer (it stays open while hovered) so long value tables can be scrolled.
- Content and formats (omit a line when its field is absent):
  - name (highlighted), description (highlighted)
  - `Message`: `<message> · <formatMessageId(id)>`
  - `Unit`
  - `Scaling`: `formatScaling(factor, offset)`; `Raw step`: `formatRawStep(factor, unit)`
  - `Range`: `formatDbcRange(min, max, unit)`
  - `SNA`: each code `<formatSnaValue(value)> <unit> (raw <HEX>h)`, comma-separated
  - `Values`: one line per `VAL_` entry `<raw> <label>`
  - `Source`: `formatSource(signal)`: `<dataRef> · <file>`, `<dataRef> · DBC` when `file` is absent, or `<dataRef> · no DBC entry` when `dbc` is absent
  - `Shown in`: `windowsShowing(windows, id)` joined by `, `, or `no window`
- Pinned formatter outputs (`apps/web/src/explorer/format.ts`, tested): `formatScaling(1, 0)` → `× 1 + 0`, `(0.5, 0)` → `× 0.5 + 0`, `(1, -40)` → `× 1 - 40`; `formatRawStep(0.5, "1/min")` → `0.5 1/min`, `(-2, undefined)` → `2`; `formatDbcRange(0, 510, "km/h")` → `0 … 510 km/h`, `(0, 0, …)` → `not set`, `(-40, 214, "°C")` → `-40 … 214 °C`; `formatMessageId(1042)` → `0x412`, `(0x98FF1234)` → `0x18FF1234 (ext)`; `windowsShowing` returns `windowTitle(w)` (`packages/shared`, "Window <n>" when untitled) of each window whose `signals` contain the ID, in window order. Numbers print via `String(n)`.

### E8: Keys
The search input is a combobox (`role="combobox"`, `aria-controls` the list, `aria-activedescendant` the active row); the list is `role="listbox"`, rows `role="option"` with `aria-selected`. Focus stays in the input while arrows move the active row.
Keys origin: D-020.
- `/` (global `keydown` on `window`): if `isTextField(document.activeElement)` (`apps/web/src/keys.ts`, the same check as Backspace) is false, `preventDefault()`, focus and select the search field.
- In the search field: Esc → clear query, close card, active row 0. ArrowDown/ArrowUp → active ± 1, clamped, `scrollIntoView({block: "nearest"})`, `preventDefault()`. Enter → `onAdd(activeSignal, target)` if there is a result. Any query change → active row 0.

### E9: Drag source on the window change's pointer drag
`improve-window-workflow` (its design D5) builds drag and drop with pointer events, not HTML5 drag-and-drop: `App` owns the drag state, ghost, highlighted targets, "+ New window" zone and Esc; legend rows call `onDragStart(source, event)` on pointer down and `App` starts the drag after `DRAG_THRESHOLD_PX` (4 px). A MIME payload would not reach that machinery, so the explorer joins it instead: on `pointerdown` (primary button) on a row's name it calls `onDragStart({ signalId }, event)` (S3); the `+` button stops propagation. While `dragging` is true the explorer closes its card and starts no new one. This change runs after `improve-window-workflow`, so D5 exists; task 3.4 adds the explorer branch to its drop side per S3 (origin D-020: drop adds; a window that would reach a fifth unit is refused, the same rule as legend drags).
- Alternative rejected: HTML5 drag-and-drop with a MIME type (`application/x-letsview-signal+json`). It would need a second drop path in every window, and the UI user's browser automation cannot drive native drag-and-drop reliably (window change D5).

### E10: Stable "Add to" target
Origin D-020 ("Add to" jumping under the click is a reproduced bug). State `target: string` holds a window ID or `NEW_WINDOW`, never an option index. It changes only in the select's `onChange`. On every `windows` change it passes through `resolveTarget(target, windows)` (`apps/web/src/explorer/format.ts`): unchanged when a window with that ID exists or it is `NEW_WINDOW`, else `NEW_WINDOW`. An add via "New window" does not switch the target to the created window. The `+` button's `title` and `aria-label` read `Add to <title>` (`Add to new window`), titles via `improve-window-workflow`'s `windowTitle`; Enter adds to the same target. Options keep window order and use the window ID as `key` and `value`.

## Shared interfaces (pinned)

### S1: Catalog DTOs (`packages/shared/src/signals.ts`, additive)

```ts
/** One `VAL_` entry. */
export interface DbcValueLabel {
  raw: number;
  label: string;
}

/** DBC metadata of a signal (design E4). Fields absent when the DBC line could not be parsed. */
export interface DbcInfo {
  /** Basename of the DBC file the entry came from (first file wins), e.g. `h-can.dbc`. */
  file?: string;
  /** `BO_` message name, e.g. `COMBI_412h`. */
  message: string;
  /** `BO_` ID as written (decimal; extended IDs keep bit 31), e.g. 1042. */
  messageId: number;
  /** physical = raw × factor + offset. */
  factor?: number;
  offset?: number;
  /** `SG_` `[min|max]` as written, physical; `[0|0]` passed through. */
  min?: number;
  max?: number;
  /** `VAL_` table sorted by raw ascending; absent (never empty) when none. */
  values?: DbcValueLabel[];
}

export interface SignalInfo {
  // … existing fields unchanged …
  /** Absent when the signal has no DBC entry. */
  dbc?: DbcInfo;
}

/** `GET /api/catalog` (design E3). */
export interface CatalogSnapshot {
  /** Every signal, catalog order (name, then dataRef). */
  items: SignalInfo[];
  /** ISO time of the catalog load. */
  loadedAt: string;
}
```

JSON key order of `dbc` follows the interface (`file, message, messageId, factor, offset, min, max, values`); the spec's curl uses `jq -S`, so order is not tested.

### S2: Search (`packages/shared/src/search.ts`, exported from `index.ts`)

```ts
import type { SignalInfo } from "./signals.ts";

/** 0 exact, 1 prefix, 2 name substring, 3 description/alias/unit (design E2). */
export type MatchTier = 0 | 1 | 2 | 3;
/** Half-open [start, end) in UTF-16 indices of the original string. */
export type MatchRange = readonly [start: number, end: number];

export interface SignalMatch {
  signal: SignalInfo;
  tier: MatchTier;
  /** Sorted, merged; [] when nothing matched in that field. */
  name: MatchRange[];
  unit: MatchRange[];
  description: MatchRange[];
}

/** Opaque precomputed lower-case fields; build once per catalog. */
export interface SearchIndex {
  readonly signals: readonly SignalInfo[];
}

export function buildSearchIndex(signals: readonly SignalInfo[]): SearchIndex;
/** Ranked matches, best first; empty query → all signals in input order, tier 3, no ranges. */
export function searchSignals(index: SearchIndex, query: string): SignalMatch[];
```

The server's `Catalog` builds the index in `refresh()` and maps `searchSignals(...).map(m => m.signal)` onto its page; `SignalPage` is unchanged.

### S3: Explorer drag source — shared with `improve-window-workflow` D5

Explorer side (this change, `SignalExplorer.tsx` props, added):

```ts
/** Pointer down on a row's name; App starts its signal drag after DRAG_THRESHOLD_PX (window change D5). Absent → rows not draggable. */
onDragStart?: (source: ExplorerDragSource, event: React.PointerEvent) => void;
/** True while an App-level signal drag runs; the explorer closes and suppresses its hover card. */
dragging?: boolean;
```

Added to `apps/web/src/chart/drag.ts` next to D5's `DragSource`, `DropTarget`, `DRAG_THRESHOLD_PX`, `canDrop(source, target, windows, unitOf)` and `dropCommand(source, target, windows, unitOf, mods)`, which stay as they are (legend sources only, `window.moveSignal`):

```ts
/** A signal dragged out of the explorer (D-020): no source window, a drop always adds. */
export interface ExplorerDragSource { signalId: string }
/** Anything App drags: a legend row (D5) or an explorer row. */
export type AnyDragSource = DragSource | ExplorerDragSource;
/** True for a legend row (it has a source window). */
export function isLegendSource(source: AnyDragSource): source is DragSource;

/** An explorer drop is accepted by a window that does not show the signal yet and keeps ≤ MAX_UNITS
 * units (windowUnits with the signal as extra); "new" always accepts. */
export function canAdd(
  signalId: string,
  target: DropTarget,
  windows: TimeseriesWindow[],
  unitOf: (signalId: string) => string | undefined,
): boolean;

/** Highlight of one window during a drag. */
export type DropState = "source" | "target" | "refused";
/** "source": the legend source window (never for an explorer source); "target": canDrop (legend) or
 * canAdd (explorer); "refused": the window does not show the signal but would exceed MAX_UNITS with it;
 * else undefined. For legend sources this equals App's current `dropStateOf` (moved here to be testable). */
export function dropStateFor(
  source: AnyDragSource,
  windowId: string,
  windows: TimeseriesWindow[],
  unitOf: (signalId: string) => string | undefined,
): DropState | undefined;
```

`TimeseriesWindow.tsx` props (D6), added:

```ts
/** What a drop does; only read while dropState is "target". Absent → "move". */
dropAction?: "move" | "add";
```

Hint while `dropState === "target"`: `"Drop to add"` when `dropAction === "add"`, else D5's `"Drop to move · Alt/Ctrl+drop to copy"`. `"refused"` shows `"At most 4 units per window"` (`HINT_REFUSED`) for both sources. Classes (`drop-target`, `drop-refused`, `drop-source`) are unchanged, so `window.css` needs no change.

`App.tsx`, for an explorer source (legend sources unchanged):
- `Drag.source: AnyDragSource`; `onDragStart(source: AnyDragSource, event)` is passed to every `TimeseriesWindow` (which calls it with a `DragSource`) and to `SignalExplorer`; `dragging={activeDrag !== undefined}`.
- Each window gets `dropState` from `dropStateFor` and, during an explorer drag, `dropAction="add"`. No window is dimmed as source. "+ New window" appears as for legend drags.
- Valid target (`overValid`): `canAdd(source.signalId, target, …)`. Ghost: the signal name, then ` · add` while over a valid target, else nothing; ` · Already shown` while over a window that shows the signal. Alt/Ctrl change nothing (no ` · copy`, no copy flag).
- Release over a target with `canAdd` → `addSignal(info(signalId), target.kind === "new" ? NEW_WINDOW : target.windowId)` (the explorer's add path, reached through a ref so the drag listeners see the current function); `info` is filled by `onSeen(snapshot.items)` (E3), and if it is absent the drop does nothing. Release over a refused window, elsewhere, or Esc → no command.

Evidence: `apps/web/test/drag.test.ts` (fixtures as in the existing tests: `wA` = V_ANZ km/h + DVL 1/min, `wB` = PTC V, plus `wC` = EAC V + V_ANZ km/h + T_MOT °C + DVL 1/min):
- "adds an explorer signal to windows not showing it and to a new window": `canAdd("c/V_ANZ", wA)` false, `(…, wB)` true, `(…, new)` true; `dropStateFor({signalId: "c/V_ANZ"}, "wA")` undefined, `"wB"` `"target"`, never `"source"`.
- "refuses an explorer drop that would make a fifth unit": `canAdd("c/DNMOT", wC)` false and `dropStateFor` `"refused"`; `canAdd("c/PTC", wC)` true (V already there).
- "keeps the legend-drag states": `dropStateFor` for a legend source from `wA` gives `"source"` on `wA` and the states the existing three tests expect elsewhere.

Built by this change (task 3.4, D-020) on top of D5; legend-source behaviour stays as D5 pins it.

### S4: Web-internal (pinned for parallel web tasks and tests)

`apps/web/src/explorer/format.ts`: `HOVER_DELAY_MS`, `HIDE_GRACE_MS`, `CHUNK`, `visibleCount(total, shown): number` (`min(total, shown)` with `shown` a multiple of `CHUNK`), `nextShown(total, shown): number` (`min(total, shown + CHUNK)`), `formatScaling`, `formatRawStep`, `formatDbcRange`, `formatMessageId`, `formatSource`, `windowsShowing` (E7), `resolveTarget(target: string, windows: TimeseriesWindow[]): string` (E10). `NEW_WINDOW` stays exported from `SignalExplorer.tsx` with the value `"new"`; `format.ts` defines the same value as its own `NEW_WINDOW` constant, and `SignalExplorer.tsx` re-exports it from there.

`apps/web/src/api.ts`: the HTTP helper `searchSignals(q, abort)` is renamed `fetchSignalPage(q, abort)` (no clash with the shared `searchSignals`); `signalInfo` keeps using it. New: `fetchCatalog(abort?): Promise<CatalogSnapshot>` (`GET /api/catalog`).

`apps/web/src/explorer/SignalCard.tsx`:

```ts
interface SignalCardProps {
  match: SignalMatch;            // signal + description ranges for highlighting
  windows: TimeseriesWindow[];   // for "Shown in"
  anchor: DOMRect;               // the row's rect; the card positions itself (E7)
  id: string;                    // DOM id for the row's aria-describedby
  onPointerEnter: () => void;    // keep open while hovered
  onPointerLeave: () => void;
}
```

`apps/web/src/explorer/Highlight.tsx`: `<Highlight text={string} ranges={MatchRange[]} />` renders `<mark>` around ranges. `SignalExplorer.tsx` owns loading, the list, keys, chunks, drag and the open/close timers, and renders `SignalCard`.

## Risks / Trade-offs

- [Full catalog in the browser grows with the source] → fine up to ~10k signals (E1); beyond, return to server search.
- [Existing tests assert `toEqual` on DBC signals] → they gain `dbc`; the tester updates them (tasks 4.2).
- [Explorer drag depends on the window change's D5] → this change runs after it; task 3.4 extends D5 without changing its legend behaviour (test "keeps the legend-drag states").
- [Both changes edit `SignalExplorer.tsx`] → the window change only touches the "Add to" titles; it runs before this change.
- [`/` as a global key could clash with later shortcuts] → only outside text fields; the window change's keys must avoid `/`.
- [Archive order] → `specs/timeseries-window/spec.md` here MODIFIES "Drag feedback and cancel", which `improve-window-workflow` ADDS. `improve-window-workflow` is archived first (before this change is built, D-020); archiving this change before it would fail. `apps/web/src/keys.ts` (`isTextField`) also comes from that change.

## Resolved

- Lead (2026-10-14, recorded in D-019): the D-018 split into this change is fine.
- Jan (D-020): explorer drag with the unit-limit refusal, the keys `/`, arrows, Enter, Esc, and the stable "Add to" target are in scope; task 3.4 (explorer branch of the drop) belongs here. Window titles come from `improve-window-workflow`.
