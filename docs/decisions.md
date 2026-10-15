# Decision Ledger

Decisions that don't belong to a single OpenSpec change. Newest first. Never edit past entries; supersede them with a new one.

Format: `## D-NNN: Title (YYYY-MM-DD)`, then context, decision, consequences.

## D-023: Scope of the cursor change (2026-10-15)

- **Decision:** Jan, after approving `improve-signal-explorer`, for change `add-cursors`:
  - **Drag and drop from everywhere:** every place that lists a signal is a drag source (explorer, legend, the cursor value window), and every drop target stays reachable while dragging: "+ New window" stays visible during a drag, and the page scrolls when the pointer nears its edge.
  - **Values only at the cursor:** no value readout on hover. A dedicated value window in the dashboard lists signals with their value at cursor A; in diff mode A, B and Δ (B−A, concept §6). Signals get into it by drag or "Add to", like any window. This also answers concept §13's open question on single-value windows: they show the cursor value.
  - **Option bar:** a bar holds cursor A/B on/off and diff mode, the "Link time axes" toggle (moved out of the top bar) and zoom back / reset zoom.
- **Why:** Jan's words: „lass uns das mit drag drop von überall. und das anzeige fenster nur für den cursor wert. und wir brauchen eine leiste für optionen wie diff cursor." The details are his picks from the lead's options. Supersedes D-018's "hover value readout first".

## D-022: Explorer conventions (2026-10-15)

From the archived change `improve-signal-explorer` (design E1, E2, E9, E10); details there.

- **Search in the browser:** the web loads the whole catalog once (`GET /api/catalog`) and ranks per keystroke with the shared `searchSignals` (exact > prefix > name part > description/alias/unit); the server's `/api/signals` uses the same function. Back to server search beyond about 10k signals.
- **One drag machinery:** drag and drop uses pointer events owned by `App`, never HTML5 drag-and-drop; every new drag source joins it via `onDragStart(source, event)`.
- **"Add to" target:** held by window ID, changed only by the user; a removed target falls back to "New window".

## D-021: Window workflow conventions (2026-10-15)

From the archived change `improve-window-workflow` (design D1–D3, D7); details and alternatives there.

- **Time bounds:** every command and series time lies in 1900-01-01 … 2262-04-11 (int64 ns); the UI clamps every zoom to it. Fixes the unbounded zoom-out that produced "1036 … 3937".
- **Linked ranges:** `workspace.linkTime` (default on) is enforced in `applyCommand`: while linked, `window.setRange` from UI or CLI sets every window; re-linking snaps all windows to the last zoomed one. Turning linking off keeps the current ranges.
- **Moves and colours:** `window.moveSignal` moves (same assignment ID) or copies a signal, or puts it into a new untitled window; each signal's palette index (10 colours) is stored in the workspace and survives moves and reloads.
- **Axes:** one y-axis per unit (D-018), stacked L, R, L2, R2 (D-019); `MAX_UNITS = 4` per window, enforced by `addSignal`/`moveSignal` as `too_many_units` and shown as a refused drop target. A signal without unit counts as its own unit.
- **Names:** untitled windows are "Window <n>" after their stable ID `w<n>`, so names never drift.

## D-020: Explorer drag, keys and stable "Add to" target (2026-10-14)

- **Decision:** Answered by Jan on the spec audit of `improve-signal-explorer`:
  - Explorer rows can be dragged onto windows; a window that would reach a fifth unit is shown as refused, the same rule as for legend drags (D-019).
  - The explorer list is keyboard-driven: `/` focuses the search, arrow keys move, Enter adds, Esc clears.
  - The "Add to" target stays where the user put it; creating, renaming or reordering windows does not move it.
  - `improve-window-workflow` gets its spec brought in line with the code and cheap unit tests for wheel factor, inset alignment and Backspace in text fields before it is archived.
- **Why:** The first three come from the power-user report ([feedback/2026-10-14-power-users.md](feedback/2026-10-14-power-users.md)); "Add to" jumping under the click is a reproduced bug. Jan chose to keep them in scope and record them here.

## D-019: Stacked axes; T_SOLL follows the DBC (2026-10-14)

- **Decision:** Answered by Jan on the spec owners' open questions:
  - More than two units in a window: stacked axes, up to two per side (at most four units), the plot area gets narrower. Every value stays readable.
  - T_SOLL's raw 0 (−40 °C, all data on smart451) is shown as a valid value; the DBC rules (D-010, D-014, D-015) apply unchanged, no per-signal exceptions.
- **Why:** Jan's choice. Organisational note by the lead: the explorer items of D-018 (ranking, highlighting, no cap) are built in their own change `improve-signal-explorer`; content unchanged.

## D-018: Scope of the window-workflow change (2026-10-14)

- **Decision:** Answered by Jan after the power-user exploration ([feedback/2026-10-14-power-users.md](feedback/2026-10-14-power-users.md)):
  - "Same value range" means **same unit**: one y-axis per unit, nothing more.
  - The hover value readout belongs to the cursor change, built there first, since it shares the cursor evaluation of concept §6.
  - The window-workflow change also takes: explorer ranking and match highlighting without a hard cap, stable signal colours across windows, window rename, and window layout with keys (resizable window heights, double-click resets zoom, zoom history back).
- **Why:** Jan's choice; keeps the axis rule simple and stable while zooming.

## D-017: Power-user window workflow (2026-10-14)

- **Decision:** Jan's feedback after testing (overall "already usable"):
  - Signals can be moved between windows, back and forth.
  - Signals with the same value range share one y-axis.
  - Time zoom is shared across windows by default and can be switched off. This supersedes concept §4 "Der Zeitzoom ist je Fenster unabhängig" as the default.
  - The signal explorer is a list with details on hover.
  - The explorer search filters on parts of the input (substring match), not only on whole names.
  - Cursors A/B with differences (concept §6) follow as the next change.
  - Further rounds with power users ("UI nerds") who drive the app and feed findings into the changes.
- **Why:** Jan's words: „Signale zwischen zwei anzeigen hin und her. gleiche signalbereich gleiche achse. gemeinsamer zoom standard aktiv abschaltbar. signalexplorer als liste mit hover infos. bei eingabe in suchliste filtern auch auf teile. diff cursor auch als nächster schritt.“

## D-016: SNA conventions across the API (2026-10-14)

- **Decision:** From `add-sna-handling` design S2–S5: in series payloads `null` means SNA and nothing else (raw `v`, edge neighbors, bucket `mean/min/max`, which are null exactly when a bucket has no valid point; `count` counts valid points, `sna` counts SNA points). SNA is matched in ClickHouse within half a raw step of each SNA code's physical value, so aggregates exclude it at the source. Series requests answer 503 `catalog_unavailable` until the catalog has loaded once, since SNA cannot be recognised without it.
- **Why:** One meaning for `null` keeps server and web consistent; matching in the database avoids transferring raw data; the tolerance guards against float differences without swallowing the neighbouring valid code.

## D-015: "No value" labels do not beat GenSigSNA (2026-10-14)

- **Decision:** Refines D-014's label rule: `VAL_` labels that themselves mean "no value" — `--`, `NO_TEMP_SENSOR` and `RES` (reserved) — do not make a `GenSigSNA` value valid; it stays SNA. The list is fixed in the spec and grows only by decision.
- **Why:** Answered by Jan. Taken literally, D-014 would show raw `FFh` of `TirePress_*`, `T_AUSSEN(_RAW)`, `T_SOLL`, `T_INNEN` and 63 of `FCOD_MOT` as real measurements.

## D-014: SNA exceptions and SNA display (2026-10-14)

- **Decision:**
  - A `VAL_` label with a valid meaning (anything other than `SNA`/`SNV`) beats `GenSigSNA` for that raw value: the value is valid. This supersedes D-010's "on conflict both count as SNA".
  - `GenSigSNA` does not apply to 1-bit signals and to checksum/CRC signals.
  - SNA periods are marked as a thin strip per signal at the bottom of the plot, not as full-height shading.
  - In aggregated views a bucket is marked as SNA from a single SNA point; mean/min/max contain valid points only.
- **Why:** Answered by Jan on the spec owner's open questions for `add-sna-handling`. Taking `GenSigSNA` literally hid valid data: `BS_208h.SZS` "1h" = `OK` (100 %), `BS_328h.BS` brake switch (95.8 %), CRC values (0.2–1.5 %). D-010's core rule stays: SNA is never shown as a valid value.

## D-013: Agent team like PCB-dev (2026-10-14)

- **Decision:** The main session stays lead dev and writes no product code. Spec owner, engineers, tester, UI user, reviewer and pacer work as subagents in rounds, following the PCB-dev placer team. Roles and flow: [team.md](team.md).
- **Why:** Requested by Jan for more speed; parallel builds with independent test, UI and review checks.
- **Consequences:** No test manager (the suite runs in seconds); the pacer also holds the watchdog's stop rules. Only the lead commits.

## D-012: Correction to D-010's evidence; SNA is compared physically (2026-10-14)

- **Decision:** D-010 stands. Its example was wrong: `MS_312h.DNMOT` is not SNA. It is scaled `(1, −127)`, so SNA raw `FFh` is physical 128; the constant −127 is raw 0, a valid value. Correct examples: `COMBI_412h.V_ANZ` (raw `1FFh` → 511 km/h) and `BS_200h.DVL` (raw `3FFFh` × 0.5 → 8191.5 1/min, present in the data). SNA raw values from the DBC are converted with factor and offset (two's complement for signed signals) before comparing with stored values, since the decoder stores physical values (`scaling=True`).
- **Why:** The stored values are physical; comparing raw SNA codes would miss real SNA and hide valid values.

## D-011: Architecture of the skeleton (2026-10-14)

From the archived change [add-timeseries-skeleton](../openspec/changes/archive/2026-10-14-add-timeseries-skeleton/design.md); details and alternatives there.

- **Stack (D1, D2):** TypeScript everywhere in a pnpm monorepo (`packages/shared`, `apps/server`, `apps/web`); Node runs the server's TypeScript directly; Fastify, React, uPlot.
- **Time (D3):** int64 nanoseconds as `bigint`; on the wire `t0` + ns offsets; charts draw offsets from a per-window origin.
- **Resolution (D4):** count decides raw vs. buckets; buckets on the absolute grid `k * width`, width `ceil(L / (target − 1))`; arithmetic mean.
- **Source (D5, D6):** one long-format table via configurable column mapping; catalog in server memory; metadata from DBC files, first file wins.
- **Load (D7):** at most 4 concurrent DB queries; aborts cancel server-side via progress headers + `cancel_http_readonly_queries_on_client_close`.
- **Commands (D8):** all workspace changes are commands (`POST /api/commands`), applied by the pure `applyCommand` in `packages/shared`; state and render acknowledgements over `WS /api/live`.
- **Ports:** server 7310 (8080 is taken on the dev machine), UI 5173.

## D-010: SNA values are never shown as valid (2026-10-14)

- **Decision:** A value the DBC marks as "signal not available" (SNA) must never be displayed, aggregated or evaluated as a valid measurement. SNA comes from the union of the `GenSigSNA` attribute (raw hex) and `VAL_` labels `SNA`/`SNV`; on conflict both count as SNA. `GenSigSNA "0h"` means "no SNA defined" unless a `VAL_` label marks 0 as SNA/SNV. Display: the curve breaks at SNA (never interpolated through), SNA periods are marked; aggregates exclude SNA and show its share.
- **Why:** Fixed requirement from the user. Real data proves the need: `MS_312h.DNMOT` is 100 % SNA (shown as a valid −127 line in the skeleton), `COMBI_412h.V_ANZ` jumps to 511 = SNA. In h-can.dbc, 260 signals carry `"0h"` on counters and states where 0 is valid (`OFF`, `SYNCH_OK`, `0Hz`).

## D-009: No special handling for recording pauses (2026-10-14)

- **Decision:** Lines connect consecutive measured points even across long pauses (e.g. car switched off between drives). No gap detection.
- **Why:** Users select meaningful time ranges; pauses are an artifact of browsing whole days, not of investigations.

## D-008: Commit often (2026-10-14)

- **Decision:** Supersedes the commit timing of D-003. Agents commit after every coherent step without asking; pushing still happens at the latest when the session ends.
- **Why:** User preference: rather too many commits than too few.

## D-007: Real data from carserver sdlog, DBC metadata, local test DB (2026-10-14)

- **Decision:** Supersedes the synthetic-data part of D-006. Development uses the existing ClickHouse `sdlog` on carserver (smart451) via SSH tunnel and a read-only user `letsview`. Signal metadata comes from the CarController DBC files. Automated tests use a local Docker ClickHouse with the same schema and synthetic data.
- **Why:** Real data is available; the database has no metadata tables; carserver is too small (2 GB RAM) and not reproducible enough for test runs.

## D-006: ClickHouse first (2026-10-14)

- **Decision:** The first data adapter targets ClickHouse (local via Docker, synthetic data). ADX follows behind the same adapter interface.
- **Why:** Reproducible locally without cloud access.

## D-005: Server + browser (2026-10-14)

- **Decision:** A server holds workspace state, DB credentials, the data adapters and the CLI endpoint. The browser renders and reports back which state revision it has drawn.
- **Why:** The CLI must control the open view (concept §7) and credentials must stay off the client (§8). Stack is left to the first change's design.

## D-004: Build our own (2026-10-14)

- **Decision:** letsview is a custom build. Grafana, ibaAnalyzer, PlotJuggler and Seeq (concept §11) serve as references only.
- **Why:** Decided by the user; resolves the build/buy question of concept §12.

## D-003: Commit and push at session end (2026-10-14)

- **Decision:** When the user ends a session, agents commit and push without asking.
- **Why:** No uncommitted work lying around between sessions.

## D-002: Minimal AGENTS.md, decisions in a ledger (2026-10-14)

- **Decision:** AGENTS.md only holds rules and links. Decisions OpenSpec doesn't cover (outside a change's design.md) go here. On archive, project-wide decisions from a change's design.md are copied here too.
- **Why:** Keep agent context small; keep decisions findable in one place.

## D-001: OpenSpec, English artifacts (2026-10-14)

- **Decision:** Development is spec-driven with OpenSpec (schema `spec-driven`). Specs, proposals and code are in English. Claude Code is the configured tool (`/opsx:*` commands); `CLAUDE.md` imports `AGENTS.md`.
- **Why:** Spec-driven workflow chosen by the user; English matches code and tooling.
