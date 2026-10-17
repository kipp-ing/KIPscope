# Design

## Context

- **Inputs:** Jan (2026-10-17): „5 yes saving the view somehow necessary. url? shared link? yaml export. we need something." Persona test (docs/feedback/2026-10-17-personas.md): the boss could not hand a view to a colleague or a meeting (no share, export, link, title). Concept §8 (save/load, snapshots, versionable configuration, undo; the saved state lists data reference, signal selection, window layout, time ranges, display options, cursor positions, diff mode and user options; no copy of measured data; no credentials in exported templates). Concept §9 suggests opening an investigation by CLI or link and bookmarks with a note. status.md "Next" item 2.
- **Code today:** `WorkspaceStore` (`apps/server/src/workspace.ts`) holds one `Workspace` in memory; commands go through `POST /api/commands` and the pure `applyCommand` (`packages/shared/src/apply.ts`); every accepted command pushes the state to all tabs over `WS /api/live` with its command type. Signal IDs are `<dataRef>/<name>` (`signals.ts`), stable across display-name changes (D-035/D-036). Times are int64 ns, ISO-8601 via `toIso` exact to the ns. The server already depends on `yaml` 2.8 (project file). The web has no routing; `filedrop.ts` ignores dropped files (H8).
- **Measured:** Jan's workspace before the persona test (17 windows, 66 assignments, 44 signals): `Workspace` JSON 7,846 bytes, deflate-raw 1,044 bytes, base64url ≈ 1,392 characters. A few hours later the dev server answered revision 0 with no windows: the restart had dropped it.
- **Access:** `server-access` (D-046) answers only loopback hosts or the configured `KIPSCOPE_HOST`; requests with a foreign `Origin` are refused; bodies are JSON only.

## Goals / Non-Goals

**Goals:** no work lost on a restart; keep any number of named views; hand a view on as a file or a link; show which view is open; the CLI can do all of it; one format for disk, download, import and link.

**Non-goals:** undo, templates and rebinding, several workspaces, snapshot history, image export, authentication (proposal, "Out of scope").

## The slice and why

| Option | Value for "keep and share" | Cost | In the slice |
|---|---|---|---|
| State file, restored at start | Ends the most common loss (every dev restart); invisible to the user | small: one JSON file, debounce, schema | yes |
| Named views (save, list, open, delete) | Keep many investigations; meeting: open "drive 3" | medium: store, 4 routes, menu | yes |
| YAML file export/import | Hand-over to anyone, mail/chat/git; readable and diffable (concept §8 "versionierbare Konfiguration") | small once the format exists: the stored file *is* the export | yes |
| Self-contained link (`#view=`) | One click for a colleague with KIPscope on the same data; no server write | small: deflate + base64url in shared, start-up hook | yes (S-2) |
| Name link (`?view=name`) | Bookmarks on the same machine | tiny | yes (S-2) |
| Title on screen | Boss: "a title"; context for a meeting | tiny | yes |
| "Before last open" | Opening replaces the one shared workspace; this makes it reversible | tiny: one more file write | yes (S-4) |
| Undo/redo | general safety | medium-large (inverse commands or state history, cursor-drag coalescing) | no |
| Templates/rebinding | other measurement | large (signal mapping UI) | no |
| Several workspaces | links without side effects, LAN use | large (live channel, CLI targeting) | no |
| PNG/PDF | slides | medium (per-window canvas, legends) | no |

The file format is the core: one schema, read and written in `packages/shared` (JSON) and on the server (YAML). Everything else is a thin path to it.

## Decisions

### V1: View document (pinned, new `packages/shared/src/views.ts`)

```ts
export const VIEW_VERSION = 1;
/** Largest view text accepted (YAML or JSON), and largest stored file. */
export const MAX_VIEW_BYTES = 262_144;
export const MAX_VIEW_TITLE = 120;
export const MAX_VIEW_NOTE = 2_000;
/** Signal entries per window in a document (assignments; the workspace limits still apply on open). */
export const MAX_VIEW_WINDOW_SIGNALS = 200;
/** User view names: file-safe, no leading dash, no underscore. */
export const VIEW_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** The store's own view of the workspace before the last open (V5). */
export const PREVIOUS_VIEW = "_previous";
export const PREVIOUS_VIEW_TITLE = "Before last open";
/** Link length above which the UI advises sending the file instead (V8). */
export const MAX_LINK_CHARS = 8_192;

export type ViewWindowDoc =
  | {
      kind: "timeseries";
      title?: string;
      from: string; // ISO-8601 UTC, toIso (exact to the ns)
      to: string;
      mode: DisplayMode;
      envelope: boolean;
      height?: number;
      signals: string[]; // full signal IDs, in window order
    }
  | { kind: "values"; title?: string; mode: ValuesMode; signals: string[] };

export interface ViewDoc {
  kipscope: "view";
  version: 1;
  title: string;
  note?: string;
  /** When it was saved, ISO-8601 UTC to the second; informational. */
  saved?: string;
  /** Data refs of all signals, sorted, unique; informational (V3). */
  data: string[];
  linkTime: boolean;
  cursors: { a?: string; b?: string; diff: boolean }; // ISO-8601 UTC
  digits: Digits;
  measurement?: Measurement;
  events?: { filter?: string; signals?: string[] };
  /** Palette index (0…9) per signal ID; absent entries get the next free colour on open. */
  colors?: Record<string, number>;
  windows: ViewWindowDoc[];
}

export type ParsedView =
  | { ok: true; doc: ViewDoc; warnings: string[] }
  | { ok: false; code: "invalid_view" | "unsupported_version"; message: string };

/** Validates a parsed YAML/JSON value; upgrades older versions (none yet); unknown keys → warnings. */
export function parseViewDoc(data: unknown): ParsedView;
/** The open workspace as a document; IDs, nextId and lastZoomed are not part of it. */
export function workspaceToView(ws: Workspace, meta: { title: string; note?: string; saved?: string }): ViewDoc;
/** File name from a title: NFKD, diacritics dropped, lower case, runs of other characters → "-", trimmed, ≤ 63; "" → "view". */
export function viewName(title: string): string;
/** base64url (no padding) of deflate-raw of the document's JSON; async (CompressionStream). */
export function encodeViewLink(doc: ViewDoc): Promise<string>;
/** Inverse of encodeViewLink up to JSON.parse; rejects bad base64url, bad deflate and > MAX_VIEW_BYTES inflated. */
export function decodeViewLink(code: string): Promise<unknown>;
```

- **Reading** (`parseViewDoc`): not an object or `kipscope` ≠ `"view"` → `invalid_view` "not a KIPscope view"; `version` not a positive integer → `invalid_view`; `version` > 1 → `unsupported_version` "view version N; this KIPscope reads 1"; then zod. Times go through `TimeInput` (ISO or decimal ns, bounds) and come out as `toIso`. Titles trimmed, no control characters; note may hold line breaks. Unknown keys at the top level and in windows, cursors, events and measurement are dropped with one warning each (`unknown key "windows[2].colour" ignored`). Later versions add an upgrade step `vN → vN+1` before the zod parse; v1 has none.
- **Writing** (server): `yaml` `stringify(doc, { lineWidth: 0 })`, keys in the order of `ViewDoc`, absent optional fields omitted. Reading uses `parse(text, { schema: "core" })`: YAML 1.2 core has no timestamp type, so unquoted ISO times stay strings; JSON is valid YAML, so one reader takes both.
- **What is not in it:** measured values, server URL, credentials, IDs of windows and assignments (concept §8). Window and assignment IDs are internal; scripts that need them read `kipscope state` after an open.

Example (the canonical form the tests compare against):

```yaml
kipscope: view
version: 1
title: Hard acceleration, drive 3
note: BLS brake release 2–4 s before V_ANZ rises
saved: 2026-10-17T08:14:03Z
data:
  - smart451
linkTime: true
cursors:
  a: 2026-10-13T13:08:01.5Z
  b: 2026-10-13T13:08:09.25Z
  diff: true
digits: 3
measurement:
  object: smart451
events:
  filter: active changes
  signals:
    - smart451/CPC_168h.IgnCurMode
colors:
  smart451/COMBI_412h.V_ANZ: 0
  smart451/BS_200h.DVL: 1
windows:
  - kind: timeseries
    title: Speeds
    from: 2026-10-13T13:08:00Z
    to: 2026-10-13T13:08:20Z
    mode: line
    envelope: false
    signals:
      - smart451/COMBI_412h.V_ANZ
      - smart451/BS_200h.DVL
  - kind: values
    mode: step
    signals:
      - smart451/COMBI_412h.V_ANZ
```

### V2: Workspace additions and commands (pinned, `packages/shared/src/workspace.ts`, `apply.ts`)

```ts
/** The view the workspace came from or was saved as; absent for a fresh workspace. */
export interface OpenView {
  /** Saved view name; absent when opened from a link that was not saved here. */
  name?: string;
  title: string;
  note?: string;
  /** True after any accepted command other than view.open / view.markSaved. */
  modified: boolean;
}
// Workspace gains:  view?: OpenView;

// Command union gains:
z.object({ type: z.literal("view.open"), view: z.record(z.string(), z.unknown()), name: z.string().max(64).optional() }),
z.object({ type: z.literal("view.markSaved"), name: z.string().regex(VIEW_NAME), title: z.string().trim().min(1).max(MAX_VIEW_TITLE), note: z.string().max(MAX_VIEW_NOTE).optional() }),

// CommandErrorCode gains: "invalid_view" | "unsupported_version" | "catalog_unavailable"

export interface OpenReport {
  /** Window signals the catalog does not know, unique, sorted. */
  missing: string[];
  /** Known signals left out; window = index in the document's windows. */
  skipped: { signalId: string; window: number; reason: "too_many_units" | "signal_limit" | "already_in_window" }[];
  warnings: string[];
}
// CommandResult ok variant gains: report?: OpenReport   (view.open only)

// ApplyContext gains: catalogReady?(): boolean   (absent = ready)

/** zod schema of a whole Workspace (state file, V4); unknown keys rejected. */
export const WorkspaceSchema: z.ZodType<Workspace>;
```

`view.markSaved`'s `name` admits `_previous`? No: only the store writes `_previous`, never through this command.

**`view.open` in `applyCommand`, in this order:**
1. `ctx.catalogReady?.() === false` → fail `catalog_unavailable` (the server answers 503).
2. `parseViewDoc(command.view)` → on failure fail with its code (422).
3. Start from `EMPTY_WORKSPACE`; `nextId` continues from the current state's `nextId`, so an ID is never reused within a server run (a tab's per-window state, e.g. Back history, cannot attach to a different window). Windows get `w<n>`, assignments `a<n>`, in document order.
4. Each window signal, in order: unknown to `ctx.signalExists` → `missing`; already in that window → `skipped already_in_window`; would exceed `MAX_SIGNALS` distinct signals → `skipped signal_limit`; timeseries window that would need a 5th unit (`windowUnits` with `ctx.unitOf`) → `skipped too_many_units`; else added. The same rules as `window.addSignal` (Origin: D-019, workspace-state "Signal limit").
5. `linkTime` true and timeseries ranges differ → every timeseries window takes the first one's range; warning `time axes are linked: ranges aligned to the first window` (keeps the "Linked time axes" invariant).
6. Colours: the document's index for each kept signal when 0…9, else the next one by the existing rule of `window.addSignal`.
7. Cursors, diff, digits, measurement (absent → none), event filter (absent → default; a filter the parser refuses → default and a warning), events-line signals (kept unchecked, they wait quietly as D-064 allows; more than `MAX_EVENT_SIGNALS` → first 8 and a warning).
8. `view = { name, title, note, modified: false }`; `lastZoomed` absent.

The whole open is **one** command and one revision; the state push names `view.open` (the web treats it as a content change, workspace-state "State pushes name their command").

**Modified flag:** `applyCommand` sets `view.modified = true` on the resulting workspace after any accepted command other than `view.open` and `view.markSaved` when a `view` is present. `view.markSaved` changes nothing but `view`.

### V3: References and catalog changes

- Signals by **full ID** `dataRef/name`: the data ref is part of every reference, so a view knows which measurement it reads (concept §8 "Datenreferenz"); display names (`V_ANZ`) are never stored, so a rename in `kipscope.yaml` cannot break a view.
- Time ranges and cursors are **absolute** UTC times, exact to the ns (concept §8 "Originalzeitpräzision").
- `data` in the document is derived and informational: it tells a reader of the file which measurement it needs. Opening never checks it; signals decide.
- A signal the catalog does not know on open (renamed DBC message, other data ref, not recorded yet) is left out and listed in `missing`; the file is never changed by an open. Opening again after the catalog has it brings it back. Rebinding to other names is a template feature (out of scope).

### V4: State file (pinned, new `apps/server/src/persist.ts`; `workspace.ts`, `config.ts`, `main.ts`)

- **Place:** `Config.stateDir` from `KIPSCOPE_STATE_DIR` (relative → against the repo root), default `<repo root>/.kipscope` (S-1). Views in `<stateDir>/views/`, the state file is `<stateDir>/workspace.json`. Directories are created on first write.
- **Content:** `{ "kipscope": "workspace", "version": 1, "revision": <n>, "written": "<ISO UTC>", "workspace": <Workspace> }`, JSON, 2-space indent.
- **Writing:** `StatePersister.subscribe(store)`: after an accepted command, write 500 ms after the last change (trailing debounce, `STATE_WRITE_DELAY_MS = 500`); `flush()` writes at once and runs on `SIGINT` and `SIGTERM` before exit (`node --watch` restarts with SIGTERM). Every write is `writeFileSync(tmp) + renameSync(tmp, path)` in the same directory, so a crash leaves the old or the new file, never half of one. A failed write logs one warning per failure streak and does not affect commands.
- **Restoring:** `loadState(path)`: missing file → fresh workspace (today's start, project file values as now); valid file → `WorkspaceStore` starts at that revision with that workspace, without catalog checks (signals wait like events-line signals); a file that does not parse or fails `WorkspaceSchema` or has another `kipscope`/`version` → renamed to `workspace.bad.json` (replacing an older one), one warning naming the reason, fresh workspace.
- **Project file on restore (D-051, S-3):** D-051 says the project file's `measurement` section „gives the start value, commands win until restart". The spec follows it literally: on restore the measurement comes from the project file as at a fresh start (absent section → none), everything else from the state file; if that changes the measurement of an open view, `view.modified` becomes true. Events-line signals are restored as saved (the project file seeds only a fresh workspace; D-064 has no "until restart").
- `WorkspaceStore` options gain `initial?: { revision: number; workspace: Workspace }` and `beforeOpen?(previous: Workspace): void` (V5). Test apps pass neither and keep running in memory.

### V5: View store and "Before last open" (pinned, new `apps/server/src/views.ts`)

```ts
export interface ViewSummary {
  name: string;
  title: string;
  note?: string;
  saved?: string;
  windows: number;
  /** Distinct signal IDs over all windows. */
  signals: number;
  data: string[];
  /** Set when the file cannot be read or is not a valid view; the other fields are then name-only. */
  error?: string;
}
```
(`ViewSummary` lives in `packages/shared/src/views.ts` with the request types of V6.)

`ViewStore(dir)`: `list()`, `read(name) → text | undefined`, `get(name) → ParsedView | undefined`, `write(name, doc)` (YAML, atomic as V4, synchronous), `remove(name)`, `exists(name)`. Names are checked against `VIEW_NAME` (or equal `PREVIOUS_VIEW`) before any path is built, so no request reaches a file outside `<stateDir>/views/`. `list()` reads every `*.yaml` (≤ `MAX_VIEW_BYTES`), sorted by `saved` descending (no `saved` last), `_previous` always last; a broken file is listed with `error`, never hidden.

**Before last open:** the store's `beforeOpen` hook writes the workspace that `view.open` is about to replace as `_previous` (title `Before last open`, `saved` now), only when it has at least one window. It is overwritten by the next open. It opens like any view; it cannot be the target of a save (name rule) but can be deleted.

### V6: HTTP API (pinned, new `apps/server/src/routes/views.ts`)

All routes sit behind the existing Host/Origin guard and JSON-only rule (D-046); errors use `apiError` (`{ error: { code, message } }`).

| Route | Body | Answer |
|---|---|---|
| `GET /api/views` | – | 200 `{ views: ViewSummary[] }` |
| `GET /api/views/:name` | – | 200 YAML text, `content-type: application/yaml; charset=utf-8`; with `?download=1` also `content-disposition: attachment; filename="<name>.kipscope.yaml"`; 400 `invalid_view_name`; 404 `unknown_view` |
| `POST /api/views` | `SaveViewRequest { title; note?; name?; overwrite? }` | 200 `{ view: ViewSummary; revision }` (the `view.markSaved` revision); 400 `invalid_request` / `invalid_view_name`; 409 `view_exists` |
| `POST /api/views/open` | `{ name }` or `{ view: object }` | as `POST /api/commands`: 200 `CommandResult` with `report`; 404 `unknown_view`; 422 `invalid_view` / `unsupported_version`; 503 `catalog_unavailable` |
| `DELETE /api/views/:name` | – | 200 `{ deleted: name }`; 400 `invalid_view_name`; 404 `unknown_view` |
| `POST /api/views/import` | `ImportViewRequest { text; name?; overwrite?; open? }` | 200 `{ view: ViewSummary; warnings: string[]; opened?: CommandResult }`; 400 `invalid_view_yaml` (YAML/JSON syntax, with line) / `invalid_view` / `unsupported_version` / `invalid_view_name`; 409 `view_exists`; 413 `view_too_large` |

- **Save:** name = `name ?? viewName(title)`; an existing file and `overwrite` not true → 409 with `existing: ViewSummary` in the error. The server takes `workspaceToView(current, { title, note, saved: now })`, writes it synchronously, then executes `view.markSaved` in the same tick, so no command can fall between snapshot and flag. A failed write → 500 `view_io_failed`, flag unchanged.
- **Open by name:** reads and parses the file first (so opening `_previous` reads it before the hook replaces it), then executes `{ type: "view.open", name, view }` through `WorkspaceStore.execute` (so `beforeOpen`, revision and push are the same for every path). `view.open` sent to `POST /api/commands` directly works too (link path of the CLI `command` form).
- **Import:** `text` ≤ `MAX_VIEW_BYTES` UTF-8 bytes; parsed as in V1; stored in canonical form (V1 writing), not as uploaded; then opened when `open` is true.
- `apps/server/src/app.ts`: `AppDeps.views?: ViewStore`; without it the view routes answer 404 (tests that do not need them).

### V7: Web (pinned, new `apps/web/src/views/`; `api.ts`, `bar/OptionBar.tsx`, `App.tsx`)

- **api.ts** (appended): `listViews()`, `saveView(req)`, `openView(body)`, `deleteView(name)`, `importView(req)`, `viewFileUrl(name, download)`.
- **Top row:** after "Signals", a **Views** button (opens the menu) and the **view title**: `workspace.view.title`, at most 240 px and shrinking first when the row is short (`flex: 0 1 auto; min-width: 0`, ellipsis), so the top row stays one line at 1000×557 together with add-guidance's "?" (design-language "One line at both viewports"), a `•` after it while `modified` (tooltip "Changed since saved or opened"), the note as the title's tooltip. No view → nothing. `document.title` = `<title> · KIPscope`, else `KIPscope`.
- **Views menu** (`views/ViewsMenu.tsx`): "Save view…" (`Ctrl+S` / `Cmd+S`), the saved views (title; second line: saved local time, `n windows`, data refs; the open one marked ✓; broken ones greyed with their error), "Before last open" last when present, then "Import file…" and "Copy link". A row click opens the view. On hover a row shows "Download" (link to `viewFileUrl(name, true)`) and "Delete" (inline confirm "Delete? Yes / No").
- **Save form** (`views/SaveForm.tsx`): Title (prefilled with the open view's title, else the measurement name, else empty; required), Note (optional, 3 lines). Save → `POST /api/views`; on 409 the form says `"<title>" exists. Replace?` with "Replace" (resends with `overwrite: true`) and "Cancel". `Ctrl+S` with a named, open view saves at once with `overwrite: true` (no form); without a name it opens the form.
- **Open notice:** after any open, the strip's message slot shows `Opened "<title>"` and, when the report has any, `· n signals not found: <first 3 names>, …` (the ID without its data ref) and `· n left out (limits)`; info tone (not the error colour); click dismisses; tooltip lists all IDs.
- **Link** (`views/link.ts`): "Copy link" → `workspaceToView(current, {title: view?.title ?? measurement name ?? "Shared view"})` → `encodeViewLink` → `${location.origin}${location.pathname}#view=<code>` to the clipboard; notice `Link copied (<n> characters)`; above `MAX_LINK_CHARS` the notice adds `long link: send the file instead`.
- **Start-up:** `startupView(location): { view: unknown } | { name: string } | undefined` and `cleanAddress(location): string` (pure, `views/link.ts`). Once the live channel is connected and the catalog has loaded, `#view=<code>` → `decodeViewLink` → `openView({ view })`; else `?view=<name>` → `openView({ name })`. Then `history.replaceState(null, "", location.pathname)`, so a reload does not open it again over later changes. A bad link or unknown name → error notice, workspace unchanged.
- **Import:** a hidden `<input type="file" accept=".yaml,.yml,.json">`; the chosen file's text → `importView({ text, open: true })`; 409 → the same "Replace?" prompt.

### V8: CLI (pinned, new `apps/cli/src/views.ts`; `args.ts`, `run.ts`, README)

| Form | Request |
|---|---|
| `view list` | `GET /api/views` → `data.views` |
| `view save TITLE [--name N] [--note TEXT] [--overwrite]` | `POST /api/views` → `data.view`, `revision` |
| `view open NAME` | `POST /api/views/open {name}` → like a command: `accepted`, `revision`, `data.report`; `--wait` waits for the render |
| `view delete NAME` | `DELETE /api/views/:name` |
| `view export NAME [--out FILE]` | `GET /api/views/:name`; without `--out` prints the YAML text itself to stdout (the second exception to "one JSON line", after `events list --table`); with `--out` writes FILE and prints the JSON line with `data {name, path, bytes}` |
| `view import FILE [--name N] [--overwrite] [--open]` | reads FILE (≤ `MAX_VIEW_BYTES`, else usage error), `POST /api/views/import` |

Error codes map as today: 4xx → exit 1 `rejected` (`unknown_view`, `view_exists`, `invalid_view`, …), 5xx → exit 7 (`catalog_unavailable`, `view_io_failed`); an unreadable FILE → exit 2 `usage`, nothing sent.

## Questions for Jan

- **S-1 Where views and the state file live.** (a) `.kipscope/` in the repo root, gitignored; `KIPSCOPE_STATE_DIR` moves it. (b) `~/.kipscope/` per user. (c) `views/` next to `kipscope.yaml`, committed with the project. **Recommended (a):** the repo lives on GitHub and views carry measurement names, notes and times; anyone who wants views in git points `KIPSCOPE_STATE_DIR` at a repo of their own. The spec is written for (a).
- **S-2 Which link.** (a) "Copy link" gives the self-contained `#view=` link, and `?view=<name>` works as a bookmark form (no button). (b) Name links only (short, but only on this machine). (c) Self-contained only. **Recommended (a):** the self-contained link is the only one that reaches a colleague while access is local-only; the name form costs a few lines and serves bookmarks. The spec is written for (a).
- **S-3 Measurement after a restart (conflict with D-051).** D-051: „the project file's `measurement` section gives the start value, commands win until restart". With the state file a restart no longer needs to lose anything. (a) Keep D-051 literally: after a restart the measurement comes from the project file, everything else is restored (spec as written). (b) The restored measurement wins; the project file only seeds a fresh workspace (no state file); D-051's "until restart" is superseded. **Recommended (b):** a restart should be invisible; otherwise a measurement set by command, or opened with a view, silently changes back. Change for (b): one sentence in V4 and one scenario.
- **S-4 Opening replaces the one shared workspace.** (a) No confirmation; the replaced workspace is kept as "Before last open". (b) Confirm when the open view is modified or has no name. (c) Always confirm. **Recommended (a):** nothing is lost, it is one click to go back, and a confirmation in front of every link and menu click slows the meeting case. The spec is written for (a).

## Numbers: what if off by a factor of two

- **STATE_WRITE_DELAY_MS 500:** 250 → about twice the writes during a burst of commands (≤ 4/s, a few KB each: irrelevant); 1,000 → up to 1 s of changes lost on a hard kill (SIGTERM flushes either way).
- **MAX_VIEW_BYTES 256 KiB:** Jan's 17-window workspace is ~8 KB as JSON, a document at the limits (64 windows, 200 entries each) ~400 KB with long names. 128 KiB still holds 15× Jan's; 512 KiB only matters for documents beyond the workspace limits. Same value as the live frame limit (D-046).
- **MAX_LINK_CHARS 8,192:** Jan's 17 windows ≈ 1,400 characters; 4,096 would warn at ~50 windows; 16,384 passes most browsers but not every chat or mail client (some cut URLs at 2,000–8,000).
- **MAX_VIEW_TITLE 120, MAX_VIEW_NOTE 2,000:** title as measurement name (D-051); 60 cuts real titles ("Hard acceleration, drive 3, 13 Oct, BLS vs V_ANZ"); the note is a paragraph, 1,000 still fits, 4,000 makes the tooltip unreadable.
- **Title width 240 px:** at 1,440 px the top row has ~300 px free; 120 px cuts most titles, 480 px would push the option bar to a second line. At 1,000 px the title shrinks to what is left (possibly only the `•`); the full title stays in the tab title and the menu.
- **VIEW_NAME 63 characters:** from titles of ≤ 120; 32 would collide on long titles with a shared prefix.

## Shared files with parallel changes

- **`add-gap-display` (being built now):** also edits `packages/shared/src/index.ts` (one export line each), `apps/web/src/api.ts` (it adds `fetchGaps`; this change appends view calls at the end), `apps/web/src/styles.css` (this change does not need it: the menu uses `views/views.css`), `apps/cli/test/helpers.ts` and `apps/cli/test/cli.test.ts` (this change adds a separate `describe` block). Build this change after gap-display has landed, or rebase the two `index.ts`/`api.ts` lines.
- **`improve-events` (specced in parallel):** pins `App.tsx` (event steps, P7) and `keys.ts` (`n`/`p`). This change adds no key to `keys.ts`: Ctrl/Cmd+S is a `keydown` listener of `views/ViewsMenu.tsx` (only with Ctrl or Meta, `preventDefault` so the browser's save dialog does not open). If `improve-events` adds a workspace field or command (none pinned today), it goes into `ViewDoc` (or is left out on purpose) and into `WorkspaceSchema`.
- **`add-guidance` (specced in parallel):** pins a 26 px "?" at the end of `.option-bar-slot`, `help/hints.ts` for tooltips, and a manual that expects a "Save and share" section from this change. This change puts Views and the title at the **start** of the top row, so both fit; if add-guidance has landed first, the Views button, title, menu rows and Copy link take their tooltips from `help/hints.ts`, and task 3.2 adds the manual's "Save and share" section (save, open, Before last open, download/import, links and what they need).
- **General rules:** this change extends `Workspace`, `Command`, `CommandErrorCode` and `CommandResult` only by appending fields and union members; in `OptionBar.tsx` it only inserts at the start of the row; in `App.tsx` only the start-up effect, `document.title` and the notice tone. The change built second merges `App.tsx`; the pacer names the order.
- **New files of this change only:** `packages/shared/src/views.ts`, `apps/server/src/views.ts`, `persist.ts`, `routes/views.ts`, `apps/web/src/views/*`, `apps/cli/src/views.ts`.

## Risks / Trade-offs

- [One shared workspace] → a link opened by anyone on the same server replaces the view for every tab (S-4 keeps the old one). Real multi-user needs several workspaces (out of scope).
- [Restore without catalog checks] → a restored signal that vanished from the catalog shows its window's load error until removed, as today after a catalog reload.
- [Workspace fields added later] → `WorkspaceSchema` rejects unknown keys, so a newer server's state file read by an older build goes to `workspace.bad.json`; a newer build reads older files because new fields are optional. Accepted for a local tool.
- [Link in a URL fragment] → it is in browser history and visible to whoever gets the link; it holds no data and no credentials (concept §8), only names and times.
- [YAML edited by hand] → anything the reader refuses gives `invalid_view` with the path and message; unknown keys are warnings, not errors, so a typo in a key name silently drops that field: the warning shows in the import result and the open notice.
- [`CompressionStream` in Node] → available since Node 18 as a global; the CLI does not need the link codec.

## Migration Plan

None. Start the server once with the new build; it writes `.kipscope/workspace.json` after the first command. Lead adds `.kipscope/` to `.gitignore` (S-1 a).

## Manual checks (lead)

- Restart the dev server with Jan's windows open: same windows after reconnect, revision continued.
- Show Jan a saved view, the title in the top row, the YAML download, and a `#view=` link opened in a second browser.

## Ledger entry on archive (proposed; the lead assigns the number)

- Saved views: one versioned document (`kipscope: view`, `version: 1`, YAML on disk, JSON in links), signals by full ID, absolute UTC times to the ns, no data and no credentials; open replaces the workspace as one command `view.open` with a report of missing and skipped signals, IDs continue; `.kipscope/views/<name>.yaml`, names `[a-z0-9-]` ≤ 63 from the title; "Before last open" kept; state file `.kipscope/workspace.json` written 500 ms after the last change and on SIGTERM, restored at start with its revision; `#view=` self-contained links (deflate-raw, base64url), `?view=<name>`; CLI `view list|save|open|delete|export|import`. Plus Jan's answers to S-1 … S-4.

## Jan's answers (2026-10-17)

Jan: „all recommended“. S-1 to S-4 are decided as recommended in this design; the lead numbers them as D-nnn on archive.
