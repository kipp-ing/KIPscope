# Design

## Jan's answers (D-058)

The six open questions are answered in D-058 (last bullet): Q1 default filter `active changes` (on smart451 51 of 402 events: 13 active faults, 22 diag state changes, 16 ignition changes); Q2 the events list is a sidebar tab; Q3 one search-style filter string in UI, CLI and workspace; Q4 ignition is `CPC_168h.IgnCurMode`; Q5 the contactor entry is `BMS.contactor`, used now (the quiet wait for missing signals stays as a general rule); Q6 a snapshot that differs from the previous state counts as a change, marked "seen after a gap". References to Q1–Q6 below point to these answers.

## Context

See proposal.md (Why). Facts that shape the approach (smart451 on carserver, read-only queries as `letsview` through the tunnel, 2026-10-16):

- **`sdlog.events`:** `vehicle, device, chunk, utc DateTime64(3) Nullable, source, kind, name, value Float64, text, detail`, `PARTITION BY vehicle ORDER BY (vehicle, kind, source, name, utc)`. 385 rows, all `source` BMS, device `smart451-diag`, 45 chunks, no null times. Reading all of smart451's rows ordered by time: 25 ms, 40 KB JSON. A missing table answers `Code: 60 … (UNKNOWN_TABLE)`.
- **DTCs:** 55 rows, all at 2026-10-15 05:27:12.135Z, detail `initial` (one readout). Status values: 41 (0x29 = failing now + confirmed + failed since clear) ×12, 105 (0x69 = 0x29 + not tested this cycle) ×1, 40 (0x28 = confirmed + failed since clear) ×4, 64 (0x40) ×2, 80 (0x50 = not tested since clear + not tested this cycle) ×36. The brief's "40 ×2" is ×4 (`P1614FA`, `P1CA100`, `P1CA300`, `P1D0E00`). Texts up to 164 characters.
- **States:** 326 rows of 7 names: 315 with detail `initial` (the decoder's first value per chunk, so one per ~90 s chunk while logging, gaps of days between sessions) and 11 with `from <old>`. Per name in time order: 7 first rows, 11 transitions (each `from` equals the previous text), 11 snapshots whose text differs from the previous one, 297 repeats.
- **NRC / ISO-TP:** 2 × `SID 22` value 49 (0x31) `requestOutOfRange` on 2026-10-14; 2 × `incomplete` (`132 of 403 bytes, then a new message`, `27 of 403 …`).
- **State signals (`sdlog.signals`):** a `text LowCardinality(String) DEFAULT ''` column exists (not read so far). 9 signals carry text (946 rows, all `BMS.*`; finding them: 0.81 s full scan). The catalog has 553 signals, 180 with a `VAL_` table, 74 with a name other than SNA/SNV (some name special codes of numeric signals, e.g. `AC_A1.T_SOLL` `KURZSCHLUSS`); hybrid-can labels read `CLS: Close`.
- **Change queries** (window function `lagInFrame` over one signal, rows only where the value or text changes): IgnCurMode 87 k rows → 17 rows in 0.05 s; KL_15 403 k → 16 in 0.10 s; `MS_312h.DNMOT` 874 k → 1 in 0.19 s; `BS_200h.BLS` 156 rows in 0.10 s. The table is ordered by `(vehicle, signal, utc)`, so one signal is read in time order.
- **Ignition:** `CPC_168h.IgnCurMode` values 0 and 3; 16 changes, the one of 2026-10-15 16:59:05Z after a gap (previous row 2026-10-13 13:17:33Z). `BMS.contactor` value always 0, text `open`/`closed`.
- **Code today:** strip (`apps/web/src/time/`, archived `add-strip-navigation` S5–S10: track 31 px = bars 24 + drive row 7, `hitZone`, `StripGesture`, 55 px); density cache and prefetch (`apps/server/src/density.ts`, `routes/series.ts`); workspace commands in `packages/shared/src/workspace.ts`/`apply.ts` with `ApplyContext {signalExists, unitOf}`; project file `apps/server/src/project.ts` (`display`, `measurement`); CLI tokenizer: `-<digit>` is a value, other single-dash tokens are unknown options; chart headroom `PLOT_HEADROOM = 6` px above the plot area holds nothing over the plot's x range; cursor lines are DOM in `u.over`, SNA lanes are canvas at the plot bottom.

## Goals / Non-Goals

**Goals:** the scenarios of the eight delta specs; every interface between `packages/shared`, `apps/server/src`, `apps/web/src` and `apps/cli/src` pinned below so the areas build in parallel; strip stays 55 px; no query that reads more than the data ref's events or one signal's rows; existing tests green (with the new fields added where they compare whole bodies, and 1,017 → 1,021 signals).

**Non-Goals:** the out-of-scope list of proposal.md; DTC semantics beyond the status byte (no freeze frames, no OBD readiness); a general expression language (no parentheses, no `or` keyword); events of other data refs in one list.

## Decisions

### E1: Mapping (pinned, `apps/server/src/config.ts`)

```ts
export interface EventMapping { table: string; source: string; kind: string; name: string; value: string; text: string; detail: string }
// Config gains:
events: EventMapping;      // database, dataRef and time columns come from `mapping`
// TableMapping gains:
text: string;              // signals table text column (state-names), default "text"
```

Env (all `identifier()`-checked, defaults in brackets): `KIPSCOPE_EVENTS_TABLE` [events], `KIPSCOPE_EVENT_COLUMN_SOURCE` [source], `_KIND` [kind], `_NAME` [name], `_VALUE` [value], `_TEXT` [text], `_DETAIL` [detail]; `KIPSCOPE_COLUMN_TEXT` [text]. A missing table or text column is not a config error: the source answers "none" (E4) and the server warns once per catalog load. `.env.example` lists them commented out.

### E2: DTO (pinned, new `packages/shared/src/events.ts`)

```ts
/** Severity order (most severe first): cluster colour, tooltip order, describe order. */
export const EVENT_CATEGORIES = ["active", "pending", "stored", "change", "refused", "transport", "untested", "passed", "snapshot", "other"] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];
/** Chip and tooltip label, singular and plural noun (describe, tooltips). */
export const CATEGORY_TEXT: Record<EventCategory, { label: string; one: string; many: string }>;
// active  "Active fault"     "active fault"     "active faults"
// pending "Pending fault"    "pending fault"    "pending faults"
// stored  "Stored fault"     "stored fault"     "stored faults"
// change  "State change"     "state change"     "state changes"
// refused "Request refused"  "refused request"  "refused requests"
// transport "Transport error" "transport error" "transport errors"
// untested "Not tested"      "untested DTC"     "untested DTCs"
// passed  "Passed"           "passed DTC"       "passed DTCs"
// snapshot "Snapshot"        "state snapshot"   "state snapshots"
// other   "Other"            "other event"      "other events"

/** One event as the UI and CLI see it. Times decimal ns. */
export interface DiagEvent {
  t: string;
  category: EventCategory;
  /** Source kind as stored (`dtc`, `state`, `nrc`, `isotp`, …), or `signal` for an events-line signal. */
  kind: string;
  /** ECU as stored; for kind `signal` the signal's shown name. */
  source: string;
  /** DTC code, state name, `SID 22`, …; for kind `signal` the signal name. */
  name: string;
  /** Description, state (name), NRC name; "" when none. */
  text: string;
  /** As stored; "" when none. */
  detail: string;
  value: number;
  /** kind `dtc` with a status byte: dtcStatusText(value). */
  status?: string;
  /** category `change`: the previous state and the time it was last seen. */
  from?: { text: string; t: string };
  /** category `change` seen after a gap (E6, E7). */
  inferred?: true;
  /** kind `signal`. */
  signalId?: string;
}

export type SkipReason = "not_in_catalog" | "no_states" | "too_many_changes" | "in_events_table";

/** Body of GET /api/events. */
export interface EventList {
  dataRef: string;
  /** Events in [from, to) (all when no range) before the filter. */
  total: number;
  counts: Partial<Record<EventCategory, number>>;
  /** By count descending, then name. */
  sources: { source: string; count: number }[];
  /** Normal form of the applied filter; absent when none was given. */
  filter?: string;
  /** Passing events, time order (ties: kind, source, name). */
  events: DiagEvent[];
  skipped: { signalId: string; reason: SkipReason }[];
  /** The data ref held more than MAX_EVENTS table events. */
  truncated?: true;
}

export const MAX_EVENTS = 100_000;
export const MAX_SIGNAL_CHANGES = 2_000;
/** A change after more than this without rows is inferred (E7), ns: 5 min. */
export const STATE_GAP = 300_000_000_000n;

/** Input row of deriveEvents (from the source, times decimal ns). */
export interface EventRow { t: string; source: string; kind: string; name: string; value: number; text: string; detail: string }
export function dtcCategory(value: number): EventCategory;
export function dtcStatusText(value: number): string | undefined;
/** Rows in time order → events (E5, E6); pure. */
export function deriveEvents(rows: readonly EventRow[]): DiagEvent[];
/** One signal's changed rows (E7) → events; pure. */
export interface StateRow { t: string; value: number; text: string; prev?: { t: string; value: number; text: string } }
export function signalEvents(info: SignalInfo, rows: readonly StateRow[]): DiagEvent[];
/** Merge in time order with the tie rule; pure. */
export function mergeEvents(...lists: readonly DiagEvent[][]): DiagEvent[];
```

### E3: Server (pinned, new `apps/server/src/events.ts`, `routes/events.ts`)

- `EventsCache` (like `DensityCache`): `table(dataRef)` → `{ events: DiagEvent[]; truncated: boolean; names: Set<string> }` (the `state` names, for `in_events_table`) and `signal(signalId)` → `DiagEvent[] | SkipReason`, each keyed with `catalog.loadedAt`; concurrent calls share one promise; a rejected promise is dropped. `prefetch(dataRefs, signals, warn)` runs them one after another and stops when a newer catalog load started.
- Route `GET /api/events`: query `dataRef` (required), `signal` (string or array), `filter`, `from`, `to` (`TimeInput`, both or neither, `to > from`). 404 `unknown_data_ref` as `/api/density` (catalog loaded and no signal of that ref). Signals of another data ref are ignored; a signal not in the catalog → `not_in_catalog`; without `states` → `no_states`; name in `table.names` → `in_events_table`. Then `mergeEvents`, the range, `total`/`counts`/`sources` from the merged list in range, then the filter (`compileEventFilter`). Errors: invalid filter → 400 `invalid_filter`; source failure → 502 `source_error` (nothing cached).
- Prefetch: a second `catalog.onLoaded` subscription in `routes/events.ts` prefetches every data ref's table events, then the workspace's start `eventSignals` (from the project file). It does not wait for, or delay, the density prefetch (both go through the query queue).
- Warnings, once per catalog load: missing events table; each listed signal not in the catalog (`events line: <id> is not in the catalog yet; it shows once recorded`) or without states.
- **Cap:** `LIMIT MAX_EVENTS + 1` on the table query; one more row than the cap → keep MAX_EVENTS, `truncated`.

### E4: Data source (pinned, `apps/server/src/datasource.ts`, `clickhouse.ts`)

```ts
interface DataSource {
  // …existing…
  /** The data ref's event rows with a time, time order (ties kind, source, name), at most `limit`; undefined when the events table does not exist. */
  events(dataRef: string, limit: number, abort?: AbortSignal): Promise<EventRow[] | undefined>;
  /** Rows of one signal (SNA left out) where the state changes, plus its first row; at most `limit` rows (E7). */
  stateChanges(ref: SeriesRef, by: { kind: "text" } | { kind: "labels"; values: number[]; tolerance: number }, limit: number, abort?: AbortSignal): Promise<StateRow[]>;
  /** Signals with non-empty text (one query); [] when the text column does not exist. */
  textSignals(abort?: AbortSignal): Promise<SignalRef[]>;
}
// RawPoint gains `text?: string` (raw, before, after) for signals the caller marks as text signals.
```

Events query (ClickHouse, identifiers from the mapping, values as parameters):

```sql
SELECT toString(toUnixTimestamp64Nano(utc)), source, kind, name, value, text, detail
FROM sdlog.events WHERE vehicle = {ref:String} AND utc IS NOT NULL
ORDER BY utc, kind, source, name LIMIT {limit:UInt32}
```

An `UNKNOWN_TABLE` error (code 60) → `undefined`; any other error rejects. `textSignals`: `SELECT DISTINCT vehicle, signal FROM sdlog.signals WHERE text != ''` (`UNKNOWN_IDENTIFIER`, code 47 → `[]`).

### E5: DTC categories and status (pinned, `events.ts`)

`dtcCategory(v)`: not an integer in 0…255 → `other`; `v & 0x01` → `active`; `v & 0x06` → `pending`; `v & 0xA8` → `stored`; `v & 0x50` → `untested`; else `passed`. Bits (ISO 14229-1 DTC status): 0x01 testFailed "failing now", 0x02 testFailedThisOperationCycle "failed this cycle", 0x04 pendingDTC "pending", 0x08 confirmedDTC "confirmed", 0x10 testNotCompletedSinceLastClear "not tested since clear", 0x20 testFailedSinceLastClear "failed since clear", 0x40 testNotCompletedThisOperationCycle "not tested this cycle", 0x80 warningIndicatorRequested "warning lamp". `dtcStatusText` = `0x` + two upper-case hex digits, then ` ` + the set bits' names joined by ` · ` (none: just `0x00`); undefined for a value outside 0…255.

**Why this order:** "failing now" beats everything (12 + 1 on smart451, the one with 0x40 too: the last completed test failed); pending before stored because a pending fault is the fresher news; "not tested" only when nothing failed (38 on smart451: noise to a person, kept as its own category for whoever needs it). 0x80 without 0x08 counts as stored: the lamp is on.

### E6: State rows (pinned, `deriveEvents`)

Walk the rows in time order keeping `last: Map<source + "\u0000" + name, {text, t}>`. Kind `state`: if `detail` starts with `from ` → `change`, `from = { text: detail.slice(5), t: last?.t ?? t }`; else if `last` exists and `last.text !== text` → `change`, `inferred`, `from = last`; else `snapshot`. Then `last = {text, t}`. Kind `dtc` → `dtcCategory`, `status`; `nrc` → `refused`; `isotp` → `transport`; else `other`. (smart451 replay: 7 + 297 snapshots, 11 + 11 changes; every `from` text equals the previous text.)

### E7: Signal changes (pinned, `clickhouse.ts` `stateChanges`, `events.ts` `signalEvents`)

```sql
SELECT toString(toUnixTimestamp64Nano(utc)), value, text,
       if(rn = 1, '', toString(toUnixTimestamp64Nano(pt))), pv, ptext
FROM (
  SELECT utc, value, text,
         lagInFrame(utc) OVER w AS pt, lagInFrame(value) OVER w AS pv, lagInFrame(text) OVER w AS ptext,
         row_number() OVER w AS rn
  FROM sdlog.signals
  WHERE vehicle = {ref:String} AND signal = {sig:String} AND utc IS NOT NULL AND NOT <isSna>
  WINDOW w AS (ORDER BY utc ROWS BETWEEN 1 PRECEDING AND CURRENT ROW)
)
WHERE rn = 1 OR <changed>
ORDER BY utc LIMIT {limit:UInt32}
```

`<isSna>`: the existing SNA predicate of the ref; `<changed>` for text: `text != ptext`; for labels: `abs(value - pv) > {tol:Float64} AND (arrayExists(l -> abs(value - l) <= {tol:Float64}, {labels:Array(Float64)}) OR arrayExists(l -> abs(pv - l) <= {tol:Float64}, {labels:Array(Float64)}))`, labels = the values of `valueLabels(info)` that are not SNA, tol = |factor| / 2 (0.5 without factor). Limit = MAX_SIGNAL_CHANGES + 2; more than MAX_SIGNAL_CHANGES + 1 rows → `too_many_changes`.

`signalEvents`: the first row → `snapshot`; each other → `change`, `from = prev` (text: the state name of `prev`), `inferred` when `t − prev.t > STATE_GAP`; `kind: "signal"`, `source: shownName(info)`, `name: info.name`, `text`: state name of the row (N2, whole label), `value`, `signalId`.

**Why only changed rows, and why 5 min:** the change query returns ~17 rows for a 10 Hz signal over 5 days in 0.05–0.19 s, so nothing large crosses the wire or sits in server memory, and ClickHouse reads one signal in key order. The gap: smart451's diag chunks are ~90 s apart while logging and its CAN signals 0.1 s; a pause of more than 5 min means the logger was off, so the change happened somewhere in between.

### E8: Workspace (pinned, `packages/shared/src/workspace.ts`, `apply.ts`)

```ts
// Workspace gains (both absent by default, so existing whole-body tests stay green):
eventFilter?: string;    // normal form; absent = DEFAULT_EVENT_FILTER
eventSignals?: string[]; // signal IDs in order, ≤ MAX_EVENT_SIGNALS; absent when empty
export const MAX_EVENT_SIGNALS = 8;
// Commands:
{ type: "events.setFilter"; filter: string /* ≤ MAX_FILTER_LENGTH */ }
{ type: "events.addSignal"; signalId: Id }
{ type: "events.removeSignal"; signalId: Id }
// CommandErrorCode gains: "invalid_filter" | "not_state_signal" | "already_listed" | "event_signal_limit" | "not_listed"
// ApplyContext gains:
hasStates(signalId: string): boolean;   // catalog: SignalInfo.states present
```

`events.setFilter`: `parseEventFilter`; error → `invalid_filter` with its message; else `formatEventFilter`, the field removed when equal to `DEFAULT_EVENT_FILTER`. `events.addSignal`: order of checks `unknown_signal` (`!signalExists`), `not_state_signal`, `already_listed`, `event_signal_limit`. Start value: `main.ts` puts the project file's `events.signals` into the initial workspace, unchecked (the catalog is not loaded yet; a missing signal waits, spec "Waiting signals").

### E9: Project file (pinned, `apps/server/src/project.ts`)

```yaml
events:
  # Signals whose state changes are on the events line from the start (D-059); a signal not recorded yet waits.
  signals:
    - smart451/CPC_168h.IgnCurMode   # ignition (D-058, Q4)
    - smart451/BMS.contactor         # HV contactor (D-058, Q5)
```

`ProjectFile.events?: { signals: string[] }`; `events` a map with only `signals`; `signals` a list of at most 8 strings that `parseSignalId` accepts. Problems as for `measurement`.

### F1: Filter grammar (pinned, new `packages/shared/src/eventFilter.ts`)

```
filter := { ws } [ term { ws { ws } term } ] { ws }
term   := [ "-" ] ( key ":" value | quoted | word )
key    := letters, case-insensitive: ecu | source | name | code | text
value  := quoted | word
quoted := '"' { any char but '"' } '"'          (at least one char)
word   := { any char but white space and '"' }    (at least one char)
```

A bare token is keyed only when the part before its first `:` is letters only; then an unknown key is an error. A bare `word` (not quoted, not keyed) that equals a keyword (case-insensitive) is a category term, else a text term. Keywords → canonical: `faults`/`fault`, `active`, `pending`, `stored`, `untested`, `passed`, `changes`/`change`, `snapshots`/`snapshot`, `refused`/`nrc`, `transport`/`isotp`, `logger`, `other`, `all`/`everything`, `none`. Presets: `faults` = active, pending, stored; `logger` = refused, transport; `all` = every category; `none` = none. Keys → canonical: `ecu`/`source`, `name`/`code`, `text`.

```ts
export const DEFAULT_EVENT_FILTER = "active changes";
export const MAX_FILTER_LENGTH = 200;
export const MAX_FILTER_TERMS = 20;
export type CategoryWord = "faults" | "active" | "pending" | "stored" | "untested" | "passed" | "changes" | "snapshots" | "refused" | "transport" | "logger" | "other" | "all" | "none";
export type FilterTerm =
  | { neg: boolean; kind: "category"; word: CategoryWord }
  | { neg: boolean; kind: "ecu" | "name" | "text"; value: string };
export interface EventFilter { terms: FilterTerm[] }
export function parseEventFilter(text: string): { ok: true; filter: EventFilter } | { ok: false; message: string; at: number };
export function formatEventFilter(f: EventFilter): string;           // F3
export function categoriesOf(f: EventFilter): Set<EventCategory>;    // F2
export function compileEventFilter(f: EventFilter): (e: DiagEvent) => boolean;  // F2
export function describeEventFilter(f: EventFilter): string;         // F4
export const EVENT_PRESETS: readonly { label: string; filter: string }[];  // F5
export function toggleCategory(f: EventFilter, c: EventCategory, on: boolean): EventFilter;  // F5
export function toggleSource(f: EventFilter, source: string, on: boolean): EventFilter;      // F5
```

Errors (message, `at` = character index): `unterminated quote` (at the quote), `unknown key "<k>" (keys: ecu, name, text)` (at the token), `empty value for <key>` (at the token), `lone "-"` (at the dash), `quote inside a term` (at the quote), `filter longer than 200 characters` (at 200), `more than 20 terms` (at the 21st). Length is checked first.

**Why this grammar (Q3):** it is the search-box convention people already know (words narrow, `-` excludes, quotes for phrases, `key:value` for precision), it is one line in a terminal, and the UI's buttons only write it, so the field always shows exactly what the CLI would type. Unknown words are text, so `faults bms` works without knowing that `bms` is a source. Quoting (or `text:`) escapes a keyword: `"active"` searches the word. Rejected: `and`/`or`/parentheses (the facet rule F2 covers what people ask for; nobody types boolean algebra into a timeline); `!` for negation (zsh history expansion).

### F2: Meaning (pinned)

`categoriesOf`: positive category terms' union, or every category when there is none; minus the negative category terms' union. `compileEventFilter(f)(e)`: `cats.has(e.category)` and (no positive `ecu` or `e.source` equals one, case-insensitive) and no negative `ecu` equals it; same for `name` with "starts with"; every positive text term is a case-insensitive substring of `[source, name, text, detail, from?.text].join("\n")` and no negative one is. Case folding: `toLowerCase()` (no locale). The terms of one kind widen and kinds narrow (faceted search); text terms narrow each other (search engine).

### F3: Normal form (pinned)

Per term in input order: `-` if negated; category → canonical keyword; `ecu:`/`name:` + value (quoted `"…"` if it holds white space); text → bare when it matches `^[^\s"\-][^\s":]*$` and is not a keyword, else `"…"`. Drop a term equal (same string) to an earlier one. Join with one space. Empty filter → `""`.

### F4: Description (pinned)

Categories `S = categoriesOf(f)`: all → `All events`; empty → `No events`; |complement| ≤ 3 → `All events except ` + list(complement); else list(S). list(): in `EVENT_CATEGORIES` order, with `faults` replacing active + pending + stored when all three are in, `logger errors` replacing refused + transport, each else by `CATEGORY_TEXT.many`; joined `a`, `a and b`, `a, b and c`; first letter upper case. Then, in this order, for each kind with terms: ` · from X or Y` (ecu), ` · not from X or Y`, ` · name starting X or Y`, ` · name not starting X or Y`, ` · mentioning “x” and “y”`, ` · not mentioning “x” or “y”`. Values as written in the normal form without quotes.

### F5: Presets, chips and the field (pinned)

`EVENT_PRESETS`: `Active & changes` → `active changes`, `Faults` → `faults`, `Changes` → `changes`, `Logger` → `logger`, `Everything` → `all`, `Off` → `none`; a preset button is pressed when the normal form equals its filter.

`toggleCategory(f, c, on)`: on: every negative category term whose set holds `c` is removed and the other members of its set are appended as negative terms; then if `c ∉ categoriesOf` a positive `c` word (`changes`/`snapshots` for change/snapshot) is appended. Off: a positive term whose set is exactly `{c}` is removed; then if `c ∈ categoriesOf` a negative `c` term is appended. `toggleSource(f, s, on)`: on: remove `-ecu:s`; if s does not pass the ecu facet now, append `ecu:s`. Off: remove `ecu:s`; if s still passes, append `-ecu:s` (compare case-insensitive). The result is normalised.

Chips: one per category with `counts[c] > 0` or named in the filter, in `EVENT_CATEGORIES` order, label `CATEGORY_TEXT.label` and the count before the filter, pressed when `c ∈ categoriesOf`; one per source of `sources` (and per source named), pressed when it passes the ecu facet. Field: typing previews locally (description, count, list) with `parseEventFilter`; Enter sends `events.setFilter` with the text; Escape and blur restore `eventFilter ?? DEFAULT_EVENT_FILTER`.

### N1: Signals with states (pinned, `packages/shared/src/signals.ts`, `apps/server/src/dbc.ts`, `catalog.ts`)

```ts
// DbcValueLabel gains:
/** Physical value: raw (two's complement if the signal is signed) × factor + offset, as SnaValue.value (D-012). */
value: number;
// SignalInfo gains:
/** "labels": a named value that is not SNA (VAL_ or diag enum, D-061); "text": rows carry text (D-059). Absent: no states. */
states?: "labels" | "text";
```

The catalog load runs `textSignals()` after `listSignals()` (one query, ~0.8 s on carserver, once per load); `states = "text"` wins over `"labels"`. **Diag enums (D-061):** `add-diag-metadata` carries the diagnostic catalog's enum names and invalid sentinels on `SignalInfo` (field names pinned there, not here). This change only reads them: `valueLabels(info)` (N2) merges the `VAL_` entries and the diag enum entries into one list of `{ value, label }` (physical values), and the invalid sentinels are SNA codes as that change defines. How they are loaded is out of this change. Catalog order and search are unchanged.

### N2: State names (pinned, new `packages/shared/src/states.ts`)

```ts
/** The label (whole) from valueLabels of a valid value: |value − label.value| ≤ |factor| / 2 (0.5 without factor), labels on SNA codes skipped; undefined when none. Pure. */
/** VAL_ entries (physical value) and add-diag-metadata's enum entries of a signal as one list; pure. */
export function valueLabels(info: SignalInfo): { value: number; label: string }[];
export function stateLabel(info: SignalInfo, value: number): string | undefined;
/** "CODE: words" → "CODE" when CODE matches ^[A-Z0-9_]+$; else the label. */
export function shortLabel(label: string): string;
```

Text signals: the label is the row's text (server: `RawPoint.text`; client: `RawSeries.text`, `EdgePoint.label`).

### N3: Readouts and values (pinned)

```ts
// packages/shared/src/cursor.ts: CursorValue raw and held gain `label?: string` (whole label); evaluateAt gains an optional
// `named?: (p: Point) => boolean`: in line mode, when at or next is named, the result is held.
// packages/shared/src/series.ts:
EdgePoint.label?: string;   // text signals
RawSeries.text?: string[];  // text signals, one per point
```

Server: `/api/value` evaluates with `named` = has a state name, adds `label`; text signals read `text` in before/after. `/api/series` adds `text` to raw series of text signals (buckets unchanged). Web: `formatCell`/`readoutCell` show `shortLabel(label)` as `text`, title `<label> · <number with unit>`; `deltaCell`: `=`/`≠` (compare numbers within tolerance, text for text signals) when either side has a label. L from drawn data: raw point → its label; bucket → label when min and max have the same label, else number.

**Why label only:** the cells are narrow (legend) and the person asked for the name (`OFF`); the number stays one hover away and in the CLI's JSON.

### V1: Colours (pinned, `apps/web/src/styles.css`)

`--ev-fault: #be123c` (= `--error`; active, pending), `--ev-stored: #b45309` (amber-700), `--ev-change: #7c3aed` (violet-600), `--ev-info: #64748b` (= `--muted`; all others). Each has at least 4.5:1 on white; violet is outside the series palette and the sky accent; amber-700 is darker than the SNA fill (`#f59e0b`, a band, not a line). The chart draws on canvas with these hex values (as `GRID_STROKE`).

### V2: Grouping (pinned, new `apps/web/src/events/marks.ts`, pure)

```ts
export const GROUP_PX = 6;     // events less than this from a group's first event join it
export const PIN_H = 6;        // pin and glyph height
export const PIN_W = 3;        // one event
export const PIN_W_MANY = 5;   // several
export const PIN_HIT_PX = 8;   // minimum hit width
export const PIN_LANE_PX = 8;  // strip: y < this is the pin lane for hits
export interface Mark { x0: number; x1: number; events: DiagEvent[]; category: EventCategory; drawn: Rect; hit: Rect }
/** xs sorted with the events in time order; events with x outside [0, px] dropped; pure. */
export function groupMarks(events: readonly DiagEvent[], xOf: (t: bigint) => number, px: number): Mark[];
export function markColor(c: EventCategory): string;   // V1
export function markTitle(m: Mark): string;            // V4
```

`drawn`: centre `(x0 + x1) / 2`, width `max(events.length > 1 ? PIN_W_MANY : PIN_W, x1 − x0 + PIN_W)`; `hit`: drawn widened about its centre to at least `PIN_HIT_PX`. `category`: the first of `EVENT_CATEGORIES` present.

### V3: Strip pins (pinned, `time/TimeStrip.tsx`, `stripGeometry.ts`, `strip.css`)

`div.time-strip-pins` absolute over the track, top 0, height 6 px, `pointer-events: none`, drawn after the bars and before the window (so window, brush and markers lie on top); one `span.time-strip-pin` per mark (left/width from `drawn`, background `markColor`, radius 1 px, 1 px `var(--panel)` outline). Zones: `Zone` gains `{ kind: "pin"; index: number }`, `hitZone(tr, x, y, range, drives, pins: readonly Rect[])` checks first: `y < PIN_LANE_PX` and x in a pin's `hit` (nearest centre on overlap, the earlier pin on a tie). `StripAction` gains `{ kind: "centre"; pin: number }`: a click on a pin; a drag from a pin brushes. 

```ts
/** stripGeometry.ts: from = t − span / 2, to = from + span (exact, no snapping). */
export function centreRange(view: Range, t: bigint): Range;
```

App: the strip's `navigate` with `push = true`; the pin's first event time. The pin's tooltip lives on a transparent hit span in the lane (`pointer-events: auto`, like the drive hit spans), so bars keep theirs elsewhere. The strip's markers, window and brush are unchanged; pins are computed from the strip's shown events of `stripDataRef(ws)`.

### V4: Tooltips (pinned, `markTitle`)

One event: line 1 `<formatFull(t) to the ms> · <label> · <source> <name>`; line 2 the text, for a change `<from.text> → <text>`; line 3 for a DTC `Status <status>`, for an inferred change `seen after a gap; last seen <from.text> at <formatFull(from.t)>`. Several: line 1 `<n> events · ` + per present category in order `<count> <one|many>` joined `, `; then per event (at most 8) `<time> <label> <name> <text cut to 60 characters with …>`; then `… and <k> more` when more. Local time as the window header (`time/axis.ts`).

### V5: Strip head count (pinned)

`button.time-strip-events` after `.time-strip-range`, `flex: none`, height 16 px, 11 px, muted text, pill radius, `<shown> of <total> events` (en-US thousands commas). Click: App opens the sidebar on Events and focuses the field (the same function as key `e`). Absent while the events of the strip's data ref load or when `total` is 0. The range and info keep their ellipsis; the head's 16 px stay.

### V6: Chart marks (pinned, `chart/TimeseriesWindow.tsx`)

Props gain `events?: readonly DiagEvent[]` (the shown events of the window's data refs, from App). A `drawAxes` hook (before the series) draws per mark a 1 px line at the centre of each event's x over `u.bbox` in `markColor`, `globalAlpha = 0.5`, dash `[]` faults (active, pending, stored), `[4, 3]` change, `[1, 3]` others. Glyphs are DOM: `div.event-glyphs` absolutely positioned over the 6 px headroom (`top = bbox.top / dpr − PLOT_HEADROOM`), one `span.event-glyph` per mark (`groupMarks` with the plot's `valToPos`), `title` = `markTitle`, hit extends 4 px down into the plot. Lines and glyphs are recomputed on every redraw (zoom previews included), as the SNA lanes. Nothing changes the plot height.

### V7: Glyph click (pinned)

`pointerdown` on a glyph stops propagation (no zoom selection, no signal drag); `click` sends `cursor.set {cursor: shiftKey ? "b" : "a", t: mark.events[0].t}` at once (no ClickGate: a glyph has no double-click meaning).

### V8: Events panel (pinned, new `apps/web/src/events/EventsPanel.tsx`, `events.css`)

```
[ Signals | Events ]                      segmented switch, 26 px (sidebar head)
EVENTS                       51 of 402    11 px caps label; count muted, tabular
[ active changes                       ]  mono field, 26 px; invalid: error border
Active faults and state changes           muted 11 px line, or the error in --error
(Active & changes)(Faults)(Changes)(Logger)(Everything)(Off)   pills, wrap
● Active fault 13  ○ Stored fault 4  ○ Not tested 38 …         chips, wrap
● BMS 385  ● IgnCurMode 17                                     ECU chips
ON THE EVENTS LINE   IgnCurMode ×   BMS.contactor ×            muted: "· not recorded yet"
── Thu 2026-10-15 ───────────────────────────────────────        day band (explorer group look)
▮ 07:27:12.135  BMS P0CA700                                     row line 1 (glyph in category colour)
  The discharge current of the high-volt…                       row line 2, muted, ellipsis, title = whole
```

Rows: at most `MAX_LIST_ROWS = 500`, then `<k> more — narrow the filter`; pure helpers in new `events/list.ts`: `listRows(events, max = MAX_LIST_ROWS): { rows: DiagEvent[]; more: number }` and `dayBands(rows): { day: string; rows: DiagEvent[] }[]` (local date, `formatDate` of `time/axis.ts`). Day bands by local date. Accent left border (2 px) when `range.from ≤ t < range.to` of the bar target. Click: App `navigate(target, centreRange(view, t), true)`. The panel reads one `EventList` (all events of `stripDataRef(ws)` with the workspace's `eventSignals` of that ref, no filter) through `events/eventsData.ts`; chips and list use `compileEventFilter` locally. The ECU chip of a signal source shows its shown name; a listed signal in `skipped` with `not_in_catalog` is muted with `· not recorded yet`, `no_states`/`too_many_changes` with that reason. `×` sends `events.removeSignal`.

### V9: Data in the web (pinned, new `apps/web/src/events/eventsData.ts`)

```ts
/** GET /api/events for a data ref and its events-line signals, no filter; cached per page life by key `${dataRef}|${signals.join(",")}`; failures retried after 30 s like the density. */
export function useEvents(dataRef: string | undefined, signals: readonly string[]): EventList | undefined;
/** The shown events: compileEventFilter(parse(ws.eventFilter ?? DEFAULT)) over list.events. */
export function shownEvents(list: EventList | undefined, filter: string): DiagEvent[];
```

App computes the shown events per data ref once per revision and passes them to the strip, each timeseries window (the union over its signals' data refs) and the panel. `api.ts` gains `fetchEvents(dataRef, signals, abort)`.

### V10: Drop on the strip (pinned, `chart/drag.ts`, `TimeStrip.tsx`)

`DropTarget` gains `{ kind: "events" }`; `data-drop="events"` on `.time-strip`; pure `eventsDrop(info: SignalInfo | undefined, ws: Workspace): { ok: true } | { ok: false; reason: "no_states" | "already_listed" }` in `drag.ts`. Allowed when the dragged signal's `SignalInfo.states` is present and it is not in `eventSignals`; else refused with reason `no_states` or `already_listed` (the refused style of the windows, `timeseries-window` "Refused drop targets"). While a drag hovers it, the head shows the text of the spec in place of the range. Drop: `events.addSignal`.

### V11: Sidebar part and key e (pinned, `layout/sidebar.ts`, `keys.ts`, `App.tsx`)

```ts
export type SidebarPart = "signals" | "events";
export const SIDEBAR_PART_KEY = "kipscope.sidebarPart";
export function loadSidebarPart(storage): SidebarPart;   // unknown, missing, throwing → "signals"
export function saveSidebarPart(storage, part): void;    // never throws
export function isEventsKey(e, focused): boolean;        // "e", no Ctrl/Meta/Alt, not in text field or select
```

### C1: CLI (pinned, `apps/cli/src`)

- Tokenizer: a token `-` + one char other than `-` is positional unless it is `-h` (`/^-[^-]/` and not `-h`); the existing `-<digit>` case is part of it.
- Forms: `events list [FILTER…] [--ref R] [--from T --to T] [--table]`, `events filter FILTER…` (at least one word; `""` allowed), `events add SIGNAL`, `events remove SIGNAL`. New options `--ref` (value), `--table` (flag); `--from`/`--to` as for `window create`.
- `events list`: reads the workspace, resolves the data ref, `GET /api/events` with `signal` = the workspace's `eventSignals` of that ref, `filter` = the words joined by one space (none: `eventFilter ?? DEFAULT_EVENT_FILTER`), range. `data` = the body plus `description`; `local.t` = `formatLocal` of each event's `t`. Server 404 → rejected `unknown_data_ref`; 400 `invalid_filter` → rejected.
- `--table` (success only): columns local time (`formatLocal`), `CATEGORY_TEXT.label`, source, name, text (change: `<from> → <to>`), padded to the widest cell, two spaces apart, trailing spaces trimmed; then `<n> of <total> events · <filter> · <description>`; then `skipped: <id> (<reason>)` lines.
- Usage text: the four forms and `FILTER   words: active changes faults … all none; ecu:X name:X text:X "phrase"; -term excludes`.

### T: Test data (pinned, `apps/server/scripts/seed-test-db.ts`, `apps/server/test/fixtures/test-a.dbc`; tester)

Signals table gains `text LowCardinality(String) DEFAULT ''` (both tables). New `sdlog.events` with carserver's schema (`ORDER BY (vehicle, kind, source, name, utc)`, `allow_nullable_key`). Times after B = 2026-10-01T00:00:00Z.

Events (vehicle `testcar`, device `test-diag`, chunk `e1`):

| # | time | source | kind | name | value | text | detail | category |
|---|---|---|---|---|---|---|---|---|
| 1 | 05:00:00 | BMS | dtc | P0CA700 | 41 | Discharge current too high | initial | active |
| 2 | 05:00:00 | BMS | dtc | P180D13 | 105 | System shutoff. Circuit Open | initial | active |
| 3 | 05:00:00 | BMS | dtc | P0C7800 | 36 | Precharge too long | initial | pending |
| 4 | 05:00:00 | BMS | dtc | P1CA100 | 40 | Insulation fault, open contactors | initial | stored |
| 5 | 05:00:00 | BMS | dtc | U019B00 | 128 | Communication with on-board charger | initial | stored |
| 6 | 05:00:00 | BMS | dtc | P0C4600 | 80 | Coolant temperature sensor sporadic | initial | untested |
| 7 | 05:00:00 | BMS | dtc | P0AA100 | 64 | Positive contactor jammed closed | initial | untested |
| 8 | 05:00:00 | BMS | dtc | P0E1A00 | 0 | Coolant pump B open circuit | initial | passed |
| 9 | 05:00:00 | BMS | dtc | P0FFF00 | 3.5 | Odd status | initial | other |
| 10 | 01:00:00 | VCU | state | VCU.door | 0 | closed | initial | snapshot |
| 11 | 01:01:30 | VCU | state | VCU.door | 0 | closed | initial | snapshot |
| 12 | 01:03:00 | VCU | state | VCU.door | 0 | open | from closed | change |
| 13 | 01:04:30 | VCU | state | VCU.door | 0 | open | initial | snapshot |
| 14 | 02:00:00 | VCU | state | VCU.door | 0 | closed | initial | change (inferred) |
| 15 | 02:00:00 | VCU | state | DIAG.lock | 0 | locked | initial | snapshot |
| 16 | 03:00:00 | BMS | nrc | SID 22 | 49 | requestOutOfRange | | refused |
| 17 | 03:00:01 | BMS | isotp | incomplete | 132 | | 132 of 403 bytes, then a new message | transport |
| 18 | 04:00:00 | VCU | note | boot | 0 | logger restarted | | other |
| 19 | null | BMS | dtc | P0NULL0 | 41 | | initial | (never returned) |

Totals: 18; BMS 11, VCU 7; active 2, pending 1, stored 2, untested 2, passed 1, change 2, snapshot 4, refused 1, transport 1, other 2.

Signals (`testcar`, chunk `c11`):

| Signal | Rows | Values |
|---|---|---|
| `Ign_A20h.MODE` | every 100 ms in [01:00, 02:30) and [02:45, 03:00) (63,000) | 0 in [01:00, 01:10); 3 in [01:10, 01:40); 15 (SNA) in [01:40:00, 01:40:01); 3 in [01:40:01, 02:00); 0 in [02:00, 02:30); 3 in [02:45, 03:00) |
| `Tmp_A21h.TEMP` | every 1 s in [01:00:00, 01:10:00) (600) | n = 0…599: 20 + n % 10 for n < 300; 254 for 300 ≤ n < 310; 25 after |
| `DIAG.door` | 01:00:00, 01:01:30, 01:03:00, 01:04:30, 02:00:00 | value 0, text closed, closed, open, open, closed |
| `DIAG.lock` | 02:00:00, 02:01:30 | value 0, text locked |

`test-a.dbc` gains `BO_ 2592 Ign_A20h: 8 VCU` with `SG_ MODE : 0|4@1+ (1,0) [0|15] "" VCU` and `VAL_ 2592 MODE 0 "NONE" 1 "CHARGE" 3 "KEYON: Ignition on" 15 "SNA" ;`; `BO_ 2593 Tmp_A21h: 8 VCU` with `SG_ TEMP : 0|8@1+ (1,0) [0|255] "degC" VCU` and `VAL_ 2593 TEMP 254 "SENSOR_DEF" 255 "SNA" ;`. Catalog: 1,017 → 1,021 signals. `globalSetup.ts` checks the newest seed data (`SELECT count() FROM sdlog.events` = 19) to catch a stale test DB. The seed's header comment lists the new data.

## Numbers: what if off by a factor of two

- **MAX_EVENTS 100,000** (smart451: 385): 50 k / 200 k both 130–520× above today; at 200 k the server holds ~60 MB of events per data ref and the browser downloads ~40 MB once (then filter or narrow the range). The cap only guards against a runaway table.
- **MAX_SIGNAL_CHANGES 2,000** (IgnCurMode 16, BLS 155): 1,000 still covers a brake light over a week of driving; 4,000 lets a fast toggling bit through, which then clutters the strip (grouping keeps it ≤ 240 pins at 1,438 px).
- **STATE_GAP 5 min:** it only labels a change "seen after a gap"; nothing is hidden. 2.5 min: smart451's diag rows pause up to ~5 min inside a drive (chunks 187–189 missing on 2026-10-13 around 09:30Z), so changes there would read as uncertain though the logger ran; 10 min: a logger pause of 5–10 min would not be flagged. Below the 90 s diag cadence every diag change would read as after a gap.
- **GROUP_PX 6:** 3 → two changes 15 min apart at 5 min/px stay separate but their 8 px hits overlap (nearest-centre rule decides); 12 → one hour of events per pin, fewer pins, more in each tooltip. The 17 DTCs are one pin at any of these.
- **Pin 6 px tall, 3/5 px wide, hit 8 px, lane 8 px:** 3 px tall → hard to see over grey bars; 12 px → covers half the bars' height and the A/B flags (10 px). Hit 4 px → hard to hit; 16 px → pins swallow clicks meant for the bars and window edges near them (edges are ±4 px).
- **Chart glyph in the 6 px headroom:** 3 px → hard to see and hit (the hit reaches 4 px into the plot); 12 px would need a larger headroom, taking 6 px from every plot.
- **Line opacity 0.5:** 0.25 → faint on a busy plot; 1.0 → the lines compete with the curves.
- **MAX_LIST_ROWS 500:** 250 → `all` on smart451 (402) would already cut; 1,000 → still renders fast (two-line rows, no images).
- **MAX_FILTER_LENGTH 200 / 20 terms:** the longest useful filters seen while writing this are ~60 characters and 6 terms; 100 / 10 would still fit them; 400 / 40 changes nothing.
- **MAX_EVENT_SIGNALS 8:** 4 → yaml's 2 plus 2 dragged; 16 → more change queries per catalog load (≤ 0.2 s each).
- **Label tolerance |factor| / 2:** the SNA rule's (D-012); a quarter step would miss values stored with float rounding, a full step would name a neighbouring code.
- **Text-signal query (~0.8 s per catalog load):** 1.6 s still well below the 30 s query timeout and runs once, in the background of the load.

## Risks / Trade-offs

- [Events and changes are fixed per catalog load] → new rows show after the next load (server restart), as the density. Accepted (proposal Out of scope).
- [Two names for one thing] → a text signal and a diag state of the same name (`BMS.contactor`) would mark twice; E7 skips the signal (`in_events_table`). A CAN signal for the same state is a different name and would show both; the filter `-ecu:…` hides one.
- [`VAL_` tables that name special values of numeric signals] → such signals count as having states and can be put on the line; only changes into or out of a named value are marked, so a temperature signal gives a few marks, not thousands.
- [Unknown event kinds] → `other`, visible with `all`; a finding goes to Jan when one appears.
- [Head width at 1000×557] → `51 of 402 events` takes ~100 px; the range and info truncate first (spec). Checked in the UI scenario.
- [Interpolation rule] → for a signal with named special codes, a line-mode readout next to a special value is held instead of interpolated; that is the honest answer there.
- [The CLI test server's stub source] → needs `events`, `stateChanges` and `textSignals`; `apps/cli/test/helpers.ts` stub gets the 18 testcar rows (tester).
- [Drag checks] → the browser tool may not hold a drag onto the strip; the drop mapping is unit-tested and the drop checked by hand (Manual checks).

## Migration Plan

None. All payload fields are additive; restart the server; reseed the test DB (`pnpm --filter @kipscope/server seed:test`) for `sdlog.events`, the text column and the state signals.

## Manual checks (lead)

- Drag `BS_200h.BLS` from the explorer onto the strip on smart451 with a real mouse; check the drop look, the 156 new events, and removing it with `×`. Send Jan one screenshot of the strip and a chart with event marks, and one of the Events tab, .

## Ledger entries on archive (proposed for `docs/decisions.md`)

- D-0xx Events conventions: `GET /api/events` (table events + events-line signal changes), ten categories (E5 status bits, E6 changes vs. snapshots incl. inferred, E7 signal changes: only named-state changes, gap 5 min, ≤ 2,000), cached per catalog load; filter grammar F1–F4 (words, `ecu:`/`name:`/`text:`, quotes, `-`; facets or-within/and-across), default `active changes` (Q1), `eventFilter`/`eventSignals` in the workspace with `events.setFilter`/`addSignal`/`removeSignal`; pins 6 px at the strip top grouped within 6 px, chart lines and headroom glyphs, glyph click places A/B; Events tab in the sidebar (Q2), key `e`; state names: `SignalInfo.states`, `stateLabel`/`shortLabel`, no interpolation into a named state; `events.signals` in `kipscope.yaml` (IgnCurMode Q4, BMS.contactor Q5); CLI `events list|filter|add|remove`, `--table`, single-dash words are arguments.
