## Purpose

The footer part of KIPscope's bottom bar: the author's attribution and the license link the Attribution Assurance License asks for, the served license text, the user's measurement info, a few automatic meta items about the running server and the data source, and how the bar fits narrow widths.

## ADDED Requirements

### Requirement: Footer in the bottom bar
The footer SHALL be part of the status strip below the window list (`workspace-layout` "Top row and status strip"), not a second strip. From left to right the bar SHALL hold the status (connection, revision, message), the measurement info, the automatic meta items and, as its last element at the right end, the attribution group with tool name, the link to the author's site and license. Origin: Jan („a footer permanently visible"; license and link at the far right); D-025 (no extra strip).

#### Scenario: Order in the bar
- **WHEN** the workspace holds measurement name `Testfahrt A9`, the meta answer is in, and the bar is rendered to static markup
- **THEN** the text order is `connected · revision`, `Testfahrt A9`, `ClickHouse sdlog`, `KIPscope · kipp.ing · AAL` from left to right, all inside the one status strip element, and the attribution group is its last child
- **Evidence:** `apps/web/test/footer.test.ts` › "orders status, measurement, meta and attribution"

### Requirement: Footer always visible
The bar SHALL stay inside the viewport and fully visible while the window list scrolls, with the sidebar open or collapsed, during a drag and with no window. At 1440×900 and 1000×557 it SHALL be one line at most 32 px tall. Origin: Jan („permanently visible"); one line: necessary consequence of `workspace-layout` "Compact bars" and "Screen use" (30 % at 1000×557).

#### Scenario: Visible while scrolling
- **WHEN** the six-window setup (`workspace-layout` design M1) is shown at 1440×900 with the sidebar open, the list is scrolled to the top, then to the end, then the sidebar is collapsed
- **THEN** in all three states the bar's `getBoundingClientRect().bottom` is ≤ 900 and ≥ 892, the attribution `KIPscope · kipp.ing · AAL` is fully shown, and no window overlaps the bar
- **Evidence:** UI check on smart451 at 1440×900 (screenshot per state, bar rect)

#### Scenario: No window
- **WHEN** the workspace has no window
- **THEN** the bar sits at the viewport bottom and shows status, meta items and attribution as with windows
- **Evidence:** UI check (screenshot)

#### Scenario: One line at the usual sizes
- **WHEN** the six-window setup is shown at 1440×900 and at 1000×557, each with the sidebar open and collapsed, without measurement info
- **THEN** the bar is one line, at most 32 px tall in each of the four states, and at 1000×557 with the sidebar open the plot share of `workspace-layout` "Testers' viewport" is still at least 30 %
- **Evidence:** UI check on smart451 (bar height per state, snippet output of design M1 at 1000×557)

### Requirement: Attribution and license link
The attribution group SHALL read `KIPscope · kipp.ing · AAL`, where `kipp.ing` links to `https://kipp.ing` and `AAL` to `/api/license`. Both links SHALL open in a new tab with `rel="noopener noreferrer"` and carry the tooltips of design F1 (`kipp.ing`: name, profession and slogan). Origin: Jan („the name of the tool, the license and a short link to my web page"); AAL clause 2 per D-049; tooltip: design Q1, revised by Jan 2026-10-16.

#### Scenario: Markup
- **WHEN** the status bar is rendered to static markup outside a drag
- **THEN** its visible text is `KIPscope · kipp.ing · AAL` and does not contain `Jan Kipping`; it has an `a` with `href="https://kipp.ing"`, `target="_blank"`, `rel="noopener noreferrer"` and `title="© 2026 Jan Kipping, Agentic engineer · efficient agentic engineering"`, and an `a` with `href="/api/license"`, `target="_blank"`, `rel="noopener noreferrer"` and `title="Attribution Assurance License"`
- **Evidence:** `apps/web/test/footer.test.ts` › "renders the attribution with both links"

#### Scenario: Links in the browser
- **WHEN** the user clicks `kipp.ing`, then, back in the KIPscope tab, clicks `AAL`
- **THEN** each opens a new tab, the first at `https://kipp.ing`, the second showing plain text whose first line is `Attribution Assurance License`; the KIPscope tab keeps its workspace and revision
- **Evidence:** UI check (screenshot of each new tab, revision before and after)

### Requirement: Attribution small and subtle
The attribution group SHALL sit right-aligned at the bar's right end, in 11 px (one step below the bar's 12 px main text) and the muted colour `--muted`, links included, while status and measurement items use 12 px. It SHALL stay readable and visible: never cut, faded or hidden, also not during a drag. Origin: Jan, 2026-10-16 (license and kipp.ing link „small and subtle" at the far right); AAL clause 2 (display), D-049; sizes per design F5.

#### Scenario: Right end, smaller and muted
- **WHEN** the bar is shown at 1440×900 with measurement name `Testfahrt A9`, idle and during a drag
- **THEN** the attribution group's right edge is within 12 px of the bar's right edge; its `getComputedStyle` gives `font-size` 11 px, `opacity` 1 and colour `rgb(100, 116, 139)` in both states; the status text and the measurement name give `font-size` 12 px
- **Evidence:** UI check on smart451 at 1440×900 (rects and computed values in both states)

### Requirement: License text served
The server SHALL answer `GET /api/license` with 200, `content-type: text/plain; charset=utf-8` and the content of `LICENSE` in the repo root, read once at start. Without that file it SHALL log a warning at start and answer 404 `license_missing`. The route SHALL pass the `server-access` guard like every route. Origin: necessary consequence of the `AAL` link: it must show the text of the running build whatever the repository's visibility (design F4).

#### Scenario: Text served
- **WHEN** the app is built with the content of the repo's `LICENSE` as license text and `GET /api/license` is sent
- **THEN** the answer is 200 with `content-type` `text/plain; charset=utf-8`, the body equals the file's content, and its first line is `Attribution Assurance License`
- **Evidence:** `apps/server/test/meta.http.test.ts` › "serves the license text"; command `curl -s localhost:7310/api/license | head -1` prints `Attribution Assurance License`

#### Scenario: File missing
- **WHEN** the app is built without license text and `GET /api/license` is sent
- **THEN** the answer is 404 with `error.code` `license_missing`
- **Evidence:** `apps/server/test/meta.http.test.ts` › "answers 404 without a license file"

#### Scenario: Foreign host refused
- **WHEN** `GET /api/license` and `GET /api/meta` are sent with `Host` `evil.example:7310`
- **THEN** both answer 403 `forbidden_host`
- **Evidence:** `apps/server/test/meta.http.test.ts` › "keeps the access guard on meta and license"

### Requirement: Server meta
The server SHALL answer `GET /api/meta` with the `ServerMeta` of design F2: the repo's short git commit at server start (`null` without git) and whether tracked files had uncommitted changes, the start time, the source's kind, database and table with its reachability, and the catalog's state (`loaded`, `loading`, `failed`), size, load time and, when not loaded, its reason. Origin: Jan („useful meta info"); concept §10 („Fehler … müssen erkennbar bleiben").

#### Scenario: Reachable source
- **WHEN** the app is built against the test database with a loaded catalog, build info `{commit: "7c1e2a9", dirty: true}` and a ping that resolves, and `GET /api/meta` is sent
- **THEN** the answer is 200 with `build.commit` `7c1e2a9`, `build.dirty` true, `source` `{kind: "clickhouse", database, table}` from the config with `reachable` true and an ISO `checkedAt`, and `catalog.state` `loaded` with `size` equal to `GET /api/catalog`'s item count
- **Evidence:** `apps/server/test/meta.http.test.ts` › "reports build, source and catalog"

#### Scenario: Catalog not loaded
- **WHEN** `GET /api/meta` is sent before the first catalog load finished, and again after a load failed
- **THEN** `catalog.state` is `loading`, then `failed`, `size` 0, and `reason` equals the catalog's `unavailableReason`
- **Evidence:** `apps/server/test/meta.http.test.ts` › "reports a catalog that has not loaded"

#### Scenario: Build info
- **WHEN** `readBuildInfo` runs with a git runner that prints `7c1e2a9` for `rev-parse` and ` M apps/web/src/App.tsx` for `status`, with one that prints nothing for `status`, and with one that throws
- **THEN** it returns commit `7c1e2a9` dirty true, commit `7c1e2a9` dirty false, and commit `null` dirty false
- **Evidence:** `apps/server/test/meta.http.test.ts` › "reads the commit and the dirty flag from git"

#### Scenario: Real server
- **WHEN** the dev server runs from a clean checkout and `curl -s localhost:7310/api/meta | jq -c '[.build.commit, .source.database, .source.reachable, .catalog.state]'` runs
- **THEN** it prints the output of `git rev-parse --short=7 HEAD` and `"sdlog"`, `true`, `"loaded"`
- **Evidence:** the `curl` command (lead, tunnel up)

### Requirement: Source ping
`source.reachable` SHALL come from a ping of the source that bypasses the query queue, counts as failed after 2 s without answer, and is shared by concurrent meta requests (one ping in flight). A failed ping SHALL give `reachable` false with the reason in `source.error`. Origin: concept §10 (a dropped tunnel stays visible, D-042); bypass: a ping queued behind slow series queries would report a false outage; 2 s per design F2.

#### Scenario: Source down
- **WHEN** the ping rejects with `connect ECONNREFUSED 127.0.0.1:18123`, and in a second app it never settles
- **THEN** the first answers `source.reachable` false with `source.error` naming `ECONNREFUSED`; the second answers within 3 s with `reachable` false and `error` `no answer within 2 s`
- **Evidence:** `apps/server/test/meta.http.test.ts` › "reports an unreachable source", "gives up the ping after 2 s"

#### Scenario: One ping for concurrent requests
- **WHEN** three `GET /api/meta` are sent at once while the ping takes 100 ms
- **THEN** the ping runs once and all three answer the same `checkedAt`
- **Evidence:** `apps/server/test/meta.http.test.ts` › "shares one ping between concurrent requests"

### Requirement: No credentials in meta
The meta answer SHALL NOT contain the source URL, host, port, user or password. Origin: D-005 and concept §8 (access data stays on the server, „Zugangsdaten gehören nicht in exportierte Templates").

#### Scenario: No credentials
- **WHEN** the app's source config holds URL `http://default:s3cret@127.0.0.1:18123` and `GET /api/meta` is sent
- **THEN** the body contains none of `s3cret`, `18123`, `127.0.0.1` and `default:`
- **Evidence:** `apps/server/test/meta.http.test.ts` › "never sends source credentials"

### Requirement: Measurement info in the footer
When the workspace holds measurement info (`measurement-info`), the footer SHALL show it as separate items: the name, the object, then each meta entry as `key: value`, following the state of the current revision. Without measurement info nothing SHALL be shown for it: no label, no placeholder, no empty separator. Origin: Jan, 2026-10-16 („meta info shall be cli settable or yaml definable. so like measurement name, measurement object, measurement meta"); empty state per the lead's brief.

#### Scenario: Empty state
- **WHEN** `measurementItems` gets `undefined`, and the status bar is rendered to static markup with a workspace without `measurement`
- **THEN** the first returns an empty list, and the markup holds no measurement element and no `Measurement` text
- **Evidence:** `apps/web/test/footer.test.ts` › "shows nothing without measurement info"

#### Scenario: Set from the CLI on real data
- **WHEN** the UI is open at 1440×900 with the sidebar open, and `kipscope measurement name "Testfahrt A9"`, `kipscope measurement object smart451` and `kipscope measurement meta driver Jan` run, then `kipscope measurement clear`
- **THEN** after the third the footer shows `Testfahrt A9 · smart451 · driver: Jan` between the status and the automatic meta items, without a reload; after the clear none of it is shown and nothing takes its place
- **Evidence:** UI check on smart451 at 1440×900 (screenshot after the third command and after the clear)

### Requirement: Long measurement texts
Each measurement item SHALL show at most 40 characters, a longer one cut with a trailing `…`. The measurement group SHALL have a tooltip with every field in full, one per line: `Measurement: <name>`, `Object: <object>`, then `<key>: <value>`. Origin: necessary consequence of the one-line bar ("Footer always visible") with texts up to 200 characters (`measurement-info` "Measurement limits"); 40 per design F3.

#### Scenario: Items from the workspace
- **WHEN** `measurementItems` gets `{name: "Testfahrt A9", object: "smart451", meta: [{key: "driver", value: "Jan"}, {key: "route", value: <60 characters>}]}`
- **THEN** it returns `Testfahrt A9`, `smart451`, `driver: Jan` and the route item of 40 characters ending in `…`, and the group tooltip holds the full route value
- **Evidence:** `apps/web/test/footer.test.ts` › "turns measurement info into footer items"

### Requirement: Automatic meta items
Right of the measurement info the footer SHALL show, per design F3: the data source (`ClickHouse sdlog`, ok colour when reachable, `ClickHouse sdlog unreachable` in the error colour when not), the catalog (`<n> signals`, `catalog loading`, `catalog unavailable`), the browser's time zone (`Europe/Berlin`, UTC offset as tooltip) and the build (`7c1e2a9`, `7c1e2a9*` when dirty, none when the commit is `null`). Origin: Jan („useful meta info"); concept §8 (local time display), §10.

#### Scenario: Items from meta
- **WHEN** `footerItems` gets a meta with a reachable `clickhouse` source on database `sdlog`, a loaded catalog of 1234 signals, commit `7c1e2a9` dirty, and the zone `Europe/Berlin` at offset +120 min
- **THEN** it returns, in this order, `ClickHouse sdlog` (ok), `1234 signals`, `Europe/Berlin` with a tooltip containing `UTC+02:00`, and `7c1e2a9*` with a tooltip containing `uncommitted changes`
- **Evidence:** `apps/web/test/footer.test.ts` › "turns meta into footer items"

#### Scenario: Unhappy states
- **WHEN** `footerItems` gets an unreachable source with error `connect ECONNREFUSED`, a `loading` catalog and commit `null`; then a `failed` catalog
- **THEN** it returns `ClickHouse sdlog unreachable` (error) with the error in its tooltip, `catalog loading` (muted) and no build item; then `catalog unavailable` (error) with the reason as tooltip
- **Evidence:** `apps/web/test/footer.test.ts` › "shows unreachable, loading and failed meta"

#### Scenario: Tunnel drop on real data
- **WHEN** the UI is open on carserver data, the lead stops the tunnel (`scripts/tunnel.sh stop`) and waits 35 s, then starts it and waits 35 s
- **THEN** the source item reads `ClickHouse sdlog unreachable` in the error colour after the first wait and `ClickHouse sdlog` in the ok colour after the second, without a reload
- **Evidence:** lead's manual check (screenshot after each wait)

### Requirement: Meta refresh
The UI SHALL fetch `/api/meta` when the page loads, every 30 s and each time the live channel connects again. Before the first answer no automatic meta item SHALL be shown. After a failed fetch the last items SHALL stay, the source item muted with its tooltip starting `last known; server not reachable`. Origin: concept §10 (errors stay visible); 30 s per design F3.

#### Scenario: Stale and missing meta
- **WHEN** `footerItems` gets a meta with the flag that the last fetch failed, and then no meta
- **THEN** the first gives the source item muted with a tooltip starting `last known; server not reachable`; the second an empty list
- **Evidence:** `apps/web/test/footer.test.ts` › "marks stale meta and shows none before the first answer"

#### Scenario: Refetch on reconnect
- **WHEN** the server is restarted while the UI is open
- **THEN** within 5 s after the live channel connects again the build item's tooltip shows the new start time
- **Evidence:** lead's manual check (tooltip before and after `scripts/restart-server.sh`)

### Requirement: Footer fits its width
The bar SHALL never cut the status or the attribution, nor an item beyond its own limit. When the line lacks space, whole items SHALL be hidden in this order until the rest fits: build, time zone, catalog, measurement meta entries from the last, source, object, name. A shown message counts at full width and truncates with `…` only once all items are hidden. Origin: Jan („permanently visible"); AAL clause 2 (D-049); order per design F5.

#### Scenario: Drop order
- **WHEN** `fitFooter` gets status width 160, attribution 140 (about the width of `KIPscope · kipp.ing · AAL` at 11 px), item widths source 100, catalog 80, zone 90, build 60, gap 12, no message, and available widths 780, 680, 580, 480, 380 and 280
- **THEN** it shows all four items at 780; source, catalog, zone at 680; source, catalog at 580; source at 480; none at 380, `wrap` false in all of these; at 280 `wrap` is true (160 + 12 + 140 > 280) and the first line shows source
- **Evidence:** `apps/web/test/footer.test.ts` › "hides whole meta items in a fixed order"

#### Scenario: Message beats meta
- **WHEN** `fitFooter` gets the widths of the previous scenario, available 780 and a message of 300 px, then a message of 900 px
- **THEN** with 300 px it shows only source and does not wrap; with 900 px it shows no item and does not wrap (the message truncates)
- **Evidence:** `apps/web/test/footer.test.ts` › "lets a message push out meta items before it truncates"

#### Scenario: Measurement outlives automatic items
- **WHEN** `fitFooter` gets status 160, attribution 140, gap 12, items in display order name 100, object 70, `driver: Jan` 80, `weather: rain` 100, source 100, catalog 80, zone 90, build 60, no message, and available 780, 680 and 580
- **THEN** at 780 it shows name, object, `driver: Jan`, source; at 680 name, object, source; at 580 name, object; `wrap` is false in all three
- **Evidence:** `apps/web/test/footer.test.ts` › "hides automatic items before measurement items"

#### Scenario: Error message at 1000×557
- **WHEN** at 1000×557 with the sidebar open the marked window shows four units and the user adds `ENG_2E8h.MOT_SPD_D` with Enter
- **THEN** the bar stays one line, the `too_many_units` message is shown (cut with `…` if needed, full text as tooltip), every shown item is whole, and the attribution is fully shown
- **Evidence:** UI check on smart451 at 1000×557 (screenshot)

### Requirement: Second line on narrow widths
When status and attribution alone do not fit one line, the attribution SHALL move to a second line, still right-aligned, the first line keeping status, message and items by the same rules, and the bar SHALL be at most 48 px tall. Hidden items SHALL be listed in the tooltip of the attribution's leading `KIPscope`. Origin: necessary consequence of "Attribution small and subtle" (never cut) on narrow screens; 48 px per design F5.

#### Scenario: Narrow viewport
- **WHEN** the six-window setup is shown at 520×557 with the sidebar open (the bar's content box is about 228 px, less than status and attribution need, about 290 px; the shorter attribution keeps one line down to a viewport of about 580 px)
- **THEN** the bar has two lines, at most 48 px tall, the first starting with `connected · revision`, the second holding the whole attribution with both links, right-aligned; no text of the bar is cut
- **Evidence:** UI check on smart451 at 520×557 (screenshot, bar height); `not_run` if the browser tool cannot set the viewport

#### Scenario: Hidden items in the tooltip
- **WHEN** the status bar is rendered with build and zone hidden by the fit
- **THEN** the `title` of the leading `KIPscope` lists the zone and build items' texts
- **Evidence:** `apps/web/test/footer.test.ts` › "lists hidden items in the KIPscope tooltip"

### Requirement: Attribution at server start
On start the server SHALL log one info line with the text of `attributionText()` (design F1): `KIPscope © 2026 Jan Kipping, Agentic engineer, https://kipp.ing · Attribution Assurance License (AAL)`. Origin: AAL clause 2 („each time the resulting executable program … is launched, a prominent display"), per D-049;.

#### Scenario: Start log
- **WHEN** the dev server starts (`pnpm --filter @kipscope/server dev`)
- **THEN** its log shows a line whose `msg` is `KIPscope © 2026 Jan Kipping, Agentic engineer, https://kipp.ing · Attribution Assurance License (AAL)` before `catalog loaded`
- **Evidence:** command `grep -n "attributionText" apps/server/src/main.ts` prints the log call; lead's check of the start log
