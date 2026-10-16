# Tasks

Build after `add-gap-display` has landed (shared files `packages/shared/src/index.ts`, `apps/web/src/api.ts`, `apps/cli/test/helpers.ts`, `cli.test.ts`; design "Shared files with parallel changes"). Jan's answers to S-1 … S-4 may change V4 (S-3) or the defaults; the spec is written for the recommended options. Every task has its own files; all build in one round against the interfaces pinned in design V1–V8. Group 1 lands the types the others import; engineers of groups 2–4 may stub them until it is in. The tester writes group 5 test-first, in parallel. A second round only for findings.

- 1.1: `packages/shared/src/views.ts` (new), `index.ts`
- 1.2: `packages/shared/src/workspace.ts`, `apply.ts`
- 2.1: `apps/server/src/persist.ts` (new), `workspace.ts`, `config.ts`, `main.ts`
- 2.2: `apps/server/src/views.ts` (new), `routes/views.ts` (new), `app.ts`
- 3.1: `apps/web/src/api.ts`, `apps/web/src/views/link.ts` (new), `App.tsx`
- 3.2: `apps/web/src/views/ViewsMenu.tsx`, `SaveForm.tsx`, `views.css` (new), `bar/OptionBar.tsx` (and `help/hints.ts`, the manual, if `add-guidance` is in)
- 4.1: `apps/cli/src/views.ts` (new), `args.ts`, `run.ts`, `README.md` (CLI section)
- 5.1: `packages/shared/test/views.test.ts` (new), `apply.test.ts`
- 5.2: `apps/server/test/views.test.ts`, `views.http.test.ts`, `persist.test.ts` (new)
- 5.3: `apps/cli/test/helpers.ts`, `args.test.ts`, `cli.test.ts`, `process.test.ts`
- 5.4: `apps/web/test/viewlink.test.ts` (new)

## 1. packages/shared

- [ ] 1.1 View document (V1): constants, `ViewDoc`, `ViewWindowDoc`, `ParsedView`, `ViewSummary`, `SaveViewRequest`, `ImportViewRequest`, `parseViewDoc` (version check first, zod with `TimeInput`, unknown-key warnings), `workspaceToView`, `viewName`, `encodeViewLink` / `decodeViewLink` (`CompressionStream("deflate-raw")`, base64url without padding, inflated size ≤ `MAX_VIEW_BYTES`); export from `index.ts`. Verify: `pnpm --filter @kipscope/shared build && pnpm --filter @kipscope/shared test`; scenarios "Workspace to document and back", "Nanoseconds survive", "Versions and keys", "Names from titles", "Link codec".
- [ ] 1.2 Workspace and commands (V2): `OpenView`, `Workspace.view`, commands `view.open` and `view.markSaved`, error codes `invalid_view`, `unsupported_version`, `catalog_unavailable`, `OpenReport` and `CommandResult.report`, `ApplyContext.catalogReady`, `WorkspaceSchema`; `applyCommand` for both commands in V2's order (IDs continue, same rules as `window.addSignal`, linked ranges aligned, events-line signals unchecked) and the modified flag. Verify: scenarios "Missing and skipped signals reported", "Linked ranges aligned", "Modified flag".

## 2. apps/server/src

- [ ] 2.1 State file (V4): `Config.stateDir` (`KIPSCOPE_STATE_DIR`, default `<repo root>/.kipscope`); `persist.ts` with `loadState` (valid / missing / broken → `workspace.bad.json`) and `StatePersister` (500 ms trailing debounce, `flush`, tmp + rename, one warning per failure streak); `WorkspaceStore` options `initial` and `beforeOpen`; `main.ts` restores at start (measurement from the project file per S-3 (a), `view.modified` true if that changed it), subscribes the persister, flushes on SIGINT/SIGTERM, wires `catalogReady`. Verify: scenarios "Restart keeps the workspace", "Debounced, atomic writes", "Broken state file", "Measurement from the project file"; then "Dev server restart" by hand.
- [ ] 2.2 View store and routes (V5, V6): `ViewStore` (name check before any path, synchronous atomic YAML writes, list with errors, `_previous` last), the six routes with their codes, save = snapshot + write + `view.markSaved` in one tick, open by name reads before executing, `beforeOpen` writes `_previous` for a workspace with windows; `AppDeps.views?`. Verify: every `apps/server/test/views*.ts` scenario; on the dev server "Display names are not references" (curl).

## 3. apps/web/src

- [ ] 3.1 Calls, links and start-up (V7): view calls in `api.ts` (appended); `views/link.ts` with `startupView`, `cleanAddress`, copy-link; `App.tsx`: start-up open once connected and the catalog loaded, `history.replaceState`, `document.title`, an info tone for the strip message used by the open notice. Verify: `pnpm --filter @kipscope/web test`; scenarios "Start-up from a link", "Link in a second browser".
- [ ] 3.2 Views menu and title (V7): Views button and title (240 px, `•`, note tooltip) at the start of the top row; menu with save form, list, Download, Delete with inline confirm, Before last open, Import file…, Copy link; Ctrl/Cmd+S (direct save for a named open view); "Replace?" on 409; `views.css` with the D-055 tokens; if `add-guidance` has landed: tooltips from `help/hints.ts` and the manual's "Save and share" section. Verify: scenarios "Title and modified dot", "Top row stays one line", "Save twice under one title", "Open notice names missing signals", "Download and import in the UI", "Open on real data".

## 4. apps/cli/src

- [ ] 4.1 View forms (V8): `view list|save|open|delete|export|import` with their options; `open` as a command result with `--wait`; export prints raw YAML or writes `--out`; import reads FILE (≤ 256 KiB, else usage); usage text; README CLI table and reads line. Verify: `pnpm --filter @kipscope/cli test`; scenario "Export to a file on real data".

## 5. Tests (tester, test-first)

- [ ] 5.1 Shared: `views.test.ts` ("round-trips a workspace through a view document", "keeps times exact to the nanosecond", "reads versions and unknown keys", "derives file names from titles", "encodes views into short links" with a synthetic 17-window / 66-entry / 44-ID document); `apply.test.ts` ("opens a view with missing and skipped signals", "aligns ranges of a linked view", "marks the open view modified").
- [ ] 5.2 Server: `views.test.ts` ("writes the canonical YAML form"); `views.http.test.ts` (temp state dir; "saves, lists and overwrites views", "refuses names that are not file-safe", "lists a broken file with its error", "deletes a view", "opens a view as one command", "refuses to open before the catalog loads", "keeps the workspace before the last open", "serves a view file for download", "imports YAML and JSON", "stores no credentials and no internal IDs", "opens a view through the command endpoint"); `persist.test.ts` ("restores workspace and revision", "writes once after the last change" on a fake clock, "moves a broken state file aside", "takes the measurement from the project file").
- [ ] 5.3 CLI: `helpers.ts` gives the test app a `ViewStore` on a temp dir; `args.test.ts` › "maps the view forms"; `cli.test.ts` › "saves, lists and opens views" (own `describe`); `process.test.ts` › "exports a view as YAML text" (success and failure).
- [ ] 5.4 Web: `viewlink.test.ts` › "reads a view from the address".

## 6. Lead

- [ ] 6.1 `.gitignore` gains `.kipscope/` (S-1 a); manual checks of design "Manual checks"; status.md: drop "Workspace lives in server memory" from Known limitations.
