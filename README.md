# KIPscope

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
| `apps/cli` | `kipscope` command line, see [CLI](#cli) |

## Setup

Requires Node ≥ 22.18, pnpm 10, Docker.

```sh
pnpm install
cp .env.example .env   # then set CLICKHOUSE_PASSWORD (read-only user `letsview` on carserver)
```

## Data sources

**Real data (development):** ClickHouse `sdlog` on carserver, reachable only through an SSH tunnel:

```sh
scripts/tunnel.sh start    # keeps the tunnel up and reconnects within ~5 s after a drop (e.g. carserver's 23:00 reboot)
scripts/tunnel.sh status   # keeper running? ClickHouse answering on 18123?
scripts/tunnel.sh stop
```

The keeper runs `ssh -N -L 18123:localhost:8123 jan@192.168.42.207` in a loop (host: `KIPSCOPE_TUNNEL_HOST`); log in `$TMPDIR/kipscope-tunnel.log`.

**Test database (automated tests):** local ClickHouse with synthetic data:

```sh
docker compose up -d
pnpm --filter @kipscope/server seed:test
```

The seed script refuses to run if `TEST_CLICKHOUSE_URL` and `CLICKHOUSE_URL` name the same host and port (`localhost`, `127.0.0.1` and `[::1]` count as one host).

## Run

```sh
pnpm --filter @kipscope/server dev   # server
pnpm --filter @kipscope/web dev      # UI at http://localhost:5173, proxies /api to the server
```

The UI's dev server proxies `/api` and the live channel to `KIPSCOPE_SERVER_URL` (default `http://127.0.0.1:7310`).

`pnpm smoke` is the crash gate: it loads the running UI in its own headless Chrome (fresh temp profile), clicks through every top-level part at 1440×900 and 1000×557 and fails on a Vite error overlay, uncaught exceptions, console errors or failed module loads. `--url <url>` checks another page, `--preview` the built `apps/web/dist` via `vite preview`. It blocks every write to `/api`, so it never changes the shared workspace.

The server answers only requests whose `Host` names `localhost`, `127.0.0.1` or `[::1]` (or a non-loopback `KIPSCOPE_HOST`) and whose `Origin`, if any, is such a host; other requests get 403. A non-loopback `KIPSCOPE_HOST` logs a warning at start: there is no authentication.

Besides the workspace API the server answers `GET /api/meta` (data source and whether it answers, catalog state, build commit; never the ClickHouse address or credentials) and `GET /api/license` (the repo's `LICENSE` as text). The UI's footer reads both.

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

## Display names

The UI shows short signal names from the project file `kipscope.yaml` in the repo root (keys explained in [kipscope.example.yaml](kipscope.example.yaml)). The shipped rules shorten every smart451 name to the part after the message:

```yaml
display:
  names:
    - match: '^(?<message>[^.]+?)_[0-9A-Fa-f]+h\.(?<signal>.+)$'   # COMBI_412h.V_ANZ -> V_ANZ
      show: '{signal}'
      collision: '{signal} ({message})'
    - match: '^(?<message>[^.]+)\.(?<signal>.+)$'                   # AC_A1.T_SOLL -> T_SOLL
      show: '{signal}'
      collision: '{signal} ({message})'
```

| Key | Meaning |
|---|---|
| `match` | JavaScript RegExp (no flags) on the full source name without data reference; its named groups feed the templates |
| `show` | Shown name, `{group}` inserts a named group; renders empty → full name |
| `collision` | Optional; used instead of `show` when different signals would show the same name (`V_ANZ (COMBI)`) |
| `rename` | Map full source name → shown name (`COMBI_412h.V_ANZ: Speed`) |

- Rules run in order, the first whose `match` finds the name wins; no match shows the full name.
- `rename` beats every rule and gets no collision suffix.
- Collisions are checked over the whole catalog: rule-made names take their `collision` suffix; names still shared fall back to the full name (logged as `warn`).
- Only the UI changes: explorer, legend, values window and drag ghost show the short name; hover card and name tooltips show the full name; search matches short name, message and full name. IDs, API, CLI and workspace keep full names.
- `KIPSCOPE_PROJECT_FILE` points to another file (relative to the repo root); it must then exist. Without it a missing `kipscope.yaml` means full names.
- Restart the server after editing the file. An invalid file (YAML syntax, unknown key, bad regex, unknown group in a template) stops the server with one line per problem.

### Diagnostic catalogs

Decoded diagnostic readings (`BMS.soc`, `BMS.cell_voltage.001`, …) have no DBC entry. `KIPSCOPE_DIAG_CATALOGS` lists the decoder's `.manifest.json` files (comma-separated, relative to the repo root; default smart451's `bms-live.manifest.json`); the names file `<name>.names.toml` next to each manifest maps fields to signal names as the decoder does. Each matching signal gets its unit, kind and state names from the catalog, so readings with one unit share an axis. A DBC entry wins over a catalog, an earlier catalog over a later one (one warning per load). A broken manifest is skipped and a missing names file falls back to catalog names, each with a warning; the server always starts. Both files are read on every catalog load. Invalid sentinels are carried but never treated as SNA (D-061).

### Signal groups

`display.groups` sorts the explorer into collapsible groups. The shipped rules group by sending ECU, the transmitter of the signal's `BO_` line in the DBC; h-can.dbc names no sender for the CPC and PNHV messages, so a fallback takes the prefix:

```yaml
display:
  groups:
    - group: '{sender}'               # BO_ 1042 COMBI_412h: 8 CGW -> CGW
    - match: '^(?<ecu>CPC|PNHV)_'     # CPC_448h.PTC_HV_Volt -> CPC
      group: '{ecu}'
```

| Key | Meaning |
|---|---|
| `match` | Optional JavaScript RegExp (no flags) on the full source name; its named groups feed `group`. Absent → the rule applies to every signal |
| `group` | Group name; `{sender}` inserts the DBC sender (blank for `Vector__XXX` or without DBC entry), `{ecu}` a named group of `match` (none may be called `sender`) |

- Rules run in order; the first rule that matches and renders non-blank wins. Unlike `names`, a blank render (no sender) falls through to the next rule.
- Signals no rule names go to `Other`, always last.
- Empty search: all groups collapsed, alphabetical. While searching: only groups with a hit, open, ordered by their best hit (`Other` still last); click a header or press Enter on it to toggle. Enter in the search adds the first row shown.
- Without `groups` the list is flat. Restart the server after editing the file.

### Measurement info

The optional `measurement` section of the same file gives the measurement info the footer shows at start (revision 0). The shipped file sets only the object:

```yaml
measurement:
  name: Testfahrt A9      # ≤ 120 characters
  object: smart451        # ≤ 120 characters, the vehicle or device under test
  meta:                   # ≤ 8 entries, in file order
    driver: Jan           # key ≤ 40 characters, starts with a letter; value ≤ 200 characters
```

CLI commands (`measurement …`, see [CLI](#cli)) change it while the server runs and win until the next restart; nothing writes the file back.

## Check

```sh
pnpm check   # all three below; exits non-zero on the first failure
pnpm build   # typecheck (+ web bundle)
pnpm test    # needs the seeded test database (see Data sources)
pnpm lint    # pnpm format to fix
```

## CLI

`kipscope` controls the open workspace through the server's HTTP API (spec [cli](openspec/specs/cli/spec.md)). Run it from the repo root while the server runs:

```sh
node apps/cli/src/main.ts --help
node apps/cli/src/main.ts state
```

Server: `--server URL` (an `http://` or `https://` URL), else `KIPSCOPE_URL`, else `http://localhost:7310`. Global options anywhere on the line: `--wait` (block until an open UI rendered the command), `--timeout DURATION` (default `30s`), `--pretty`, `--help`; `--` ends options.

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
| `measurement name TEXT` | `measurement.set` name (`""` clears) |
| `measurement object TEXT` | `measurement.set` object (`""` clears) |
| `measurement meta KEY VALUE` | `measurement.setMeta` (`""` removes the entry) |
| `measurement clear` | `measurement.clear` |
| `command JSON` | the JSON as is (no anchors, names or REFs resolved) |
| `view save TITLE [--name N] [--note TEXT] [--overwrite]` | `POST /api/views`: saves the workspace as view N (default derived from TITLE); `data.view`, `revision` |
| `view open NAME` | `POST /api/views/open`: one command (`accepted`, `revision`, `data.report` of missing or left-out signals); honours `--wait` |
| `view delete NAME` | `DELETE /api/views/NAME` |
| `view import FILE [--name N] [--overwrite] [--open]` | `POST /api/views/import` with FILE's text (YAML or JSON, at most 256 KiB; an unreadable or larger FILE is a usage error) |

Reads: `state`, `search QUERY… [--limit N]`, `extent SIGNAL`, `value SIGNAL TIME [--mode line|step]`, `wait [REVISION]`, `view list`, `view export NAME [--out FILE]` (prints the view's YAML text; with `--out` writes FILE and prints `data {name, path, bytes}`), `view link [--page URL]` (the `#view=` link of the open workspace that the UI's "Copy link" gives, as `data {url, chars}`; `--page` is the UI page address, default the server address).

Each call prints one JSON line (`ok`, `outcome`, `exitCode`, and where they apply `accepted`, `command`, `revision`, `created`, `createdWindow`, `render`, `data`, `local`, `error`), except a successful `events list --table` and `view export NAME` without `--out`; a failure also prints one line to stderr. `local` holds times as local wall time with offset.

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

## License

[Attribution Assurance License](LICENSE) (SPDX `AAL`). © 2026 Jan Kipping, Agentic engineer · [kipp.ing](https://kipp.ing). The app shows `KIPscope · kipp.ing · AAL` in its footer (name and profession in the `kipp.ing` tooltip) and the full attribution at the end of `kipscope --help` and in the server start log. The GPG-signed license text is [LICENSE.asc](LICENSE.asc); verify with `gpg --import KEYS.asc && gpg --verify LICENSE.asc` (key `1E3BF6DE3CC6227749622E8EA53393CE9B74E4F7`).
