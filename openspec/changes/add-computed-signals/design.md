# Design

## Context

See proposal.md for why. What exists and matters here:

- Signal IDs are `<dataRef>/<name>` (`parseSignalId` splits at the first `/`). `case.go`/`case.step` rebind every window signal, colour key and events-line signal by name to the target data ref (`caseApply.ts` `rebind`); `view.open` checks signals through `ApplyContext.signalExists`, `unitOf`, `hasStates` (`apply.ts`), built on the server by `catalogContext` (`apps/server/src/workspace.ts`).
- `/api/series`, `/api/value`, `/api/extent` (`apps/server/src/routes/series.ts`) take `signal` (full ID), check it against the route's scope and catalog, build a `SeriesRef` (name, SNA ranges, text flag) and call the source; `querySeries` picks raw or buckets via `source.series`, with `bucketWidth(0, span, target)`.
- The source contract (`apps/server/src/datasource.ts`): required `raw`, `before`, `after`, `buckets`, …; optional fast paths filled in by `completeSource` (`fallbacks.ts`); every fallback query goes through the query queue and honours aborts. The conformance suite (`apps/server/test/conformance/`) runs every case `native` and `core only` on ClickHouse and the ADX emulator.
- Gap rule (D-062, design G4 of add-gap-display): logger gaps per data ref, a period per signal (DBC cycle, diag interval or measured for the open workspaces' and the requests' signals); consecutive points further apart than `GAP_PERIODS` (3) periods are split; `signalGaps(info, id)` gives one signal's `SignalGaps`; `evaluateAt` gives cursor values.
- The web keeps signal metadata in `App.tsx` `infos` (by ID); series tiles are cached by signal ID (`chart/cache.ts`); `api.ts` `fetchSeries`, `fetchCursorValue`, `fetchExtent` build the requests. The explorer list comes from `explorerItems` (`explorer/groups.ts`) with the Favourites group first (add-favourites F5).
- View documents (`views.ts`) hold no window or assignment IDs (saved-views "No data, secrets or IDs in a view"); unknown keys are dropped with a warning; windows list full signal IDs; signals the catalog lacks are left out on open and listed in `report.missing`.

## Goals / Non-goals

Goals: define a computed signal in a few clicks from where Jan's starred signals are (D-104), see it like any other signal, and get exact values (no grid that loses extremes, D-102), with the formula compiled into the source query on ClickHouse and a bounded fallback elsewhere. Non-goals: everything under "Out of scope" in proposal.md.

## Decisions

### C1 Formula language

Grammar (whitespace between tokens ignored):

```
formula := sum
sum     := product (("+" | "-") product)*
product := unary (("*" | "/") unary)*
unary   := "-" unary | primary
primary := number | "a" | "b" | "(" sum ")"
         | "abs" "(" sum ")" | ("min" | "max") "(" sum "," sum ")"
number  := digits ["." digits] | "." digits, then optionally ("e" | "E") ["+" | "-"] digits
```

- `−` (U+2212) reads as `-`, so a pasted auto name's operator parses. Names are lower case only; nothing else is a name. No `diff()`: D-102's „diff means a − b" is the Difference preset `a - b`.
- A formula SHALL use `a`. It may use `b`. Limits: at most `MAX_FORMULA_LENGTH` (200) characters and `MAX_FORMULA_NODES` (64) AST nodes; a number must be finite as a JS number.
- `parseFormula` errors carry a 1-based character position `at`; messages (pinned, the editor shows them verbatim):
  - empty: `Enter a formula`
  - unknown name: `Unknown name "c": use a, b, numbers, + - * / ( ), abs, min, max`
  - other bad character or token: `Unexpected "%" at 4` (end of text: `Unexpected end at 6`)
  - `Missing ")" at 8`
  - arity: `abs takes one value: abs(x)`, `min takes two values: min(x, y)`, `max takes two values: max(x, y)`
  - `The formula must use a`
  - `At most 200 characters`, `Too complex: at most 64 parts`, `Number too large at 3`
- Binding (`bindFormula`): a formula that uses `b` with no input for `b`: `Pick a signal for b`; no input for `a`: `Pick a signal for a`. An input for `b` that the formula does not use is dropped from the definition (the editor keeps it in its field, C12).
- Evaluation (`evalFormula`) in IEEE double: `abs` = `Math.abs`, `min`/`max` = `Math.min`/`Math.max`. A non-finite result (division by zero, overflow) is SNA-like `null` (Q-4).

### C2 Per-row semantics

`computeRows(formula, a, b?)`, pure, shared by the fallback, the value route and the tests; ClickHouse SHALL give the same rows (conformance, C8):

- Rows exist only at the distinct times of the inputs' points inside the range, ascending. At each time `T`, each used input's **current** point is its point at `T` (the last one when it has several), else its last point before `T`, else its seed (its last point before the range).
- A row exists iff every used input has a current point and, for each input with a hold limit, `T − current.t ≤ holdNs`. No row otherwise (that is what makes a gap of either input visible, D-102 „gaps of both", Q-5).
- Its value is `null` (SNA) when any current point is SNA (D-102 „SNA in either gives SNA"; D-010) or the result is not finite; else `evalFormula`.
- One input (stage 1): one row per point of `a`, value per row.
- Hold limit per input: `GAP_PERIODS × period` of that input (`GapInfo.periods`, the source of `signalGaps`); none when its period is unknown (then it holds as D-102 says). Origin: D-102 („holding the last value … gaps of both") with D-062.

### C3 Gaps of a computed signal

`computedSignalGaps(info, dataRef, def)`: `logger` = the data ref's logger gaps; `period` = the smallest known period of the used inputs `<dataRef>/<input>`; none when no input has one. Consecutive computed rows lie at most the faster input's period apart, so the slowest input never causes a false split; a hole left by C2's hold limit longer than three of these periods splits the line.

### C4 Value at a time

`computedValueAt(t, mode, formula, inputs, gaps)` for `/api/value`, from each used input's raw neighbours `at` (last point ≤ t) and `next` (first point > t), as the server gets them from `before(t + 1)` and `after(t + 1)`:

1. An input without `at`: `none` (`before_first` if it has a `next`, else `no_data`). An input whose `t − at.t` exceeds its hold limit: `none` with reason `period_gap`.
2. Computed `at`: time `max(at_x.t)`, value per C2 from the inputs' `at` points.
3. Computed `next`: time `m = min(next_x.t)`; each input contributes its `next` if that lies at `m`, else its `at`; absent when no input has a `next`.
4. `evaluateAt(t, mode, at, next, undefined, computedSignalGaps(…))`.

In step mode the value equals the formula of the inputs' step values at `t`, which the UI check M2 uses.

### C5 Extent

`/api/extent` of a computed signal: `first` = the latest `first` of the used inputs, `last` = the latest `last`; 404 `no_data` when an input has no data.

### C6 Definitions, IDs and edits

```yaml
computed:            # Workspace.computed, absent when empty, creation order
  - id: c7           # `c<nextId>`, never shown in the UI
    name: DNMOT − PNHV_SupBat_Curr
    formula: a - b
    a: MS_312h.DNMOT                 # signal name, no data ref (like favourites, D-102)
    b: CPC_508h.PNHV_SupBat_Curr     # absent when the formula does not use b
    unit: A                          # absent: none
```

- Signal ID of a computed signal: `<dataRef>/=<id>` (`smart451/=c7`). Its inputs resolve as `<dataRef>/<a>` and `<dataRef>/<b>`, so `case.step`'s rebind by name moves it to the next session with no extra code, and its inputs follow (lead pick 4). A source name starting with `=` would be shadowed; no source in use has one (accepted).
- **An edit makes a new definition.** `computed.update` replaces the definition in place with a new ID `c<nextId>` and moves every use: window assignments keep their assignment IDs, the colour index moves to the new ID. So the web's tile cache (keyed by signal ID) never serves a curve of the old formula, and an in-flight answer for the old ID lands under the old ID only. The UI never shows IDs; the CLI addresses by name or ID and prints the new ID.
- `name`: 1–`MAX_COMPUTED_NAME` (60) characters, trimmed, no control characters, unique in the workspace ignoring case. `unit`: at most `MAX_COMPUTED_UNIT` (20) characters, trimmed, no control characters; empty is absent. At most `MAX_COMPUTED` (20) definitions.
- Inputs: `ComputedInput` names like `FavouriteName` (1–200 characters, no control characters, no outer whitespace). Numeric only: an input whose catalog entry has `states` is refused (`not_numeric_signal`, lead pick 4).

### C7 Commands

| Command | Body | Result | Refusals (in this order) |
|---|---|---|---|
| `computed.add` | `{name, formula, a, b?, unit?}` | `created: "c<n>"` | `scope_required`, `invalid_formula`, `duplicate_name`, `computed_limit`, `unknown_signal`, `not_numeric_signal` |
| `computed.update` | `{id, name, formula, a, b?, unit?}` (the whole definition) | `created: "c<n>"` (the new ID) | `unknown_computed`, `invalid_formula`, `duplicate_name` (others than itself), `unknown_signal`, `not_numeric_signal` (only for an input that changed), `too_many_units` (a window showing it would exceed `MAX_UNITS` with the new unit) |
| `computed.remove` | `{id}` | — | `unknown_computed` |

- `invalid_formula` messages are C1's. `b` given while the formula does not use `b` is dropped, not refused.
- Input check: with a scope, `<scope.dataRef>/<input>` through `ctx.signalExists`/`ctx.hasStates`; without a scope, `ctx.inputInfo(name)` (server: the first entry with that name in the list in use); neither present (tests, catalog not loaded): unchecked. An unknown input is refused (Q-7), message `not in this list: CPC_508h.PNHV_SupBat_Curr`.
- `computed.remove` removes the definition, every window assignment of `<any>/=<id>` and their colours (lead pick 3).
- `withComputed(ctx, computed)` wraps the apply context for every command (for `view.open`: the document's definitions after C10): a computed ID exists iff its definition exists and every used input exists on its data ref; its unit is the definition's; `hasStates` is false (so `events.addSignal` refuses it with `not_state_signal`). Every signal check in `apply.ts` and `caseApply.ts` goes through the wrapped context, so `window.addSignal`, the unit rule, `case.go/step`'s `missing` and `view.open`'s report treat computed signals like any signal. `window.addSignal` of a computed ID with a missing input: `unknown_signal`, message `computed signal smart451/=c7: not in this list: CPC_508h.PNHV_SupBat_Curr`.
- A computed signal counts towards `MAX_SIGNALS`; its inputs do not.

### C8 Server: computed series, values, extents

`/api/series`, `/api/value`, `/api/extent` accept, besides `signal`, the query parameters `formula` (≤ 200 characters), `a`, `b` (signal names). Rules:

- `signal` whose name starts with `=` needs `formula` and `a` (else 400 `invalid_request`, `a computed signal needs formula and a`); a plain signal with `formula`, `a` or `b` is 400 `invalid_request`. The `=<id>` part is only echoed back as `signalId`.
- The server parses `formula` itself (C1) and binds it to `a`/`b` (400 `invalid_formula`, the message); it never splices request text into a query. Scope and data-ref checks apply to `signal`'s data ref as today (`out_of_scope`); each used input `<dataRef>/<name>` must be in the route's catalog (404 `unknown_signal`, `signalId` the input's ID, message `not in this list: <id>`) and numeric (422 `not_numeric_signal`, `signalId` the input's ID).
- Series: seeds `before(input, from, scope)`, hold limits from the gap info of the inputs (`gaps.get(dataRef, inputs, …)`, cached), then `source.computedSeries(ref, from, to, target, width)` with `width = bucketWidth(0, span, target)` as `querySeries`. Raw answers get edges: `before` = the computed point at the latest seed time (from the seeds, absent if a seed is missing or stale); `after` = the computed point at `m`, the earliest `after(input, to, scope)` time, each input's value at `m` from `before(input, m + 1, scope)`. The answer is a plain `RawSeries` or `BucketSeries` (shared `series.ts`), so the web draws it with today's code.
- Raw or buckets: the adapter answers raw when the range holds at most `target` input rows (ClickHouse: one `count()` over `signal IN (a, b)`), else buckets on the floor grid `k × width` from the exact per-row values: `count` valid rows, `sna` SNA rows, `mean`/`min`/`max` over valid rows (D-102: a grid of last values lost −946 for −157).
- Value: C4 with `before`/`after` of the inputs and the gap info of the inputs; `at`/`next` in the answer are the computed points.
- The optional adapter method (pinned below) has a fallback in `completeSource`: `raw(input, from, to, COMPUTED_MAX_ROWS + 1)` per input, then `computeRows`, then raw or buckets as above. More than `COMPUTED_MAX_ROWS` (200,000) rows of one input: `ComputedTooLargeError` → 422 `computed_too_large`, message `more than 200,000 rows of MS_312h.DNMOT in this range: zoom in` (lead pick 6).

### C9 ClickHouse compile (and the ADX could)

`ClickHouseSource.computedSeries` compiles the parsed AST, never text: an input is a column alias of the inner query, a constant a query parameter `{k0:Float64}`, `{k1:Float64}`, …; `+ - * /` as `(x op y)`, unary minus `(-x)`, `abs(x)`, `least(x, y)`, `greatest(x, y)`; signal names, data ref, SNA ranges (one set per input), seeds and hold limits as parameters as today. One scan, as measured in D-102:

```sql
-- sketch; one inner scan of both inputs, the window as in D-102
SELECT x, if(s OR NOT isFinite(v0), NULL, v0) AS v FROM (
  SELECT x, <formula over av, bv> AS v0, as_ OR bs_ AS s, at, bt FROM (
    SELECT toUnixTimestamp64Nano(utc) AS x,
      ifNull(last_value(if(signal = {a:String}, value, NULL)) IGNORE NULLS OVER w, {seedAv:Nullable(Float64)}) AS av,
      ifNull(last_value(if(signal = {a:String}, toUInt8(<sna of a>), NULL)) IGNORE NULLS OVER w, {seedAs:Nullable(UInt8)}) AS as_,
      ifNull(last_value(if(signal = {a:String}, x, NULL)) IGNORE NULLS OVER w, {seedAt:Nullable(Int64)}) AS at,
      … the same three for b …
    FROM <table> WHERE <ref> = {ref:String} AND <signal> IN ({a:String}, {b:String})
      AND <time> >= … AND <time> < … AND <time> IS NOT NULL
    WINDOW w AS (ORDER BY utc RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW))
  WHERE at IS NOT NULL AND bt IS NOT NULL AND x - at <= {holdA:Int64} AND x - bt <= {holdB:Int64}
  LIMIT 1 BY x)
-- buckets: GROUP BY the floor bucket of x with countIf(v IS NOT NULL), countIf(v IS NULL), avg/min/max of v
```

`RANGE` makes rows at the same time see each other, `LIMIT 1 BY x` keeps one row per time (C2). An absent hold limit is a parameter large enough never to bite. Stage 1 needs no window: the formula over `value` per row.

ADX (could, task 2.5): the same with `serialize` and `scan` (fill forward), only if the conformance suite passes on the emulator; otherwise ADX keeps the fallback, which the suite also runs (`core only`).

### C10 Views

- The view document gains `computed: [{name, formula, a, b?, unit?}]` (no IDs: saved-views "No … IDs in a view"); a window lists a computed signal as `<dataRef>/=<name>`. `workspaceToView` maps `=c7` to `=<name>`.
- Reading: an entry that fails C6/C1 is left out with the warning `computed signal "<name>" left out: <reason>`; on `view.open` each definition gets a fresh ID from `nextId`, window references map by name, and a window reference without a definition is missing (`report.missing`).
- `version` stays 1 (my call): older code drops the unknown key `computed` with a warning and lists the `=<name>` signals as missing, which is honest and needs no migration; a bump to 2 would make every older build refuse the whole view (`unsupported_version`) for one optional part.

### C11 Signal infos in the web

`computedInfos(defs, items)` gives the explorer and `App.tsx` `infos` one `SignalInfo` per definition and data ref of the list in use that holds all used inputs: `id` `<dataRef>/=<id>`, `name` `=<id>`, `displayName` the definition's name, `unit`, `description` the formula with full input names (`MS_312h.DNMOT − CPC_508h.PNHV_SupBat_Curr`, so a search for `DNMOT` also finds it), `computed: {formula, a, b?}`. A definition with no such data ref gives one info on the list's first data ref (catalog order; the scope's data ref when scoped) with `computed.unavailable` = `not in this list: <missing inputs, comma-separated>`; none for an empty list. The web never asks `/api/signals` for a computed ID. On every live state, `App.tsx` replaces the computed infos (an edit changes the ID; a rename changes `displayName`) and calls `setComputedDefs`.

Requests: `api.ts` adds `formula`, `a`, `b` for a computed ID from the registry (by the `=<id>` part, so preload requests of another session's data ref work); an ID without a definition rejects with `ApiRequestError(0, "unknown_computed", …)` and sends nothing. Gap info: `chart/gaps.ts` asks `/api/gaps` for the used inputs' IDs instead of the computed ID and draws with `computedSignalGaps`. An unavailable computed signal in a window sends no request and its legend row reads `missing` with the reason as tooltip (as a missing signal after a step, D-096).

### C12 Explorer section and editor

Section (after the Favourites group and its copies, before the groups or the flat list; `explorerItems(…, computed)`):

- Header `ƒ Computed`, count = its rows, open unless toggled, on an empty query too (Q-2, like Favourites D-103 Q-3); a `+` button at its right end (18 × 22 px, slate-400, accent under the pointer; `aria-label` "New computed signal", `title` `HINTS.computedNew`; stops propagation, does not toggle).
- Empty query: header always; no definition → one hint item (22 px, 11 px muted, `HINTS.computedEmpty` "No computed signals yet: click + to build one"); a click on it opens the editor. While searching: only definitions whose info matches the query (shared search over the computed infos), header only when one matches; no hint.
- Rows: `ƒ` (muted, `aria-hidden`) in the 18 px left indent where other rows have the star (computed rows have no star); name and unit as any row; a pencil `button.edit` (18 × 22 px, `✎`, slate-400, accent under the pointer, shown on hover and on the active row with `visibility`, keeping its box; `title` `HINTS.computedEdit`) before the `+`; `F2` on an active computed row opens the editor too. A click selects as on any row, double-click and Enter add, drag drags (Q-3). Unavailable rows: name in `--disabled`, `title` the reason, no `+`, not addable or draggable; the pencil works.
- Hover card of a computed row: name, the formula with full input names, unit, nothing else.

Editor (`computed/ComputedEditor.tsx`), a non-modal `role="dialog"` panel, 360 px wide, white, 1 px `--border`, 6 px radius, the panel shadow of the design tokens, left edge 8 px right of the sidebar, top at the Computed header, clamped into the viewport; it does not move while typing (layout never moves):

```
 New computed signal                       (Edit computed signal)
 INPUTS
  a  [ DNMOT                       ▾ ]      signal pickers (26 px)
  b  [ PNHV_SupBat_Curr          × ▾ ]      disabled, value kept, when the formula has no b
 FORMULA
  [ Difference   a − b         ▾ ] [ a - b              ]   preset select + formula field (mono)
  <one-line error, 11 px --error, height reserved>
 NAME                          UNIT
  [ DNMOT − PNHV_SupBat_Curr ]  [ A    ]
 [Delete]                         [Cancel] [Save]            Save is the panel's one primary
```

- Pickers search the list in use (no computed signals) with the shared search, at most 8 rows (shown name mono, unit); arrows and Enter pick; a signal with `states` is listed in `--disabled`, `title` `HINTS.computedNumericOnly` ("MODE has states: pick a numeric signal"), not pickable.
- Presets (`PRESETS`): Difference `a - b`, Sum `a + b`, Absolute `abs(a)`, Minimum `min(a, b)`, Maximum `max(a, b)`, Scale `a * 1`, Custom. Picking one writes its formula; typing in the formula field shows the preset whose formula equals the text (spaces ignored), else Custom.
- Live validation on every change: `parseFormula` + `bindFormula`; name and unit rules of C6 (`Name already used`, `At most 60 characters`); the first error is shown, Save disabled while one exists.
- Auto name: `formulaName(ast, short(a), short(b))`, short = the input's shown name after its first `.` (`MS_312h.DNMOT` → `DNMOT`); operators ` + `, ` − `, ` × `, ` / `, functions `abs(x)`, `min(x, y)`; parentheses only where needed; cut to 60 with `…`; a taken name gets ` 2`, ` 3`, …. Auto unit: `inferUnit` (lead pick 1: same unit for `+ − min max`, `abs` and unary minus keep it, a constant adopts the other side, `* /` give none). Name and unit follow the inputs and formula until the user types in that field; when editing, a field follows only if its stored value equals the auto value of the stored definition.
- Prefill from the `+` (lead pick 2): the explorer selection in list order holding exactly one or two catalog signals without states → `a` (and `b`), preset Absolute for one, Difference for two; otherwise empty with Difference. Focus: the formula field when `a` is filled, else picker `a`. So "select two rows, `+`, Enter" creates `a − b`.
- Keys: Enter in any field saves when valid; Esc closes an open picker list, else cancels; Tab order as drawn. Clicks outside do not close it.
- Save: `computed.add` / `computed.update`. After a new one: the editor closes, the new row becomes the active row and, when an "Add to" target window exists, it is added there like the row's `+` (Q-8); a refusal of that add flashes as today and keeps the definition. A refused command keeps the editor open with the server's message in the error line.
- Delete (edit only, a text button in `--error`): the first click turns it into "Click again to delete" for 3 s; the second sends `computed.remove`.

### C13 CLI

- `calc list` → `data {computed: [{id, name, formula, a, b?, unit?}]}` from `GET` state.
- `calc add FORMULA --a SIGNAL [--b SIGNAL] [--name NAME] [--unit UNIT]`: SIGNAL as "Signal references" (full ID → its name part; bare name → its one match's name; several names `ambiguous_signal`; none `unknown_signal`, nothing sent). `--name` default `formulaName` with the catalog's shown names; `--unit` default `inferUnit` with the catalog's units. Sends `computed.add`; output as every command plus `created`.
- `calc edit ID|NAME [--formula F] [--a SIGNAL] [--b SIGNAL | --no-b] [--name NAME] [--unit UNIT]`: the stored definition with the given parts replaced (name and unit not re-derived); `computed.update`; `created` the new ID. ID|NAME: an ID, else a name ignoring case; none `unknown_computed`, nothing sent.
- `calc rm ID|NAME`: `computed.remove`.
- `value SIGNAL TIME` and `extent SIGNAL` with a computed ID (`smart451/=c7`) attach the definition's parameters from the state; `add W SIGNAL` sends the ID unchanged.
- No FORMULA, no `--a`, no ID|NAME: usage error (exit 2); refusals exit 1.

## Pinned interfaces

### `packages/shared/src/formula.ts` (exported from `index.ts`)

```ts
export const MAX_FORMULA_LENGTH = 200;
export const MAX_FORMULA_NODES = 64;
export type FormulaVar = "a" | "b";
export type FormulaNode =
  | { op: "num"; value: number }
  | { op: "var"; name: FormulaVar }
  | { op: "neg" | "abs"; arg: FormulaNode }
  | { op: "+" | "-" | "*" | "/" | "min" | "max"; left: FormulaNode; right: FormulaNode };
export type ParsedFormula =
  | { ok: true; ast: FormulaNode; vars: ReadonlySet<FormulaVar> }
  | { ok: false; message: string; at?: number }; // C1 messages; at: 1-based
export function parseFormula(text: string): ParsedFormula;
/** C1 binding: errors "Pick a signal for a|b"; drops b when unused. */
export function bindFormula(
  parsed: ParsedFormula, inputs: { a?: string; b?: string },
): { ok: true; ast: FormulaNode; a: string; b?: string } | { ok: false; message: string };
/** IEEE double; may be non-finite (callers map that to null, C2). b ignored when unused. */
export function evalFormula(ast: FormulaNode, a: number, b?: number): number;
/** C12 auto name; `aName`/`bName` already shortened; cut to MAX_COMPUTED_NAME with "…". */
export function formulaName(ast: FormulaNode, aName: string, bName?: string): string;
/** C12 auto unit; undefined = none. */
export function inferUnit(ast: FormulaNode, aUnit?: string, bUnit?: string): string | undefined;
/** Shown name after its first "." ("MS_312h.DNMOT" → "DNMOT"); whole when none or empty after. */
export function shortSignalName(shown: string): string;
export type PresetId = "difference" | "sum" | "absolute" | "minimum" | "maximum" | "scale" | "custom";
export const PRESETS: readonly { id: PresetId; label: string; formula?: string; inputs: 1 | 2 }[];
// difference "a - b" 2, sum "a + b" 2, absolute "abs(a)" 1, minimum "min(a, b)" 2,
// maximum "max(a, b)" 2, scale "a * 1" 1, custom (no formula) 2
/** The preset whose formula equals `text` ignoring whitespace, else "custom". */
export function presetOf(text: string): PresetId;
```

### `packages/shared/src/computed.ts` (exported from `index.ts`)

```ts
export const MAX_COMPUTED = 20;
export const MAX_COMPUTED_NAME = 60;
export const MAX_COMPUTED_UNIT = 20;
/** Fallback bound per input (C8). */
export const COMPUTED_MAX_ROWS = 200_000;
export interface ComputedDef { id: string; name: string; formula: string; a: string; b?: string; unit?: string }
/** What a series/value/extent request carries (C8); also the view entry without name/unit. */
export interface ComputedParams { formula: string; a: string; b?: string }
export const ComputedName: z.ZodType<string>;   // C6
export const ComputedUnit: z.ZodType<string>;   // C6, "" allowed (clears)
export const ComputedInput: z.ZodType<string>;  // C6, as FavouriteName
export const isComputedId: (signalId: string) => boolean;          // name part starts with "="
/** "smart451/=c7" → {dataRef: "smart451", id: "c7"}; undefined for a plain or malformed ID. */
export function computedRef(signalId: string): { dataRef: string; id: string } | undefined;
export const computedSignalId = (dataRef: string, id: string): string => `${dataRef}/=${id}`;
/** The used inputs' full IDs on a data ref (a, then b). */
export function computedInputIds(def: Pick<ComputedDef, "a" | "b">, dataRef: string): string[];
export function computedParams(def: ComputedDef): ComputedParams;
/** C7: computed IDs exist iff the definition exists and its inputs exist on the ID's data ref. */
export function withComputed(ctx: ApplyContext, computed: readonly ComputedDef[] | undefined): ApplyContext;
/** C11. */
export function computedInfos(defs: readonly ComputedDef[], items: readonly SignalInfo[], scopeDataRef?: string): SignalInfo[];
export interface ComputedSeriesInput {
  points: readonly Point[];          // ascending, inside the range; v null = SNA
  seed?: Point;                      // last point before the range
  holdNs?: bigint;                   // C2; undefined = no limit
}
/** C2. Rows ascending, one per distinct time, v null = SNA or not finite. */
export function computeRows(ast: FormulaNode, a: ComputedSeriesInput, b?: ComputedSeriesInput): Point[];
/** C2: GAP_PERIODS × period, undefined without a period. */
export function holdLimit(period: bigint | undefined): bigint | undefined;
/** C3. */
export function computedSignalGaps(info: GapInfo | undefined, dataRef: string, def: Pick<ComputedDef, "a" | "b">): SignalGaps;
export interface ComputedNeighbours { at?: Point; next?: Point; holdNs?: bigint }
/** C4; the result's at/next are the computed points. */
export function computedValueAt(
  t: bigint, mode: ValuesMode, ast: FormulaNode,
  a: ComputedNeighbours, b: ComputedNeighbours | undefined, gaps: SignalGaps,
): { value: CursorValue; at?: Point; next?: Point };
```

`packages/shared/src/signals.ts`: `SignalInfo.computed?: { formula: string; a: string; b?: string; unavailable?: string }`.

`packages/shared/src/workspace.ts`:

- `Workspace.computed?: ComputedDef[]`; `WorkspaceSchema` gains it (strict entries, `exactOptional`).
- `Command` gains `computed.add {name: ComputedName, formula: string max 200, a: ComputedInput, b?: ComputedInput, unit?: ComputedUnit}`, `computed.update {id, …same}`, `computed.remove {id}`.
- `CommandErrorCode` gains `invalid_formula`, `not_numeric_signal`, `duplicate_name`, `computed_limit`, `unknown_computed`.
- `ApplyContext` (`apply.ts`) gains `inputInfo?(name: string): { states: boolean } | undefined`.

`packages/shared/src/views.ts`: `ViewDoc.computed?: { name: string; formula: string; a: string; b?: string; unit?: string }[]`; `workspaceToView`, `parseViewDoc` and `openView` per C10.

### HTTP (`docs/http-api.md`)

| Route | New query parameters | New errors |
|---|---|---|
| `GET /api/series` | `formula`, `a`, `b` (computed `signal` only) | 400 `invalid_formula`; 404 `unknown_signal` (input); 422 `not_numeric_signal`; 422 `computed_too_large` (fallback) |
| `GET /api/value` | same | same, without `computed_too_large` |
| `GET /api/extent` | same | same, without `computed_too_large` |

Answers unchanged in shape (`RawSeries`, `BucketSeries`, `CursorValueResult`, `Extent`), `signalId` the computed ID. Example: `/api/series?signal=smart451%2F%3Dc7&formula=a%20-%20b&a=MS_312h.DNMOT&b=CPC_508h.PNHV_SupBat_Curr&from=…&to=…&target=2000`.

### Server

```ts
// apps/server/src/datasource.ts
export interface ComputedInputRef extends SeriesRef { seed?: RawPoint; holdNs?: bigint }
export interface ComputedRef { dataRef: string; ast: FormulaNode; a: ComputedInputRef; b?: ComputedInputRef }
export type ComputedAnswer = { kind: "raw"; points: RawPoint[] } | { kind: "buckets"; buckets: Bucket[] };
// SourceAdapter, optional (fallback in completeSource, C8):
computedSeries?(ref: ComputedRef, from: Timestamp, to: Timestamp, target: number, width: bigint, abort?: AbortSignal): Promise<ComputedAnswer>;
// apps/server/src/fallbacks.ts
export class ComputedTooLargeError extends Error { constructor(signal: string) } // message per C8
// apps/server/src/computed.ts: seeds, the adapter call and raw edges (C8), over any DataSource, so the
// conformance suite runs it native and core only; `ref` without seeds (hold limits set by the caller).
export function queryComputed(
  source: DataSource, ref: ComputedRef, signalId: string, from: Timestamp, to: Timestamp,
  target: number, scope?: Scope, abort?: AbortSignal, span?: bigint,
): Promise<SeriesResult>;
/** C8 request checks: parse and bind the formula, resolve the inputs in the catalog, numeric only. */
export function resolveComputed(
  params: ComputedParams, dataRef: string, catalog: Pick<Catalog, "get" | "snaRanges">,
): { ok: true; ast: FormulaNode; a: SeriesRef; b?: SeriesRef }
 | { ok: false; status: 400 | 404 | 422; code: "invalid_formula" | "unknown_signal" | "not_numeric_signal"; message: string; signalId?: string };
// apps/server/src/workspace.ts catalogContext: inputInfo(name) from the list in use
// apps/server/src/gaps.ts workspaceSignals: a computed ID contributes its used inputs' IDs, not itself
```

### Web (internal, pinned so the tester can write tests first)

```ts
// explorer/groups.ts
export const COMPUTED_GROUP = "ƒ Computed";
export type ExplorerItem =
  | { kind: "group"; name: string; count: number; open: boolean; favourites?: true; computed?: true }
  | { kind: "signal"; match: SignalMatch; inFavourites?: true }  // a computed row: match.signal.computed set
  | { kind: "hint"; text: string };
export function explorerItems(
  matches, searching, grouped, toggled, favourites?: readonly string[],
  computed?: { matches: readonly SignalMatch[] },   // absent: no section (as before)
): ExplorerItem[];
// computed/editor.ts (pure editor state)
export interface EditorState { a?: string; b?: string; formula: string; name: string; unit: string; nameAuto: boolean; unitAuto: boolean }
export function prefill(selected: readonly SignalInfo[]): EditorState;          // C12 prefill
export function fromDef(def: ComputedDef, infoOf: (name: string) => SignalInfo | undefined): EditorState;
export function editorError(s: EditorState, others: readonly ComputedDef[], infoOf: (name: string) => SignalInfo | undefined): string | undefined;
export function withAuto(s: EditorState, others: readonly ComputedDef[], infoOf: (name: string) => SignalInfo | undefined): EditorState; // auto name/unit
// api.ts
export function setComputedDefs(defs: readonly ComputedDef[]): void;
// keys.ts
export function isEditKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): boolean; // F2, no modifier
// help/hints.ts: HINTS.computedNew, HINTS.computedEmpty, HINTS.computedEdit, HINTS.computedNumericOnly(name)
// help/shortcuts.ts: { group: "Signal list", keys: "F2", action: "Edit the active computed signal" }
```

### CLI output

`calc list` → `{outcome: "ok", workspace, data: {computed: ComputedDef[]}}`; `calc add|edit|rm` → the command output (`outcome`, `workspace`, `revision`, `created` for add/edit); refusals as every CLI refusal (`error.code`, `error.candidates` where named).

## Numbers

| Number | Value | Off by ×2 |
|---|---|---|
| `MAX_FORMULA_LENGTH` | 200 characters | 100 still holds `max(abs(a - b), abs(b - a)) * 0.5` (36); 400 changes nothing. A guard, not a feature. |
| `MAX_FORMULA_NODES` | 64 | 32 still holds every preset and ten-term sums; 128 harmless (SQL grows linearly). |
| `MAX_COMPUTED` | 20 per workspace | 10 is above the few a session needs (D-104 basics); 40 makes the section long but works. |
| `MAX_COMPUTED_NAME` | 60 | Auto names of two 20-character short names are about 45; 30 would cut most auto names, 120 overflows the 208 px sidebar anyway (cut with `…`). |
| `COMPUTED_MAX_ROWS` | 200,000 per input (fallback only) | 100,000: "zoom in" from about 16 min of a 100 Hz signal; 400,000: about 30 MB more heap per request and several seconds of ADX transfer. ClickHouse never hits it. |
| Hold limit | `GAP_PERIODS` (3) × the input's period | Same factor as the drawing's gap rule (G4). 6: stale values held twice as long; 1.5: timing jitter drops rows of a regular signal. |
| ClickHouse goal (not pass/fail) | busiest hour of DNMOT − PNHV_SupBat_Curr into 2,000 buckets ≤ 0.5 s; whole 11-day recording ≤ 3 s | Measured 0.12 s and 0.95 s (D-102); twice the goal still feels like one window load. |
| Editor | 360 px wide, pickers 26 px, 8 rows | 180 px cannot show a 30-character name; 720 px covers the windows. |

## Risks

- [Hold limit hides a slow signal whose period is wrong] → the period comes from the DBC or a measurement; an unknown period means no limit (D-102's plain hold).
- [Rows at equal times of both inputs] → `RANGE` frame and one row per time (C2, C9); conformance case "computes at shared times" compares with `computeRows`.
- [A view opened by older code] → the computed key is ignored with a warning and its signals are reported missing (C10).
- [An edit moves IDs under an open values window or a running request] → the old ID's answers land on tiles nobody reads; the new ID loads fresh (C6).
- [Source names beginning with `=`] → shadowed by computed IDs; none exist in carserver or the test sources.

## Manual checks (UI user, smart451 on carserver, 1440×900, a session where `MS_312h.DNMOT` and `CPC_508h.PNHV_SupBat_Curr` have data)

- **M1 Create from a selection:** empty search → `ƒ Computed` header with the hint row; search `DNMOT`, click `DNMOT`, Ctrl/Cmd-click `PNHV_SupBat_Curr` (search `PNHV` between), click `+` in the Computed header; the editor shows a `DNMOT`, b `PNHV_SupBat_Curr`, preset Difference, formula `a - b`, name `DNMOT − PNHV_SupBat_Curr`, unit = both units if equal else empty; press Enter. The row appears under `ƒ Computed`, is active, and the target window shows a legend row `DNMOT − PNHV_SupBat_Curr` with a curve.
- **M2 Values agree:** add both inputs to a values window in step mode with the computed signal; put cursor A on three times; each time computed = DNMOT − PNHV_SupBat_Curr to the shown digits.
- **M3 Edit:** pencil on the row → preset Absolute → formula `abs(a)`, b disabled, name `abs(DNMOT)`, unit DNMOT's; Save → the legend row reads `abs(DNMOT)` and the curve is ≥ 0 everywhere.
- **M4 Live error, stable layout:** in the editor type `a - ` then `a - c`; the error line reads `Unexpected end at 5`, then `Unknown name "c": …`; Save disabled; the formula field's and the error line's `getBoundingClientRect()` unchanged (±0.5 px) between valid and invalid.
- **M5 Step:** press `]`; the computed signal is drawn on the next session (inputs rebound by name), its legend name unchanged.
- **M6 Delete:** pencil → Delete → "Click again to delete" → click; the row and the legend row are gone; the hint row is back.
- **M7 Speed (goal):** the lead's `curl -s -o /dev/null -w '%{time_total}'` of `/api/series` for M1's formula over the busiest hour with `target=2000`, and over the whole recording; reported, not pass/fail.

## Open questions for Jan

Jan is away (D-104); each is decided by the pick marked ✔ and can be vetoed.

- **Q-1 Where definitions live.** (a) ✔ workspace and view only (D-102, lead pick 5): a computed signal travels with the analysis, a shared workspace shows it to every viewer, a view carries it. (b) also per user like stars, so they show in every workspace. (b) would make a second store and the "which one wins" question; it can come later with `add-signal-books`.
- **Q-2 Section open on the empty search.** (a) ✔ open, like Favourites (D-103 Q-3): few rows, and the `+` and hint must be visible to be found. (b) collapsed like the D-053 groups.
- **Q-3 How to open the editor on an existing row.** (a) ✔ pencil on hover and on the active row, plus `F2`; a click selects as on every row. (b) click on the row opens it (lead's first idea). Changed from (b) because a click is also the first half of the double-click that adds a signal and the start of a drag, so (b) would open the editor on every add.
- **Q-4 Division by zero and other non-finite results.** (a) ✔ shown as SNA (no number, amber marks, counted as `sna` in buckets), as D-010 treats a value that is not a reading. (b) the row is dropped, leaving a gap.
- **Q-5 How long an input's last value is held.** (a) ✔ up to 3 periods of that input (the gap rule's factor); beyond, the computed signal has no value, so a gap of either input shows (D-102 „gaps of both"). (b) without limit, D-102's plain „holding the last value": a dead input would keep feeding a stale value into the result.
- **Q-6 Unit of `a * k` (Scale) and other products.** (a) ✔ empty, editable (lead pick 1: inherited only when unambiguous). (b) keep a's unit for a constant factor (wrong after a unit conversion like `a * 0.001`).
- **Q-7 An input not in the current list.** (a) ✔ `computed.add` (UI and CLI) refuses it (`unknown_signal`): the editor only offers listed signals, and a typo in the CLI is caught. (b) stored with a warning, like `fav add` (D-103 Q-5), so a formula for another vehicle can be prepared.
- **Q-8 After Save of a new computed signal.** (a) ✔ it is also added to the "Add to" target window, so "select two, `+`, Enter" shows the result at once (D-104 „leicht zu bedienen"). (b) only listed and made the active row; Enter adds it.
