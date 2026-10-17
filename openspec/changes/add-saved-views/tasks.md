# Tasks

Build after `add-gap-display` has landed (shared files `packages/shared/src/index.ts`, `apps/web/src/api.ts`, `apps/cli/test/helpers.ts`, `cli.test.ts`; design "Shared files with parallel changes"). Jan answered „all recommended" (S-1 … S-4 as recommended; S-3 (b) applied in round 2). Every task has its own files; all build in one round against the interfaces pinned in design V1–V8. Group 1 lands the types the others import; engineers of groups 2–4 may stub them until it is in. The tester writes group 5 test-first, in parallel. A second round only for findings.

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

Round 2 (S-3 (b) and round-1 findings; design "Round-2 defaults"). Disjoint write areas; 3.3 and 3.4 may stub each other's helper until both land:

- 1.3: `packages/shared/src/workspace.ts`
- 2.1 (reopened), 2.3: `apps/server/src/workspace.ts`, `main.ts` (2.1); `views.ts`, `routes/workspace.ts` (2.3)
- 3.3: `apps/web/src/views/model.ts` (new), `ViewsMenu.tsx`, `SaveForm.tsx`, `views.css`, `bar/bar.css`, `bar/OptionBar.tsx`
- 3.4: `apps/web/src/views/notice.ts`, `App.tsx`
- 4.2: `apps/cli/src/views.ts`, `args.ts`, `README.md`
- 5.2 (reopened), 5.5: `apps/server/test/persist.test.ts`, `views.http.test.ts`, `packages/shared/test/apply.test.ts`
- 5.6: `apps/web/test/views.test.ts` (new)
- 5.7: `apps/cli/test/args.test.ts`, `cli.test.ts`

Round 3 (lead's decisions on round-2 findings; design "Round-3 decisions"). Disjoint write areas; 3.4 and 3.5 share no file, 1.4 owns the three link call sites:

- 1.4: `packages/shared/src/views.ts`, `apps/web/src/views/link.ts`, `apps/cli/src/views.ts`
- 3.4 (still open): `apps/web/src/live.ts`, `App.tsx`, `views/notice.ts`
- 3.5: `apps/web/src/bar/OptionBar.tsx`, `bar/bar.css` (and a new `bar/OverflowMenu.tsx` if the engineer wants one)
- 5.8: `packages/shared/test/views.test.ts`, `apps/cli/test/cli.test.ts`, `apps/web/test/viewlink.test.ts`, `livestate.test.ts`

## 1. packages/shared

- [x] 1.1 View document (V1): constants, `ViewDoc`, `ViewWindowDoc`, `ParsedView`, `ViewSummary`, `SaveViewRequest`, `ImportViewRequest`, `parseViewDoc` (version check first, zod with `TimeInput`, unknown-key warnings), `workspaceToView`, `viewName`, `encodeViewLink` / `decodeViewLink` (`CompressionStream("deflate-raw")`, base64url without padding, inflated size ≤ `MAX_VIEW_BYTES`); export from `index.ts`. Verify: `pnpm --filter @kipscope/shared build && pnpm --filter @kipscope/shared test`; scenarios "Workspace to document and back", "Nanoseconds survive", "Versions and keys", "Names from titles", "Link codec".
- [x] 1.2 Workspace and commands (V2): `OpenView`, `Workspace.view`, commands `view.open` and `view.markSaved`, error codes `invalid_view`, `unsupported_version`, `catalog_unavailable`, `OpenReport` and `CommandResult.report`, `ApplyContext.catalogReady`, `WorkspaceSchema`; `applyCommand` for both commands in V2's order (IDs continue, same rules as `window.addSignal`, linked ranges aligned, events-line signals unchecked) and the modified flag. Verify: scenarios "Missing and skipped signals reported", "Linked ranges aligned", "Modified flag".

## 2. apps/server/src

- [x] 2.1 State file (V4): `Config.stateDir` (`KIPSCOPE_STATE_DIR`, default `<repo root>/.kipscope`); `persist.ts` with `loadState` (valid / missing / broken → `workspace.bad.json`) and `StatePersister` (500 ms trailing debounce, `flush`, tmp + rename, one warning per failure streak); `WorkspaceStore` options `initial` and `beforeOpen`; `main.ts` restores at start (round 2, S-3 (b): the restored workspace whole, measurement included; the project file's measurement only for a fresh workspace; a restore never sets `view.modified`; drop today's `restore(initial, measurement)` override), subscribes the persister, flushes on SIGINT/SIGTERM, wires `catalogReady`. Verify: scenarios "Restart keeps the workspace", "Debounced, atomic writes", "Broken state file", "Restored measurement wins"; then "Dev server restart" (with the measurement) by hand.
- [x] 2.2 View store and routes (V5, V6): `ViewStore` (name check before any path, synchronous atomic YAML writes, list with errors, `_previous` last), the six routes with their codes, save = snapshot + write + `view.markSaved` in one tick, open by name reads before executing, `beforeOpen` writes `_previous` for a workspace with windows; `AppDeps.views?`. Verify: every `apps/server/test/views*.ts` scenario; on the dev server "Display names are not references" (curl).

## 3. apps/web/src

- [ ] 3.1 Calls, links and start-up (V7): view calls in `api.ts` (appended); `views/link.ts` with `startupView`, `cleanAddress`, copy-link; `App.tsx`: start-up open once connected and the catalog loaded, `history.replaceState`, `document.title`, an info tone for the strip message used by the open notice. Verify: `pnpm --filter @kipscope/web test`; scenarios "Start-up from a link", "Link in a second browser".
- [ ] 3.2 Views menu and title (V7): Views button and title (240 px, `•`, note tooltip) at the start of the top row; menu with save form, list, Download, Delete with inline confirm, Before last open, Import file…, Copy link; Ctrl/Cmd+S and the save entries as changed in round 2 (task 3.3); "Replace?" on 409; `views.css` with the D-055 tokens; if `add-guidance` has landed: tooltips from `help/hints.ts` and the manual's "Save and share" section. Verify: scenarios "Title and modified dot", "Top row stays one line", "Save twice under one title", "Open notice names missing signals", "Download and import in the UI", "Open on real data".

## 4. apps/cli/src

- [ ] 4.1 View forms (V8): `view list|save|open|delete|export|import` with their options; `open` as a command result with `--wait`; export prints raw YAML or writes `--out`; import reads FILE (≤ 256 KiB, else usage); usage text; README CLI table and reads line. Verify: `pnpm --filter @kipscope/cli test`; scenario "Export to a file on real data".

## 5. Tests (tester, test-first)

- [x] 5.1 Shared: `views.test.ts` ("round-trips a workspace through a view document", "keeps times exact to the nanosecond", "reads versions and unknown keys", "derives file names from titles", "encodes views into short links" with a synthetic 17-window / 66-entry / 44-ID document); `apply.test.ts` ("opens a view with missing and skipped signals", "aligns ranges of a linked view", "marks the open view modified").
- [x] 5.2 Server: `views.test.ts` ("writes the canonical YAML form"); `views.http.test.ts` (temp state dir; "saves, lists and overwrites views", "refuses names that are not file-safe", "lists a broken file with its error", "deletes a view", "opens a view as one command", "refuses to open before the catalog loads", "keeps the workspace before the last open", "serves a view file for download", "imports YAML and JSON", "stores no credentials and no internal IDs", "opens a view through the command endpoint"); `persist.test.ts` ("restores workspace and revision", "writes once after the last change" on a fake clock, "moves a broken state file aside", "keeps the restored measurement" (round 2: replaces "takes the measurement from the project file", line 198; two starts of `main.ts`, with and without the state file, per workspace-state "Restored measurement wins")).
- [x] 5.3 CLI: `helpers.ts` gives the test app a `ViewStore` on a temp dir; `args.test.ts` › "maps the view forms"; `cli.test.ts` › "saves, lists and opens views" (own `describe`); `process.test.ts` › "exports a view as YAML text" (success and failure).
- [x] 5.4 Web: `viewlink.test.ts` › "reads a view from the address".

## Round 2 (2026-10-17)

- [x] 1.3 Shared (V2 round 2): `view.open`'s `name` is `z.string().regex(VIEW_NAME).optional()`. Verify: `pnpm --filter @kipscope/shared test`; scenario "No view name through the command endpoint" (applyCommand part).
- [x] 2.3 Server (V2, V6 round 2): `routes/workspace.ts`: `POST /api/commands` answers 400 `invalid_command` for `view.open` with `name`; `views.ts` `parseViewText`: `doc.toJS({ maxAliasCount: 100 })` in `try`, a throw → `{ ok: false, message }` (import 400 `invalid_view_yaml`, list `error`, open by name 422 `invalid_view`). Verify: scenarios "No view name through the command endpoint", "Alias bomb refused".
- [ ] 3.3 Web menu and top row (V7 round 2): `views/model.ts` (`titleMinChars`, `saveEntries`, `saveTarget`, `rowDetails`, `existingTitle`), used by the components; "Save" / "Save as…" / "Save view…" and Ctrl/Cmd+S per `saveTarget`; row actions as an overlay on the title line; title `min-width: min(n, 10)ch` and the give-way steps (`.long` threshold re-measured, icon-only Views button below a second threshold; widths in a CSS comment). Verify: scenarios "Top row stays one line", "Save the open view in place", "Save onto another view's title", "Row actions keep the meta line".
- [ ] 3.4 Web strip and tab title (V7 round 2): `views/notice.ts` gains `documentTitle`, `titleParts`, `nextStrip`, `openedElsewhere`; `App.tsx` uses them: one strip slot where any new error or notice replaces the old one, `"<title>" opened elsewhere` for a foreign `view.open` push. Verify: scenarios "Open clears an older message", "Opened elsewhere", "Title and modified dot", "Bookmark by name".
- [ ] 4.2 CLI `view link [--page URL]` (V8 round 2): document as "Copy link", `encodeViewLink`, `data {url, chars}`; usage text and README row. Verify: scenario "Link of the open workspace"; then the UI user's "Link in a second browser" and "Download and import in the UI" paths.
- [x] 5.5 Tests server/shared: `views.http.test.ts` › "refuses a view name through the command endpoint", "refuses an alias bomb" (10 levels × 10 aliases, also as a file in the views dir); `apply.test.ts` › "refuses a view name that is not file-safe".
- [ ] 5.6 Tests web: `apps/web/test/views.test.ts` (new) › "titles the top row and the browser tab", "keeps the title at least ten characters", "saves the open view in place", "reads a 409 into a Replace prompt", "describes a menu row", "builds the open notice", "clears an older message on open", "notices an open from elsewhere" (pure helpers of `views/model.ts` and `views/notice.ts`, signatures in design V7).
- [ ] 5.7 Tests CLI: `args.test.ts` › "maps the view forms" gains `view link` (default page = `--server`); `cli.test.ts` › "prints a link to the open workspace".

## 6. Lead

- [ ] 6.1 `.gitignore` gains `.kipscope/` (S-1 a); manual checks of design "Manual checks" (restart with the measurement; clipboard paste and file dialogs); ledger: the S-3 entry superseding D-051's „commands win until restart" (design "Ledger entry on archive"); status.md: drop "Workspace lives in server memory" from Known limitations.

## Round 3 (2026-10-17)

- [ ] 1.4 One link encoder (V1, V7, V8 round 3): `views.ts` gains `linkViewDoc(ws)` (title = view title ?? measurement name ?? "Shared view"; the open view's note when set; no `saved`) and `viewLinkUrl(ws, page)`; `link.ts`'s `viewLink` and the CLI's `link` case call `viewLinkUrl` and build no document of their own. Verify: `pnpm --filter @kipscope/shared test && pnpm --filter @kipscope/cli test && pnpm --filter @kipscope/web test`; `grep -rn "encodeViewLink(" apps/web/src apps/cli/src` prints nothing; scenario "Same link from web and CLI".
- [ ] 3.5 Top-row overflow (V7 "Top-row overflow rule"): step (4) as a `top-row` container query: below the measured threshold T the in-row Digits and "+ Values window" hide and a "⋯" button (last item, `aria-label` "More controls", `aria-haspopup="menu"`, `aria-expanded`) opens a menu with the same controls; keyboard per V7. Measure T and the row width after the move (≤ 728 px, else "Span" joins per V7) in Chrome at 1000×557 with the sidebar open and a 120-character modified title, and write both into the `bar.css` comment (replacing the round-2 "still wraps" line). Verify: `pnpm --filter @kipscope/web build`; scenarios "Top row stays one line" (both viewports), "Overflow menu by keyboard". 3.3's top-row part is done when these pass.
- [ ] 5.8 Tests (test-first): `packages/shared/test/views.test.ts` › "builds the link document"; `apps/cli/test/cli.test.ts` › "prints the same link as Copy link" (a saved view with a note, opened; `data.url` equals `viewLinkUrl(<GET /api/workspace>, "http://127.0.0.1:5173/")`; decoded note present, `saved` absent); `apps/web/test/viewlink.test.ts` › "copies the shared link"; `apps/web/test/livestate.test.ts` › "keeps the last view open across later pushes".

3.4 stays open for round 3 with design V7 "How a tab learns a push was not its own" (`live.ts` `lastOpen`, own-open bookkeeping in `App.tsx`, a foreign open replaces the strip item); verify with scenario "Opened elsewhere" as changed in round 3.
