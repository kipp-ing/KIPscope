# Todo

Bugs and open questions from the review day of 2026-10-28: every main spec (and the unsynced deltas of `add-range-picker`) checked against the code. Spec drift where the code was right was fixed in the specs in the same commit; what is below needs code or a decision. UI and Docker-backed scenarios were judged by code reading only unless a line says otherwise.

## Bugs

Fixed by `fix-review-findings` (2026-10-28): T-01 … T-08, T-10 … T-14 and the docs and cleanup items. Open: T-09 (waits for Q-07) and T-15.

| # | Sev. | Bug | Spec | Code |
|---|---|---|---|---|
| T-01 | medium | Zoom history is not kept per catalog session: `historyKey` takes a `caseIndex` (add-case-open K7) but `App.tsx` never passes it, so Back after `[`/`]` pops another session's range | case-navigation › Zoom history per session | `apps/web/src/App.tsx:193,789,872,1438`, `apps/web/src/chart/zoom.ts:285` |
| T-02 | low | `view.markSaved` is accepted through `POST /api/commands`; any caller can make a workspace claim any view name, and "Save" then overwrites that view with `overwrite: true` and no "Replace?" prompt. Fix: refuse it there like a named `view.open` | workspace-state › View names only from the store | `apps/server/src/routes/workspace.ts:355-366` |
| T-03 | low | `GET /api/case/preview` checks no grant on the target entry (unlike `case.go`/`case.step`); reachable only with state carried over from `none` to a server: leaks one event time and loads the source | case-preload › Neighbour preview; data-access › One guard for every route | `apps/server/src/routes/case.ts:186-243` |
| T-04 | low | A concurrent `POST /api/workspaces {reuse: true}` can get the workspace a catalog open is still filling (`openCases` creates it before the slow loads and never claims it); that tab then watches a discarded store | workspaces › A new tab never mirrors another | `apps/server/src/routes/workspaces.ts:196-263`, `apps/server/src/workspaces.ts:171-186,247-262` |
| T-05 | low | Cached raw tile keeps its `before`/`after` edge point under another scope that excludes it, so a line runs to a point outside the scope (reproduced in a throw-away test) | series-cache › Tiles kept across scopes | `apps/web/src/chart/cache.ts:452-459,512-528` |
| T-06 | low | Esc does not close the range picker once focus left it (click on the month title or legend): Esc sits on the dialog root and App ignores keys while the picker is open | range-picker (delta) › Apply and cancel | `apps/web/src/bar/RangePicker.tsx:444-450`, `apps/web/src/App.tsx:1141` |
| T-07 | low | A cursor click still inside its double-click interval leaves a ghost A/B preview line when the window unmounts within 500 ms | cursors › Placing cursors by click | `apps/web/src/chart/TimeseriesWindow.tsx:908-921`, `apps/web/src/App.tsx:1182-1197` |
| T-08 | low | Shift+A / Shift+B do nothing with Caps Lock on (`e.key` compared literally) | cursors › Keys bring a cursor into view | `apps/web/src/keys.ts` (`navKey`) |
| T-09 | low | Unlinked session-bar tooltip: line 1 names the vehicle, but the lines after it still list the left session's meta, `id:` and `from <tool>` (see Q-07) | case-navigation › Session bar | `apps/web/src/case/sessionBar.ts:283-299` |
| T-10 | low | CLI `state` sends workspace and render-status requests in parallel, so without `--workspace` both may name different workspaces | cli › One workspace per call | `apps/cli/src/run.ts:183` |
| T-11 | low | Search highlight misses overlapping matches of one term (`aa` on `AAA_X` marks 2 of 3 letters); continue at `i + 1` | signal-catalog › Match highlighting | `packages/shared/src/search.ts:77` |
| T-12 | low | Highlight ranges shift for characters whose lower case has another length (`İ`); theoretical for ASCII DBC names, real for non-ASCII ADX names | signal-catalog › Match highlighting | `packages/shared/src/search.ts:48-57` |
| T-13 | low | Sidebar button icon is slate-900 (`--text`), spec and the other icon buttons say slate-700 | design-language › Controls | `apps/web/src/styles.css:766-775` |
| T-15 | medium | Whole-recording scans time out on carserver: smart451 has 768 M rows (490 M on 2026-10-23); `count/min/max` over the vehicle takes 19.5 s, the logger-gaps scan and the density buckets hit ClickHouse's 30 s limit (`TIMEOUT_EXCEEDED`), so `/api/gaps`, `/api/density` and `/api/value` answer 502 and `pnpm smoke` fails. Measured directly against ClickHouse on 2026-10-28 17:10 | data-gaps, time-strip | `apps/server/src/clickhouse.ts:619-627` (logger gaps), density buckets |
| T-14 | low | CLI nits: usage error reads "takes 1 to Infinity arguments"; `calc add --name ""` is sent instead of refused locally | cli › Exit codes, Computed signal commands | `apps/cli/src/args.ts:437-439`, `apps/cli/src/calc.ts` |

## Docs and cleanup

- `docs/http-api.md` "Request class" omits `GET /api/calendar`, which honours `X-KIPscope-Class` (`apps/server/src/routes/series.ts:426`); the comment at `apps/server/src/http.ts:240-244` is stale the same way.
- README CLI table: no rows for `events list|filter|add|remove` and `digits 3|4`; the output-key sentence (`README.md:312`) lacks `removedWindow` and `workspace`.
- Dead code since D-092: `SPAN_PRESETS` (`apps/web/src/bar/bar.ts:12`) and `formatRange` (`apps/web/src/time/axis.ts:173`) with their tests.

## Questions for Jan

Answered 2026-10-28: Q-01, Q-02, Q-04 (D-115).

- **Q-03:** Should every `view.open` keep "Before last open" (`_previous`)? Today only `POST /api/views/open` and import with open do; `view.open` via `/api/commands` or `POST /api/workspaces {open}` does not, while saved-views says the server SHALL keep it.
- **Q-05:** Display names of a scoped list are computed over the scope's signals only, so a collision suffix can differ from the full catalog. signal-catalog › Catalog contents says "same display names"; display-names says the check covers the whole catalog. Which wins?
- **Q-06:** "One primary per surface" still says "This change adds no primary button"; slate-900 primaries now exist in the computed editor, Views popover, range picker Go and gate page. Drop the sentence? (Views popover not checked for two at once.)
- **Q-07:** Should the unlinked session-bar tooltip keep the left session's meta and id lines (T-09)?
- **Q-08:** Real-data scenarios with smart451 counts (cli, events: 385/402/477/63/15; computed "Same answer") could not be rerun and disagree with each other because the data moved. Keep as dated measurements or rewrite?
- **Q-09:** Plain-signal NaN/±Infinity reach the client as `null` and look like SNA (and a bucket can have `count > 0` with a `null` mean). Same rule as computed signals (non-finite = SNA), or handle otherwise?
- **Q-10:** The web never drops cached event lists when the server reloads its catalog; a live recording shows old events until a page reload. Acceptable?
- Minor, no action unless you say so: query class `metadata` has no user yet (waits for `add-signal-books`); `workspace.setOptions` without `digits` is a no-op that raises the revision; a first change row inside a scope gets `from.t` = its own time; another user's private workspace answers 403 where an unknown ID answers 404 (as specced); the zoom-bounds scenario checks a year the range button shows with two digits (tooltip has four).
