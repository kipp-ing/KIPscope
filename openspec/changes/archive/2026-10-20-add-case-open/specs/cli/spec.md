# Spec Delta

## ADDED Requirements

### Requirement: Case commands
The CLI SHALL offer `case open FILE|-`, `case show`, `case next`, `case prev`, `case go N`, `case link [N]`, `case unlink`, `case align start|end|anchor`, `case align event KIND SOURCE NAME [TEXT]` and `case url FILE|-` as in design K15, each printing one JSON line and the command forms honouring `--wait`; N SHALL be a 1-based position (an integer ≥ 1, else a usage error). Origin: D-078 („Link, CLI-Aufruf und Datei, alles ein Befehl"); concept §7 („Vollständige CLI-Fernsteuerung"); D-086 Q2.

#### Scenario: Forms map to requests
- **WHEN** the argument lists `case next`, `case prev`, `case go 3`, `case go 0`, `case link`, `case link 2`, `case unlink`, `case align anchor` and `case align event dtc ECU1 B1234` are parsed
- **THEN** they give `case.step {by: 1}`, `case.step {by: -1}`, `case.go {index: 2}`, a usage error, `case.go` with the workspace's `current` (resolved at run time), `case.go {index: 1}`, `case.unlink`, `case.align {align: {mode: "anchor"}}` and `case.align {align: {mode: "event", event: {kind: "dtc", source: "ECU1", name: "B1234"}}}`
- **Evidence:** `apps/cli/test/args.test.ts` › "maps the case forms"

#### Scenario: Open, step and unlink over HTTP
- **WHEN** against the test server (identity `none`) `case open c4.json` runs with C4, then with `--workspace <new id>` `case show`, `case next`, `case show`, `case unlink`, `case next` and `case link`
- **THEN** the open exits 0 with `local.url` `<server>/w/<id>` and `data.case.count` 4; the first show has `local.position` `1 / 4`; the step exits 0 and the second show reads `2 / 4`; the unlink exits 0; the next exits 1 with `case_unlinked`; the link exits 0 and the workspace is linked at entry 1 again
- **Evidence:** `apps/cli/test/cli.test.ts` › "opens, steps and unlinks a catalog"

#### Scenario: Open from a pipe
- **WHEN** `kipscope case drives testcar` is piped into `kipscope case open -`
- **THEN** the open exits 0 and the new workspace's catalog has one entry per drive of testcar's density
- **Evidence:** `apps/cli/test/cli.test.ts` › "builds a catalog from drives"

### Requirement: Catalog link from the CLI
`case url FILE|-` SHALL print `local.url` `<server>/open#cases=<code>`, a JWS passed as it is and a document encoded unsigned like `#view=`, and SHALL exit 2 with `link_too_long` when the link exceeds 8,192 characters. Origin: exploration "Commands and routes" (`kipscope case link file.json` prints the link; renamed `case url` because `case link` returns to a session); D-070 (link limit).

#### Scenario: Link of a catalog
- **WHEN** `case url c4.json` runs with C4, then `case url` with a file holding a JWS, then with a 2,000-session catalog
- **THEN** the first prints a url whose code `decodeCasesLink` turns back into C4; the second prints `<server>/open#cases=<the JWS>`; the third exits 2 with `link_too_long`
- **Evidence:** `apps/cli/test/cli.test.ts` › "prints a catalog link"

### Requirement: Catalog from drives
`case drives REF` SHALL print a catalog document with one session per drive of REF's density (`id` `<REF>|drive|<from ISO>`, `object` REF, `kind` `driving`, `from`, `to`, `title` `Drive <k>`, `meta {rows}`), and SHALL exit 1 with `no_data` when there is no drive. Origin: D-086 Q8 („`kipscope case drives <dataRef>` builds a catalog from the strip's drives … a dev aid").

#### Scenario: Drives of drivecar
- **WHEN** against the test server `case drives drivecar` runs, and `case drives nosuchcar`
- **THEN** the first exits 0 with `data.kipscope` `cases`, one entry per drive in `/api/density?dataRef=drivecar` with the fields above in time order; the second exits 1 (the server's 404 code)
- **Evidence:** `apps/cli/test/cli.test.ts` › "builds a catalog from drives"

#### Scenario: Help lists the forms
- **WHEN** `kipscope --help` runs
- **THEN** the text names every `case` form and says that `case drives` is a test aid
- **Evidence:** `apps/cli/test/cli.test.ts` › "prints the usage with --help" (form list extended)
