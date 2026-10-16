## ADDED Requirements

### Requirement: Window limit
A workspace SHALL hold at most 64 windows of both kinds together. A `window.create` beyond that SHALL be rejected with code `window_limit` and change nothing. Origin: necessary consequence: an unbounded loop of a script or AI client (concept §7) would grow server memory and the pushed state without limit. Number: design H4.

#### Scenario: 65th window
- **WHEN** 64 windows exist and `window.create` is applied, once as timeseries and once as values
- **THEN** both are rejected with `window_limit`, and the workspace still has 64 windows
- **Evidence:** `packages/shared/test/apply.test.ts` › "rejects a 65th window with window_limit"

### Requirement: Window title trimmed on create
`window.create` SHALL store its title trimmed, like `window.rename`; a title that is empty after trimming SHALL leave the window without a title. Origin: necessary consequence of "Window title and height" (rename trims; a blank stored title shows an empty header). Design H8.

#### Scenario: Blank and padded titles
- **WHEN** `window.create` is applied with title `"  "` and with title `"  Speeds "`
- **THEN** the first window has no `title`, the second the title `Speeds`
- **Evidence:** `packages/shared/test/apply.test.ts` › "trims the title on window.create"

### Requirement: Listeners cannot fail a command
An accepted command SHALL return its result and reach every live client even when pushing the state to one of them throws; the error SHALL be reported to the server log. Origin: necessary consequence of "Command results" (a command applied but answered 500 leaves the caller unsure whether it was applied). Design H8.

#### Scenario: Throwing listener
- **WHEN** a workspace store has three listeners, the second throws, and a valid command is executed
- **THEN** the result is accepted with the new revision, the first and third listeners got that revision, and the error callback got the thrown error
- **Evidence:** `apps/server/test/workspace.http.test.ts` › "a throwing listener neither fails the command nor starves later listeners"

### Requirement: State pushes name their command
Every state message the live channel sends after a command SHALL carry that command's type; the state sent on connect SHALL carry none. Origin: necessary consequence of D-042 (1) („setting the same range again also retries"): the UI can only tell a range command that left the range unchanged from an unrelated revision by its type. Design H7.

#### Scenario: Push after a range command
- **WHEN** a live client connects and then `window.setRange` is posted for an existing window with its current range
- **THEN** the first state message has no `command`, and the next has `command` `window.setRange` and the new revision
- **Evidence:** `apps/server/test/workspace.http.test.ts` › "names the command type in state pushes"

### Requirement: Bounded render acknowledgements
A render acknowledgement SHALL carry at most 50 errors, each message at most 500 characters and each window or signal ID at most 200 characters; the server SHALL ignore one that exceeds this. The UI SHALL send at most the first 50 errors, each message cut to 500 characters, so its acknowledgements are never ignored. Origin: necessary consequence of "Render acknowledgement" (the server stores errors per client). Numbers: design H4.

#### Scenario: Server ignores oversized acknowledgements
- **WHEN** `RenderedMessage` parses an acknowledgement with 51 errors, one with a 501-character message, and one with 50 errors of 500 characters
- **THEN** the first two fail and the third passes
- **Evidence:** `packages/shared/test/workspace.test.ts` › "bounds render acknowledgements"

#### Scenario: UI caps its acknowledgement
- **WHEN** the acknowledger builds the message for one window reporting 70 errors, one with a 2,000-character message
- **THEN** the message has 50 errors, every message at most 500 characters, status `error`, and parses as `RenderedMessage`
- **Evidence:** `apps/web/test/ack.test.ts` › "caps errors and message lengths"

### Requirement: Acknowledgement survives a reconnect
The UI SHALL treat an acknowledgement as sent only when the live channel took it, and SHALL acknowledge the current revision again after the live channel opens, also when the revision did not change meanwhile. Origin: concept §7 („ob … die offene Oberfläche den Zustand dargestellt hat"); necessary consequence: today an acknowledgement dropped while disconnected is never repeated and `--wait` times out. Design H6.

#### Scenario: Settled while disconnected
- **WHEN** both windows report revision 7 while the send function returns false, and then the channel reconnects with revision still 7
- **THEN** no acknowledgement counted as sent before the reconnect, and right after it one acknowledgement for revision 7 is sent
- **Evidence:** `apps/web/test/ack.test.ts` › "acknowledges again after a reconnect"

#### Scenario: Same report not repeated
- **WHEN** both windows report revision 7 with no errors twice while connected
- **THEN** exactly one acknowledgement is sent
- **Evidence:** `apps/web/test/ack.test.ts` › "sends one acknowledgement per revision and error list"

#### Scenario: Wait after a server restart on real data
- **WHEN** the UI is open, the lead restarts the server with `scripts/restart-server.sh`, rebuilds a window with the CLI, and runs `kipscope --wait link off`
- **THEN** the CLI exits 0 with `render.status` `complete`
- **Evidence:** lead's manual check (CLI output; restarts are the lead's job)

### Requirement: Failed commands are shown
A command the UI sends SHALL never leave an unhandled failure: a network failure, a non-JSON answer or a body that is not a command result SHALL become a rejected result with code `network` or `bad_response` and a message, shown in the UI's message line like any rejected command. Origin: concept §10 („Fehler … müssen erkennbar bleiben"). Design H6.

#### Scenario: Network failure and proxy page
- **WHEN** `sendCommand` meets a rejected `fetch`, a 502 with an HTML body, and a 200 with body `{"foo":1}`
- **THEN** it resolves to `{ok: false}` with codes `network`, `bad_response` and `bad_response`, each with a message naming the cause (the second names HTTP 502)
- **Evidence:** `apps/web/test/api.test.ts` › "sendCommand resolves every failure to a rejected result"

#### Scenario: Server down in the UI
- **WHEN** the lead stops the KIPscope server while the UI is open and renames a window
- **THEN** the message line shows a `network` or `bad_response` error, the browser console shows no unhandled rejection, and the page keeps working after the server is back
- **Evidence:** lead's manual check (screenshot of the message line)
