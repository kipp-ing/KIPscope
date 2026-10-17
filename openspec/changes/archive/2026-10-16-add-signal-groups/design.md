# Design

## Context

See proposal.md (Why). Facts that shape the approach:

- **DBC parsing** (`apps/server/src/dbc.ts`): `MESSAGE = /^BO_\s+(\d+)\s+(\w+)\s*:/` keeps name and ID only; lines are split on `\r?\n`, so the CRLF files are fine. `DbcSignal` → `DbcInfo` via `dbcInfo()` in `catalog.ts`.
- **Senders on real data** (shipped `kipscope.yaml`, catalog of 428 signals, all from `h-can.dbc`): AC 21, CGW 39, Engine 63, EPS 3, ESP 64, EWM 6, SAM 35, SAS 6, SRS 13, TCU 38, YRG 23, and 117 with `Vector__XXX` (messages `DCU_*`, `HVM_*`, `DIAG_*`, `DCDC*`, `ECO_DISP_RQ`, `MEAS_DCU`). Examples: `ICL_3A2h` CGW, `ENG_5E0h` Engine, `BRK_1A0h` ESP, `CLIM_44Ch` AC, `DCU_2B8h` `Vector__XXX`. Test fixtures: every `BO_` has sender `TEST`; `Nodbc_500h.RAW` has no DBC entry. With the shipped rules (`{sender}`, then the fallback `^(?<ecu>DCU|HVM)_` → `{ecu}`, D-053 Q1): DCU 89, HVM 10, Other 18; 14 groups.
- **Project file** (`apps/server/src/project.ts`): strict zod schema; `display` holds `names` and `rename` only, so a new key is needed. Templates (`parseTemplate`, placeholder `[A-Za-z_][A-Za-z0-9_]*`), regex compile and the group list of a regex (`(?:re)|` on `""`) exist and are reused. `DisplayRules` (`names.ts`) is what `main.ts` hands to `Catalog`.
- **Catalog** (`catalog.ts`): `metadata.get(name)` per entry; display names assigned after building entries; entries sorted by name, then dataRef.
- **Explorer** (`apps/web/src/explorer/SignalExplorer.tsx`): `matches = searchSignals(index, query)` (empty query → catalog order); one `listbox` whose direct children are the rows, `rowElement(i) = listRef.children[i]`; `active` index, `shown` (chunk of `CHUNK = 500`, `visibleCount`/`nextShown` in `format.ts`); card keyed by row index; drag from `.name`; Enter adds `matches[active]`.
- **Live cursor** (`apps/web/src/chart/live.ts`): `NEAR_PX = 8`, default of `nearestSignal(…, maxPx)`.

## Goals / Non-Goals

**Goals:** the scenarios of the four delta specs with the smallest additions; every interface between `packages/shared`, `apps/server/src` and `apps/web/src` pinned below so all areas build in parallel in one round; no change for a project without group rules (flat list, no `group` field).

**Non-Goals:** remembered collapse state, group search, nested or sticky groups, the group anywhere but the explorer list, more DBC fields as placeholders.

## Decisions

### G1: Shared types (pinned, `packages/shared/src/signals.ts`)

```ts
export interface DbcInfo {
  // … existing fields …
  /** `BO_` transmitter (last token), e.g. `CGW`; absent for `Vector__XXX` or none written (D-053). */
  sender?: string;
}

export interface SignalInfo {
  // … existing fields …
  /** Explorer group from `display.groups` (D-053); absent means OTHER_GROUP. Never "Other", never blank. */
  group?: string;
}

/** Group of signals without a group (D-053); always last. */
export const OTHER_GROUP = "Other";

/** `group ?? OTHER_GROUP`. */
export function groupOf(s: Pick<SignalInfo, "group">): string {
  return s.group ?? OTHER_GROUP;
}
```

`GET /api/catalog` and `/api/signals` carry both fields through `SignalInfo`; nothing else in the payloads changes.

### G2: Sender (pinned, `apps/server/src/dbc.ts`)

`MESSAGE = /^BO_\s+(\d+)\s+(\w+)\s*:(?:\s*\d+\s+(\w+))?/`. Group 3 is the sender; `Vector__XXX` or no group 3 → absent. `DbcSignal.sender?: string` is set on every signal of that message; `dbcInfo()` copies it after `messageId` (`if (meta.sender !== undefined) dbc.sender = meta.sender`). First file wins per key as today, so the sender comes from the same file as the rest of the entry.

### G3: `display.groups` in the project file (pinned, `project.ts`, new `groups.ts`, `names.ts`)

```yaml
display:
  groups:
    - group: '{sender}'             # no match: applies to every signal; blank without sender
    - match: '^(?<ecu>DCU|HVM)_'   # optional; JavaScript RegExp without flags on the full source name
      group: '{ecu}'                # fallback for messages h-can.dbc gives no sender (D-053 Q1)
```

- Schema: `groups: z.array(z.object({ match: nonEmpty.optional(), group: nonEmpty }).strict()).nullish()` inside the strict `display` object.
- Placeholders in `group`: the named groups of `match`, plus the field `sender` (`DbcInfo.sender`). Grammar and stray-brace messages as `display.names` (`parseTemplate`).
- Problems (stage 3, collected with the name-rule problems, one line each, prefixed by the path as today):
  - `display.groups[i].match: invalid regex: <message>`
  - `display.groups[i].match: group "sender" clashes with the field {sender}` (a named group may not be called `sender`)
  - `display.groups[i].group: unknown placeholder "x" (known: sender, ecu)` — `sender` first, then the regex's groups in order
  - `display.groups[i].group: stray "{" at column n` / `stray "}" at column n`
  - structure (zod): `display.groups[i]: unknown key "k"`, missing or empty `group` or empty `match` named by field.
- Types (`apps/server/src/groups.ts`, new):

```ts
import type { Template } from "./names.ts";
export interface GroupRule { index: number; match?: RegExp; group: Template }
export interface GroupFields { sender?: string }
/** First rule that matches `name` and renders non-blank, trimmed; undefined → Other (also for a render equal to OTHER_GROUP). */
export function assignGroup(name: string, fields: GroupFields, rules: readonly GroupRule[]): string | undefined;
```

- `names.ts`: `DisplayRules` gains `groups: readonly GroupRule[]`; `NO_RULES.groups = []`. `project.ts` fills it; `main.ts` and the `Catalog` constructor stay as they are.

### G4: Rule semantics (pinned)

For each rule in order: no `match` or `match.exec(name)` matches → render `group` with `{sender: fields.sender, ...m.groups}`, a missing value renders empty → trim → non-blank wins. A blank render **falls through to the next rule** (unlike `display.names`, where an empty render stops at the full name): that is how `{sender}` gets a fallback for messages without sender. No rule left → `Other`. A render equal to `Other` is `Other` (field absent). No `display.groups` → every signal `Other` → no field anywhere.

### G5: Group per entry (pinned, `catalog.ts`)

In `load()`, per entry after the display names: `const g = assignGroup(info.name, { sender: meta?.sender }, this.rules.groups); if (g !== undefined) info.group = g;` (omit `sender` when undefined; `exactOptionalPropertyTypes`). Per entry, not per distinct name; both data references of a name get the same group since metadata is keyed by name. Sort order unchanged.

### G6: Explorer items (pinned, `apps/web/src/explorer/groups.ts`, new)

```ts
import type { SignalMatch } from "@kipscope/shared";
export type ExplorerItem =
  | { kind: "group"; name: string; count: number; open: boolean }
  | { kind: "signal"; match: SignalMatch };
/**
 * grouped false → one signal item per match, as today.
 * grouped true → per group a header, then its matches if open. Groups: on an empty query all
 * groups of the catalog, by name (`localeCompare(b, "en")`), Other last; while searching only
 * groups with a match, by the rank of their first match, Other last. Matches keep their rank order
 * inside a group. `toggled` holds group names the user flipped since the last query change:
 * open = searching ? !toggled.has(name) : toggled.has(name).
 */
export function explorerItems(matches: readonly SignalMatch[], searching: boolean, grouped: boolean, toggled: ReadonlySet<string>): ExplorerItem[];
/** Index of the first signal item, 0 when none. */
export function firstSignal(items: readonly ExplorerItem[]): number;
```

- `grouped = catalog.some((s) => s.group !== undefined)`, once per catalog load. `searching = query.trim() !== ""`. On an empty query `matches` is the whole catalog, so `count` is the group's size; while searching, its hit count.
- **Collapse state:** `toggled` is component state, cleared on every query change (so each new query starts all collapsed when empty, all open when searching, D-053). Not stored anywhere: D-053 fixes the state per query, so remembering it would contradict "empty search: all groups, collapsed"; a reload starts collapsed. Toggling also works while searching, until the next keystroke.
- **DOM:** headers and rows stay direct children of the listbox, so `listRef.children[i]` is item `i`. Header: `div.group-head[role=option][aria-expanded]`, chevron `▸`/`▾`, name, count (muted, right); same height as a row (≤ 24 px); no add button, no drag, no hover card; click toggles. Row markup unchanged.
- **Keys:** arrows move over all visible items, headers included (clamped, kept in view, as today). Enter on a row adds it; Enter on a header toggles its group and keeps the header active. After a query change the active item is `firstSignal(items)`: while searching the first row shown (the best hit outside `Other`, or the best hit when only `Other` has hits); on an empty grouped query the first header. Clicking a header makes it active.
- **Chunks:** `CHUNK`, `visibleCount` and `nextShown` apply unchanged to `items.length`; items beyond `shown` (headers included) are not rendered; "Show N more" counts items. An arrow past the last rendered item renders the next chunk as today. On real data the largest list is 442 items (428 rows + 14 headers) < 500, so the control never appears there.
- **Card:** `Card.index` is an item index and opens only on signal items; a toggle closes the card (`closeCard`), as a query change does.
- **Count line:** unchanged, counts signals (`428 matches`), not items.

### G7: Near distance (pinned, `apps/web/src/chart/live.ts`)

`NEAR_PX = 16`, comment origin D-052. Nothing else in the live cursor changes.

### Numbers: what if off by a factor of two

- **16 px near (D-052):** 8 px was Jan's „hard to see". 32 px would cover a third of a 100 px stacked axis and highlight almost always; 16 is Jan's number, not ours to tune.
- **14 groups, 442 items on real data:** twice the groups is still one screen of collapsed headers at 24 px (25+ visible, signal-catalog goal). A project with hundreds of groups would scroll, but works.
- **18 in Other (4 %):** with `{sender}` alone it would be 117 (27 %); the shipped fallback rule (Q1) moves 99 into DCU and HVM. Twice as many in Other would still be one group to open.
- **Grouping cost:** one pass over the ranked matches plus a sort of the groups; goal: 10,000 matches in 100 groups under 10 ms, so ranking plus grouping stays inside the 50 ms goal of "Filtering without visible lag". Twice the time is still invisible.
- **Chunk 500:** headers add at most one per group; twice the groups changes nothing visible.

## Risks / Trade-offs

- `Other` always last also while searching (D-053): the best hit may sit in `Other` below lower-ranked hits of named groups; Enter then adds the first row shown, not the global best hit (G6). **Decided by Jan (D-053):** „`Other` stays last while searching too; Enter adds the first row shown, even if a better hit sits in `Other`."
- Fall-through on blank renders differs from `display.names`; documented in `kipscope.example.yaml` and README.
- Arrow keys now also stop on headers; one extra keypress per group boundary while searching.

## Migration Plan

None. Without `display.groups` the catalog and the explorer are as today apart from `dbc.sender`.

## Manual checks (lead)

- `curl -s localhost:7310/api/catalog | jq -c '[.items[] | .group // "Other"] | group_by(.) | map({(.[0]): length}) | add'` on real data with the shipped file.

## Ledger entries on archive (proposed for `docs/decisions.md`)

- **Signal group conventions:** `display.groups` rules (`match` optional, `group` template over named groups and `{sender}`); a blank render falls through to the next rule; computed on the server as optional `SignalInfo.group` (absent = `Other`); the web groups only. Shipped rules: `{sender}`, then `^(?<ecu>DCU|HVM)_` → `{ecu}`. Empty search: groups by name, `Other` last, also while searching; Enter adds the first row shown; arrows include headers, Enter on a header toggles; collapse state is not remembered. `DbcInfo.sender` absent for `Vector__XXX`.

## Open Questions

- **Q1 (resolved, D-053):** with `{sender}` alone 117 of 428 real signals (27 %) would land in `Other`, because `h-can.dbc` names no sender (`Vector__XXX`) for `DCU_*`, `HVM_*`, `DIAG_*`, `DCDC*`, `ECO_DISP_RQ` and `MEAS_DCU`. Jan chose (b): the shipped `kipscope.yaml` and `kipscope.example.yaml` add the fallback rule `match: '^(?<ecu>DCU|HVM)_'`, `group: '{ecu}'` after `{sender}`: DCU 89, HVM 10, Other 18.
