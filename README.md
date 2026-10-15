# letsview

Interactive workspace for exploring recorded vehicle time series (CAN signals in ClickHouse): search signals, lay them out in linked chart windows, zoom from a whole drive down to single samples, and read exact values and differences with two cursors. Everything in the UI is also a command, so a CLI (or an agent) can drive the same workspace.

| What | Where |
|---|---|
| Requirements (German) | [docs/concept.md](docs/concept.md) |
| Specs, one per capability | [openspec/specs/](openspec/specs/) |
| Changes in flight and archived | [openspec/changes/](openspec/changes/) |
| Decisions | [docs/decisions.md](docs/decisions.md) |
| State and next steps | [docs/status.md](docs/status.md) |
| Team roles and round flow | [docs/team.md](docs/team.md) |

## Layout

| Path | Contents |
|---|---|
| `packages/shared` | Workspace model and commands (`apply.ts`), series encoding, cursor evaluation, number and time formats; used by all three apps |
| `apps/server` | HTTP API on port 7310: signal catalog from the DBC, resolution-aware series queries, cursor values, the workspace and its live channel |
| `apps/web` | React + uPlot UI on port 5173 |
| `apps/cli` | `letsview` command line, see [CLI](#cli) |

## Setup

Requires Node ≥ 22.18, pnpm 10, Docker.

```sh
pnpm install
cp .env.example .env   # then set CLICKHOUSE_PASSWORD (read-only user `letsview` on carserver)
```

## Data sources

**Real data (development):** ClickHouse `sdlog` on carserver, reachable only through an SSH tunnel:

```sh
ssh -f -N -L 18123:localhost:8123 jan@192.168.42.207
```

**Test database (automated tests):** local ClickHouse with synthetic data:

```sh
docker compose up -d
pnpm --filter @letsview/server seed:test
```

The seed script refuses to run if `TEST_CLICKHOUSE_URL` equals `CLICKHOUSE_URL`.

## Run

```sh
pnpm --filter @letsview/server dev   # server
pnpm --filter @letsview/web dev      # UI at http://localhost:5173, proxies /api to the server
```

## Using the app

**Signals.** The sidebar searches the catalog (`/` focuses it, `s` toggles the sidebar). Arrow keys and Enter, or a row's `+` button, add a signal to the marked window (click a window header to mark it), or to a new one. Drag a signal from the sidebar or a legend row onto a window to add or move it; hold Alt or Ctrl to copy. A window takes up to four units, one y axis each. A window emptied by a move disappears. Hover a legend row and click its `×` to remove the signal.

**Time.** With the time axes linked (default), every window follows.

| Do | Effect |
|---|---|
| Drag across a plot | zoom to that range |
| Ctrl/Shift + wheel, trackpad pinch | zoom at the pointer |
| Horizontal wheel or swipe | pan |
| Plain vertical wheel | scrolls the page, never the chart |
| `+` / `-` | zoom in / out around cursor A when it is in view, else the centre |
| `←` / `→`, Shift+`←` / `→` | pan by half / a whole span |
| `t`, or the "Go to" field | type a time or range: `15:08`, `15:07 .. 15:09`, `15:08 ±30s`, `a..b`, `1h`, `+10min` |
| Span presets | 1 s … 1 day around the anchor |
| Backspace, "Back" | previous range |
| Double-click, `Home`, "Reset" | the signals' full extent |

**Cursors.** Click a plot to place cursor A, Shift+click for B, drag a line to move it (Esc puts it back). Each legend row shows the exact value at A and at B; "Diff" adds Δ = B − A and Δt. Hover a value for its kind (linear between points, held, …). A values window ("+ Values") lists many signals at the cursors without a plot.

## Check

```sh
pnpm build   # typecheck (+ web bundle)
pnpm test
pnpm lint    # pnpm format to fix
```

## CLI

`letsview` controls the open workspace through the server's HTTP API (spec [cli](openspec/specs/cli/spec.md)). Run it from the repo root while the server runs:

```sh
node apps/cli/src/main.ts --help
node apps/cli/src/main.ts state
```

Server: `--server URL` (an `http://` or `https://` URL), else `LETSVIEW_URL`, else `http://localhost:7310`. Global options anywhere on the line: `--wait` (block until an open UI rendered the command), `--timeout DURATION` (default `30s`), `--pretty`, `--help`; `--` ends options.

W is a window ID (`w3`), C is `a` or `b`. TIME is decimal ns, ISO-8601 with `Z`/`±HH:MM`, local wall time `YYYY-MM-DD[T ]HH:MM[:SS[.fffffffff]]` in the process's zone (`TZ`), or a cursor anchor `a`, `b+500ms`, `a-1s`. DURATION is `[+-]<number><unit>` with `ns us µs ms s min h`. SIGNAL is a full ID (`smart451/COMBI_412h.V_ANZ`) or a unique bare name (`V_ANZ`); REF is an assignment ID (`a7`) or a signal in window W.

| Form | Command |
|---|---|
| `window create [--values] [--title T] [--from TIME --to TIME] [--mode line\|step\|markers] [--envelope on\|off]` | `window.create` |
| `window remove W` | `window.remove` |
| `window rename W TITLE` | `window.rename` (`""` clears) |
| `window height W PX` | `window.setHeight` |
| `window range W FROM TO` | `window.setRange` |
| `window display W [--mode M] [--envelope on\|off]` | `window.setDisplay` |
| `link on\|off` | `workspace.setLinkTime` |
| `signal add W SIGNAL` | `window.addSignal` |
| `signal remove W REF` | `window.removeSignal` |
| `signal move W REF TARGET\|new [--copy]` | `window.moveSignal` |
| `cursor set C TIME` | `cursor.set` |
| `cursor move C DURATION` | `cursor.move` |
| `cursor remove C` | `cursor.remove` |
| `diff on\|off` | `cursor.setDiff` |
| `command JSON` | the JSON as is (no anchors, names or REFs resolved) |

Reads: `state`, `search QUERY… [--limit N]`, `extent SIGNAL`, `value SIGNAL TIME [--mode line|step]`, `wait [REVISION]`.

Each call prints one JSON line (`ok`, `outcome`, `exitCode`, and where they apply `accepted`, `command`, `revision`, `created`, `createdWindow`, `render`, `data`, `local`, `error`); a failure also prints one line to stderr. `local` holds times as local wall time with offset.

| Exit | Outcome | When |
|---|---|---|
| 0 | `ok` | read answered, or command accepted (with `--wait`: and rendered) |
| 1 | `rejected` | the server or a lookup refused it (`cursor_off`, `unknown_signal`, `ambiguous_signal`, …) |
| 2 | `usage` | arguments do not parse; nothing was sent |
| 3 | `unreachable` | no connection to the server |
| 4 | `timeout` | `--timeout` ran out during a request or the wait |
| 5 | `render_error` | the UI rendered with data errors |
| 6 | `no_ui` | waiting, and no UI connected for 2 s |
| 7 | `unavailable` | the server answered 5xx (e.g. `catalog_unavailable`) |

Examples:

```sh
node apps/cli/src/main.ts --wait window create --title Speeds --from "2026-10-13 15:08:00" --to "2026-10-13 15:08:03"
node apps/cli/src/main.ts state | jq -r .local.cursors.a   # 2026-10-13 15:08:01.500+02:00
```
