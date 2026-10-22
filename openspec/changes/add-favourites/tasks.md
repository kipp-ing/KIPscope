# Tasks

Built on the recommendations of design.md Q-1 (not shown), Q-2 (also in its group), Q-3 (open on the empty search), Q-4 (`Ctrl/Cmd+D`) and Q-5 (`fav add` refuses unknown names); if Jan picks an alternative, the spec owner revises before round 1.

Every interface two groups share is pinned in design.md "Pinned interfaces" (`packages/shared/src/favourites.ts`, the live message, the HTTP routes, the web helpers the tester calls), so groups 1–5 run in parallel; groups 2–4 compile against the pinned shapes while group 1 lands.

Write areas (disjoint per group):

- 1.x: `packages/shared/src/favourites.ts` (new), `packages/shared/src/index.ts`, `packages/shared/src/workspace.ts` (`LiveServerMessage` only)
- 2.x: `apps/server/src/favourites.ts` (new), `apps/server/src/routes/favourites.ts` (new), `apps/server/src/routes/workspace.ts` (live channel only), `apps/server/src/app.ts`, `apps/server/src/main.ts`, `docs/http-api.md`
- 3.x: `apps/web/src/explorer/`, `apps/web/src/styles.css`, `apps/web/src/live.ts`, `apps/web/src/api.ts`, `apps/web/src/keys.ts`, `apps/web/src/help/hints.ts`, `apps/web/src/help/shortcuts.ts`, `apps/web/src/App.tsx`, `docs/manual.md`
- 4.x: `apps/cli/src/`, `README.md` (CLI reference only)
- 5.x: `packages/shared/test/`, `apps/server/test/`, `apps/cli/test/`, `apps/web/test/` (tester)

## 1. packages/shared

- [ ] 1.1 `favourites.ts` as pinned: `MAX_FAVOURITES`, `MAX_FAVOURITE_NAME`, `FavouriteName`, `FavouritesChange` (strict, at least one non-empty list), `Favourites`, `FavouritesDoc`, `applyFavouritesChange`, `toggleFavourites`, `parseFavouritesDoc`, `favouritesDoc`; exported from `index.ts`; `LiveServerMessage` gains `{type: "favourites"; names; error?}`. Verify: scenarios "Document rules", "Change rules", "Toggle rule" (`packages/shared/test/favourites.test.ts`); `pnpm --filter @kipscope/shared build`.

## 2. apps/server/src

- [ ] 2.1 `favourites.ts`: `FavouriteStore` (F2: sync read, missing file = `[]`, broken file → `{names: [], error}` and `change` refuses 409 `favourites_unreadable` untouched, 256 KiB cap, result over 1000 → 422 `too_many_favourites`, write failure → 500 `favourites_io_failed`, canonical YAML via `writeAtomic`, `changed` false when the list is the same) and `userFavourites(stateDir)` (cached per user, `USER_ID` checked before any path, `onChange` listeners called after each changed write, a throwing listener does not fail the write). Verify: scenarios "File in the user's folder", "Broken file is kept" (`favourites.http.test.ts`).
- [ ] 2.2 `routes/favourites.ts`, `app.ts`, `main.ts`: `GET` and `POST /api/favourites` at level `user`, body parsed with `parseInput(FavouritesChange)`, registered only with `AppDeps.favouritesOf`; `main.ts` passes `userFavourites(config.stateDir)`. Live channel in `routes/workspace.ts` (F4): with a store, send `{type: "favourites", …}` of the connection's user after the connect `state`, subscribe to `onChange` filtered by user, unsubscribe on close. `docs/http-api.md`: the two route rows (access `user`, `add`/`remove`, the errors) and the `favourites` message in "Live channel". Verify: scenarios "Favourites per user", "Refused bodies", "Shared workspace, own stars", "Push to every tab of the user", "Routes documented", "Live message documented"; `access.http.test.ts` and `identity.http.test.ts` unchanged and green.

## 3. apps/web/src

- [ ] 3.1 Pure parts as pinned: `explorer/groups.ts` (`FAVOURITES_GROUP`, the `favourites` and `inFavourites` item fields, `explorerItems(…, favourites)` per F5, `firstSignal(items, best?)` per F6), `explorer/selection.ts` (`selectedInOrder` without repeats), `keys.ts` (`isStarKey`), `help/hints.ts` (`HINTS.star`, `HINTS.favourites`), `help/shortcuts.ts` (`Ctrl/Cmd+D` in "Signal list"), `live.ts` (`LiveState.favourites`; `applyLiveMessage` handles `favourites` before its state branch), `api.ts` (`changeFavourites`). Verify: scenarios "Group order and copies", "One name on every data ref", "No visible lag", "Groups unchanged below the Favourites group", "Flat list with favourites", "Best hit stays active with favourites", "Star key", "Starred row once in a selection", "Header tooltip", "Live state in the web".
- [ ] 3.2 `explorer/SignalExplorer.tsx`, `styles.css`, `App.tsx`: prop `favourites` from `live.favourites`; `button.star` per F7 (first child, absolutely placed in the 18 px indent, 18 × 22 px, row padding unchanged, `visibility` rule, glyphs and colours, `aria-pressed`, `title`/`aria-label` from `HINTS.star`, `tabIndex={-1}`, propagation stopped); header `★ Favourites` with `HINTS.favourites(inList, total)`; React keys `f:<id>` for copies; click and `Ctrl/Cmd+D` per F8 through `toggleFavourites` and `changeFavourites` (no optimistic change; error code to the console; `preventDefault` on the key in the search); active item after a query change from `firstSignal(items, best)`; F10 (active row kept by ID and copy flag, else the old index clamped; `scrollTop` corrected by the clicked row's moved `offsetTop`). Verify: scenarios "Star markup" (`explorer.test.ts`), UI in 6.1.
- [ ] 3.3 `docs/manual.md` "Find a signal": the star (hover, click, per user, by name on every vehicle and session), the Favourites group at the top, `Ctrl/Cmd+D`, a selection stars together, the CLI `kipscope fav`. Verify: scenario "Manual and keys"; `manual.test.ts` green.

## 4. apps/cli/src

- [ ] 4.1 `args.ts`, `run.ts` (or a new `favourites.ts`), usage text: `fav list`, `fav add NAME…`, `fav rm NAME…` per F11 (full ID → name part; bare name through the search like `resolveSignal`, distinct names decide `ambiguous_signal`/`unknown_signal`; `rm` against the list with `unknown_favourite`/`ambiguous_favourite`; nothing sent on a refusal; outputs as pinned, `workspace` only on `add`). `README.md` CLI reference: the three forms. Verify: scenarios "Forms", "Add, list, remove over HTTP", "Refusals"; cli "Usage" stays green.

## 5. Tests (tester, test-first from the scenarios)

- [ ] 5.1 `packages/shared/test/favourites.test.ts` › "parses the favourites file tolerantly", "applies a change: removes, then appends new names once", "toggles a selection: adds unless all are starred".
- [ ] 5.2 `apps/server/test/favourites.http.test.ts` › "stores favourites per user in the state dir", "keeps favourites per user", "leaves a broken file untouched", "refuses bad changes", "lets a reader of a shared workspace star their own", "pushes favourites on the live channel" (test identity adapter of `identityApp.ts`, temp state dir, an app with `favouritesOf`); `apps/server/test/docs.test.ts` › "documents every HTTP route" builds its app with a favourites store.
- [ ] 5.3 `apps/cli/test/args.test.ts` › "maps the fav forms"; `apps/cli/test/cli.test.ts` › "adds, lists and removes favourites", "refuses unknown and ambiguous favourite names" (test server with a temp state dir and a favourites store).
- [ ] 5.4 `apps/web/test/explorer.test.ts` › "puts favourites in a group at the top", "matches favourites by name on every data ref", "keeps the best hit active when favourites come first", "renders a star button in every row", "groups 10,000 matches with 1,000 favourites in under 10 ms" (goal: logs, fails only above 50 ms); `selection.test.ts` › "lists a starred row once in the selection"; `keys.test.ts` › "maps Ctrl/Cmd+D to the star"; `livestate.test.ts` › "keeps favourites apart from the workspace state"; `hints.test.ts` samples for `HINTS.star(true|false)` and `HINTS.favourites(5, 7)`. Verify all: `pnpm build && pnpm test && pnpm lint`.

## 6. UI check (UI user, smart451, design "Manual checks")

- [ ] 6.1 M1–M6 at 1440×900 (M6 also at 1000×557), starting with an empty favourites list (`kipscope fav list` prints `[]`; remove leftovers with `kipscope fav rm`): scenarios "Star a row on smart451", "Star slot on smart451", "Search with favourites on smart451", "Key and selection on smart451", "Row stays in place on smart451", "Stars hold across sessions and clients on smart451", signal-catalog "Enter adds the top hit with a favourite above it"; one screenshot per scenario, the snippet outputs where named.

## Workflow follow-up

- Archive after `declutter-workspace` (design "Overlap with open changes").
- On archive: D-102's answers to Q-1 … Q-5 go to `docs/decisions.md` if Jan decides any of them.
