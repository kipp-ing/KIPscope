# Design

## Context

See proposal.md (Why). Facts that shape the approach:

- **Strip** (`apps/web/src/App.tsx`, the `status-strip` div after `<main>`; `styles.css` `.status-strip`): a flex row, `height: 28px`, `margin: 4px 16px`, 2 px border (transparent when idle), 12 px text, `white-space: nowrap; overflow: hidden`. It sits in the workspace column, right of the sidebar, below the scrolling `<main>`, so it never scrolls away. Outside a drag it holds `.conn` and the message button; during a drag its content is replaced by "+ New window" and it carries `data-drop`. Drop lookup is `elementFromPoint(...).closest("[data-window-id],[data-drop]")`, so children of the strip resolve to the strip.
- **No version:** no `package.json` has a `version`; the server runs its TypeScript from source (`node --watch`), the UI through Vite (`pnpm --filter @kipscope/web dev`, proxy `/api` to 7310 without `changeOrigin`).
- **Catalog** (`apps/server/src/catalog.ts`): `loadedAt`, `lastError`, `unavailableReason`, `size`. The web's explorer shows counts exact (`1234 matches`).
- **Source:** `createClickHouseClient` (`@clickhouse/client` 1.24) has `ping()` → `{success: true} | {success: false, error}`. Every source query goes through `QueryQueue` (concurrency 4).
- **Project file** (`apps/server/src/project.ts`): strict zod schema with `display` as the only top-level key; `parseProjectFile(text, path): DisplayRules`, `loadProjectFile(file)`; errors `<path>: <field>: <problem>`, server exits 1. Read once in `main.ts` before listen.
- **Workspace** (`packages/shared/src/workspace.ts`, `apply.ts`; `apps/server/src/workspace.ts` `WorkspaceStore` starting from `EMPTY_WORKSPACE` at revision 0). Every change is a `Command`; pushes and render acknowledgements need nothing new for a new command.
- **CLI** (`apps/cli/src/args.ts`): `HELP` template string, one `case` per form building a `command(...)`.
- **Web tests** run in node without a DOM; markup checks use `react-dom/server` `renderToStaticMarkup`.
- `harden-robustness` (complete, not archived) owns `server-access`; its guard is a root `onRequest` hook in `buildApp`, so new routes are covered without a change.

## Goals / Non-Goals

**Goals:** the scenarios of the four delta specs with the smallest additions; every interface between `packages/shared`, `apps/server/src`, `apps/cli/src` and `apps/web/src` pinned below so all areas build in parallel in one round.

**Non-Goals:** a version scheme, build-time injection into the web bundle, a source ping outside `/api/meta`, editing measurement info in the UI, persisting it, a generic "project metadata" model beyond name, object and meta.

## Decisions

### F1: Attribution constants (pinned, `packages/shared/src/meta.ts`)

One source for footer, CLI help and server log:

```ts
export const ATTRIBUTION = {
  product: "KIPscope",
  year: 2026,
  author: "Jan Kipping",
  identification: "Agentic engineer",
  url: "https://kipp.ing",
  urlLabel: "kipp.ing",
  slogan: "efficient agentic engineering",
  license: { spdx: "AAL", name: "Attribution Assurance License", path: "/api/license" },
} as const;

/** "KIPscope © 2026 Jan Kipping, Agentic engineer, https://kipp.ing · Attribution Assurance License (AAL)" */
export function attributionText(): string;
```

Footer markup (text exactly `KIPscope · © 2026 Jan Kipping, Agentic engineer · kipp.ing · AAL`):

```html
<span class="attribution"><span title="{hidden items}">KIPscope</span> · © 2026 Jan Kipping, Agentic engineer ·
  <a href="https://kipp.ing" target="_blank" rel="noopener noreferrer" title="efficient agentic engineering">kipp.ing</a> ·
  <a href="/api/license" target="_blank" rel="noopener noreferrer" title="Attribution Assurance License">AAL</a></span>
```

Slogan as tooltip only (Q1). `©` and the year follow `LICENSE` ("Copyright (c) 2026 by Jan Kipping").

### F2: Server meta and license (pinned)

`packages/shared/src/meta.ts`:

```ts
export type CatalogState = "loaded" | "loading" | "failed";
export interface ServerMeta {
  build: { commit: string | null; dirty: boolean; startedAt: string };          // ISO
  source: {
    kind: "clickhouse";
    database: string;
    table: string;
    reachable: boolean;
    checkedAt: string;                                                            // ISO, time the ping settled
    error?: string;                                                               // when !reachable
  };
  catalog: { state: CatalogState; size: number; loadedAt?: string; reason?: string };
}
```

`apps/server/src/meta.ts`:

```ts
export interface BuildInfo { commit: string | null; dirty: boolean; startedAt: Date }
export type GitRunner = (args: readonly string[]) => string;   // stdout; throws on failure
/** `git rev-parse --short=7 HEAD`, `git status --porcelain --untracked-files=no` in `root`;
 *  any throw → {commit: null, dirty: false}. Default runner: execFileSync("git", args, {cwd: root, timeout: 2000}). */
export function readBuildInfo(root: string, run?: GitRunner, now?: Date): BuildInfo;
export const PING_TIMEOUT_MS = 2000;
export interface MetaDeps {
  build: BuildInfo;
  source: { kind: "clickhouse"; database: string; table: string };
  /** Resolves when the source answers; rejects with the reason. Must not use the query queue. */
  ping: (signal: AbortSignal) => Promise<void>;   // aborted at the 2 s timeout (round 2)
}
export function metaRoutes(deps: { meta?: MetaDeps; catalog: Catalog; licenseText?: string }): FastifyPluginAsync;
```

- `AppDeps` gains optional `meta?: MetaDeps` and `licenseText?: string`; `buildApp` registers `metaRoutes` always. `/api/meta` without `meta` deps answers 404 `not_configured` (only tests omit it); `/api/license` without text answers 404 `license_missing`.
- Ping: single flight (a running promise is shared), raced against `PING_TIMEOUT_MS` (failure message `no answer within 2 s`). No result cache beyond the in-flight promise.
- Catalog state: `loadedAt` set → `loaded`; else `lastError` set → `failed`; else `loading`. `reason` = `unavailableReason` when not loaded.
- `main.ts`: keeps the ClickHouse client in a variable and passes `ping: async (signal) => { const r = await client.ping({ select: false, abort_signal: signal }); if (!r.success) throw r.error; }`; source label from `config.mapping.database`/`table`; `readBuildInfo(REPO_ROOT)` once at start; `LICENSE` read with `readFileSync(resolve(REPO_ROOT, "LICENSE"), "utf8")`, ENOENT → `app.log.warn("LICENSE not found; /api/license answers 404")`; `app.log.info(attributionText())` before `listen` (Q4). The URL, user and password never enter `MetaDeps`.
- `apps/web/src/api.ts`: `fetchMeta(abort?: AbortSignal): Promise<ServerMeta>` (throws `ApiRequestError` on non-2xx).

**Why the server's commit, not a web build constant:** one value, no Vite `define`; in dev the web code is always current through HMR while the server is the part that can lag (watch restarts only on its own files). Alternative: a semver `version` (none exists, Q3).

### F3: Footer items (pinned, `apps/web/src/footer/items.ts`, `useMeta.ts`)

```ts
export type Tone = "plain" | "ok" | "error" | "muted";
export interface FooterItem { key: string; text: string; title: string; tone: Tone; rank: number }
export const MEASUREMENT_CLIP = 40;
/** Items `m:name`, `m:object`, `m:meta:<key>` in that order, texts clipped to 40 characters with "…";
 *  `title` of the group: "Measurement: …\nObject: …\n<key>: <value>…" (lines of absent fields left out). */
export function measurementItems(m: Measurement | undefined): { items: FooterItem[]; title: string };
/** Items `source`, `catalog`, `zone`, `build` in that order; [] when meta is undefined. */
export function footerItems(meta: ServerMeta | undefined, stale: boolean,
  zone: { name: string; offsetMinutes: number }, now?: Date): FooterItem[];
export function browserZone(date?: Date): { name: string; offsetMinutes: number };  // Intl resolvedOptions().timeZone
/** Fetches on mount, every META_POLL_MS and when `connected` turns true; keeps the last meta, `stale` after a failure. */
export const META_POLL_MS = 30_000;
export function useMeta(connected: boolean): { meta?: ServerMeta; stale: boolean };
```

| Item | Text | Tone | Tooltip |
|---|---|---|---|
| name | the name | plain | group tooltip |
| object | the object | plain | group tooltip |
| meta entry | `key: value` | plain | group tooltip |
| source reachable | `ClickHouse sdlog` | ok | `ClickHouse sdlog.signals · reachable · checked 15:08:01` |
| source unreachable | `ClickHouse sdlog unreachable` | error | `ClickHouse sdlog.signals · unreachable: <error> · checked 15:08:01` |
| source, stale | as last known | muted | `last known; server not reachable · ` + the tooltip above |
| catalog loaded | `<size> signals` (exact, like the explorer's `1234 matches`) | plain | `catalog loaded 15:07:12` |
| catalog loading / failed | `catalog loading` / `catalog unavailable` | muted / error | the reason |
| zone | `Europe/Berlin` | plain | `display time zone · UTC+02:00` |
| build | `7c1e2a9`, `7c1e2a9*` when dirty; none when `commit` is null | plain | `server commit 7c1e2a9 · uncommitted changes at start · started 2026-10-16 15:07:10` |

Times in tooltips are local clock time. Kind label: `clickhouse` → `ClickHouse`. Ranks (lower hides first, F5): build 1, zone 2, catalog 3, meta entry i of n: 4 + (n − 1 − i) (last entry lowest), source 20, object 21, name 22.

### F4: License text from the server

`AAL` links to `/api/license`, served from the repo's `LICENSE` (through the Vite proxy in dev). Alternatives: the GitHub file (needs a public repo and shows `main`, not the running build, Q2); bundling `LICENSE?raw` into the web and showing a dialog (more UI, a second copy). A top-level GET from `localhost:5173` sends no `Origin` and keeps `Host` `localhost:5173`, so the `server-access` guard passes.

### F5: Bar layout and fitting (pinned, `apps/web/src/footer/fit.ts`, `StatusBar.tsx`)

```ts
export interface FitInput {
  available: number;          // inner width of the bar in px
  status: number;             // width of `.conn`
  attribution: number;        // width of the attribution group
  gap: number;                // px between two parts
  message?: number;           // natural width of the message button, when shown
  items: { key: string; width: number; rank: number }[];   // display order
}
export interface FitResult { shown: string[]; wrap: boolean }   // shown in display order
export function fitFooter(input: FitInput): FitResult;
```

- `wrap = status + gap + attribution > available`. Line budget: `status + Σ(shown widths + gap) + (message ? message + gap : 0)`, plus `gap + attribution` when not wrapped; items are removed lowest rank first until the budget fits `available` or none is left. The message then takes what is left and truncates by CSS (`min-width: 0; text-overflow: ellipsis`).
- `StatusBar` props: `{connected, revision, message?, onDismissMessage, measurement?, meta?, metaStale, dragging, over, dropRef}`. It renders a hidden measuring copy of all items (`visibility: hidden; position: absolute`) to read their natural widths, reruns `fitFooter` on a `ResizeObserver` of the bar and on text changes, and renders only `shown` items. The leading `KIPscope` gets `title` with the hidden items' texts, one per line.
- Layout: `.status-strip` keeps `margin: 4px 16px`, padding and border, `min-height: 28px` instead of `height`, `flex-wrap: wrap`; the attribution group has `margin-left: auto` (right end, also on the second line), `font-size: 11px`, `color: var(--muted)` for text and links (underline on hover only); status and measurement items 12 px `var(--text)`, automatic items 12 px in their tone colour (`plain` → `var(--muted)`). Items are separated by ` · `.
- Drag: the strip keeps `data-drop` and the whole box stays the target; the left part (status, message, items) keeps its boxes with `visibility: hidden`, and "+ New window" is drawn as an absolutely positioned label over that part, so no width or height changes when a drag starts. The attribution stays visible and unchanged. A release over a link does not follow it: the `click` would go to the common ancestor of the press (explorer row) and the release.
- Heights: one line ≤ 32 px (28 px box + border, as today); wrapped ≤ 48 px (two lines of 16 px line height plus padding and border).

**Drop order:** the automatic items yield first (Jan wants them small), then his meta entries from the last, then the source state (kept long because a dropped tunnel matters, D-042), then object and name. Alternative: source last of all (Q6).

### F6: Measurement model and commands (pinned, `packages/shared/src/workspace.ts`, `apply.ts`)

```ts
export const MAX_MEASUREMENT_TEXT = 120;    // name, object
export const MAX_MEASUREMENT_KEY = 40;
export const MAX_MEASUREMENT_VALUE = 200;
export const MAX_MEASUREMENT_META = 8;
/** Starts with a letter; letters, digits, space, _ . - */
export const MEASUREMENT_KEY = /^\p{L}[\p{L}\p{N} _.-]*$/u;
export interface MeasurementEntry { key: string; value: string }
export interface Measurement { name?: string; object?: string; meta?: MeasurementEntry[] }  // meta absent when empty
export interface Workspace { /* … */ measurement?: Measurement }   // absent when empty; EMPTY_WORKSPACE unchanged

// Command union gains (texts trimmed first, then checked: max length, no /\p{Cc}/u):
{ type: "measurement.set"; name?: string; object?: string }        // refine: at least one given; "" clears
{ type: "measurement.setMeta"; key: string; value: string }        // key per MEASUREMENT_KEY ≤ 40; value ≤ 200; "" removes
{ type: "measurement.clear" }
// CommandErrorCode gains "measurement_limit" (a 9th key).
```

`applyCommand` keeps `measurement` normalised: fields with empty text are deleted, an empty `meta` is deleted, an empty `measurement` is deleted. `setMeta` on an existing key replaces in place; a new key is appended. Three commands instead of one patch command: each CLI form maps to exactly one, and a single key changes without the CLI reading the list first. Limits: 120 holds a descriptive name ("smart451 Testfahrt A9 Stuttgart–München 2026-10-13 Regen" is 56); 40 for keys keeps `key: value` readable; 8 entries is more than one line shows at 1440 px.

### F7: Project file section and precedence (pinned, `apps/server/src/project.ts`, `workspace.ts`)

```yaml
measurement:              # optional
  name: Testfahrt A9      # ≤ 120 characters
  object: smart451        # ≤ 120 characters, the vehicle or device under test
  meta:                   # ≤ 8 entries, in file order; key ≤ 40 (starts with a letter), value ≤ 200
    driver: Jan
    run: 3                # numbers and booleans become text: "3"
```

```ts
export interface ProjectFile { rules: DisplayRules; measurement?: Measurement }
export function parseProject(text: string, path: string): ProjectFile;      // all problems of both sections in one ProjectFileError
export function loadProject(file: { path: string; required: boolean }): ProjectFile;   // missing optional file → {rules: NO_RULES}
// parseProjectFile / loadProjectFile stay and return `.rules` (existing tests unchanged).
// WorkspaceStoreOptions gains `measurement?: Measurement`: the state at revision 0.
```

Problems use the existing `<path>: <field>: <problem>` form with these texts: `unknown key "<k>"`, `at most 120 characters` (`at most 40` / `200` for key and value), `key must start with a letter`, `key may hold only letters, digits, space, _ . -`, `at most 8 entries`, `must be text, a number or true/false`, `no line breaks or control characters`. Keys are checked by the regex, so integer-like keys (which JavaScript objects would reorder) cannot occur.

Precedence: the file sets revision 0; commands win until restart; nothing writes the file (Q5). The file is read once at start like the display rules (D-036), so editing it needs a restart, which also drops CLI changes.

### F8: CLI (pinned, `apps/cli/src/args.ts`)

Forms `measurement name TEXT`, `measurement object TEXT`, `measurement meta KEY VALUE`, `measurement clear` map to the F6 commands with the texts as given (the server trims and checks). The `HELP` text gains the four forms under "Commands" and ends with `attributionText()` as its last line (Q4).

### Numbers: what if off by a factor of two

| Number | Half | Double |
|---|---|---|
| Meta poll 30 s | 15 s: twice the pings, still negligible | 60 s: an outage shows up to a minute late; windows show `failed` sooner anyway |
| Ping timeout 2 s | 1 s: false "unreachable" on a loaded carserver (2 GB RAM) | 4 s: `/api/meta` answers later; nothing waits on it |
| Clip 40 characters | 20: names unreadable | 80: one item can push every other item out at 1000 px |
| Name/object 120 | 60: long descriptive names refused | 240: only state size; the footer clips at 40 anyway |
| 8 meta entries | 4: may be too few for a test log | 16: harmless; the footer shows few, tooltip lists all |
| Attribution 11 px | 5.5 px: unreadable (AAL display fails) | 22 px: not subtle, breaks one line at 1000 px |
| Wrapped bar 48 px | 24 px: two lines do not fit | 96 px: wasted height on small screens |

## Risks / Trade-offs

- [The measuring copy and ResizeObserver cost layout work on every resize] → widths are re-read only when texts change; the fit itself is a pure loop over ≤ 15 items.
- [`git` missing or slow at start] → `readBuildInfo` catches every failure with a 2 s timeout; the build item disappears.
- [11 px muted text may read as less "prominent" than AAL clause 2 suggests] → it is Jan's own license and his call („small and subtle"); the text is never hidden or cut and keeps AA contrast (`#64748b` on `#f8fafc`).
- [Measurement info set by CLI is lost on restart] → stated in the example file and README; persistence is the next change.
- [`measurement` appears in the workspace object that later persistence stores] → it is ordinary workspace state, so persistence covers it without a special case.

## Migration Plan

No stored data. `kipscope.yaml` without `measurement` behaves as before. Deploy with the usual restart and reload open tabs. Rollback: revert the change.

## Manual checks (lead)

1. `curl -s localhost:7310/api/meta | jq -c '[.build.commit, .source.database, .source.reachable, .catalog.state]'` (app-footer "Real server").
2. Tunnel stop and start with the UI open (app-footer "Tunnel drop on real data").
3. Server restart with the UI open: build tooltip shows the new start time (app-footer "Refetch on reconnect").
4. Start log shows the attribution line (app-footer "Start log").
5. YAML start value, CLI change, restart (measurement-info "Commands win until restart").

## Ledger entries on archive (proposed for `docs/decisions.md`)

- **D-050: Footer conventions.** The status strip is the footer: status, measurement info, automatic items (source by ping, catalog, browser zone, server commit at start) and at the far right the attribution in 11 px muted text; `/api/meta` and `/api/license` (from `LICENSE`); items hide whole in the order build, zone, catalog, meta entries, source, object, name; the attribution is never cut and wraps to a second line instead; `kipscope --help` and the server start log end with `attributionText()`. (F1–F5, F8)
- **D-051: Measurement info.** `workspace.measurement {name, object, meta[{key, value}]}`, commands `measurement.set`, `measurement.setMeta`, `measurement.clear`; limits 120 / 40 / 200 characters, 8 entries; the project file's `measurement` section gives the start value, commands win until restart, nothing writes the file. (F6, F7)

## Open Questions

Answered by Jan on 2026-10-16; the change is built this way.

- **Q1: Attribution wording.** As recommended: `KIPscope · © 2026 Jan Kipping, Agentic engineer · kipp.ing · AAL`, the slogan "efficient agentic engineering" only as the link's tooltip.
- **Q2: License link target.** As recommended: the running server's `/api/license` (local). The repository is public, so a GitHub link could be added later.
- **Q3: Build label.** As recommended: the server's short commit at start with `*` for uncommitted changes. Jan: a version tag comes later (its own change).
- **Q4: Attribution outside the UI.** Yes: the last line of `kipscope --help` and one info line at server start.
- **Q5: Precedence of YAML and CLI.** As recommended: the YAML gives the start value, commands win until restart, nothing writes the file.
- **Q6: Drop order.** As recommended: build, zone, catalog, meta entries (last first), source, object, name.
- **Q7: Shipped `kipscope.yaml`.** Jan: ship it with `measurement: {object: smart451}`; `kipscope.example.yaml` explains the whole section.
- **Q8: Editing in the UI.** As recommended: not now; CLI and YAML only.
- **Q9: Bar width.** As recommended: the bar stays in the workspace column right of the sidebar.
