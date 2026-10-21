# Decision Ledger

Decisions that don't belong to a single OpenSpec change. Newest first. Never edit past entries; supersede them with a new one.

Format: `## D-NNN: Title (YYYY-MM-DD)`, then context, decision, consequences.

## D-091: Handoff findings of the search tool's team (2026-10-21)

Jan, on the issue #1 comment of 2026-10-21: „start with group one as proposed"; on the missing events table: „this will be bigger" (backlog); on the open warning: „keep it until leaving the session"; after his hand check: „looks ok".

- **Decision:** A link too long is trimmed by dropping the far end of the longer side around `current` (tie: before), shipped as `trimCases` and `kipscope case url --trim`. In identity `none` a loopback `origin.url` is kept on any port. The open report (warnings, missing signals, align fallback) shows on every open path: in the bottom bar's notice and as a note in the session bar that stays until ✕ or the next accepted step, go or unlink (the bottom bar keeps D-089's rule). The guide states UTF-16 lengths, whole-catalog refusal, the view's times and the opener rule.
- **Why:** The finder team's findings; the warning in the bottom bar alone went unnoticed in Jan's check.
- **Consequences:** A missing events table, ADX speed, aliases, per-kind views, columns and a handoff store are in the backlog ([status.md](status.md), Next 5). `pnpm smoke` skips an expected API 4xx (`unknown_signal`) by its body code. Archive: [2026-10-21-fix-handoff-findings](../openspec/changes/archive/2026-10-21-fix-handoff-findings/).

## D-090: The search tool is out of scope and not named (2026-10-20)

Jan: „[Suchtool] ist nicht öffentlich. das ist private. also nicht [Suchtool] dokumentieren sondern ein Suchtool. dass klar ist, das ist hier out of scope."

- **Decision:** The search tool that finds sessions and decides rights is a separate, private tool and out of scope of KIPscope. KIPscope documents only the interface: the catalog, its signature and the link. Past entries of this ledger, the specs, the archived changes and the exploration were redacted in place to "the search tool" (Jan's quotes read „[Suchtool]"); this privacy redaction is the one exception to "never edit past entries".
- **Why:** The repo is public; the search tool is not.
- **Consequences:** Any search tool that signs a catalog works; [docs/handoff.md](handoff.md) is the interface. The code keeps its neutral word `finder` (`KIPSCOPE_FINDER_*`). Nothing about the search tool's own code, deployment or plans goes into this repo.

## D-089: Case handoff conventions (2026-10-20)

From the archived change `add-case-open`; details there (design K1–K17). Jan: „super das reicht. bitte archivieren."

- **Decision:** A **catalog** (`{kipscope:"cases", version:1, origin, current, pad, align, view?, cases:[{id, object, kind, from, to, title, meta, anchor?}]}`) is any list of sessions in any order and of any vehicles; its order alone defines ← →. It arrives as `/open#cases=<code>` (a JWS whose payload is the deflate-raw claims JSON, base64url once), as a file (`kipscope case open`, or dropped on the window) or as `POST /api/workspaces {open:{cases}}`, all one command. On a server only a catalog signed by the finder (`KIPSCOPE_FINDER_JWKS`, `iss`, `aud`, `exp`, `sub` = the signed-in user) opens, and its objects, mapped by `KIPSCOPE_CASE_DATAREF` (default `{object}`), widen the workspace's grant through `grantObjects`; with identity `none` unsigned catalogs open. Stepping (`case.go/step`, `[` `]`) keeps windows, signals and cursors at their offset from the alignment point (start, end, anchor, or the first matching event); signals move to another vehicle by name, missing ones are reported. **Unlink** is the whole vehicle with no bound for the user, while every query stays bounded by what is shown (one cached extent, coarse strip, a work window of ≤ 32 days for drives, gaps, events). Tiles are kept across scopes (edge tiles under the scope that fetched them), the next and previous entries are preloaded at background class and every gesture cancels that. `scope set`, Widen and Clear are refused while a catalog is open. `kipscope case drives REF` is a test aid. `docs/handoff.md` is the guide for the search tool.
- **Why:** D-078, D-085 … D-087.
- **Consequences:** Measured on a synthetic 400-day car (57.6 M rows): every query well within its goal on ClickHouse and the Kusto emulator; a real ADX cluster and carserver not measured. Jan's answers to the last two questions („das reicht"): no notice at the end of the catalog; preloading a neighbour may take up to ~13 s on smart451, and a step before that only reloads the visible tile. Not run before the archive: the 1440×900 and 1000×557 sizes. Next on the search tool's side: an "Open in KIPscope" button that has its server build and sign the link (its own repo, out of scope of KIPscope).

## D-088: Multiuser conventions (2026-10-20)

From the archived change `add-multiuser`; details there (design M1–M15).

- **Decision:** Identity is a pluggable adapter (`KIPSCOPE_IDENTITY`: `none` default, `oidc` for Ping-issued JWTs, `module:<path>`); roles are shown, they decide nothing. The server state is a **workspace** (`/w/<id>`, `/api/w/<id>/…`, `X-KIPscope-Workspace`, `--workspace`, `kipscope workspace …`); "session" is reserved for the finder's data section, legacy names only in `LEGACY_*` constants. Each workspace has an owner, a share level (`private`, `read`, `write`) and a grant of data refs (`all` with `none`; empty on a server until a handoff widens it through `grantObjects(workspaceId, dataRefs)`, the only widening path; a stored `all` counts as empty on a server). One guard on every route checks the grant; refusals leak nothing. Sharing never widens data: an invited user sees the workspace's grant only inside it (D-087 Q-6). `KIPSCOPE_SHARE=on|off` is the share right. `/` reuses a free workspace of the user, else creates one; `#view=` and `?view=` open a new one, and views grant nothing; `?view=` takes a slug or the title the menu shows. Views per user under `<stateDir>/users/<user>/views/`. The UI shows Share… and Recent only; gate pages say who is signed in.
- **Why:** D-079, D-083 … D-087; Jan: „gut, archivieren".
- **Consequences:** `add-case-open` widens grants after a verified signed catalog. Not run before the archive: the 1440×900 step of 12.5 ("Share in the row when there is room"), a dev server restart and a restart with the tunnel down, a real Ping tenant ([deploy.md](deploy.md)). During the lead's UI check a test agent deleted Jan's workspace `lhwad0nv1m` (a "Speeds" layout, recoverable by `?view=Speeds`).

## D-087: Answers on add-multiuser Q-6, Q-7 and add-case-open Q-1 … Q-6 (2026-10-20)

Jan: „alle ja“.

- **Decision:** The recommended answers are taken. `add-multiuser`: Q-6 an invited user sees the shared workspace's grant, only inside that workspace; Q-7 on a server a `#view=` or `?view=` link opens a workspace with an empty grant (refused until `add-case-open`). `add-case-open`: Q-1 with event alignment each session aligns to its first matching event, else its start with a message; Q-2 a catalog without `view` takes the layout of the user's latest workspace, moved to the session's vehicle; Q-3 signals move by name, missing ones stay and are reported; Q-4 Link or a click on a mark restores the layout from before Unlink; Q-5 if the extent query is too slow, the scope is the source's retention ending now (`KIPSCOPE_OBJECT_RETENTION`); Q-6 `scope set`, Widen and Clear are refused (`case_open`) while a catalog is open.
- **Why:** Jan accepted all recommendations.
- **Consequences:** Both changes are ready to build: `add-multiuser` first (one more round for the rename and the grant), then `add-case-open`.

## D-086: Answers on the sessions exploration: unlink is the whole vehicle (2026-10-20)

Jan on questions 1–13 of [2026-10-20-sessions-and-handoff.md](explore/2026-10-20-sessions-and-handoff.md): „unlink ist aktuelles fahrzeug. unlink ist für den user unbegrenzt, rechte haben keinen zeit bezug des objekts. der ist ja“ (read as: the rest is „ja“).

- **Decision:** Unlink stays on the current session's vehicle (Q3). For the user, Unlink has no horizon: the vehicle's whole series, with no 31-day default and no 1-year cap (Q5 changed). Rights are per object with no time part: a grant names vehicles, and whoever may see a vehicle may see all of it (Q12 changed: no `grant.objects` windows). The other recommendations are accepted as written: "session" is the data section and the server state is an invisible "workspace" renamed in `add-multiuser` (Q1); signed link with the catalog, same JSON as file and CLI, no live channel (Q2, Q10); alignment to the session start or a chosen event (Q4); cache across switches and neighbour preload in `add-case-open`, IndexedDB store as `add-tile-store` (Q6); VIN → data ref by template (Q7); `kipscope case drives` for local tests (Q8); the search tool's button as a small PR, link built and signed by the search tool's server (Q9); the KIPscope rules file drops out of `add-multiuser` (Q11); a view grants nothing (Q13).
- **Why:** Jan's answers; rights are the search tool's (D-085), and a vehicle is the unit of access.
- **Consequences:** "Unbounded for the user" must still keep D-082's rule that no query scans without bounds: the scope after Unlink is the vehicle's full extent, but every query follows what is shown (series by view range and zoom level, the strip coarse first and finer on zoom, signal list and events lazily). Cost on a large ADX table is unmeasured; `add-case-open` must measure it on the emulator and name a fallback.

## D-085: Rights live in the search tool; a catalog is any list (2026-10-20)

Jan on the exploration [2026-10-20-sessions-and-handoff.md](explore/2026-10-20-sessions-and-handoff.md): „wir können das rechtemanagement in [Suchtool] packen. das mit der zeitlichen session set stimmt nicht. die liste kann beliebig sortiert sein beliebige VINs.“

- **Decision:** Partly supersedes D-084. Who may see which vehicles and sessions is decided in the search tool, not in a KIPscope rules file. A catalog handed to KIPscope is an arbitrary list: any order, any VINs. Its order alone defines previous and next; KIPscope never re-sorts it and never treats "neighbour" as "the same vehicle, adjacent in time".
- **Why:** The search tool is where users find and select sessions, so it already knows what each user may see; one place for rights instead of two.
- **Consequences:** KIPscope can no longer trust a plain handoff link: the search tool must vouch for it (how is open, see the exploration's questions 10–12). Preloading neighbours means the next and previous list entries, which may be other vehicles. The KIPscope rules file of `add-multiuser` is in question before that change is archived.

## D-084: Pluggable identity, roles and rights per data ref (2026-10-19)

Jan on `add-multiuser` Q-1, Q-2, Q-4: „1: bei mir lokal ohne login, bin mein eigener herr. für corp usage brauche ich was mit regeln und rechten. PING id sollte möglich sein mit unterschiedlichen rechten. 2. keine Ahnung es gibt rollen,. die bestätigt ein tool in verbindung mit PIng id. not my business. muss halt anpassbar sein. da darf jeder auch seinen eigenen krams einbauben. nur rollen und recht müssen wirken können und sicher genug sein, also hier darf nicht jeder nutezer alle platformen sehen. q4 views je nutzer, ja“.

- **Decision:** Supersedes D-083 in part: „ping“ means Ping Identity (PingID), not the search tool's login. Identity is a pluggable adapter like the data source: it turns a request (browser or CLI) into a user with roles. KIPscope ships `none` (local, no login, one user who may do everything; the default) and a corporate path that works with Ping Identity; an organisation may plug in its own adapter (its own tool confirms the roles). KIPscope itself enforces rules: roles map to rights, and rights limit which data (platforms, data refs) a user can see, in every query, list, view and CLI call, on the server. Saved views are per user (Q-4 (a)). ADX access stays the server's identity (D-083); the data limits are KIPscope's own.
- **Why:** Jan runs KIPscope alone; in a company not every user may see every platform, and how roles are confirmed differs per company.
- **Consequences:** `add-multiuser` is revised: identity adapter contract, role-to-rights rules, data-ref filtering at one place on the server, CLI callers authenticated through the same adapter. Open: what a „platform“ is in the data (a data ref pattern, or a column in the source).

## D-083: Multiuser answers: SSO hook, rights per session, ADX as the server (2026-10-19)

Jan on the questions of D-079: „Ein SSO hook mit ping oder authentik wäre gut. jedes sesseion braucht rechte, ja. ADX rechte sind serverrechte hier keine unterscheidung“.

- **Decision:** KIPscope learns who a user is through an SSO hook, with the search tool's login („ping“) or authentik as the identity provider; no own user store. Every session (one opened case, its own workspace) carries rights: who may open and change it. Source access is the server's own: on ADX the server's identity reads for every user, with no per-user distinction.
- **Why:** KIPscope runs on a server next to the search tool (D-079); users already sign in there.
- **Consequences:** `add-multiuser` specs the hook (one place that turns a request into a user, as D-079 asked), workspaces per session with an owner and rights, and the CLI against a remote server. Rights on data refs stay out until someone needs them, since ADX makes no distinction.

## D-082: Scope conventions (2026-10-19)

From the archived change `add-scope`; details there.

- **Decision:** A scope (one data ref, `[from, to)`) is an optional workspace field. With it every source query is bounded (contract argument `scope`, „as if the source held only the scope's rows"), the signal list is per scope (4 kept), the strip, gaps and events cover the scope, and range commands are clamped into it (span kept; „Stopped at the scope edge. Widen shows more."). `KIPSCOPE_CATALOG=scoped` drops the start-up catalog and requires a scope; a guard refuses any query without one. A view opens with its `scope` or a derived one (data ref of the first window's first signal, union of the window ranges padded by `KIPSCOPE_SCOPE_PAD`, 1 h); view documents stay v1. „Widen" adds one span on each side (×3), „Clear" drops the scope (not in scoped mode). CLI `scope set|show|widen|clear`. Lead fix: a series range cut to the scope keeps the bucket width of the asked span. Jan's answers: Q-1 (a) opening a view sets the scope in full mode too, Q-2 (a) other data refs' signals are skipped `out_of_scope`, Q-3 (a) ×3.
- **Why:** D-078; issue #1 items 1–5 (unbounded queries time out on large ADX tables). Jan: „Empfehlungen übernehmen", then „sieht aber gut aus. das archievieren wir so, ich teste morgen mehr".
- **Consequences:** The source contract gains an optional `scope` on 11 methods (breaking for adapter authors). Not run before the archive: restart with the tunnel down in scoped mode, the strip at 1440×900 and 1000×557 on smart451, „Copy link" by clipboard (task 4.3); Jan tests on 2026-10-20.

## D-081: Query classes (2026-10-19)

From the archived change `improve-query-priority`; details there.

- **Decision:** Every source query runs in one of four classes, highest first: `interactive` (HTTP requests, catalog loads), `metadata` (D-080 P1 batch), `background` (prefetches, polls), `preload` (D-078 neighbours). A free slot goes to the oldest waiting query of the highest class; running queries are never preempted; one slot is kept for `interactive`. Shared work that a request joins is raised to its class and ranks by when it was raised. Measured periods only for the signals a request names (≤ 100) plus the workspace's window and events-line signals. Jan's answers: Q-1 (a) strict priority, Q-2 (a) strip, gaps and events requests are `interactive`.
- **Why:** Issue #1 item 7: ~2,400 period queries held every slot, plots stayed empty for minutes. Jan: gaps in handed-over sessions are rare, so gap info must never delay the first draw.
- **Consequences:** `/api/value` and the render acknowledgement still wait for gap info (D-062: no value across a gap); add-scope bounds those queries.

## D-080: Signal books with three priorities and a learned book (2026-10-19)

Jan: „1 a und b und ev. ein "lernbuch"? die meisten nutzer nehmen immer die gleichen signale, nur jeder halt andere. 2: drei sollte reichen“.

- **Decision:** A signal book is a list of signal names (without data ref) with a priority each. It comes from a file in KIPscope (`books/<name>.yaml`, chosen by name) or inline from the finder's handoff. A per-user **learned book** collects the signals each user actually works with and ranks them like a book. Three priorities:
  - **P1 core:** top of the explorer in book order; existence in the scope and metadata are fetched right when a case opens, in one batched request.
  - **P2 book:** below P1; metadata when a row becomes visible, is hovered or added.
  - **P3 rest:** every other name in the scope; last in the search; metadata only on hover or add, never ahead.
- **Why:** Up to 10,000 signal names per data ref; names in a scope are cheap (issue #1: ~2,300 in 1.6 s for 24 h), metadata for all of them are not. Most users reuse the same few signals, each user different ones.
- **Consequences:** The learned book needs a user identity (D-079). Where ADX holds units, descriptions and SNA is still open: the Azure users explain it on issue #1 (Jan: „das ist in ADX alles da, aber wie genau müssen adx nutzer erklären“).

## D-079: KIPscope runs on a server, multiuser (2026-10-19)

Jan: „das soll auf einem server laufen, dem gleichen vielleicht wie [Suchtool]. lokal ist immer nur der browser. Multiuser ist also pflicht. eine zugriffsberechtigung im Server muss später auch einbaubar sein“.

- **Decision:** KIPscope is a server application, possibly on the search tool's server; locally there is only the browser. Several users work at the same time, each in their own workspaces. Access control is not built now, but the server gets one place where it can be added later (who is asking, which data refs they may read).
- **Why:** The finder (the search tool) runs centrally and hands cases to its users' browsers.
- **Consequences:** Replaces the one server-held workspace (workspace-state "Server-held workspace") and the local-only rule (server-access) with workspaces per user and a configurable host. The CLI then addresses a workspace on a remote server. Source credentials belong to the server (for ADX a service identity instead of `az login`), never to the browser.

## D-078: The search tool finds, KIPscope shows (2026-10-19)

Jan: „Kipview soll nicht datenabschnitte finden. es soll gefundene Datenabschnitte effizient darstellen. Das [Suchtool] ist zum finden. dort sind gefundene Sessions verfügbar. diese sollen hierher effizient übergeben werden.“ Then: „4 ja, erstmal hart. 5 immer nur eins, aber im finder gibt es immer "benachbarte" sessions. wäre toll man kann die mit einem klick wählen. das nachladen muss für die nächste halt auch noch klappen.“

- **Decision:** KIPscope shows one case at a time: a **scope** (one data ref and one time window) handed over by the finder together with context metadata (VIN, session kind, origin), a signal book (D-080) and the signals of its windows. Every source query is bounded by the scope; nothing scans a data ref's whole history. The scope is a hard edge for now: navigation stops there, widening it is an explicit step. The finder may list the case's neighbouring sessions; one click switches to a neighbour (same windows and signals, new scope), and the neighbours are preloaded in the background so the switch is fast. The handoff works as a link, a CLI call and a file, all one command; concept §9 „Untersuchung direkt öffnen“ becomes a requirement.
- **Why:** On large ADX tables unbounded queries time out (issue #1); finding sessions is the search tool's job.
- **Consequences:** Finding sessions leaves KIPscope: the backlog item „split the data stream into sessions“ is dropped and D-067's session kinds belong to the search tool. Time strip, gaps, events and the catalog cover the scope only. Background preloading must never delay interactive queries (issue #1, item 7).

## D-077: Real DBC names out of the repo (2026-10-17)

Jan: „clean pls“ (after D-076 listed the files that still named real messages and signals).

- **Decision:** No tracked file names a message or signal of the smart451 DBCs, nor their CAN IDs or bit layouts. Specs, archived changes, decisions, feedback, tests, comments and the design mock use one consistent set of made-up names (`ICL_3A2h.SPEED_DISP`, `BRK_1A0h.WSPD_FL`, `DCU_2B8h.HTR_HV_Volt`, ECU prefixes `DCU`, `HVM`, `ICL`, …); past decision entries were rewritten for this only. `kipscope.yaml` is local and gitignored (the repo ships `kipscope.example.yaml` and `demo/kipscope.yaml`); assertions on the real h-can.dbc live in `apps/server/test/*.local.test.ts`, also gitignored. The DBC files themselves stay outside the repo (`../CarController`), as before.
- **Why:** The repo is public; D-076 kept the pictures clean but the text still named real messages.
- **Consequences:** Supersedes D-076's consequence that real names remain. Git history before this commit still holds the real names until it is rewritten. Generic words that happen to be DBC names (`crash`, `odometer`, `DATA`, `CRC_0`, …) stay. A fresh clone runs without `kipscope.yaml` (full names) until one is created from the example.

## D-076: Public pictures show only the demo recording (2026-10-17)

Jan: „we do not want to disclose can messages“; the screenshots show what OVMS knows on the smart, error codes are common knowledge.

- **Decision:** README pictures, the GIF and the manual's examples use the demo recording only: `demo/smart-ed.dbc` (signals the OVMS module `vehicle_smarted` decodes publicly, at its public CAN IDs, with made-up message and signal names), simulated rows from `seed:demo` in the database `demo`, generic SAE J2012 fault codes. `scripts/demo.sh` runs it on 7320/5183; `scripts/capture.mjs` remakes the pictures.
- **Why:** The smart451 DBCs are not public; the repo is. OVMS covers enough of the car (speed, pack, cells, charger, doors, gear) to show every feature.
- **Consequences:** Real DBC names still appear in `kipscope.yaml`, `kipscope.example.yaml`, specs, decisions and tests (and in git history); this decision does not scrub them.

## D-075: ClickHouse progress headers fit the header limit (2026-10-17)

Lead fix during `add-adx-source`; details in its `rounds.md`.

- **Decision:** The ClickHouse client accepts response headers up to 1 MiB (`max_response_headers_size`), and the progress interval is `max(100 ms, ceil(2 · timeout / ((1 MiB − 16 KiB) / (2 · 161 B))))`, so twice the query timeout at twice the measured header size fits. An aborted query still stops within 100 ms for timeouts up to 160 s. The progress headers for prompt cancelling (query queue, design D7) stay.
- **Why:** With progress headers every 100 ms, any query longer than about 10 s exceeded Node's 16 KiB header limit (`Parse Error: Header overflow`). The smart451 logger-gap query on carserver had grown to 10.7 s (105 headers of ~160 B), so gap info failed and `/api/gaps` and `/api/value` answered 502 from 2026-10-17 14:26 until the fix.

## D-074: Data-source contract and ADX source (2026-10-17)

From the archived change `add-adx-source`; details there. Implements the ClickHouse-first decision's „ADX follows behind the same adapter interface".

- **Decision:** An adapter implements 7 required methods (`ping`, `listSignals` with text flags, `raw` with a limit, `before`, `after`, `buckets`, `refBuckets`) plus `info`. The server computes 7 optional fast paths from the core when an adapter leaves them out (`count`, `extent`, `refExtent`, `refCount`, `loggerGaps`, `firstTimes`, `stateChanges`); `events` is a capability (absent: no events). An adapter adds a fast path only where the measured fallback costs more than twice as much. One conformance suite runs every adapter natively and core-only. ClickHouse keeps all 15 methods and its queries unchanged. ADX: KQL over the Kusto REST API, neutral layout `signals`/`events` (`dataref`, `timestamp`) or any stored function, times at 100 ns. Jan's answers: A-1 (a) the token comes from `az account get-access-token`, cached in memory, no dependency; A-2 (a) one source per server via `KIPSCOPE_SOURCE`; A-3 (a) the Kusto emulator as compose profile `adx` with its own `test:adx`, `pnpm test` unchanged. Spec owner's defaults (Jan can veto): source settings only in the environment, `KIPSCOPE_ADX_AUTH=none` and `http://` only for a loopback cluster, the emulator image pinned by digest. Docs: `docs/data-sources.md` (adapter authors, "Connect your ADX") and `docs/http-api.md`.
- **Why:** Jan (2026-10-17): „Next task would be adoptability. if one wants to cennect this to azur cli as data aquisition. the interfaces shall be lean and documented"; then „ADX via az login", „Not yet, emulate", and A-1 … A-3 as recommended.

## D-073: Events usability (2026-10-17)

From the archived change `improve-events` (E-1 … E-4); details there.

- **Decision:** E-1 (a): the events list shows the events in the bar target's view, with a switch `In view | All` (default In view, kept per browser in `kipscope.eventsScope`) and `↑ earlier` / `↓ later` jumps. E-2 (a): `n`/`p`, `‹ ›` and a row click put cursor A on the event (Shift+click: B) and centre the view only when the event lies outside it. E-3 (a): DTCs are fault memory reads: one row per ECU and readout time (expandable), hollow pins and glyphs, a tooltip line saying the onset time is unknown. E-4 (a): filter field, chips and events-line signals sit in a `Refine` section, closed by default (`e` and the strip count open it); rows wrap; a key line under the list; the strip count's tooltip says what the numbers are. The CLI, the filter grammar and `/api/events` are unchanged.
- **Why:** Jan (2026-10-17): „events need an expert, yes i think its cluttered hard to use too“; the list should focus on what is in view. Then: „all recommended“.

## D-072: Add target, reveal and help (2026-10-17)

From the archived change `add-guidance` (G-1 … G-4); details there.

- **Decision:** G-1 (a): any click that ends inside a window marks it as the "Add to" target (header, plot, legend, values table, controls); drags and drops mark nothing; the mark is a 2 px accent frame `#0284c7` plus the "Add to" pill (D-055's 1 px `#7dd3fc` frame retired). G-2 (a): a window created by an add does not become the target; it is revealed and flashes once (D-020, D-027 stand). G-3 (a): help is a non-modal 360 px panel on the right with the tabs *Manual* (`docs/manual.md`, bundled) and *Keys* (from `shortcuts.ts`), opened by "?" at the end of the top row or the `?` key. G-4 (a): a "Start here" card at the top of the window list until dismissed (per browser), always the empty-workspace state. Spec owner's defaults (Jan can veto): next-step hints `Shift+click sets B` and `Diff shows Δ and Δt` in the readout row, each retired once used; reveal and flash for `FLASH_MS` 1,200 ms on windows this tab creates and explorer-add targets, not on drops onto a window or CLI windows; tooltips stay native `title` texts from one hints table (`<Name>: <what it does> · <key>`).
- **Why:** Jan (2026-10-17) on the persona findings: „3. the window the signal goes to maybe could be the window clicked last and (new) outline highlighted or so. 4 yes. we need a manual and hover explanations.“ Then: „all recommended“.

## D-071: Top-row overflow rule (2026-10-17)

From the archived change `add-saved-views` (round 3), first used by `add-guidance`.

- **Decision:** The top row's end holds the overflow items, least-used first: Digits, "+ Values window", Help ("?"). Below one measured container width they all move together into a "⋯" menu (the row's last item, keyboard-reachable; CSS container query, the same controls rendered in the menu). Any later control at the end of the row is an overflow item unless its change says otherwise, and its change re-measures the threshold and writes the widths into the comment in `bar/bar.css`. Before that the title shrinks to `min(n, 10)ch`, long labels hide, and Views shows only its icon.
- **Why:** The lead's decision; Jan called his own hints ideas („do not take my words as hard fact“). The row must not wrap at 1000×557 with the sidebar open and a 120-character title.

## D-070: Saved views conventions (2026-10-17)

From the archived change `add-saved-views`; details there.

- **Decision:** One versioned view document (`kipscope: view`, `version: 1`; YAML on disk, JSON read as well, JSON in links): signals by full ID, absolute UTC times to the ns, no measured data and no credentials. Open replaces the workspace as one command `view.open` with a report of missing and skipped signals; IDs continue; the replaced workspace is kept as "Before last open". Views live in `.kipscope/views/<name>.yaml` (names `[a-z0-9-]` ≤ 63, derived from the title); the workspace state file `.kipscope/workspace.json` is written 500 ms after the last change and on SIGTERM and restored at start with its revision. Links: "Copy link" gives the self-contained `#view=` (deflate-raw, base64url, ≤ 8,192 characters); `?view=<name>` opens a saved view (bookmarks). CLI `view list|save|open|delete|export|import|link`. Jan's answers: S-1 (a) `.kipscope/` in the repo root, gitignored, `KIPSCOPE_STATE_DIR` moves it; S-2 (a) both link forms, the button gives `#view=`; S-4 (a) open without confirmation. Spec owner's defaults (Jan can veto): "Save" in place for a named open view (`Ctrl+S`/`Cmd+S`), "Save as…"; `view.open` with `name` refused on `POST /api/commands`; an "opened elsewhere" notice in other tabs.
- **Why:** Jan (2026-10-17): „5 yes saving the view somehow necessary. url? shared link? yaml export. we need something.“ The dev server's restarts had dropped his 17 windows; in the persona test the boss could not hand a view on. Jan: „all recommended“.

## D-069: A restart restores the whole workspace (2026-10-17)

From the archived change `add-saved-views` (S-3 (b)).

- **Decision:** Supersedes D-051's „commands win until restart“; the rest of D-051 stands. A restart restores the whole workspace, measurement included. The project file's `measurement` section (like its events-line signals) seeds only a fresh workspace (no state file, or one moved to `workspace.bad.json`). A restore never marks the open view modified.
- **Why:** A restart should be invisible; otherwise a measurement set by command, or opened with a view, silently changes back. Jan: „all recommended“.

## D-068: Gap display conventions (2026-10-17)

From the archived change `add-gap-display`, implementing D-062; details there.

- **Decision:** Logger gap = two consecutive rows of a data ref (any signal) ≥ 2 s apart, found exactly from per-second minimum and maximum row times. Period = DBC `GenMsgCycleTime` > 0, else the diag group `interval`, else the median spacing of the first 1,001 rows if ≥ 100 spacings and ≤ 5 % of them longer than 3 medians (smart451: 408 / 29 / 94, 22 without). Split = a logger gap between two points, or more than 3 periods; a step holds at most one period and never into a logger gap; buckets split only on a certain gap (empty stretch > 3 P, or a logger gap between their drawn points). `GET /api/gaps`; cursor reasons `logger_gap` / `period_gap`, cell text `no data`, Δ `—`; band `--gap-fill` `#f1f5f9` under grid and curves. G9: a logger gap that holds a drawn sample splits nothing and draws no band; the server checks each data ref's row count every 5 min and recomputes after new rows (backfill included); the web refetches every 5 min.
- **Why:** D-062. G9 after Jan's report (2026-10-17): „same values are cluttered as dots, which should have a hüllkurve instead? looks strange. I get more data when i zoom in“: a chunk backfilled after the gap info was computed left a stale logger gap that split every point.

## D-067: Session kinds (2026-10-17)

- **Decision:** For the later split of the data stream into sessions: a **driving** session covers at least 500 m driven; a **charging** session at least 0.5 kWh charged (not measured yet); everything else is **idle**.
- **Why:** Jan (2026-10-17): „a driving session has at least 500m drive. a charging seesion has at leat 0.5kwh charged ( not measured yet) the rest ist idle.“ Backlog, not specced yet.

## D-066: Multi-select drops overflow by units (2026-10-17)

From the archived change `add-multi-select`; details there.

- **Decision:** „Only by unit limit": a multi-select drop or add has no signal-count limit. Signals go into the target window until one would need a 5th unit (`MAX_UNITS` = 4). From there on they continue in a new window, and further new windows as needed, each again up to 4 units. „Fill it up": the target window's current units count. Single adds and drops behave as today. Lead's defaults (Jan can veto): plain click selects one row, Ctrl (Cmd on macOS) toggles, Shift selects a range across groups, Shift+Arrow in the search extends it, a query change clears it; dragging a selected row drags the selection, `+`/Enter add it; first window that fits (target, then the drop's new windows); a signal without unit is its own unit; signals already shown are skipped; on the strip only new state signals are added.
- **Why:** Jan (2026-10-17): „I wish i could selct multple entries with shift ctrl or so (win ) to select signals . draw them to one or a new window. after 4 legends signals overflow to new window or so".

## D-065: No text selection in the signal explorer list (2026-10-17)

From the archived change `add-multi-select`.

- **Decision:** „Clicking, double-clicking or Shift/Ctrl-clicking in the signal explorer list (rows and group headers) never selects page text. The search field stays a normal text field." A click in the list moves focus into the search (text not selected), so keys work after a click.
- **Why:** Jan (2026-10-17): „when i select a signal left in signal explorer: many times text ist selected over the browser. thats awkward." Only a drag from the row's name blocked selection.

## D-064: Events conventions (2026-10-16)

From the archived change `add-events`; details there.

- **Decision:** `GET /api/events?dataRef=&signal=…&filter=&from=&to=` returns derived `DiagEvent`s (category from the UDS status byte or the state transition; `inferred` for a snapshot that differs from the previous state, "seen after a gap"), counts per category and source, skipped signals; cached per catalog load, prefetched, capped at 100,000; a missing events table means no events. One filter string in UI, CLI and workspace (`events.setFilter`): category words and presets OR, `ecu:`/`name:`/`text:`, quoted phrases, `-` excludes; one normalised spelling and a sentence describing it; default `active changes`. State changes of a signal come from one window-function query returning changed rows only (≤ 2,000 per signal). Pins in a 6 px lane of the strip (grouped within 6 px), lines and glyphs in the charts (click sets A, Shift+click B), Events sidebar tab. Signals with named states: `VAL_` labels (number in the tooltip), diag enums and text states (label from the row text, label-only tooltip); drawn as steps where a segment has a named end; `kipscope.yaml` `events.signals` (IgnMode, BMS.contactor), a listed signal not recorded yet waits quietly.

## D-063: Diagnostic catalog conventions (2026-10-16)

From the archived change `add-diag-metadata`; details there.

- **Decision:** `KIPSCOPE_DIAG_CATALOGS` lists `.manifest.json` files (default smart451's `bms-live`), `<name>.names.toml` next to each, read on every catalog load; names as the decoder (`<ECU>.<name>`, arrays `.nnn`). `SignalInfo.unit` from the field, `SignalInfo.diag` {file, ecu, group, did, field, element, kind, states, invalid}. DBC wins, then catalogs in list order (one warning). Broken manifest skipped, missing names file falls back to catalog names, server always starts. Invalid sentinels never become SNA. Parser `smol-toml`.

## D-062: Lines break where there is no data (2026-10-16)

- **Context:** Jan: „in the chart windows. lines are drawn throgh times with no data. what can we do, how can we do? better display nothing than smthn wrong". DBC `GenMsgCycleTime` is set for 138 of 327 messages (h-can 47/164, hybrid-can 91/163; often 20 ms); the diagnostic manifest gives each group an `interval` (e.g. 30 s); event-triggered messages have no period.
- **Decision:** Supersedes D-009. Jan chose:
  - A line breaks where the logger recorded nothing at all (every signal), and where a cyclic signal skips more than 3 of its periods (period from the DBC, the diagnostic catalog, else measured). Signals without a known or measurable period break only at logger gaps. The same holds for buckets when zoomed out.
  - Gaps stay blank; logger gaps also get a faint grey band so "no data" reads as intended.
  - A cursor (A, B, L) inside a gap shows „no data", never a value interpolated across it.

## D-061: Diagnostic catalog as metadata source (2026-10-16)

- **Context:** Jan: „if you look now: each cell voltage has its axle". The `BMS.*` readings have no DBC entry, so no unit, and every unit-less signal gets its own y axis (max 4 per window). The decoder's catalog knows them: `CarController/vehicles/smart451/uds/bms-live.manifest.json` (fields with `unit` V, °C, %, A, As, kOhm, km, s; `scales` with factor/offset, `text`, `invalid` sentinels; 22 `enum` fields such as `PRES_Contactor_State` open / precharge / closed) and `bms-live.names.toml` (field → signal name `BMS.<name>`, arrays `.001`…).
- **Decision (lead, on Jan's report):** KIPscope reads the diagnostic catalog (manifest + names) like the DBC files: unit, enum state names and invalid sentinels per `BMS.*` signal. Cell voltages then share one `V` axis. Supersedes "units for the BMS readings: not now" of D-058. The enum names feed D-059's state names.
- **Lead, on the spec:** invalid sentinels of the diagnostic catalog are carried as metadata but never become SNA codes: the decoder already drops invalid answers (0 of 494,084 `BMS.*` rows carry one), and a sentinel's physical value is 0, which would hide valid 0 A rows of `BMS.current`.

## D-060: Strip navigation conventions (2026-10-16)

From the archived change `add-strip-navigation`; details there.

- **Decision:** `Density` gains `grid` (bar width / 400, 9 s at 1 h bars) and `drives` `{from, to, rows}`; one grouping on the grid replaces the bar query (no extra source query). Drive rule: a grid bucket is active at ≥ 1/10 of the fullest one; active runs ≤ 60 s apart merge; a run is a drive only if longer than 2 min (smart451: 5 drives, 3.9–66.3 min; stable under ×½ and ×2 of grid, threshold and merge gap). Every strip action and `,`/`.` sends one `window.setRange` through App's `navigate` (one Back entry; a double-click replaces its first click's entry); drags apply once on release. A window is full, and its body brushes instead of panning, when it covers the recorded data to within 4 px at both ends.

## D-059: State names at the cursors, state changes on the events line (2026-10-16)

- **Context:** Jan: „it fits her. many signals are state, or have some values defined as state. the coursers shall show the statename. like OFF. and if one drags a signal with stats to horizon. the changes are marked. not all stuff shall go to horizon. automatically only two things (yaml define) IGN and contactor state (not recorded yet)". The DBCs hold 441 `VAL_` tables (h-can 195, hybrid-can 246; parsed, so far used only for SNA); diag states carry their label in `sdlog.signals.text` (`BMS.contactor` „open", `BMS.clamp15` „not active"). Ignition candidates: `DCU_1F4h.IgnMode` (`VAL_` KEYON, CHARGE_KEYON, CHARGE, NONE), `BCM_42Eh.IGN_15` (0/1, no `VAL_`).
- **Decision:** Part of `add-events` (D-058):
  - Cursor readouts (A, B, L; legends and values window) show the state name where the value has one (`OFF`), from the DBC `VAL_` table or the row's text.
  - Dragging a signal with states onto the events line (lead's reading of „horizon") marks its state changes there.
  - Only signals listed in `kipscope.yaml` go to the events line automatically: ignition and the contactor state. The contactor is not recorded yet; the entry must wait quietly until it is.

## D-058: Diagnostic data: BMS group and filtered events (2026-10-16)

- **Context:** Jan: „clickhouse supplies now decoded diagnostic data. how can we see it?" carserver now has (device `smart451-diag`): 125 numeric `BMS.*` readings in `sdlog.signals` (no DBC, so group `Other`, no units; already plottable) and a new table `sdlog.events` (`kind` dtc / state / nrc / isotp, `source`, `name`, `value`, `text`, `detail`): 55 DTCs at one time (value = UDS status byte: 41/105 active, 40 stored, 64/80 "test not completed"), 315 state snapshots every ~90 s plus 11 transitions (`detail` „from …"), 2 NRCs, 2 ISO-TP errors.
- **Decision:** Jan chose:
  - The `BMS.*` readings get their own explorer group (config rule, `BMS (diag)`).
  - Events as marks on the time strip and in the chart windows. Jan: „the events line is great. however we need a filter. it can get super overwhelming. the filter also needs cli. it needs human way of thinking too. give this to a proper agent". The filter works in the UI and the CLI and speaks in terms a person uses (e.g. active faults, changes only, by ECU), not raw columns.
- **Not now:** text states as labelled bands (they still plot as a flat 0), units for the BMS readings.
- **Jan's answers on the `add-events` spec (also for D-059):** Q1 default filter `active changes` (not the recommended `faults changes`); Q2 the events list is a sidebar tab; Q4 ignition is `DCU_1F4h.IgnMode`; Q5 the contactor entry is `BMS.contactor`, used now. Lead took the recommended defaults for Q3 (one search-style filter string in UI, CLI and workspace) and Q6 (a snapshot that differs from the previous state counts as a change, marked "seen after a gap").

## D-057: Interactive time strip (2026-10-16)

- **Context:** Jan: „we hav the "sky" where we have data. thats good. but not interactive. will you give it more reason? I no UI expert. but big chances". On smart451 the strip spans ~4.9 d at 1 bar = 1 h: a few drives (up to 50 M rows/h), a steady trickle (~160 k rows/h) between them, many empty hours; a 20 min view is less than one bar.
- **Decision:** Supersedes "no click action" of D-056 and "Clicking does nothing" of `time-strip`. Jan chose three parts of the lead's proposal:
  - **Navigate:** click a bar jumps there keeping the span; drag across the strip zooms to that range; the shown range is a grabbable window (slide = pan, edges = zoom), pixel-exact with a minimum width; double-click shows the whole recording.
  - **Hover and markers:** a bar's tooltip gives its time range and rows; cursors A, B and the live cursor L are marked on the strip.
  - **Drives:** the server finds drives; clicking a drive fits it; keys step to the previous/next drive. The trickle between drives is **not** a drive („only real bursts"); it still shows as bars.
- **Jan's answers on the spec (`add-strip-navigation` design):** Q1 short wake-ups (17–71 s) are not drives, a drive lasts longer than 2 min; Q2 previous/next drive on `,` and `.`; Q3 the windows change once on release, not live while the strip window is dragged.
- **Lead's defaults:** the strip always shows the whole recording; strip actions act on the bar target, or on all windows when time is linked (as Go to). Signal coverage (where a hovered signal has data) is out of scope for now.

## D-056: Design language conventions (2026-10-16)

From the archived change `adopt-design-language`; details there.

- **Decision:** tokens of T1 on `:root` (slate neutrals, sky accent `#0284c7`, 12 px base, 11 px caps labels, mono signal names, tabular numbers, 4 px radius, 26 px controls); A/B/Diff are pills over hidden checkboxes; the marked window is a ring frame plus an "Add to" pill; series palette Okabe-Ito then `#332288 #882255 #999933 #8C564B`; `GET /api/density?dataRef=` with widths of T6 (≤ 120 bars), cached per data ref and catalog load and prefetched after each load (Q4); strip bars 24 px, strip ≤ 56 px, no click action.

## D-055: The search tool's design language (2026-10-16)

- **Context:** Jan: „[Suchtool] has a ui too. i want to take over the design language". Reference: the search tool's UI (Tailwind slate, sky accent, dense 12 px, caps section labels, grey group bands, one dark primary per surface, status pills, Okabe-Ito series). Mock: https://claude.ai/artifact/V6naWfZvN9od7JpM482nta (artboards "Workspace" and "Tokens and parts"), source in [docs/design/](design/) (`Main.dc.html`, `Tokens.dc.html`).
- **Decision:** Jan accepted the mock as shown („accepted right away"), with its defaults: accent sky `#0284c7`, Okabe-Ito series palette, compact density (12 px), and the time strip (data density over the whole recording, the shown range in the accent) on.
- **Jan's answers on the spec:** Q1 no dark "Add … to …" button at the explorer foot (adding stays row "+" and Enter); Q2 the marked "Add to" window gets the ring frame and "Add to" pill of the mock, the accent top bar goes; Q3 the L line is drawn in slate-500, not in the accent (too close to series colour `#0072B2`).
- **Q4 (density cost):** the first uncached density call took 9.2 s on carserver (goal ≤ 5 s); Jan chose (b): the server starts the density query right after each catalog load, so the strip usually finds it cached.
- **Consequences:** restyle only, no behaviour change, except the time strip, which is new. Mock parts with no app feature behind them (the "Values" half of the Signals switch, the `ready` legend pill) are illustration, not requirements.

## D-054: Signal group conventions (2026-10-16)

From the archived change `add-signal-groups`; details there.

- **Decision:** `display.groups` rules (`match` optional, `group` template over named groups and `{sender}`); a blank render falls through to the next rule; computed on the server as optional `SignalInfo.group` (absent = `Other`); the web groups only. Shipped rules: `{sender}`, then `^(?<ecu>DCU|HVM)_` → `{ecu}`. Empty search: groups by name, `Other` last, also while searching; Enter adds the first row shown; arrows include headers, Enter on a header toggles; collapse state is not remembered. `DbcInfo.sender` absent for `Vector__XXX`.

## D-053: Signal groups in the explorer (2026-10-16)

- **Context:** Jan: „signals shall be grouped on left bar. user defined. here as example we use sending ECU". The DBCs name a sender per `BO_` (h-can: Engine, CGW, ESP, …; hybrid-can: DCU, BMS, EM2, …); `Vector__XXX` means no sender.
- **Decision:** Jan chose:
  - Groups are defined by rules in `kipscope.yaml` (like the display-name rules of D-035); the shipped file groups by sending ECU. Restart to change.
  - Empty search: all groups, collapsed. While searching: only groups with a hit, all open, ordered by their best hit; the ranking stays inside each group.
  - Signals without a group (no DBC entry, sender `Vector__XXX`) go to one group `Other`, always last.
  - Design Q1: the shipped file adds a fallback rule `^(?<ecu>DCU|HVM)_` → `{ecu}` after `{sender}`, since h-can.dbc names no sender for those messages (Other would hold 117 of 428 signals).
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

- **Decision:** Jan: the UI shows short signal names (`SPEED_DISP` instead of `ICL_3A2h.SPEED_DISP`), defined per project in a YAML. The YAML holds pattern rules (regex with named groups and a `show` template; first match wins) plus an optional `rename` map for single signals (rename beats rules). When two signals get the same shown name, both show the short name plus a message suffix, e.g. `SPEED_DISP (ICL)`. The full source name stays in the hover card and tooltips; search matches full name, short name and message alike; CLI and API keep the stable full IDs. Lead's defaults: the file is `kipscope.yaml` in the repo root, path overridable by env; no file or no matching rule shows the full name as today.
- **Why:** Jan: „the signal names. no one is interested in hex. so it will be just SPEED_DISP in this case. However: this is different in each project. so a yaml shall be able to define whats shown in the ui". Picks: rules + renames, short + message suffix on collisions, full name in hover card/tooltips, search on both, CLI keeps full IDs.

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

## D-019: Stacked axes; T_SET follows the DBC (2026-10-14)

- **Decision:** Answered by Jan on the spec owners' open questions:
  - More than two units in a window: stacked axes, up to two per side (at most four units), the plot area gets narrower. Every value stays readable.
  - T_SET's raw 0 (−40 °C, all data on smart451) is shown as a valid value; the DBC rules (D-010, D-014, D-015) apply unchanged, no per-signal exceptions.
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
- **Why:** Answered by Jan. Taken literally, D-014 would show raw `FFh` of `TirePress_*`, `T_OUTSIDE(_RAW)`, `T_SET`, `T_CABIN` and 63 of `FCODE_ENG` as real measurements.

## D-014: SNA exceptions and SNA display (2026-10-14)

- **Decision:**
  - A `VAL_` label with a valid meaning (anything other than `SNA`/`SNV`) beats `GenSigSNA` for that raw value: the value is valid. This supersedes D-010's "on conflict both count as SNA".
  - `GenSigSNA` does not apply to 1-bit signals and to checksum/CRC signals.
  - SNA periods are marked as a thin strip per signal at the bottom of the plot, not as full-height shading.
  - In aggregated views a bucket is marked as SNA from a single SNA point; mean/min/max contain valid points only.
- **Why:** Answered by Jan on the spec owner's open questions for `add-sna-handling`. Taking `GenSigSNA` literally hid valid data: `BRK_21Ch.BRK_SW` "1h" = `OK` (100 %), `BRK_33Ch.BRK_STATE` brake switch (95.8 %), CRC values (0.2–1.5 %). D-010's core rule stays: SNA is never shown as a valid value.

## D-013: Agent team like PCB-dev (2026-10-14)

- **Decision:** The main session stays lead dev and writes no product code. Spec owner, engineers, tester, UI user, reviewer and pacer work as subagents in rounds, following the PCB-dev placer team. Roles and flow: [team.md](team.md).
- **Why:** Requested by Jan for more speed; parallel builds with independent test, UI and review checks.
- **Consequences:** No test manager (the suite runs in seconds); the pacer also holds the watchdog's stop rules. Only the lead commits.

## D-012: Correction to D-010's evidence; SNA is compared physically (2026-10-14)

- **Decision:** D-010 stands. Its example was wrong: `ENG_2E8h.MOT_SPD_D` is not SNA. It is scaled `(1, −127)`, so SNA raw `FFh` is physical 128; the constant −127 is raw 0, a valid value. Correct examples: `ICL_3A2h.SPEED_DISP` (raw `1FFh` → 511 km/h) and `BRK_1A0h.WSPD_FL` (raw `3FFFh` × 0.5 → 8191.5 1/min, present in the data). SNA raw values from the DBC are converted with factor and offset (two's complement for signed signals) before comparing with stored values, since the decoder stores physical values (`scaling=True`).
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
- **Why:** Fixed requirement from the user. Real data proves the need: `ENG_2E8h.MOT_SPD_D` is 100 % SNA (shown as a valid −127 line in the skeleton), `ICL_3A2h.SPEED_DISP` jumps to 511 = SNA. In h-can.dbc, 260 signals carry `"0h"` on counters and states where 0 is valid (`OFF`, `SYNCH_OK`, `0Hz`).

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
