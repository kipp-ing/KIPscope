# Proposal

## Why

A search tool (finder; not part of KIPscope) finds sessions and KIPscope shows them (D-078: „gefundene Datenabschnitte effizient darstellen … diese sollen hierher effizient übergeben werden"; „im finder gibt es immer "benachbarte" sessions. wäre toll man kann die mit einem klick wählen. das nachladen muss für die nächste halt auch noch klappen"). Today there is no handoff: a user copies times into "Go to" or a `#view=` link, and every switch between data sections is a page load that drops the tab's cache (exploration [2026-10-20-sessions-and-handoff.md](../../../docs/explore/2026-10-20-sessions-and-handoff.md), findings 5, 6 and 8). Jan settled the open points in D-085 and D-086: rights live in the search tool, a catalog is any list in any order of any VINs, and „unlink ist aktuelles fahrzeug. unlink ist für den user unbegrenzt, rechte haben keinen zeit bezug des objekts". Concept §9 „Untersuchung direkt öffnen: Datensatz, Zeitpunkt, Vor-/Nachlauf und Template oder Signalauswahl gemeinsam über CLI beziehungsweise Link übergeben" becomes a requirement here.

This change builds on `add-multiuser` after its revision (D-086 Q1, Q11): the server state is a "workspace" (`/w/<id>`, `POST /api/workspaces`, `X-KIPscope-Workspace`, `--workspace`), each workspace carries `grant: {objects: "all"} | {objects: string[]}` enforced by the one guard, and `grantObjects(workspaceId, dataRefs)` widens it. This change uses that interface and does not redefine it.

## What Changes

- **Catalog document** (`kipscope: cases`, version 1): an ordered list of sessions (object, kind, `[from, to)`, title, meta, optional anchor), plus `current`, `pad`, `align`, `view` and `origin`. The list order alone defines previous and next (D-085). At most 2,000 sessions.
- **One handoff, four forms** (D-078, D-086 Q2): the link `/open#cases=<JWS>`, a file (`kipscope case open FILE`, or dropped on the window), stdin, and `POST /api/workspaces {open: {cases}}`. Each creates a new workspace and answers its address.
- **Signed by the search tool** (D-085, D-086 Q10): the catalog travels as a JWS (EdDSA or ES256) signed by the search tool's server, with `iss`, `aud`, `sub` (the Ping user), `iat` and a short `exp`. KIPscope verifies it with `KIPSCOPE_FINDER_JWKS`, refuses a `sub` other than the signed-in user, maps each object to a data ref by `KIPSCOPE_CASE_DATAREF` (default `{object}`), and widens the new workspace's grant with `grantObjects` (D-086 Q12: per object, no time part). In identity `none`, unsigned catalogs are accepted.
- **Session bar** in place of the strip's `SCOPE` head: the session's meta, `‹ ›` on hover and focus, keys `[` and `]`, a `3 / 17 ▾` catalog list with a filter, **Unlink** / **Link**, and **Align** (session start, end, payload anchor, or "Align to this event" from an event pin or events-list row).
- **Stepping keeps the dashboard** (D-086 Q4): windows, signals, heights, Diff and the event filter stay; every window range and cursor keeps its offset from the alignment point; signals move to the next session's vehicle by name. No page load.
- **Unlink is the whole vehicle, unbounded for the user** (D-086): the scope becomes the vehicle's full extent, with no default span and no cap. D-082 still holds, because every query follows what is shown: series by view range and zoom level as today, the strip coarse over the whole extent and finer around the view, gaps and events for a work window around the view, and the signal list lazily. The catalog's sessions of this vehicle show as marks on the strip. A measurement task runs this on the Kusto emulator and ClickHouse with a large synthetic history; each costly query has a named fallback.
- **Cache across sessions:** tiles stay in the tab when the scope changes (key without the scope; a tile is stored only when it lies fully inside the scope it was fetched under), and extents and gap info are kept per scope in a small LRU.
- **Neighbour preload** (D-078, D-081): after the view settles, the next and then the previous catalog entry are prepared in the `preload` class: the server warms their signal list, density, gaps and events, and the tab fetches the tiles each window will need after the step. Any gesture cancels it, and it uses at most 25 % of the tab's cache.
- **CLI:** `kipscope case open|show|next|prev|go|link|unlink|align|url|drives`. `case drives REF` builds a catalog from the strip's drives for local tests (D-086 Q8; a dev aid, finding stays with the search tool).
- **Docs:** `docs/handoff.md` gives the search tool the payload, the signing and the link rules, so it can build its "Open in KIPscope" button (D-086 Q9). Plus `docs/http-api.md`, the manual and the README.
- **BREAKING (small):** in a workspace with an open catalog, `scope.set` and `scope.clear` are refused (`case_open`), so the CLI's `scope set|widen|clear` answer `case_open` there; Unlink and Link replace them.

## Capabilities

### New Capabilities

- `case-handoff`: the catalog document, its four forms, signature and user checks, the object → data ref mapping, the grant, limits and errors, the `/open` start-up, and the finder guide.
- `case-navigation`: the case state of a workspace, the `case.*` commands, the alignment rule, moving signals to another vehicle, the session bar, keys, catalog list and Align menu.
- `object-view`: the unlinked state: the vehicle's full extent as scope, the work window, coarse and detail density, gaps, events and the signal list that follow the view, catalog marks, and the measurement.
- `case-preload`: the neighbour preview route, the `preload` request class, the tab's preload with its budget and cancel rule.

### Modified Capabilities

- `series-cache`: tiles survive a scope change.
- `time-strip`: the density of a scope has a coarse and a detail form in an object scope; the scope head gives way to the session bar.
- `data-gaps`: gap info in an object scope covers the asked work window.
- `events`: events in an object scope cover the asked work window.
- `time-navigation`: the clamp message names the session in a case workspace.
- `signal-catalog`: the explorer reloads while the object's list is partial.
- `scope`: scope commands are refused while a catalog is open.
- `cli`: the `case` forms.

## Out of scope

- The "Open in KIPscope" button and the server-side signing in the search tool (its own repo, out of scope of KIPscope, after `docs/handoff.md`).
- Persisting tiles across reloads in IndexedDB (`add-tile-store`, next change).
- Signal books and the learned book (`add-signal-books`); `view` names a saved view or carries an inline view only.
- A live channel between the search tool and KIPscope (`postMessage`), the pull form `/open?set=<id>`, and KIPscope calling the search tool.
- Changing a catalog after it is opened (adding, removing or reordering sessions), and a catalog that spans workspaces.
- Finding sessions in KIPscope (D-078); `case drives` is a test aid only.
- A cap or default span for Unlink (D-086), and capping `Widen` outside a case workspace (it stays as today).
- Following new rows of a vehicle while unlinked (the extent is read at Unlink).
- Replay protection for signed links beyond `exp` and the `sub` binding.

## Open questions for Jan

Tasks are written for the recommended answers. The lead confirms them with Jan before round 1.

- **Q-1 Which event aligns the next session?** "Align to this event" stores the event's kind, source and name (and the state for a state change). (a) **Recommended:** in every session, the first matching event at or after the session's padded start; if none matches, the session's start, and the message line says so. (b) The same occurrence number as in the session where it was chosen (the 2nd ignition stays the 2nd). (a) is predictable and needs no count; (b) helps only when a session holds several matches.
- **Q-2 What does a catalog without `view` open with?** (a) **Recommended:** the windows, signals, events line and filter of the user's most recently active workspace, moved to the session's vehicle, each window at its offset from that workspace's alignment point (or the whole session when it had none). This is what makes a second click in the search tool keep the dashboard. (b) An empty workspace.
- **Q-3 Signals when the next session is another vehicle.** (a) **Recommended:** every signal keeps its name and moves to the new vehicle's data ref; names the new vehicle lacks stay in their windows, show "not in this session", and the message line lists them; they come back on a session that has them. (b) Drop the missing ones.
- **Q-4 What Link does after browsing unlinked.** (a) **Recommended:** Link, or a click on a session mark, restores the layout you had at Unlink, at the chosen session (each window at its old offset from the alignment point). (b) Keep the current zoom and centre it on the session.
- **Q-5 If finding the vehicle's extent is too slow on ADX** (measurement M1). (a) **Recommended:** the object scope becomes the source's retention (`KIPSCOPE_OBJECT_RETENTION`, for example 400 d, ending now) without an extent query; the strip shows empty bars where the vehicle has no rows. The user still sees everything the source holds. (b) The search tool sends each vehicle's first and last time in the payload.
- **Q-6 `scope set`, Widen and Clear while a catalog is open.** (a) **Recommended:** refused with `case_open`: Unlink and Link replace them, and the session bar shows no Widen or Clear. (b) Allowed: they unlink and set that scope.

## Impact

- `packages/shared/src`: new `case.ts` and `caseApply.ts`; `workspace.ts` (`Workspace.case`, `WorkspaceScope.object`, commands, codes, result fields), `scope.ts` (`scopeKey`), `apply.ts`, `views.ts`, `signals.ts` (`CatalogSnapshot.partial`), `series.ts` (`Density.coarse`), `session.ts` (or its renamed successor: the `open` union), `index.ts`.
- `apps/server/src`: new `case.ts`, `caseSignature.ts`, `objectScope.ts`, `routes/case.ts`; changes in `config.ts`, `.env.example`, the workspaces route and store (catalog file, `grantObjects` call), `routes/workspace.ts`, `density.ts`, `gaps.ts`, `events.ts`, `scope.ts`, `http.ts`, `routes/series.ts`, `routes/events.ts`, `routes/signals.ts`. `jose` is already a dependency (`add-multiuser`).
- `apps/server/scripts`: new `seed-long.ts` and `measure-object.ts`.
- `apps/web/src`: new `case/` and `preload/`; changes in `chart/cache.ts`, `chart/rescope.ts`, `chart/overview.ts`, `chart/gaps.ts`, `time/*`, `events/*`, `explorer/*`, `keys.ts`, `App.tsx`, the start-up (`/open`), `filedrop.ts`.
- `apps/cli/src`: the `case` forms.
- Docs: new `docs/handoff.md`; `docs/http-api.md`, `docs/manual.md`, README.
