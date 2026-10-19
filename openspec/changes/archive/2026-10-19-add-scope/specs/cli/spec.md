# cli delta

T1 = 2026-10-01T01:00:00Z = `1790816400000000000`, T2 = 02:00:00Z = `1790820000000000000`.

## ADDED Requirements

### Requirement: Scope commands
The CLI SHALL offer `scope set REF FROM TO`, `scope show`, `scope widen` and `scope clear` as in design Z13, each printing one JSON line and honouring `--wait`; FROM and TO follow "Time arguments". `scope widen` without a scope SHALL exit 1 with `scope_required` and send nothing; a missing or extra argument SHALL be a usage error. Origin: issue #1 item 5 („`scope set <ref> <from> <to>`"); D-078 (explicit widening); concept §7.

#### Scenario: Forms map to commands
- **WHEN** the argument lists `scope set testcar 2026-10-01T01:00:00Z 2026-10-01T02:00:00Z`, `scope clear`, `scope set testcar 2026-10-01T01:00:00Z` and `scope show extra` are parsed
- **THEN** the first two give `{"type":"scope.set","dataRef":"testcar","from":"1790816400000000000","to":"1790820000000000000"}` and `{"type":"scope.clear"}`; the last two are usage errors
- **Evidence:** `apps/cli/test/args.test.ts` › "maps the scope forms"

#### Scenario: Set, show, widen, clear over HTTP
- **WHEN** against the test server (stub catalog, full mode) `scope widen`, `scope set testcar "2026-10-01 03:00" "2026-10-01 04:00"` (TZ Europe/Berlin), `scope show`, `scope widen`, `scope show` and `scope clear` run
- **THEN** the first exits 1 with `scope_required` and the revision is unchanged; the set exits 0 with one new revision; `scope show` gives `data.scope` {testcar, T1, T2}, `data.catalog.mode` `full`, `local.from` `2026-10-01 03:00:00+02:00`; after the widen `data.scope` is {testcar, T1 − 1 h, T2 + 1 h}; the clear exits 0 and `kipscope state` shows no `scope`
- **Evidence:** `apps/cli/test/cli.test.ts` › "sets, shows, widens and clears the scope"

#### Scenario: Help lists the forms
- **WHEN** `kipscope --help` runs
- **THEN** the text names `scope set`, `scope show`, `scope widen` and `scope clear`
- **Evidence:** `apps/cli/test/cli.test.ts` › "prints the usage with --help" (form list extended)
