## ADDED Requirements

### Requirement: View commands
The CLI SHALL offer `view list`, `view save TITLE [--name N] [--note TEXT] [--overwrite]`, `view open NAME`, `view delete NAME` and `view import FILE [--name N] [--overwrite] [--open]`, each printing one JSON line; `view open` SHALL report like a command and honour `--wait`. An unreadable FILE or one over 256 KiB SHALL be a usage error. Origin: concept §7 (everything from the shell); concept §9 („… über CLI").

#### Scenario: Forms
- **WHEN** the argument lists `view save "Drive 3" --note "BLS first" --overwrite`, `view open drive-3`, `view import x.yaml --name copy --open` and `view save` (no title) are parsed
- **THEN** the first three give the requests of design V8 (`POST /api/views {title: "Drive 3", note: "BLS first", overwrite: true}`, `POST /api/views/open {name: "drive-3"}`, an import with `name: "copy", open: true`); the last is a usage error
- **Evidence:** `apps/cli/test/args.test.ts` › "maps the view forms"

#### Scenario: Save, list, open over HTTP
- **WHEN** against the test server with a temp state dir `window create --title Speeds`, `view save Speeds`, `window remove w1`, `view open speeds` and `view list` run
- **THEN** each exits 0; the open's output has `accepted` true, a revision one higher than before and `data.report.missing` `[]`; `kipscope state` shows a window titled Speeds; the list holds `speeds` (no `_previous`: the workspace was empty before the open)
- **Evidence:** `apps/cli/test/cli.test.ts` › "saves, lists and opens views"

#### Scenario: Unknown view and existing name
- **WHEN** `view open nope` runs, and `view save Speeds` runs a second time without `--overwrite`
- **THEN** both exit 1 with `outcome` `rejected`, the first with `error.code` `unknown_view`, the second with `view_exists`
- **Evidence:** `apps/cli/test/cli.test.ts` › "saves, lists and opens views"

### Requirement: View export prints the file
`view export NAME` SHALL print the view's YAML text unchanged to stdout and exit 0; with `--out FILE` it SHALL write the text to FILE and print one JSON line with `data {name, path, bytes}`. On failure it SHALL print the usual JSON line. Origin: Jan 2026-10-17 („yaml export"); like `events list --table` (D-058), the useful output of this form is the file itself.

#### Scenario: Export round trip
- **WHEN** `kipscope view export speeds > s.yaml` runs as a separate process, then `kipscope view import s.yaml --name speeds-copy`
- **THEN** `s.yaml` starts with `kipscope: view` and the import exits 0 with `data.view.name` `speeds-copy`
- **Evidence:** `apps/cli/test/process.test.ts` › "exports a view as YAML text"

#### Scenario: Export to a file on real data
- **WHEN** `kipscope view export <name> --out /tmp/v.yaml` runs against the dev server for a saved view
- **THEN** it prints one JSON line with `data.bytes` equal to the size of `/tmp/v.yaml`, whose text equals `curl -s localhost:7310/api/views/<name>`
- **Evidence:** the command and `cmp` of the two texts

### Requirement: Link from the CLI
`view link [--page URL]` SHALL print one JSON line with `data {url, chars}`: `url` is `<page>#view=<code>` for the open workspace, built by `viewLinkUrl` like the UI's "Copy link" (design V1, round 3), and `chars` its length; `--page` SHALL default to the server address. Origin: concept §9 („Untersuchung direkt öffnen … über CLI oder Link"); design goal "the CLI can do all of it"; round-1 finding (the UI user's tool cannot read the clipboard).

#### Scenario: Link of the open workspace
- **WHEN** against the test server `window create --title Speeds` runs, then `view link --page http://127.0.0.1:5173/`, and the code after `#view=` is decoded with `decodeViewLink`
- **THEN** it exits 0, `data.url` starts with `http://127.0.0.1:5173/#view=`, `data.chars` equals the length of `data.url`, and the decoded document has one window titled Speeds; `args.test.ts` maps `view link` without `--page` to the `--server` address
- **Evidence:** `apps/cli/test/cli.test.ts` › "prints a link to the open workspace"; `apps/cli/test/args.test.ts` › "maps the view forms"; equality with "Copy link": saved-views "Same link from web and CLI"

## MODIFIED Requirements

### Requirement: One JSON result per call
Each call SHALL print exactly one JSON object on one line to stdout (indented with `--pretty`) with `ok`, `outcome` and `exitCode` and, where they apply, `accepted`, `command`, `revision`, `created`, `createdWindow`, `render`, `data`, `local` and `error {code, message}`, except that a successful `events list --table` prints its table and a successful `view export NAME` without `--out` prints the view's YAML text. A failed call SHALL also print one line naming the reason to stderr. Origin: concept §7 („maschinenlesbare Ergebnisse"); table: D-058; YAML text: Jan 2026-10-17 („yaml export"), this change.

#### Scenario: Accepted command
- **WHEN** `kipscope diff on` runs against a fresh test server as a separate process
- **THEN** stdout is exactly one line that parses as `{"ok":true,"outcome":"ok","exitCode":0,"accepted":true,"command":{"type":"cursor.setDiff","diff":true},"revision":1}`, stderr is empty and the exit code is 0
- **Evidence:** `apps/cli/test/process.test.ts` › "prints one JSON line on stdout and nothing on stderr"

#### Scenario: Failed call
- **WHEN** `kipscope cursor move b +1s` runs as a separate process while B is off
- **THEN** stdout is one JSON line with `"ok":false` and `"outcome":"rejected"`, stderr is one line containing `cursor_off`, and the exit code is 1
- **Evidence:** `apps/cli/test/process.test.ts` › "prints the reason of a failure on stderr"

#### Scenario: Table only on success
- **WHEN** `kipscope events list --table --ref nope` runs as a separate process
- **THEN** stdout is one JSON line with `"outcome":"rejected"` and `error.code` `unknown_data_ref`, and the exit code is 1
- **Evidence:** `apps/cli/test/process.test.ts` › "prints the reason of a failure on stderr" (table case)

#### Scenario: YAML only on success
- **WHEN** `kipscope view export nope` runs as a separate process
- **THEN** stdout is one JSON line with `"outcome":"rejected"` and `error.code` `unknown_view`, stderr names `unknown_view`, and the exit code is 1
- **Evidence:** `apps/cli/test/process.test.ts` › "exports a view as YAML text" (failure case)

