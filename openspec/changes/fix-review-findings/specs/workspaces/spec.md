## MODIFIED Requirements

### Requirement: A new tab never mirrors another
`POST /api/workspaces {reuse: true}` SHALL return the requester's own workspace with the latest last-active time that has no live client and was not handed out by another reuse in the last 10 s, else a new one. The pick SHALL be atomic, so two such requests never get the same workspace. `reuse` together with `open` SHALL answer 400. A workspace that `POST /api/workspaces {open: {cases}}` has created and is still filling (signal list, alignment, layout, view) SHALL NOT be returned by a reuse nor removed to make room at the workspace limit until that request has answered; from its answer on it counts as handed out, like a reuse, for 10 s. Origin: exploration row 4 (data fact: two tabs on `/` both landed in `/s/f006vy0ili` and a change in one showed in the other); exploration "Workspaces become invisible" („`/` opens the user's latest workspace that has no open tab, else a new one. A second tab is never mirrored into the first"), accepted by D-086. 10 s: design M4 "Numbers". The catalog open's workspace: review day 2026-10-28 T-04 (the catalog open created the workspace before its slow loads and never claimed it, so a concurrent reuse could get it and its tab then watched a store the catalog open replaced).

#### Scenario: Two start-ups at once
- **WHEN** alice owns workspace F without a live client and workspace L (later) with one live client; `POST /api/workspaces {reuse: true}` is sent twice in parallel; then a third time 11 s later on a fake clock, with no client connected meanwhile; and `{reuse: true, open: {name: "x"}}` is sent
- **THEN**
  - the two parallel answers name F (`reused` true) and a new workspace N (`reused` false); neither names L
  - the third names F again
  - the combined request answers 400
- **Evidence:** `apps/server/test/workspaces.test.ts` › "reuses a free workspace once"; `apps/server/test/workspaces.http.test.ts` › "never hands one free workspace to two tabs"

#### Scenario: A filling workspace is not reused
- **WHEN** on a fake clock alice's registry creates workspace C as filling, then `reuseOf("alice")` runs; then C is marked filled and `reuseOf` runs 5 s later and again 11 s after the mark, each workspace a reuse created being deleted right after it (so C is the only candidate); separately, in a registry with a limit of 3 where alice owns C (filling, least recently active, no client), then D and E (in that order of activity), `create("alice")` runs once with D and E without a client, and in a second such registry with D and E each holding a live client
- **THEN** the first `reuseOf` gives a new workspace (`reused` false, not C); the second also a new one (C is handed out); the third gives C with `reused` true; in the first limit registry `create` removes D, not C; in the second it throws `WorkspaceLimitError` and C still exists
- **Evidence:** `apps/server/test/workspaces.test.ts` › "never reuses a workspace a catalog open is filling"

#### Scenario: Reuse while a catalog opens
- **WHEN** on the test server the source's `listSignals` for C4's first session waits on a gate; alice sends `POST /api/workspaces {open: {cases: <C4>}}` and, while it waits, `POST /api/workspaces {reuse: true}` while every workspace she owns has a live client except the one the catalog open created; then the gate opens
- **THEN** the reuse answers a workspace other than the one the catalog open answers (`reused` false); the catalog open answers 200 with its own workspace
- **Evidence:** `apps/server/test/workspaces.http.test.ts` › "never hands a filling catalog workspace to a reuse"
