# Design

## Context

See proposal.md for why. This change builds on the design of `openspec/changes/archive/2026-10-23-add-computed-signals/design.md` (cited as add-computed-signals Cn). What exists and matters here:

- `packages/shared/src/formula.ts`: grammar over the names `a`/`b` (C1), `bindFormula`, `evalFormula(ast, a, b?)`, `formulaName`, `inferUnit`, `shortSignalName`, `PRESETS`, `presetOf`. `computed.ts`: `ComputedDef {id, name, formula, a, b?, unit?}`, `computeRows(ast, a, b?)`, `computedRowValue`, `computedValueAt(…, a, b, gaps)`, `computedSignalGaps(info, dataRef, def)`, `computedInputIds(def, dataRef)`, `computedParams(def)`, `withComputed`, `computedInfos`, `freeName`.
- `apply.ts` runs `computed.add|update|remove` (C7); an update gives the definition a new ID and moves its window uses, so the web tile cache (keyed by signal ID, `chart/cache.ts`) never serves an old curve (C6).
- The server routes take `signal`, `formula`, `a`, `b` (C8) and are stateless: they never read workspace definitions. ClickHouse compiles the AST into one scan of `signal IN (a, b)` (C9); other sources use the fallback (`raw` per input, cap 200,000 per input).
- The explorer search: `buildSearchIndex(signals)`, `searchSignals(index, query)` in `packages/shared/src/search.ts`. The editor `apps/web/src/computed/ComputedEditor.tsx` with pure state in `computed/editor.ts`; prefill takes `selectedInClickOrder` (L2).
- CLI `apps/cli/src/calc.ts`, `args.ts`: `calc add FORMULA --a S [--b S]` (C13).

## Goals / Non-goals

Goals: type a formula with signal names and get suggestions as in the explorer search (D-106); formulas over up to 8 source signals, including other computed signals as live references (D-106); old workspaces and views keep working. Non-goals: everything under "Out of scope" in proposal.md.

## Decisions

### F1 Formula language with names

```
formula := sum
sum     := product (("+" | "-") product)*
product := unary (("*" | "/") unary)*
unary   := "-" unary | primary
primary := number | name | "(" sum ")"
         | "abs" "(" sum ")" | ("min" | "max") "(" sum "," sum ")"
name    := bare | quoted
bare    := [A-Za-z_][A-Za-z0-9_.]*        -- except the words abs, min, max
quoted  := '"' ( any character except '"' and '\'  |  '\"'  |  '\\' )+ '"'
number  := digits ["." digits] | "." digits, then optionally ("e" | "E") ["+" | "-"] digits
```

- Whitespace between tokens is ignored. Outside quotes `−` (U+2212) reads as `-`; inside quotes every character is part of the name, so `"DNMOT − PNHV_SupBat_Curr"` names the computed signal of that name.
- `abs`, `min`, `max` are lower case and reserved as bare words; a signal named `abs` is written `"abs"`; `ABS` is a bare name.
- A formula SHALL name at least one signal. Limits for a formula as typed or stored: `MAX_FORMULA_LENGTH` 500 characters, `MAX_FORMULA_NODES` 64 nodes; numbers finite.
- Positions `at` are 1-based indexes into the text (UTF-16 units; `−` is one).
- Messages (pinned; the editor shows them verbatim):
  - `Enter a formula` · `Use at least one signal` · `At most 500 characters` · `Too complex: at most 64 parts` · `Number too large at 1`
  - `Unexpected "%" at 5` (a token: its text, e.g. `Unexpected "X.A" at 2` for `2X.A`) · `Unexpected end at 7` (at = length + 1)
  - `Missing ")" at 11` · `Missing closing " at 1` (at = the opening quote) · `Empty name at 1`
  - `abs takes one value: abs(x)` · `min takes two values: min(x, y)` · `max takes two values: max(x, y)`
- Printing `formulaText(ast)`: names by `quoteName`, binary operators ` + `, ` - `, ` * `, ` / `, unary `-x`, `abs(x)`, `min(x, y)`, `max(x, y)`; parentheses only where needed (operators are left-associative: a right operand of `-` or `/` of the same precedence keeps them, a sum under `*`, `/` or unary minus keeps them). **Canonical text** = `formulaText(parseFormula(text).ast)`.
- `quoteName(name)`: the name bare when it matches `bare` and is not `abs`, `min`, `max`; else in double quotes with `\` and `"` escaped by `\`. `MS_312h.DNMOT` → `MS_312h.DNMOT`; `DNMOT − PNHV_SupBat_Curr` → `"DNMOT − PNHV_SupBat_Curr"`; `1st.X` → `"1st.X"`; `abs` → `"abs"`; `say "hi"` → `"say \"hi\""`.
- `formulaInputs(ast)`: the distinct names in first appearance (depth first, left to right). Every array of per-input data below is in this order.
- Evaluation in IEEE double as before; non-finite → SNA (D-105 Q-4).

Lead's leaning 1 (bare when an identifier, else quoted) taken as is.

### F2 Typed names and canonical names

- **Canonical** (stored in definitions and views, sent to the server): every name is exact: a definition name of the workspace (exact case) or a source signal's full name without data ref. Canonical resolution: a name equal to a definition's name is that definition; any other name is a source signal.
- **Typed** (editor, CLI): `resolveName(text, names)`:
  1. a definition whose name equals the text ignoring case → that definition;
  2. a listed signal whose full name equals the text exactly → it;
  3. the listed signals whose full name or short name (`shortSignalName`) equals the text ignoring case: one → it; several → `Ambiguous "TEMP" at 1: Bat_2h.TEMP, Eng_1h.TEMP` (sorted, at most 5, then `, …`); none → `Unknown signal "DNMOX" at 17`.
  A resolved signal with states → `MS_1h.MODE has states at 1: use a numeric signal` (D-105 lead pick 4: numeric only).
- `resolveFormula(text, names)` parses (F1), resolves every name, and returns the canonical text with names replaced. The "listed signals" are the list in use: the web's catalog items of the open list (no computed infos), the CLI's workspace signal list (cli "Signal references").
- **Guard:** a definition name SHALL NOT equal a signal name of the list in use (`duplicate_name`, `Name used by a signal: MS_312h.DNMOT`), so canonical resolution never hides a listed signal.

Lead's leaning 1 (short name when unique, ambiguous names the candidates, stored full) taken; case-insensitive typed matching added because the explorer search is case-insensitive.

### F3 N inputs

add-computed-signals C2–C5 with "both/either" read as "all/any" over `formulaInputs(ast)`:

- Rows at the distinct times of all inputs' points in the range; each input's current point as in C2 (seed counts); a row iff every input has a current point within its hold limit (`GAP_PERIODS` × its period, D-105 Q-5); SNA iff any current point is SNA or the result is not finite. One input: one row per point.
- Gaps (C3): the data ref's logger gaps, the smallest known period of the inputs.
- Value (C4): `at` time = max of the inputs' `at` times; `next` time `m` = min of the inputs' `next` times, inputs without a point at `m` contribute their `at`; an input without `at` → `none` (`before_first`/`no_data`), beyond its hold limit → `period_gap`.
- Extent (C5): latest `first`, latest `last` of the inputs; 404 `no_data` when one has none.
- `MAX_FORMULA_SIGNALS` = 8 distinct source signals (D-106).

### F4 Nesting and flattening

- `flattenFormula(ast, defs)` replaces each name that is a definition (canonical resolution) by that definition's flattened AST, recursively. The AST keeps precedence, so `"DNMOT − PNHV_SupBat_Curr" * 2` flattens to `(MS_312h.DNMOT - CPC_508h.PNHV_SupBat_Curr) * 2`.
- Refusals (code `invalid_formula`), messages pinned:
  - a cycle: `Cycle: "A" → "B" → "A"`, the chain starting at the definition being checked;
  - more than 8 distinct sources: `At most 8 signals (with nested ones): 9`; for a user pushed over by an edit (F5): `At most 8 signals in "abs(Diff)" (with nested ones): 9`;
  - flattened AST over `MAX_FLAT_NODES` (256): `Too complex with nested signals: at most 256 parts`; flattened text over `MAX_FLAT_LENGTH` (2,000): `Too long with nested signals: at most 2,000 characters`.
- The flattened canonical text is `ComputedParams.formula`, what the web and CLI send (F8).

### F5 Definitions, commands, live references

```yaml
computed:
  - id: c7
    name: DNMOT − PNHV_SupBat_Curr
    formula: MS_312h.DNMOT - CPC_508h.PNHV_SupBat_Curr
    unit: A                      # absent: none
  - id: c8
    name: abs(DNMOT − PNHV_SupBat_Curr)
    formula: abs("DNMOT − PNHV_SupBat_Curr")
```

| Command | Body | Result | Refusals (in this order) |
|---|---|---|---|
| `computed.add` | `{name, formula, unit?}` | `created: "c<n>"` | `scope_required`, `invalid_formula`, `duplicate_name`, `computed_limit`, `unknown_signal`, `not_numeric_signal` |
| `computed.update` | `{id, name, formula, unit?}` | `created` (the new ID) | `unknown_computed`, `invalid_formula` (own formula, cycle, a user over a limit), `duplicate_name`, `unknown_signal`, `not_numeric_signal` (both only for names not in the stored formula), `too_many_units` |
| `computed.remove` | `{id}` | — | `unknown_computed`, `computed_in_use` |

- The formula in a command is canonical (F2). `checkFormula` (pinned) parses it, checks each name (definition, or source signal through the C7 input check: with a scope `<dataRef>/<name>` via `ctx.signalExists`/`ctx.hasStates`, without one `ctx.inputInfo`, neither: unchecked) and flattens it (F4). The definition stores `formulaText` of it (canonical spacing).
- `duplicate_name`: `Name already used: Diff` (as today) or the F2 guard.
- **Update cascade** (lead's point 3, simplest correct option): the edited definition and every definition that uses it directly or transitively get new IDs (`c<nextId>`, users in creation order); all their window uses move with assignment IDs and colour index kept (C6). The tile cache stays keyed by signal ID; every curve that depends on the edit gets a fresh ID, so none is served stale. Keying by flattened formula was rejected: it touches the cache, the preload and every request site, while the cascade is a few lines in `apply.ts`.
- **Rename**: every direct user's formula is rewritten (`formulaText` of its AST with the old name replaced by the new one). Users keep their own names and units (Q-4).
- `computed.remove` of a used definition: `computed_in_use`, message `used by: "abs(DNMOT − PNHV_SupBat_Curr)"` (direct users, creation order, `, `-separated) (D-106).
- `withComputed`: a computed ID exists iff its definition exists, flattens, and every source exists on the ID's data ref; message `computed signal smart451/=c8: not in this list: CPC_508h.PNHV_SupBat_Curr`. A computed signal counts once towards `MAX_SIGNALS`.
- A command body with `a` or `b` fails the `Command` schema like any unknown key (the server's usual 400 for a malformed command).

### F6 Migration

- `migrateComputed(entry)`: an entry with a string `a`: the old formula is parsed with the new parser (old formulas name only `a` and `b`, which are bare names), each name `a` replaced by the name `entry.a`, `b` by `entry.b`, printed canonical, and `a`, `b` dropped. `{formula: "a - b", a: "Fast_100h.SIG_A", b: "Sna_800h.SPEED"}` → `{formula: "Fast_100h.SIG_A - Sna_800h.SPEED"}`; `{formula: "abs(a)", a: "1st.X", b: "Y.Z"}` → `{formula: "abs(\"1st.X\")"}` (an unused `b` is dropped). An entry it cannot migrate (a name other than `a`/`b`, or `b` used without `b`) is returned unchanged and then fails the schema.
- `WorkspaceSchema` runs it on every `computed` entry before validation and drops entries that still fail (so one bad legacy entry never refuses the whole workspace; its window uses then show `missing`). The server writes the new form on the workspace's next save; every read migrates until then.
- `parseViewDoc` runs it on every entry; a migrated entry gives no warning; one that still fails is left out with today's warning.

### F7 Auto name and unit

- `formulaName(ast, label)`: `label(name)` is `shortSignalName(name)` for a source signal and the definition's name for a definition. Operators ` + `, ` − `, ` × `, ` / `; `abs(x)`, `min(x, y)`, `max(x, y)`; parentheses only where needed; a label containing a space is wrapped in parentheses when it is an operand of an operator or of unary minus, not when it is a function argument (`(DNMOT − PNHV_SupBat_Curr) × 2`, `abs(DNMOT − PNHV_SupBat_Curr)`); cut to 60 with `…`; a taken name gets ` 2`, ` 3`, … (`freeName`).
- `inferUnit(ast, unitOf)`: `unitOf(name)` is a signal's unit or a definition's stored unit. `+`, `-`, `min`, `max`: equal units on both sides keep it, a constant side adopts the other side's unit, else none; `abs` and unary minus keep it; `*`, `/` none (D-105 Q-6) (lead's point 6).
- Name and unit follow the formula until typed in (as C12); when editing, a field follows only if its stored value equals the auto value of the stored formula.

### F8 Server routes

- `/api/series`, `/api/value`, `/api/extent`: a computed `signal` (`<dataRef>/=<id>`) needs `formula` (≤ `MAX_FLAT_LENGTH` characters): the flattened canonical text over source signals. Refusals:
  - no `formula`: 400 `invalid_request`, `a computed signal needs formula`;
  - `a` or `b` given: 400 `invalid_request`, `a and b are gone: write the signal names in formula`;
  - a plain signal with `formula`: 400 `invalid_request`, `formula goes with a computed signal only`;
  - parse (F1 messages with the flat limits 2,000 characters and 256 nodes) or more than 8 names: 400 `invalid_formula`;
  - a name not in the route's catalog on that data ref: 404 `unknown_signal`, `signalId` the input's ID, message `not in this list: <id>`; with states: 422 `not_numeric_signal`.
- Names are matched exactly; the server knows no short names and no definitions (stateless, lead's point 4: names parsed from the formula, no list parameter).
- Everything else as C8 with arrays in `formulaInputs` order: seeds and hold limits per input, raw edges, raw when the inputs' rows together ≤ target, else buckets from exact rows.
- Fallback: `raw(input, from, to, COMPUTED_MAX_ROWS + 1)` per input as before; over the cap: `computed_too_large` naming that input.

### F9 ClickHouse

C9 generalized: one `count()` over `signal IN ({s0:String}, …, {s<n-1>:String})`, then one scan with three `last_value(…) IGNORE NULLS OVER w` columns per input (value, SNA flag, time) seeded by parameters, the row condition "every input's time not null and within its hold" and `LIMIT 1 BY x`; constants `{k<i>:Float64}`. Signal parameter names `s<i>` follow `formulaInputs` order. One input: no window, as today. Exactly two queries per request.

### F10 Web: infos and requests

- `computedInfos(defs, items, scopeDataRef?)`: one info per definition and data ref of the list that holds all its sources (flattened); `description` the stored formula; `computed: {formula, unavailable?}`; an unavailable one reads `not in this list: <missing sources, comma-separated>`.
- `api.ts`: a computed ID's requests carry `formula` = `computedParams(def, defs).formula`; no definition or a definition that does not flatten: `ApiRequestError(0, "unknown_computed", …)`, nothing sent.
- `chart/gaps.ts`: gap info for the sources (`computedInputIds(def, defs, dataRef)`); `computedSignalGaps(info, dataRef, sources)`.

### F11 Formula field with completion

Editor layout (C12 otherwise unchanged: 360 px, placement, Delete, Cancel, Save the one primary):

```
 New computed signal                         (Edit computed signal)
 FORMULA
 ┌────────────────────────────────────────────┐
 │ abs("DNMOT − PNHV_SupBat_Curr") * 2         │  textarea, 4 lines fixed (82 px), wraps,
 │                                             │  mono 12 px / line 18 px, scrolls beyond
 └────────────────────────────────────────────┘
 ┌ ƒ DNMOT − PNHV_SupBat_Curr               A ┐  suggestion list: right under the field,
 │   MS_312h.DNMOT                        rpm │  field width, ≤ 8 rows of 22 px, drawn over
 └────────────────────────────────────────────┘  the error line and the fields below
 <one-line error, 11 px --error, height reserved>
 NAME                            UNIT
 [ abs(DNMOT − PNHV_SupBat_Curr) ]  [      ]
 [Delete]                           [Cancel] [Save]
```

- Placeholder `HINTS.formulaPlaceholder`: `Type a signal, abs( min( max( or + - * /`.
- **Token at the caret** (`tokenAt(text, caret)`): inside a quoted name (an unclosed or closed quote pair around the caret): from the opening quote to the closing quote (or the caret when unclosed), `quoted: true`, query = the unescaped text between the opening quote and the caret; otherwise the maximal run of `[A-Za-z0-9_.]` around the caret when it starts with a letter or `_`, query = its part before the caret. None when the query is empty or the run starts with a digit.
- **Suggestions** (`suggestions(token, index, exclude)`), at most 8: first the functions whose name starts with the query ignoring case (not when quoted), shown `abs(x)`, `min(x, y)`, `max(x, y)`; then `searchSignals(index, query)` over the list in use plus the computed infos (the explorer's ranking), without the definition being edited and its users (they would close a cycle). Computed rows show `ƒ` and their name; others their shown name (mono) and unit. A signal with states is listed in `--disabled` with `title` `HINTS.computedNumericOnly(short)` and is not accepted.
- **Accept** (`accept(text, token, s)`): the token is replaced by `quoteName(name)` (catalog: the full name; computed: the definition's name), caret after it; a function inserts `abs(` with the caret after `(` (when a `(` already follows the token, only the caret moves past it).
- **Keys** in the field: with the list open ↑/↓ move the active row, Enter or Tab accept, Esc closes only the list (L4); a mouse-down on a row accepts without leaving the field. With the list closed Enter saves when valid (never a newline), Esc cancels the editor, Tab moves focus. The list opens on an input event that leaves a token at the caret and closes on accept, Esc, blur, or when the caret leaves the token.
- **Tint** (lead's point 2, cheap and robust form): a highlight layer behind the textarea with the same box, font, padding, border width (transparent), `white-space: pre-wrap`, `overflow-wrap: anywhere` and synced `scrollTop`; its text is transparent and only `mark` elements paint backgrounds: a resolved signal `mark.sig` in `--accent-soft`, a computed one `mark.sig.computed` in `--band`, both 3 px radius, **no padding, border or font change** (so nothing moves the glyphs); the bad token of the current error `mark.bad` with a wavy `--error` underline. The textarea draws the text itself with a transparent background, so a misaligned layer could only shift tints, never text or caret. `highlightSpans(text, names)` (pure) gives the spans.
- **Live validation** on every change: `resolveFormula` (typed names, F2) → `checkFormula` with the other definitions (the edited one replaced by the editor's state) → name and unit rules (C6, F2 guard). The first error shows; Save disabled while one exists. Save sends the canonical formula.
- Delete: a refusal `computed_in_use` shows in the error line and keeps the editor open.

### F12 Prefill

From `+` or the hint (C12), the explorer selection in click order (L2): numeric catalog signals and available computed signals kept, signals with states left out, at most the first 8. 0 → empty field; 1 → `abs(X)`; 2 → `X - Y`; 3 to 8 → `X + Y + Z …` (Q-3). X is `quoteName` of the full name (computed: its name). Focus in the field, caret at the end. So "select two rows, `+`, Enter" still creates `X - Y` (D-106 „a selection still prefills").

### F13 CLI

- `calc add FORMULA [--name NAME] [--unit UNIT]`: FORMULA typed (F2: `resolveFormula` over the workspace's signal list and definitions): `Unknown signal` → `unknown_signal`, `Ambiguous` → `ambiguous_signal` with `error.candidates`, states → `not_numeric_signal`, other F1/F4 errors → `invalid_formula`; nothing sent on a refusal. Defaults: `freeName(formulaName(…))`, `inferUnit(…)` with the catalog's units and the definitions' units. Sends `computed.add` with the canonical formula.
- `calc edit ID|NAME [--formula F] [--name NAME] [--unit UNIT]`: F resolved the same way; name and unit not re-derived.
- `--a`, `--b`, `--no-b` on `calc add|edit`: usage error (exit 2) with `--a and --b are gone: write signal names in the formula, e.g. calc add "abs(MS_312h.DNMOT)"`.
- `calc list` → `data {computed: [{id, name, formula, unit?}]}`; `calc rm` may now be refused `computed_in_use` (exit 1).
- `value`/`extent` with a computed ID attach `formula` = the flattened text from the state's definitions.
- Lead's leaning `calc add NAME "FORMULA"` overruled: the existing positional FORMULA keeps its meaning, the name keeps defaulting to the auto name as in the editor, and an old command (`calc add "a - b" --a …`) is refused with the hint instead of being misread as a name.

### F14 Views

- `ViewDoc.computed?: {name, formula, unit?}[]`; formulas canonical, references to other entries by name; windows list `<dataRef>/=<name>` (C10). `version` stays 1.
- `parseViewDoc`: F6 migration first; then the entries are checked as a set: each parses; names that are other entries' names are references; an entry in a cycle or over a limit (F4) is left out with `computed signal "<name>" left out: <reason>`. Names that are no entry are source signals (unchecked until open).
- `view.open`: fresh IDs in document order; window references by name; a reference without a definition is `missing`.

## Pinned interfaces

### `packages/shared/src/formula.ts`

```ts
export const MAX_FORMULA_LENGTH = 500;
export const MAX_FORMULA_NODES = 64;
export const MAX_FORMULA_SIGNALS = 8;
export const MAX_FLAT_LENGTH = 2_000;
export const MAX_FLAT_NODES = 256;
export const FORMULA_FUNCTIONS = ["abs", "min", "max"] as const;
export type FormulaNode =
  | { op: "num"; value: number }
  | { op: "sig"; name: string; at: number }   // at: 1-based position of the name token
  | { op: "neg" | "abs"; arg: FormulaNode }
  | { op: "+" | "-" | "*" | "/" | "min" | "max"; left: FormulaNode; right: FormulaNode };
export type ParsedFormula =
  | { ok: true; ast: FormulaNode; names: readonly string[] }   // names = formulaInputs(ast)
  | { ok: false; message: string; at?: number };
export interface FormulaLimits { length: number; nodes: number }  // default {500, 64}; server: {2000, 256}
export function parseFormula(text: string, limits?: FormulaLimits): ParsedFormula;
export type FormulaToken = { start: number; end: number } & (   // 0-based, end exclusive; covers the text
  | { kind: "name"; name: string; quoted: boolean; closed: boolean }
  | { kind: "func"; name: "abs" | "min" | "max" }
  | { kind: "num" | "op" | "open" | "close" | "comma" | "space" | "bad" });
export function tokenizeFormula(text: string): FormulaToken[];   // never throws
export function quoteName(name: string): string;
export function formulaText(ast: FormulaNode): string;           // canonical print (F1)
export function formulaInputs(ast: FormulaNode): string[];
export function evalFormula(ast: FormulaNode, value: (name: string) => number): number;
/** For hot loops: values in formulaInputs(ast) order. */
export function compileFormula(ast: FormulaNode): (values: readonly number[]) => number;
export interface FormulaNames {
  signals: readonly { name: string; unit?: string; states: boolean }[];  // the list in use, full names
  computed: readonly { name: string; unit?: string }[];                 // the workspace's definitions
}
export type NameResolution =
  | { ok: true; kind: "signal" | "computed"; name: string }             // canonical name
  | { ok: false; reason: "unknown" | "ambiguous" | "states"; candidates?: string[] };
export function resolveName(text: string, names: FormulaNames): NameResolution;   // F2 steps 1–3
export type ResolvedFormula =
  | { ok: true; formula: string; ast: FormulaNode }                        // canonical
  | { ok: false; message: string; at?: number; code: "invalid_formula" | "unknown_signal" | "ambiguous_signal" | "not_numeric_signal"; candidates?: string[] };
export function resolveFormula(text: string, names: FormulaNames): ResolvedFormula;
export function formulaName(ast: FormulaNode, label: (name: string) => string): string;   // F7
export function inferUnit(ast: FormulaNode, unitOf: (name: string) => string | undefined): string | undefined;
export function shortSignalName(shown: string): string;   // unchanged
// removed: FormulaVar, bindFormula, PRESETS, PresetId, presetOf
```

### `packages/shared/src/computed.ts`

```ts
export interface ComputedDef { id: string; name: string; formula: string; unit?: string }   // a, b removed
export interface ComputedParams { formula: string }   // flattened canonical text over source signals
export function flattenFormula(ast: FormulaNode, defs: readonly ComputedDef[], self?: string):
  | { ok: true; ast: FormulaNode; sources: string[] }
  | { ok: false; message: string };                      // F4 messages; self: name of the definition checked
/** Sources of a stored definition; undefined when it does not flatten. */
export function computedSources(def: ComputedDef, defs: readonly ComputedDef[]): string[] | undefined;
export function computedParams(def: ComputedDef, defs: readonly ComputedDef[]): ComputedParams | undefined;
export function computedInputIds(def: ComputedDef, defs: readonly ComputedDef[], dataRef: string): string[];
/** Direct users (creation order). */
export function computedUsers(name: string, defs: readonly ComputedDef[]): ComputedDef[];
export type SignalCheck = (name: string) => "numeric" | "states" | "unknown" | "unchecked";
/** F5: canonical formula check incl. nesting; `users` = IDs that get new IDs on an update (transitive). */
export function checkFormula(
  formula: string, defs: readonly ComputedDef[], self: { id?: string; name: string }, signal: SignalCheck,
): { ok: true; formula: string; sources: string[]; users: string[] }
 | { ok: false; code: "invalid_formula" | "unknown_signal" | "not_numeric_signal"; message: string };
/** F6; returns other values unchanged. */
export function migrateComputed(entry: unknown): unknown;
export interface ComputedSeriesInput { points: readonly Point[]; seed?: Point; holdNs?: bigint }   // unchanged
export function computeRows(ast: FormulaNode, inputs: readonly ComputedSeriesInput[]): Point[];
export function computedRowValue(ast: FormulaNode, current: readonly Point[]): number | null;
export function computedSignalGaps(info: GapInfo | undefined, dataRef: string, sources: readonly string[]): SignalGaps;
export function computedValueAt(
  t: bigint, mode: ValuesMode, ast: FormulaNode, inputs: readonly ComputedNeighbours[], gaps: SignalGaps,
): { value: CursorValue; at?: Point; next?: Point };
// unchanged: MAX_COMPUTED, MAX_COMPUTED_NAME, MAX_COMPUTED_UNIT, COMPUTED_MAX_ROWS, ComputedName,
// ComputedUnit, freeName, isComputedId, computedRef, computedSignalId, holdLimit, ComputedNeighbours;
// withComputed and computedInfos keep their signatures with F5/F10 semantics. ComputedInput removed.
```

`signals.ts`: `SignalInfo.computed?: { formula: string; unavailable?: string }`.

`workspace.ts`: `computed.add {name, formula: string max 500, unit?}`, `computed.update {id, name, formula, unit?}`, `computed.remove {id}`; `CommandErrorCode` gains `computed_in_use`; `WorkspaceSchema` preprocesses `computed` entries with `migrateComputed` and drops entries that still fail (F6).

`views.ts`: `ViewDoc.computed?: { name: string; formula: string; unit?: string }[]`; `parseViewDoc`, `workspaceToView`, `openView` per F14.

### HTTP (`docs/http-api.md`)

| Route | Query parameters | Errors |
|---|---|---|
| `GET /api/series` | `signal` (computed `<dataRef>/=<id>`), `formula` (flattened, ≤ 2,000 characters); `a`, `b` removed | 400 `invalid_request` (F8 texts), 400 `invalid_formula`, 404 `unknown_signal` (input), 422 `not_numeric_signal`, 422 `computed_too_large` (fallback) |
| `GET /api/value` | same | same, without `computed_too_large` |
| `GET /api/extent` | same | same, without `computed_too_large` |

Example: `/api/series?signal=smart451%2F%3Dc8&formula=abs(MS_312h.DNMOT%20-%20CPC_508h.PNHV_SupBat_Curr)&from=…&to=…&target=2000`. Answers unchanged in shape.

### Server

```ts
// apps/server/src/datasource.ts
export interface ComputedInputRef extends SeriesRef { seed?: RawPoint; holdNs?: bigint }   // unchanged
export interface ComputedRef { dataRef: string; ast: FormulaNode; inputs: ComputedInputRef[] }  // formulaInputs order
// computedSeries?(ref, from, to, target, width, abort?) unchanged in signature
// apps/server/src/computed.ts
export function resolveComputed(
  params: ComputedParams, dataRef: string, catalog: Pick<Catalog, "get" | "snaRanges">,
): { ok: true; ast: FormulaNode; inputs: SeriesRef[] }
 | { ok: false; status: 400 | 404 | 422; code: "invalid_formula" | "unknown_signal" | "not_numeric_signal"; message: string; signalId?: string };
// queryComputed(source, ref, signalId, from, to, target, scope?, abort?, span?) unchanged in signature
// apps/server/src/fallbacks.ts: ComputedTooLargeError(signal) unchanged
// apps/server/src/gaps.ts workspaceSignals: a computed ID contributes computedInputIds(def, defs, dataRef)
```

### Web (internal, pinned so the tester can write tests first)

```ts
// computed/completion.ts (new, pure)
export interface CompletionToken { start: number; end: number; query: string; quoted: boolean }   // 0-based
export function tokenAt(text: string, caret: number): CompletionToken | undefined;
export type Suggestion =
  | { kind: "function"; name: "abs" | "min" | "max" }
  | { kind: "signal"; info: SignalInfo; disabled?: string };   // disabled: the title
export function suggestions(token: CompletionToken, index: SearchIndex, exclude: ReadonlySet<string>): Suggestion[];  // ≤ 8; exclude: signal IDs
export function accept(text: string, token: CompletionToken, s: Suggestion): { text: string; caret: number };
export function highlightSpans(text: string, names: FormulaNames, bad?: number):
  { start: number; end: number; kind: "signal" | "computed" | "bad" }[];   // whole tokens incl. quotes; unresolved names are bad; `bad`: 1-based `at` of the current error marks that token too
// computed/editor.ts
export interface EditorState { formula: string; name: string; unit: string; nameAuto: boolean; unitAuto: boolean }
export interface EditorContext { names: FormulaNames; defs: readonly ComputedDef[]; selfId?: string }
export function prefill(selected: readonly SignalInfo[]): EditorState & { caret: number };   // F12, click order
export function fromDef(def: ComputedDef, ctx: EditorContext): EditorState;
export function editorError(s: EditorState, ctx: EditorContext): string | undefined;
export function withAuto(s: EditorState, ctx: EditorContext): EditorState;
export function canonicalFormula(s: EditorState, ctx: EditorContext): string | undefined;   // what Save sends
export function formulaNames(items: readonly SignalInfo[], defs: readonly ComputedDef[]): FormulaNames;
// api.ts setComputedDefs(defs) unchanged; requests per F10
// help/hints.ts: HINTS.formulaPlaceholder; HINTS.computedNumericOnly(name) kept
// help/shortcuts.ts: { group: "Signal list", keys: "Tab", action: "Accept a suggestion in the formula field" }
```

### CLI output

`calc list` → `{outcome: "ok", workspace, data: {computed: ComputedDef[]}}`; `calc add|edit|rm` → the command output; refusals as every CLI refusal (`error.code`, `error.candidates` for `ambiguous_signal`).

## Numbers

| Number | Value | Off by ×2 |
|---|---|---|
| `MAX_FORMULA_SIGNALS` | 8 (D-106) | Jan's number. 4 cannot hold `X + Y + Z + W + V`; 16 doubles the ClickHouse window columns (48) and the fallback's worst-case heap. |
| `MAX_FORMULA_LENGTH` | 500 characters (was 200) | Necessary consequence of D-106: 8 full names like `CPC_508h.PNHV_SupBat_Curr` (25) with operators need ≈ 220. 250 still fits that; 1,000 harmless (a guard). |
| `MAX_FORMULA_NODES` | 64 (unchanged) | 8 names, 7 operators and a few functions are ≈ 25; 32 still fits, 128 harmless. |
| `MAX_FLAT_LENGTH` | 2,000 characters | The flattened text goes in a URL (≈ 2,600 encoded, far below Node's 16 KB header limit). 1,000 refuses a reuse of two long inner formulas; 4,000 harmless. |
| `MAX_FLAT_NODES` | 256 | Nesting can double nodes per level (`c2 = c1 * c1`); 256 allows 4× reuse of a full 64-node formula. 128 refuses that; 512 makes ClickHouse SQL ≈ 2× longer, still fine. |
| Suggestions | 8 rows × 22 px | 4 rows hide candidates of an ambiguous short name; 16 rows (352 px) cover Save at 900 px tall. |
| Formula field | 4 lines (82 px) | ≈ 46 characters per line at 12 px mono in 336 px: 4 lines show ≈ 180 characters (an 8-signal formula needs scrolling only past that); 2 lines show two full names; 8 lines make the panel ≈ 400 px tall. |
| Row cap of the fallback | 200,000 per input (unchanged) | With 8 inputs a request may hold 1.6 M points before refusing (≈ 130 MB heap); see Risks. |
| ClickHouse goal (not pass/fail) | two inputs as D-102 (busiest hour ≤ 0.5 s, whole recording ≤ 3 s); three inputs reported | The scan reads each extra input's rows once more; 3 inputs roughly ×1.5. |

## Risks

- [The fallback with 8 fast inputs reads up to 1.6 M points] → only ADX and other non-ClickHouse sources; carserver uses ClickHouse. If it bites, a total cap across inputs is a one-line change (not done now: the lead asked for the cap per input as before).
- [A definition named like a signal of another session's list] → canonical resolution prefers the definition there; the F2 guard only checks the list in use. Accepted: names with spaces or `−` (auto names) never collide with source names.
- [Old clients send `a`/`b` after the deploy] → refused with a message that says what changed (F8); web and server ship together.
- [Overlay tints drift from the text] → the layer copies the textarea's box and font and paints backgrounds only; a drift shows as a shifted tint, never as wrong text (UI check M9 measures it).
- [Rename rewrites users' formulas] → done in the same command (one revision), so no state shows a dangling name.

## Manual checks (UI user, smart451 on carserver, 1440×900, a session where `MS_312h.DNMOT` and `CPC_508h.PNHV_SupBat_Curr` have data, a workspace without computed signals unless noted)

- **M1 Type and pick (main path):** empty search, nothing selected; click `+` in `ƒ Computed`; the field is focused and empty; type `DNMO` → the list shows `MS_312h.DNMOT` (the same first row as the explorer search for `DNMO`); Enter → the field reads `MS_312h.DNMOT`, caret at the end; type ` - PNHV_Sup` → Tab → `MS_312h.DNMOT - CPC_508h.PNHV_SupBat_Curr`; name `DNMOT − PNHV_SupBat_Curr`; Enter (no list open) saves; the row is under `ƒ Computed`, active, and the "Add to" window shows the legend row with a curve.
- **M2 Function and nested:** `+`; type `ab` → first row `abs(x)` → Enter → `abs(` with the caret after `(`; type `"DNMOT` → the list shows `ƒ DNMOT − PNHV_SupBat_Curr` → Enter → `abs("DNMOT − PNHV_SupBat_Curr"`; type `)`; name `abs(DNMOT − PNHV_SupBat_Curr)`; Enter → a curve ≥ 0 everywhere.
- **M3 Typed short name, no list:** `+`; type `DNMOT*2`, Esc (closes only the list), Enter → saved; its pencil shows `MS_312h.DNMOT * 2`.
- **M4 Live reference:** M1's and M2's signals in one window, values window in step mode; edit M1's to `MS_312h.DNMOT + CPC_508h.PNHV_SupBat_Curr` and save; both curves redraw; at cursor A the outer equals |DNMOT + PNHV_SupBat_Curr| of the same values window to the shown digits.
- **M5 Rename:** rename M1's to `Sum`; the pencil of M2's shows `abs(Sum)`; M2's legend name is unchanged.
- **M6 Delete refused:** pencil on `Sum` → Delete → "Click again to delete" → click; the error line reads `used by: "abs(DNMOT − PNHV_SupBat_Curr)"` and the row stays; delete M2's, then `Sum` → both gone.
- **M7 Prefill:** select `DNMOT`, then Ctrl/Cmd-click `PNHV_SupBat_Curr`, `+` → `MS_312h.DNMOT - CPC_508h.PNHV_SupBat_Curr`, caret at the end; with only `DNMOT` → `abs(MS_312h.DNMOT)`; with three numeric rows → `X + Y + Z` in click order.
- **M8 Live error, position, stable layout:** type `MS_312h.DNMOT - DNMOX` → the error line reads `Unknown signal "DNMOX" at 17`, `DNMOX` has a wavy red underline, Save disabled; the field's and the error line's `getBoundingClientRect()` equal (±0.5 px) those with a valid formula; with the list open nothing below moves.
- **M9 Look:** with `abs("DNMOT − PNHV_SupBat_Curr") + MS_312h.DNMOT` in the field: the computed name has a `--band` tint, `MS_312h.DNMOT` an `--accent-soft` tint, each `mark` has `padding` 0 and lies over its text (mark rect within ±1 px of a `Range` over the same characters in the textarea's mirror, or visibly in the screenshot); exactly one slate-900 button (Save); panel 360 px; field 82 px tall, `font-size` 12px; suggestion rows 22 px.
- **M10 Esc:** list open → Esc closes the list, editor open with its text; Esc again closes the editor.
- **M11 Step:** M2's signal shown, `]` → drawn on the next session with the same legend name.
- **M12 Old definitions (only if the lead's workspace still holds definitions from before this change):** they are listed and drawn; their pencil shows the formula with full names.
- **M13 Speed (goal, the lead):** `curl -s -o /dev/null -w '%{time_total}'` of `/api/series` for M1's formula over the busiest hour and the whole recording, `target=2000`, and for a three-input formula with a third numeric signal of the session; reported, not pass/fail.

## Open questions for Jan

Jan is reachable today; each has a pick (✔) so the round can start, and the lead asks all at once.

- **Q-1 Name written into the field after picking a suggestion.** (a) ✔ the full name (`MS_312h.DNMOT`): unambiguous on every session, what is stored anyway, and what the pencil shows later. (b) the short name when unique in the list (`DNMOT`), stored as the full name: shorter while typing, but the text changes to full names after Save and may turn ambiguous on another list.
- **Q-2 `min`/`max` with more than two values.** (a) ✔ two values as today (D-102 `min(a,b)`; "new functions" are out of scope): `max(X, max(Y, Z))`. (b) any number of values (`max(X, Y, Z)`), handy with up to 8 signals; a small parser and SQL change (`greatest(…)` takes many).
- **Q-3 Prefill with three or more selected signals.** (a) ✔ `X + Y + Z …` (lead's leaning). (b) the names only, separated by ` , ` for the user to finish. (c) as (a) but `max(…)` nested.
- **Q-4 Does an outer signal's name and unit follow an edit of an inner one?** (a) ✔ no: the outer's values follow live (D-106), its formula text follows a rename, but its saved name and unit stay as saved (no legend label changes under a window nobody touched). (b) yes, when the outer's name or unit was still the auto value.
- **Q-5 An edit of an inner signal that would push an outer one past 8 signals.** (a) ✔ refused, naming the outer one (like deleting a used one, D-106). (b) allowed; the outer one turns unavailable with that reason until fixed.
