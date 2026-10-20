# server-access Specification

## Purpose
Who may talk to the KIPscope server: the HTTP API and the live channel answer only requests addressed to the local machine and coming from local pages or from clients without a browser origin, so a foreign web page can neither read signals nor steer the open workspace.

## Requirements

### Requirement: Local Host header only
The server SHALL answer a request (HTTP or the live channel's upgrade) only when its `Host` names `localhost`, `127.0.0.1` or `[::1]`, the configured `KIPSCOPE_HOST` when that is not a loopback or wildcard address, or the host of an entry of `KIPSCOPE_ORIGINS`, each with any port or none, case-insensitive. Any other `Host`, or none, SHALL get 403 with code `forbidden_host`. Origin: necessary consequence of D-005 (the server holds the workspace and the source access); a DNS-rebinding page reaches 127.0.0.1 under a foreign `Host`. Configured origins: D-079 (KIPscope runs on a server behind its public name). Design H3; add-multiuser M10.

#### Scenario: Loopback names pass
- **WHEN** `GET /api/workspace` is sent with `Host` `localhost:7310`, `127.0.0.1:7310`, `[::1]:7310`, `LOCALHOST` and `localhost:5173`
- **THEN** every answer is 200
- **Evidence:** `apps/server/test/access.http.test.ts` › "accepts loopback Host headers with any port"

#### Scenario: Foreign host refused
- **WHEN** `GET /api/catalog` is sent with `Host` `evil.example:7310`, and `GET /api/live` is opened as a WebSocket with `Host` `evil.example`
- **THEN** the HTTP answer is 403 with `error.code` `forbidden_host`, and the WebSocket gets no message: its handshake fails with 403, or it is closed with code 1008 before any message
- **Evidence:** `apps/server/test/access.http.test.ts` › "refuses a foreign Host on HTTP and on the live channel"

#### Scenario: Configured LAN host
- **WHEN** the app is built with `KIPSCOPE_HOST` `192.168.42.10` and a request carries `Host` `192.168.42.10:7310`, and another `Host` `192.168.42.11:7310`
- **THEN** the first answers 200 and the second 403 `forbidden_host`
- **Evidence:** `apps/server/test/access.http.test.ts` › "accepts the configured non-loopback host"

#### Scenario: Host of a configured origin
- **WHEN** the app is built with origins `["https://kipscope.example.org"]` and requests carry `Host` `kipscope.example.org`, `KIPSCOPE.example.org:443` and `other.example.org`
- **THEN** the first two answer 200 and the third 403 `forbidden_host`
- **Evidence:** `apps/server/test/access.http.test.ts` › "accepts the host of a configured origin"

### Requirement: Local or no Origin only
A request with an `Origin` SHALL be answered only when the origin is `http` or `https` with a loopback host or the `KIPSCOPE_HOST` name, any port, or when it equals an entry of `KIPSCOPE_ORIGINS` in scheme, host and port (default ports normalised); any other, `null` included, SHALL get 403 `forbidden_origin`, on HTTP and the live upgrade. A request without `Origin` (CLI, curl) SHALL pass. Each `KIPSCOPE_ORIGINS` entry SHALL be an `http` or `https` origin without path, else the server stops naming the variable and the entry. Origin: necessary consequence of D-005; browsers apply no CORS to WebSockets, so any page could send fake render acknowledgements; behind an SSO proxy a foreign page would act with the user's proxy cookie (required unless `none`, design M10). Configured origins: D-079. Design H3; add-multiuser M10.

#### Scenario: Foreign page refused
- **WHEN** `POST /api/commands` with a valid command, `POST /api/catalog/refresh` and the live channel's upgrade are sent with `Origin` `https://evil.example`, and a GET with `Origin` `null`
- **THEN** each HTTP request answers 403 with code `forbidden_origin`, the WebSocket gets no message (handshake 403, or closed with 1008 before any message), and the workspace revision is unchanged
- **Evidence:** `apps/server/test/access.http.test.ts` › "refuses foreign origins on HTTP and on the live channel"

#### Scenario: Dev UI and CLI pass
- **WHEN** a command is posted with `Origin` `http://localhost:5173`, another with `Origin` `http://127.0.0.1:5173`, and another without `Origin`
- **THEN** all three are accepted and the revision rises by three
- **Evidence:** `apps/server/test/access.http.test.ts` › "accepts local origins and requests without origin"

#### Scenario: Configured origin exactly
- **WHEN** the app is built with origins `["https://kipscope.example.org"]` and commands are posted with `Origin` `https://kipscope.example.org`, `https://kipscope.example.org:443`, `http://kipscope.example.org` and `https://kipscope.example.org:8443`
- **THEN** the first two are accepted; the last two answer 403 `forbidden_origin`
- **Evidence:** `apps/server/test/access.http.test.ts` › "accepts a configured origin only exactly"

#### Scenario: Origins configuration
- **WHEN** `loadConfig` runs with `KIPSCOPE_ORIGINS` `https://a.example, http://b.example:8080`, with `https://a.example/app`, and with `ftp://a.example`
- **THEN** the first gives `["https://a.example", "http://b.example:8080"]`; the other two throw naming `KIPSCOPE_ORIGINS` and the entry
- **Evidence:** `apps/server/test/config.test.ts` › "reads the auth settings"

#### Scenario: Through the dev proxy on real data
- **WHEN** the UI is opened at `http://localhost:5173` with the dev server proxying to the KIPscope server
- **THEN** the explorer lists signals, a window draws data, and the header shows the live connection as connected
- **Evidence:** UI check (one screenshot)

### Requirement: JSON bodies only
The server SHALL accept request bodies only as `application/json`; a body of any other type, `text/plain` included, SHALL be refused with 415 and change nothing. A POST without a body SHALL stay accepted. Origin: necessary consequence of D-005: a `text/plain` POST is a CORS simple request a browser sends cross-site without preflight. Design H3.

#### Scenario: text/plain command refused
- **WHEN** `POST /api/commands` is sent with `content-type: text/plain` and a valid command as body
- **THEN** the answer is 415 and the revision is unchanged
- **Evidence:** `apps/server/test/access.http.test.ts` › "refuses non-JSON bodies with 415"

#### Scenario: Refresh without body
- **WHEN** `POST /api/catalog/refresh` is sent without body and without `content-type`
- **THEN** the answer is 200 with the catalog size
- **Evidence:** `apps/server/test/signals.http.test.ts` (existing refresh test, stays green)

### Requirement: Bounded live frames
The live channel SHALL close a connection that sends a single message larger than 256 KiB, without applying it. Origin: necessary consequence: a client must not make the server buffer unbounded input. Number: design H4.

#### Scenario: Oversized frame
- **WHEN** a live client sends a 300 KiB text frame
- **THEN** the server closes the connection with code 1009 and `GET /api/render-status` no longer lists that client
- **Evidence:** `apps/server/test/access.http.test.ts` › "closes a live connection on a frame over 256 KiB"

### Requirement: Warning on a network-facing host
When `KIPSCOPE_HOST` is not a loopback address, the server SHALL log a warning at start: in `none` mode it names the host and says that every machine that reaches it can read signals and change the workspace; with any other identity it says that only the proxy should reach the host and port. With an identity other than `none`, the server SHALL also log one info line naming:
- the identity: `oidc` with issuer and audience, or the module path
- `sharing on` or `sharing off`
- the origins

Origin: necessary consequence of D-005 (no authentication in `none` mode) and of D-084 (the identity adapter decides who signs in; an operator must see which applies); the share switch: data-access "Sharing never widens data access".

#### Scenario: Loopback test
- **WHEN** `isLoopbackHost` is given `127.0.0.1`, `localhost`, `::1`, `0.0.0.0`, `::` and `192.168.42.10`
- **THEN** it returns true, true, true, false, false, false
- **Evidence:** `apps/server/test/access.http.test.ts` › "tells loopback hosts from network-facing ones"; command `grep -n "accessLog" apps/server/src/main.ts` prints the call that logs the lines

#### Scenario: Start lines per mode
- **WHEN** `accessLog` gets:
  1. `none` on `127.0.0.1`
  2. `none` on `0.0.0.0`
  3. `oidc` on `0.0.0.0` with issuer `https://idp.example.org`, audience `kipscope`, share off and origin `https://kipscope.example.org`
- **THEN**
  - the first returns nothing
  - the second returns one warning containing `every machine that reaches it`
  - the third returns one info line containing `oidc`, `https://idp.example.org`, `kipscope`, `sharing off` and `https://kipscope.example.org`, and no `rules`; plus one warning containing `only the proxy`
- **Evidence:** `apps/server/test/access.http.test.ts` › "logs the access settings per mode"

### Requirement: Built UI served by the server
With `KIPSCOPE_WEB_DIR` set, the server SHALL answer a `GET` of a path outside `/api/` with the file of that path below the directory, or with its `index.html` when there is no such file, with the content type of design M11. A path that resolves outside the directory SHALL answer 404. These answers SHALL need no user. Without the variable such paths SHALL answer 404 as today. Origin: D-079 („lokal ist immer nur der browser": the server delivers the UI). Design M11.

#### Scenario: Files, app routes and traversal
- **WHEN** the app is built with a temp web dir holding `index.html` and `assets/app.js`, with a test identity adapter that refuses every request, and `GET /assets/app.js`, `GET /w/abcdefghij`, `GET /s/abcdefghij`, `GET /`, `GET /..%2f..%2fetc%2fpasswd` and `GET /api/me` are sent; and once without a web dir `GET /`
- **THEN** the first answers 200 `text/javascript` with the file and an `immutable` cache header; the next three answer `index.html` as `text/html` with `no-cache`; the traversal answers 404; `/api/me` answers 401 `unauthenticated`; without a web dir `/` answers 404
- **Evidence:** `apps/server/test/web.http.test.ts` › "serves the built UI"
