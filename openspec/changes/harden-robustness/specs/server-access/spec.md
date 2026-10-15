## Purpose

Who may talk to the letsview server: the HTTP API and the live channel answer only requests addressed to the local machine and coming from local pages or from clients without a browser origin, so a foreign web page can neither read signals nor steer the open workspace.

## ADDED Requirements

### Requirement: Local Host header only
The server SHALL answer a request (HTTP or the live channel's upgrade) only when its `Host` names `localhost`, `127.0.0.1` or `[::1]` with any port or none, case-insensitive, or the configured `LETSVIEW_HOST` when that is not a loopback or wildcard address. Any other `Host`, or none, SHALL get 403 with code `forbidden_host`. Origin: necessary consequence of D-005 (the server holds the workspace and the source access); a DNS-rebinding page reaches 127.0.0.1 under a foreign `Host`. Design H3.

#### Scenario: Loopback names pass
- **WHEN** `GET /api/workspace` is sent with `Host` `localhost:7310`, `127.0.0.1:7310`, `[::1]:7310`, `LOCALHOST` and `localhost:5173`
- **THEN** every answer is 200
- **Evidence:** `apps/server/test/access.http.test.ts` › "accepts loopback Host headers with any port"

#### Scenario: Foreign host refused
- **WHEN** `GET /api/catalog` is sent with `Host` `evil.example:7310`, and `GET /api/live` is opened as a WebSocket with `Host` `evil.example`
- **THEN** the HTTP answer is 403 with `error.code` `forbidden_host`, and the WebSocket gets no message: its handshake fails with 403, or it is closed with code 1008 before any message
- **Evidence:** `apps/server/test/access.http.test.ts` › "refuses a foreign Host on HTTP and on the live channel"

#### Scenario: Configured LAN host
- **WHEN** the app is built with `LETSVIEW_HOST` `192.168.42.10` and a request carries `Host` `192.168.42.10:7310`, and another `Host` `192.168.42.11:7310`
- **THEN** the first answers 200 and the second 403 `forbidden_host`
- **Evidence:** `apps/server/test/access.http.test.ts` › "accepts the configured non-loopback host"

### Requirement: Local or no Origin only
A request with an `Origin` SHALL be answered only when the origin is `http` or `https` with a host the Host rule accepts, any port; any other, `null` included, SHALL get 403 `forbidden_origin`, on HTTP and the live upgrade. A request without `Origin` (CLI, curl) SHALL pass. Origin: necessary consequence of D-005; browsers apply no CORS to WebSockets, so any page could send fake render acknowledgements. Design H3.

#### Scenario: Foreign page refused
- **WHEN** `POST /api/commands` with a valid command, `POST /api/catalog/refresh` and the live channel's upgrade are sent with `Origin` `https://evil.example`, and a GET with `Origin` `null`
- **THEN** each HTTP request answers 403 with code `forbidden_origin`, the WebSocket gets no message (handshake 403, or closed with 1008 before any message), and the workspace revision is unchanged
- **Evidence:** `apps/server/test/access.http.test.ts` › "refuses foreign origins on HTTP and on the live channel"

#### Scenario: Dev UI and CLI pass
- **WHEN** a command is posted with `Origin` `http://localhost:5173`, another with `Origin` `http://127.0.0.1:5173`, and another without `Origin`
- **THEN** all three are accepted and the revision rises by three
- **Evidence:** `apps/server/test/access.http.test.ts` › "accepts local origins and requests without origin"

#### Scenario: Through the dev proxy on real data
- **WHEN** the UI is opened at `http://localhost:5173` with the dev server proxying to the letsview server
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
When `LETSVIEW_HOST` is not a loopback address, the server SHALL log a warning at start that names the host and says that every machine that reaches it can read signals and change the workspace. Origin: necessary consequence of D-005 (no authentication). Design H3.

#### Scenario: Loopback test
- **WHEN** `isLoopbackHost` is given `127.0.0.1`, `localhost`, `::1`, `0.0.0.0`, `::` and `192.168.42.10`
- **THEN** it returns true, true, true, false, false, false
- **Evidence:** `apps/server/test/access.http.test.ts` › "tells loopback hosts from network-facing ones"; command `grep -n "isLoopbackHost" apps/server/src/main.ts` prints the warning's condition
