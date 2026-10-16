# Design

## Context

See proposal.md (Why). Precondition: `add-cursors` is archived first; its cursor commands, values windows and `GET /api/value` are already in the code (`packages/shared/src/workspace.ts`, `cursor.ts`, `apps/server/src/routes/series.ts`).

What exists and shapes the approach:

- **Commands.** `POST /api/commands` takes one `Command` (zod union in `packages/shared/src/workspace.ts`, 14 types) and answers a `CommandResult`: 200 `{ok: true, revision, created?, createdWindow?}`, 400 `{ok: false, code: "invalid_command"}`, 422 for every other refusal. Times in commands are `TimeInput`: decimal ns or ISO-8601 **with** zone, within 1900 … 2262 (D-021). The server has no idea of the user's time zone.
- **Reads.** `GET /api/workspace` → `{revision, workspace}`. `GET /api/render-status` → `RenderStatus {revision, clients: [{clientId, connectedAt, rendered?: {revision, status, errors, at}}]}`. `GET /api/signals?q&offset&limit` (default 50, max 200) → `SignalPage`. `GET /api/extent?signal` → `Extent`. `GET /api/value?signal&t&mode` → `CursorValueResult`. Errors are `ApiError {error: {code, message, …}}` with 400/404/502/503.
- **Render acknowledgement.** The web sends `{type: "rendered", revision, status, errors}` over `WS /api/live` once **every** window reported ready for the current revision (`App.tsx` `acknowledge`); with no window it acknowledges at once. A UI that drops its connection reconnects after 1 s (`live.ts`). The server keeps per client only the last acknowledgement and ignores revisions above the current one.
- **Local time in the UI.** `apps/web/src/time/axis.ts` `formatFull(t)`: browser-local `YYYY-MM-DD HH:MM:SS[.fff[fff[fff]]]`, fraction trimmed in 3-digit groups, no offset. Values window header and tooltips use it; window headers use `formatRange` (ms, truncated).
- **Runtime.** Node ≥ 22.18 runs TypeScript directly (D-011); the server does so with `@kipscope/shared` from source. Node has `fetch`, `AbortSignal.timeout`, `node:util` `parseArgs` and a global `WebSocket`.

## Goals / Non-Goals

**Goals:**
- `packages/shared` and the three CLI tasks build in parallel against S1–S3; the tester writes all tests from S1–S4 at the same time.
- No server or web source change: every CLI need is met by the existing HTTP API (L4 explains why waiting needs no endpoint).
- A call costs few requests: a command is one `POST`; a command with a bare name or an anchor adds one `GET`; `--wait` polls one small `GET` every 100 ms.

**Non-Goals:**
- No new runtime dependency (no commander/yargs, no WebSocket library).
- No caching between calls; every call is a fresh process.
- No guarantee against interleaving: an anchor or name is resolved from a read just before the command; a human acting in between can make it stale (concept §7: concurrent changes need not be supported).

## Decisions

### L1: A thin client in `apps/cli`, run by Node

Package `@kipscope/cli` in `apps/cli`, `"bin": {"kipscope": "src/main.ts"}` with `#!/usr/bin/env node`. It depends only on `@kipscope/shared` (for `Command`, `Workspace`, `RenderStatus`, `SignalPage`, `CursorValueResult`, `ApiError` and the local-time functions of S1). Run it as `node apps/cli/src/main.ts …` from the repo root or `pnpm --filter @kipscope/cli exec kipscope …`.

Module split (each file has one owner task, see tasks.md):

| File | Role |
|---|---|
| `src/main.ts` | process entry: `process.exitCode = await run(argv, io)` |
| `src/output.ts` | `Outcome`, `EXIT`, `CliOutput`, `CliError`, `printOutput` |
| `src/client.ts` | HTTP with one deadline, maps transport and status codes to outcomes |
| `src/wait.ts` | render wait by polling (L4) |
| `src/args.ts` | argv → `Invocation` (pure, no I/O) |
| `src/refs.ts` | anchors, bare signal names, assignment refs → concrete values |
| `src/run.ts` | glue: parse, resolve, request, wait, build `CliOutput`, `local` times |

- *Alternative: a script that wraps `curl`.* Rejected: no local-time parsing, no wait, no typed results.
- *Alternative: the CLI as a server subcommand.* Rejected: D-005 puts the CLI endpoint in the server; the client must run while the server runs, and later from another machine.

### L2: Command forms

Each form sends exactly one command. W is a window ID (`w<n>`), C is `a` or `b`, TIME per L5, DURATION per L5, SIGNAL and REF per L6, M is `line|step|markers`.

| Form | Command sent |
|---|---|
| `window create [--values] [--title T] [--from TIME --to TIME] [--mode M] [--envelope on\|off]` | `window.create {kind: "values"` only with `--values`, `title?, from?, to?, mode?, envelope?}`; `--from` without `--to` is a usage error |
| `window remove W` | `window.remove {windowId}` |
| `window rename W TITLE` | `window.rename {windowId, title}` (`""` clears) |
| `window height W PX` | `window.setHeight {windowId, height}`; PX must be an integer (bounds stay with the server) |
| `window range W FROM TO` | `window.setRange {windowId, from, to}` |
| `window display W [--mode M] [--envelope on\|off]` | `window.setDisplay {windowId, mode?, envelope?}`; neither option is a usage error |
| `link on\|off` | `workspace.setLinkTime {linked}` |
| `signal add W SIGNAL` | `window.addSignal {windowId, signalId}` |
| `signal remove W REF` | `window.removeSignal {windowId, assignmentId}` |
| `signal move W REF TARGET\|new [--copy]` | `window.moveSignal {windowId, assignmentId, targetWindowId?` (absent for `new`), `copy: true` only with `--copy}` |
| `cursor set C TIME` | `cursor.set {cursor, t}` |
| `cursor move C DURATION` | `cursor.move {cursor, by}` |
| `cursor remove C` | `cursor.remove {cursor}` |
| `diff on\|off` | `cursor.setDiff {diff}` |
| `command JSON` | the parsed JSON as is |

Reads: `state`, `search QUERY… [--limit N]` (words joined by one space), `extent SIGNAL`, `value SIGNAL TIME [--mode line|step]`, `wait [REVISION]`.

Global options, accepted anywhere on the line: `--server URL`, `--wait`, `--timeout DURATION` (default `30s`, must be > 0), `--pretty`, `--help`/`-h`. Times always go out as decimal ns strings, so the server never parses local time. A token that starts with `-` followed by a digit (`-1.5s`, `-2ms`) is a positional value, not an option; `--` ends option parsing.

- *Alternative: one flag-style command per type (`--type cursor.set --cursor a …`).* Rejected: hard to type, and `command JSON` already covers the generic case.

### L3: Output and exit codes

One JSON line on stdout per call (S2 `CliOutput`); `--pretty` indents it with 2 spaces. On a non-zero exit, one line `kipscope: <outcome>: <code>: <message>` goes to stderr. `--help` prints plain usage text to stdout, exit 0 (the only non-JSON output).

| Outcome | Exit | When |
|---|---|---|
| `ok` | 0 | read answered 2xx, or command accepted (and, with `--wait`, rendered `complete`) |
| `rejected` | 1 | command answered `ok: false` (400/422), a read answered 4xx, or a local lookup refused (`cursor_off`, `unknown_signal`, `ambiguous_signal`, `unknown_assignment`, `unknown_window`, `unknown_revision`) |
| `usage` | 2 | arguments, time, duration or JSON do not parse; nothing was sent |
| `unreachable` | 3 | connection refused, DNS failure, connection reset |
| `timeout` | 4 | `--timeout` ran out during a request or the wait |
| `render_error` | 5 | the UI acknowledged with `status: "error"` |
| `no_ui` | 6 | `--wait`/`wait` and no UI was connected for 2 s in a row |
| `unavailable` | 7 | the server answered 5xx (`catalog_unavailable`, `source_error`, other), or an unexpected error inside the CLI (lead, close-out: no separate code; the reason line names the error) |

A command that was accepted keeps `accepted: true`, `revision`, `created`, `createdWindow` in the output even when the wait then ends in 3–7, so a caller never repeats an applied command by mistake. `error.code` is the server's code where there is one (`ApiError.error.code`, `CommandResult.code`), else the outcome name.

- *Alternative: human text by default with `--json`.* Rejected for now: the main remote user is a program (concept §7 „maschinenlesbare Ergebnisse"); `jq` gives humans what they need. Q1.
- *Alternative: exit 0 for an accepted command whatever the wait says.* Rejected: a script checking only `$?` would miss that the UI never showed it.

### L4: Waiting polls `GET /api/render-status`

`waitForRender(target)`:

```
start = now; lastClientSeen = start
loop
  status = GET /api/render-status
  acked = clients whose rendered.revision ≥ target
  if acked not empty → error if any acked has status "error" (its clientId, errors), else complete (first acked)
  if clients not empty → lastClientSeen = now
  else if now − lastClientSeen ≥ NO_UI_GRACE_MS → no_ui
  if now ≥ deadline → timeout
  sleep POLL_MS
```

`wait REVISION` with REVISION above the current revision is rejected with `unknown_revision` (the server ignores acknowledgements above the current revision, so it could only end by timeout). `wait` without REVISION waits for the current one. "Or a later one" counts because a later revision contains every earlier change that was not undone, and the UI never acknowledges a revision it skipped.

**Any UI decides.** With several browsers open, the first one that acknowledges ends the wait (Q3). A hidden tab is throttled by the browser (timers down to once per minute after 5 min), so requiring every client would make `--wait` hang on a forgotten tab. The output names the client.

- *Alternative: a long-poll endpoint `GET /api/render-status?revision=R&timeout=…`.* Answers in the same tick as the acknowledgement and saves polls, but adds server code and a second route test for no gain a person can see (≤ 100 ms). Can be added later without changing the CLI's output (Q4).
- *Alternative: the CLI connects to `WS /api/live`.* Rejected: the server would count the CLI as a UI client (`connect()` registers every socket), so "no UI connected" could no longer be told apart, and render status would list a client that never renders.

### L5: Time, durations and anchors

TIME grammar, tried in this order:

1. `^-?\d+$` → decimal ns.
2. `a` or `b`, optionally followed by `+DURATION` or `-DURATION` → anchor (resolved by `refs.ts` from `GET /api/workspace`; an off cursor rejects with `cursor_off`).
3. `^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?$` → with zone: exact instant; without zone: local wall time in the process's time zone (`TZ`, else the system zone).

A local wall time maps to the instants whose local offset makes it round-trip: none → usage error "does not exist in local time (DST change)"; two → usage error naming both, e.g. `ambiguous local time 2026-10-25 02:30: add +02:00 or +01:00`. The fraction is kept as bigint ns, never through a float. Results outside `TIME_MIN … TIME_MAX` are usage errors (the server would refuse them anyway; refusing locally keeps "nothing sent").

DURATION: `^[+-]?(\d+(\.\d+)?|\.\d+)(ns|us|µs|ms|s|min|h)$`, converted exactly; a fraction that does not land on a whole ns is a usage error. `m` is refused because it reads as minutes or milliseconds. The sign is optional in `cursor move` (`+500ms` and `500ms` mean the same) and part of the syntax in an anchor (`a+1s`, `a-1s`).

Local output (`local` in S2): `formatLocal(t, {offset: true})`, e.g. `2026-10-13 15:08:01.500+02:00`: the UI's text (`formatFull`) plus the offset, which makes fold times unambiguous (concept §8) and parses back with rule 3.

The UI's local zone is the browser's; the CLI's is the process's. On one machine they match. A CLI on another machine sets `TZ` (Q8).

### L6: Signal and assignment references

- SIGNAL with a `/` is a full ID and is sent unchanged; the server answers `unknown_signal` (422 for commands, 404 for reads) if it does not exist.
- SIGNAL without `/` is a bare name: `GET /api/signals?q=<name>&limit=200`, keep items whose `name`, or `name` after its first `.`, equals the argument ignoring case. One → its ID; none → `unknown_signal`; several → `ambiguous_signal` with `candidates` (IDs sorted). Exact matches are search tier 0 (D-022), so they come first in the page.
- REF matching `^a\d+$` is an assignment ID, sent unchanged. Any other REF is resolved against window W's assignments from `GET /api/workspace`: the assignment whose `signalId` equals REF (full ID) or whose name / name after the first `.` equals it ignoring case. W missing → `unknown_window`; no match → `unknown_assignment`; two matches (same name from two data references) → `ambiguous_signal` with candidates.

Bare names are a convenience (goal); the stable IDs stay the contract (concept §7). Q5.

### L7: Numbers, each checked at a factor of two

| Number | Value | Half | Double |
|---|---|---|---|
| `--timeout` default | 30 s | 15 s: probably still covers a real-UI render (not measured, see below), but cuts off a `value` query that runs into the server's own 30 s DB timeout | 60 s: a hung UI keeps an AI waiting a minute before it learns anything |
| Poll interval `POLL_MS` | 100 ms | 50 ms: 20 small requests/s, no gain a caller can notice | 200 ms: up to 0.2 s extra latency per wait, still acceptable |
| No-UI grace `NO_UI_GRACE_MS` | 2 s | 1 s: equals the UI's reconnect delay (`live.ts`), so a page reload during a wait would report `no_ui` | 4 s: a script without any UI waits 4 s per call for the answer |
| Name lookup page | 200 (server max) | 100: still far above any real number of exact matches for one name (real catalog: 428 signals in total) | not allowed by the server |

The render time of the real UI is not measured; the timeout default is a goal, and the UI checks report the observed wait (`render` has `waitedMs`).

### L8: Test harness

- `apps/cli/test/helpers.ts` (tester): starts the real server app in-process with `buildApp` from `apps/server/src/app.ts`, a `WorkspaceStore`, and a `Catalog` over a stub `DataSource` (fixed `listSignals`, `extent`, `before`, `after`; no ClickHouse), `listen({port: 0, host: "127.0.0.1"})`. A catalog that is never refreshed gives the 503 case. A fake browser is a global `WebSocket` on `/api/live`: it reads `hello` for its client ID and sends `rendered` messages on demand or automatically after a delay.
- `run(argv, io)` (S3) runs in-process with captured stdout/stderr lines; `process.test.ts` spawns `node apps/cli/src/main.ts` for the real exit code and streams.
- `apps/cli` and `packages/shared` tests run with `TZ=Europe/Berlin`, as the web tests do.

## Shared interfaces (pinned)

### S1: Local time (`packages/shared/src/localtime.ts`, exported from `index.ts`)

```ts
import type { Timestamp } from "./time.ts";

/**
 * Local wall time as the UI shows it: "YYYY-MM-DD HH:MM:SS[.fff[fff[fff]]]", fraction trimmed in
 * 3-digit groups (same text as web formatFull). With offset: plus "+HH:MM"/"-HH:MM" (never "Z").
 * Time zone: the runtime's (process TZ in Node, the browser's in the UI).
 */
export function formatLocal(t: Timestamp, options?: { offset?: boolean }): string;

/**
 * Absolute time: decimal ns; or "YYYY-MM-DD[T ]HH:MM[:SS[.f{1,9}]]" with "Z" or "±HH:MM";
 * or the same without zone as local wall time. Throws RangeError with a message for bad syntax,
 * an invalid date, a local time that does not exist or is ambiguous (message names both offsets),
 * and times outside TIME_MIN … TIME_MAX.
 */
export function parseTime(text: string): Timestamp;

/** "[+-]<decimal><unit>", unit ns|us|µs|ms|s|min|h, exact to 1 ns; throws RangeError otherwise. */
export function parseDuration(text: string): bigint;
```

### S2: CLI output (`apps/cli/src/output.ts`)

```ts
import type { CommandInput, RenderError } from "@kipscope/shared";

export const EXIT = {
  ok: 0, rejected: 1, usage: 2, unreachable: 3, timeout: 4, render_error: 5, no_ui: 6, unavailable: 7,
} as const;
export type Outcome = keyof typeof EXIT;

export interface RenderWait {
  status: "complete" | "error" | "no_ui" | "timeout";
  /** Revision waited for. */
  target: number;
  /** Acknowledged revision that ended the wait (complete or error). */
  revision?: number;
  clientId?: string;
  /** Present for status "error". */
  errors?: RenderError[];
  waitedMs: number;
}

export interface CliOutput {
  ok: boolean;              // exitCode === 0
  outcome: Outcome;
  exitCode: number;         // EXIT[outcome]
  accepted?: boolean;       // commands only
  command?: CommandInput;   // as sent (times as decimal ns)
  revision?: number;        // after an accepted command; for `wait` the target; for `state` the current
  created?: string;
  createdWindow?: string;
  render?: RenderWait;      // --wait and `wait`
  data?: unknown;           // reads: the server's body (state: {revision, workspace, render})
  local?: Record<string, unknown>; // local times with offset, see below
  error?: { code: string; message: string; candidates?: string[] };
}

/** Thrown anywhere below run(); run turns it into a CliOutput. */
export class CliError extends Error {
  constructor(
    readonly outcome: Exclude<Outcome, "ok">,
    readonly code: string,
    message: string,
    readonly candidates?: string[],
  );
}

export function printOutput(out: CliOutput, io: Io, pretty: boolean): void; // stdout line, stderr line if !ok
```

`local` shapes: `state` → `{cursors: {a?, b?}, ranges: {[windowId]: {from, to}}}` (timeseries windows only); `extent` → `{first, last}`; `value` → `{t, at?, next?}` (times of `at`/`next`). Other calls have no `local`.

`state`'s `data` is `{revision, workspace, render}` with `revision`/`workspace` from `GET /api/workspace` and `render` the `RenderStatus` body.

### S3: CLI modules (`apps/cli/src/*`)

```ts
// run.ts
export interface Io {
  env: Record<string, string | undefined>;
  stdout(line: string): void;
  stderr(line: string): void;
}
/** Parses, executes and prints one call; returns the exit code. Never throws. */
export function run(argv: string[], io: Io): Promise<number>;

// args.ts (pure)
export type TimeArg = { kind: "abs"; t: bigint } | { kind: "anchor"; cursor: CursorName; offset: bigint };
export type SignalArg = { kind: "id"; id: string } | { kind: "name"; name: string };
export type RefArg = { kind: "assignment"; id: string } | SignalArg;
/** A command whose time, signal and assignment fields may still hold TimeArg/SignalArg/RefArg. */
export type CommandTemplate = { type: Command["type"] } & Record<string, unknown>;
export interface GlobalOptions { server: string; wait: boolean; timeoutMs: number; pretty: boolean }
export type Invocation =
  | { kind: "help" }
  | { kind: "state" }
  | { kind: "search"; query: string; limit?: number }
  | { kind: "extent"; signal: SignalArg }
  | { kind: "value"; signal: SignalArg; t: TimeArg; mode?: ValuesMode }
  | { kind: "wait"; revision?: number }
  | { kind: "command"; template: CommandTemplate; /** `command JSON`: sent unchanged, never passed to resolveCommand. */ raw?: true };
/** Throws CliError("usage", "usage", …). server: --server, else env.KIPSCOPE_URL, else http://localhost:7310. */
export function parseArgs(argv: string[], env: Record<string, string | undefined>): { options: GlobalOptions; invocation: Invocation };
export const USAGE: string;

// refs.ts
export interface Lookups {
  workspace(): Promise<{ revision: number; workspace: Workspace }>; // memoised per call
  search(query: string, limit: number): Promise<SignalPage>;
}
export function resolveTime(arg: TimeArg, l: Lookups): Promise<bigint>;          // CliError rejected cursor_off
export function resolveSignal(arg: SignalArg, l: Lookups): Promise<string>;      // rejected unknown_signal | ambiguous_signal
export function resolveRef(windowId: string, arg: RefArg, l: Lookups): Promise<string>; // rejected unknown_window | unknown_assignment | ambiguous_signal
/** Replaces every TimeArg (→ decimal ns string), SignalArg and RefArg; templates without refs need no lookup. */
export function resolveCommand(t: CommandTemplate, l: Lookups): Promise<CommandInput>;

// client.ts
export interface Deadline { readonly at: number; remainingMs(): number }
export interface Client {
  /** 2xx → body; 4xx → CliError rejected (ApiError code); 5xx → unavailable; network → unreachable; deadline → timeout. */
  get<T>(path: string, query?: Record<string, string>): Promise<T>;
  /** 200/400/422 → CommandResult; other statuses and failures as get. */
  postCommand(command: CommandInput): Promise<CommandResult>;
}
export function createClient(baseUrl: string, deadline: Deadline): Client;

// wait.ts
export const POLL_MS = 100;
export const NO_UI_GRACE_MS = 2000;
export interface WaitDeps {
  renderStatus(): Promise<RenderStatus>;
  now(): number;
  sleep(ms: number): Promise<void>;
}
/** L4; deadline is an absolute now()-time. */
export function waitForRender(target: number, deadline: number, deps: WaitDeps): Promise<RenderWait>;
```

The field names a `CommandTemplate` uses are exactly those of the `Command` it becomes (L2): `t`, `from`, `to` hold a `TimeArg`; `signalId` a `SignalArg`; `assignmentId` a `RefArg` (resolved against `windowId`). `args.test.ts` checks forms by `resolveCommand(parseArgs(argv, {}).invocation.template, lookupsThatThrow)` for argument lists without anchors, bare names or name REFs.

### S4: HTTP used (existing, unchanged)

| Call | Request | Answer used |
|---|---|---|
| commands | `POST /api/commands` JSON `Command` | `CommandResult` (200, 400, 422) |
| state | `GET /api/workspace`, `GET /api/render-status` | `{revision, workspace}`, `RenderStatus` |
| search, bare names | `GET /api/signals?q=&limit=` | `SignalPage` |
| extent | `GET /api/extent?signal=` | `Extent` |
| value | `GET /api/value?signal=&t=<ns>&mode=` | `CursorValueResult` |
| wait | `GET /api/render-status` | `RenderStatus` |

Example (`TZ=Europe/Berlin`, A on):

```sh
$ kipscope cursor move a +500ms
{"ok":true,"outcome":"ok","exitCode":0,"accepted":true,"command":{"type":"cursor.move","cursor":"a","by":"500000000"},"revision":42}
$ kipscope --wait --timeout 5s cursor set b a+1s
{"ok":true,"outcome":"ok","exitCode":0,"accepted":true,"command":{"type":"cursor.set","cursor":"b","t":"1791896882500000000"},"revision":43,"render":{"status":"complete","target":43,"revision":43,"clientId":"c7","waitedMs":310}}
```

## Risks / Trade-offs

- [A CLI on another machine than the browser reads local times in its own zone.] → `TZ` overrides; `local` output carries the offset, so a mismatch is visible. Q8.
- [Resolving an anchor or a bare name needs a read before the command; a human can change the state in between.] → Accepted by concept §7 (no concurrent changes). `cursor move` is atomic on the server and needs no read.
- [The render acknowledgement of a UI that already shows a load error stays `error` for later revisions, so `--wait` after an unrelated command reports `render_error`.] → Correct by meaning: the open view does not show all its data. `render.errors` names window and signal.
- [`apps/cli/test` imports server code by relative path.] → Only tests do; `src` depends on `@kipscope/shared` alone. If `tsc -p apps/cli` trips over server types, the CLI's `tsconfig.json` leaves `test` out of `include` and vitest still runs them.
- [Polling adds up to 100 ms per wait.] → L7; long-poll is the upgrade path (Q4).

## Migration Plan

New package only. `pnpm install` once (lockfile gains `apps/cli`). Rollback: delete `apps/cli` and `localtime.ts`. No server restart needed for the CLI; the dev server must run for the UI checks.

## Open questions for Jan

Each with the spec owner's recommendation; the tasks build on it. "Detail" = cheap to change later; "direction" = later change is expensive or shapes other parts.

1. **Output format.** Recommended: JSON always, `--pretty` for indentation, `jq` for people. Alternatives: human text by default with `--json`; or both selected by whether stdout is a terminal. *Detail* (one function in `output.ts`).
2. **Wait by default?** Recommended: opt-in `--wait`, so scripts without an open UI do not stall 2 s per call. Alternative: wait by default with `--no-wait`. *Detail* (one default).
3. **Several UIs open.** Recommended: the first UI that acknowledges decides, and the output names it. Alternatives: all connected UIs must acknowledge (hangs on throttled background tabs); or the most recently connected one. *Detail* (one predicate in `wait.ts`).
4. **Wait mechanism.** Recommended: poll the existing `GET /api/render-status` every 100 ms; no server change. Alternative: a long-poll endpoint in the server, pinned in `packages/shared`. *Detail* (the CLI output stays the same).
5. **Bare signal names.** Recommended: accept a unique bare name (`V_ANZ`), refuse ambiguous ones with candidates. Alternative: full IDs only (`smart451/COMBI_412h.V_ANZ`), which forces a `search` first. *Detail*.
6. **Where relative times live.** Recommended: anchors (`a+500ms`) are resolved in the CLI; the command model keeps absolute times plus `cursor.move`. Alternative: the shared command model accepts anchor expressions and the server resolves them atomically, so any later client (script, MCP, UI command line) gets them too. *Direction*: moving them into the command model later changes `packages/shared` commands and every client that builds them.
7. **Ambiguous local times (DST).** Recommended: refuse and ask for an offset. Alternative: take the earlier instant, as JavaScript's `Date` does. *Detail*.
8. **Time zone of the CLI.** Recommended: the process's zone (`TZ`), same as the browser's on one machine. Alternatives: the UI reports its zone with the render acknowledgement and the CLI uses it; or a workspace time-zone setting (concept §8 „Die Zeitzone ist wählbar", planned later), which the CLI would then follow. *Detail* now (one function); the workspace setting itself is a later change.
9. **Installation.** Recommended: run from the repo (`node apps/cli/src/main.ts`, `pnpm --filter @kipscope/cli exec kipscope`). Alternatives: `pnpm link --global`, or a bundled single file. *Detail*.
