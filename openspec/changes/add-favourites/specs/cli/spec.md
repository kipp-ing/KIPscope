## ADDED Requirements

### Requirement: Favourite commands
The CLI SHALL offer `fav list`, `fav add NAME…`, `fav rm NAME…` over `/api/favourites` (design F11). `fav add` SHALL store a full ID's name part, a bare NAME as its one listed match (several: `ambiguous_signal`), and a NAME without match as given, warning `not in this list: NAME…` (exit 0). `fav rm` SHALL resolve against the user's list (`unknown_favourite`, `ambiguous_favourite`). A refusal sends nothing. Origin: concept §7; D-102; D-103.

#### Scenario: Forms
- **WHEN** the argument lists `fav list`, `fav add SPEED_DISP smart451/ICL_3A2h.SPEED_DISP`, `fav rm rpm`, `fav add` and `fav rm` are parsed
- **THEN** the first three give the forms list, add with a bare name and a full ID, and rm with `rpm`; the last two are usage errors (exit 2)
- **Evidence:** `apps/cli/test/args.test.ts` › "maps the fav forms"

#### Scenario: Add, list, remove over HTTP
- **WHEN** against the test server (`none` mode, temp state dir) `fav add rpm testcar/Fast_100h.SIG_A`, `fav add RPM`, `fav list`, `fav rm sig_a` and `fav list` run
- **THEN** each exits 0; the first prints `data.names` `["Sna_800h.RPM", "Fast_100h.SIG_A"]`, `data.added` the same and a `workspace`; the second `data.added` `[]`; the first list `["Sna_800h.RPM", "Fast_100h.SIG_A"]`; the rm `data.removed` `["Fast_100h.SIG_A"]`; the last list `["Sna_800h.RPM"]`
- **Evidence:** `apps/cli/test/cli.test.ts` › "adds, lists and removes favourites"

#### Scenario: Refusals
- **WHEN** against the test server (test DB with `Sna_800h.TEMP` and `Tmp_A21h.TEMP`) `fav rm NOPE` and `fav add temp` run
- **THEN** each exits 1 with `outcome` `rejected` and `error.code` `unknown_favourite` and `ambiguous_signal` (`error.candidates` `["Sna_800h.TEMP", "Tmp_A21h.TEMP"]`); `GET /api/favourites` is the same before and after
- **Evidence:** `apps/cli/test/cli.test.ts` › "refuses unknown and ambiguous favourite names"

#### Scenario: Name of another vehicle
- **WHEN** against the test server with no favourites `fav add rpm Other_900h.FOREIGN` runs, then `fav list`
- **THEN** the add exits 0 with `data.added` `["Sna_800h.RPM", "Other_900h.FOREIGN"]` and `data.warnings` `["not in this list: Other_900h.FOREIGN"]`; the list is `["Sna_800h.RPM", "Other_900h.FOREIGN"]`
- **Evidence:** `apps/cli/test/cli.test.ts` › "stores a name not in the list with a warning"
