# Status

As of 2026-10-21, session 10. New direction after issue #1 and Jan's answers (D-078 … D-091); see Next. Thirty-two changes are archived and the main specs describe the running app.

## What runs

| Capability | Spec | In short |
|---|---|---|
| Signal catalog | [signal-catalog](../openspec/specs/signal-catalog/spec.md) | Signals with DBC metadata and SNA rules; ranked search, hover card, keyboard and drag in the explorer |
| Design language | [design-language](../openspec/specs/design-language/spec.md) | The look of the search tool (D-055): slate neutrals, sky accent, dense 12 px, pills, grey group bands, Okabe-Ito series |
| Time strip | [time-strip](../openspec/specs/time-strip/spec.md) | Data density and drives over the whole recording under the option bar; click jumps, drag zooms, the shown range slides and resizes, a drive fits, double-click shows all, `,`/`.` step drives; A/B/L marked; `/api/density` with drives, prefetched after each catalog load |
| Events | [events](../openspec/specs/events/spec.md), [event-filter](../openspec/specs/event-filter/spec.md) | Diagnostic events (`sdlog.events`) and state changes as pins on the strip, lines in the charts and a sidebar Events tab; one human filter string in UI, CLI and workspace, default `active changes`; IgnMode and BMS.contactor on the events line via `kipscope.yaml`; list scoped to the view, `n`/`p` stepping, fault memory reads hollow |
| State names | [state-names](../openspec/specs/state-names/spec.md) | Cursors show `KEYON`, `open` from `VAL_` tables, diag enums and row text; state signals drawn as steps |
| Diagnostic catalogs | [signal-catalog](../openspec/specs/signal-catalog/spec.md) | Units and states of `BMS.*` from the decoder's manifest + names files (`KIPSCOPE_DIAG_CATALOGS`); group `BMS (diag)` |
| Signal groups | [signal-groups](../openspec/specs/signal-groups/spec.md) | `display.groups` rules in `kipscope.yaml` group the explorer by sending ECU (DBC `BO_` sender, DCU/HVM fallback); collapsible headers, groups with hits open while searching, `Other` last |
| Display names | [display-names](../openspec/specs/display-names/spec.md) | `kipscope.yaml` rules and renames give short names (`SPEED_DISP`) in the UI; full name in card and tooltips; search on both |
| Series cache | [series-cache](../openspec/specs/series-cache/spec.md) | Power-of-two tiles kept in tab memory (LRU, 4 M values); zoom/pan back without a request |
| Series queries | [series-query](../openspec/specs/series-query/spec.md) | Raw points or min/mean/max buckets by zoom level; SNA as `null`; verified on 10 h at 5 ms |
| Data gaps | [data-gaps](../openspec/specs/data-gaps/spec.md) | Lines break at logger gaps (≥ 2 s) and after more than 3 periods (DBC, diag catalog or measured); faint grey band; cursors show `no data`; `/api/gaps`, rechecked every 5 min |
| Workspace | [workspace-state](../openspec/specs/workspace-state/spec.md) | Command-driven state with revisions, live push and render acknowledgement; survives a restart (`.kipscope/workspace.json`) |
| Saved views | [saved-views](../openspec/specs/saved-views/spec.md) | Named views in `.kipscope/views/*.yaml`, title in the top row, YAML export and import, self-contained `#view=` links, `?view=<name>`, CLI `view …` |
| Chart windows | [timeseries-window](../openspec/specs/timeseries-window/spec.md) | uPlot windows, one axis per unit (max 4), linked zoom, history, drag and drop, wheel and keys |
| Time navigation | [time-navigation](../openspec/specs/time-navigation/spec.md) | "Go to" with times, ranges and durations; span presets; zoom and pan keys |
| Cursors | [cursors](../openspec/specs/cursors/spec.md) | A and B in every window; exact values, Δ and Δt in the legend |
| Live cursor | [live-cursor](../openspec/specs/live-cursor/spec.md) | L follows the mouse in every window: L column in legends and values window, nearest curve within 16 px highlighted with a value label; grey L line |
| Values window | [values-window](../openspec/specs/values-window/spec.md) | Many signals at the cursors, no plot |
| Number format | [number-format](../openspec/specs/number-format/spec.md) | 3 (or 4) significant digits with SI prefixes everywhere people read numbers |
| Layout | [workspace-layout](../openspec/specs/workspace-layout/spec.md) | Collapsible sidebar, tiled windows, compact headers, marked "Add to" window (the window last clicked) |
| Guidance | [guidance](../openspec/specs/guidance/spec.md) | Reveal and flash where an add lands, tooltips from one hints table, next-step hints, help panel (manual, keys; `?`), "Start here" card |
| CLI | [cli](../openspec/specs/cli/spec.md) | Every command from the shell, `--wait` for the rendered UI |
| Footer | [app-footer](../openspec/specs/app-footer/spec.md) | Permanent bottom bar: status, measurement info, source/catalog/zone/build items, `KIPscope · kipp.ing · AAL` at the far right |
| Measurement info | [measurement-info](../openspec/specs/measurement-info/spec.md) | Name, object and meta of the measurement from `kipscope.yaml` or `kipscope measurement …` |
| Data sources | [data-source](../openspec/specs/data-source/spec.md), [adx-source](../openspec/specs/adx-source/spec.md) | Lean adapter contract (7 required methods, server-side fallbacks, one conformance suite); ClickHouse or Azure Data Explorer via `KIPSCOPE_SOURCE`, ADX signed in with `az login`; guide [data-sources.md](data-sources.md) |
| Scope | [scope](../openspec/specs/scope/spec.md) | One data ref and `[from, to)` bound every query (D-082); `KIPSCOPE_CATALOG=scoped` for large sources; views open with a scope (pad 1 h); clamp at the edge, Widen ×3, Clear; CLI `scope …`; query classes with a slot kept for the UI (D-081) |
| HTTP API | [api-reference](../openspec/specs/api-reference/spec.md) | Every route documented in [http-api.md](http-api.md), checked by a test |
| Server access | [server-access](../openspec/specs/server-access/spec.md) | `Host`/`Origin` guard with configured origins (`KIPSCOPE_ORIGINS`), the built UI served by the server, JSON bodies, size limits |
| Identity, workspaces, access | [user-identity](../openspec/specs/user-identity/spec.md), [workspaces](../openspec/specs/workspaces/spec.md), [data-access](../openspec/specs/data-access/spec.md) | Identity adapter `none`/`oidc` (Ping)/`module:`; a workspace per tab at `/w/<id>` with owner, share level and a grant of data refs; one guard on every route; Share… and Recent; views per user; guide [deploy.md](deploy.md) (D-088) |
| Case handoff | [case-handoff](../openspec/specs/case-handoff/spec.md), [case-navigation](../openspec/specs/case-navigation/spec.md), [object-view](../openspec/specs/object-view/spec.md), [case-preload](../openspec/specs/case-preload/spec.md) | Signed catalog from the finder by link, file or CLI (any order, any vehicles); session bar with ‹ › `[` `]`, `k / n`, Align, Unlink to the whole vehicle (queries bounded by the view); tiles kept across sessions, neighbours preloaded; balanced trim (`case url --trim`), open warnings as a note in the session bar; guide for a search tool (finder, out of scope) [handoff.md](handoff.md) (D-089, D-091) |

History: [openspec/changes/archive/](../openspec/changes/archive/) (skeleton, SNA handling, window workflow, signal explorer, cursors, CLI, navigation, layout, live cursor, display names, window handling, series cache, zoom speed, load recovery, robustness, footer, signal groups, design language, diag metadata, events, multi-select, gap display, saved views, guidance, events usability, ADX source). Decisions D-001 … D-075: [decisions.md](decisions.md). Tester feedback: [feedback/](feedback/).

## Session 4 in brief

- Built and archived `improve-signal-explorer`, `add-cursors`, `add-cli`, `improve-navigation` and `improve-layout`.
- Jan's hand check: drags, Esc, Alt-copy, trackpad, Digits select and large screens fine. His follow-ups went into `improve-navigation` before its archive:
  - D-030: compact chart legend (bare values with SI prefix, kind as tooltip, no axis or `complete` column, clock-only times, `×` on hover); mouse wheel steps (an accelerated mouse notch no longer pans a whole plot width).
  - D-031: the chart readout always shows the exact value at the cursor, also outside the zoom; B shows without "Diff", which adds only Δ and Δt; no text selection while dragging.

## Session 5 in brief

- Built and archived `add-live-cursor` (D-032 … D-034) in three rounds; Jan: „I like".
- Built and archived `add-display-names` (D-035, D-036) in three rounds; Jan: „nice. working".
- Checked `DCU_2C4h.HVM_Bat_Curr` on Jan's question: decoding matches the DBC and raw frames; negative is discharge (−188 A at hard acceleration, +22 A recuperation), so no fix needed.
- Built and archived `improve-window-handling` (corner grip, drop below the windows) and `add-series-cache` (D-037 … D-039); Jan: „looks good". By hand still: the grip with a real mouse drag.
- Built and archived `improve-zoom-speed` (D-040, D-041, D-043): load during the gesture, overview placeholder, idle prefetch, linked windows follow live. Measured: cached zoom 8–13 ms (was 359 ms), uncached sharp ~65 ms after the gesture (was 400–455 ms). Jan: „Butter smooth".
- carserver reboots daily at 23:00 local and killed the tunnel (470 × 502); built and archived `improve-load-recovery` (D-042, D-044): retry with backoff and on recovery, curve kept on error; `scripts/tunnel.sh` reconnects within ~5 s. Lead's tunnel-drop check: recovered ~3 s after the tunnel came back.

## Session 6 in brief

- Archived `harden-robustness` (D-045 … D-047).
- Renamed letsview to KIPscope (D-048); new home https://github.com/kipp-ing/KIPscope, local folder `~/dev/repos/KIPscope`. The carserver ClickHouse user stays `letsview`.
- License: Attribution Assurance License, GPG-signed (D-049).
- Built and archived `add-footer` (D-050, D-051) in two rounds plus a wording change; Jan: „looks great". The bar shows `KIPscope · kipp.ing · AAL`; name and profession sit in the `kipp.ing` tooltip, the full attribution in `kipscope --help` and the start log.

- Built and archived `add-signal-groups` (D-052 … D-054) in two rounds plus the lead's keyboard check: explorer grouped by sending ECU, near-curve distance 16 px. Jan: „good".

- Built and archived `adopt-design-language` (D-055, D-056) in two rounds plus the lead's checks and two follow-up fixes (values-window names on one line, density prefetch: first strip 9.2 s → 2 ms). Mock: https://claude.ai/artifact/V6naWfZvN9od7JpM482nta, source in [design/](design/). Jan: „this is great. we keep it".
- Built and archived `add-strip-navigation` (D-057, D-060) in two rounds plus a lead fix (whole-view brush on smart451); Jan: „strip drags are fine".
- carserver now has decoded diagnostic data (device `smart451-diag`): 125 `BMS.*` readings and table `sdlog.events` (DTCs, states, NRCs, ISO-TP). `BMS.*` grouped as `BMS (diag)` in `kipscope.yaml` (active after the next server restart). Built and archived `add-diag-metadata` (D-061, D-063): units from the decoder's catalog, cell voltages share one `V` axis. Built and archived `add-events` (D-058, D-059, D-064) in four rounds plus a lead fix (steps only where a segment has a named end): events line, human filter, Events tab, state names, state signals on the strip, CLI. Jan: „so far all good. consider it done".
- Jan: lines drawn through times without data are wrong; D-062 supersedes D-009. `add-gap-display` is specced (logger gaps ≥ 2 s from per-second row times; cyclic signals break after 3 periods from DBC `GenMsgCycleTime`, diag interval or measured; faint band; cursors „no data").
- carserver: ClickHouse read errors „errno 6, No such device or address" on a few part files during round 1, transient; Jan brought the server back.

## Session 7 in brief

- Built and archived `add-multi-select` (D-065, D-066) in three rounds plus a lead fix after Jan's check (a list click focuses the search, so Shift+Arrow works without typing first). No text selection in the explorer list; Ctrl/Cmd and Shift selection; a selection drags and adds as one, overflowing into new windows by the 4-unit limit. Jan: „good", then „now it works".
- Built and archived `add-gap-display` (D-068, implementing D-062), with G9 after Jan's report of points turned into dots: a chunk backfilled after the gap info left a stale logger gap; gap info is now rechecked every 5 min.
- Built and archived `add-saved-views` (D-069 … D-071) in three rounds: the workspace survives a restart, named views, YAML export and import, `#view=` links, CLI `view`; top-row overflow menu.
- Built and archived `add-guidance` (D-072) in two rounds plus lead fixes: the window last clicked is the "Add to" target, reveal and flash, hints, help panel with `docs/manual.md` and keys, "Start here" card.
- Crash gate `pnpm smoke` (headless Chrome against the dev server and a preview) is now the last step of every app round. Jan on the three changes: „its good".
- Built and archived `improve-events` (D-073) in three rounds plus a lead check (the 1000×557 count check, run headless): events in view with `In view | All`, `n`/`p` stepping, fault memory reads as hollow marks, a Refine section, a key line. Jan: „nice. before we upgrade some more we need more user feedback".
- Built and archived `add-adx-source` (D-074) in two rounds plus lead checks: lean data-source contract, ADX adapter (token from `az login`), conformance suite on ClickHouse and the Kusto emulator, `docs/data-sources.md` and `docs/http-api.md`. Lead fix D-075: ClickHouse progress headers overflowed on queries over ~10 s (gap info failed, 502s since 14:26). Jan: „nice. wrap it up. we will expect user feedback for azzre".

## Session 9 in brief

- Jan found the session handling confusing; an exploration ([sessions and handoff](explore/2026-10-20-sessions-and-handoff.md)) showed "session" meant two things. Jan: rights live in the search tool, a catalog is any list of any vehicles, Unlink is the whole vehicle without a bound (D-085 … D-087).
- Revised, built and archived `add-multiuser` (D-088): "workspace" for the server state, Share… and Recent instead of the Sessions menu, a grant per workspace instead of a rules file. Lead checks with two users (alice, bob) on a separate server; lead fixes (grant of a stored `all`, `?view=` by title, refused steps roll back, gate pages name the user). A test agent deleted Jan's workspace `lhwad0nv1m`. Jan: „gut, archivieren".
- Built and archived `add-case-open` (D-089) in five rounds plus a spec amendment and lead checks: signed catalog by link, file and CLI; session bar with `[` `]`, Align and Unlink; tiles kept across sessions, neighbour preload; measured on a synthetic 400-day car (all queries well within goal). Jan: „super das reicht. bitte archivieren."
- Docs: [corporate.md](corporate.md) (KIPscope in a company), README section "Made for corporate environments", manual "Workspaces and sharing". Old test workspaces removed (Jan: „altkram kann alles weg").

## Next

1. New direction (2026-10-19, D-078 … D-080, issue #1): a search tool (finder, not part of KIPscope) finds sessions, KIPscope shows one case (scope = data ref + time window), runs multiuser on a server, signal books with three priorities and a learned book. Planned changes in order:
   0. Done: papercuts from issue #1 item 8 (`.gitattributes`, `--env-file-if-exists`, DBC path warnings).
   1. `improve-query-priority`: interactive queries before background work; periods only for the signals in view (issue #1 item 7). Archived (D-081).
   2. `add-scope`: scope in the source contract and the workspace, scoped catalog, bounded strip, gaps and events, CLI `scope set` (issue #1 items 1–5). Unblocks the Azure users. Archived (D-082); Jan tests more on 2026-10-20 (not run yet: tunnel-down restart in scoped mode, strip at 1440×900 and 1000×557, Copy link by clipboard).
   3. `add-multiuser`: archived (D-088). Rights moved to the search tool (D-085): grant per workspace instead of a rules file; "session" renamed to "workspace". Not run: 1440×900 step, dev restart, tunnel-down restart, a real Ping tenant ([deploy.md](deploy.md)).
   4. `add-case-open`: archived (D-089). The search tool's side (an "Open in KIPscope" action whose link its server builds and signs) is out of scope of KIPscope; [handoff.md](handoff.md) is the interface (D-090). Not run: the 1440×900 and 1000×557 sizes, a real ADX cluster, the cold Unlink on carserver.
   5. `add-signal-books`: book files and inline books, P1–P3, lazy metadata, learned book per user, ADX metadata once the Azure users explain it (D-080, issue #1 item 6).
   The ADX path has run only against the emulator so far; a real cluster needs [data-sources.md](data-sources.md) §6.
2. Rest of persistence (concept §8): snapshots, templates, undo. Save and load are done (D-070).
3. carserver: the read-only ClickHouse user `letsview` lives in serverzoo commit `b3a70b9`, **not pushed yet**; the password is only in the local `.env`.
4. Later: sidebar work package (D-026), playback, state signals from value tables, timezone selection.
5. Backlog from the search tool team's findings on issue #1 (comment of 2026-10-21; the small fixes were `fix-handoff-findings`, archived, D-091):
   - Sources without an events table (Jan: „this will be bigger"): today ADX answers SEM0100, events come back empty with a warning per catalog load, and the failing query is sent again for every scope. Open: remember the missing table (per run or recheck per catalog load), a capability in `/api/meta`, events from a stored function with scope pushdown, what the UI shows and hides.
   - ADX speed: native batched `firstTimes` (offered as a contribution in the issue), periods kept per (data ref, signal) across sessions, gaps requests in chunks or below series (revisits D-081), preview's signal list loaded before the settle.
   - Performance report on a real ADX cluster (comment of 2026-10-22, P1–P9): an open takes ~11 s in 35–55 serial ADX queries. In progress: `speed-up-adx` with P1 (native `count`/`extent`), P2 (one round trip per series), P5 (queue width per source kind), P6 (cached ping), P9 (`/api/value` edges). Later: P3 batch endpoints, P4 one tile wave on open, P7 `/open` before the full signal list, P8 loading state.
   - Catalog features: `aliases` for signals named differently per vehicle, per-kind `views`, `columns` for list and bar (units, order, table).
   - `POST /api/handoffs` with a one-time handle for lists beyond a link (security decision).
6. Backlog from the design critic (D-095): windows filling the height, event counts per session in the list, putting A or B on an event, copy-link of view and cursors, a filter by event kind on the strip.
   - Range picker: a live preview of typed text in the result line (Jan 2026-10-21: „so lassen wir das erstmal"; today the line shows the draft until Go).
   - Kept range without data after an open or step (Jan 2026-10-22: backlog, "gut möglich dass wir es gar nicht brauchen"): a step keeps each window's offset from the alignment point and its width, so a session whose data ends earlier shows an empty window. Options: (A) an optional start range per catalog entry, set by the search tool; (B, lead's pick) when no shown signal has data in the kept range, show the whole session with a message, like the clamp at the session edge.
   - Signal metadata per data ref instead of per scope (D-096): after a cold load in a session where a shown signal has no data, the legend lacks its display name and unit until the first step to a session with data.
7. Backlog from the persona test (2026-10-17, [feedback](feedback/2026-10-17-personas.md)): expert measuring helpers (find peak, max slope, cursors snap to samples); wheel speeds in km/h; DTC onset times (the decoder stores the readout time only).

## Known limitations

- Bucket mean is arithmetic, not time-weighted (concept §13). It now shows only in the plot and in a cursor's live value while its line is dragged in a zoomed-out view.
- The 1000×557 part of the events count check ran in a 996×553 iframe stand-in only.
- Two signals at the same value on different axes overlap exactly.
- Tick labels may thin out to one label on very narrow plots. A header range below 1 s shows equal start and end (ms precision).
- Seen once, not reproduced: header range stale after a rectangle zoom. Rename has no visible affordance (click the title).
- Hidden browser tabs stay connected but never acknowledge renders; `--wait` takes the first UI that does, and times out when only hidden tabs are open.
- Tabs opened before a web change may need a reload: hot reload swaps modules but keeps old state (seen once: a tab kept reporting render errors until reloaded).
- A strip step whose `window.setRange` the server refuses stays shown in the strip until the server range changes (`navigate` returns only a boolean).
- `/api/value` is not retried after an outage: readouts and the values window stay failed until cursor or range change.
- Not checked by hand: the 1000×557 small-screen checks (iframe stand-in, plot share 31.3 %); the footer during a legend drag (code read); the 16 px near distance (unit test only); the flat explorer list without `display.groups` (unit test only); L hidden while a cursor line is dragged (unit test only; the browser tool cannot hold a drag); CLI `--wait` with no tab open (exit 6, covered by tests); mouse wheel steps on mice other than Jan's.

## Run

See [README.md](../README.md). Development needs the SSH tunnel to carserver: `scripts/tunnel.sh start`. Restart the dev server with `scripts/restart-server.sh` (only touches node `src/main.ts` on 7310). Team rounds: workflow `change-round` with `{change, date}` after the spec owner wrote spec, design and tasks; tests need `docker compose up -d` and `seed:test`.
