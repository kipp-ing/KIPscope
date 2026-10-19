## ADDED Requirements

### Requirement: Auth modes
`KIPSCOPE_AUTH` SHALL select `none` (default) or `header`; any other value SHALL stop the server with a message naming the variable and both values. `header` SHALL require a non-empty `KIPSCOPE_ORIGINS`, else the server stops naming that variable. In `none` mode every API request that passes the access guard SHALL be the user `local`, so local use stays as today. Origin: D-083 („Ein SSO hook mit ping oder authentik"); D-079 (access control at one place); keeping today's local use: necessary consequence (local development has no SSO). Design M1, M2.

#### Scenario: Configuration
- **WHEN** `loadConfig` runs without `KIPSCOPE_AUTH`, with `none`, with `header` and `KIPSCOPE_ORIGINS=https://kipscope.example.org`, with `header` alone, and with `oidc`
- **THEN** the mode is `none`, `none`, `header` (header `x-authentik-username`, trusted proxies `127.0.0.1` and `::1`, origins `["https://kipscope.example.org"]`); the fourth throws naming `KIPSCOPE_ORIGINS`; the fifth throws naming `KIPSCOPE_AUTH`, `none` and `header`
- **Evidence:** `apps/server/test/config.test.ts` › "reads the auth settings"

#### Scenario: Local user without SSO
- **WHEN** the test app runs in `none` mode and `GET /api/me` is sent without any identity header, and once with `X-authentik-username: mallory`
- **THEN** both answer 200 `{user: "local", auth: "none"}`
- **Evidence:** `apps/server/test/identity.http.test.ts` › "answers the local user without SSO"

### Requirement: Trusted identity header
In `header` mode the user of a request SHALL be the value of the header `KIPSCOPE_AUTH_HEADER` (default `X-authentik-username`) when the request's peer address lies in `KIPSCOPE_TRUSTED_PROXIES` (IPs or CIDRs, default `127.0.0.1,::1`, IPv4-mapped IPv6 peers as IPv4) and the value matches the user rule (design M7 `USER_ID`). Every other request to `/api/`, except `GET /api/license`, SHALL answer 401 `unauthenticated` before any route runs, the live channel's upgrade included. `X-Forwarded-For` SHALL never count as the peer. Origin: D-083 (SSO via the proxy, no own user store); Q-1 (a). Design M1.

#### Scenario: Header from trusted and untrusted peers
- **WHEN** the test app runs in header mode with trusted proxies `127.0.0.1,10.0.0.0/8`, and `GET /api/me` is injected with header `alice` from peer `127.0.0.1`, from `::ffff:127.0.0.1`, from `10.1.2.3`, from `192.168.1.5`, from `192.168.1.5` with `X-Forwarded-For: 127.0.0.1`, from `127.0.0.1` without the header, and from `127.0.0.1` with the value `../x`
- **THEN** the first three answer 200 `{user: "alice", auth: "header"}`; the other four answer 401 with `error.code` `unauthenticated`
- **Evidence:** `apps/server/test/identity.http.test.ts` › "takes the user from the trusted header only"

#### Scenario: Nothing runs unauthenticated
- **WHEN** in header mode, with no identity, `POST /api/commands` with a valid command, `GET /api/series` and the `/api/live` upgrade are sent, and `GET /api/license`
- **THEN** the first two answer 401 `unauthenticated`, the source receives no call, and alice's sessions keep their revisions; the WebSocket gets no message (handshake 401, or closed before any message); the license answers 200
- **Evidence:** `apps/server/test/identity.http.test.ts` › "refuses every API route without a user"

### Requirement: One identity hook
Every route SHALL learn its user from one function (design M1 `identify`); no other server file SHALL read the identity header or the `authorization` header. Origin: D-079 („eine zugriffsberechtigung im Server muss später auch einbaubar sein"): one place to change.

#### Scenario: One place
- **WHEN** `grep -rln "authorization\|authHeader\|KIPSCOPE_AUTH_HEADER" apps/server/src` runs
- **THEN** it prints only `apps/server/src/identity.ts` and `apps/server/src/config.ts`
- **Evidence:** the `grep` command

### Requirement: Personal tokens
In `header` mode a signed-in user SHALL be able to create up to 10 personal tokens with a label (1–60 characters), list them without their secret, and revoke them. A request with `Authorization: Bearer <token>` SHALL be that token's user from any peer, and the identity header SHALL then be ignored. An unknown or revoked token SHALL answer 401 `invalid_token`. The server SHALL store only a hash of each token, under the user's folder, and SHALL keep tokens across a restart. In `none` mode the token routes SHALL answer 409 `auth_disabled`. Origin: concept §7 („Eine KI verwendet diese reguläre Schnittstelle": full control without a browser) with D-083 (identity from the SSO); Q-2 (a). Numbers: design M3.

#### Scenario: Create, use, revoke
- **WHEN** in header mode alice (trusted header) posts `/api/tokens {label: "laptop"}`, reads `GET /api/tokens`, then `GET /api/me` is sent from peer `192.168.1.5` with `Authorization: Bearer <token>`, once more from `127.0.0.1` with that token and header `bob`, then alice deletes the token and the bearer request is repeated; and alice creates 10 more tokens
- **THEN** the create answers 200 with a `token` of 47 characters starting `kst_` and a `summary` `{id, label: "laptop", createdAt}`; the list shows that summary without the token; both bearer requests answer `user` `alice` and the list then shows `lastUsedAt`; after the delete the bearer request answers 401 `invalid_token`; the 10th of the further tokens is accepted and the 11th answers 409 `token_limit`
- **Evidence:** `apps/server/test/tokens.http.test.ts` › "creates, uses and revokes tokens"

#### Scenario: Only the hash is stored, kept across a restart
- **WHEN** alice creates a token, `grep -r <token> <stateDir>` runs, and a new app is built on the same state dir and gets a bearer request with that token
- **THEN** the grep finds nothing; `<stateDir>/users/alice/tokens.json` holds the token's sha256 hex; the new app answers `user` `alice`
- **Evidence:** `apps/server/test/tokens.http.test.ts` › "stores only the hash and keeps tokens across a restart"

#### Scenario: Bad label and none mode
- **WHEN** in header mode `POST /api/tokens` gets the labels `""`, 61 characters and `a\nb`; and in `none` mode `POST /api/tokens {label: "x"}` is sent
- **THEN** the three answer 400 `invalid_request`; the last answers 409 `auth_disabled`
- **Evidence:** `apps/server/test/tokens.http.test.ts` › "refuses bad labels and tokens without SSO"

### Requirement: CLI access in the UI
In `header` mode the overflow menu SHALL offer "CLI access…": a dialog that lists the user's tokens (label, created, last used, Revoke), creates one from a label, and after a create shows the token once with the lines `export KIPSCOPE_URL=<page origin>` and `export KIPSCOPE_TOKEN=<token>` and a Copy button. In `none` mode the item SHALL be absent. Origin: Q-2 (a) (tokens come from a signed-in browser); concept §7.

#### Scenario: Shell lines
- **WHEN** `cliAccessLines("https://kipscope.example.org", "kst_abc")` runs
- **THEN** it returns `export KIPSCOPE_URL=https://kipscope.example.org` and `export KIPSCOPE_TOKEN=kst_abc`, in that order
- **Evidence:** `apps/web/test/session.test.ts` › "builds the CLI access lines"

#### Scenario: Token from the dialog drives the CLI
- **WHEN** the server runs in header mode on loopback against carserver, the UI is opened through the Vite dev server with `KIPSCOPE_DEV_USER=alice`, a token is created in "CLI access…", and `KIPSCOPE_TOKEN=<token> kipscope whoami` runs; then the token is revoked and the call is repeated
- **THEN** the dialog shows the token once and the two export lines; the first call exits 0 with `data.user` `alice`; the second exits 1 with `error.code` `invalid_token`
- **Evidence:** UI check (screenshot of the dialog after the create, with the token blurred in the report; both CLI outputs)
