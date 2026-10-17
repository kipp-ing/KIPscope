# Proposal

## Why

Concept §7 asks for remote control of the open view: an external program or an AI ("Eine KI verwendet diese reguläre Schnittstelle") creates and changes windows, adds and assigns signals, sets ranges, cursors and diff mode, reads the state, and learns whether a command was accepted, whether the data is available and whether the open UI has rendered it. The server side exists since D-005 and D-011 (commands via `POST /api/commands`, state, render acknowledgements over `WS /api/live`). `add-cursors` adds the cursor commands and `GET /api/value`. What is missing is the client: today a caller has to hand-build JSON with `curl`, convert local times to nanoseconds itself, and cannot wait for the render acknowledgement over HTTP without polling by hand. This change was listed next in docs/status.md ("CLI remote control of the open view").

Precondition: `add-cursors` is archived before this change (its deltas are the base for `workspace-state`; its cursor commands and `GET /api/value` are used here).

## What Changes

- **New CLI** `kipscope` (package `apps/cli`, run with Node like the server, no new runtime dependency). It speaks only the existing HTTP API of the server.
- **Every workspace command** has a CLI form: windows (create timeseries or values window, remove, rename, height, range, display), the link flag, signals (add, remove, move or copy), cursors (set, move by a duration, remove), diff mode. A raw form `command '<json>'` sends any command of the shared command model.
- **Reads:** `state` (workspace, revision, render status of every connected UI, cursor and range times in local time), `search`, `extent`, and `value` (a signal's value at a time, as the values window shows it).
- **Machine-readable results:** one JSON object per call on stdout, with the outcome and fixed exit codes for ok, rejected, usage error, server unreachable, timeout, rendered with data errors, no UI connected, and data source unavailable.
- **Waiting for the open UI:** `--wait` after a command (and a `wait` command) blocks until a connected UI has acknowledged rendering that revision, and reports whether its data loaded completely, or that no UI is connected, or a timeout.
- **Time input** consistent with the UI: nanoseconds, ISO with zone, local wall time in the format the UI shows (also with `T`), the cursors `a`/`b` as anchors with an offset (`a+500ms`), and signed durations (`cursor move a -1.5s`). Ambiguous and nonexistent local times (DST change) are refused instead of guessed.
- **Signal references:** a full ID (`smart451/ICL_3A2h.SPEED_DISP`) or a unique bare name (`SPEED_DISP`, `ICL_3A2h.SPEED_DISP`); an ambiguous name is refused with its candidates.
- **Shared local-time functions** in `packages/shared` (format and parse), so the CLI writes and reads local times exactly like the UI.
- No server endpoint is added: waiting polls the existing `GET /api/render-status` (design L4). The `workspace-state` delta only pins that endpoint's contract, which the CLI relies on.

Out of scope: playback ("Historische Cursorbewegung", concept §7), save/load, snapshots, undo, templates and "Dashboard … laden" (concept §8, a later change), authentication and remote access control, a time zone setting other than the process time zone (`TZ`), a human text output mode, interactive or watch modes (streaming state), composite commands (e.g. "open investigation" from concept §9, or add a signal into a new window in one call), zoom by factor or pan commands, shell completion, global installation of the binary, an MCP server, concurrent-change handling (concept §7: not required), and any change to the UI.

## Capabilities

### New Capabilities
- `cli`: the `kipscope` command-line client: command forms, reads, output and exit codes, time and signal references, and waiting for the UI's render acknowledgement.

### Modified Capabilities
- `workspace-state`: "Render acknowledgement" pins `GET /api/render-status` (current revision, every connected UI with its last acknowledged revision, status and errors), which the CLI's wait builds on.

## Impact

- `packages/shared`: new `src/localtime.ts` (`formatLocal`, `parseTime`, `parseDuration`), exported from `index.ts`; the package's test script runs with `TZ=Europe/Berlin` like the web's.
- `apps/cli` (new): `package.json` (bin `kipscope`), `tsconfig.json`, `src/main.ts`, `src/run.ts`, `src/args.ts`, `src/refs.ts`, `src/client.ts`, `src/wait.ts`, `src/output.ts`; README section "CLI".
- `apps/server`, `apps/web`: no source change. A web test asserts that the UI's `formatFull` and the shared `formatLocal` agree.
- Tests: `packages/shared/test/localtime.test.ts`, `apps/cli/test/*.test.ts` (in-process server with a stub source and a fake browser over `WS /api/live`), `apps/web/test/axis.test.ts` (one added case).
- `pnpm install` once for the new workspace package (lockfile).
