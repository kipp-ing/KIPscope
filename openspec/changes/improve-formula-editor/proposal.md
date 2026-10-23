# Proposal

## Why

Jan (D-106), after testing `add-computed-signals`: „its buatiful. now to make it harder: can we use computed signals in new computed signals? and for ease of use: yes this way is cool, but dated. I dream I just type a signal (like in finder) have dropdown to select, or just enter an abs( or a + and it just works?" On the lead's questions: at most 8 signals, nested ones live, presets and a/b fields gone.

Today a formula names its inputs `a` and `b`, picked in two slots, with a preset dropdown beside the formula field. That caps a formula at two signals and makes a computed signal unusable as an input.

## What Changes

- **One formula field** (D-106): signal names are written in the formula itself (`MS_312h.DNMOT - CPC_508h.PNHV_SupBat_Curr`, `abs("DNMOT − PNHV_SupBat_Curr")`). Typing a name opens a dropdown of signals ranked like the explorer search (computed ones marked `ƒ`) and of the functions `abs`, `min`, `max`; Enter or Tab accepts; operators and parentheses are typed as text. A unique short name (`DNMOT`) typed without the dropdown works too. Signal names in the field are tinted; the live error line names the bad token and its position. The `a`/`b` pickers and the preset dropdown are removed. **BREAKING** for the formula language: `a` and `b` are no longer names.
- **Up to 8 source signals** (D-106, supersedes D-102's two): the per-row rule, the server routes, the ClickHouse single scan and the fallback generalize from two inputs to N ≤ 8.
- **Computed signals in computed signals** (D-106): a formula may name another computed signal. It is a live reference: editing the inner one redraws every outer one; renaming it rewrites the outer formulas; deleting a used one is refused naming its users; cycles are refused; at most 8 source signals after resolving nested ones.
- **Server stays stateless** (necessary consequence of design C8 of add-computed-signals): the web sends the formula flattened over source signals; the server re-parses it and reads the names from it. **BREAKING** for `/api/series`, `/api/value`, `/api/extent`: the `a` and `b` parameters are gone.
- **Migration**: workspace definitions and view documents written with `a`/`b` load and are rewritten to the new form.
- **Prefill from a selection** stays (D-106, click order L2 of D-105): one signal gives `abs(X)`, two `X - Y`, more `X + Y + …`.
- **CLI**: `kipscope calc add FORMULA` and `calc edit … --formula F` take names in the formula; `--a`, `--b`, `--no-b` are refused with a hint.
- **Docs**: `docs/http-api.md`, `docs/data-sources.md`, `docs/manual.md`, README CLI reference.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `computed-signals`: formula language with signal names, N inputs, nesting, the completing formula field, migration of old definitions.
- `data-source`: the computed series method and its bounded fallback take N inputs; a three-input conformance case.
- `saved-views`: view entries carry formulas with names; old entries with `a`/`b` are rewritten.
- `cli`: `calc add|edit` without `--a`/`--b`.

## Out of scope

- New functions (variadic `min`/`max`, derivative, integral, filters, conditionals, comparisons, unit conversion) (D-104 „die basics reichen"; D-106 names only `abs`, `min`, `max`).
- A per-user or shared formula library; computed signals per user (D-105 Q-1).
- Native ADX compilation (stays the fallback, as in add-computed-signals).
- Completion anywhere but the formula field (explorer search, CLI shell completion).
- Syntax highlighting beyond tinting signal names and marking the bad one (no colours for operators or numbers).
- Changing the Computed section of the explorer (header, hint, rows, pencil, `F2`).
