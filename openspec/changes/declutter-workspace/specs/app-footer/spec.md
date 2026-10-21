## MODIFIED Requirements

### Requirement: Footer in the bottom bar
The footer SHALL be part of the status strip below the window list (`workspace-layout` "Top row and status strip"), not a second strip. From left to right the bar SHALL hold the status (a 7 px dot, `connected` or `disconnected`, its tooltip "Status tooltip"; the dot in the ok colour while connected with the source reachable, else in the error colour; then the message), the measurement info, the automatic meta items and, as its last element at the right end, the attribution group with tool name, the link to the author's site and license. Origin: Jan („a footer permanently visible"; license and link at the far right); D-025 (no extra strip); status tooltip: D-092 (8).

#### Scenario: Order in the bar
- **WHEN** the workspace holds measurement name `Testfahrt A9`, the meta answer is in with a reachable source, and the bar is rendered to static markup
- **THEN** the text order is `connected`, `Testfahrt A9`, `Europe/Berlin` (the zone of the test), `KIPscope · kipp.ing · AAL` from left to right, all inside the one status strip element, the attribution group is its last child, and the markup shows neither `revision` nor `ClickHouse sdlog` as text (both are in the status `title`)
- **Evidence:** `apps/web/test/footer.test.ts` › "orders status, measurement, meta and attribution"

### Requirement: Automatic meta items
Right of the measurement info the footer SHALL show as items only: the data source while it is unreachable (`<label> unreachable` in the error colour, the error in its tooltip; `<label>` is `ClickHouse sdlog`, `ADX <database>` for an ADX source, the kind as given for any other kind), the catalog while it is unavailable (`catalog unavailable`, error colour, the reason as tooltip) or no scope is set in scoped mode (`No scope`, muted), the browser's time zone (`Europe/Berlin`, UTC offset as tooltip) and the signed-in user ("Signed-in user in the footer"). A reachable source, a loaded or loading catalog, the signal count, the revision and the build SHALL show only in the status tooltip ("Status tooltip"). Origin: Jan („useful meta info"); concept §8 (local time display), §10 (errors stay visible); ADX label: add-adx-source; into the tooltip: D-092 (8) („revision, source, signal count and commit go into the status dot's tooltip", supersedes D-050's footer items).

#### Scenario: Items from meta
- **WHEN** `footerItems` gets a meta with a reachable `clickhouse` source on database `sdlog`, a loaded catalog of 1234 signals, commit `7c1e2a9` dirty, and the zone `Europe/Berlin` at offset +120 min
- **THEN** it returns one item, `Europe/Berlin` with a tooltip containing `UTC+02:00`
- **Evidence:** `apps/web/test/footer.test.ts` › "turns meta into footer items"

#### Scenario: ADX and other kinds
- **WHEN** `footerItems` and `statusTooltip` get a reachable source of kind `adx` on database `kipscope_test`, then an unreachable one, then a reachable source of kind `memory` on database `fixture`
- **THEN** the first gives no source item and a status tooltip whose first line holds `ADX kipscope_test`; the second the item `ADX kipscope_test unreachable` (error); the third no source item and `memory fixture` in the tooltip's first line
- **Evidence:** `apps/web/test/footer.test.ts` › "labels ADX and unknown source kinds"

#### Scenario: Unhappy states
- **WHEN** `footerItems` gets an unreachable source with error `connect ECONNREFUSED`, a `loading` catalog and commit `null`; then a `failed` catalog
- **THEN** it returns `ClickHouse sdlog unreachable` (error) with the error in its tooltip, no catalog item and no build item, and `statusTooltip` names `catalog loading`; then `catalog unavailable` (error) with the reason as tooltip
- **Evidence:** `apps/web/test/footer.test.ts` › "shows unreachable, loading and failed meta"

#### Scenario: Tunnel drop on real data
- **WHEN** the UI is open on carserver data, the lead stops the tunnel (`scripts/tunnel.sh stop`) and waits 35 s, then starts it and waits 35 s
- **THEN** the footer shows `ClickHouse sdlog unreachable` in the error colour after the first wait; after the second the item is gone, the status tooltip's first line names `ClickHouse sdlog`, and nothing left of the item moved; no reload
- **Evidence:** lead's manual check (screenshot after each wait, the status `title`)

### Requirement: Meta refresh
The UI SHALL fetch `/api/meta` when the page loads, every 30 s and each time the live channel connects again. Before the first answer no automatic meta item SHALL be shown and the status tooltip SHALL hold the revision only. After a failed fetch the last items SHALL stay, and the status tooltip SHALL start `last known; server not reachable`. Origin: concept §10 (errors stay visible); 30 s per design F3 of `add-footer`; tooltip: D-092 (8).

#### Scenario: Stale and missing meta
- **WHEN** `statusTooltip` gets revision 7 and a meta with the flag that the last fetch failed, then revision 7 and no meta; and `footerItems` gets no meta
- **THEN** the first tooltip starts `last known; server not reachable`; the second is `revision 7`; the items are an empty list
- **Evidence:** `apps/web/test/footer.test.ts` › "marks stale meta and shows none before the first answer"

#### Scenario: Refetch on reconnect
- **WHEN** the server is restarted while the UI is open
- **THEN** within 5 s after the live channel connects again the status tooltip shows the new start time
- **Evidence:** lead's manual check (status `title` before and after `scripts/restart-server.sh`)

### Requirement: Footer fits its width
The bar SHALL never cut the status or the attribution, nor an item beyond its own limit. When the line lacks space, whole items SHALL be hidden in this order until the rest fits: time zone, catalog, measurement meta entries from the last, user, source, object, name. A shown message counts at full width and truncates with `…` only once all items are hidden. Origin: Jan („permanently visible"); AAL clause 2 (D-049); order per design F5 of `add-footer`, the build item gone by D-092 (8).

#### Scenario: Drop order
- **WHEN** `fitFooter` gets status width 110 (dot and `connected`), attribution 140 (about the width of `KIPscope · kipp.ing · AAL` at 11 px), items in display order source 160 (unreachable), zone 90, user 60, gap 12, no message, and available widths 620, 600, 500, 420 and 240
- **THEN** it shows all three items at 620; source and user at 600; source at 500; none at 420, `wrap` false in all of these; at 240 `wrap` is true (110 + 12 + 140 > 240)
- **Evidence:** `apps/web/test/footer.test.ts` › "hides whole meta items in a fixed order"

#### Scenario: Message beats meta
- **WHEN** `fitFooter` gets the widths of the previous scenario, available 780 and a message of 300 px, then a message of 900 px
- **THEN** with 300 px it shows only source and does not wrap; with 900 px it shows no item and does not wrap (the message truncates)
- **Evidence:** `apps/web/test/footer.test.ts` › "lets a message push out meta items before it truncates"

#### Scenario: Measurement outlives automatic items
- **WHEN** `fitFooter` gets status 110, attribution 140, gap 12, items in display order name 100, object 70, `driver: Jan` 80, `weather: rain` 100, zone 90, no message, and available 780, 700, 640 and 540
- **THEN** at 780 it shows all five; at 700 name, object, `driver: Jan`, `weather: rain`; at 640 name, object, `driver: Jan`; at 540 name, object; `wrap` is false in all four
- **Evidence:** `apps/web/test/footer.test.ts` › "hides automatic items before measurement items"

#### Scenario: Error message at 1000×557
- **WHEN** at 1000×557 with the sidebar open the marked window shows four units and the user adds `ENG_2E8h.MOT_SPD_D` with Enter
- **THEN** the bar stays one line, the `too_many_units` message is shown (cut with `…` if needed, full text as tooltip), every shown item is whole, and the attribution is fully shown
- **Evidence:** UI check on smart451 at 1000×557 (screenshot)

### Requirement: Second line on narrow widths
When status and attribution alone do not fit one line, the attribution SHALL move to a second line, still right-aligned, the first line keeping status, message and items by the same rules, and the bar SHALL be at most 48 px tall. Hidden items SHALL be listed in the tooltip of the attribution's leading `KIPscope`. Origin: necessary consequence of "Attribution small and subtle" (never cut) on narrow screens; 48 px per design F5 of `add-footer`.

#### Scenario: Narrow viewport
- **WHEN** the six-window setup is shown at 520×557 with the sidebar open (the bar's content box is about 228 px, less than status and attribution need)
- **THEN** the bar has two lines, at most 48 px tall, the first starting with the dot and `connected`, the second holding the whole attribution with both links, right-aligned; no text of the bar is cut
- **Evidence:** UI check on smart451 at 520×557 (screenshot, bar height); `not_run` if the browser tool cannot set the viewport

#### Scenario: Hidden items in the tooltip
- **WHEN** the status bar is rendered with zone and user hidden by the fit
- **THEN** the `title` of the leading `KIPscope` lists the zone and user items' texts
- **Evidence:** `apps/web/test/footer.test.ts` › "lists hidden items in the KIPscope tooltip"

### Requirement: Signed-in user in the footer
With an identity other than `none` the footer SHALL show the signed-in user's ID as the last automatic meta item, with the tooltip `Signed in as <user> (<identity>) · roles: <roles>` (`none` when there are none); with `none` it SHALL show no user item. Origin: necessary consequence of D-083 and D-084 (several users with different rights on one server: the user must see as whom and with which roles they act); design M12 of `add-multiuser`.

#### Scenario: User item
- **WHEN** `footerItems` gets the meta of "Items from meta" with `me` `{user: "alice", identity: "oidc", roles: ["testers", "viewers"], …}`, then `{user: "bob", identity: "oidc", roles: [], …}`, then `{user: "local", identity: "none", …}`, then without `me`
- **THEN** the first returns `Europe/Berlin` followed by `alice` with the tooltip `Signed in as alice (oidc) · roles: testers, viewers`; the second ends with `bob` and `roles: none`; the third and fourth return `Europe/Berlin` only
- **Evidence:** `apps/web/test/footer.test.ts` › "shows the signed-in user"

## ADDED Requirements

### Requirement: Status tooltip
The status's tooltip SHALL hold, one per line: `revision <n> · <source label> · <count> signals · server <commit>` (unknown parts left out, `catalog loading` while loading, `<commit>*` when dirty, the line prefixed `last known; server not reachable · ` after a failed meta fetch), then the source, catalog and build details the removed items' tooltips held (design DW9). Origin: D-092 (8); mock `Main.dc.html`.

#### Scenario: Tooltip lines
- **WHEN** `statusTooltip` gets revision 4, a reachable `clickhouse` source on `sdlog` table `sig`, a loaded catalog of 415 signals and commit `3e849e8` clean; then the same with commit dirty and the source unreachable with error `connect ECONNREFUSED`
- **THEN** the first line is `revision 4 · ClickHouse sdlog · 415 signals · server 3e849e8`, followed by lines starting `ClickHouse sdlog.sig · reachable · checked`, `catalog loaded` and `server commit 3e849e8`; the second has `server 3e849e8*` in its first line, a line containing `connect ECONNREFUSED` and one containing `uncommitted changes at start`
- **Evidence:** `apps/web/test/footer.test.ts` › "puts revision, source, catalog and build into the status tooltip"

#### Scenario: Footer on smart451
- **WHEN** smart451 is shown at 1440×900 and at 1000×557 with the sidebar open, no measurement info, identity `none`
- **THEN** the footer reads the dot, `connected`, `Europe/Berlin` and the attribution only; the status `title` starts `revision ` and names `ClickHouse sdlog` and the signal count; the bar is one line ≤ 32 px at both sizes
- **Evidence:** UI check on smart451 (screenshot per size, the status `title`)
