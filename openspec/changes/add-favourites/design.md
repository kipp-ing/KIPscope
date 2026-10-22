# Design

## Context

See proposal.md for why. What exists:

- Per-user files: `userViews(stateDir)` in `apps/server/src/views.ts` (add-multiuser M9) checks the user against `USER_ID` before it builds `<stateDir>/users/<user>/views/`; `writeAtomic` (`persist.ts`) creates the directory. Identity `none` makes every request the user `local`.
- Access levels (`guard.ts`): `user` routes need a signed-in user only; `/api/w/<id>/` prefixes are ignored on them. Saved views use `user` for list and delete.
- The live channel (`routes/workspace.ts` `/api/live`) sends `hello`, `summary`, `state` on connect, then `state` per command and `summary` per rights change; it knows its connection's user. `apps/web/src/live.ts` `applyLiveMessage` treats every message that is not `hello` or `summary` as `state`.
- The explorer list is built by `explorerItems` (`explorer/groups.ts`): headers per D-053 group, or a flat list; selection helpers in `explorer/selection.ts` key the selection by signal ID; row keys are `s:<id>`. Rows are 22 px with an empty 18 px left indent (`.explorer .row` `padding-left: 18px`). The sidebar is 248 px (208 px below a 1200 px viewport, `declutter-workspace` DW22).
- Signal IDs are `<dataRef>/<name>`; `name` is the source name (`ICL_3A2h.SPEED_DISP`), the same on every vehicle that has the signal; display names (D-035) are only shown.

## Goals / Non-goals

Goals: a star that holds per user on every vehicle and session, set in one click or key, visible at the top of the list, with no name width lost and no other row slot moved. Non-goals: everything under "Out of scope" in proposal.md; no change to how search filters or ranks.

## Decisions

### F1 Own per-user route, not a workspace command

Favourites live outside the workspace: `GET /api/favourites` and `POST /api/favourites` at access level `user`. Origin: D-102 („user bezogen"). Rejected alternatives:

- A workspace command (`favourite.toggle`): the list would sit in the workspace document, so a shared workspace would show the owner's stars to every viewer, a reader without the change right could not star, and views, links and undo would carry stars. All three contradict "per user".
- `PUT` of the whole list: a tab and the CLI writing at the same time lose one update. `add`/`remove` deltas are idempotent and never lose one.

### F2 The file

`<stateDir>/users/<user>/favourites.yaml`, user checked against `USER_ID` before a path is built (as M9):

```yaml
kipscope: favourites
version: 1
names:
  - ICL_3A2h.SPEED_DISP
  - BMS.soc
```

- Order: the order the names were starred in (D-080 "book order"); hand edits may reorder.
- Read on every request, synchronously, like `ViewStore`; a change is read, applied and written atomically (`writeAtomic`) inside one synchronous handler, so two requests cannot interleave (one Node thread). No cache: a hand edit counts from the next request.
- No file (or no directory) is the empty list. A file that does not parse (`parseFavouritesDoc` fails, YAML error, over 256 KiB) answers `GET` with `{names: [], error}` and refuses every `POST` with 409 `favourites_unreadable`, the file untouched: a hand-edited list is never overwritten by a click.
- Writing: canonical YAML of `favouritesDoc(names)` (`stringify(doc, {lineWidth: 0})`, as `viewYaml`).

### F3 Names

A favourite is the catalog entry's `name`, exact and case-sensitive, never the display name and never the data ref. `testcar/Fast_100h.SIG_A` and `othercar/Fast_100h.SIG_A` are one favourite. `FavouriteName`: 1–200 characters, no control characters, no leading or trailing whitespace.

### F4 Live push

When the app has a favourites store, every `/api/live` connection sends `{type: "favourites", names, error?}` of its own user right after the connect `state`, and again after every `POST /api/favourites` of that user that changed the list (from any tab, workspace or the CLI). A change that changes nothing pushes nothing. Without a store (test apps) the connect sequence stays `hello`, `summary`, `state`, so `access.http.test.ts` and `identity.http.test.ts` keep their expectations. The store exposes `onChange(listener)`; each connection filters by its user and unsubscribes on close.

### F5 The Favourites group

`explorerItems` gets the user's names (`favourites`, default `[]`):

- No match whose `signal.name` is a favourite: the items are exactly today's (grouped or flat).
- Otherwise a header `★ Favourites` comes first (`{kind: "group", name: FAVOURITES_GROUP, count, open, favourites: true}`), then, if open, a copy of each favourite match (`{kind: "signal", match, inFavourites: true}`), then today's items unchanged: every favourite row stays in its sender group or the flat list too.
- Order inside: while searching, rank order; with an empty query, the order of `favourites` (the file's), a name on several data refs in catalog order.
- Open: `!toggled.has(FAVOURITES_GROUP)`, with an empty query and while searching alike (D-053 closes the other groups on an empty query; the Favourites group is open, see Q-3). A query change clears `toggled` as today.
- `count`: the favourite matches shown.
- React keys: `f:<id>` for the copies, `s:<id>` as today.

### F6 The active item after a query change

While searching, the active item is the first row of the best-ranked match (`matches[0]`): its copy in the Favourites group when it is a favourite, else its row in its group. With an empty query it is the first signal row shown (now the first favourite), else the first item. Without favourites this is today's behaviour (groups are ordered by their best hit), so `Enter` still adds the top hit. Origin: necessary consequence of signal-catalog "Explorer keys" with favourites listed first.

### F7 The star button

- Placed in the row's empty 18 px left indent: the row gets `position: relative` and keeps its `padding-left: 18px`; `button.star` (first child, before the SNA dot) is `position: absolute; left: 0; top: 0`, 18 × 22 px. It takes no flex space and no gap, so dot, name, unit and `+` keep their x positions exactly (the dot starts 18 px from the row's left edge, as today). (The lead asked for a fixed-width slot; the indent is one that costs no name width, which matters at the 208 px sidebar.)
- Shown (`visibility: visible`) while the row is hovered or active, and always while starred; otherwise `visibility: hidden`, keeping its box.
- `★` in `--accent` while starred, `☆` in `--disabled` otherwise, `--accent` under the pointer. Not `--sna` amber: amber is the SNA dot's colour in the same row.
- `aria-pressed` = starred; `aria-label` and `title` from `HINTS.star(starred)`; `tabIndex={-1}` (the key acts on the active row); `pointerdown` and `click` stop propagation: no drag, no card, no change of selection or active row.
- Header `★ Favourites`: chevron, name, count like every header; `title` from `HINTS.favourites(inList, total)`; no star, no `+`, no card, no drag.

### F8 What a star click or the key acts on

The target names: the selection in list order without repeats (`selectedInOrder`, now deduplicated) when the row is selected and the selection holds two or more signals, else that one row (as D-066 L3 for `+`). `toggleFavourites(starred, names)`: if any target is not starred, add those; else remove them all. Key: `Ctrl+D`, on macOS `Cmd+D` (`isStarKey(e, mac)`: key `d` or `D`, the platform modifier, no Alt, no Shift), handled in the search field's key handler; on a signal item it acts on the active row by the rule above, on a header or an empty list it does nothing; it always calls `preventDefault`, so the browser's bookmark dialog never opens from the search. See Q-4.

### F9 Requests in the web

The web sends `POST /api/favourites` (unprefixed; `user` level) and takes its list only from the live `favourites` messages, which arrive in order on one socket. No optimistic toggle: a refused or failed request leaves every star as it was and logs the error code to the console. `LiveState.favourites` holds the last list (`undefined` until the first message: no star is shown pressed, star buttons work).

### F10 The row stays in place

After a star change re-renders the list:

- The active item stays on the same row, identified by signal ID and whether it is the Favourites copy; if that row is gone, the item now at its old index (clamped).
- After a click on a star, the list's `scrollTop` changes by the distance the clicked row moved (its `offsetTop` before and after), so the row stays under the pointer when rows are added or removed above it. After the key, the active row is kept in view as for the arrows.

### F11 CLI

- `fav list`: `GET /api/favourites`; `data {names, error?}`; no workspace.
- `fav add NAME…`: a NAME with `/` is a full ID: its part after the first `/` is taken (as "Signal references", sent unchanged). A bare NAME is looked up like "Signal references" (search of the workspace's list, name or name part after the first `.` equal ignoring case): matches with one `name` give that name, matches with several names `ambiguous_signal` (`candidates`: the names, sorted), none `unknown_signal`; nothing is sent on a refusal. Then `POST {add}`; `data {names, added}` (`added`: names that were not favourites before, in argument order); the output names `workspace` (its list resolved the names). See Q-5.
- `fav rm NAME…`: resolved against the user's list (`GET`): an exact member; else members equal ignoring case or by the part after the first `.` (one: it; several: `ambiguous_favourite` with `candidates`); else a full ID whose name is a member; none: `unknown_favourite`, nothing sent. Then `POST {remove}`; `data {names, removed}`; no workspace.
- No NAME is a usage error (exit 2); refusals exit 1 (`outcome` `rejected`).

### F12 What does not change

Workspace commands, revisions, view documents and links, the catalog and its routes, search and ranking (`packages/shared/src/search.ts`), the drag source, the hover card, the D-053 group rules.

## Pinned interfaces

### `packages/shared/src/favourites.ts` (exported from `index.ts`)

```ts
export const MAX_FAVOURITES = 1000;
export const MAX_FAVOURITE_NAME = 200;
/** 1–200 chars, no control characters, no leading/trailing whitespace (F3). */
export const FavouriteName: z.ZodType<string>;
/** Body of POST /api/favourites; strict; at least one of add/remove with one name or more. */
export const FavouritesChange = z
  .object({
    add: z.array(FavouriteName).max(MAX_FAVOURITES).optional(),
    remove: z.array(FavouriteName).max(MAX_FAVOURITES).optional(),
  })
  .strict(); // + refine: at least one non-empty
export type FavouritesChange = z.infer<typeof FavouritesChange>;
/** GET/POST answer and the live message's payload. */
export interface Favourites { names: string[]; error?: string }
export interface FavouritesDoc { kipscope: "favourites"; version: 1; names: string[] }
/** `names` without `remove`, then each `add` not yet present appended in order; never repeats. */
export function applyFavouritesChange(names: readonly string[], change: FavouritesChange): string[];
/** F8: undefined for no names; some unstarred → {add: those, in order}; else {remove: names}. */
export function toggleFavourites(starred: ReadonlySet<string>, names: readonly string[]): FavouritesChange | undefined;
/** Tolerant: unknown keys ignored, repeated names dropped (first kept). Error: kipscope not
 * "favourites", version not 1, names not an array of FavouriteName, more than MAX_FAVOURITES. */
export function parseFavouritesDoc(data: unknown): { ok: true; names: string[] } | { ok: false; message: string };
export function favouritesDoc(names: readonly string[]): FavouritesDoc;
```

`packages/shared/src/workspace.ts`: `LiveServerMessage` gains `| { type: "favourites"; names: string[]; error?: string }`.

### HTTP

| Route | Access | Answer | Errors |
|---|---|---|---|
| `GET /api/favourites` | user | 200 `Favourites` (`{names: []}` without a file; `{names: [], error}` for a broken one) | — |
| `POST /api/favourites` | user | 200 `{names}` after the change | 400 `invalid_request` (body not `FavouritesChange`), 409 `favourites_unreadable` (broken file, untouched), 422 `too_many_favourites` (result over 1000), 500 `favourites_io_failed` (write failed) |

Both are registered only when the app has a favourites store (`AppDeps.favouritesOf`), like the view routes.

### Server

```ts
// apps/server/src/favourites.ts
export class FavouriteStore { constructor(file: string); get(): Favourites; change(c: FavouritesChange): FavouritesResult }
export type FavouritesResult =
  | { ok: true; names: string[]; changed: boolean }
  | { ok: false; status: 409 | 422 | 500; code: "favourites_unreadable" | "too_many_favourites" | "favourites_io_failed"; message: string };
export interface FavouritesOf {
  (user: string): FavouriteStore; // throws for a user not matching USER_ID, before any path
  onChange(listener: (user: string, favourites: Favourites) => void): () => void;
}
export function userFavourites(stateDir: string): FavouritesOf;
// apps/server/src/app.ts: AppDeps.favouritesOf?: FavouritesOf; main.ts: userFavourites(config.stateDir)
```

### Web (internal, pinned so the tester can write tests first)

```ts
// explorer/groups.ts
export const FAVOURITES_GROUP = "★ Favourites";
export type ExplorerItem =
  | { kind: "group"; name: string; count: number; open: boolean; favourites?: true }
  | { kind: "signal"; match: SignalMatch; inFavourites?: true };
export function explorerItems(matches, searching, grouped, toggled, favourites?: readonly string[]): ExplorerItem[];
/** F6: index of the first signal item with signal ID `best`, else of the first signal item, else 0. */
export function firstSignal(items: readonly ExplorerItem[], best?: string): number;
// explorer/selection.ts: selectedInOrder lists each signal ID once (first occurrence).
// keys.ts
export function isStarKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }, mac: boolean): boolean;
// live.ts: LiveState.favourites?: string[]; applyLiveMessage sets it on {type: "favourites"} and changes nothing else.
// api.ts
export function changeFavourites(change: FavouritesChange): Promise<void>; // throws ApiRequestError
// help/hints.ts
HINTS.star(starred: boolean): string;          // "Star: keep this signal at the top of the list on every vehicle · Ctrl/Cmd+D" / "Starred: click to remove it from Favourites · Ctrl/Cmd+D"
HINTS.favourites(inList: number, total: number): string; // "Favourites: 5 of your 7 starred signals are in this list"
// help/shortcuts.ts: { group: "Signal list", keys: "Ctrl/Cmd+D", action: "Star or unstar the row or the selection" }
```

`inList`: distinct favourite names in the catalog in use; `total`: the user's favourites.

### CLI output

`fav list` → `{outcome: "ok", data: {names, error?}}`; `fav add` → `{…, workspace, data: {names, added}}`; `fav rm` → `{…, data: {names, removed}}`; refusals as every CLI refusal (`error.code`, `error.candidates` where named).

## Numbers

| Number | Value | Off by ×2 |
|---|---|---|
| `MAX_FAVOURITES` | 1000 | 500: still far above a hand-kept list (D-080: users reuse a few signals). 2000: file and live message ≤ 400 KB, still fine. Only a guard against runaway scripts. |
| `MAX_FAVOURITE_NAME` | 200 | Real names are about 10–40 characters (`DCU_1F4h.COMP_HV_Volt` 21). 100 or 400 change nothing in practice. |
| Star button | 18 × 22 px in the 18 px indent | 9 px is too small to hit; 36 px would take 18 px of name at the 208 px sidebar. The indent is the size the layout already has. |
| Grouping goal | 10,000 matches, 1,000 favourites: < 10 ms median of 5 (fails only above 50 ms) | A goal like signal-groups "Grouping without visible lag"; one `Set` lookup per match. At 20 ms ranking plus grouping would still sit inside the 50 ms goal of signal-catalog. |
| Live push delay | none set | The push follows the write in the same tick; the UI check reads "at once" as within 1 s. |

## Risks

- [A star click shifts the list under the pointer] → F10 scroll correction; UI check M2 measures it.
- [A favourite's copy and its group row are two items of one signal] → selection keyed by ID shows both selected; `selectedInOrder` deduplicates, so a drag or `+` carries it once; the range rule spans items as today.
- [A group rule names a group `★ Favourites`] → the two headers would share a toggle key. Accepted: no shipped rule makes that name.
- [`Ctrl+D` is the browser's bookmark key] → only taken while focus is in the explorer search (F8); elsewhere the browser keeps it.
- [Hand-broken file] → never overwritten (F2); the UI shows no stars and clicks change nothing; `kipscope fav list` names the error.

## Overlap with open changes

- `add-range-picker` (25 of 25 tasks ticked, not archived): deltas `design-language`, `range-picker`, `time-navigation`, `timeseries-window`; code in `bar/`, `time/`, `keys.ts`, `help/`. No spec overlap. `keys.ts`, `hints.ts`, `shortcuts.ts` are touched by both, but its work there is done: only merge order, no conflict.
- `declutter-workspace` (35 of 36 ticked, not archived): its deltas (`design-language` "Layout never moves", `guidance` "Tooltip on every control", sidebar 248/208 px) are not in the main specs yet; this change builds on them (F7 cites the 208 px sidebar; tooltips from `HINTS`). It has no `signal-catalog` or `signal-groups` delta, so the MODIFIED requirements here do not collide. Its explorer tasks (6.1 tab counts, 6.3 cut texts) are done. Archive `declutter-workspace` first so the main specs hold "Layout never moves" when this change is archived.

## Manual checks (UI user, smart451, 1440×900 and 1000×557, empty favourites at the start)

- M1 "Star by click": scenario favourites "Star a row on smart451".
- M2 "Row stays under the pointer": scenario "Row stays in place on smart451".
- M3 "Key and selection": scenario "Key and selection on smart451".
- M4 "Every session, every tab, the CLI": scenario "Stars hold across sessions and clients on smart451".
- M5 "Search": scenario "Search with favourites on smart451".
- M6 "Layout": scenario "Star slot on smart451".

## Open questions for Jan

The tasks are built on the recommendations; if Jan picks the alternative, the spec owner revises before round 1.

- **Q-1 Favourite not in this list** (session without that signal): (a) not shown; the header tooltip says `5 of your 7 starred signals are in this list` (recommended: the list only holds signals with data in the scope, D-078; a dimmed row could not be added); (b) shown dimmed, not addable.
- **Q-2 Starred row in two places**: (a) in Favourites and still in its sender group (recommended: the groups stay complete, the D-053 counts do not change with stars); (b) moved out of its group.
- **Q-3 Favourites open on the empty search** although D-053 says „Empty search: all groups, collapsed": (a) open (recommended: the point of a star is to reach the signal without typing; D-080 P1 sits „top of the explorer"); (b) collapsed like the others.
- **Q-4 Key**: (a) `Ctrl+D` / `Cmd+D` in the search (recommended: the browsers' own "bookmark with a star" key, free in KIPscope; plain letters cannot be used because the search field has the focus); (b) no key, star by click only.
- **Q-5 `kipscope fav add` with a name not in the workspace's list**: (a) refused with `unknown_signal` (recommended: catches typos; the UI can star only listed rows too); (b) stored as given, so a script can star signals of other vehicles ahead of time.
