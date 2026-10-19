# Deploy KIPscope on a server

Locally KIPscope needs no login: `KIPSCOPE_IDENTITY=none` (the default) makes every request the user `local` with every right, as on Jan's machine (D-084). This guide is for a shared server: several users, each seeing only the data their roles allow, behind a TLS proxy. Specs: [user-identity](../openspec/specs/user-identity/spec.md), [data-access](../openspec/specs/data-access/spec.md), [sessions](../openspec/specs/sessions/spec.md), [server-access](../openspec/specs/server-access/spec.md); routes: [http-api.md](http-api.md); data sources: [data-sources.md](data-sources.md).

## The picture

```
browser ──https──▶ TLS proxy (sign-in) ──http──▶ KIPscope server :7310 ──▶ ClickHouse / ADX
CLI, AI ──https + Bearer token ──▶ (same proxy, or a route that passes bearer tokens)
```

- The **identity adapter** turns each request into a user and roles, or refuses it (401). It runs once per request in the server's guard, for every `/api/` route but `GET /api/license`, the live channel's upgrade included.
- The **rules file** maps roles to rights: which data refs a role may see (glob patterns) and whether it may share sessions. A user whose roles match no rule has no rights (deny by default): every route but `/api/me` and `/api/license` answers 403 `no_rights`.
- The **guard** decides every access in one place, before a route runs. A data ref the user may not see answers 403 `forbidden_data`, decided from the patterns alone, before any lookup or source query: a hidden data ref that exists and one that does not answer the same. Lists and counts (catalog, search totals, footer, session list) never include hidden data refs.
- **Sessions:** each case is a session with its own address `/s/<id>`, owner and share level (`private`, `read`, `write`). Sharing never widens data access: a session that holds a data ref the viewer may not see is refused as a whole (403 `forbidden`).
- The **database access** stays the server's own (D-083): KIPscope queries the source with one account, and the data limits above are KIPscope's, never the source's.

## Build and start

```sh
pnpm install
pnpm build                                  # the UI lands in apps/web/dist
pnpm --filter @kipscope/server start        # reads .env at the repo root
```

The server serves the built UI when `KIPSCOPE_WEB_DIR` names its directory (absolute, or relative to the repo root): a `GET` outside `/api/` answers the file, or `index.html` for app paths such as `/s/<id>`. These files hold no data and need no identity; the proxy guards the page. `index.html` is sent with `cache-control: no-cache`, files under `assets/` as immutable. Without the variable the server serves no files (the local setup, where Vite serves the UI).

A minimal `.env` for a server with Ping (sections below):

```sh
KIPSCOPE_HOST=127.0.0.1                     # only the proxy on this machine reaches the port
KIPSCOPE_PORT=7310
KIPSCOPE_IDENTITY=oidc
KIPSCOPE_OIDC_ISSUER=https://auth.pingone.eu/<envId>/as
KIPSCOPE_OIDC_AUDIENCE=https://kipscope.example.com
KIPSCOPE_OIDC_ROLES_CLAIM=groups
KIPSCOPE_RULES=/etc/kipscope/rules.yaml
KIPSCOPE_ORIGINS=https://kipscope.example.com
KIPSCOPE_WEB_DIR=/opt/kipscope/apps/web/dist
KIPSCOPE_STATE_DIR=/var/lib/kipscope
```

At start the server logs one line naming the identity (`oidc` with issuer and audience, or the module path), the rules file with its role count and the origins; with a non-loopback `KIPSCOPE_HOST` it also warns that only the proxy should reach that host and port.

## Variables

| Variable | Default | Rule |
|---|---|---|
| `KIPSCOPE_IDENTITY` | `none` | `none`, `oidc` or `module:<path>`. Any other value stops the server. |
| `KIPSCOPE_RULES` | unset | Path of the rules file (absolute, or relative to the repo root). Required unless `none`; missing or invalid stops the server naming the file and the bad entry. With `none` it is ignored. |
| `KIPSCOPE_OIDC_ISSUER` | — | Required with `oidc`. An `https` URL (`http` only for a loopback host, for tests). Compared exactly with the token's `iss`. |
| `KIPSCOPE_OIDC_AUDIENCE` | — | Required with `oidc`. The token's `aud` (string or array) must contain it. |
| `KIPSCOPE_OIDC_JWKS_URL` | discovered | Else `jwks_uri` of `<issuer>/.well-known/openid-configuration`. Until the keys load, requests answer 503 `identity_unavailable`; retried at most every 30 s. |
| `KIPSCOPE_OIDC_USER_CLAIM` | `sub` | The claim holding the user ID: letters, digits, `.`, `_`, `@`, `-`, at most 64 characters. |
| `KIPSCOPE_OIDC_ROLES_CLAIM` | `roles` | A claim name or dotted path (`realm_access.roles`): an array of strings, or one space- or comma-separated string. Missing: no roles. |
| `KIPSCOPE_OIDC_HEADER` | `authorization` | The header holding the token: for `authorization` the value is `Bearer <jwt>`, for any other header the bare JWT. |
| `KIPSCOPE_OIDC_ALGS` | `RS256,PS256,ES256` | Allowed signature algorithms, a subset of `RS256 RS384 RS512 PS256 PS384 PS512 ES256 ES384 ES512 EdDSA`; `none` and `HS*` are refused at start. |
| `KIPSCOPE_ORIGINS` | empty | Comma list of the public origins `https://host[:port]`, no path. Required unless `none`. Their hosts pass the Host check; a browser request's `Origin` must be exactly one of them. |
| `KIPSCOPE_SESSION_IDLE_DAYS` | `30` | Sessions untouched this long and without an open tab are deleted (at start and hourly). |
| `KIPSCOPE_WEB_DIR` | unset | The built UI (`apps/web/dist` after `pnpm build`). |
| `KIPSCOPE_TRUSTED_PROXIES` | `127.0.0.1,::1` | Read by the example module only: IPs and CIDRs whose forwarded headers it trusts. |

The source variables (`KIPSCOPE_SOURCE`, `CLICKHOUSE_URL`, `KIPSCOPE_ADX_*`, …) are in [data-sources.md](data-sources.md#all-variables).

## Ping Identity with `oidc`

KIPscope acts as an OIDC resource server: it validates a JWT access token on every request and takes the user and roles from its claims. The same check serves the browser (the proxy adds the token) and the CLI and AI callers (a bearer token from the company's tool). It works with PingFederate, PingOne and any other OIDC provider that publishes discovery and a JWKS.

What KIPscope checks, in this order (any failure refuses the request `invalid_token`; no token at all is `unauthenticated`): the token is at most 16 KB; its `alg` is one of `KIPSCOPE_OIDC_ALGS`; its `kid` is in the JWKS (an unknown `kid` refetches the JWKS at most once per 30 s, so key rotation works); the signature is valid; `iss` equals the issuer exactly; `aud` contains the audience; `exp` is in the future and `nbf`, if present, in the past (30 s tolerance); the user claim is a valid user ID. The token is never logged.

### Issuer

| IdP | `KIPSCOPE_OIDC_ISSUER` |
|---|---|
| PingFederate | `https://<pf-host>` (its base URL, with the port when it is not 443, e.g. `https://sso.example.com:9031`) |
| PingOne | `https://auth.pingone.<region>/<envId>/as` (`<region>` `eu`, `com`, `ca` or `asia`; `<envId>` the environment ID) |

Check it with `curl <issuer>/.well-known/openid-configuration`: the answer's `issuer` must equal the variable character for character, and `jwks_uri` is where KIPscope reads the keys.

### Access token, audience and claims

- **PingFederate:** the access token must be a JWT (an access token manager of the JSON Web Token type, signed with RS256, PS256 or ES256). Set its audience to the value of `KIPSCOPE_OIDC_AUDIENCE`, and fulfil a claim with the user's group or role names from the attribute contract.
- **PingOne:** define a custom resource for KIPscope; its audience is `KIPSCOPE_OIDC_AUDIENCE`, and an attribute mapping adds the roles claim (for example `groups`, the user's group names). PingOne's `sub` is the user's UUID; to show a readable name, map an attribute such as the username into a claim and name it in `KIPSCOPE_OIDC_USER_CLAIM`.
- **Roles claim:** `KIPSCOPE_OIDC_ROLES_CLAIM` names the claim the IdP fills (`groups`, `roles`, or a dotted path). Its values are matched case-sensitively against the `role` entries of the rules file. Which roles a user gets is the IdP's business (D-084); KIPscope enforces what the token says. `GET /api/me`, `kipscope whoami` and the footer's user tooltip show the user, roles and rights KIPscope derived, for checking.

### Browser: through an OIDC proxy

KIPscope has no login page of its own. A proxy in front signs the user in at Ping and passes the user's token to KIPscope on every request **and on the live channel's WebSocket upgrade** (`GET /api/live`, also `/api/s/<id>/live`); without the token there the live channel is refused 401.

- **oauth2-proxy** (OIDC provider = PingFederate or PingOne):
  - `--pass-access-token` sends the access token as `X-Forwarded-Access-Token`; set `KIPSCOPE_OIDC_HEADER=x-forwarded-access-token`. The audience is then that of the access token (the resource above).
  - or `--pass-authorization-header`, which sends `Authorization: Bearer <ID token>`; the audience is then the proxy's client ID, and the roles claim must be in the ID token.
  - oauth2-proxy forwards WebSocket upgrades with the same headers. `--skip-jwt-bearer-tokens` (with `--extra-jwt-issuers` when needed) lets requests that already carry a bearer token, such as the CLI's, pass without a cookie.
- **PingAccess:** forward the user's access token to the backend in a header (then `KIPSCOPE_OIDC_HEADER` names it), or use a JWT identity mapping, in which case PingAccess signs the token: set `KIPSCOPE_OIDC_ISSUER` (and `KIPSCOPE_OIDC_JWKS_URL` if PingAccess publishes no discovery) to PingAccess's issuer and keys. Enable WebSocket support on the application.

Set `KIPSCOPE_ORIGINS` to the address the browser shows (`https://kipscope.example.com`). The proxy's cookie goes along with every browser request, so the Origin check is what stops other sites from using it; this is why the variable is required.

### CLI and AI callers

The CLI sends `Authorization: Bearer <token>` on every request and never validates or stores tokens itself. It takes the token from `--token T`, else `KIPSCOPE_TOKEN`, else the output of `KIPSCOPE_TOKEN_COMMAND`: a shell command run once per call (10 s timeout) that prints a token, typically the company's Ping-connected tool (device flow for a person, client credentials for an AI service account):

```sh
alias kipscope="node apps/cli/src/main.ts"   # from the repo root
export KIPSCOPE_URL=https://kipscope.example.com
export KIPSCOPE_TOKEN_COMMAND="company-token --audience https://kipscope.example.com"
kipscope whoami                    # user, identity, roles, rights
kipscope session list
kipscope --session https://kipscope.example.com/s/abcdefghij state
```

A failing, slow or silent token command exits 2 with `token_command_failed` and sends nothing. The service account's roles in the token decide its data, as for a person.

## Your own adapter

When neither `oidc` nor the example fits (another IdP, an API gateway that signs its own headers, mTLS), write a module and load it with `KIPSCOPE_IDENTITY=module:<path>` (absolute, or relative to the server's working directory, which is `apps/server` under `pnpm --filter @kipscope/server start`; `.mjs`, `.js` or `.ts`).

The contract (`apps/server/src/identity.ts`, design M1): the module's default export is a factory `(options: {env, log}) => IdentityAdapter | Promise<IdentityAdapter>`, and the adapter is

```ts
interface IdentityAdapter {
  readonly kind: string;   // shown by GET /api/me and the start log
  identify(request: { headers; peer; method; path }): Promise<
    | { user: string; roles: readonly string[] }
    | { refused: "unauthenticated" | "invalid_token"; reason?: string }
  >;
  close?(): Promise<void>;
}
```

- `headers` are lower-case; `peer` is the TCP peer (never `X-Forwarded-For`); `path` is without query and session prefix.
- No credential: return `{refused: "unauthenticated"}`; a bad one: `{refused: "invalid_token"}`. Throw only when you cannot decide (your IdP is down); the request then answers 503 `identity_unavailable` and the error text stays in the server log.
- The server checks every result: `user` must be a valid user ID, `roles` at most 200 strings of 1–128 characters. Anything else is refused.
- A module that does not load, whose default export is not a function, or whose result lacks `kind` or `identify`, stops the server at start.

**Example:** [apps/server/examples/forward-header.mjs](../apps/server/examples/forward-header.mjs) (about 40 lines, no dependency) trusts `X-Forwarded-User` and `X-Forwarded-Groups` (comma list), but only from peers in `KIPSCOPE_TRUSTED_PROXIES`. It is the forward-auth alternative to `oidc`, and the adapter of the two-user checks during development:

```sh
KIPSCOPE_IDENTITY=module:examples/forward-header.mjs KIPSCOPE_RULES=/path/rules.yaml \
  KIPSCOPE_ORIGINS=http://localhost:5173,http://localhost:5174 pnpm --filter @kipscope/server dev
KIPSCOPE_DEV_USER=alice KIPSCOPE_DEV_ROLES=cars pnpm --filter @kipscope/web dev
KIPSCOPE_DEV_USER=bob KIPSCOPE_DEV_ROLES=cars pnpm --filter @kipscope/web dev --port 5174
```

(The Vite dev server adds the two headers from `KIPSCOPE_DEV_USER` and `KIPSCOPE_DEV_ROLES` to every `/api` request and the WebSocket.)

**Conformance suite:** `apps/server/test/identity/conformance.ts` exports `identityConformance(name, setup)`. `setup()` returns your adapter, a signed-in request with its expected user and roles, a request without credential, and forged requests. The suite checks that the signed-in request gives exactly that user and those roles, the missing one is refused `unauthenticated`, each forged one is refused, 1,000 random header sets never yield a user and never throw, and `identify` leaves the request unchanged. Copy `apps/server/test/identity/forward-header.conformance.test.ts` (or `oidc.conformance.test.ts`) to `apps/server/test/identity/<yours>.conformance.test.ts`, point it at your module, and run:

```sh
pnpm --filter @kipscope/server exec vitest run test/identity/<yours>.conformance.test.ts
```

## Rules

One YAML file, read once at start (a change needs a restart):

```yaml
kipscope: rules
version: 1
roles:
  - role: px-engineering      # a role exactly as the adapter returns it (case-sensitive)
    data: ["px-*", "demo"]    # data-ref patterns
    share: true               # may share sessions read or write; default false
  - role: kipscope-admin
    data: ["*"]
    share: true
```

- **Patterns** match the whole data ref, case-sensitively: `*` any run of characters (also none), `?` one character, everything else literal. `px-*` matches `px-01`, not `apx-01`.
- **Rights** of a user are the union over all entries whose `role` is one of the user's roles: every pattern of them, and `share` when any of them has `share: true`. No matching entry: no rights.
- **Limits:** at most 1,000 entries; each `role` 1–128 characters, at most once; `data` at most 200 patterns of 1–128 characters without `/`, whitespace or control characters; only the keys `role`, `data` and `share`. A bad file stops the server naming the entry's index and key.

Examples for common naming schemes of data refs:

```yaml
# One team, everything:
  - role: analysts
    data: ["*"]

# A prefix per platform or project (a large company):
  - role: platform-px
    data: ["px-*"]
  - role: platform-qz
    data: ["qz-*"]

# A few named vehicles (a small fleet):
  - role: fleet-small
    data: ["car-a", "car-b", "suv-1"]

# Numbered instances: fleet-00 … fleet-09, not fleet-10:
  - role: fleet-early
    data: ["fleet-0?"]

# Read along, no sharing (share defaults to false):
  - role: guests
    data: ["demo"]
```

The rules decide data refs only. Share levels decide who may open whose session (`private`: the owner; `read`: anyone with the link may look; `write`: anyone with the link may change it), and data rights are checked on top: a shared session that holds a data ref the viewer may not see stays closed to them.

## Trust boundary

- **Only the proxy reaches KIPscope's port.** Bind the server to loopback (`KIPSCOPE_HOST=127.0.0.1`, the default) with the proxy on the same machine, or to a private interface that only the proxy can reach (firewall). With `oidc` the trust rests on the IdP's signature, so a request that bypasses the proxy still needs a valid token; with the header example it rests on the network, so `KIPSCOPE_TRUSTED_PROXIES` must list exactly the proxy's addresses and the proxy must drop any `X-Forwarded-User` and `X-Forwarded-Groups` the client sent.
- **TLS ends at the proxy.** KIPscope speaks plain HTTP; never expose its port to users.
- **Origins:** `KIPSCOPE_ORIGINS` lists the public address(es); requests whose `Origin` is anything else get 403 `forbidden_origin`, cross-site WebSockets included.
- **State** (`KIPSCOPE_STATE_DIR`): sessions in `sessions/<id>.json`, saved views per user in `users/<user>/views/`. It holds workspaces and view documents, no credentials; back it up like any application data. A local state dir from before sessions is migrated at start to the user `local`.

## ADX on a server

The server queries ADX with its own identity through the Azure CLI (`KIPSCOPE_ADX_AUTH=azcli`, the default; [Connect your ADX](data-sources.md#connect-your-adx)). On a server, log the service account in once as the user that runs KIPscope:

```sh
# A service principal (an app registration with a secret or certificate):
az login --service-principal -u <app id> -p <secret or certificate path> --tenant <tenant id>
# Or the machine's managed identity (an Azure VM or container):
az login --identity
```

That identity needs the **Database Viewer** role on the database. Every user's data limits come from the rules above; ADX sees only the server's identity (D-083).
