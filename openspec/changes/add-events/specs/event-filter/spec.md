## ADDED Requirements

### Requirement: Filter words
An event filter SHALL be a string of terms separated by white space: words naming categories or presets (`faults`, `changes`, `active`, `logger`, `all`, `none` and the others of design F1), `ecu:<value>`, `name:<value>`, `text:<value>`, a quoted phrase, or any other word as text; a leading `-` excludes what a term selects. Keywords and keys are case-insensitive. Origin: D-058 („the filter also needs cli. it needs human way of thinking too"); grammar: design F1, Q3.

#### Scenario: Parsing
- **WHEN** `Faults  BMS`, `all -snapshots -untested`, `changes "circuit open" code:P0AA`, `-ecu:VCU text:active` and `12:30` are parsed
- **THEN** [category faults, text `BMS`]; [category all, not category snapshots, not category untested]; [category changes, text `circuit open`, name `P0AA`]; [not ecu `VCU`, text `active`]; [text `12:30`]
- **Evidence:** `packages/shared/test/eventFilter.test.ts` › "parses words, keys, phrases and exclusions"

#### Scenario: Errors
- **WHEN** `faults "open`, `colour:red`, `ecu:`, `faults - bms`, `ab"c`, a string of 201 characters and one of 21 terms are parsed
- **THEN** each is an error with a message and the character position: unterminated quote at 7, unknown key `colour` at 0 naming `ecu, name, text`, empty value for `ecu` at 0, lone `-` at 7, quote inside a term at 2, longer than 200 characters, more than 20 terms
- **Evidence:** `packages/shared/test/eventFilter.test.ts` › "reports errors with their position"

### Requirement: Filter meaning
An event SHALL pass when its category is selected (union of the category terms, all without one, minus excluded ones), its source equals an `ecu` term if any (case-insensitive), its name starts with a `name` term if any, every text term occurs (case-insensitive) in its source, name, text, detail or previous state, and no excluded term matches. The empty filter SHALL pass every event. Origin: D-058 („by ECU", „changes only"); design F2.

#### Scenario: Matching the test events
- **WHEN** the 18 testcar events are matched against `faults`, `faults ecu:bms`, `changes`, `all -snapshots -untested`, `logger`, `door`, `name:P0C`, `ecu:bms ecu:vcu -faults`, `"circuit open"`, `none` and the empty filter
- **THEN** 5, 5, 2, 12, 2, 5 (the `VCU.door` rows), 3 (`P0CA700`, `P0C7800`, `P0C4600`), 13, 1 (`P180D13`), 0 and 18 events pass
- **Evidence:** `packages/shared/test/eventFilter.test.ts` › "matches events by categories, facets and text"

### Requirement: Filter normal form
The server and the UI SHALL keep a filter in normal form (design F3): terms in the given order, keywords and keys lower case with aliases replaced, text terms bare or quoted, duplicates dropped, single spaces. Parsing the normal form SHALL give the same terms, and normalising it again the same string. Origin: necessary consequence of one filter that UI and CLI both show (D-058).

#### Scenario: Round trip
- **WHEN** `FAULTS  Fault code:P0AA`, `text:active Source:"My ECU"` and `-Snapshot change change` are normalised, and each result parsed and normalised again
- **THEN** `faults name:P0AA`, `"active" ecu:"My ECU"` and `-snapshots changes`; the second normalisation gives the same strings, and every filter of the parsing scenarios parses to equal terms after one round trip
- **Evidence:** `packages/shared/test/eventFilter.test.ts` › "normalises and round-trips"

### Requirement: Filter in words
The UI and the CLI SHALL say in words what a filter shows: the categories (`All events`, `No events`, `All events except …` when at most three are left out, else the list, `faults` and `logger errors` for full presets), then ` · from …`, ` · name starting …`, ` · mentioning “…”` and their negations (design F4). Origin: D-058 („it needs human way of thinking too").

#### Scenario: Descriptions
- **WHEN** `faults changes`, the empty filter, `all -snapshots -untested`, `changes ecu:BMS text:contactor`, `active name:P0AA name:U -coolant` and `none` are described
- **THEN** `Faults and state changes`; `All events`; `All events except untested DTCs and state snapshots`; `State changes · from BMS · mentioning “contactor”`; `Active faults · name starting P0AA or U · not mentioning “coolant”`; `No events`
- **Evidence:** `packages/shared/test/eventFilter.test.ts` › "describes a filter in words"

### Requirement: Presets and chips edit the filter
The UI SHALL offer presets that replace the filter (`Faults & changes`, `Faults`, `Changes`, `Logger`, `Everything`, `Off`) and a chip per category and source that has events or is named in the filter; a chip click SHALL switch it in the string by the toggle rule of design F5. Every preset or chip click SHALL send one `events.setFilter`. Origin: D-058 (filter in human categories, „by ECU").

#### Scenario: Toggles
- **WHEN** in `faults changes` Stored fault is switched off, then on; in `all -logger` Request refused is switched on; in the empty filter ECU BMS is switched off, then on; in `ecu:BMS` ECU VCU is switched on
- **THEN** `faults changes -stored`, then `faults changes`; `all -transport`; `-ecu:BMS`, then the empty filter; `ecu:BMS ecu:VCU`
- **Evidence:** `packages/shared/test/eventFilter.test.ts` › "switches categories and sources in the string"

#### Scenario: Preset in the UI
- **WHEN** on smart451 the user clicks `Logger`, then `Faults & changes`
- **THEN** the field shows `logger`, the heading `4 of 402`, strip and windows show only the two NRC and two ISO-TP marks; then `faults changes` and `55 of 402`; the revision rose by one per click
- **Evidence:** UI check on smart451 at 1440×900 (screenshot after `Logger`, heading and revision after each click)

### Requirement: Filter field
The filter field SHALL hold the workspace filter. While the user types, the description line, the heading count and the list SHALL preview the typed filter (an invalid one shows its error and keeps the last list); Enter SHALL send `events.setFilter` and the field then shows the normal form; Escape or leaving the field SHALL restore the workspace filter. Origin: D-058 (UI and CLI share the filter); preview: design F5.

#### Scenario: Typing and Enter
- **WHEN** on smart451 the field holds `faults changes`, the user appends ` Contactor` and presses Enter; then types `faults "` and presses Escape
- **THEN** while typing the line reads `Faults and state changes · mentioning “contactor”` with the count of matching events; after Enter the field shows `faults changes Contactor`, the revision rose by one; while `faults "` is typed the line shows the unterminated-quote error in the error colour; after Escape the field shows `faults changes Contactor` again
- **Evidence:** UI check on smart451 at 1440×900 (screenshots of the panel)

### Requirement: Filter in the workspace
The workspace SHALL hold one event filter for strip, windows, panel and CLI: `eventFilter` in normal form, absent when it equals the default `faults changes`. `events.setFilter {filter}` (at most 200 characters) SHALL store it normalised with one revision; a filter that does not parse SHALL be rejected with `invalid_filter` and the parser's message. Origin: D-058 („the filter also needs cli"); default: design Q1.

#### Scenario: Set, default and reject
- **WHEN** `events.setFilter` is applied with `Faults  BMS`, then with `faults changes`, then with `ecu:`
- **THEN** the first stores `eventFilter` `faults bms`; the second removes the field; the third is rejected with `invalid_filter` and the workspace stays as before
- **Evidence:** `packages/shared/test/apply.test.ts` › "sets the event filter in normal form"

#### Scenario: Shared with the CLI
- **WHEN** the UI is open on smart451 and `kipscope --wait events filter logger` runs
- **THEN** it exits 0 with `render.status` `complete`, and the panel's field, heading and the marks show the `logger` filter
- **Evidence:** UI check on smart451 (CLI output and screenshot)
