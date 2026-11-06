# Design

## Context

Source: the ADX feedback (comment of 2026-10-22, M2, "signals by logical name bound per case"), Jan (2026-11-06): the server delivers a dictionary so the user always works with the same names; it holds per server connection; "Wörterbuch macht der Server der kipscope startet"; the display is switchable („das mag jeder anders"). Jan confirmed that one logical name has the same source (ADX) name on every vehicle, so a flat dictionary is enough and nothing is "bound per case". Motivation: proposal.md; behaviour: the specs.

Today (read before writing this design):

- Signal IDs are `<dataRef>/<source name>` and are what workspaces, views, links, grants and the CLI store (signal-catalog "Signal identity", saved-views "Exact and stable references"). A view cannot cross data refs anyway (saved-views "Signals of another data ref on open", D-078).
- `display-names` already has the machinery for a second name: `apps/server/src/names.ts` assigns each distinct source name a shown name (`assignDisplayNames`: rename, first matching rule, else full name; collisions get the rule's suffix, then fall back to full names), `catalog.ts` writes it as `displayName`, `shownName()` in `packages/shared/src/signals.ts` reads it, and the search ranks it like the name.
- `SignalInfo.alias` exists (`signals.ts:88`), is matched by the search at tier 3 (`search.ts`) and shown by concept §4, but no source fills it.
- The CLI resolves a bare name with the search plus `nameMatches` over `name` only (`apps/cli/src/refs.ts`); the formula editor resolves a typed name over full and short names (`resolveName` in `packages/shared/src/formula.ts`) and stores the canonical full name.
- User options are `{digits}` in the workspace (`workspace.setOptions`, `OptionBar.tsx` radiogroup in the "⋯" menu, CLI `digits`). The stored workspace schema is `z.strictObject({ digits })`.
- The project file (`kipscope.yaml`) is read once at start from a path in `config.ts`; a missing named file stops the server.

## Goals / Non-Goals

**Goals:** users type, search and read logical names everywhere a source name works today; no stored file changes shape; a deployment without a dictionary is untouched.

**Non-Goals:** see proposal.md. Also not: showing the logical name inside the stored text of a formula (a formula keeps canonical source names, as its names do today); validating the dictionary against a catalog (scopes differ, the full catalog is not loaded in `scoped` mode).

## Decisions

### D1 One JSON file, path in `KIPSCOPE_ALIASES_FILE`, read once at start

- `config.ts` reads the variable like `KIPSCOPE_PROJECT_FILE` (relative to the repo root, required when set). A new `apps/server/src/aliases.ts` reads and checks the file and returns `Aliases { bySource: Map<source, logical>, byLogical: Map<logicalLowercase, source> }`; `main.ts` hands it to the catalog next to the project rules.
- Format: a flat JSON object `{ "<logical>": "<source>" }`. Why JSON and not the YAML of the project file: the system that starts the server writes it by program, and JSON needs no parser dependency on its side. Why not inside `kipscope.yaml`: that file is KIPscope's hand-written project config; the dictionary has another author and a different change rhythm (the spec "Aliases file").
- Checks at start (spec "Aliases file is checked at start"): the dictionary is one-to-one, a logical name is not the source name of another entry, and two logical names do not differ only by case (input matches ignoring case, so they would be ambiguous). Any of these stops the server naming the entries. Why stop and not warn: a silently ambiguous dictionary makes `signal add` pick a wrong signal; a launcher that writes a bad file should find out at once.
- Not checked: entries with no signal in any catalog (scopes differ; in `scoped` mode no catalog is loaded at start).
- Alternative: `GET <url>` of the launcher at start. Rejected for now: a file is testable, needs no credentials and no new failure mode at start. A later change can add a source for the same `Aliases` value.

### D2 The shown name gets a third source

- `DisplayRules` gains `aliases: ReadonlyMap<source, logical>`. `assignOne` (names.ts N4) tries rename, then the alias, then the rules, then the full name. An alias is a kind of its own (`alias`); it never takes a rule's collision suffix.
- Collisions: step 3 (collision suffix) changes only rule-made names, so a rule-made name that collides with an alias takes its suffix; if the name is still shared after that, step 4 puts every member of the group on its full name, as for renames (display-names "Remaining collisions show full names"), and the existing warning lists it. A dictionary can therefore not hide a signal behind another's name, and no alias disappears silently.
- `catalog.ts` also sets `info.alias` to the logical name when the entry has one (the field was unused; a DBC or diag source never sets it, so there is no conflict). Hover card, search tier 3 and concept §4 pick it up without a new field.
- Why through the display-name pipeline and not a new field the UI resolves: the UI and API search already agree on `displayName`, and collisions are solved in one place (display-names design N5/N7).

### D3 Identity and stored files stay on the source name (Q-1)

- Signals keep `<dataRef>/<source name>` in IDs, workspaces, views, links and grants. A logical name exists only in the catalog entry, the UI, the CLI's and formula editor's input and error messages.
- Why: Jan's premise (one logical name, one source name on every vehicle) makes the source name equally stable across vehicles, so a stored logical name would add nothing to portability, while it would (a) change the view format and its version, (b) break every stored view when the launcher renames or drops an entry, and (c) make a stored file depend on a dictionary that is not in the file. D-035 already put the same rule on short names.
- My first sketch (to Jan, 2026-11-06) said views store the logical name; that was wrong once the premise is "one name everywhere". Q-1 below.

### D4 Input resolution

- CLI `resolveSignal`: `nameMatches` also accepts `alias` (case-insensitive, whole text); an exact source-name match wins over an alias that equals it. The lookup uses the search (`GET /api/signals?q=`), which already ranks alias at tier 3, so the CLI needs the `alias` field of the page items only.
- Unavailable name (spec "Unavailable logical name"): when the query equals a logical name (ignoring case) and the scope's list holds no signal for its source name, the search answers its normal page plus `aliasOf: "<source name>"`; the CLI then reports `unknown_signal` with the spec's message instead of `no signal named`. Why in the search answer: one request, no extra endpoint, and the dictionary stays on the server (the UI never needs it whole). Alternative: the whole dictionary in `/api/meta`; rejected, it can hold every signal of a platform.
- Formula editor: `FormulaNames.signals` entries gain optional `alias`; `resolveName` matches it like the short name (ignoring case, ambiguity listing the canonical names). The stored text keeps canonical source names (spec "Input by logical name"). Completion ranks by the shown name already; it needs no change beyond the shown name option (D5).

### D5 The names option and the two-name display

- `Options` gains `names: "shown" | "source"` (default `shown`). The stored schema reads it with `.default("shown")` so a file without it loads; `workspace.setOptions` takes `digits?` and `names?`. The "⋯" menu gets a second radiogroup like Digits (D-112 pattern); the CLI gets `names shown|source`.
- `shownName(s)` becomes `shownName(s, names)`: `source` returns `s.name`, `shown` returns `displayName ?? name`. The web passes the option from the workspace to the explorer, legend, values window, drag ghost and axis title. Search stays server-side and always matches name, shown name and alias.
- Tooltip rule of display-names ("Shown name in the UI") already says: tooltip is the full source name where it differs. With `source` the tooltip shows the shown name (logical name or rule-made name). Hover card: first line the full source name (as today), second line the logical name when there is one.
- Why the option is in the workspace and not the browser's local storage: `digits` is, and the CLI can set it. "Per user" holds as far as workspaces are per user (user-identity).
- Alternative: a third value `alias` that shows the logical name but not rule-made names. Rejected: two choices are enough ("logical/short name" or "ADX name"); a third has no user asking for it.

### D6 Errors

- The dictionary's entry for a source name that no catalog holds is not an error anywhere (D1). It matters only to the CLI's message (D4). The UI never offers a name that is not in the list, so it has no error path.

## Risks / Trade-offs

- [The launcher writes a dictionary that collides with the shown names of the rules] → collisions fall back to full names and the log lists them (D2); the dictionary check at start covers its own consistency only.
- [A rename in the dictionary changes names users know] → by design the stored files do not change (D3); the shown name changes after a restart only.
- [`names=source` hides rule-made short names too] → two choices keep the rule simple; a user who wants short ADX names reads the rule-made name in the tooltip. Q-3.
- [`aliasOf` in the search answer tells a caller a source name it did not ask for] → only for a name the caller typed, only the mapped source name, behind the same grant guard as the search.

## Migration Plan

1. Ship; nothing changes without `KIPSCOPE_ALIASES_FILE`. Old stored workspaces read with `names: "shown"`.
2. The launcher writes the JSON file and sets the variable; restart the server.
3. Rollback: unset the variable and restart; stored files stay valid (D3).

## Questions for Jan (defaults are built unless Jan says otherwise)

- **Q-1 Stored identity.** Views, workspaces and links keep the source name (D3), not the logical name. The first sketch said the opposite; with "one logical name = one ADX name everywhere" the source name is as portable and survives dictionary edits. Alternative: store the logical name (view format change, version 2, breaks on edits).
- **Q-2 Where the dictionary comes from.** A JSON file whose path is in `KIPSCOPE_ALIASES_FILE` (D1), written by the system that starts the server. Alternative: the server fetches an URL at start.
- **Q-3 Switch values and default.** `shown` (default: logical name, else rule-made short name, else ADX name) and `source` (always the ADX name). Alternative: default `source` so nothing changes for a user until they switch.
