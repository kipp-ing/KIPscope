# Tasks

Precondition: `add-cursors` is archived (its code is already in the tree).

Grouped by write area (docs/team.md). All groups run in parallel against the interfaces pinned in design.md S1–S4; no task waits for another task's code. Disjoint files:

- 1.1: `packages/shared/src/localtime.ts`, `packages/shared/src/index.ts`, `packages/shared/package.json`
- 2.1: `apps/cli/package.json`, `apps/cli/tsconfig.json`, `apps/cli/src/main.ts`, `apps/cli/src/output.ts`, `apps/cli/src/client.ts`, `apps/cli/src/wait.ts`, `pnpm-lock.yaml`
- 2.2: `apps/cli/src/args.ts`, `apps/cli/src/refs.ts`
- 2.3: `apps/cli/src/run.ts`, `README.md` (new section "CLI" only)
- 3.x (tester): `packages/shared/test/localtime.test.ts`, `apps/cli/test/*`, `apps/web/test/axis.test.ts`

No `apps/server` or `apps/web` source changes (design L4, Goals). Test names are those the specs cite as evidence. The tasks assume the recommended answers to design "Open questions for Jan" 1–9; each of 1–5 and 7–9 would change one function, 6 (anchors in the command model) would move 2.2's anchor resolution into `packages/shared` and `apps/server`.

## 1. packages/shared

- [x] 1.1 Add `src/localtime.ts` with `formatLocal`, `parseTime` and `parseDuration` exactly as in design S1 and L5 (bigint fractions, round-trip check for local wall times, refusal of DST gaps and folds naming both offsets, bounds `TIME_MIN … TIME_MAX`, `m` refused), export it from `src/index.ts`, and change the package's test script to `TZ=Europe/Berlin vitest run --passWithNoTests`. Verify `packages/shared/test/localtime.test.ts` from 3.1 passes and the existing shared tests stay green.

## 2. apps/cli

- [x] 2.1 Scaffold and transport: `package.json` (`@kipscope/cli`, `"bin": {"kipscope": "src/main.ts"}`, dependency `@kipscope/shared: workspace:*`, scripts `build: tsc -p .` and `test: TZ=Europe/Berlin vitest run --passWithNoTests`), `tsconfig.json` like the server's, then `pnpm install`. `src/main.ts` (shebang, `process.exitCode = await run(...)`), `src/output.ts` (S2: `EXIT`, `Outcome`, `RenderWait`, `CliOutput`, `CliError`, `printOutput` with the stderr line of L3), `src/client.ts` (S3: one deadline per call via `AbortSignal.timeout(remainingMs)`, status and transport mapping of L3), `src/wait.ts` (S3, the L4 loop with `POLL_MS = 100`, `NO_UI_GRACE_MS = 2000`). Verify `apps/cli/test/wait.test.ts` from 3.2 passes and `pnpm build` type-checks `apps/cli`.
- [x] 2.2 Grammar and references: `src/args.ts` (S3 `parseArgs` and `USAGE` for every form of design L2, global options anywhere, `-<digit>` tokens as values, `--from` without `--to`, empty `window display`, non-integer PX and unknown forms as usage errors; times via `parseTime`, durations via `parseDuration`, anchors per L5) and `src/refs.ts` (S3 `resolveTime`, `resolveSignal`, `resolveRef`, `resolveCommand` per L6, memoised `workspace()` read). Verify `apps/cli/test/args.test.ts` from 3.2 passes.
- [x] 2.3 Glue and docs: `src/run.ts` (S3 `run`: `--help` → `USAGE`; reads `state`, `search`, `extent`, `value`, `wait` with `unknown_revision`; commands with `--wait`; `local` times per S2 with `formatLocal(t, {offset: true})`; every `CliError` and unexpected error into one `CliOutput`, never throwing). Add a section "CLI" to `README.md` with how to run it, the forms of L2, the exit-code table of L3 and two examples. Verify `apps/cli/test/cli.test.ts` and `apps/cli/test/process.test.ts` from 3.3 pass, and `node apps/cli/src/main.ts --help` prints the usage.

## 3. Tests (tester, test-first from the specs)

- [x] 3.1 `packages/shared/test/localtime.test.ts`: "parses ns, ISO with zone and local wall time", "refuses ambiguous and nonexistent local times", "round-trips local times with offset to the nanosecond", "parses durations exactly and refuses ambiguous units", with the values of the `cli` spec scenarios "Equivalent forms", "DST change", "Round trip and UI format" and "Duration forms". Verify they fail before 1.1 and pass after.
- [x] 3.2 `apps/cli/test/helpers.ts` per design L8 (in-process server with stub source and catalog, fake browser over the global `WebSocket`, captured `run` I/O); `apps/cli/test/args.test.ts` › "maps every command form to its command" (every row of design L2, compared via `resolveCommand` with lookups that throw); `apps/cli/test/wait.test.ts` › "reports no_ui after 2 s without a client, not after a 1 s reconnect gap" (fake clock and status sequence; also complete, error and timeout endings). Verify they run against 2.1/2.2.
- [x] 3.3 `apps/cli/test/cli.test.ts` with every test the `cli` spec names (server address, usage, the exit codes 1, 2, 4, 7, windows, signals, references, search and extent, state, anchors, cursors, raw command, waiting 0/5/6/4 and later revision, value) and `apps/cli/test/process.test.ts` › "prints one JSON line on stdout and nothing on stderr", "prints the reason of a failure on stderr", "exits 3 when the server is unreachable" (spawned `node apps/cli/src/main.ts` with `TZ=Europe/Berlin`). Verify `pnpm build && pnpm test && pnpm lint` pass after group 2.
- [x] 3.4 `apps/web/test/axis.test.ts` › "formats local times like the shared formatLocal": `formatFull(t) === formatLocal(t)` for times with 0, 3, 6 and 9 fraction digits, both instants of the 2026-10-25 02:30 fold, 1900-01-01 and 2262-04-10. Verify it passes after 1.1.

## 4. Checks against the dev server (UI user; the lead runs the dev server and the tunnel)

- [x] 4.1 Run the CLI evidence commands of the `cli` spec against the dev server and report the output: `kipscope search volt --limit 3` (scenario "Ranked search on real data") and `kipscope value smart451/COMBI_412h.V_ANZ "2026-10-13 15:08:00.1435"` (scenario "Local time on real data"). Verify both print the expected values.
- [ ] 4.2 UI checks with Chrome open on real data, one screenshot each next to the CLI output: "Window from the CLI in the open UI" (with "Bare name on real data"), "Same times as the UI", "Relative move in the open UI", "Real UI" (complete, then `no_ui` with the tab closed), and the `workspace-state` scenarios "Rendered after load" and "Revision without visible change". Report `render.waitedMs` of each `--wait` call. Verify every scenario is reported as fulfilled or not, with its screenshot.

## Workflow follow-up

- Before archive: copy the project-wide conventions of design L3 (exit codes), L4 (wait polls render status, any UI decides) and L5 (time grammar, DST refusal, process time zone) into `docs/decisions.md` (openspec config `archive.guidance`).
- Jan answers or confirms "Open questions for Jan" 1–9; an answer other than the recommendation becomes a follow-up task.
