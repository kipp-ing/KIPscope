# Design: add-multi-select

## Jan's decisions (quoted from the lead's brief, 2026-10-17)

- **D-065:** „Clicking, double-clicking or Shift/Ctrl-clicking in the signal explorer list (rows and group headers) never selects page text. The search field stays a normal text field."
- **D-066 multi-select and overflow:** Jan chose „Only by unit limit": a multi-select drop or add has no signal-count limit. Signals go into the target window until one would need a 5th unit (`MAX_UNITS` = 4, the existing axis limit). From there on they continue in a new window, and further new windows as needed, each again up to 4 units. Jan chose „Fill it up": the target window's current units count, so a window already showing 3 units takes only signals of those units plus one new unit. Single adds and drops behave as today.

## Context

- **Text selection today:** `SignalExplorer.tsx` starts a drag only from `pointerdown` on the row's `.name` span; `App.onDragStart` calls `holdNoSelect()` (`noselect.ts`), which adds `.no-select` and blocks `selectstart` for the drag's lifetime. A press anywhere else in the list (SNA dot, unit, row padding, group header, "Show more") runs the browser default: a drag selects text, a double-click selects a word, a Shift-click extends the page selection from wherever the caret was. Rows are not focusable, so a press also blurs the search field.
- **Add paths today:** `+` and Enter call `onAdd(signal, target)` → `App.addSignal`: for "New window" it sends `window.create` (with the signal's extent unless linked with a timeseries window present), then `window.addSignal`. An explorer drop calls the same after `canAdd` (`chart/drag.ts`), which refuses a window showing the signal or one that would reach a fifth unit. The strip (`{kind: "events"}`) takes one signal via `eventsDrop` → `events.addSignal`.
- **Limits:** `MAX_UNITS` 4 (`windowUnits` counts unit keys; a signal without unit is its own key `s:<id>`), `MAX_SIGNALS` 50 distinct per workspace (`signal_limit`), `MAX_WINDOWS` 64, `MAX_EVENT_SIGNALS` 8. Commands are applied one by one; each success raises the revision by one.
- **smart451 test material** (catalog of the dev server, 2026-10-17): the query `speed` lists, grouped, `SAS`: LWS_SPEED (°/s); `AC`: CompSpd_Target_V2 (%); `ESP`: DVL, DVR, TM_DL, DHL, DHR (all 1/min); `CGW`: V_DSPL_AKT, V_DSPL_AUS, V_MPH (no unit), V_ANZ (km/h); `TCU`: N_EGS (1/min), N_EGS_ACT, N_PAR_EGS, NTGL_EGS; `Engine`: V_DSPL_EIN, V_DSPL_MODE_SL, V_MAX_EIN, V_MAX_TM (km/h(mph)), NMOTS (~/min), N_MAX_BG. So LWS_SPEED, CompSpd_Target_V2, DVL, V_ANZ, V_MAX_TM, NMOTS are six signals with six named units under one query. No query has six distinct named units in six consecutive rows, so the six-unit scenario uses Ctrl/Cmd-clicks.
- **No jsdom** in the repo: every web test runs in Node. Adding jsdom is a new devDependency in `apps/web/package.json`, outside the tester's write area. The D-065 evidence therefore tests the pure press handler and the stylesheet rule in Node (M1), plus the UI check.

## Goals / Non-Goals

**Goals:** D-065 and D-066 as quoted; the lead's defaults below; every single-signal path unchanged (existing `drag.test.ts` and `explorer.test.ts` stay green); one round of work.

**Non-Goals:** see the proposal's Out of scope.

## Lead's defaults (not Jan's; Jan can veto each)

- **L1 Selection keys:** plain click on a row selects only it and makes it the active row. Ctrl-click on Windows/Linux and Cmd-click on macOS toggles a row. Shift-click selects the range from the anchor (last plain or toggle click) to the row, signal rows only, in list order across groups. Shift+Arrow in the search extends the range from the keyboard. A query change clears the selection. Selected rows get a visible selected style per the design language; the active row style stays distinct.
- **L2 Drag:** dragging any selected row drags the whole selection (the ghost shows „N signals"); dragging an unselected row drags only that row (selection unchanged).
- **L3 Add:** the `+` button of a selected row and Enter in the search add the whole selection to the "Add to" target; on an unselected row they add only that row.
- **L4 Placement:** walk the selection in list order. A signal already shown in the target window is skipped. Each signal goes into the first window, target first, then the overflow windows created by this drop in order, where it fits by units. If none fits, a new window opens. New windows are created like today's "new window" add (linked range or the signals' extent). `MAX_SIGNALS` still applies; on hitting it, stop and show the server's message once.
- **L5 Events strip:** a drop of a selection on the strip adds those with states that are not listed yet and skips the others silently.
- **L6 Targets:** during a selection drag a window is a valid target if at least one selected signal is not shown there yet (overflow handles units); "+ New window" always.

## Decisions

### M1: No text selection in the list (D-065)

- `styles.css`: `.explorer .results { user-select: none; -webkit-user-select: none; }`. It covers rows, group headers and "Show more", not the search field, the "Add to" select or the count.
- `explorer/selection.ts` exports `preventListPress(e: { button: number; preventDefault(): void }): void`, which calls `e.preventDefault()` for every button. `SignalExplorer` attaches it as `onMouseDown` of the `.results` element. Effect: no text selection starts on press, double-click or Shift-click, and focus stays where it was (in the search after typing, so Enter and Shift+Arrow keep working after a click). Pointer events, `click` and the App's document-level drag listeners are unaffected (`mousedown`'s default is selection and focus, not event dispatch).
- `noselect.ts` is unchanged; drags still hold it.

Alternative rejected: blocking `selectstart` on the list. It stops a selection starting in the list, but a Shift-click there still extends a selection anchored elsewhere in Chrome, and the press still blurs the search.

### M2: Placement (pinned, new `packages/shared/src/placement.ts`)

```ts
import type { WorkspaceWindow } from "./workspace.ts";

/** One placed signal: into the target window, or into the k-th window this add creates (0-based). */
export interface PlacementStep {
  signalId: string;
  into: "target" | number;
}

export interface PlacementPlan {
  /** In input order. Window k is created right before its first step. */
  steps: PlacementStep[];
  /** Number of windows to create (max `into` + 1, 0 when none). */
  windows: number;
  /** Signals the target already shows, in input order; never placed. */
  skipped: string[];
}

/**
 * D-066 with lead default L4. `target` undefined means "+ New window": window 0 is created for the
 * first signal. A timeseries target and every created window hold at most MAX_UNITS unit keys
 * (windowUnits/unitKey, a signal without unit is its own key), the target's existing signals
 * included; a values target takes every unit. Each signal goes into the first window where it fits:
 * the target, then created windows in creation order; if none fits, a new window. Repeated IDs in
 * `signalIds` count once (first occurrence). Pure.
 */
export function placeSignals(
  signalIds: readonly string[],
  target: WorkspaceWindow | undefined,
  unitOf: (signalId: string) => string | undefined,
): PlacementPlan;
```

Examples (unit keys as letters; target T):
- T empty timeseries, input u1…u6 → steps T,T,T,T,0,0; `windows` 1.
- T shows {a,b,c}, input d,e,a,f,b → d→T (4 keys), e→0, a→T (key a is in T), f→0, b→T; `windows` 1.
- T undefined, input u1…u9 → 0,0,0,0,1,1,1,1,2; `windows` 3.
- T a values window showing x, input x,u1…u6 → x skipped, all six → T.

Numbers: `MAX_UNITS` is D-019's constant; at 2 a six-unit selection would make three windows, at 8 one. The plan itself is O(n · windows) with n ≤ selection size; a full-list selection of 553 signals costs microseconds.

### M3: Running a plan (pinned, new `apps/web/src/addSignals.ts`)

```ts
import type { CommandInput, CommandResult, PlacementPlan } from "@kipscope/shared";

export interface AddDeps {
  command: (input: CommandInput) => Promise<CommandResult>;
  /** Range of a created window: undefined → none (linked with a timeseries window present);
   *  else extentRange of the extents of `signalIds` (union). May throw (fetch). */
  rangeFor: (signalIds: string[]) => Promise<{ from: bigint; to: bigint } | undefined>;
}

/**
 * Sends the plan in step order: before the first step into created window k, `window.create`
 * (with rangeFor(all signals of window k)); then `window.addSignal` into the target ID or the created
 * window's ID. Stops at the first result with ok false (its message stays shown, since `command`
 * sets it) or the first thrown error (rethrown). Returns the IDs of the windows created.
 */
export function runPlan(plan: PlacementPlan, targetId: string | undefined, deps: AddDeps): Promise<string[]>;
```

`App.addSignals(signalIds: string[], target: string)` (target: window ID or `NEW_WINDOW`) computes `placeSignals(ids, targetWindow, unitOf)` on `liveRef.current.workspace`, runs it with `deps.command = command` and `rangeFor` = today's rule (`linked && windows.some(isTimeseries)` → undefined, else `extentRange(await Promise.all(ids.map(fetchExtent)))`), shows a thrown error as today (`setMessage`), and reveals the first created window (`setReveal`). A one-signal list still goes through today's `addSignal` (single paths unchanged). Revisions: one per command, e.g. six signals of six units onto "+ New window" = 2 creates + 6 adds = +8.

Why web commands, not a server command: every step is an existing command with existing refusals; a plan of ≤ 50 adds is ≤ ~64 sequential local POSTs (each a few ms); a batch command would need a new schema, server route and CLI story for no visible gain. If a step is refused mid-way (another tab added signals meanwhile), the steps before it stay; that is the same as adding them one by one.

### M4: Drag source and targets (pinned, `apps/web/src/chart/drag.ts`)

```ts
export interface ExplorerDragSource {
  signalId: string; // the pressed row (ghost swatch; single-signal paths)
  /** Set only for a selection of two or more: the selection in list order, including signalId. */
  signalIds?: readonly string[];
}

/** L6: "new" → true; "events" → false; a window → it exists and does not show at least one of signalIds. */
export function canAddAny(signalIds: readonly string[], target: DropTarget, windows: WorkspaceWindow[]): boolean;

/** L5: the IDs of signalIds whose info has `states` and that are not in ws.eventSignals, in order. */
export function eventsDropMany(signalIds: readonly string[], infoOf: (id: string) => SignalInfo | undefined, ws: Workspace): string[];
```

`dropStateFor` with a source carrying `signalIds`: "target" when `canAddAny`, else undefined (never "refused"). `isCopy` stays false for explorer sources. App uses `signalIds` wherever it used `canAdd` for an explorer source; on release over a window or "new" it calls `addSignals(signalIds, …)`; over the strip it sends `events.addSignal` for each ID of `eventsDropMany`, in order, stopping at the first refusal (e.g. `event_signal_limit`).

Ghost (`App.tsx`): label `N signals` (N = `signalIds.length`), swatch of the pressed row, mode ` · add` over a valid target, note `· Already shown` over a window that shows all N.

Strip text (`time/TimeStrip.tsx`): `StripDrop` gains `{ ok: false; reason: "none_new" }`; `stripDropText` gives `None of <name> has new named states` for it. App passes, for a selection, `name` = the one eligible signal's shown name when exactly one is eligible, else `<k> signals` (k eligible) with ok true; with none eligible, `name` `<N> signals` and reason `none_new`.

### M5: Selection in the explorer (pinned, new `apps/web/src/explorer/selection.ts`)

```ts
import type { ExplorerItem } from "./groups.ts";

/** Selected signal IDs and the anchor of Shift ranges (a signal ID). */
export interface Selection {
  ids: ReadonlySet<string>;
  anchor?: string;
}
export const NO_SELECTION: Selection;

export type ClickMode = "plain" | "toggle" | "range";
/** True on macOS (navigator.platform starts with "Mac", or userAgentData.platform "macOS"). */
export function isMacPlatform(platform: string): boolean;
/** Shift → "range"; else Cmd (mac) or Ctrl (others) → "toggle"; else "plain". */
export function clickMode(e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }, mac: boolean): ClickMode;
/** L1 for a click on signal item `index`: plain → {that row}, anchor it; toggle → flip it, anchor it;
 *  range → the signal rows between anchor and it (inclusive, headers skipped), anchor kept; an anchor
 *  not in `items` counts as the clicked row. */
export function selectClick(sel: Selection, items: readonly ExplorerItem[], index: number, mode: ClickMode): Selection;
/** Shift+Arrow from item `from` to item `to`: anchor = sel.anchor if in items, else the signal at
 *  `from`, else the signal at `to`; selection = signal rows between anchor and `to`. Unchanged when no
 *  anchor can be found (both are headers and none is set). */
export function extendTo(sel: Selection, items: readonly ExplorerItem[], from: number, to: number): Selection;
/** Selected IDs that are signal items of `items`, in item order. */
export function selectedInOrder(sel: Selection, items: readonly ExplorerItem[]): string[];
/** Drops IDs that are no signal item of `items` (after a group closes); keeps the anchor only if kept. */
export function pruneSelection(sel: Selection, items: readonly ExplorerItem[]): Selection;
export function preventListPress(e: { button: number; preventDefault(): void }): void; // M1
```

`SignalExplorer`:
- State `selection` (`NO_SELECTION` on mount); `changeQuery` resets it (so Esc clears it too); after a group toggles, `pruneSelection` with the new items.
- Row `onClick` (not on the `+` button: its click calls `stopPropagation`): ignored when the pointer moved ≥ `DRAG_THRESHOLD_PX` since that row's `pointerdown` (the end of a drag); else `selectClick` with `clickMode(e, isMacPlatform(navigator.platform))`, and `setActive(i)` (the card is not opened by it). Group header clicks toggle the group as today with any modifier and do not change the selection.
- Search `onKeyDown`: ArrowDown/ArrowUp with Shift move the active item as without Shift and apply `extendTo(selection, items, old, new)`; without Shift the selection is unchanged. Enter on a signal row: `addSet(row)`; on a header unchanged.
- `addSet(row)`: if `selection.ids.has(row.id)` and `selectedInOrder(...).length ≥ 2` → `onAddMany(ids, target)`; else `onAdd(row, target)`. The `+` button and Enter both use it. The selection stays after an add.
- Drag start on a row's name: `onDragStart({ signalId, signalIds }, e)` with `signalIds` = `selectedInOrder` when the row is selected and that list has ≥ 2 entries, else without `signalIds`.
- Props: new `onAddMany: (signalIds: string[], target: string) => void`; `onAdd`, `onDragStart` keep their types (the source type gains the optional field, M4).
- ARIA: the listbox gets `aria-multiselectable="true"`; a row's `aria-selected` is "in the selection" (was: active); headers `aria-selected="false"`; the active item stays `aria-activedescendant` and class `active`. A selected row gets class `selected`.

### M6: Selected look (`styles.css`, explorer rules)

`.explorer .row.selected { box-shadow: inset 3px 0 0 var(--accent); }` and `.explorer .row.selected .name { color: var(--accent-ink); }`. The active row keeps its fill (`--accent-soft`), so active and selected read apart; a row that is both shows fill and bar. Off by a factor of two: a 1.5 px bar is hard to see at 22 px rows, a 6 px one crowds the SNA dot (row padding-left 18 px); 3 px fits.

## Risks / Trade-offs

- `preventDefault` on `mousedown` keeps focus where it was: after clicking a window's rename field and then a row, focus stays in the rename field. Accepted; the field commits on blur as before when the user clicks elsewhere.
- A plan is computed from the workspace at drop time; a concurrent change in another tab can make a later step fail. The run stops with the server's message; nothing is rolled back.
- Many created windows from a large selection are created one per request; at 50 signals of one unit each in a fresh workspace that is up to 13 windows and 63 commands.

## Decision ledger (copy to `docs/decisions.md` on archive)

### D-065: No text selection in the signal explorer list (2026-10-17)

- **Decision:** „Clicking, double-clicking or Shift/Ctrl-clicking in the signal explorer list (rows and group headers) never selects page text. The search field stays a normal text field."
- **Why:** Jan (2026-10-17): „when i select a signal left in signal explorer: many times text ist selected over the browser. thats awkward." Only a drag from the row's name blocked selection.

### D-066: Multi-select drops overflow by units (2026-10-17)

- **Decision:** „Only by unit limit": a multi-select drop or add has no signal-count limit. Signals go into the target window until one would need a 5th unit (`MAX_UNITS` = 4). From there on they continue in a new window, and further new windows as needed, each again up to 4 units. „Fill it up": the target window's current units count, so a window already showing 3 units takes only signals of those units plus one new unit. Single adds and drops behave as today. Selection keys, drag/add of a selection, first-fit placement, the strip and target rules are the lead's defaults (design L1–L6), open to Jan's veto.
- **Why:** Jan (2026-10-17): „I wish i could selct multple entries with shift ctrl or so (win ) to select signals . draw them to one or a new window. after 4 legends signals overflow to new window or so".
