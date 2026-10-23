# user-identity Specification

## Purpose
Who a request comes from: a pluggable identity adapter (`none`, `oidc` for any OIDC provider, or an own module) that turns a browser or CLI request into a user with roles.

## Requirements

### Requirement: Identity adapter
The server SHALL learn the user of a request only from one identity adapter, selected by `KIPSCOPE_IDENTITY`: `none` (default), `oidc`, or `module:<path>`. An adapter SHALL implement the contract of design M1: `identify(request)` returns `{user, roles}` or a refusal (`unauthenticated` without a credential, `invalid_token` for a bad one). Any other value of the variable, a module that cannot be loaded, or one whose default export does not return an object with `kind` and `identify`, SHALL stop the server with a message naming the variable and the reason. Origin: D-084 („Identity is a pluggable adapter like the data source"; „da darf jeder auch seinen eigenen krams einbauen"). Design M1, M2.

#### Scenario: Selection
- **WHEN** `loadConfig` runs:
  1. without `KIPSCOPE_IDENTITY`
  2. with `oidc` plus issuer, audience and `KIPSCOPE_ORIGINS`
  3. with `module:apps/server/examples/forward-header.mjs` plus origins
  4. with `oidc` without `KIPSCOPE_OIDC_AUDIENCE`
  5. with `oidc` and `KIPSCOPE_OIDC_ALGS=HS256`
  6. with `module:x` but no `KIPSCOPE_ORIGINS`
  7. with `ping`
- **THEN**
  - the kinds are `none`, `oidc` (user claim `sub`, roles claim `roles`, header `authorization`, algorithms `RS256,PS256,ES256`) and `module` with that path
  - the last four throw naming, in order, `KIPSCOPE_OIDC_AUDIENCE`, `KIPSCOPE_OIDC_ALGS`, `KIPSCOPE_ORIGINS`, and `KIPSCOPE_IDENTITY` with its three forms
  - no case reads `KIPSCOPE_RULES`: setting it to a missing path changes none of the results
- **Evidence:** `apps/server/test/config.test.ts` › "reads the identity settings"

#### Scenario: Bad module
- **WHEN** the app is built with `module:` paths of a missing file, a module whose default export is `42`, and one whose factory returns `{kind: "x"}` without `identify`
- **THEN** each build rejects with a message naming `KIPSCOPE_IDENTITY` and, in order, the missing file, `default export`, and `identify`
- **Evidence:** `apps/server/test/identity.test.ts` › "refuses a bad identity module"

#### Scenario: One place
- **WHEN** `grep -rln "authorization\|x-forwarded-user\|identify(" apps/server/src` runs
- **THEN** it prints no file other than `apps/server/src/identity.ts`, `apps/server/src/identity/oidc.ts`, `apps/server/src/guard.ts` and `apps/server/src/config.ts`
- **Evidence:** the `grep` command

### Requirement: Local use without login
With `KIPSCOPE_IDENTITY=none`, every API request that passes the access guard SHALL be the user `local`, whatever headers it carries. Every workspace SHALL be able to read all data (data-access "Grant per workspace"), and the user may share.

Origin: D-084 („bei mir lokal ohne login, bin mein eigener herr"). Design M1, M3.

#### Scenario: Local user
- **WHEN** the test app runs in `none` mode and `GET /api/me` is sent without any header, and once with `Authorization: Bearer x` and `X-Forwarded-User: mallory`
- **THEN** both answer 200 `{user: "local", identity: "none", roles: [], canShare: true}`
- **Evidence:** `apps/server/test/identity.http.test.ts` › "answers the local user without login"

### Requirement: Every API request has a user
With an adapter other than `none`, every request to `/api/` except `GET /api/license` SHALL be identified before any route runs, the live channel's upgrade included: a refusal SHALL answer 401 with its code (`unauthenticated` or `invalid_token`), an adapter that throws SHALL answer 503 `identity_unavailable` without its error text, and a result whose user does not match `USER_ID` or whose roles are not at most 200 strings of 1–128 characters SHALL answer 401 `unauthenticated`. Origin: D-084 („sicher genug sein"); D-079 (access control at one place). Design M1, M6.

#### Scenario: Nothing runs unauthenticated
- **WHEN** with a test adapter that refuses every request, `POST /api/commands` with a valid command, `GET /api/series` and the `/api/live` upgrade are sent, and `GET /api/license`
- **THEN** the first two answer 401 `unauthenticated`, the source receives no call and no workspace's revision changes; the WebSocket gets no message (handshake 401, or closed before any message); the license answers 200
- **Evidence:** `apps/server/test/identity.http.test.ts` › "refuses every API route without a user"

#### Scenario: Adapter failures
- **WHEN** test adapters that throw `Error("jwks down: secret-detail")`, return user `../x`, and return 201 roles each answer `GET /api/me`
- **THEN** the first answers 503 `identity_unavailable` and the body does not contain `secret-detail`; the other two answer 401 `unauthenticated`; each logged one warning
- **Evidence:** `apps/server/test/identity.http.test.ts` › "fails closed on a bad adapter"

### Requirement: Who am I
`GET /api/me` SHALL answer the user, the identity kind, the roles and whether the user may share (design M7 `Me`). Roles SHALL be shown only: they decide nothing in KIPscope.

Origin: necessary consequence of D-084 (a user and an administrator must see as whom and with which roles a request acts); D-085 (rights are the search tool's, so roles grant nothing here); share switch: data-access "Sharing never widens data access".

#### Scenario: Roles and sharing
- **WHEN** with the test identity adapter, users with roles `[testers, viewers]` and `[]` send `GET /api/me`, first with `KIPSCOPE_SHARE` unset, then with `off`
- **THEN**
  - the answers have their user, `identity` of the test adapter, and their roles
  - `canShare` is true with `KIPSCOPE_SHARE` unset and false with `off`
  - no answer has a `rights` field
- **Evidence:** `apps/server/test/identity.http.test.ts` › "reports roles and the share switch"

### Requirement: OIDC access tokens
The `oidc` adapter SHALL accept a request only with a JWT in `KIPSCOPE_OIDC_HEADER` (default `Authorization: Bearer`) that is signed by a key of the issuer's JWKS with an algorithm of `KIPSCOPE_OIDC_ALGS` (never `none` or `HS*`), whose `iss` equals the issuer, whose `aud` contains the audience, whose `exp` is in the future and `nbf` (if present) in the past within 30 s, and whose user claim matches `USER_ID`; it SHALL take the roles from the roles claim (array, or a space- or comma-separated string; missing: none). An unknown key ID SHALL refetch the JWKS at most once per 30 s. The token SHALL never be logged or echoed. Origin: D-084 („[identity provider] sollte möglich sein mit unterschiedlichen rechten"); design M15 (PingFederate and PingOne issue such tokens). Numbers: design "Numbers".

#### Scenario: Token checks
- **WHEN** the test app runs `oidc` against a local JWKS server and `GET /api/me` is sent with: a valid RS256 token for `alice` with `roles: ["testers"]`; the same with `roles: "testers viewers"`; no header; `Bearer` + garbage; a token signed by another key; `alg: none`; HS256 signed with the JWKS public key as secret; a wrong `iss`; a wrong `aud`; `exp` 31 s ago; `exp` 29 s ago; `nbf` in 60 s; and user `../x`
- **THEN** the first two answer 200 for `alice` with roles `[testers]` and `[testers, viewers]`; no header answers 401 `unauthenticated`; `exp` 29 s ago answers 200; every other answers 401 `invalid_token`; no log line contains a token
- **Evidence:** `apps/server/test/identity/oidc.test.ts` › "validates Ping-style access tokens"

#### Scenario: Key rotation
- **WHEN** the JWKS server rotates to a new key, a token with the new `kid` arrives, then 20 tokens with random unknown `kid`s within 10 s
- **THEN** the first is accepted after one JWKS fetch; the 20 cause no further fetch and are refused `invalid_token`
- **Evidence:** `apps/server/test/identity/oidc.test.ts` › "refetches the key set on rotation, rate-limited"

#### Scenario: Roles claim path
- **WHEN** `KIPSCOPE_OIDC_ROLES_CLAIM=realm_access.roles` and `KIPSCOPE_OIDC_USER_CLAIM=preferred_username`, and a token holds `{preferred_username: "bob", realm_access: {roles: ["viewers"]}}`
- **THEN** `GET /api/me` answers user `bob` with roles `[viewers]`
- **Evidence:** `apps/server/test/identity/oidc.test.ts` › "reads user and roles from configured claims"

#### Scenario: Against a real OIDC provider
- **WHEN** a KIPscope server runs `oidc` against a real OIDC provider (e.g. PingFederate, PingOne, Entra ID, Keycloak) and `KIPSCOPE_TOKEN_COMMAND=<company tool> kipscope whoami` runs
- **THEN** it exits 0 with the user and roles the IdP issued
- **Evidence:** Jan's deployment check with `docs/deploy.md` (not run in rounds)

### Requirement: One conformance suite for identity adapters
The repo SHALL hold one identity conformance suite (design M1) that any adapter passes: the signed-in request yields exactly its user and roles; a request without credential is refused `unauthenticated`; forged ones are refused; 1,000 random header sets never yield a user and never throw; the request object stays unchanged. It SHALL run against `oidc` and the example module. Origin: D-084 („like the data source"; „muss halt anpassbar sein"); data-source "One conformance suite".

#### Scenario: Suite against both adapters
- **WHEN** `pnpm --filter @kipscope/server test` runs
- **THEN** `apps/server/test/identity/oidc.conformance.test.ts` and `forward-header.conformance.test.ts` pass every case of the suite
- **Evidence:** the command's output

#### Scenario: Example forward-header module
- **WHEN** the example module runs with trusted proxies `127.0.0.1,10.0.0.0/8` and requests carry `X-Forwarded-User: alice` and `X-Forwarded-Groups: testers, viewers` from peers `127.0.0.1`, `::ffff:127.0.0.1`, `10.1.2.3`, `192.168.1.5`, and `192.168.1.5` with `X-Forwarded-For: 127.0.0.1`
- **THEN** the first three give `alice` with roles `[testers, viewers]`; the last two are refused `unauthenticated`
- **Evidence:** `apps/server/test/identity/forward-header.conformance.test.ts` › "trusts the headers from proxies only"
