# Proposal

## Why

Jan (D-102): „signale berechnen diff, abs min max +- usw. … kein kql"; (D-104): „ich dachte unter favourites gibt es ein drop down mit magie … so wie halt sinn macht, schön aussieht. leicht zu bedienen. wir brauche keine ultra fancy funktionen die basics reichen." The concept asks for an extensible signal model for derived signals (§10, line 149: „Abgeleitete Signale benötigen später ein erweiterbares Signalmodell").

Today a user who wants `DNMOT − PNHV_SupBat_Curr` or `abs(SPEED)` exports data. This change lets them define such a signal in a few clicks and then use it like any other signal.

## What Changes

- **Formula language of KIPscope's own** (D-102): inputs `a` and optional `b`, numbers, `+ - * /`, parentheses, `abs(x)`, `min(x, y)`, `max(x, y)`. Never KQL or SQL written by a user. One parser in `packages/shared`, used by the editor (live validation), the server (which re-parses every formula, never trusting the client) and the CLI.
- **Semantics** (D-102 stages 1 and 2): one input: the formula per row. Two inputs: rows on the union of both inputs' times, each input holding its last value (no longer than its gap rule allows); SNA in either input gives SNA; gaps of both inputs show. Buckets come from the exact per-row result, so extremes survive.
- **Definitions in the workspace and the view** (D-102): a list of computed signals (name, formula, inputs by signal name without data ref, unit) changed by three workspace commands `computed.add`, `computed.update`, `computed.remove`; saved in view documents (version stays 1; older code ignores the key). Inputs resolve in the workspace's current data ref, so a computed signal keeps working when the user steps sessions; a missing input makes it unavailable with that reason.
- **Like any signal** (D-104): a computed signal has an ID `<dataRef>/=<id>`, is added with Enter, double-click, `+` or drag, gets a legend row and colour, an axis by its unit, cursor values and gap marks; it counts towards the 50-signal limit. Editing a shown one redraws it; deleting it removes it from every window.
- **Server** (D-102): `/api/series`, `/api/value` and `/api/extent` take a computed signal with its formula and inputs as query parameters. ClickHouse compiles the parsed formula into one scan (stage 2: `last_value(…) IGNORE NULLS OVER (ORDER BY utc)`, measured in D-102); every other source computes from raw points through a new optional adapter method's fallback, bounded by a row cap with a "zoom in" error.
- **Explorer** (D-104): a "ƒ Computed" section right under Favourites, with a `+` in its header and a one-line hint when empty; rows with a pencil to edit. The editor: two signal pickers (`a`, `b`), a preset dropdown ("magic": Difference, Sum, Absolute, Minimum, Maximum, Scale, Custom), the formula field with a one-line live error, name and unit filled in automatically and editable, Save, Cancel and Delete.
- **CLI** (concept §7): `kipscope calc list|add|edit|rm` over the same workspace commands.
- **Docs**: `docs/http-api.md`, `docs/data-sources.md`, `docs/manual.md`, README CLI reference.

## Capabilities

### New Capabilities

- `computed-signals`: the formula language, the per-row semantics, definitions and their commands, computed series, values and extents on the server, the Computed section and the editor in the explorer.

### Modified Capabilities

- `signal-groups`: "Grouped explorer list" makes room for the Computed section between Favourites and the groups.
- `data-source`: new optional adapter method for computed series with a bounded fallback; the conformance suite covers it.
- `saved-views`: view documents carry the computed definitions.
- `cli`: new requirement "Computed signal commands".

## Out of scope

- Derivative, integral, filters, smoothing, more than two inputs, conditionals, comparison operators, a `diff()` function (Difference is the preset `a - b`), unit conversion (D-104 „die basics reichen"; lead pick 8).
- A shared or per-user formula library; computed signals per user like stars (D-102 keeps them in workspace and view; see design Q-1).
- Strip density, the events line, state names and the hover card's sample values for computed signals; a computed signal as an input of another.
- Native ADX compilation (`serialize`/`scan`) beyond a could-task that passes only on the emulator (design C9); ADX uses the fallback.
- Materialized views or anything written to a source (D-102).
- Favourites for computed signals (stars stay on source names, D-102).

## Impact

- `packages/shared`: new `formula.ts` (parser, evaluator, names, units, presets) and `computed.ts` (definition type, IDs, per-row computation, value at a time, gap rule, signal infos, query parameters); `workspace.ts` (field, commands, schema, error codes), `apply.ts`, `views.ts`, `signals.ts` (`SignalInfo.computed`).
- `apps/server/src`: new `computed.ts` (validation, seeds and edges, route helpers), `routes/series.ts` (series, value, extent), `datasource.ts` (optional method), `fallbacks.ts` (fallback with row cap), `clickhouse.ts` (one-scan compile), `workspace.ts` (apply context), `gaps.ts` (inputs of shown computed signals polled); optional `adx.ts`.
- `apps/web/src`: new `computed/` (editor and its pure state), `explorer/groups.ts`, `explorer/SignalExplorer.tsx`, `api.ts` (parameters attached), `chart/gaps.ts` (inputs' gap info), `App.tsx` (infos, entry points), `keys.ts`, `help/hints.ts`, `help/shortcuts.ts`, `styles.css`.
- `apps/cli/src`: `calc` forms.
