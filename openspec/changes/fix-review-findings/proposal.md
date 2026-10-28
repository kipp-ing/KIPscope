# Proposal

## Why

The review day of 2026-10-28 checked every main spec against the code and found 14 bugs where the code breaks a requirement the specs already state ([docs/todo.md](../../../docs/todo.md) "Bugs"), plus four doc and cleanup items. Jan: „ja loslegen". T-01 is the only medium one: with a catalog open, "Back" after `[` / `]` pops another session's range, because `App.tsx` never passes the catalog index that `historyKey` takes (add-case-open K7). The others are low: a command that lets any caller name the saved view, a preview that skips the grant check, a reuse race against a catalog open, a cached edge point outside the scope, Esc that misses the range picker, a ghost cursor line, Caps Lock, a CLI race, highlight offsets, an icon colour, two CLI nits. D-115 and D-116 are current and stay as they are.

## What Changes

- **T-01 Zoom history per session:** every history and pending-navigation key in `App.tsx` comes from one helper that adds the open catalog's current index while linked (case-navigation "Zoom history per session").
- **T-02 No `view.markSaved` through `POST /api/commands`:** refused with 400 `invalid_command` like a named `view.open` (workspace-state "View names only from the store").
- **T-03 Preview checks the grant:** `GET /api/case/preview` refuses an entry whose data ref the workspace's grant does not cover with 403 `forbidden_data`, before any load (case-preload "Neighbour preview").
- **T-04 A catalog open claims its workspace:** the workspace `POST /api/workspaces {open: {cases}}` is filling is never handed to a `{reuse: true}` and never evicted at the limit (workspaces "A new tab never mirrors another").
- **T-05 Edge points stay inside the scope:** a cached raw tile served under another scope drops a `before` / `after` point that lies outside that scope (series-cache "Tiles kept across scopes").
- **T-06 Esc closes the range picker wherever focus is** (range-picker "Apply and cancel").
- **T-07 No ghost cursor line:** a window that closes while a cursor click waits for the double-click interval drops the click and ends its preview (cursors "Placing cursors by click").
- **T-08 Shift+A / Shift+B with Caps Lock** (cursors "Keys bring a cursor into view").
- **T-10 CLI `state` asks one workspace:** the render status is requested after the workspace answer (cli "One workspace per call").
- **T-11, T-12 Highlight ranges:** overlapping occurrences of one term are all marked; ranges index the original string also where a character's lower case has another length (signal-catalog "Match highlighting").
- **T-13 Sidebar button icon in slate-700** (design-language "Controls").
- **T-14 CLI nits:** an open-ended argument count reads "at least N"; `calc add|edit --name ""` is a usage error, nothing sent (cli "Exit codes", "Computed signal commands").
- **Docs and cleanup:** `docs/http-api.md` and the `apps/server/src/http.ts` comment name `GET /api/calendar` among the routes that honour `X-KIPscope-Class` (case-preload "Preload class" gains it, as D-116 says); README CLI table rows for `digits 3|4` and `events list|filter|add|remove` and the output-key sentence with `workspace` and `removedWindow`; dead `SPAN_PRESETS` and `formatRange` (D-092) and the `formatRange` tests removed.
- The `docs/status.md` item ("strip … bars") needs nothing: the "What runs" row already reads "Data density and drives" (checked 2026-10-28).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `case-navigation`: "Zoom history per session" names the key and the unlinked case, with a helper test and a UI check.
- `workspace-state`: "View names only from the store" also refuses `view.markSaved` at the command endpoint.
- `case-preload`: "Neighbour preview" checks the grant; "Preload class" lists `/api/calendar`.
- `workspaces`: "A new tab never mirrors another" covers a workspace a catalog open is filling.
- `series-cache`: "Tiles kept across scopes" drops edge points outside the asking scope.
- `range-picker`: "Apply and cancel" closes on Esc after focus left the picker.
- `cursors`: "Placing cursors by click" drops a waiting click on close; "Keys bring a cursor into view" holds with Caps Lock.
- `cli`: "One workspace per call" covers `state`; "Exit codes" names the open-ended usage text; "Computed signal commands" refuses an empty NAME locally.
- `signal-catalog`: "Match highlighting" pins overlapping and length-changing cases.
- `design-language`: "Controls" checks the icon colour of the sidebar button.

## Impact

- `packages/shared/src/search.ts`
- `apps/server/src/routes/workspace.ts`, `apps/server/src/routes/case.ts`, `apps/server/src/routes/workspaces.ts`, `apps/server/src/workspaces.ts`, `apps/server/src/http.ts` (comment)
- `apps/web/src/App.tsx`, `apps/web/src/chart/zoom.ts`, `apps/web/src/chart/cache.ts`, `apps/web/src/chart/cursors.ts`, `apps/web/src/chart/TimeseriesWindow.tsx`, `apps/web/src/keys.ts`, `apps/web/src/bar/RangePicker.tsx`, `apps/web/src/styles.css`, `apps/web/src/bar/bar.ts`, `apps/web/src/time/axis.ts`
- `apps/cli/src/run.ts`, `apps/cli/src/args.ts`
- `docs/http-api.md`, `README.md`
- Tests in `packages/shared/test`, `apps/server/test`, `apps/web/test`, `apps/cli/test`
- No new HTTP route, no payload change, no new shared type; one new 403 answer on `GET /api/case/preview` and one new 400 on `POST /api/commands`.

## Out of scope

- **T-09** (unlinked session-bar tooltip lines): waits for Jan's answer to Q-07.
- Every open question in todo.md: **Q-03** (`_previous` on every `view.open`), **Q-05** (display names of a scoped list), **Q-06** ("One primary per surface"), **Q-07** (unlinked tooltip), **Q-08** (dated smart451 counts), **Q-09** (plain-signal NaN/±Infinity as SNA), **Q-10** (cached event lists after a server catalog reload), and the "Minor, no action unless you say so" list.
- Other letter keys under Caps Lock (`t`, `p` and `n` arrive upper case); only Shift+A / Shift+B are in T-08.
- Committing a waiting cursor click when its window closes (the fix drops it).
- A zoom history that survives a page reload or another catalog opened in the same tab.
- Any other bug, refactor or wording change.
