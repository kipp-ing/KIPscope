# Tasks

Every task has its own files; all build in one round against the interfaces pinned in design F1–F8. Group 1 lands types the others import; engineers of groups 2–4 may stub them until it is in. The tester writes group 5 test-first, in parallel. Group 6 is the lead's. Open questions Q1–Q9 are built as recommended unless Jan answers otherwise before the round (Q4 "no" drops the parts marked Q4).

- 1.1: `packages/shared/src/meta.ts` (new), `workspace.ts`, `apply.ts`, `index.ts`
- 2.1: `apps/server/src/meta.ts` (new), `app.ts`, `main.ts`
- 2.2: `apps/server/src/project.ts`, `workspace.ts`, `kipscope.example.yaml`
- 3.1: `apps/web/src/footer/items.ts`, `footer/fit.ts`, `footer/useMeta.ts` (all new), `api.ts`
- 3.2: `apps/web/src/footer/StatusBar.tsx` (new), `App.tsx`, `styles.css`
- 4.1: `apps/cli/src/args.ts`
- 5.1: `packages/shared/test/*`, `apps/server/test/*`, `apps/cli/test/*`
- 5.2: `apps/web/test/footer.test.ts` (new)
- 6.1: `README.md`

## 1. packages/shared

- [ ] 1.1 Attribution, meta and measurement types (F1, F2, F6):
  - `meta.ts`: `ATTRIBUTION`, `attributionText()`, `CatalogState`, `ServerMeta`.
  - `workspace.ts`: measurement limits and `MEASUREMENT_KEY`, `MeasurementEntry`, `Measurement`, optional `Workspace.measurement`; commands `measurement.set`, `measurement.setMeta`, `measurement.clear`; `CommandErrorCode` `measurement_limit`.
  - `apply.ts`: the three commands with normalisation (empty fields, meta and measurement removed).
  - `index.ts`: export `meta.ts`.
  - Verify: scenarios "Set, replace and clear", "Set without a field", "Over the limits", "Absent by default" (shared test part); `pnpm --filter @kipscope/shared build`.

## 2. apps/server/src

- [ ] 2.1 Meta and license routes, wiring (F2):
  - `meta.ts`: `readBuildInfo`, `PING_TIMEOUT_MS`, `MetaDeps`, `metaRoutes` (`/api/meta` with single-flight ping and 2 s timeout, `/api/license`).
  - `app.ts`: `AppDeps.meta?`, `AppDeps.licenseText?`; register `metaRoutes`.
  - `main.ts`: ClickHouse client in a variable, unqueued ping, source label, `readBuildInfo(REPO_ROOT)`, `LICENSE` read with warning when missing, `loadProject` (from 2.2) with its `measurement` passed to `WorkspaceStore`, `app.log.info(attributionText())` before listen (Q4).
  - Verify: scenarios "Text served", "File missing", "Foreign host refused", "Reachable source", "Catalog not loaded", "Build info", "Source down", "One ping for concurrent requests", "No credentials", "Start log" (grep part).
- [ ] 2.2 Measurement section of the project file (F7):
  - `project.ts`: `ProjectFile`, `parseProject`, `loadProject`; `measurement` schema with the problem texts of F7; `parseProjectFile` and `loadProjectFile` keep their signatures.
  - `workspace.ts`: `WorkspaceStoreOptions.measurement` sets the state at revision 0.
  - `kipscope.example.yaml`: commented `measurement` section with keys, limits and "commands win until restart"; the header no longer says `display` is the only top-level key. `kipscope.yaml` gets `measurement:` with `object: smart451` only (Jan, Q7).
  - Verify: scenarios "Start value", "Invalid section", "Display rules unchanged", "Documented" (example part).

## 3. apps/web/src

- [ ] 3.1 Footer logic (F3, F5):
  - `footer/items.ts`: `Tone`, `FooterItem`, `MEASUREMENT_CLIP`, `measurementItems`, `footerItems`, `browserZone`, ranks of F3.
  - `footer/fit.ts`: `fitFooter`.
  - `footer/useMeta.ts`: `META_POLL_MS`, `useMeta(connected)`.
  - `api.ts`: `fetchMeta`.
  - Verify: scenarios "Items from the workspace", "Empty state" (function part), "Items from meta", "Unhappy states", "Stale and missing meta", "Drop order", "Message beats meta", "Measurement outlives automatic items".
- [ ] 3.2 Status bar (F1, F3, F5):
  - `footer/StatusBar.tsx`: status, message, measurement and automatic items, attribution group with both links and the hidden-items tooltip; measuring copy, `ResizeObserver`, `fitFooter`; drag overlay with the left part kept in place.
  - `App.tsx`: the strip becomes `<StatusBar>` with `workspace?.measurement`, `useMeta(live.connected)`, the existing `dropRef`, `data-drop` and message state.
  - `styles.css`: `.status-strip` `min-height` and `flex-wrap`, attribution 11 px `--muted` at the right end, items 12 px, drag overlay.
  - Verify: scenarios "Order in the bar", "Markup", "Hidden items in the tooltip", "Empty state" (markup part) by test; UI scenarios "Visible while scrolling", "No window", "One line at the usual sizes", "Links in the browser", "Right end, smaller and muted", "Error message at 1000×557", "Narrow viewport", "Set from the CLI on real data", "Pushed and rendered", and `workspace-layout` "Idle strip", "Error in the strip", "Drag start moves nothing", "Drop on the attribution", "Compact bars".

## 4. apps/cli/src

- [ ] 4.1 Measurement forms and help line (F8):
  - `args.ts`: `measurement name|object|meta|clear` forms with usage errors for missing or extra arguments; help text lists them and ends with `attributionText()` (Q4).
  - Verify: scenarios "Forms map to commands", "Over HTTP", "Help lists the forms", "Help ends with the attribution", "Results unchanged", "Read by the CLI".

## 5. Tests

- [ ] 5.1 Shared, server and CLI tests, test-first from the scenarios:
  - `packages/shared/test/apply.test.ts`: "sets, replaces and clears measurement info", "rejects measurement info beyond its limits"; `packages/shared/test/meta.test.ts`: `attributionText()` equals the text of design F1.
  - `apps/server/test/meta.http.test.ts` (new): every test named in `app-footer` for the server, with fake `MetaDeps` (ping that resolves, rejects, never settles, takes 100 ms and counts calls) and the test database's catalog.
  - `apps/server/test/project.test.ts`: "reads the measurement section", "refuses an invalid measurement section"; `apps/server/test/workspace.http.test.ts`: "starts with the measurement from the project file".
  - `apps/cli/test/args.test.ts`: measurement forms in "maps every command form to its command"; `apps/cli/test/cli.test.ts`: "ends the help with the attribution", "keeps results one JSON line without the attribution", "sets and reads measurement info over HTTP", form list of "prints the usage with --help".
  - Verify: `pnpm build && pnpm test && pnpm lint` green.
- [ ] 5.2 Web tests, `apps/web/test/footer.test.ts` (new): every test named in `app-footer` for the web; markup tests through `renderToStaticMarkup(createElement(StatusBar, props))`.
  - Verify: `pnpm --filter @kipscope/web test` green.

## 6. Docs (lead)

- [ ] 6.1 `README.md`: the four `measurement` CLI forms in the CLI table, the `measurement` section under "Display names" (or a new "Project file" heading), `/api/meta` and `/api/license` in "Run", and one sentence under "License" that the app shows the attribution in its footer. Verify: scenario "Documented" (`grep -n "measurement" kipscope.example.yaml README.md`).

## Workflow follow-up

- Lead's manual checks 1–5 of design.md.
- Archive after `harden-robustness`; copy D-050 and D-051 (design) into `docs/decisions.md`.
