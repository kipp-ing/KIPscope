## MODIFIED Requirements

### Requirement: Catalog from drives
`case drives REF FROM TO` (FROM and TO as in "Time arguments", at most 32 days apart) SHALL print a catalog document with one session per drive of REF in `[FROM, TO)`. Each session has `id` `<REF>|drive|<from ISO>`, `object` REF, `kind` `driving`, `from`, `to`, `title` `Drive <k>` and `meta {rows}`. The drives are found as follows:
- One bounded `GET /api/density?dataRef=REF&from&to` per UTC day the range touches, cut to the range, one request at a time.
- A day answering `too_wide` is asked again as four 6 h parts.
- Drives that touch at a day or part edge are merged, their rows summed.

`case drives` SHALL exit 1 with `no_data` when there is no drive, with `too_wide` when a 6 h part is still too wide, and with a usage error when FROM or TO is missing or the range spans more than 32 days. It is a test aid and works in scoped mode without a scope (scope "Scoped mode needs a scope"): without `--workspace` it SHALL send its density requests to a workspace of its own without a scope, made by the call with `POST /api/workspaces {}` and deleted at its end, also after a failure, so the scope of the latest workspace never binds it; with `--workspace` it uses that one. Origin: D-086 Q8 („`kipscope case drives <dataRef>` builds a catalog from the strip's drives … a dev aid"); D-117 („Without the search tool, a scope is set by hand or with the CLI (`scope set`, `case drives`)"); 32 days: D-089 (work window ≤ 32 d).

#### Scenario: Drives beside a scoped workspace
- **WHEN** the latest workspace on the test server has the scope drivecar 2026-10-01 00:00 – 2026-10-01 06:00 UTC and `case drives drivecar 2026-10-02T00:00:00Z 2026-10-03T00:00:00Z` runs without `--workspace`
- **THEN** it exits 0 with the drives of 2026-10-02 (not `out_of_scope`), and afterwards `GET /api/workspaces` lists the same workspaces as before
- **Evidence:** `apps/cli/test/cli.test.ts` › "case drives ignores the latest workspace's scope"

#### Scenario: Drives of drivecar
- **WHEN** against the test server `case drives drivecar 2026-10-02T00:00:00Z 2026-10-03T00:00:00Z` runs, and `case drives nosuchcar 2026-10-02T00:00:00Z 2026-10-03T00:00:00Z`
- **THEN** the first exits 0 with `data.kipscope` `cases`, one entry per drive in `/api/density?dataRef=drivecar&from=2026-10-02T00:00:00Z&to=2026-10-03T00:00:00Z` with the fields above in time order; the second exits 1 (the server's 404 code)
- **Evidence:** `apps/cli/test/cli.test.ts` › "builds a catalog from drives"

#### Scenario: Days, parts and merges
- **WHEN** a stub server answers the density of day 1 with a drive ending at its end, of day 2 with `too_wide`, of day 2's first 6 h part with a drive starting at its start, and of every other part with no drive; and `case drives car D1 D3` runs (two days); then `case drives car D1` and `case drives car D1 <D1 + 33 d>`
- **THEN** the first sends the requests for day 1, day 2 and day 2's four parts, one at a time in that order, and prints one session spanning both drives with their rows summed; the last two are usage errors that send nothing
- **Evidence:** `apps/cli/test/cli.test.ts` › "builds drives day by day and merges at edges"

#### Scenario: Help lists the forms
- **WHEN** `kipscope --help` runs
- **THEN** the text names every `case` form with `case drives REF FROM TO` and says that `case drives` is a test aid
- **Evidence:** `apps/cli/test/cli.test.ts` › "prints the usage with --help" (form list extended)
