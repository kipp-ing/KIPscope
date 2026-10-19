## MODIFIED Requirements

### Requirement: CLI client of the open workspace
The CLI `kipscope` SHALL control a session's workspace only through the server's HTTP API, at `--server <url>`, else `KIPSCOPE_URL`, else `http://localhost:7310`. The session SHALL be `--session <ID or session link>`, else `KIPSCOPE_SESSION`, else the session of a session link given as `--server` (its origin is then the server), else the user's default session (sessions "Default session"). With a token from `--token <T>`, else `KIPSCOPE_TOKEN`, else the trimmed output of `KIPSCOPE_TOKEN_COMMAND` (run once per call, design M13), every request SHALL carry `Authorization: Bearer <T>`; the token SHALL never be printed. Every output of a call that served a session SHALL name it as `session`. The CLI SHALL never read the data source directly. `--help` SHALL print the usage of every form and exit 0. Origin: concept §7 (the CLI controls the open view; „Eine KI verwendet diese reguläre Schnittstelle"); D-005 (the server holds the CLI endpoint); D-011 (D8, commands via `POST /api/commands`); session and token: D-079 („The CLI then addresses a workspace on a remote server"), D-083, D-084 (CLI callers authenticated through the same adapter; a tool connected to Ping supplies the token).

#### Scenario: Server address
- **WHEN** `kipscope state` runs once with `--server http://127.0.0.1:<port>`, once with only `KIPSCOPE_URL=http://127.0.0.1:<port>`, and once with both set to different servers
- **THEN** the first two read the test server; the third reads the `--server` one
- **Evidence:** `apps/cli/test/cli.test.ts` › "chooses --server over KIPSCOPE_URL over localhost:7310"

#### Scenario: Usage
- **WHEN** `kipscope --help` runs
- **THEN** it prints a usage text naming every form of the requirements below, `--session` and `--token`, and exits 0 without contacting a server
- **Evidence:** `apps/cli/test/cli.test.ts` › "prints the usage with --help"

#### Scenario: Session and server from options
- **WHEN** the options `--server https://k.example/s/abcdefghij`, `--server https://k.example --session https://k.example/s/abcdefghij`, `--session abcdefghij` with `KIPSCOPE_SESSION=bbbbbbbbbb`, only `KIPSCOPE_SESSION=bbbbbbbbbb`, and `--session ABC` are parsed
- **THEN** they give server `https://k.example` and session `abcdefghij` (twice), session `abcdefghij`, session `bbbbbbbbbb`, and a usage error
- **Evidence:** `apps/cli/test/args.test.ts` › "reads the session and the token"

#### Scenario: Session named in the output
- **WHEN** against the test server (`none` mode) with two sessions A (older) and B (latest), `kipscope state`, `kipscope --session A state` and `kipscope --session A window create --from 0 --to 10` run
- **THEN** the first prints `session` B; the second prints `session` A with A's workspace; the third is accepted on A, and B's revision is unchanged
- **Evidence:** `apps/cli/test/cli.test.ts` › "addresses a session"

#### Scenario: Token against a server with `oidc`
- **WHEN** the test server runs `oidc` against a local JWKS server, a test token for `alice` with roles `[testers]` exists, and `kipscope whoami` runs without a token, with `--token <alice's token>`, with `KIPSCOPE_TOKEN=garbage`, with `KIPSCOPE_TOKEN_COMMAND` set to a script printing alice's token, and with `KIPSCOPE_TOKEN_COMMAND` set to `exit 3`
- **THEN** the first exits 1 with `error.code` `unauthenticated`; the second and fourth exit 0 with `data.user` `alice`, `data.identity` `oidc` and `data.roles` `[testers]`; the third exits 1 with `invalid_token`; the fifth exits 2 with `error.code` `token_command_failed` and the server received no request; no output contains the token
- **Evidence:** `apps/cli/test/cli.test.ts` › "sends the token"

## ADDED Requirements

### Requirement: One session per call
All requests of one CLI call SHALL go to the same session: the given one, or, when none is given, the session named by the first answer's `X-KIPscope-Session` header, for every later request of that call. `--wait` and `wait` SHALL therefore wait for a UI connected to that session. Origin: concept §7 („ob … die offene Oberfläche den Zustand dargestellt hat": the UI that shows the changed session); necessary consequence of the default session (it may change between two requests).

#### Scenario: Wait sees only its session
- **WHEN** a fake browser is connected only to session A, session B is the default, and `kipscope --wait diff on` runs, then `kipscope --session A --wait diff on`
- **THEN** the first exits 6 with `render.status` `no_ui` and `session` B; the second exits 0 with `render.status` `complete` and `session` A
- **Evidence:** `apps/cli/test/cli.test.ts` › "waits for a UI of the same session"

### Requirement: Session commands
The CLI SHALL offer `whoami`, `session list`, `session new`, `session share private|read|write` and `session delete ID` (design M13), each printing one JSON line; `session new` SHALL print `local.url` as `<server>/s/<id>`; `session share` SHALL act on the call's session. A missing or extra argument, or another share level, SHALL be a usage error. Origin: concept §7 (the CLI does what the UI does: the Sessions menu); D-083 (rights per session).

#### Scenario: Forms
- **WHEN** the argument lists `whoami`, `session list`, `session new`, `session share read`, `session delete abcdefghij`, `session share public`, `session delete` and `session new extra` are parsed
- **THEN** the first five map to `GET /api/me`, `GET /api/sessions`, `POST /api/sessions {}`, `POST /api/sessions/<call's session>/share {share: "read"}` and `DELETE /api/sessions/abcdefghij`; the last three are usage errors
- **Evidence:** `apps/cli/test/args.test.ts` › "maps the session forms"

#### Scenario: Over HTTP
- **WHEN** against the test server `session new`, `session list`, `session share write` (with `--session` of the new one), `session delete <new id>` and `session list` run
- **THEN** `session new` exits 0 with `data.session.id` and `local.url` ending `/s/<id>`; the list holds it first; the share answer shows `share` `write`; the delete answers `{deleted: <id>}`; the last list no longer holds it
- **Evidence:** `apps/cli/test/cli.test.ts` › "manages sessions"

#### Scenario: Help lists the forms
- **WHEN** `kipscope --help` runs
- **THEN** the text names `whoami`, `session list`, `session new`, `session share` and `session delete`
- **Evidence:** `apps/cli/test/cli.test.ts` › "prints the usage with --help" (form list extended)

### Requirement: The CLI sees only what the user may see
Every CLI call SHALL get exactly the answers the server gives its user (data-access): a data ref the user may not see SHALL fail with exit 1 and `error.code` `forbidden_data`, and searches SHALL list only visible signals. Origin: D-084 („in every query, list, view and CLI call"); concept §7 (the CLI uses the regular interface).

#### Scenario: Keeps a role to its data
- **WHEN** the test server runs `oidc` with rules giving role `testers` the pattern `test*`, and with alice's token `kipscope search Fast`, `kipscope extent othercar/Fast_100h.SIG_A`, `kipscope value othercar/Fast_100h.SIG_A <t>`, `kipscope events list --ref othercar`, `kipscope signal add <w> othercar/Fast_100h.SIG_A` and `kipscope scope set othercar <from> <to>` run
- **THEN** the search lists only `test*` signals; the other five exit 1 with `error.code` `forbidden_data`, and the session's revision is unchanged
- **Evidence:** `apps/cli/test/cli.test.ts` › "keeps a role to its data"
