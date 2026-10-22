# Proposal

## Why

Jan (D-102): „Favourits sind persönlich mit Sternchen markierte. die sollten user bezogen bleiben"; he agreed to keep them by signal name without data ref, so a star holds on every vehicle and session. Favourites are the hand-kept part of a user's signal book (D-080: „die meisten nutzer nehmen immer die gleichen signale, nur jeder halt andere"); the learned book stays in a later `add-signal-books`.

## What Changes

- **Favourites per user** (D-102): a list of signal names (the catalog's `name`, no data ref) per user in `<stateDir>/users/<user>/favourites.yaml`, next to the user's views; identity `none` → the user `local`. A favourite whose name is not in the current signal list stays stored and is not shown.
- **Own route, not a workspace command** (design F1): `GET /api/favourites` and `POST /api/favourites {add, remove}`, access level `user`. Favourites are not workspace state: they have no revision, are not in views, links or undo, and a shared workspace shows every viewer their own stars; a viewer with only the read right can still star.
- **Live push** (design F4): every live connection gets its own user's favourites on connect and after each change of them, so the UI follows a change from another tab or the CLI at once.
- **Explorer** (design F5–F9): a star button per row in the row's left indent (no name width lost), shown on hover and on the active row, always while set; a "★ Favourites" group at the top of the list, above the D-053 groups, open; `Ctrl+D` (`Cmd+D` on macOS) stars or unstars the active row; on a selection of two or more rows, the star and the key act on the whole selection (D-066). Search filters and ranks as today; after a query change the best hit is still the active row. A starred row also stays in its sender group.
- **CLI** (concept §7): `kipscope fav list`, `fav add NAME…`, `fav rm NAME…`.
- **Docs**: `docs/http-api.md` (two routes, the live message), `docs/manual.md` (stars), README CLI reference.

## Capabilities

### New Capabilities

- `favourites`: each user's starred signal names: storage, HTTP routes, live push, the star in the explorer, the Favourites group and its keys.

### Modified Capabilities

- `signal-groups`: "Grouped explorer list" and "Group collapse" make room for the Favourites group above the groups (also above a flat list).
- `signal-catalog`: "Explorer keys" names `Ctrl/Cmd+D` and keeps the best hit active after a query change when favourites come first.
- `cli`: new requirement "Favourite commands".

## Out of scope

- The learned book, book files (`books/<name>.yaml`), priorities P1–P3 and the finder's inline book (D-080; `add-signal-books`).
- Favourites per data ref or per vehicle, shared or team favourites, favourites in views or links (D-102: per user, by name).
- Showing favourites that are not in the current signal list (dimmed rows); reordering favourites in the UI (the file keeps the order they were starred in; it can be edited by hand).
- A star in the hover card, the legend or the values window; starring from a window.
- Computed signals (D-102, `add-computed-signals`).

## Impact

- `packages/shared`: new `favourites.ts` (types, limits, pure helpers), `LiveServerMessage` gains `favourites`.
- `apps/server/src`: new `favourites.ts` (per-user store), `routes/favourites.ts`, live channel push in `routes/workspace.ts`, wiring in `app.ts` and `main.ts`; `docs/http-api.md`.
- `apps/web/src`: `explorer/groups.ts`, `explorer/selection.ts`, `explorer/SignalExplorer.tsx`, `styles.css`, `live.ts`, `api.ts`, `keys.ts`, `help/hints.ts`, `help/shortcuts.ts`, `App.tsx` (passing favourites down); `docs/manual.md`.
- `apps/cli/src`: `args.ts`, `run.ts` (or a new `favourites.ts`); README CLI reference.
- No change to workspace commands, view documents, the data source or the catalog.
