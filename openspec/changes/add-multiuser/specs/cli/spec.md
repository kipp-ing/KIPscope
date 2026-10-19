## MODIFIED Requirements

### Requirement: CLI client of the open workspace
The CLI `kipscope` SHALL control a session's workspace only through the server's HTTP API, at `--server <url>`, else `KIPSCOPE_URL`, else `http://localhost:7310`. The session SHALL be `--session <ID or session link>`, else `KIPSCOPE_SESSION`, else the session of a session link given as `--server` (its origin is then the server), else the user's default session (sessions "Default session"). With `--token <T>`, else `KIPSCOPE_TOKEN`, every request SHALL carry `Authorization: Bearer <T>`. Every output of a call that served a session SHALL name it as `session`. The CLI SHALL never read the data source directly. `--help` SHALL print the usage of every form and exit 0. Origin: concept §7 (the CLI controls the open view; „Eine KI verwendet diese reguläre Schnittstelle"); D-005 (the server holds the CLI endpoint); D-011 (D8, commands via `POST /api/commands`); session and token: D-079 („The CLI then addresses a workspace on a remote server"), D-083, Q-2 (a).

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

#### Scenario: Token against a server in header mode
- **WHEN** the test server runs in header mode with alice's token, and `kipscope whoami` runs without a token, with `--token <alice's token>`, and with `KIPSCOPE_TOKEN=kst_wrong`
- **THEN** the first exits 1 with `error.code` `unauthenticated`; the second exits 0 with `data` `{user: "alice", auth: "header"}`; the third exits 1 with `invalid_token`
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
