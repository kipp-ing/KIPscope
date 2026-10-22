# computed-signals Specification

## Purpose

Signals computed from one or two other signals by a small formula of KIPscope's own (D-102), defined in a few clicks from the explorer and then used like any other signal (D-104).

## ADDED Requirements

### Requirement: Formula language
A formula SHALL use input `a` and may use `b`, numbers, `+ - * /`, parentheses, `abs(x)`, `min(x, y)`, `max(x, y)` (design C1), at most 200 characters and 64 parts; nothing else parses. Errors SHALL name what is wrong and its 1-based position. Origin: D-102 („+ - * /, constants, abs, min(a,b), max(a,b) … never user-written KQL or SQL"); limits: design Numbers.

#### Scenario: Accepted and refused formulas
- **WHEN** `parseFormula` reads `a - b`, ` abs(a) `, `min(a, b) * 0.5`, `-a / (b + 1e3)`, `a − b` (U+2212), `max(a,2)`, then `a - `, `a - c`, `abs(a, b)`, `min(a)`, `(a + b`, `b * 2`, `a % b`, `1e999 + a`, `""` and a 201-character formula
- **THEN** the first six are ok (`vars` {a, b}, {a}, {a, b}, {a, b}, {a, b}, {a}); the others fail with `Unexpected end at 5`, `Unknown name "c": use a, b, numbers, + - * / ( ), abs, min, max`, `abs takes one value: abs(x)`, `min takes two values: min(x, y)`, `Missing ")" at 7`, `The formula must use a`, `Unexpected "%" at 3`, `Number too large at 1`, `Enter a formula`, `At most 200 characters`
- **Evidence:** `packages/shared/test/formula.test.ts` › "parses the formula language", "reports errors with positions"

#### Scenario: Evaluation
- **WHEN** `evalFormula` evaluates `abs(a - b)` at (3, 5), `min(a, b) * 2` at (3, 5), `max(a, -b)` at (3, 5), `-a * 2 - 1` at 3 and `a / b` at (1, 0)
- **THEN** it gives 2, 6, 3, −7 and a non-finite number
- **Evidence:** `packages/shared/test/formula.test.ts` › "evaluates formulas in double precision"

### Requirement: Formula text never reaches a query
The server SHALL parse and bind every formula itself and SHALL send the source only queries built from the parsed formula: constants and signal names as query parameters, never request text. Origin: D-102 (no user-written query language; scope and grant still bound it); lead pick 6.

#### Scenario: Constants and names as parameters
- **WHEN** the ClickHouse adapter builds the queries of `a * 2.5 + b` with inputs `Fast_100h.SIG_A` and `Sna_800h.SPEED`
- **THEN** the SQL text contains `{k0:Float64}` and neither `2.5` nor either signal name; the query parameters hold `k0` = 2.5 and both names
- **Evidence:** `apps/server/test/clickhouse.computed.test.ts` › "compiles constants and names as parameters"

#### Scenario: Injected text refused
- **WHEN** `GET /api/series` asks for a computed signal with `formula` `a + 1); DROP TABLE signals --`
- **THEN** it answers 400 `invalid_formula` with message `Unexpected ")" at 6` and sends no source query
- **Evidence:** `apps/server/test/computed.http.test.ts` › "refuses bad computed requests"

### Requirement: Values per row
With one input the formula SHALL apply per row. With two, rows SHALL lie at the distinct times of both inputs' points in the range, each input holding its last point, an input's last point before the range counting; no row before both have one. Origin: D-102 (stage 1 per row; stage 2 „holding the last value on the union of both signals' times").

#### Scenario: Difference per row with edges
- **WHEN** a computed series `a - b` with a = `conf-a/Lin.RAMP`, b = `conf-a/Sna.CODE` (SNA range 6.5–7.5) is asked for [B + 1 s, B + 2 s) with target 1000
- **THEN** it is raw with 100 points at B + 1 s + k·10 ms (k = 0 … 99), values 99 … 198; `before` is (B + 990 ms, 99), `after` (B + 2 s, 198); native and core-only answers are equal
- **Evidence:** conformance suite › "computes a difference per row with edges" (ClickHouse and ADX emulator, native and core only)

#### Scenario: One input
- **WHEN** `abs(a - 5000)` with a = `conf-a/Lin.RAMP` is asked for [B + 49.9 s, B + 50.1 s)
- **THEN** it gives 20 raw points with values 10, 9, …, 1, 0, 1, …, 9
- **Evidence:** conformance suite › "computes one input per row"

### Requirement: SNA in either input
A computed row SHALL be SNA when any input's held point is SNA, and when the result is not finite (design Q-4); an SNA row is never a number. Origin: D-102 („SNA in either gives SNA"); D-010; non-finite: design Q-4 (lead pick).

#### Scenario: SNA from b
- **WHEN** the series of "Difference per row with edges" is asked for [B + 49.5 s, B + 50.5 s)
- **THEN** the 50 points before B + 50 s are null (b held at its SNA row n = 49) and the 50 from B + 50 s have values 5000 … 5049
- **Evidence:** conformance suite › "computes SNA from either input"

#### Scenario: Division by zero
- **WHEN** `a / b` with the inputs of "Difference per row with edges" is asked for [B, B + 1 s)
- **THEN** all 100 points are null
- **Evidence:** conformance suite › "gives SNA for non-finite results"

### Requirement: Gaps of both inputs
An input SHALL be held at most 3 of its periods (`GAP_PERIODS`); a time where an input's last point is older gives no row. The computed signal's gap rule SHALL use the data ref's logger gaps and the smallest known period of its inputs. Origin: D-102 („gaps of both") with D-062; hold limit: design Q-5.

#### Scenario: Hold limit
- **WHEN** the series of "Difference per row with edges" is asked with a hold limit of 500 ms for b
- **THEN** it gives 51 points, B + 1 s … B + 1.5 s, values 99 … 149
- **Evidence:** conformance suite › "holds an input only within its hold limit"; `packages/shared/test/computed.test.ts` › "computes rows on the union of times"

#### Scenario: Gap rule of a computed signal
- **WHEN** `computedSignalGaps` gets gap info with logger gaps L, period 10 ms for `car/A.X` and 1 s for `car/B.Y`, for `a - b` over both, then for `abs(a)` over a signal without a period
- **THEN** the first has logger L and period 10 ms, the second logger L and no period
- **Evidence:** `packages/shared/test/computed.test.ts` › "takes the logger gaps and the smallest period"

#### Scenario: Gap marks on real data
- **WHEN** on smart451 the computed signal of manual check M1 is shown over a range that holds a logger gap of the session
- **THEN** its curve breaks at the same place as `DNMOT`'s in the same window (the gap band covers both)
- **Evidence:** UI check on smart451 (one screenshot)

### Requirement: Buckets from exact rows
When a range holds more input rows than the target, the server SHALL return buckets on the usual grid aggregating the exact per-row values: valid count, SNA count, mean, min and max of the valid ones. Origin: D-102 („buckets come from the exact per-row result"; a grid of last values lost −946 for −157).

#### Scenario: Ten buckets of 10 s
- **WHEN** the adapter's computed series of "Difference per row with edges" runs over [B, B + 100 s) with target 100 and width 10 s
- **THEN** it gives 10 buckets; bucket 0: count 1000, sna 0, mean 497.5, min 0, max 995; bucket 4: count 0, sna 1000, mean, min, max null; bucket 5: count 1000, mean 5497.5, min 5000, max 5995
- **Evidence:** conformance suite › "buckets computed rows exactly"

### Requirement: Computed series, values and extents over HTTP
`/api/series`, `/api/value` and `/api/extent` SHALL take a computed signal `<dataRef>/=<id>` with `formula`, `a` and optional `b`, resolve the inputs on that data ref within the route's scope and catalog, and answer in today's shapes (design C8). Origin: lead pick 3 (behaves like any signal); D-102 (scope and grant still bound it).

#### Scenario: Series equals the per-row rule
- **WHEN** against the test DB `GET /api/series` asks for `testcar/=c1` with `formula=a - b`, `a=Fast_100h.SIG_A`, `b=Sna_800h.SPEED` over a 2 s range with target 5000, and the same range of both inputs is read raw
- **THEN** the answer is raw, `signalId` `testcar/=c1`, and equals `computeRows` over the inputs' raw points with their seeds (times and values, nulls at SNA)
- **Evidence:** `apps/server/test/computed.http.test.ts` › "serves a computed series"

#### Scenario: Refused requests
- **WHEN** computed requests come with no `formula`, with `formula=a - c`, with `a=Nope_1h.X`, with `a` a signal that has states, and a plain signal comes with `formula=a`
- **THEN** they answer 400 `invalid_request`, 400 `invalid_formula` (`Unknown name "c": …`), 404 `unknown_signal` (`signalId` `testcar/Nope_1h.X`), 422 `not_numeric_signal`, 400 `invalid_request`
- **Evidence:** `apps/server/test/computed.http.test.ts` › "refuses bad computed requests"

#### Scenario: Value and extent
- **WHEN** `GET /api/value` asks for the computed signal of "Series equals the per-row rule" at a time between rows in step and line mode, and `GET /api/extent` for it
- **THEN** the value equals `computedValueAt` over the inputs' `before`/`after` points, and the extent's `first` is the later of the inputs' firsts, `last` the later of their lasts
- **Evidence:** `apps/server/test/computed.http.test.ts` › "answers a computed value and extent"; `packages/shared/test/computed.test.ts` › "evaluates a computed value at a time" (a at 0, 10, 20 ns values 0, 10, 20; b at 5, 25 values 1, 2; t = 12: step held 9, line 11; with b's hold limit 5 ns: none, `period_gap`)

### Requirement: ClickHouse in one scan
On ClickHouse a computed series SHALL read both inputs in one scan of `signal IN (a, b)` with a window function, no join and no union, plus one count. Origin: D-102 (measured: busiest hour 0.12 s, whole recording 0.95 s; no materialized views).

#### Scenario: Query count
- **WHEN** the ClickHouse adapter answers a computed buckets request of two inputs through a query-counting client
- **THEN** it sends exactly two queries (the count and the scan); the scan's SQL contains `IGNORE NULLS OVER` and neither `JOIN` nor `UNION`
- **Evidence:** `apps/server/test/clickhouse.computed.test.ts` › "computes in one scan"

#### Scenario: Speed on carserver (goal)
- **WHEN** the lead times `/api/series` for `a - b` with a = `MS_312h.DNMOT`, b = `CPC_508h.PNHV_SupBat_Curr` over the busiest hour and over the whole recording, target 2000
- **THEN** the times are reported against the goals 0.5 s and 3 s (not pass/fail)
- **Evidence:** lead's `curl -s -o /dev/null -w '%{time_total}'` output (manual check M7)

### Requirement: Definitions in the workspace
A workspace SHALL hold up to 20 computed signals (name, formula, inputs by signal name without data ref, unit), changed only by `computed.add`, `computed.update` and `computed.remove` with the refusals of design C7. Names are unique ignoring case; inputs must be numeric. Origin: D-102 („the definition lives in the workspace and the view"); lead picks 4 and 5; limits: design Numbers.

#### Scenario: Add, update, remove
- **WHEN** on a workspace scoped to `testcar` `computed.add {name: "Diff", formula: "a - b", a: "Fast_100h.SIG_A", b: "Sna_800h.SPEED"}` runs, `testcar/=<id>` is added to a window, then `computed.update` changes the formula to `abs(a)` and the name to `Abs`, then `computed.remove`
- **THEN** the add answers `created` `c<n>`; the update answers a new ID, the window's assignment keeps its assignment ID and now names `testcar/=<new id>` with the same colour index, the definition has no `b`; after the remove the window has no signal and `colors` has no key for it
- **Evidence:** `packages/shared/test/computedApply.test.ts` › "adds, updates and removes computed signals"

#### Scenario: Refusals
- **WHEN** `computed.add` runs with formula `a - c`, with name `diff` beside `Diff`, as the 21st definition, with input `Nope_1h.X`, with an input that has states; `computed.update` with an unknown ID; and an update whose new unit gives a window a fifth unit
- **THEN** they are refused with `invalid_formula` (C1 message), `duplicate_name`, `computed_limit`, `unknown_signal` (`not in this list: Nope_1h.X`), `not_numeric_signal`, `unknown_computed`, `too_many_units`, and the workspace is unchanged
- **Evidence:** `packages/shared/test/computedApply.test.ts` › "refuses bad computed definitions"

### Requirement: A computed signal behaves like any signal
A computed signal SHALL be added, moved, copied and removed in windows like any signal, get a colour, a legend row with its name, an axis by its unit and cursor values, and count towards the 50-signal limit; the events line SHALL refuse it. Origin: D-104 („behaves like any other signal (add, drag, legend, cursors)"); lead pick 3.

#### Scenario: Commands treat it as a signal
- **WHEN** `window.addSignal` adds a computed ID whose inputs exist, one whose input is missing on its data ref, a computed signal with unit `A` to a window with four other units, and `events.addSignal` adds a computed ID
- **THEN** the first succeeds with a colour; the second is `unknown_signal` with message `computed signal testcar/=c1: not in this list: Sna_800h.SPEED`; the third `too_many_units`; the fourth `not_state_signal`
- **Evidence:** `packages/shared/test/computedApply.test.ts` › "treats a computed signal like any signal"

#### Scenario: Create and see on real data
- **WHEN** the UI user follows manual check M1 on smart451
- **THEN** the editor shows a `DNMOT`, b `PNHV_SupBat_Curr`, Difference, `a - b`, name `DNMOT − PNHV_SupBat_Curr`; after Enter the row is under `ƒ Computed` and active, and the target window shows the legend row `DNMOT − PNHV_SupBat_Curr` with a curve
- **Evidence:** UI check M1 on smart451 (one screenshot with editor, one after Save)

#### Scenario: Cursor values agree
- **WHEN** the UI user follows manual check M2
- **THEN** at each of three cursor times the computed value equals DNMOT − PNHV_SupBat_Curr to the shown digits
- **Evidence:** UI check M2 on smart451 (screenshot of the values window per time, or one with the three readings noted)

### Requirement: Inputs follow the session
Inputs SHALL resolve on the computed signal's data ref, so a session step moves a shown computed signal with its inputs; a computed signal whose input is missing on that data ref SHALL show as unavailable with the missing inputs as reason. Origin: lead pick 4; D-102 (by name, like favourites).

#### Scenario: Step rebinds
- **WHEN** a workspace on catalog entry 1 (`ref1`) shows `ref1/=c1` over `A.X - B.Y` and `case.step` goes to `ref2`, once where `ref2` has both inputs and once where it lacks `B.Y`
- **THEN** the window shows `ref2/=c1` both times; the second result's `missing` lists `ref2/=c1`
- **Evidence:** `packages/shared/test/computedApply.test.ts` › "rebinds computed signals on a step"

#### Scenario: Unavailable info
- **WHEN** `computedInfos` gets c1 over `A.X - B.Y` and c2 over `A.X - C.Z` with items `car1/A.X`, `car1/B.Y`, `car2/A.X`
- **THEN** it gives `car1/=c1` (available, `displayName` c1's name, `description` `A.X − B.Y`) and `car1/=c2` with `computed.unavailable` `not in this list: C.Z`; no info for `car2`
- **Evidence:** `packages/shared/test/computed.test.ts` › "derives signal infos per data ref"

#### Scenario: Next session on real data
- **WHEN** the UI user follows manual check M5
- **THEN** the computed signal is drawn on the next session with the same legend name
- **Evidence:** UI check M5 on smart451 (screenshot after the step)

### Requirement: Computed section in the explorer
The explorer SHALL show a `ƒ Computed` section right under Favourites with a `+` in its header, open unless toggled (also on the empty search, design Q-2), a one-line hint when there is no computed signal, and only matching rows while searching (design C12). Origin: D-104 („in their own section right under Favourites, with one obvious way to create one"); lead pick 2.

#### Scenario: Items of the section
- **WHEN** `explorerItems` gets the matches of signal-groups "Group order and state", favourites the names of ranks 5 and 2, and computed matches (one, then none), searching and on the empty query
- **THEN** the items are the Favourites header and copies, then header `ƒ Computed` (`computed: true`, count 1, open) and its row, then exactly the items of "Group order and state"; with no definition on the empty query the header has count 0 and is followed by one `hint` item; while searching without a computed match there is no Computed header; toggling `ƒ Computed` closes it
- **Evidence:** `apps/web/test/explorer.test.ts` › "puts the Computed section under Favourites"

#### Scenario: Row markup
- **WHEN** the explorer renders an available and an unavailable computed row
- **THEN** both have the `ƒ` glyph in the indent, no star button and a `button.edit`; the available row has a `+`, the unavailable one has none and its `title` is the reason
- **Evidence:** `apps/web/test/explorer.test.ts` › "renders computed rows with a pencil and no star"

#### Scenario: Section on real data
- **WHEN** on smart451 with no computed signal the search is empty, then `speed` is typed
- **THEN** first `ƒ Computed 0` sits right under Favourites (or first when there are none) with the hint row `No computed signals yet: click + to build one`, header and hint each ≤ 24 px; while searching `speed` there is no Computed header
- **Evidence:** UI check on smart451 (one screenshot per state, heights via `getBoundingClientRect`)

### Requirement: Editor
A `+` in the Computed header, the hint row, a row's pencil or `F2` SHALL open the editor of design C12: pickers for `a` and `b` over the current list (numeric only), a preset dropdown, the formula field with a one-line live error, name and unit, Save, Cancel and, when editing, Delete. Origin: D-104 („drop down mit magie", „leicht zu bedienen", „schön aussieht"); lead picks 1 and 2; Q-3.

#### Scenario: Prefill from the selection
- **WHEN** `prefill` gets two selected numeric signals, one, one with states, and three
- **THEN** it gives a and b with formula `a - b`; a with `abs(a)`; then empty with `a - b` twice
- **Evidence:** `apps/web/test/computedEditor.test.ts` › "prefills from the selection"

#### Scenario: Presets and formula both ways
- **WHEN** preset Minimum is picked, then the formula text is changed to `min( a,b )`, then to `min(a, b) + 1`
- **THEN** the formula reads `min(a, b)`, the preset stays Minimum, then turns Custom
- **Evidence:** `apps/web/test/computedEditor.test.ts` › "maps preset and formula both ways"

#### Scenario: Live error blocks Save
- **WHEN** the editor state has formula `a - b` with no b, then `a -`, then a valid formula with the name of another definition
- **THEN** `editorError` gives `Pick a signal for b`, `Unexpected end at 4`, `Name already used`; for a valid state it gives none
- **Evidence:** `apps/web/test/computedEditor.test.ts` › "shows the first error and blocks Save"

#### Scenario: Live error on real data
- **WHEN** the UI user follows manual check M4
- **THEN** the error line reads `Unexpected end at 5`, then `Unknown name "c": …`, Save is disabled, and the formula field's and error line's boxes are unchanged (±0.5 px)
- **Evidence:** UI check M4 on smart451 (screenshot, the rects)

#### Scenario: State signals not pickable
- **WHEN** the picker for `a` lists a signal with states
- **THEN** the row is drawn in `--disabled` with `title` `MODE has states: pick a numeric signal` (that signal's short name) and Enter or a click does not pick it
- **Evidence:** `apps/web/test/computedEditor.test.ts` › "refuses state signals in the picker"

#### Scenario: One primary in the editor
- **WHEN** the editor is open on smart451
- **THEN** it has exactly one button with background `rgb(15, 23, 42)` (Save), measures 360 px wide, and its pickers, preset select and formula field are 26 px tall
- **Evidence:** UI check on smart451 (snippet output, one screenshot)

### Requirement: Name and unit filled in
The editor SHALL fill the name from the formula with short signal names and the unit when it is unambiguous (design C12), and keep both following until the user types in that field. Origin: lead pick 1.

#### Scenario: Auto name and unit
- **WHEN** `formulaName` and `inferUnit` get `a - b` (a `MS_312h.DNMOT` rpm, b `CPC_508h.PNHV_SupBat_Curr` A), `abs(a)`, `min(a, b)` with both in A, `a * 1` with a in A, `(a + b) / 2` and `a - b` where another definition already has that name
- **THEN** the names are `DNMOT − PNHV_SupBat_Curr`, `abs(DNMOT)`, `min(DNMOT, PNHV_SupBat_Curr)`, `DNMOT × 1`, `(DNMOT + PNHV_SupBat_Curr) / 2`, `DNMOT − PNHV_SupBat_Curr 2`; the units none, rpm, A, none, none
- **Evidence:** `packages/shared/test/formula.test.ts` › "names formulas with short signal names", "infers units only when unambiguous"; `apps/web/test/computedEditor.test.ts` › "follows the formula with name and unit until typed"

### Requirement: Edit and delete
Saving an edit SHALL redraw every window that shows the computed signal with the new formula, name and unit; Delete (a second click within 3 s) SHALL remove it from the list and every window. Origin: lead pick 3 („Editing a shown one redraws it; deleting a shown one removes it from the windows").

#### Scenario: Edit on real data
- **WHEN** the UI user follows manual check M3
- **THEN** the legend row reads `abs(DNMOT)` and the curve is ≥ 0 everywhere in the window
- **Evidence:** UI check M3 on smart451 (screenshot)

#### Scenario: Delete on real data
- **WHEN** the UI user follows manual check M6
- **THEN** after the second click the row and its legend row are gone and the hint row is back
- **Evidence:** UI check M6 on smart451 (screenshot)

### Requirement: Requests carry the definition
The web SHALL send a computed signal's formula and inputs with every series, value and extent request, ask gap info for its inputs instead of its ID, and send nothing for a computed ID without a definition. Origin: necessary consequence of design C8 (the server is stateless per request) and C3.

#### Scenario: Parameters and gap signals
- **WHEN** `setComputedDefs([c7 = a - b over A.X, B.Y])` ran and `fetchSeries` asks for `car/=c7`, `fetchCursorValue` for `other/=c7`, `fetchSeries` for `car/=c9`, and the gap loader is asked for `car/=c7` and `car/C.Z`
- **THEN** the first two URLs carry `formula=a+-+b` (URL-encoded), `a=A.X`, `b=B.Y`; the third rejects with code `unknown_computed` and no request; the gap request names `car/A.X`, `car/B.Y`, `car/C.Z`
- **Evidence:** `apps/web/test/api.test.ts` › "adds the formula to computed requests"; `apps/web/test/gaps.test.ts` › "asks gap info for a computed signal's inputs"

### Requirement: Computed signals documented
`docs/http-api.md` SHALL describe the computed parameters and errors of design C8, `docs/data-sources.md` the optional adapter method and its fallback, and `docs/manual.md` the Computed section, the editor, `F2` and `kipscope calc`. Origin: data-source "Adapter guide"; necessary consequence (manual and shortcuts kept in step).

#### Scenario: Docs and keys
- **WHEN** `pnpm test` runs
- **THEN** `apps/web/test/manual.test.ts` and `apps/web/test/shortcuts.test.ts` pass with the `F2` row, and `grep -c "computed_too_large" docs/http-api.md` and `grep -c "computedSeries" docs/data-sources.md` print at least 1
- **Evidence:** the test run and the two commands
