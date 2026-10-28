# computed-signals Specification

## Purpose
Signals computed from up to 8 other signals (computed ones included, D-106) by a small formula of KIPscope's own (D-102), defined in a few clicks from the explorer and then used like any other signal (D-104).

## Requirements

### Requirement: Formula language
A formula SHALL consist of signal names (design F1, "Signal names in a formula"), numbers, `+ - * /`, parentheses, `abs(x)`, `min(x, y, …)`, `max(x, y, …)` with two or more values, name at least one signal, and hold at most 500 characters and 64 parts; nothing else parses. Errors SHALL name what is wrong and its 1-based position. Origin: D-102 („+ - * /, constants, abs, min(a,b), max(a,b) … never user-written KQL or SQL"); names: D-106; two or more values: D-107 Q-2; 500 characters: necessary consequence of D-106's 8 signals with full names (design Numbers).

#### Scenario: Accepted and refused formulas
- **WHEN** `parseFormula` reads `MS_312h.DNMOT - CPC_508h.PNHV_SupBat_Curr`, ` abs(X.A) `, `min(X.A, "DNMOT − PNHV") * 0.5`, `-X.A / (Y.B + 1e3)`, `X.A − Y.B` (U+2212), `max(X.A,2) + X.A`, `"say \"hi\"" + "abs"`, `max(X.A, Y.B, 3, Z.C)`, then `X.A - `, `abs(X.A, Y.B)`, `min(X.A)`, `(X.A + Y.B`, `X.A % 2`, `1e999 + X.A`, `2 * 3`, `"DNMOT − P`, `"" + X.A`, `abs + 1`, the empty text and a 501-character formula
- **THEN** the first eight are ok with `names` [`MS_312h.DNMOT`, `CPC_508h.PNHV_SupBat_Curr`], [`X.A`], [`X.A`, `DNMOT − PNHV`], [`X.A`, `Y.B`], [`X.A`, `Y.B`], [`X.A`], [`say "hi"`, `abs`], [`X.A`, `Y.B`, `Z.C`]; the others fail with `Unexpected end at 7`, `abs takes one value: abs(x)`, `min takes two or more values: min(x, y, …)`, `Missing ")" at 11`, `Unexpected "%" at 5`, `Number too large at 1`, `Use at least one signal`, `Missing closing " at 1`, `Empty name at 1`, `Unexpected "+" at 5`, `Enter a formula`, `At most 500 characters`
- **Evidence:** `packages/shared/test/formula.test.ts` › "parses the formula language", "reports errors with positions"

#### Scenario: Evaluation
- **WHEN** `evalFormula` and `compileFormula` evaluate `abs(X.A - Y.B)` at (3, 5), `min(X.A, Y.B) * 2` at (3, 5), `max(X.A, -Y.B)` at (3, 5), `min(X.A, Y.B, Z.C)` at (3, 5, -1), `-X.A * 2 - 1` at 3 and `X.A / Y.B` at (1, 0)
- **THEN** both give 2, 6, 3, −1, −7 and a non-finite number
- **Evidence:** `packages/shared/test/formula.test.ts` › "evaluates formulas in double precision"

### Requirement: Formula text never reaches a query
The server SHALL parse every formula itself and SHALL send the source only queries built from the parsed formula: constants and signal names as query parameters, never request text. Origin: D-102 (no user-written query language; scope and grant still bound it); add-computed-signals lead pick 6.

#### Scenario: Constants and names as parameters
- **WHEN** the ClickHouse adapter builds the queries of `Fast_100h.SIG_A * 2.5 + Sna_800h.SPEED`
- **THEN** the SQL text contains `{k0:Float64}`, `{s0:String}` and `{s1:String}` and neither `2.5` nor either signal name; the query parameters hold `k0` = 2.5, `s0` = `Fast_100h.SIG_A`, `s1` = `Sna_800h.SPEED`
- **Evidence:** `apps/server/test/clickhouse.computed.test.ts` › "compiles constants and names as parameters"

#### Scenario: Injected text refused
- **WHEN** `GET /api/series` asks for a computed signal with `formula` `Fast_100h.SIG_A + 1); DROP TABLE signals --`
- **THEN** it answers 400 `invalid_formula` with message `Unexpected ")" at 20` and sends no source query
- **Evidence:** `apps/server/test/computed.http.test.ts` › "refuses bad computed requests"

### Requirement: Values per row
With one input the formula SHALL apply per row. With several, rows SHALL lie at the distinct times of all inputs' points in the range, each input holding its last point, an input's last point before the range counting; no row before every input has one. Origin: D-102 (stage 1 per row; stage 2 „holding the last value on the union of both signals' times"); N inputs: D-106 („at most 8 signals").

#### Scenario: Difference per row with edges
- **WHEN** a computed series `Lin.RAMP - Sna.CODE` on `conf-a` (`Sna.CODE` SNA range 6.5–7.5) is asked for [B + 1 s, B + 2 s) with target 1000
- **THEN** it is raw with 100 points at B + 1 s + k·10 ms (k = 0 … 99), values 99 … 198; `before` is (B + 990 ms, 99), `after` (B + 2 s, 198); native and core-only answers are equal
- **Evidence:** conformance suite › "computes a difference per row with edges" (ClickHouse and ADX emulator, native and core only)

#### Scenario: One input
- **WHEN** `abs(Lin.RAMP - 5000)` on `conf-a` is asked for [B + 49.9 s, B + 50.1 s)
- **THEN** it gives 20 raw points with values 10, 9, …, 1, 0, 1, …, 9
- **Evidence:** conformance suite › "computes one input per row"

#### Scenario: Three inputs
- **WHEN** `Lin.RAMP + Sna.CODE * 100 - Beat.HB` on `conf-a` is asked for [B + 1 s, B + 1.2 s) with target 1000
- **THEN** it is raw with 20 points at B + 1 s + k·10 ms, values 200 … 209 for k = 0 … 9 and 209 … 218 for k = 10 … 19; native and core-only answers are equal
- **Evidence:** conformance suite › "computes three inputs per row"; `packages/shared/test/computed.test.ts` › "computes rows on the union of times" (a three-input case)

### Requirement: SNA in either input
A computed row SHALL be SNA when any input's held point is SNA, and when the result is not finite (D-105 Q-4); an SNA row is never a number. This holds inside `min` and `max` too: an SNA or NaN argument makes their result NaN, as `Math.min`/`Math.max` do in the core. Origin: D-102 („SNA in either gives SNA"); D-010; non-finite: D-105 Q-4; `min`/`max`: necessary consequence of data-source "Same rows natively and from the core". ClickHouse 26.8 gives `least(nan, 1)` = 1 and `least(1, nan)` = nan (probe on the test DB, 2026-10-23).

#### Scenario: SNA from b
- **WHEN** the series of "Difference per row with edges" is asked for [B + 49.5 s, B + 50.5 s)
- **THEN** the 50 points before B + 50 s are null (`Sna.CODE` held at its SNA row n = 49) and the 50 from B + 50 s have values 5000 … 5049
- **Evidence:** conformance suite › "computes SNA from either input"

#### Scenario: Division by zero
- **WHEN** `Lin.RAMP / Sna.CODE` on `conf-a` is asked for [B, B + 1 s)
- **THEN** all 100 points are null
- **Evidence:** conformance suite › "gives SNA for non-finite results"

#### Scenario: SNA and NaN inside min and max
- **WHEN** on `conf-a` with target 1000, `min(Sna.CODE, Lin.RAMP)` and `max(Sna.CODE, Lin.RAMP)` are asked for [B + 49.5 s, B + 50.5 s), and `min(Lin.RAMP / Sna.CODE, 1)` for [B, B + 1 s)
- **THEN** the first two give 100 raw points each, every 10 ms from B + 49.5 s. The first 50 are null in both. The last 50 are 0 for `min` and 5000 … 5049 for `max`. The third gives 100 points: the one at B is null (0 / 0 is NaN), the other 99 are 1 (k / 0 is +Infinity). Native and core-only answers are equal.
- **Evidence:** conformance suite › "keeps SNA through min and max" (ClickHouse and ADX emulator, native and core only). On ClickHouse native it fails before this change.

### Requirement: Gaps of both inputs
An input SHALL be held at most 3 of its periods (`GAP_PERIODS`); a time where an input's last point is older gives no row. The computed signal's gap rule SHALL use the data ref's logger gaps and the smallest known period of its source signals (nested ones resolved). Origin: D-102 („gaps of both") with D-062; hold limit: D-105 Q-5.

#### Scenario: Hold limit
- **WHEN** the series of "Difference per row with edges" is asked with a hold limit of 500 ms for `Sna.CODE`
- **THEN** it gives 51 points, B + 1 s … B + 1.5 s, values 99 … 149
- **Evidence:** conformance suite › "holds an input only within its hold limit"; `packages/shared/test/computed.test.ts` › "computes rows on the union of times"

#### Scenario: Gap rule of a computed signal
- **WHEN** `computedSignalGaps` gets gap info with logger gaps L, period 10 ms for `car/A.X` and 1 s for `car/B.Y`, with sources [`A.X`, `B.Y`], then with sources [`C.Z`] (no period)
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
`/api/series`, `/api/value` and `/api/extent` SHALL take a computed signal `<dataRef>/=<id>` with `formula`, the formula flattened over at most 8 source signals, read the names from the formula, resolve them exactly on that data ref within the route's scope and catalog, and answer in today's shapes (design F8). Origin: add-computed-signals lead pick 3 (behaves like any signal); D-102 (scope and grant still bound it); stateless server and names from the formula: necessary consequence of D-106 (N inputs, nesting) with add-computed-signals C8.

#### Scenario: Series equals the per-row rule
- **WHEN** against the test DB `GET /api/series` asks for `testcar/=c1` with `formula=Fast_100h.SIG_A - Fast_100h.SIG_B + Fast_100h.SIG_C` over a 2 s range with target 5000, and the same range of the three inputs is read raw
- **THEN** the answer is raw, `signalId` `testcar/=c1`, and equals `computeRows` over the inputs' raw points with their seeds
- **Evidence:** `apps/server/test/computed.http.test.ts` › "serves a computed series"

#### Scenario: Refused requests
- **WHEN** computed requests come with no `formula`, with `formula=Fast_100h.SIG_A - Nope_1h.X`, with `formula=Ign_A20h.MODE + 1`, with `formula=Many_700h.S0000 + … + Many_700h.S0008` (9 names), and a plain signal comes with `formula=Fast_100h.SIG_A`
- **THEN** they answer 400 `invalid_request` (`a computed signal needs formula`), 404 `unknown_signal` (`signalId` `testcar/Nope_1h.X`), 422 `not_numeric_signal`, 400 `invalid_formula` (`At most 8 signals (with nested ones): 9`), 400 `invalid_request` (`formula goes with a computed signal only`)
- **Evidence:** `apps/server/test/computed.http.test.ts` › "refuses bad computed requests"

#### Scenario: Value and extent
- **WHEN** `GET /api/value` asks for the computed signal of "Series equals the per-row rule" at a time between rows in step and line mode, and `GET /api/extent` for it
- **THEN** the value equals `computedValueAt` over the inputs' `before`/`after` points, and the extent's `first` is the latest of the inputs' firsts, `last` the latest of their lasts
- **Evidence:** `apps/server/test/computed.http.test.ts` › "answers a computed value and extent"; `packages/shared/test/computed.test.ts` › "evaluates a computed value at a time" (A.X at 0, 10, 20 ns values 0, 10, 20; B.Y at 5, 25 values 1, 2; `A.X - B.Y` at t = 12: step held 9, line 11; with B.Y's hold limit 5 ns: none, `period_gap`)

### Requirement: ClickHouse in one scan
On ClickHouse a computed series SHALL read all its source signals in one scan of `signal IN (…)` with window functions, no join and no union, plus one count. The one exception is a large bucket answer, which is split into chunks with one such scan each ("Chunked bucket scan"). With several inputs the scan SHALL use a ROWS frame and take one row per distinct time from the last row at that time, without `LIMIT 1 BY`. Its rows SHALL equal those of the core (data-source "Same rows natively and from the core", "Rows at shared times"). Origin: D-102 (measured: busiest hour 0.12 s, whole recording 0.95 s; no materialized views); N signals: D-106; ROWS frame and last row per time: Jan 2026-10-23 („ja, gerne optimieren“) on the lead's measurement (3.49 s today vs 2.06 s with that shape, same count, min and max).

#### Scenario: Query count
- **WHEN** the ClickHouse adapter answers a computed buckets request of `Fast_100h.SIG_A - Fast_100h.SIG_B + Fast_100h.SIG_C` through a query-counting client, and then a raw request of a two-input formula
- **THEN** each sends exactly two queries (the count and the scan). The scan's SQL contains `{s2:String}` (buckets case), `IGNORE NULLS OVER` and `ROWS BETWEEN`. It contains none of `JOIN`, `UNION`, `RANGE BETWEEN` and `LIMIT 1 BY`.
- **Evidence:** `apps/server/test/clickhouse.computed.test.ts` › "computes in one scan", "sends the same two queries for a raw answer", "computes three inputs in one scan"

#### Scenario: Same answer on real data
- **WHEN** the lead runs `/api/series` for `MS_312h.DNMOT - CPC_508h.PNHV_SupBat_Curr` on smart451 over the whole recording with target 2000, once before the change and once after each round
- **THEN** both answers have the same bucket starts, `count` and `sna` per bucket, and the same `min` and `max`. `mean` differs by at most 1e-9 relative. Summed over all buckets: `count` 4,138,258, `sna` 2,794, min −170.6, max 81.6. The 25 min window answer is equal to its saved answer in the same way.
- **Evidence:** the lead's saved JSON answers (`before-whole.json`, `before-window.json` in the lead's scratchpad) compared with `jq` (manual check S2 in design.md)

#### Scenario: Speed on carserver (goal)
- **WHEN** the lead times `/api/series`, target 2000, for `MS_312h.DNMOT - CPC_508h.PNHV_SupBat_Curr` over the whole recording, over a 25 min window and over the busiest hour, and for a three-input formula with a third numeric signal of the session over the whole recording
- **THEN** the times are reported against these goals, not as pass/fail: whole recording ≤ 2 s (3.9–4.0 s before the change, 3.05–3.20 s after round 1), 25 min window ≤ 0.30 s (0.21–0.30 s before, 0.18–0.28 s after round 1), busiest hour ≤ 0.5 s. The three-input time is reported without a goal.
- **Evidence:** lead's `curl -s -o /dev/null -w '%{time_total}'` output, three runs each (manual check S1 in design.md)

### Requirement: Definitions in the workspace
A workspace SHALL hold up to 20 computed signals (name, canonical formula, unit), changed only by `computed.add`, `computed.update` and `computed.remove` with the refusals of design F5. Names are unique ignoring case and never equal a signal name of the list in use; source signals must be numeric and in the list. Origin: D-102 („the definition lives in the workspace and the view"); add-computed-signals lead picks 4 and 5, D-105 Q-7; name guard: necessary consequence of design F2 (a definition name wins over a signal name).

#### Scenario: Add, update, remove
- **WHEN** on a workspace scoped to `testcar` `computed.add {name: "Diff", formula: "Fast_100h.SIG_A-Sna_800h.SPEED"}` runs, `testcar/=<id>` is added to a window, then `computed.update` changes the formula to `abs(Fast_100h.SIG_A)` and the name to `Abs`, then `computed.remove`
- **THEN** the add answers `created` `c<n>` and stores `Fast_100h.SIG_A - Sna_800h.SPEED`; the update answers a new ID, the window's assignment keeps its assignment ID and now names `testcar/=<new id>` with the same colour index; after the remove the window has no signal and `colors` has no key for it
- **Evidence:** `packages/shared/test/computedApply.test.ts` › "adds, updates and removes computed signals"

#### Scenario: Refusals
- **WHEN** `computed.add` runs with formula `Fast_100h.SIG_A - Nope_1h.X`, with `SIG_A - SPEED` (short names), with name `diff` beside `Diff`, with name `Fast_100h.SIG_A`, as the 21st definition, with a source that has states, and with 9 sources; `computed.update` with an unknown ID, with a cycle, and with a new unit that gives a window a fifth unit
- **THEN** they are refused with `unknown_signal` (`not in this list: Nope_1h.X`), `unknown_signal` (`not in this list: SIG_A`), `duplicate_name`, `duplicate_name` (`Name used by a signal: Fast_100h.SIG_A`), `computed_limit`, `not_numeric_signal`, `invalid_formula` (`At most 8 signals (with nested ones): 9`), `unknown_computed`, `invalid_formula` (`Cycle: …`), `too_many_units`, and the workspace is unchanged; `Command.safeParse` of a `computed.add` body with a field `a` fails
- **Evidence:** `packages/shared/test/computedApply.test.ts` › "refuses bad computed definitions"

### Requirement: A computed signal behaves like any signal
A computed signal SHALL be added, moved, copied and removed in windows like any signal, get a colour, a legend row with its name, an axis by its unit and cursor values, and count once towards the 50-signal limit; the events line SHALL refuse it. Origin: D-104 („behaves like any other signal (add, drag, legend, cursors)"); add-computed-signals lead pick 3.

#### Scenario: Commands treat it as a signal
- **WHEN** `window.addSignal` adds a computed ID whose sources exist, the ID of `abs(Diff)` whose nested source `Sna_800h.SPEED` is missing on its data ref, a computed signal with unit `A` to a window with four other units, and `events.addSignal` adds a computed ID
- **THEN** the first succeeds with a colour; the second is `unknown_signal` with message `computed signal testcar/=c2: not in this list: Sna_800h.SPEED`; the third `too_many_units`; the fourth `not_state_signal`
- **Evidence:** `packages/shared/test/computedApply.test.ts` › "treats a computed signal like any signal"

#### Scenario: Create and see on real data
- **WHEN** the UI user follows manual checks M1 (type and pick) and M7 (prefill from a selection, "Add to" New window)
- **THEN** M1 saves `MS_312h.DNMOT - CPC_508h.PNHV_SupBat_Curr` named `DNMOT − PNHV_SupBat_Curr`, the row is under `ƒ Computed` and active, and the target window shows its legend row with a curve; in M7 Enter after the prefill opens a new window showing it
- **Evidence:** UI check M1 and M7 on smart451 (per route one screenshot with the editor, one after Save)

#### Scenario: Cursor values agree
- **WHEN** the UI user puts M1's signal, `DNMOT` and `PNHV_SupBat_Curr` in a values window in step mode and puts cursor A on three times
- **THEN** at each time the computed value equals DNMOT − PNHV_SupBat_Curr to the shown digits
- **Evidence:** UI check on smart451 (screenshot of the values window per time, or one with the three readings noted)

### Requirement: Inputs follow the session
Source signals SHALL resolve on the computed signal's data ref, so a session step moves a shown computed signal with its sources, nested ones included; a computed signal whose source is missing on that data ref SHALL show as unavailable with the missing sources as reason. Origin: add-computed-signals lead pick 4; D-102 (by name, like favourites).

#### Scenario: Step rebinds
- **WHEN** a workspace on catalog entry 1 (`ref1`) shows `ref1/=c2` for `abs(D)` where `D` = `A.X - B.Y`, and `case.step` goes to `ref2`, once where `ref2` has both sources and once where it lacks `B.Y`
- **THEN** the window shows `ref2/=c2` both times; the second result's `missing` lists `ref2/=c2`
- **Evidence:** `packages/shared/test/computedApply.test.ts` › "rebinds computed signals on a step"

#### Scenario: Unavailable info
- **WHEN** `computedInfos` gets c1 `D` = `A.X - B.Y`, c2 = `A.X - C.Z` and c3 = `abs(D)` with items `car1/A.X`, `car1/B.Y`, `car2/A.X`
- **THEN** it gives `car1/=c1` (available, `displayName` `D`, `description` `A.X - B.Y`), `car1/=c2` with `computed.unavailable` `not in this list: C.Z`, and `car1/=c3` available with `description` `abs(D)`; no info for `car2`
- **Evidence:** `packages/shared/test/computed.test.ts` › "derives signal infos per data ref"

#### Scenario: Next session on real data
- **WHEN** the UI user follows manual check M11
- **THEN** the nested computed signal is drawn on the next session with the same legend name
- **Evidence:** UI check M11 on smart451 (screenshot after the step)

### Requirement: Computed section in the explorer
The explorer SHALL show a `ƒ Computed` section right under Favourites with a `+` in its header, open unless toggled (also on the empty search, design Q-2), a one-line hint when there is no computed signal, and only matching rows while searching (design C12). Origin: D-104 („in their own section right under Favourites, with one obvious way to create one"); lead pick 2; hint text and no accent fill: lead decision L4.

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
- **THEN** first `ƒ Computed 0` sits right under Favourites (or first when there are none) with the hint row `None yet · + creates one`, header and hint each ≤ 24 px, the hint uncut (`scrollWidth` ≤ `clientWidth`) at 1440×900 and 1000×557, and neither has the accent background (`--accent-soft`) or an accent left bar; while searching `speed` there is no Computed header
- **Evidence:** UI check on smart451 (one screenshot per state, heights and widths via `getBoundingClientRect`/`scrollWidth`, computed backgrounds)

### Requirement: Name and unit filled in
The editor SHALL fill the name from the formula with short signal names and the names of nested computed signals, and the unit when it is unambiguous (design F7), and keep both following until the user types in that field. An outer signal's saved name and unit SHALL NOT change when an inner one is edited (design Q-4). Origin: add-computed-signals lead pick 1, D-105 Q-6; Q-4: design pick.

#### Scenario: Auto name and unit
- **WHEN** `formulaName` and `inferUnit` get `MS_312h.DNMOT - CPC_508h.PNHV_SupBat_Curr` (rpm, A), `abs(MS_312h.DNMOT)`, `min(X.A, Y.B)` with both in A, `X.A * 1` with X.A in A, `(X.A + Y.B) / 2`, `abs("DNMOT − PNHV_SupBat_Curr")` with that definition's unit A, `"DNMOT − PNHV_SupBat_Curr" * 2`, `X.A + Y.B + Z.C` all in V, and `max(X.A, Y.B, 0)` both in V
- **THEN** the names are `DNMOT − PNHV_SupBat_Curr`, `abs(DNMOT)`, `min(A, B)`, `A × 1`, `(A + B) / 2`, `abs(DNMOT − PNHV_SupBat_Curr)`, `(DNMOT − PNHV_SupBat_Curr) × 2`, `A + B + C`, `max(A, B, 0)`; the units none, rpm, A, none, none, A, none, V, V
- **Evidence:** `packages/shared/test/formula.test.ts` › "names formulas with short signal names", "infers units only when unambiguous"; `apps/web/test/computedEditor.test.ts` › "follows the formula with name and unit until typed"

### Requirement: Edit and delete
Saving an edit SHALL redraw every window that shows the computed signal or a signal using it; Delete (a second click within 3 s) SHALL remove it from the list and every window, or show the `computed_in_use` refusal in the error line and keep it. Origin: add-computed-signals lead pick 3; D-106 (live references, deleting a used one refused).

#### Scenario: Edit on real data
- **WHEN** the UI user follows manual check M4
- **THEN** both the edited signal's and the outer signal's curves redraw with the new formula
- **Evidence:** UI check M4 on smart451 (screenshot)

#### Scenario: Delete on real data
- **WHEN** the UI user deletes an unused computed signal with two clicks on Delete
- **THEN** after the second click the row and its legend row are gone (the hint row is back when it was the last)
- **Evidence:** UI check M6 on smart451 (screenshot)

### Requirement: Requests carry the definition
The web SHALL send a computed signal's formula flattened over its source signals with every series, value and extent request, ask gap info for those sources instead of its ID, and send nothing for a computed ID without a definition or whose definition does not flatten. Origin: necessary consequence of design F8 (the server is stateless per request) and F3.

#### Scenario: Parameters and gap signals
- **WHEN** `setComputedDefs([c7 D = A.X - B.Y, c8 = abs(D)])` ran and `fetchSeries` asks for `car/=c8`, `fetchCursorValue` for `other/=c7`, `fetchSeries` for `car/=c9`, and the gap loader is asked for `car/=c8` and `car/C.Z`
- **THEN** the first URL's `formula` decodes to `abs(A.X - B.Y)` and it has no `a` or `b` parameter; the second's decodes to `A.X - B.Y`; the third rejects with code `unknown_computed` and no request; the gap request names `car/A.X`, `car/B.Y`, `car/C.Z`
- **Evidence:** `apps/web/test/api.test.ts` › "adds the formula to computed requests"; `apps/web/test/gaps.test.ts` › "asks gap info for a computed signal's inputs"

### Requirement: Computed signals documented
`docs/http-api.md` SHALL describe the `formula` parameter of design F8 without `a` and `b`, `docs/data-sources.md` the optional adapter method with N inputs, and `docs/manual.md` the formula field (typing names, the suggestion list, Tab and Enter, quoting, nesting), `F2` and `kipscope calc`. Origin: data-source "Adapter guide"; necessary consequence (manual and shortcuts kept in step).

#### Scenario: Docs and keys
- **WHEN** `pnpm test` runs, then `grep -c "formula" docs/http-api.md`, `grep -c "&a=" docs/http-api.md` and `grep -c "Tab" docs/manual.md`
- **THEN** `apps/web/test/manual.test.ts` and `apps/web/test/shortcuts.test.ts` pass with the `F2` and `Tab` rows; the greps print at least 1, 0 and at least 1
- **Evidence:** the test run and the three commands

### Requirement: Signal names in a formula
A formula SHALL name its signals directly, bare when the name is an identifier, else in double quotes (design F1). Typed names SHALL resolve as design F2 orders it; an ambiguous name SHALL be refused naming the candidates, a signal with states refused. Definitions, views and requests hold the canonical form. Origin: D-106 („I just type a signal … have dropdown to select"); numeric only: D-105; quoting: necessary consequence (names hold `.`, spaces, `−`).

#### Scenario: Canonical text and quoting
- **WHEN** `formulaText` prints ` abs( X.A-  "Bat Curr" )*2 `, `(X.A - Y.B) - Z.C`, `X.A - (Y.B - Z.C)`, `-(X.A + Y.B)`, and `quoteName` gets `MS_312h.DNMOT`, `DNMOT − PNHV_SupBat_Curr`, `1st.X`, `abs`, `say "hi"`
- **THEN** the texts are `abs(X.A - "Bat Curr") * 2`, `X.A - Y.B - Z.C`, `X.A - (Y.B - Z.C)`, `-(X.A + Y.B)`; the names `MS_312h.DNMOT`, `"DNMOT − PNHV_SupBat_Curr"`, `"1st.X"`, `"abs"`, `"say \"hi\""`
- **Evidence:** `packages/shared/test/formula.test.ts` › "prints canonical text and quotes names"

#### Scenario: Typed names resolve
- **WHEN** `resolveFormula` gets the list `MS_312h.DNMOT` (rpm), `CPC_508h.PNHV_SupBat_Curr` (A), `Eng_1h.TEMP`, `Bat_2h.TEMP`, `MS_1h.MODE` (states) and the definition `DNMOT − PNHV_SupBat_Curr`, and reads `DNMOT - pnhv_supbat_curr`, `abs("dnmot − pnhv_supbat_curr")`, `TEMP + 1`, `MS_312h.DNMOT - DNMOX`, `MODE + 1`
- **THEN** the first two give `MS_312h.DNMOT - CPC_508h.PNHV_SupBat_Curr` and `abs("DNMOT − PNHV_SupBat_Curr")`; the others fail with `ambiguous_signal` `Ambiguous "TEMP" at 1: Bat_2h.TEMP, Eng_1h.TEMP` (candidates both names), `unknown_signal` `Unknown signal "DNMOX" at 17`, `not_numeric_signal` `MS_1h.MODE has states at 1: use a numeric signal`
- **Evidence:** `packages/shared/test/formula.test.ts` › "resolves typed names"

### Requirement: Computed signals in computed signals
A formula SHALL be able to name another computed signal as a live reference (design F4, F5): edits and renames of the inner one reach every user; each dependent signal gets a fresh ID. At most 8 source signals after resolving; cycles, an edit pushing a user past a limit (Q-5) and removing a used one SHALL be refused, naming the signals concerned. Origin: D-106; fresh IDs: necessary consequence of the tile cache keyed by signal ID.

#### Scenario: Flattening and limits
- **WHEN** with c1 `DNMOT − PNHV_SupBat_Curr` = `MS_312h.DNMOT - CPC_508h.PNHV_SupBat_Curr`, c2 `abs(DNMOT − PNHV_SupBat_Curr)` = `abs("DNMOT − PNHV_SupBat_Curr")` and c3 `Plus` = `"DNMOT − PNHV_SupBat_Curr" + Z.Z`: `computedParams(c2)`, `flattenFormula` of `"DNMOT − PNHV_SupBat_Curr" * 2`; `checkFormula` of c1 changed to `"abs(DNMOT − PNHV_SupBat_Curr)" + 1`, of a new formula over `S.S0` … `S.S8`, of c1 changed to the sum of `S.S0` … `S.S6` and `MS_312h.DNMOT`, and of c1 changed to `MS_312h.DNMOT * 2`
- **THEN** `abs(MS_312h.DNMOT - CPC_508h.PNHV_SupBat_Curr)`; `(MS_312h.DNMOT - CPC_508h.PNHV_SupBat_Curr) * 2` with sources [`MS_312h.DNMOT`, `CPC_508h.PNHV_SupBat_Curr`]; `invalid_formula` `Cycle: "DNMOT − PNHV_SupBat_Curr" → "abs(DNMOT − PNHV_SupBat_Curr)" → "DNMOT − PNHV_SupBat_Curr"`; `At most 8 signals (with nested ones): 9`; `At most 8 signals in "Plus" (with nested ones): 9`; ok with `users` [c2, c3]
- **Evidence:** `packages/shared/test/computed.test.ts` › "flattens nested computed signals", "refuses cycles and too many signals"

#### Scenario: Live reference in the workspace
- **WHEN** on a workspace scoped to `testcar` `computed.add {name: "Diff", formula: "Fast_100h.SIG_A - Sna_800h.SPEED"}` and `computed.add {name: "AbsDiff", formula: "abs(Diff)"}` run, both are added to one window, `computed.update` renames Diff to `Sum` with formula `Fast_100h.SIG_A + Sna_800h.SPEED`, then `computed.remove` of Sum, of AbsDiff, of Sum
- **THEN** after the update Sum and AbsDiff both have new IDs, AbsDiff's formula is `abs(Sum)` and its name `AbsDiff`, both window assignments keep their assignment IDs and colour indexes and name the new IDs; the first remove is refused `computed_in_use` `used by: "AbsDiff"` with the workspace unchanged; the next two succeed and the window is empty
- **Evidence:** `packages/shared/test/computedApply.test.ts` › "keeps nested computed signals live"

#### Scenario: Live reference on real data
- **WHEN** the UI user follows manual checks M2, M4 and M5
- **THEN** M2 saves `abs("DNMOT − PNHV_SupBat_Curr")` named `abs(DNMOT − PNHV_SupBat_Curr)` with a curve ≥ 0; after M4's edit both curves redraw and at cursor A the outer value equals |DNMOT + PNHV_SupBat_Curr| to the shown digits; after M5 the outer's pencil shows `abs(Sum)` and its legend name is unchanged
- **Evidence:** UI check M2, M4, M5 on smart451 (one screenshot each)

#### Scenario: Delete refused on real data
- **WHEN** the UI user follows manual check M6
- **THEN** the error line reads `used by: "abs(DNMOT − PNHV_SupBat_Curr)"` and the row stays; deleting the outer one first, then the inner one removes both
- **Evidence:** UI check M6 on smart451 (screenshot of the error line)

### Requirement: Formula field with completion
A name typed in the formula field SHALL open at most 8 suggestions: matching functions, then signals in the explorer search's ranking (computed ones marked `ƒ`), without the edited signal and its users. ↑/↓ move, Enter or Tab accept, Esc closes only the list; a function goes in as `abs(` with the caret inside; with no list open Enter saves (design F11). Origin: D-106 („type a signal (like in finder) have dropdown"); Esc: D-105 L4; Enter: D-105 L3.

#### Scenario: Token at the caret
- **WHEN** `tokenAt` gets `abs(DNM` at caret 7, `X.A + "DNMOT − P` at caret 16, `MS_312h.DNMOT` at caret 4, `2.5` at caret 3 and `X.A + ` at caret 6
- **THEN** it gives {start 4, end 7, query `DNM`, quoted false}, {start 6, end 16, query `DNMOT − P`, quoted true}, {start 0, end 13, query `MS_3`, quoted false}, none, none
- **Evidence:** `apps/web/test/completion.test.ts` › "finds the token at the caret"

#### Scenario: Suggestions
- **WHEN** `suggestions` runs over an index of `MS_312h.DNMOT`, `MS_1h.MODE` (states), `CPC_508h.PNHV_SupBat_Curr` and the computed `DNMOT − PNHV_SupBat_Curr`, for the tokens `m`, `DNMO`, `DNMO` with the computed one excluded, and the quoted token `ab`
- **THEN** `m` gives `min`, `max`, then the signal rows in `searchSignals(index, "m")` order, 8 rows at most; `DNMO` gives exactly the rows of `searchSignals(index, "DNMO")` (the computed one marked computed); with the exclusion it is absent; the quoted `ab` gives no function; `MS_1h.MODE` carries `disabled` `MODE has states: pick a numeric signal`
- **Evidence:** `apps/web/test/completion.test.ts` › "suggests functions and signals"

#### Scenario: Accept
- **WHEN** `accept` takes `MS_312h.DNMOT` for `abs(DNM` (caret 7), the computed `DNMOT − PNHV_SupBat_Curr` for `X.A + "DNMOT − P` (caret 16), `abs` for `ab` (caret 2) and `abs` for `ab(X.A)` (caret 2)
- **THEN** the results are `abs(MS_312h.DNMOT` caret 17, `X.A + "DNMOT − PNHV_SupBat_Curr"` caret 32, `abs(` caret 4, `abs(X.A)` caret 4
- **Evidence:** `apps/web/test/completion.test.ts` › "accepts a suggestion"

#### Scenario: Type and pick on real data
- **WHEN** the UI user follows manual checks M1, M3 and M10
- **THEN** in M1 the list's first row for `DNMO` equals the explorer search's first row for `DNMO`, Enter writes `MS_312h.DNMOT`, Tab writes `CPC_508h.PNHV_SupBat_Curr`, the name reads `DNMOT − PNHV_SupBat_Curr`, Enter saves and the target window shows its curve; in M3 the pencil shows `MS_312h.DNMOT * 2`; in M10 the first Esc closes only the list and the second the editor
- **Evidence:** UI check M1, M3, M10 on smart451 (one screenshot with the open list, one after Save, one after the first Esc)

### Requirement: Signal names tinted
In the formula field each resolved signal name SHALL be tinted (`--accent-soft`, computed ones `--band`, 3 px radius) and the name of the current error SHALL be underlined in `--error`, without moving any glyph: tints paint backgrounds only, no padding, border or font change (design F11). Origin: lead's point 2 („pill look … if cheap and robust; follow design-language"); no moving glyphs: design-language "Layout never moves".

#### Scenario: Spans
- **WHEN** `highlightSpans` gets `abs("DNMOT − PNHV_SupBat_Curr") + MS_312h.DNMOT - DNMOX` with the names of "Typed names resolve"
- **THEN** it gives exactly {4, 30, computed}, {34, 47, signal}, {50, 55, bad}
- **Evidence:** `apps/web/test/completion.test.ts` › "tints signal names"

#### Scenario: Tints on real data
- **WHEN** the UI user follows manual check M9
- **THEN** the computed name's `mark` has background `--band` (`rgb(241, 245, 249)`), `MS_312h.DNMOT`'s `--accent-soft` (`rgb(224, 242, 254)`), every `mark` has `padding` 0px and sits over its characters in the screenshot
- **Evidence:** UI check M9 on smart451 (screenshot, computed styles)

### Requirement: Formula editor
A `+` in the Computed header, the hint row, a pencil or `F2` SHALL open the editor: the formula field, a live error line naming the bad token's position, name, unit, Save (disabled while an error shows), Cancel, Delete when editing; no pickers, no preset dropdown. A selection SHALL prefill the field in click order (design F12, Q-3), caret at the end. Origin: D-106 („a/b fields gone", „a selection still prefills"); D-104; D-105 L2, L4.

#### Scenario: Prefill from the selection
- **WHEN** `prefill` gets (in click order) `MS_312h.DNMOT` and `CPC_508h.PNHV_SupBat_Curr`; only `MS_312h.DNMOT`; `MS_312h.DNMOT`, `MS_1h.MODE` (states), `CPC_508h.PNHV_SupBat_Curr` and the computed `DNMOT − PNHV_SupBat_Curr`; nothing; nine numeric signals
- **THEN** it gives `MS_312h.DNMOT - CPC_508h.PNHV_SupBat_Curr` caret 41; `abs(MS_312h.DNMOT)` caret 18; `MS_312h.DNMOT + CPC_508h.PNHV_SupBat_Curr + "DNMOT − PNHV_SupBat_Curr"`; the empty formula caret 0; the first eight joined by ` + `
- **Evidence:** `apps/web/test/computedEditor.test.ts` › "prefills from the selection"

#### Scenario: Selection in click order
- **WHEN** with `testcar/Fast_100h.SIG_A` listed before `testcar/Sna_800h.SPEED`, a plain click on SPEED and a toggle click on SIG_A run, then `selectedInClickOrder` and `selectedInOrder`; then a plain click on SPEED and a range click on SIG_A
- **THEN** the first gives `[SPEED, SIG_A]`, the second `[SIG_A, SPEED]`; after the range, `selectedInClickOrder` gives list order `[SIG_A, SPEED]`
- **Evidence:** `apps/web/test/selection.test.ts` › "lists the selection in click order"; UI check M7 (`MS_312h.DNMOT` first although `CPC_508h` is listed above)

#### Scenario: Live error blocks Save
- **WHEN** the editor state (list and definitions of "Typed names resolve", plus c2 `abs(DNMOT − PNHV_SupBat_Curr)` = `abs("DNMOT − PNHV_SupBat_Curr")`) has formula `DNMOT -`, then `DNMOX`, then editing c1 with `"abs(DNMOT − PNHV_SupBat_Curr)" + 1`, then a valid formula with c2's name, then a valid formula with name `MS_312h.DNMOT`
- **THEN** `editorError` gives `Unexpected end at 8`, `Unknown signal "DNMOX" at 1`, `Cycle: "DNMOT − PNHV_SupBat_Curr" → "abs(DNMOT − PNHV_SupBat_Curr)" → "DNMOT − PNHV_SupBat_Curr"`, `Name already used`, `Name used by a signal: MS_312h.DNMOT`; for a valid state it gives none and `canonicalFormula` of `dnmot*2` is `MS_312h.DNMOT * 2`
- **Evidence:** `apps/web/test/computedEditor.test.ts` › "shows the first error and blocks Save"

#### Scenario: Live error on real data
- **WHEN** the UI user follows manual check M8
- **THEN** the error line reads `Unknown signal "DNMOX" at 17`, `DNMOX` is underlined in `--error`, Save is disabled, and the formula field's and error line's boxes are unchanged (±0.5 px) against a valid formula and while the list is open
- **Evidence:** UI check M8 on smart451 (screenshot, the rects)

#### Scenario: Prefill on real data
- **WHEN** the UI user follows manual check M7
- **THEN** two selected rows give `MS_312h.DNMOT - CPC_508h.PNHV_SupBat_Curr` with the caret at the end, one gives `abs(MS_312h.DNMOT)`, three give `X + Y + Z` in click order
- **Evidence:** UI check M7 on smart451 (one screenshot per count)

#### Scenario: One primary in the editor
- **WHEN** the editor is open on smart451
- **THEN** it has exactly one button with background `rgb(15, 23, 42)` (Save), measures 360 px wide, has no `select` and no input picker, its formula field is 82 px tall with `font-size` 12px, and suggestion rows are 22 px tall
- **Evidence:** UI check M9 on smart451 (snippet output, one screenshot)

#### Scenario: State signals not suggested for use
- **WHEN** the suggestion list for `MOD` holds `MS_1h.MODE` (states) and Enter or a click hits that row
- **THEN** the row is drawn in `--disabled` with `title` `MODE has states: pick a numeric signal` and the field is unchanged
- **Evidence:** `apps/web/test/computedEditor.test.ts` › "refuses state signals in the suggestions" (markup)

### Requirement: Chunked bucket scan
On ClickHouse, a computed bucket answer over several inputs SHALL be split into k = min(3, ceil(count / 1,000,000)) chunks when its count is above 1,000,000 input rows and every input has a finite hold limit. The chunks split only at bucket starts, and their scans run in parallel, each through the query queue with the caller's abort. Everything else stays unchunked. Origin: D-110 („probier mal die stückelung“); k ≤ 3 and 1,000,000: design.md C-1, C-2.

#### Scenario: Chunk queries
- **WHEN** the query-counting ClickHouse source with a chunk threshold of 1,000 rows answers a buckets request (count 5,000, `FROM` … `FROM` + 100 s, width 1 s) of `Fast_100h.SIG_A - Fast_100h.SIG_B + Fast_100h.SIG_C` with hold limits of 15 ms each; then the same with no hold limit on `Fast_100h.SIG_C`; then with a count of 50 (raw); then with the default threshold
- **THEN** the first sends 4 queries: the count and 3 scans.
  - Each scan's SQL contains `{cs:Int64}`, and the `cs` values are `FROM`, `FROM` + 33 s and `FROM` + 66 s.
  - The scans for the 2nd and 3rd chunks have `from` = `cs` − 15 ms and the same `sv0`/`ss0`/`st0` as the first.
  - The other three requests send 2 queries each.
- **Evidence:** `apps/server/test/clickhouse.computed.test.ts` › "splits a large bucket scan into chunks", "does not chunk without hold limits, raw or small"

#### Scenario: Each chunk takes a queue slot
- **WHEN** the source of "Chunk queries" (first request) is wrapped by `queuedAdapter` with a `QueryQueue(4)` and `computedSeries` runs through the wrapper
- **THEN** the queue's `run` is called 4 times (the count and 3 scans), never once for the whole call
- **Evidence:** `apps/server/test/queue.test.ts` › "queues each computed query, not the whole call"

### Requirement: Chunks read a bounded lookback
Every chunk after the first SHALL read its inputs from max(`chunkStart − L`, `from`), with L the largest hold limit, keep only rows at `chunkStart` or later, and carry the request's seeds. No chunk reads before `from`. The answer SHALL equal the unchunked one, scoped or not. Origin: D-110; never before `from`: D-078 (a scope's start, Z10); equality: D-109 and design C-3.

#### Scenario: Chunked buckets equal unchunked ones
- **WHEN** against `sdlog.conf_signals`, a ClickHouse source with a chunk threshold of 100 rows and one with the default each answer `Lin.RAMP - Sna.CODE` on `conf-a` over [B, B + 100 s), target 100:
  - (a) with hold limits 30 ms for `Lin.RAMP` and 3 s for `Sna.CODE`, width 10 s (3 chunks split at B + 30 s and B + 60 s)
  - (b) with a hold limit of 500 ms for `Sna.CODE` and 30 ms for `Lin.RAMP`, width 1 s (split at B + 33 s and B + 66 s)
  - (c) with the hold limits of (b) and width 2.5 s. The first split is at B + 32.5 s, between the `Sna.CODE` rows at B + 32 s and B + 33 s, and that chunk's lookback starts exactly at the row at B + 32 s.
- **THEN** in each case both answers are deep-equal bucket arrays.
  - (a) has the values of "Ten buckets of 10 s".
  - In (b), bucket B + 33 s has count 51 and sna 0, and bucket B + 45 s has count 0 and sna 51.
  - In (c), bucket B + 32.5 s has count 103 and sna 0: the row at B + 32.5 s is held exactly 500 ms, then 51 rows from each of B + 33 s and B + 34 s.
- **Evidence:** `apps/server/test/clickhouse.chunks.test.ts` › "chunked buckets equal unchunked ones"

#### Scenario: Lookback stays inside the request
- **WHEN** against `sdlog.conf_signals`, through a client that records each query's parameters, the sources of "Chunked buckets equal unchunked ones" answer `Lin.RAMP - Sna.CODE` on `conf-a` over [B + 20 s, B + 50 s), as a scope starting at B + 20 s would clamp it. Target 100, width 1 s, hold limits 15 s for `Sna.CODE` and 30 ms for `Lin.RAMP`, 3 chunks split at B + 30 s and B + 40 s, so c_1 − L = B + 15 s lies before `from`. Then the query-counting source of "Chunk queries" answers its first request with a hold limit of 40 s on `Fast_100h.SIG_C`.
- **THEN** the chunked and unchunked answers are deep-equal, and bucket B + 45 s has count 0 and sna 100. No scan has a `from` parameter before B + 20 s: the 2nd chunk's is B + 20 s, the 3rd chunk's B + 25 s, and every chunk has the `sv0`/`ss0`/`st0` of the first. In the counting case the 2nd chunk's scan has `from` = `FROM`.
- **Evidence:** `apps/server/test/clickhouse.chunks.test.ts` › "keeps the lookback inside the request"; `apps/server/test/clickhouse.computed.test.ts` › "splits a large bucket scan into chunks"
