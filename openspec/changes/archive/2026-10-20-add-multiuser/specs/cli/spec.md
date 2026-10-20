## MODIFIED Requirements

### Requirement: CLI client of the open workspace
The CLI `kipscope` SHALL control a workspace only through the server's HTTP API, at `--server <url>`, else `KIPSCOPE_URL`, else `http://localhost:7310`.

The workspace SHALL be, in this order of precedence:
1. `--workspace <ID or workspace link>`
2. `KIPSCOPE_WORKSPACE`
3. the workspace of a workspace link given as `--server` (`/w/<id>`, or the legacy `/s/<id>`; its origin is then the server)
4. the user's most recently active workspace (workspaces "Default workspace")

The token SHALL be `--token <T>`, else `KIPSCOPE_TOKEN`, else the trimmed output of `KIPSCOPE_TOKEN_COMMAND` (run once per call, design M13). With a token, every request SHALL carry `Authorization: Bearer <T>`, and the token SHALL never be printed.

Every output of a call that served a workspace SHALL name it as `workspace`, so a call without `--workspace` shows which one it took. The CLI SHALL never read the data source directly. `--help` SHALL print the usage of every form and exit 0.

Origin: concept §7 (the CLI controls the open view; „Eine KI verwendet diese reguläre Schnittstelle"); D-005 (the server holds the CLI endpoint); D-011 (D8, commands via `POST /api/commands`); workspace and token: D-079 („The CLI then addresses a workspace on a remote server"), D-083, D-084 (CLI callers authenticated through the same adapter; a tool connected to Ping supplies the token); the name: D-086 Q1; the default kept: exploration „The CLI without `--workspace` still takes the most recently active workspace (scripts keep working) and prints which one it took".

#### Scenario: Server address
- **WHEN** `kipscope state` runs once with `--server http://127.0.0.1:<port>`, once with only `KIPSCOPE_URL=http://127.0.0.1:<port>`, and once with both set to different servers
- **THEN** the first two read the test server; the third reads the `--server` one
- **Evidence:** `apps/cli/test/cli.test.ts` › "chooses --server over KIPSCOPE_URL over localhost:7310"

#### Scenario: Usage
- **WHEN** `kipscope --help` runs
- **THEN** it prints a usage text naming every form of the requirements below, `--workspace` and `--token`, and no `session`, and exits 0 without contacting a server
- **Evidence:** `apps/cli/test/cli.test.ts` › "prints the usage with --help"

#### Scenario: Workspace and server from options
- **WHEN** these options are parsed:
  1. `--server https://k.example/w/abcdefghij`
  2. `--server https://k.example/s/abcdefghij`
  3. `--server https://k.example --workspace https://k.example/w/abcdefghij`
  4. `--workspace abcdefghij` with `KIPSCOPE_WORKSPACE=bbbbbbbbbb`
  5. only `KIPSCOPE_WORKSPACE=bbbbbbbbbb`
  6. `--workspace ABC`
  7. `--session abcdefghij`
- **THEN**
  - the first three give server `https://k.example` and workspace `abcdefghij`
  - the fourth gives workspace `abcdefghij`, the fifth `bbbbbbbbbb`
  - the last two are usage errors
- **Evidence:** `apps/cli/test/args.test.ts` › "reads the workspace and the token"

#### Scenario: Workspace named in the output
- **WHEN** against the test server (`none` mode) with two workspaces A (older) and B (latest), `kipscope state`, `kipscope --workspace A state` and `kipscope --workspace A window create --from 0 --to 10` run
- **THEN**
  - the first prints `workspace` B
  - the second prints `workspace` A with A's workspace
  - the third is accepted on A, and B's revision is unchanged
- **Evidence:** `apps/cli/test/cli.test.ts` › "addresses a workspace"

#### Scenario: Token against a server with `oidc`
- **WHEN** the test server runs `oidc` against a local JWKS server, a test token for `alice` with roles `[testers]` exists, and `kipscope whoami` runs without a token, with `--token <alice's token>`, with `KIPSCOPE_TOKEN=garbage`, with `KIPSCOPE_TOKEN_COMMAND` set to a script printing alice's token, and with `KIPSCOPE_TOKEN_COMMAND` set to `exit 3`
- **THEN** the first exits 1 with `error.code` `unauthenticated`; the second and fourth exit 0 with `data.user` `alice`, `data.identity` `oidc`, `data.roles` `[testers]` and `data.canShare` true; the third exits 1 with `invalid_token`; the fifth exits 2 with `error.code` `token_command_failed` and the server received no request; no output contains the token
- **Evidence:** `apps/cli/test/cli.test.ts` › "sends the token"

## ADDED Requirements

### Requirement: One workspace per call
All requests of one CLI call SHALL go to the same workspace: the given one, or, when none is given, the workspace named by the first answer's `X-KIPscope-Workspace` header, for every later request of that call. `--wait` and `wait` SHALL therefore wait for a UI connected to that workspace.

Origin: concept §7 („ob … die offene Oberfläche den Zustand dargestellt hat": the UI that shows the changed workspace); necessary consequence of the default workspace (it may change between two requests).

#### Scenario: Wait sees only its workspace
- **WHEN** a fake browser is connected only to workspace A, workspace B is the default, and `kipscope --wait diff on` runs, then `kipscope --workspace A --wait diff on`
- **THEN** the first exits 6 with `render.status` `no_ui` and `workspace` B; the second exits 0 with `render.status` `complete` and `workspace` A
- **Evidence:** `apps/cli/test/cli.test.ts` › "waits for a UI of the same workspace"

### Requirement: Workspace commands
The CLI SHALL offer `whoami`, `workspace list`, `workspace new`, `workspace share private|read|write` and `workspace delete ID` (design M13), each printing one JSON line. `workspace new` SHALL print `local.url` as `<server>/w/<id>`. `workspace share` SHALL act on the call's workspace. A missing or extra argument, or another share level, SHALL be a usage error. The `session` forms SHALL be unknown commands.

Origin: concept §7 (the CLI does what the UI does: Share…, Recent, plus delete); D-083 (rights per workspace); D-086 Q1 (name).

#### Scenario: Forms
- **WHEN** the argument lists `whoami`, `workspace list`, `workspace new`, `workspace share read`, `workspace delete abcdefghij`, `workspace share public`, `workspace delete`, `workspace new extra` and `session list` are parsed
- **THEN**
  - the first five map to `GET /api/me`, `GET /api/workspaces`, `POST /api/workspaces {}`, `POST /api/workspaces/<call's workspace>/share {share: "read"}` and `DELETE /api/workspaces/abcdefghij`
  - the last four are usage errors
- **Evidence:** `apps/cli/test/args.test.ts` › "maps the workspace forms"

#### Scenario: Over HTTP
- **WHEN** against the test server, these run in order: `workspace new`, `workspace list`, `workspace share write` (with `--workspace` of the new one), `workspace delete <new id>` and `workspace list`
- **THEN**
  - `workspace new` exits 0 with `data.workspace.id` and `local.url` ending `/w/<id>`
  - the list holds it first
  - the share answer shows `share` `write`
  - the delete answers `{deleted: <id>}`
  - the last list no longer holds it
- **Evidence:** `apps/cli/test/cli.test.ts` › "manages workspaces"

#### Scenario: Help lists the forms
- **WHEN** `kipscope --help` runs
- **THEN** the text names `whoami`, `workspace list`, `workspace new`, `workspace share` and `workspace delete`
- **Evidence:** `apps/cli/test/cli.test.ts` › "prints the usage with --help" (form list extended)

### Requirement: The CLI sees only what the workspace's grant covers
Every CLI call SHALL get exactly the answers the server gives for its workspace (data-access). A data ref outside the workspace's grant SHALL fail with exit 1 and `error.code` `forbidden_data`, and searches SHALL list only granted signals.

Origin: D-084 („in every query, list, view and CLI call"); D-085 (the grant comes from KI.ping); concept §7 (the CLI uses the regular interface).

#### Scenario: Keeps a workspace to its grant
- **WHEN** the test server runs `oidc`, alice's latest workspace has the grant `["testcar"]` (set by the test through `grantObjects`), and with alice's token `kipscope search Fast`, `kipscope extent othercar/Fast_100h.SIG_A`, `kipscope value othercar/Fast_100h.SIG_A <t>`, `kipscope events list --ref othercar`, `kipscope signal add <w> othercar/Fast_100h.SIG_A` and `kipscope scope set othercar <from> <to>` run
- **THEN** the search lists only `testcar` signals; the other five exit 1 with `error.code` `forbidden_data`, and the workspace's revision is unchanged
- **Evidence:** `apps/cli/test/cli.test.ts` › "keeps a workspace to its grant"
