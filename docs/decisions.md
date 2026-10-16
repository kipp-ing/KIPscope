# Decision Ledger

Decisions that don't belong to a single OpenSpec change. Newest first. Never edit past entries; supersede them with a new one.

Format: `## D-NNN: Title (YYYY-MM-DD)`, then context, decision, consequences.

## D-057: Interactive time strip (2026-10-16)

- **Context:** Jan: „we hav the "sky" where we have data. thats good. but not interactive. will you give it more reason? I no UI expert. but big chances". On smart451 the strip spans ~4.9 d at 1 bar = 1 h: a few drives (up to 50 M rows/h), a steady trickle (~160 k rows/h) between them, many empty hours; a 20 min view is less than one bar.
- **Decision:** Supersedes "no click action" of D-056 and "Clicking does nothing" of `time-strip`. Jan chose three parts of the lead's proposal:
  - **Navigate:** click a bar jumps there keeping the span; drag across the strip zooms to that range; the shown range is a grabbable window (slide = pan, edges = zoom), pixel-exact with a minimum width; double-click shows the whole recording.
  - **Hover and markers:** a bar's tooltip gives its time range and rows; cursors A, B and the live cursor L are marked on the strip.
  - **Drives:** the server finds drives; clicking a drive fits it; keys step to the previous/next drive. The trickle between drives is **not** a drive („only real bursts"); it still shows as bars.
- **Lead's defaults:** the strip always shows the whole recording; strip actions act on the bar target, or on all windows when time is linked (as Go to). Signal coverage (where a hovered signal has data) is out of scope for now.

## D-056: Design language conventions (2026-10-16)

From the archived change `adopt-design-language`; details there.

- **Decision:** tokens of T1 on `:root` (slate neutrals, sky accent `#0284c7`, 12 px base, 11 px caps labels, mono signal names, tabular numbers, 4 px radius, 26 px controls); A/B/Diff are pills over hidden checkboxes; the marked window is a ring frame plus an "Add to" pill; series palette Okabe-Ito then `#332288 #882255 #999933 #8C564B`; `GET /api/density?dataRef=` with widths of T6 (≤ 120 bars), cached per data ref and catalog load and prefetched after each load (Q4); strip bars 24 px, strip ≤ 56 px, no click action.

## D-055: KI.ping design language (2026-10-16)

- **Context:** Jan: „KI.ping has a ui too. i want to take over the design language". Reference: KI.ping `ui/proto-v1` (Tailwind slate, sky accent, dense 12 px, caps section labels, grey group bands, one dark primary per surface, status pills, Okabe-Ito series). Mock: https://claude.ai/artifact/V6naWfZvN9od7JpM482nta (artboards "Workspace" and "Tokens and parts"), source in [docs/design/](design/) (`Main.dc.html`, `Tokens.dc.html`).
- **Decision:** Jan accepted the mock as shown („accepted right away"), with its defaults: accent sky `#0284c7`, Okabe-Ito series palette, compact density (12 px), and the time strip (data density over the whole recording, the shown range in the accent) on.
- **Jan's answers on the spec:** Q1 no dark "Add … to …" button at the explorer foot (adding stays row "+" and Enter); Q2 the marked "Add to" window gets the ring frame and "Add to" pill of the mock, the accent top bar goes; Q3 the L line is drawn in slate-500, not in the accent (too close to series colour `#0072B2`).
- **Q4 (density cost):** the first uncached density call took 9.2 s on carserver (goal ≤ 5 s); Jan chose (b): the server starts the density query right after each catalog load, so the strip usually finds it cached.
- **Consequences:** restyle only, no behaviour change, except the time strip, which is new. Mock parts with no app feature behind them (the "Values" half of the Signals switch, the `ready` legend pill) are illustration, not requirements.

## D-054: Signal group conventions (2026-10-16)

From the archived change `add-signal-groups`; details there.

- **Decision:** `display.groups` rules (`match` optional, `group` template over named groups and `{sender}`); a blank render falls through to the next rule; computed on the server as optional `SignalInfo.group` (absent = `Other`); the web groups only. Shipped rules: `{sender}`, then `^(?<ecu>CPC|PNHV)_` → `{ecu}`. Empty search: groups by name, `Other` last, also while searching; Enter adds the first row shown; arrows include headers, Enter on a header toggles; collapse state is not remembered. `DbcInfo.sender` absent for `Vector__XXX`.

## D-053: Signal groups in the explorer (2026-10-16)

- **Context:** Jan: „signals shall be grouped on left bar. user defined. here as example we use sending ECU". The DBCs name a sender per `BO_` (h-can: Engine, CGW, ESP, …; hybrid-can: CPC, BMS, EM2, …); `Vector__XXX` means no sender.
- **Decision:** Jan chose:
  - Groups are defined by rules in `kipscope.yaml` (like the display-name rules of D-035); the shipped file groups by sending ECU. Restart to change.
  - Empty search: all groups, collapsed. While searching: only groups with a hit, all open, ordered by their best hit; the ranking stays inside each group.
  - Signals without a group (no DBC entry, sender `Vector__XXX`) go to one group `Other`, always last.
  - Design Q1: the shipped file adds a fallback rule `^(?<ecu>CPC|PNHV)_` → `{ecu}` after `{sender}`, since h-can.dbc names no sender for those messages (Other would hold 117 of 428 signals).
  - `Other` stays last while searching too; Enter adds the first row shown, even if a better hit sits in `Other`.

## D-052: Near-curve distance 16 px (2026-10-16)

- **Decision:** Supersedes the 8 px of D-032. Jan: „the live courser is 8px until highlight. should be double, its hard do see." The live cursor highlights the nearest curve within 16 px vertically of the pointer; the rest of D-032 stands.

## D-051: Measurement info (2026-10-16)

From the archived change `add-footer`; details there.

- **Decision:** `workspace.measurement {name, object, meta[{key, value}]}`, commands `measurement.set`, `measurement.setMeta`, `measurement.clear`; limits 120 / 40 / 200 characters, 8 entries; the project file's `measurement` section gives the start value, commands win until restart, nothing writes the file. (F6, F7)

## D-050: Footer conventions (2026-10-16)

From the archived change `add-footer`; details there.

- **Decision:** The status strip is the footer: status, measurement info, automatic items (source by ping, catalog, browser zone, server commit at start) and at the far right `KIPscope · kipp.ing · AAL` in 11 px muted text, name and profession in the `kipp.ing` tooltip (Jan revised Q1); `/api/meta` and `/api/license` (from `LICENSE`); items hide whole in the order build, zone, catalog, meta entries, source, object, name; the attribution is never cut and wraps to a second line instead; `kipscope --help` and the server start log end with `attributionText()`. (F1–F5, F8)

## D-049: Attribution Assurance License (2026-10-16)

- **Decision:** Jan: KIPscope is licensed under the AAL (SPDX `AAL`). Author attribution: Jan Kipping, Agentic engineer, https://kipp.ing, "efficient agentic engineering". `LICENSE` holds the text, `LICENSE.asc` the GPG-clearsigned copy clause 1 asks for, `KEYS.asc` the public key (ed25519, `1E3BF6DE3CC6227749622E8EA53393CE9B74E4F7`, valid until 2028-10-15). Every package.json says `"license": "AAL"`.
- **Key:** created on Jan's Mac without a passphrase (Jan's choice; add one with `gpg --passwd`). Revocation certificate in `~/.gnupg/openpgp-revocs.d/`.
- **Consequences:** a changed `LICENSE` must be signed again (`gpg --clearsign --output LICENSE.asc LICENSE`). The app shows the attribution itself (change `add-footer`).

## D-048: Renamed to KIPscope (2026-10-16)

- **Decision:** Jan: the project is called KIPscope. Prose uses `KIPscope`; packages, CLI, files and paths use `kipscope` (`@kipscope/*`, `kipscope.yaml`); env vars use `KIPSCOPE_*`; agents use `ks-*`. All references were rewritten, past ledger entries and archived changes included.
- **Exception:** the read-only ClickHouse user on carserver stays `letsview`. It is deployed through serverzoo and is not part of this repo.
- **Consequences:** a local `.env` with `LETSVIEW_*` keys needs them renamed; the test DB is compose project `kipscope` (reseed after the switch); the sidebar state in the browser starts fresh under `kipscope.sidebar`.

## D-047: Robustness conventions (2026-10-16)

From the archived change `harden-robustness`; details there.

- **Decision:** Catalog reloads 1, 2, 4 … 30 s until its first success, one load at a time, DBC warnings per load; UI commands never reject (`network`, `bad_response`); an acknowledgement counts as sent only when the socket took it and is repeated after a reconnect; state pushes name their command type and only content changes or `window.setRange` re-hand requests to the loader; a window that fails to draw shows an error box and reports a render error. (H5–H9; H9 refines D-044 per Jan, 2026-10-16)

## D-046: Local access only (2026-10-16)

From the archived change `harden-robustness`; details there.

- **Decision:** `Host` and, when present, `Origin` must name localhost, 127.0.0.1, [::1] or a non-loopback `KIPSCOPE_HOST`; JSON bodies only; live frames ≤ 256 KiB; acknowledgements ≤ 50 errors of ≤ 500 characters; ≤ 64 windows; warning on a non-loopback host. (H3, H4)

## D-045: Exact wire times and bucket bounds (2026-10-16)

From the archived change `harden-robustness`; details there.

- **Decision:** Series offsets travel as JSON numbers up to 2^53 − 1 ns and as decimal strings beyond (supersedes D-011 D3's "offsets as numbers"); bucket width at most 2^62 ns; buckets on the floor grid before 1970; own computation errors answer 400. (H1, H2)

## D-044: Load recovery conventions (2026-10-15)

From the archived change `improve-load-recovery` (R1–R7, Q1–Q4 as recommended); details there.

- **Retry:** per signal and window, no jitter: 1, 2, 4, 8, 16, then every 30 s; reset on success. Network errors and 5xx retry by themselves, 4xx only when the same request comes again. A success of any series request in the tab or a live-channel reconnect retries at once, never sooner than 1 s after the last failure. Prefetch failures are dropped; a failed overview restarts after the signal's next complete view.
- **On error:** the window keeps the previous data or placeholder; the legend shows `failed: …`, also while a retry loads. An error or a scheduled retry counts as settled for the render acknowledgement, a loading retry does not; the UI re-acknowledges when its error list changes.
- **Not retried:** `/api/value` (readouts and the values window stay failed until cursor or range change).
- **Tunnel:** `scripts/tunnel.sh start` keeps the carserver tunnel up (D-042).

## D-043: Zoom speed conventions (2026-10-15)

From the archived change `improve-zoom-speed` (Z1, Z2, Z4, Z6, Z7, Z9; Q1–Q2 as recommended, Q3 per D-041); details there.

- **Load on preview:** the first step of a gesture loads at once, then at most every 100 ms; the command still goes after 300 ms; only committed ranges count for the render acknowledgement.
- **Overview and placeholder:** one coarse level (1,024–2,048 buckets) per signal's extent, kept by the window; missing tiles are drawn from the finest coarser level available (one level for the whole curve), no extra marker.
- **Prefetch:** 300 ms after rest, the next coarser level over three view widths and the own level one view width each side, at most two prefetch runs in flight per tab and 256 tiles per window; a new gesture cancels it.
- **Linked windows:** follow the gesture through the browser-local `chart/linkedPreview.ts`; the gesture's window alone commits.

## D-042: Load recovery after source errors (2026-10-15)

- **Decision:** Jan, after carserver's scheduled 23:00 (local) reboot killed the SSH tunnel and left windows empty: (1) a failed series load retries by itself with backoff 1, 2, 4 … 30 s, and at once when a request succeeds again or the live channel reconnects; setting the same range again also retries; (2) on a failed load the window keeps the last drawn data (or the overview placeholder) with the failure marker instead of an empty plot; (3) `scripts/tunnel.sh` keeps the carserver tunnel up and reconnects after drops. `improve-zoom-speed` is accepted („Butter smooth").
- **Why:** server log: 470 × 502 from 23:05 to 23:10 local; after the tunnel restart a tab whose range had not changed kept its errors (same request never retried). Jan: „Nice. Yes fix commit test push done."

## D-041: Linked windows follow the zoom live (2026-10-15)

- **Decision:** Jan, on `improve-zoom-speed` Q3: with "Link time axes" on, every linked window shows the preview range and loads during the gesture like the zoomed one (a browser-local shared preview range, like the live cursor); the command is still sent once after the commit delay. Supersedes the design's recommendation that linked windows follow only the committed range.
- **Why:** Jan's pick "Follow live": otherwise the linked windows still lag 0.35–0.45 s, which defeats D-040.

## D-040: Near-instant zoom (2026-10-15)

- **Decision:** Jan, after the lead's measurement (one zoom out: 0–5 ms preview of old data, 300 ms commit delay, ~20 ms command, loading starts at ~345 ms, data drawn at 400–455 ms; a fully cached zoom still took 359 ms because loading waits for the commit): build as one change (1) loading on the preview range during the gesture, the command still delayed; (2) a coarse overview of each signal's whole extent loaded once, drawn at once where finer tiles are missing; (3) prefetch in idle time of the next zoom-out level and neighbouring tiles. Targets: a cached zoom draws sharp data within one frame (~16 ms); an uncached one draws coarse data within one frame and sharp data within ~150 ms. Server tile cache and binary transport are out of scope.
- **Why:** Jan: „a zoom out takes half a second or so to redraw. this is a fast machine. i would like to investigate: how can we create somethin near instant even with bad browsers?" — on the plan: „noice! go ahead".

## D-039: Window handling and cache conventions (2026-10-15)

From the archived changes `improve-window-handling` (G1, B2, Q1–Q3) and `add-series-cache` (C1–C6, Q1); details there. Jan: „looks good".

- **Grip:** the corner grip and the bottom strip both drag the height (120–1200 px, `ns-resize`), only on a primary press without Ctrl. A new window takes its source window's height (workspace-state).
- **Drop below:** the free area starts 8 px below the last grid row and reads "+ New window"; gaps and the space beside a shorter window are no target.
- **Cache:** one tile cache per tab shared by all windows; power-of-two bucket widths snapped finer (D-038), 256-bucket tiles, neighbouring missing tiles fetched as one aligned `/api/series` request; raw tiles serve finer zooms; limit 4,000,000 values, least recently used dropped; tiles ending within the last hour and failed tiles are not stored; `/api/value` and `/api/extent` stay uncached (D-031).
- **Known:** for a sparse view, raw vs buckets can depend on what was loaded before (review finding, accepted for now; Jan's concern is speed).

## D-038: Cache tiles snap finer (2026-10-15)

- **Decision:** Jan, on `add-series-cache` Q2: the power-of-two bucket width snaps down (finer), so a view gets between `target` and 2 × `target` buckets, never coarser than before the cache. Supersedes the design's recommendation to snap up.
- **Why:** Jan's pick "Finer": min/max band and spikes stay as sharp as today; up to 2× data per view is accepted.

## D-037: Corner grip, drop below the windows, browser cache (2026-10-15)

- **Decision:** Jan's next three requests, in this order (lead's sorting, small first): (1) every timeseries window gets a visible macOS-style grip in its lower right corner that drags the height (width stays from the grid); (2) dropping a signal on the free area below the last window (or on an empty window list) creates a new timeseries window with it, like "+ New window"; gaps between windows stay no target; (3) series data loaded once stays in the browser's memory until the tab closes, with a size limit (oldest dropped first), so zooming and panning back is fast. Not persisted across reloads. (1) and (2) form one change, (3) its own.
- **Why:** Jan: „signal caching. stuff that has been loaded once shall stay in the browser to be faster, if thats possible. then a drag of a signal to empty space create new time series. then window sizing is possible (look like i managed once) therer should be the apple like curved handle lower right to grab." Picks: height only, until the tab closes, free area below the windows.

## D-036: Display name conventions (2026-10-15)

From the archived change `add-display-names` (design N1, N5, N6, N7, open questions Q1–Q4 built as recommended); details there.

- **File:** `kipscope.yaml` in the repo root, `KIPSCOPE_PROJECT_FILE` overrides it (a named file must exist); read at startup only, a catalog refresh does not reread it. Parsed with `yaml`, validated with `zod`.
- **Invalid file:** the server refuses to start (exit 1), one line per problem `<path>: <field>: <problem>`.
- **Computed on the server:** once per catalog load, delivered as optional `SignalInfo.displayName` (absent when equal to `name`); the web uses `shownName()` and never evaluates rules. Search ranks the shown name like the name.
- **Collisions:** a rule's optional `collision` template (e.g. `{signal} ({message})`) applies to rule-made names only; a rename stays as written; names still alike fall back to full names with a server warning. Lists stay ordered by full name; names without hex ID are shortened too.

## D-035: Display names from a project YAML (2026-10-15)

- **Decision:** Jan: the UI shows short signal names (`V_ANZ` instead of `COMBI_412h.V_ANZ`), defined per project in a YAML. The YAML holds pattern rules (regex with named groups and a `show` template; first match wins) plus an optional `rename` map for single signals (rename beats rules). When two signals get the same shown name, both show the short name plus a message suffix, e.g. `V_ANZ (COMBI)`. The full source name stays in the hover card and tooltips; search matches full name, short name and message alike; CLI and API keep the stable full IDs. Lead's defaults: the file is `kipscope.yaml` in the repo root, path overridable by env; no file or no matching rule shows the full name as today.
- **Why:** Jan: „the signal names. no one is interested in hex. so it will be just V_ANZ in this case. However: this is different in each project. so a yaml shall be able to define whats shown in the ui". Picks: rules + renames, short + message suffix on collisions, full name in hover card/tooltips, search on both, CLI keeps full IDs.

## D-034: Live cursor conventions (2026-10-15)

From the archived change `add-live-cursor` (design L1, L7, L8, open questions Q1–Q4 built as recommended); details there.

- **Store:** L is a browser-tab singleton (`apps/web/src/chart/live.ts`), never workspace state; at most one publish per animation frame; near = 8 px on each signal's own y axis, mean line only (not the min/max band).
- **Values window:** its L cells are exact server values, looked up once the pointer rested 150 ms, outside the render acknowledgement; charts read L from the drawn data.
- **Hidden:** L clears on leaving the plot, on button down and on a range change of its window, and is suspended during every line, height or row drag; a click without movement brings it back at the same spot (D-033).
- **Shown:** no L time anywhere; the curve label is value and unit without a kind tag.

## D-033: Live cursor after a click, legend always a grid (2026-10-15)

- **Decision:** Jan, on the `add-live-cursor` round 1 findings: on mouse up without movement L comes back at the same spot, so A and L read the same right after a click (amends design L8, which cleared L until the next move). The chart legend is always a grid: name, `[unit]`, then A | B | Δ while on, and L, so L lines up under itself also with A and B off (replaces the wrapping list with cursors off).
- **Why:** Jan's picks of the recommended options; round 1 UI check: "L stays cleared after mouse up" irritates, and with A/B off the L cell sat at a different x in each row.

## D-032: Live cursor at the pointer (2026-10-15)

- **Decision:** Jan, as a new feature: besides A and B a live cursor "L" follows the mouse. It is local to the browser (no command, no revision, not in the CLI). Every chart legend gets a 4th column L with each signal's value at the pointer time; while one window is hovered, the other timeseries windows show a thin L line at the same time and fill their L column; without a hover L is empty. The L value comes from the drawn data (raw points zoomed in, bucket value zoomed out, kind as tooltip), like a dragged line under D-031. A signal whose curve is within about 8 px vertically of the pointer (nearest wins) is highlighted: thicker line, others faded, its legend row marked, and a label at the curve shows its value at the pointer's x. The values window also gets an L column (lead's pick for the open "values window?" point, from "values for each window"). Supersedes D-023's "no value readout on hover".
- **Why:** Jan: „now additional to abdiff courser we need a life value. where the mous is. with values for each window so a 4th value. and when mouse ist near one signal this signal shall be highlited and the x aligned value shown." All proposed defaults accepted („excellent. go ahead").

## D-031: Cursor values outside the zoom, B without Diff (2026-10-15)

- **Decision:** Jan, after the D-030 build: a cursor outside a chart's zoom keeps its readout value. First built as a server lookup only outside the zoom; that felt "reloaded" at the zoom edge, so the chart readout now always shows the exact value at the committed cursor from the server, like the values window (Jan's pick "Always exact"); only a dragged line follows the drawn curve live. Supersedes D-024's zoom-dependent chart value. B's value shows whenever B is on, in the chart legend and in the values window; "Diff" adds only Δ and Δt.
- **Why:** Jan: „if couser go aout of zoom value vanish. should stay. if "diff" is of B has no value." / „its working, but feels quirky. it seems like beeing reloaded after going out of view".

## D-030: Compact chart legend (2026-10-15)

- **Decision:** Jan, on the chart legend with diff mode on after his hand check: the legend row keeps name, `[unit]`, A | B | Δ and the SNA share. Values lose their unit (the SI prefix stays: `14.0 k` under `[1/min]`) and their tag (`lin`/`hold`/`avg` become the cell's tooltip); the axis side column goes (tooltip of `[unit]`); `complete` goes (loading and failed stay); the readout row shows clock times, the date in the tooltip; `remove` becomes a `×` shown only while hovering the row. The values window is unchanged. A mouse wheel event (Chrome's `wheelDelta` in notches of 120) pans 2 % of the plot or zooms a quarter tick, whatever its accelerated delta; trackpads keep 1:1.
- **Why:** Jan: „it falls apart. as it shows mostly useless information: the hint (avg) can go. the unit on each value can go, the hint wich axes can go, the timeframe only time minute seconds not full utc, the "complete" can go. the remove can go"; × on row hover his pick over double-click and drag-out. „on my mouse … wheel oversensitive" (the horizontal wheel): his mouse sends one slow notch as 4–7 events of 4 … 300 px, more than a plot width.

## D-029: Cursor and CLI conventions (2026-10-15)

From the archived changes `add-cursors` (design C1, C4, C5) and `add-cli`; details there.

- **Cursors:** A, B and diff mode are workspace state set by commands (`cursor.set`/`move`/`remove`/`setDiff`), so the CLI controls them; a line drag stays local and sends one command on release.
- **Values window:** evaluates raw neighbours from `GET /api/value` (point, `lin` or `hold`), never invents a value, shows SNA as SNA (D-010, D-024).
- **Bar target:** with time axes unlinked, bar actions act on the window zoomed last.
- **CLI:** `node apps/cli/src/main.ts`, one JSON line per call, exit codes 0 ok … 7 unavailable, `--wait` polls `GET /api/render-status` and takes the first UI that acknowledges, local times in the process time zone, cursor anchors (`a+500ms`) resolved in the CLI. Its 9 open questions were built as recommended while Jan was away and accepted with the archive.

## D-028: Navigation and layout details (2026-10-15)

- **Decision:** Jan, on the open questions of `improve-navigation` and `improve-layout` (all as recommended by the spec owners):
  - Chart readout: legend rows get columns A | B | Δ, a readout row shows the A/B times and Δt, and a Δt label sits between the cursor flags.
  - A new window shows the data extent of its signals; cursors A and B start at ⅓ and ⅔ of the view.
  - The marked window ("Add to" target) is view state of the browser tab, not workspace state.
  - All detail questions of both designs follow the recommendations.
  - `add-cursors` and `add-cli` are archived before Jan's hand check; gaps go into a follow-up change.
- **Why:** Jan's picks from the lead's question round.

## D-027: Scope of the next efficiency changes (2026-10-15)

- **Decision:** Jan, on the lead's scope question after D-025/D-026, in addition to them:
  - Time navigation: type a time or range, zoom/pan keys, jump to the data extent, presets.
  - A/B values and Δt/Δ readout on the chart next to the cursors (the values window stays for many signals).
  - A window emptied by a move is removed automatically (supersedes "a window emptied by a move stays", D-017 feedback).
  - "Add to" goes to a marked window: the user marks a window, and adds go there. The user's own act of marking sets the target, so D-020's "the target stays where the user put it" still holds.
- **Why:** Jan picked these from the efficiency test; the marked window is his own idea („add to ist ein markiertes Fenster?"), instead of the testers' "follow the new window". The lead splits the work into `improve-navigation` and `improve-layout`.

## D-026: Number format and layout scope (2026-10-15)

- **Decision:** Jan, on the efficiency test:
  - Numbers are shown with 3 significant digits everywhere (values window, readouts on charts, axes, hover card, human-readable CLI output); the unit may carry an SI prefix (k, M, m, µ, …), e.g. 13 970 1/min → `14.0 k1/min`. 4 significant digits are an option. Machine output (JSON, API) stays exact.
  - Screen use, next change: collapsible sidebar, windows tiled side by side, compact window headers. The sidebar gets its own work package later; for now only optimization.
- **Why:** Jan: „signifikante Stellen. 3 reichen. Einheit darf k m M und so haben. optional 4 Stellen" / „Überall" / „Seitenleiste einklappbar, Kacheln nebeneinander, kompakte Fensterköpfe" / „just optimization. later WP". Testers found 2, 45, 16.425, 371.075 in one column and interpolated values with seven decimals on a 1 km/h signal.

## D-025: Wheel scrolls, one Back and one Reset, screen use (2026-10-15)

- **Decision:** Jan, on the efficiency test ([feedback/2026-10-15-efficiency-testers.md](feedback/2026-10-15-efficiency-testers.md)):
  - The mouse wheel scrolls the page; Ctrl+wheel or Shift+wheel zooms the chart under the pointer. Supersedes the plain-wheel zoom of `improve-window-workflow`.
  - Zoom controls: one "Back" and one "Reset" (no duplicate controls in the bar and in each window, no separate "Zoom out").
  - Screen use must be optimized: more of the screen shows data (details in the next change).
- **Why:** Jan: „agreed: The mouse wheel should scroll the page, with Ctrl/Shift+wheel to zoom" / „screen usage: yess that needs to be optimized" / „zoom agreed: back and reset it is". Two testers and the earlier power users lost their view by scrolling over a chart; the one "spontaneous" range change traced to trackpad momentum.

## D-024: Cursor details (2026-10-15)

- **Decision:** Jan, on the open questions of `add-cursors` (all four as recommended by the spec owner):
  - The values window shows raw values from the server (neighbours around the cursor time, interpolated per display mode), independent of any window's zoom. Concept §6's zoom-dependent cursor value stays for the charts.
  - A legend row dropped into a values window behaves like any window: a plain drop moves, Alt/Ctrl copies.
  - Click in a chart sets cursor A, Shift+click sets B; the lines can be dragged.
  - With time axes unlinked, the bar's "Back" and "Reset zoom" act on the window zoomed last, named in the tooltip.
- **Why:** Exact values for every signal, including ones not plotted; one drop rule for all windows; a gesture that leaves double-click and rectangle zoom free.

## D-023: Scope of the cursor change (2026-10-15)

- **Decision:** Jan, after approving `improve-signal-explorer`, for change `add-cursors`:
  - **Drag and drop from everywhere:** every place that lists a signal is a drag source (explorer, legend, the cursor value window), and every drop target stays reachable while dragging: "+ New window" stays visible during a drag, and the page scrolls when the pointer nears its edge.
  - **Values only at the cursor:** no value readout on hover. A dedicated value window in the dashboard lists signals with their value at cursor A; in diff mode A, B and Δ (B−A, concept §6). Signals get into it by drag or "Add to", like any window. This also answers concept §13's open question on single-value windows: they show the cursor value.
  - **Option bar:** a bar holds cursor A/B on/off and diff mode, the "Link time axes" toggle (moved out of the top bar) and zoom back / reset zoom.
- **Why:** Jan's words: „lass uns das mit drag drop von überall. und das anzeige fenster nur für den cursor wert. und wir brauchen eine leiste für optionen wie diff cursor." The details are his picks from the lead's options. Supersedes D-018's "hover value readout first".

## D-022: Explorer conventions (2026-10-15)

From the archived change `improve-signal-explorer` (design E1, E2, E9, E10); details there.

- **Search in the browser:** the web loads the whole catalog once (`GET /api/catalog`) and ranks per keystroke with the shared `searchSignals` (exact > prefix > name part > description/alias/unit); the server's `/api/signals` uses the same function. Back to server search beyond about 10k signals.
- **One drag machinery:** drag and drop uses pointer events owned by `App`, never HTML5 drag-and-drop; every new drag source joins it via `onDragStart(source, event)`.
- **"Add to" target:** held by window ID, changed only by the user; a removed target falls back to "New window".

## D-021: Window workflow conventions (2026-10-15)

From the archived change `improve-window-workflow` (design D1–D3, D7); details and alternatives there.

- **Time bounds:** every command and series time lies in 1900-01-01 … 2262-04-11 (int64 ns); the UI clamps every zoom to it. Fixes the unbounded zoom-out that produced "1036 … 3937".
- **Linked ranges:** `workspace.linkTime` (default on) is enforced in `applyCommand`: while linked, `window.setRange` from UI or CLI sets every window; re-linking snaps all windows to the last zoomed one. Turning linking off keeps the current ranges.
- **Moves and colours:** `window.moveSignal` moves (same assignment ID) or copies a signal, or puts it into a new untitled window; each signal's palette index (10 colours) is stored in the workspace and survives moves and reloads.
- **Axes:** one y-axis per unit (D-018), stacked L, R, L2, R2 (D-019); `MAX_UNITS = 4` per window, enforced by `addSignal`/`moveSignal` as `too_many_units` and shown as a refused drop target. A signal without unit counts as its own unit.
- **Names:** untitled windows are "Window <n>" after their stable ID `w<n>`, so names never drift.

## D-020: Explorer drag, keys and stable "Add to" target (2026-10-14)

- **Decision:** Answered by Jan on the spec audit of `improve-signal-explorer`:
  - Explorer rows can be dragged onto windows; a window that would reach a fifth unit is shown as refused, the same rule as for legend drags (D-019).
  - The explorer list is keyboard-driven: `/` focuses the search, arrow keys move, Enter adds, Esc clears.
  - The "Add to" target stays where the user put it; creating, renaming or reordering windows does not move it.
  - `improve-window-workflow` gets its spec brought in line with the code and cheap unit tests for wheel factor, inset alignment and Backspace in text fields before it is archived.
- **Why:** The first three come from the power-user report ([feedback/2026-10-14-power-users.md](feedback/2026-10-14-power-users.md)); "Add to" jumping under the click is a reproduced bug. Jan chose to keep them in scope and record them here.

## D-019: Stacked axes; T_SOLL follows the DBC (2026-10-14)

- **Decision:** Answered by Jan on the spec owners' open questions:
  - More than two units in a window: stacked axes, up to two per side (at most four units), the plot area gets narrower. Every value stays readable.
  - T_SOLL's raw 0 (−40 °C, all data on smart451) is shown as a valid value; the DBC rules (D-010, D-014, D-015) apply unchanged, no per-signal exceptions.
- **Why:** Jan's choice. Organisational note by the lead: the explorer items of D-018 (ranking, highlighting, no cap) are built in their own change `improve-signal-explorer`; content unchanged.

## D-018: Scope of the window-workflow change (2026-10-14)

- **Decision:** Answered by Jan after the power-user exploration ([feedback/2026-10-14-power-users.md](feedback/2026-10-14-power-users.md)):
  - "Same value range" means **same unit**: one y-axis per unit, nothing more.
  - The hover value readout belongs to the cursor change, built there first, since it shares the cursor evaluation of concept §6.
  - The window-workflow change also takes: explorer ranking and match highlighting without a hard cap, stable signal colours across windows, window rename, and window layout with keys (resizable window heights, double-click resets zoom, zoom history back).
- **Why:** Jan's choice; keeps the axis rule simple and stable while zooming.

## D-017: Power-user window workflow (2026-10-14)

- **Decision:** Jan's feedback after testing (overall "already usable"):
  - Signals can be moved between windows, back and forth.
  - Signals with the same value range share one y-axis.
  - Time zoom is shared across windows by default and can be switched off. This supersedes concept §4 "Der Zeitzoom ist je Fenster unabhängig" as the default.
  - The signal explorer is a list with details on hover.
  - The explorer search filters on parts of the input (substring match), not only on whole names.
  - Cursors A/B with differences (concept §6) follow as the next change.
  - Further rounds with power users ("UI nerds") who drive the app and feed findings into the changes.
- **Why:** Jan's words: „Signale zwischen zwei anzeigen hin und her. gleiche signalbereich gleiche achse. gemeinsamer zoom standard aktiv abschaltbar. signalexplorer als liste mit hover infos. bei eingabe in suchliste filtern auch auf teile. diff cursor auch als nächster schritt.“

## D-016: SNA conventions across the API (2026-10-14)

- **Decision:** From `add-sna-handling` design S2–S5: in series payloads `null` means SNA and nothing else (raw `v`, edge neighbors, bucket `mean/min/max`, which are null exactly when a bucket has no valid point; `count` counts valid points, `sna` counts SNA points). SNA is matched in ClickHouse within half a raw step of each SNA code's physical value, so aggregates exclude it at the source. Series requests answer 503 `catalog_unavailable` until the catalog has loaded once, since SNA cannot be recognised without it.
- **Why:** One meaning for `null` keeps server and web consistent; matching in the database avoids transferring raw data; the tolerance guards against float differences without swallowing the neighbouring valid code.

## D-015: "No value" labels do not beat GenSigSNA (2026-10-14)

- **Decision:** Refines D-014's label rule: `VAL_` labels that themselves mean "no value" — `--`, `NO_TEMP_SENSOR` and `RES` (reserved) — do not make a `GenSigSNA` value valid; it stays SNA. The list is fixed in the spec and grows only by decision.
- **Why:** Answered by Jan. Taken literally, D-014 would show raw `FFh` of `TirePress_*`, `T_AUSSEN(_RAW)`, `T_SOLL`, `T_INNEN` and 63 of `FCOD_MOT` as real measurements.

## D-014: SNA exceptions and SNA display (2026-10-14)

- **Decision:**
  - A `VAL_` label with a valid meaning (anything other than `SNA`/`SNV`) beats `GenSigSNA` for that raw value: the value is valid. This supersedes D-010's "on conflict both count as SNA".
  - `GenSigSNA` does not apply to 1-bit signals and to checksum/CRC signals.
  - SNA periods are marked as a thin strip per signal at the bottom of the plot, not as full-height shading.
  - In aggregated views a bucket is marked as SNA from a single SNA point; mean/min/max contain valid points only.
- **Why:** Answered by Jan on the spec owner's open questions for `add-sna-handling`. Taking `GenSigSNA` literally hid valid data: `BS_208h.SZS` "1h" = `OK` (100 %), `BS_328h.BS` brake switch (95.8 %), CRC values (0.2–1.5 %). D-010's core rule stays: SNA is never shown as a valid value.

## D-013: Agent team like PCB-dev (2026-10-14)

- **Decision:** The main session stays lead dev and writes no product code. Spec owner, engineers, tester, UI user, reviewer and pacer work as subagents in rounds, following the PCB-dev placer team. Roles and flow: [team.md](team.md).
- **Why:** Requested by Jan for more speed; parallel builds with independent test, UI and review checks.
- **Consequences:** No test manager (the suite runs in seconds); the pacer also holds the watchdog's stop rules. Only the lead commits.

## D-012: Correction to D-010's evidence; SNA is compared physically (2026-10-14)

- **Decision:** D-010 stands. Its example was wrong: `MS_312h.DNMOT` is not SNA. It is scaled `(1, −127)`, so SNA raw `FFh` is physical 128; the constant −127 is raw 0, a valid value. Correct examples: `COMBI_412h.V_ANZ` (raw `1FFh` → 511 km/h) and `BS_200h.DVL` (raw `3FFFh` × 0.5 → 8191.5 1/min, present in the data). SNA raw values from the DBC are converted with factor and offset (two's complement for signed signals) before comparing with stored values, since the decoder stores physical values (`scaling=True`).
- **Why:** The stored values are physical; comparing raw SNA codes would miss real SNA and hide valid values.

## D-011: Architecture of the skeleton (2026-10-14)

From the archived change [add-timeseries-skeleton](../openspec/changes/archive/2026-10-14-add-timeseries-skeleton/design.md); details and alternatives there.

- **Stack (D1, D2):** TypeScript everywhere in a pnpm monorepo (`packages/shared`, `apps/server`, `apps/web`); Node runs the server's TypeScript directly; Fastify, React, uPlot.
- **Time (D3):** int64 nanoseconds as `bigint`; on the wire `t0` + ns offsets; charts draw offsets from a per-window origin.
- **Resolution (D4):** count decides raw vs. buckets; buckets on the absolute grid `k * width`, width `ceil(L / (target − 1))`; arithmetic mean.
- **Source (D5, D6):** one long-format table via configurable column mapping; catalog in server memory; metadata from DBC files, first file wins.
- **Load (D7):** at most 4 concurrent DB queries; aborts cancel server-side via progress headers + `cancel_http_readonly_queries_on_client_close`.
- **Commands (D8):** all workspace changes are commands (`POST /api/commands`), applied by the pure `applyCommand` in `packages/shared`; state and render acknowledgements over `WS /api/live`.
- **Ports:** server 7310 (8080 is taken on the dev machine), UI 5173.

## D-010: SNA values are never shown as valid (2026-10-14)

- **Decision:** A value the DBC marks as "signal not available" (SNA) must never be displayed, aggregated or evaluated as a valid measurement. SNA comes from the union of the `GenSigSNA` attribute (raw hex) and `VAL_` labels `SNA`/`SNV`; on conflict both count as SNA. `GenSigSNA "0h"` means "no SNA defined" unless a `VAL_` label marks 0 as SNA/SNV. Display: the curve breaks at SNA (never interpolated through), SNA periods are marked; aggregates exclude SNA and show its share.
- **Why:** Fixed requirement from the user. Real data proves the need: `MS_312h.DNMOT` is 100 % SNA (shown as a valid −127 line in the skeleton), `COMBI_412h.V_ANZ` jumps to 511 = SNA. In h-can.dbc, 260 signals carry `"0h"` on counters and states where 0 is valid (`OFF`, `SYNCH_OK`, `0Hz`).

## D-009: No special handling for recording pauses (2026-10-14)

- **Decision:** Lines connect consecutive measured points even across long pauses (e.g. car switched off between drives). No gap detection.
- **Why:** Users select meaningful time ranges; pauses are an artifact of browsing whole days, not of investigations.

## D-008: Commit often (2026-10-14)

- **Decision:** Supersedes the commit timing of D-003. Agents commit after every coherent step without asking; pushing still happens at the latest when the session ends.
- **Why:** User preference: rather too many commits than too few.

## D-007: Real data from carserver sdlog, DBC metadata, local test DB (2026-10-14)

- **Decision:** Supersedes the synthetic-data part of D-006. Development uses the existing ClickHouse `sdlog` on carserver (smart451) via SSH tunnel and a read-only user `letsview`. Signal metadata comes from the CarController DBC files. Automated tests use a local Docker ClickHouse with the same schema and synthetic data.
- **Why:** Real data is available; the database has no metadata tables; carserver is too small (2 GB RAM) and not reproducible enough for test runs.

## D-006: ClickHouse first (2026-10-14)

- **Decision:** The first data adapter targets ClickHouse (local via Docker, synthetic data). ADX follows behind the same adapter interface.
- **Why:** Reproducible locally without cloud access.

## D-005: Server + browser (2026-10-14)

- **Decision:** A server holds workspace state, DB credentials, the data adapters and the CLI endpoint. The browser renders and reports back which state revision it has drawn.
- **Why:** The CLI must control the open view (concept §7) and credentials must stay off the client (§8). Stack is left to the first change's design.

## D-004: Build our own (2026-10-14)

- **Decision:** KIPscope is a custom build. Grafana, ibaAnalyzer, PlotJuggler and Seeq (concept §11) serve as references only.
- **Why:** Decided by the user; resolves the build/buy question of concept §12.

## D-003: Commit and push at session end (2026-10-14)

- **Decision:** When the user ends a session, agents commit and push without asking.
- **Why:** No uncommitted work lying around between sessions.

## D-002: Minimal AGENTS.md, decisions in a ledger (2026-10-14)

- **Decision:** AGENTS.md only holds rules and links. Decisions OpenSpec doesn't cover (outside a change's design.md) go here. On archive, project-wide decisions from a change's design.md are copied here too.
- **Why:** Keep agent context small; keep decisions findable in one place.

## D-001: OpenSpec, English artifacts (2026-10-14)

- **Decision:** Development is spec-driven with OpenSpec (schema `spec-driven`). Specs, proposals and code are in English. Claude Code is the configured tool (`/opsx:*` commands); `CLAUDE.md` imports `AGENTS.md`.
- **Why:** Spec-driven workflow chosen by the user; English matches code and tooling.
