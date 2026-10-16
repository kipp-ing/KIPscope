# Design

## Context

See proposal.md (Why, D-035 in full). Current state that shapes the approach:

- **Server config is env-only** (`apps/server/src/config.ts`, `loadConfig(env, root)`); relative paths resolve against the repo root (`REPO_ROOT`), as for `KIPSCOPE_DBC_FILES`. `main.ts` loads the config, builds `Catalog`, listens, then loads the catalog; `POST /api/catalog/refresh` reloads it.
- **Catalog** (`apps/server/src/catalog.ts`): `refresh()` builds one `SignalInfo` per `(dataRef, name)`, sorts by name then dataRef, and builds the shared `SearchIndex`. Tests construct `new Catalog(source, loadMetadata)`.
- **Search** (`packages/shared/src/search.ts`) runs in the server (`/api/signals`) and in the browser (explorer over `/api/catalog`). Fields: `name`, `short` (after the first `.`), `description`, `alias`, `unit`; tiers 0–3; `SignalMatch` carries highlight ranges for `name`, `unit`, `description`.
- **Real data (smart451, 428 signals, measured 2026-10-15 on `/api/catalog`):** 373 names are `MESSAGE_<hex>h.SIGNAL` (`COMBI_412h.V_ANZ`, `BS_200h.DVL`, `CPC_448h.PTC_HV_Volt`), 55 are `MESSAGE.SIGNAL` without hex ID (`AC_A1.T_SOLL`, `CG.CG_UP`, `D_RS_AC.D_RS_AC`, `VIN.*`). The part after the first `.` is unique across all 428, so real data has no collision. Longest full name 43 characters, longest part after the dot 29.
- **Synthetic test DB** (`testcar`, `othercar`): `Fast_100h.SIG_A/B/C`, `Irr_200h.JITTER`, `Sparse_300h.SLOW`, `Nodbc_500h.RAW`, `Many_700h.S0000…S0999`, `Sna_800h.SPEED/RPM/TEMP/COUNTER/STATE/MODE`; `Fast_100h.SIG_A` exists in both data references. No natural collision either; the test YAML (N8) makes them.
- **Web places that print a signal name** (`grep -rnE "\.name\b" apps/web/src`): explorer row (`explorer/SignalExplorer.tsx` ~352), hover card header (`explorer/SignalCard.tsx` ~86), chart series label and unit-less axis title (`chart/TimeseriesWindow.tsx` ~662 → `chart/build.ts`), chart legend `.sig` (`chart/TimeseriesWindow.tsx` ~1413/1444), values row `.sig` (`values/ValuesWindow.tsx` ~323/343), drag ghost (`App.tsx` ~602). Window titles are never derived from signals; the highlight label (live cursor) and readout cells print no name. The CLI prints full IDs only.

## Goals / Non-Goals

**Goals:**
- One place computes shown names: the server, once per catalog load. The web reads one optional field and one shared helper; it never evaluates rules.
- Signal identity unchanged: `id`, `name`, workspace state, commands, render acknowledgement, CLI arguments and output.
- A broken project file is found at start, not as silently wrong names.
- Rule semantics are pure functions with pinned inputs (`names.ts`, `project.ts`), unit-tested without a database.

**Non-Goals:**
- No reload without restart; no UI to edit names; no per-data-reference rules; no other settings in the YAML (proposal "Out of scope").

## Decisions

### N1: Where the file comes from (`apps/server/src/config.ts`)

`Config` gains:

```ts
/** Project file (D-035). Default `<repo root>/kipscope.yaml`, optional; `KIPSCOPE_PROJECT_FILE` overrides it and must exist. */
projectFile: { path: string; required: boolean };
```

- `KIPSCOPE_PROJECT_FILE` unset or empty → `{ path: resolve(root, "kipscope.yaml"), required: false }`.
- Set → `{ path: isAbsolute(v) ? v : resolve(root, v), required: true }`.
- A missing optional file means "no rules": every signal shows its full name (D-035 „no file … shows the full name as today"); the server logs `info` `project file <path> not found; signals show their full names`. A missing required file stops the server (N6): someone named a file explicitly, so its absence is a mistake.
- The file is read once, in `main.ts`, before `app.listen`. `POST /api/catalog/refresh` reuses the compiled rules; editing the file takes effect on restart only (D-035 says nothing about reload; restart is enough for a file edited a few times per project).

### N2: File format (pinned)

```yaml
display:
  names:            # ordered; the first rule whose match finds the full source name wins
    - match: '^(?<message>[^.]+?)_[0-9A-Fa-f]+h\.(?<signal>.+)$'   # JavaScript RegExp, no flags
      show: '{signal}'                                              # template over named groups
      collision: '{signal} ({message})'                             # optional, used only on a collision
  rename:           # full source name (without data reference) → shown name; beats every rule
    COMBI_412h.V_ANZ: Speed
```

- Top level: only `display` (optional). `display`: only `names` (optional list) and `rename` (optional map). Rule: only `match`, `show` (both required) and `collision` (optional). Any other key is an error (N6) — a misspelt `renames:` or `colision:` would otherwise be ignored silently.
- An empty file, or one with only comments, is valid and has no rules.
- `match` is compiled with `new RegExp(match)` (no flags: case-sensitive, not anchored unless the pattern anchors). It runs on the source name without the data reference.
- `rename` keys are full source names, valid for every data reference; values must contain a non-space character. A key that matches no signal is not an error (the catalog changes; the file may name signals of another vehicle).
- Parsing: library `yaml` (eemeli/yaml), exact version `2.8.1`, added to `apps/server/package.json` `dependencies` like the other pinned deps; `parse(text, { uniqueKeys: true })` so a duplicate key (e.g. the same rename twice) is a syntax error. Validation: the server's existing `zod` (`.strict()` objects).

### N3: Templates (pinned)

- Grammar: literal text and placeholders `{name}`, `name` = `[A-Za-z_][A-Za-z0-9_]*`. Any other `{` or `}` is an error ("stray brace"); there is no escape (signal names need none).
- Every placeholder must name a named group of the same rule's `match`. The group names are read by running `new RegExp("(?:" + match + ")|").exec("")`: the empty alternative always matches, and `groups` then lists every named group of the pattern (values `undefined`); no hand-written parse of the pattern.
- Rendering replaces each placeholder with the group's captured text, `""` when the group did not take part.
- A `show` that renders to `""` (after trim) counts as "rule gives no name": the signal shows its full name (no later rule is tried — first match wins, D-035). A `collision` that renders to `""` counts as absent.

Compiled form, shared by `project.ts` (producer) and `names.ts` / `catalog.ts` (consumers):

```ts
// apps/server/src/names.ts
export type Template = readonly (string | { group: string })[];
export interface DisplayRule {
  index: number;          // position in display.names, for messages
  match: RegExp;
  show: Template;
  collision?: Template;
}
export interface DisplayRules {
  rules: readonly DisplayRule[];
  rename: ReadonlyMap<string, string>;
}
export const NO_RULES: DisplayRules; // { rules: [], rename: new Map() }

export function renderTemplate(t: Template, groups: Record<string, string | undefined> | undefined): string;

export interface DisplayResult {
  /** Source name → shown name; every input name is a key (shown === name when unchanged). */
  shown: Map<string, string>;
  /** Source names that show their full name because of a collision left after N5 step 3, sorted. */
  fellBack: string[];
}
/** Pure; `names` are distinct source names (without data reference), any order. */
export function assignDisplayNames(names: readonly string[], rules: DisplayRules): DisplayResult;
```

### N4: Shown name of one signal (D-035)

For source name `n`:
1. `rename.get(n)` exists → that value (kind `rename`).
2. Else the first rule whose `match.exec(n)` succeeds → `render(show)`; empty → `n` (kind `rule` with the rule kept for N5, or `none` when empty).
3. No rule matches → `n` (kind `none`).

### N5: Collisions

A collision is one shown name held by two or more **different source names**. The same source name in two data references (`testcar/Fast_100h.SIG_A`, `othercar/Fast_100h.SIG_A`) is not a collision: both have the same name today and stay alike. The check runs over the whole catalog (all data references), because one window can hold signals of several.

1. Compute N4 for every distinct source name.
2. Group by shown name (exact, case-sensitive).
3. In every group with ≥ 2 members, each member of kind `rule` whose rule has a non-empty `collision` render shows that render (`V_ANZ (COMBI)`). Members of kind `rename` or `none` keep their name: a rename is the user's explicit choice, a full name cannot be shortened further (Q2).
4. Repeat until no shown name is held by two source names: every member of a shared name that does not already show its own full name switches to its full name and goes into `fellBack`. Terminates: each pass moves at least one signal to its full name, and full names are distinct.

Rejected alternatives for step 4: a counter suffix (`V_ANZ (COMBI) #2`) invents a name that appears nowhere in the source; dropping the rule only for one of the pair makes the result depend on catalog order.

The helper `warnDisplayFallbacks` logs once per catalog load (at startup in `main.ts` and after a successful `POST /api/catalog/refresh` in `routes/signals.ts`), when `fellBack` is not empty: `warn` `display names: <n> signals show their full name because their shown names collide: <first 10, comma-separated>`.

### N6: Invalid file stops the server (pinned messages)

`apps/server/src/project.ts`:

```ts
export class ProjectFileError extends Error {}   // message: one or more lines "<path>: <field>: <problem>"
/** Reads, parses, validates and compiles; NO_RULES for a missing optional file. Throws ProjectFileError. */
export function loadProjectFile(file: { path: string; required: boolean }): DisplayRules;
/** Pure part, for tests: text → rules. `path` only labels the messages. */
export function parseProjectFile(text: string, path: string): DisplayRules;
```

`main.ts` calls `loadProjectFile(config.projectFile)` before building the catalog; on `ProjectFileError` it writes `kipscope: invalid project file` and the message to stderr and exits with code 1, before `listen` (no port is opened, no ClickHouse query is sent). Checks run in three stages; a stage with problems reports all of its problems, one per line, and stops: (1) YAML syntax, (2) structure (keys, types, empty values: every zod issue), (3) regexes and templates of every rule. Fields are written as paths: `display.names[1].show`, `display.rename.COMBI_412h.V_ANZ`.

| Problem | Message after `<path>: ` (problem text pinned up to the colon) |
|---|---|
| YAML syntax, duplicate key | `yaml: <library message incl. line and column>` |
| Unknown key | `<field>: unknown key "<key>"` |
| Missing or empty `match`/`show`, non-string, list instead of map | `<field>: <zod message>` |
| Invalid regex | `display.names[<i>].match: invalid regex: <RegExp message>` |
| Placeholder names no group | `display.names[<i>].<show\|collision>: unknown group "<g>" (groups: <comma list or none>)` |
| Stray brace | `display.names[<i>].<show\|collision>: stray "<{ or }>" at column <c>` (1-based) |
| Empty rename value | `display.rename.<key>: empty name` |
| Required file missing | `file not found` (field part omitted: `<path>: file not found`) |

Warn-and-continue was rejected (Q1): a typo would silently leave every name long or wrong, and the only place to notice it would be the server log.

### N7: Catalog and DTO (pinned interface between server and web)

`packages/shared/src/signals.ts`:

```ts
export interface SignalInfo {
  // …unchanged fields…
  /** Name the UI shows (D-035); absent when it equals `name`. Never used as identity. */
  displayName?: string;
}
/** `displayName ?? name`. */
export function shownName(s: Pick<SignalInfo, "name" | "displayName">): string;
```

- Absent-when-equal follows the catalog rule "missing fields are absent" and keeps existing `toEqual` tests and catalog snapshots unchanged when no file is loaded.
- `Catalog` constructor gains a third optional parameter `rules: DisplayRules = NO_RULES`. `refresh()` calls `assignDisplayNames` on the distinct names after building the entries and sets `info.displayName = shown` where `shown !== name`. It keeps `fellBack` in a public read-only property `displayFallbacks: readonly string[]` for the log line. Catalog order (name, then dataRef) is unchanged (Q3).
- `GET /api/signals` and `GET /api/catalog` return the field as part of each item; nothing else changes in the API. Example: `{"id":"smart451/COMBI_412h.V_ANZ","dataRef":"smart451","name":"COMBI_412h.V_ANZ","displayName":"V_ANZ",…}`.

### N8: Search with the shown name (`packages/shared/src/search.ts`)

- `Fields` gains `shown` (lower-cased `shownName(s)`).
- Tiers (signal-catalog "Search ranking"): 0 a term equals name, short or shown; 1 one of them starts with it; 2 name or shown contains it; 3 description, alias or unit contain it. The shown name ranks like the name, as D-035 asks („search matches full name, short name and message alike"). The message is matched through the full name (every name contains its message: `combi` is tier 1 for `COMBI_412h.V_ANZ`); no separate field.
- `SignalMatch` gains `shown: MatchRange[]`: ranges in `shownName(signal)` (lower-cased like the others; `[]` for an empty query). The explorer row highlights `shown`; the card keeps `name`.
- The CLI's bare-name lookup (`apps/cli/src/refs.ts` `nameMatches`) is unchanged: it filters the search result by name or part after the first `.`, so a shown name that differs from both (a rename) does not resolve there (out of scope).

### N9: Shown name in the UI (`apps/web/src`)

| Place | File | Shows | Tooltip of the name |
|---|---|---|---|
| Explorer row | `explorer/SignalExplorer.tsx` | `shownName(s)`, highlight `m.shown` | `s.name` when `displayName` is present |
| Hover card header | `explorer/SignalCard.tsx` | `signal.name`, highlight `match.name` (unchanged) | — |
| Chart legend `.sig` | `chart/TimeseriesWindow.tsx` | `shownName(meta)` | `meta.name` when `displayName` is present |
| Series label, unit-less axis title | `chart/TimeseriesWindow.tsx` (`SignalInput.label`) | `shownName(meta)` | — |
| Values row `.sig` | `values/ValuesWindow.tsx` | `breakable(shownName(meta))` | `meta.name` when `displayName` is present |
| Drag ghost | `App.tsx` (`Drag.label`) | `shownName(info)` | — |

Without catalog metadata every place keeps today's fallback, the signal ID. The tooltip goes on the name element itself, so it beats the grip's "Drag onto another window" and the row's description only over the name.

### N10: smart451 file (repo root `kipscope.yaml`, pinned)

```yaml
# KIPscope project file (D-035). See kipscope.example.yaml. Restart the server after editing.
display:
  names:
    # COMBI_412h.V_ANZ -> V_ANZ; on a collision V_ANZ (COMBI)
    - match: '^(?<message>[^.]+?)_[0-9A-Fa-f]+h\.(?<signal>.+)$'
      show: '{signal}'
      collision: '{signal} ({message})'
    # AC_A1.T_SOLL -> T_SOLL; on a collision T_SOLL (AC_A1)
    - match: '^(?<message>[^.]+)\.(?<signal>.+)$'
      show: '{signal}'
      collision: '{signal} ({message})'
```

Checked against the real catalog (Python `re`, same semantics for these patterns): 373 signals take rule 1, 55 rule 2, 0 none, 428 distinct shown names; `SAS_0C2h.LWS_CHKSUM` → `LWS_CHKSUM` (message `SAS`). `kipscope.example.yaml` holds the same rules plus a commented `rename` example and one comment per key. The test fixture `apps/server/test/fixtures/kipscope.test.yaml`:

```yaml
display:
  names:
    - match: '^(?<message>[A-Za-z]+)_[0-9A-Fa-f]+h\.(?<signal>[A-Z]+)_[A-Z]$'
      show: '{signal}'
      collision: '{signal} ({message})'
    - match: '^(?<message>[A-Za-z]+)_[0-9A-Fa-f]+h\.(?<signal>.+)$'
      show: '{signal}'
      collision: '{signal} ({message})'
  rename:
    Irr_200h.JITTER: SPEED
```

Expected on the test DB: `Fast_100h.SIG_A/B/C` → `SIG` (3 names) → `SIG (Fast)` (still 3) → full names, no `displayName`, all three in `displayFallbacks`; `Irr_200h.JITTER` → `SPEED` (rename); `Sna_800h.SPEED` → `SPEED` collides with the rename → `SPEED (Sna)`; `Sna_800h.RPM` → `RPM`; `Many_700h.S0001` → `S0001`; `Nodbc_500h.RAW` → `RAW`; `Sparse_300h.SLOW` → `SLOW`.

### Numbers: what if off by a factor of two

- **Rule evaluation cost:** catalog size × rules regex runs per catalog load (428 × 2 on real data; 10,000 × 10 would be 10⁵ runs, a few ms). Twice as many signals or rules: still far below the catalog's ClickHouse query time.
- **Search goal 50 ms for 10,000 signals:** the shown field adds at most one equality, one prefix and one substring test per term and signal; even a doubled ranking time stays within the goal measured today (the test "ranks 10,000 signals in under 50 ms" guards it).
- **Payload:** `displayName` adds about 20 bytes × 428 ≈ 9 kB to `/api/catalog`; doubled, still one small response loaded once.
- **Name length:** shown names on smart451 are ≤ 29 characters (full ≤ 43); a collision suffix adds the message plus 3 characters (≤ 19 on smart451: `PNHV_ENERGY_CONS`; rule 1 strips the hex ID, so `(COMBI_510h)` cannot occur). Twice as long still fits the existing one-line row (ellipsis) and the auto-width legend grid.
- **Collision passes (N5 step 4):** at most the number of colliding names; real data has 0 collisions.

## Risks / Trade-offs

- [A shown name hides which message a signal comes from] → the hover card and the name's tooltip show the full name; search still matches the message.
- [Two vehicles in one window with the same short name] → same as today (same full name, no collision); the data reference is in the card.
- [Catalog order is by full name, rows show short names] → the empty-query list looks grouped by message, not alphabetical by what is shown (Q3).
- [An unresolved collision makes a name long again] → logged as `warn` with the names, so the YAML author can add a rename.

## Open Questions

Built as recommended until Jan decides.

- **Q1: Invalid project file — refuse to start or warn?** Recommended: refuse to start with the messages of N6 (a typo otherwise ships wrong names silently). Alternative: log the errors and run with full names.
- **Q2: A rename collides with a rule-made name.** D-035 says "both show the short name plus a message suffix"; a renamed signal has no rule and thus no suffix template. Recommended: the rename stays as written, the rule-made names in the group get their suffix (N5 step 3); if still shared, both fall back to full names. Alternative: a rename involved in a collision always falls back to its full name.
- **Q3: Order of the empty-query list.** Recommended: keep the catalog order by full name (stable, same as API and CLI, keeps signals of one message together). Alternative: sort by shown name, which changes `/api/signals` order and the ranking ties.
- **Q4: Shorten the 55 smart451 names without hex ID** (`AC_A1.T_SOLL` → `T_SOLL`)? Recommended: yes (rule 2 of N10), Jan's „no one is interested in hex" is about the message prefix as a whole and the short parts are unique. Alternative: rule 1 only, these 55 keep their full names.
