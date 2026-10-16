# Design

## Context

See proposal.md (Why). The mock is the visual reference: `docs/design/Main.dc.html` (workspace; `renderVals()` holds `PALETTES['okabe-ito']`, `ACCENTS.sky`, compact density: base 12, row 22, header 24) and `docs/design/Tokens.dc.html` (neutrals, accent and status, type, controls, pills and list). Facts that shape the approach:

- **Styles:** `apps/web/src/styles.css` (`:root` tokens, explorer, footer, top row, drop zones), `chart/window.css` (header, badge, cursors, live line and label, legend cells, grip, drop highlight), `values/values.css`, `bar/bar.css`. Literal colours outside `:root` today: `rgb(37 99 235 / x)` (accent tints), `rgb(220 38 38 / 0.08)`, `#fef2f2`, `#fde68a` (search mark), `--cursor-color: #475569`. The only colour in TS is the zoom-selection fill `${color}33` in `TimeseriesWindow.tsx`; the uPlot axis font is `AXIS_FONT = '12px system-ui…'` there, grid at uPlot's default.
- **Option bar** (`bar/OptionBar.tsx`): A, B, Diff and "Link time axes" are `label.toggle > input[type=checkbox]`; "Signals" is `button.sidebar-toggle[aria-expanded]` in `App.tsx`'s `.option-bar-slot` (sticky, `container: top-row`).
- **Explorer** (`explorer/SignalExplorer.tsx`): `h2` "Signals", search, `label.target` select, `p.count`, flat listbox of `.group-head` and `.row` siblings (rows 22 px, headers 22 px). There is **no** "Add <signal> to <window>" button; adds are the row "+" (`Add to <target>`, signal-catalog "Add button names its target") and Enter.
- **Workspace colours:** `Workspace.colors` maps signal ID → index into `SIGNAL_COLORS` (`packages/shared/src/workspace.ts`, ten entries; `apply.test.ts` asserts length 10). The workspace lives in server memory only (no file); a restart starts empty.
- **Server:** `DataSource.extent(ref)` is per signal (`SELECT count(), min, max … WHERE dataRef AND signal AND time IS NOT NULL`); `buckets()` groups on the floor grid `x − positiveModulo(x, w)`. `queuedSource()` wraps every method. Test table `ORDER BY (vehicle, signal, utc)`, `PARTITION BY vehicle`; carserver has 2 GB RAM (D-007). `catalog.loadedAt: Date | undefined` changes on every successful load; `catalog.all()` lists entries with `dataRef`.
- **Spec numbers the restyle could break** (checked in `openspec/specs/*/spec.md`): sidebar 240 px; explorer row and group header ≤ 24 px; window header one line ≤ 24 px (goal: plot top ≤ 48 px below window top); top row ≤ 36 px and strip ≤ 32 px (goals); footer one line ≤ 32 px, two lines ≤ 48 px, attribution 11 px `rgb(100, 116, 139)`, status 12 px; A | B | Δ | L in a 485 px values window; plot heights 120–1200 px, default 280; plot share ≥ 30 % at 1000×557 sidebar open (last measured 42.6 %); controls do not move on zoom; L cells do not move rows. How each stays met: T8.

## Goals / Non-Goals

**Goals:** the scenarios of the three delta specs; every interface between `packages/shared`, `apps/server/src` and `apps/web/src` pinned below so all areas build in one round; no behaviour change outside the time strip; existing tests stay green.

**Non-Goals:** the out-of-scope list of proposal.md; pixel equality with the mock (it is a reference, sizes the specs fix win).

## Decisions

### T1: Tokens (pinned, `apps/web/src/styles.css` `:root`)

```css
:root {
  /* slate */
  --bg: #f8fafc;          /* slate-50, page */
  --panel: #ffffff;       /* panels */
  --band: #f1f5f9;        /* slate-100, group band, badge, header divider */
  --border: #e2e8f0;      /* slate-200, dividers, disabled border */
  --control-border: #cbd5e1; /* slate-300, control border, data bars */
  --disabled: #94a3b8;    /* slate-400 */
  --muted: #64748b;       /* slate-500, muted text (app-footer pins rgb(100,116,139)) */
  --soft-ink: #475569;    /* slate-600, badge and loading pill text */
  --label: #334155;       /* slate-700 */
  --name: #1e293b;        /* slate-800, signal names, titles */
  --text: #0f172a;        /* slate-900, text, primary, cursors */
  /* accent sky (D-055) */
  --accent: #0284c7;
  --accent-soft: #e0f2fe;
  --accent-ink: #075985;
  --accent-ring: #7dd3fc;
  /* status */
  --ok: #047857;  --ok-fill: #ecfdf5;  --ok-dot: #10b981;
  --sna: #f59e0b; --sna-fill: #fffbeb; --sna-ink: #92400e;
  --error: #be123c; --error-fill: #fff1f2;
  --mark: #fde68a;        /* search hit, unchanged */
  /* shape and type */
  --radius: 4px;
  --control-h: 26px;
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, monospace;
  --name-size: 11.5px;
  font-family: var(--font-sans);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--text);
  background: var(--bg);
}
button, input, select { font: inherit; color: inherit; }
```

Tints that were `rgb(37 99 235 / a)` become `color-mix(in srgb, var(--accent) a%, transparent)`; error tints likewise with `--error`. Existing names (`--bg`, `--panel`, `--text`, `--muted`, `--border`, `--accent`, `--error`, `--ok`, `--sna`) keep their meaning, so rules that use them follow without edits.

### T2: Type (pinned)

Base 12 px sans; section label class `.section-label` (11 px, 600, uppercase, `letter-spacing: 0.05em`, `--muted`), used by the explorer's `h2` and the strip's `TIME`; window titles 12 px 600 `--name` (was 13 px); signal names in explorer rows and legend `.sig` `--font-mono` at `--name-size`; numbers tabular everywhere via `:root`. Values window names and cells stay 11 px mono (the 485 px fit of `values-window`). Legend value cells and the live label switch to `--font-sans` (tabular); the readout row and Δt label keep their fonts. `AXIS_FONT` becomes `'11px ' + sans stack` (the axis width is measured from it, so axes size themselves).

### T3: Controls and top row (pinned, `bar/bar.css`, `bar/OptionBar.tsx`, `styles.css`)

- Top-row `button`, `select`, `input[type=text]`: `height: var(--control-h)`, `padding: 0 10px` (selects `0 4px`), `border: 1px solid var(--control-border)`, `border-radius: var(--radius)`, `background: var(--panel)`; `:disabled` → border `--border`, colour `--disabled`. "+ Values window" weight 500. Focus: `outline: 2px solid var(--accent); outline-offset: 1px` on `:focus-visible`.
- `.option-bar-slot`: `background: var(--panel)`, `padding: 4px 16px` (26 + 8 + 1 border = 35 px ≤ the 36 px goal), border-bottom `--border`.
- **Pills:** A, B and Diff labels get class `toggle pill`; the checkbox inside stays the control (keyboard, tooltip, `onChange` and the bar tests unchanged) and is visually hidden (`position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none`). `.pill`: `height: var(--control-h)`, `padding: 0 10px`, `border-radius: 999px`, `border: 1px solid var(--control-border)`, `background: var(--panel)`, weight 500; `.pill:has(input:checked)` → background and border `--text`, colour `#fff`; `.pill:has(input:disabled)` → border `--border`, colour `--disabled`; `.pill:has(input:focus-visible)` → the accent outline. "Link time axes" keeps its visible checkbox with `accent-color: var(--accent)`.
- `.sidebar-toggle`: a top-row control; `[aria-expanded="true"]` → background `--text`, colour `#fff`, border `--text`.
- Primary buttons: none exist today; the style `.primary` (background `--text`, colour `#fff`, no border, weight 500) is defined for future use only. No surface gets one in this change (Q1).

### T4: Explorer, windows, legend, footer (pinned looks; files in tasks)

- **Explorer** (`styles.css`): `padding: 10px 8px 8px`; `h2` gets `.section-label` look; search `height: 30px`, border `--control-border`, radius 4; `.target select` 26 px. `.group-head`: `height: 24px`, `padding: 0 8px`, `background: var(--band)`, radius 4, name `--label` 600, count and chevron `--muted`; `:hover` → `--border`; `.group-head:not(:first-child)` `margin-top: 3px`. `.row`: 22 px, `padding: 0 2px 0 18px`, radius 4; `:hover` → `--bg`; `.row.active` and `.group-head.active`: background `--accent-soft`, name colour `--accent-ink`, no inset bar. `.add`: 22 × 22, transparent, colour `--disabled`, `:hover` colour `--accent`.
- **Window** (`styles.css` `.window`, `chart/window.css`): border `--border`, radius 6. `.window-header`: `box-sizing: border-box; height: 24px; border-bottom: 1px solid var(--band)` (the divider sits inside the 24 px, so plot top stays 48 px below the window top). Title 12 px 600 `--name`. `.badge`: `background: var(--band)`, colour `--soft-ink`, no border, radius 4, 11 px.
- **Marked window:** the `::before` accent bar and the accent title colour go; `.window.marked` → `border-color: var(--accent-ring)`; a `span.mark-pill` "Add to" (background `--accent-soft`, colour `--accent-ink`, 11 px, weight 500, radius 4, `padding: 0 6px`, `flex: none`, never ellipsized) right after the title, in both window kinds. It must not change the controls' cell or the truncation order; in the values header its width counts in the room `ValuesWindow` measures for the cursor times (so the dates drop rather than the pill or Δt being cut).
- **Cursors and live:** `--cursor-color: var(--text)`; `.cursor-a .cursor-flag` filled `--text` with white text, `.cursor-b .cursor-flag` background `--panel`, colour and 1 px border `--text`. `.live-line`: `border-left: 1px solid var(--accent)`. `.live-label`: background `--panel`, 1 px border `currentColor` (the signal colour, as today), radius 4, weight 600, `--font-sans`, `box-shadow: 0 1px 2px rgb(15 23 42 / 0.08)`. Zoom-selection fill unchanged. uPlot: `grid: { stroke: "#e2e8f0" }` (the `--border` value; uPlot draws on canvas, so the literal is allowed in `TimeseriesWindow.tsx` as `GRID_STROKE`), neutral axis `stroke` `#64748b` (`AXIS_STROKE`); single-signal axes keep the signal colour.
- **Legend:** `.swatch` 12 × 3 px, radius 2 (values window swatch too); `.sig` mono `--name-size`, colour `--name`, weight 500. Status cell: `.status.loading` and `.status.error` become pills (`padding: 0 6px`, radius 4, 11 px; loading `--band`/`--soft-ink`; error `--error-fill`/`--error`); `.status.complete` stays an empty cell. `.signals .sna` non-empty → pill `--sna-fill`/`--sna-ink`. SNA value text (`.sna-value`) → `--sna-ink`. The grid template and column order stay; pills add width only inside their own `auto` columns, which the L column does not share.
- **Footer** (`styles.css` `.status-strip`): `margin: 0`, `padding: 2px 16px`, `background: var(--panel)`, `border: 2px solid transparent`, `border-radius: 0`, idle divider `box-shadow: inset 0 1px 0 var(--border)` (a shadow, so the 2 px box is the same idle and during a drag); `min-height: 28px` as today. `.conn.ok`: colour `--ok`, weight 500, `::before` a 7 px `--ok-dot` circle with 5 px gap. The fit measures `.conn` with the dot (the measuring copy uses the same class). Items 12 px, attribution 11 px `--muted` (unchanged rules).

### T5: Series palette (pinned, `packages/shared/src/workspace.ts`)

```ts
/** Signal palette (D-055): Okabe-Ito, then four colours ≥ 3:1 on white; Workspace.colors holds indices. */
export const SIGNAL_COLORS = [
  "#0072B2", "#E69F00", "#009E73", "#D55E00", "#CC79A7", "#56B4E9",
  "#332288", "#882255", "#999933", "#8C564B",
] as const;
```

Choice of the four: Okabe-Ito's remaining two are unusable here (yellow `#F0E442` 1.3:1 on white; black `#000000` next to the slate-900 cursors). Indigo `#332288` (12.2:1), wine `#882255` (8.7:1), olive `#999933` (3.0:1, from Paul Tol's muted scheme) and brown `#8C564B` (5.9:1) keep every pairwise ΔE ≥ 25 (the closest pair is Okabe-Ito's own `#0072B2`/`#56B4E9`, 26.4). Existing windows: signals keep their index and show the new colour at it; nothing migrates, and a server restart starts an empty workspace anyway.

### T6: Density DTO and width (pinned, `packages/shared/src`)

`series.ts`:

```ts
/** Rows per bucket of one data ref over its whole extent (spec time-strip). Decimal ns strings. */
export interface Density {
  dataRef: string;
  first: string;
  last: string;
  /** One of DENSITY_WIDTHS. */
  width: string;
  /** floor(first / width) * width. */
  start: string;
  /** counts[i]: rows in [start + i*width, start + (i+1)*width); length floor(last/w) − floor(first/w) + 1 ≤ MAX_DENSITY_BARS. */
  counts: number[];
}
```

`time.ts`:

```ts
export const MAX_DENSITY_BARS = 120;
/** ns, ascending: 1 2 5 10 20 50 100 200 500 ms; 1 2 5 10 15 30 s; 1 2 5 10 15 30 min; 1 2 3 6 12 h; 1 2 7 14 30 90 180 d; 1 2 5 10 20 50 100 × 365 d. */
export const DENSITY_WIDTHS: readonly bigint[];
/** Smallest width with floor(last/w) − floor(first/w) + 1 ≤ MAX_DENSITY_BARS (floor toward −∞). */
export function densityWidth(first: bigint, last: bigint): bigint;
```

Both exported from the package index.

### T7: Server (pinned, `apps/server/src`)

- `datasource.ts`, two methods (implemented in `clickhouse.ts`, wrapped in `queuedSource`):

```ts
/** Rows of the data ref with a timestamp: count, first and last; undefined if none. */
refExtent(dataRef: string, abort?: AbortSignal): Promise<{ count: number; first: Timestamp; last: Timestamp } | undefined>;
/** Non-empty buckets of all the data ref's rows on the grid k * width, any order. */
refBuckets(dataRef: string, width: bigint, abort?: AbortSignal): Promise<{ start: Timestamp; count: number }[]>;
```

- SQL (`time`, `dataRef` from the mapping, params bound):
  1. `SELECT count(), toString(toUnixTimestamp64Nano(min(time))), toString(toUnixTimestamp64Nano(max(time))) FROM t WHERE dataRef = {ref:String} AND time IS NOT NULL`
  2. `WITH toUnixTimestamp64Nano(time) AS x SELECT toString(x - positiveModulo(x, {w:Int64})) AS b, count() FROM t WHERE dataRef = {ref:String} AND time IS NOT NULL GROUP BY b`

  Both read the data-ref column (partition key and first sort key, so other refs are pruned) and the time column only; query 2 holds ≤ 120 groups. No `ORDER BY`, no per-row sort, no join.
- New `density.ts`: `class DensityCache { constructor(source: Pick<DataSource, "refExtent" | "refBuckets">, loadedAt: () => Date | undefined); get(dataRef: string): Promise<Density | undefined> }`. One entry per data ref `{ loadedAt, promise }`; a request whose `loadedAt()` differs from the entry's recomputes; concurrent requests share the promise; a rejected promise is removed; `undefined` (no rows) is cached like a result. The computation is not aborted by a client close (it is shared and cached). It builds `counts` zero-filled from `start` by `(bucket − start) / width`.
- Route in `routes/series.ts`: `GET /api/density`, zod `{ dataRef: z.string().min(1) }` (400 `invalid_request` via `parseInput`); `catalog.loadedAt && !catalog.all().some((s) => s.dataRef === dataRef)` → 404 `unknown_data_ref`; `undefined` → 404 `no_data`; a thrown error → 502 `source_error` with the message. The cache instance is created once in the plugin from `source` and `() => catalog.loadedAt`.

### T8: Time strip in the web (pinned, `apps/web/src/time/`)

- `strip.ts` (pure, test-first):

```ts
export const BAR_PX = 24;
export const RETRY_MS = 30_000;
/** Data ref of the first signal of barTarget(ws), else of the first signal of any window in order. */
export function stripDataRef(ws: Workspace): string | undefined;
/** Per bucket: height (0 rows → 1, else max(3, round(BAR_PX * count / max))) and whether [start_i, start_i + width) meets [from, to). */
export function stripBars(d: Density, range?: { from: bigint; to: bigint }): { height: number; shown: boolean }[];
/** "<shown> of <recorded> recorded · 1 bar = <width>"; without range "<recorded> recorded · 1 bar = <width>". recorded = last − first. */
export function stripLabel(d: Density, range?: { from: bigint; to: bigint }): string;
/** Largest of y (365 d), d, h, min, s, ms that ns reaches (else ms); Math.round(x * 10) / 10, no ".0". 0 → "0 ms". */
export function formatSpan(ns: bigint): string;
```

- `api.ts`: `fetchDensity(dataRef: string, signal?: AbortSignal): Promise<Density>` (throws on non-2xx with the API message).
- `TimeStrip.tsx`: props `{ workspace: Workspace }`. Data ref from `stripDataRef`; range from `barTarget(workspace)?.range`. A module-level `Map<string, Density>` keeps loaded densities for the page's life; a failed fetch retries after `RETRY_MS` while the data ref is unchanged; a changed data ref fetches at once. States: no data ref → `No signal shown`; loading → `Loading recording…`; failed → `Recording unavailable` (`title` = error message); loaded → bars and label. Markup: `div.time-strip` > `div.time-strip-head` (`span.section-label` `TIME`, `span.time-strip-range` = `formatRange(from, to)` when a target exists, `span.time-strip-info` right-aligned muted) and `div.time-strip-bars[aria-hidden=true]` with one `span` per bucket (`height` inline, class `shown` for the accent). Title on `.time-strip`: `<dataRef> · <formatRange(first, last)>`. No click handlers.
- CSS (new `time/strip.css`, imported by `TimeStrip.tsx`, so `styles.css` stays task 3.1's): `.time-strip` `padding: 6px 16px 4px`, `background: var(--panel)`, border-bottom `--border`, `display: flex; flex-direction: column; gap: 4px`; head line-height 16 px; `.time-strip-bars` `height: 24px; display: flex; align-items: flex-end; gap: 2px`; bar `flex: 1 1 0; min-width: 1px; border-radius: 1px 1px 0 0; background: var(--control-border)`, `.shown` → `var(--accent)`. Total 6 + 16 + 4 + 24 + 4 + 1 = 55 px ≤ 56 in every state (the bars row keeps its 24 px when empty).
- Placement (`App.tsx`): `.option-bar-slot` and `<TimeStrip>` move into one sticky wrapper `div.top-area` (`position: sticky; top: 0; z-index: 5; margin: 0 -16px 8px`, rule in `strip.css`) at the top of `<main>`; `.option-bar-slot` (in `styles.css`) drops its own sticky, top, margin and z-index but keeps `container: top-row`. The drag auto-scroll edge "below the option bar" (`timeseries-window`) then counts from the wrapper's bottom: `App.tsx`'s `barRef` (read as `listTop` in the auto-scroll) moves from `.option-bar-slot` to `.top-area`.

### T9: How the spec numbers stay met

| Number (spec) | Restyle effect | Kept by |
|---|---|---|
| Sidebar 240 px (`workspace-layout`) | mock 260–300 px | `--sidebar-width` unchanged |
| Row ≤ 24 px (`signal-catalog`), header ≤ 24 px (`signal-groups`) | rows 22, headers 22 → 24 | 24 is the limit; 3 px margin is outside the header box |
| Window header ≤ 24 px; plot top ≤ 48 px goal | divider added | divider inside `box-sizing: border-box` 24 px; header controls stay 22 px |
| No control reflow on zoom | badge fill, pill | badge and pill sit left of the `1fr` range cell; controls in their own `auto` cell |
| Top row ≤ 36 px (goal) | 26 px controls | padding 4 px: 35 px |
| Footer ≤ 32 px, ≤ 48 px wrapped; 11 px attribution, `rgb(100,116,139)` | band, dot | same 2 px box and 28 px min-height; `--muted` unchanged; dot is part of the measured `.conn` |
| 485 px values window A\|B\|Δ\|L | 12 px base | values table keeps its 11–12 px sizes and mono cells |
| L cells do not move rows | pills | pills live in status/SNA columns, L column `min-width: 8ch` unchanged |
| Plot share ≥ 30 % at 1000×557 open (42.6 % measured) | +55 px sticky strip | estimate: 55 px × ~650 px plot width ≈ 6 points → about 36 %; re-measured (time-strip "Screen use with the strip") |

### Numbers: what if off by a factor of two

- **120 bars:** 60 → coarser bars, still a usable overview; 240 → 2 px bars at 1000 px with the sidebar open, gaps dominate. 120 gives 4 px bars there.
- **24 px bar height:** 12 → counts barely readable; 48 → strip 79 px, plot share ~33 %, too close to 30 %. The mock's 30 px would cost 6 px more.
- **3 px minimum for a bucket with rows:** 1.5 → indistinguishable from an empty bucket's 1 px; 6 → small buckets look like a quarter of the largest.
- **30 s retry:** 15 → twice the requests while carserver is down (one cheap request each, fine); 60 → the strip stays empty a minute after the tunnel returns. Load retry elsewhere caps at 30 s too (D-042).
- **26 px controls:** 13 → below a click target; 52 → top row 61 px. 26 matches the mock and the 36 px goal.
- **12 px base:** 6 unreadable; 24 breaks every row and header limit. 12 is D-055.
- **Palette thresholds 3:1 and ΔE 25:** 1.5:1 would admit the yellow; 6:1 would exclude olive and most of Okabe-Ito. ΔE 12 admits near-duplicates; ΔE 50 cannot hold ten colours.
- **Strip ≤ 56 px:** 28 cannot hold a 16 px label and 24 px bars; 112 would cost the plot share.

## Risks / Trade-offs

- **Accent vs. series blue:** the accent `#0284c7` is close to series 0 `#0072B2` (ΔE 7). The accent is used for the L line, focus, the strip's shown bars and the marked frame, never for a curve; a signal in series 0 next to the L line may read alike (Q3).
- **Okabe-Ito orange and sky** have about 2.3:1 on white; accepted with the palette (D-055).
- **Density cost** grows with the data ref's row count: two scans of the time column per catalog load. The test DB's 21.6 M `testcar` rows bound the test runtime; carserver's real count is measured in "Cost on carserver". If it is too slow, a coarser path (counting from `system.parts` or a sampled read) is a follow-up, not this change.
- **UTC bucket grid:** day and week bars start at 00:00 UTC, not local midnight; the label only names the width.
- **Hidden checkbox pills** keep keyboard and tests intact; the visible state is CSS `:has()`, which Chrome supports.

## Migration Plan

None. Palette indices stay valid; the new endpoint is additive; restart the server to serve it.

## Manual checks (lead)

- Look at the page next to the mock artboard "Workspace" at 1440×900 and send Jan one screenshot.

## Ledger entries on archive (proposed for `docs/decisions.md`)

- D-0xx Design language conventions: tokens of T1, pills via hidden checkboxes, marked window = ring frame + "Add to" pill, palette T5 (Okabe-Ito + `#332288 #882255 #999933 #8C564B`), density endpoint `/api/density` with widths T6 and the server cache per data ref and catalog load, strip 24 px bars / 56 px, no click.

## Open Questions

- **Q1 (Jan):** the mock shows a dark "Add TEMP_KL to Window 2" button at the explorer foot. The app has no such button (adds are the row "+" and Enter). Spec default: illustration, not built. Build it as the explorer's one primary?
- **Q2 (Jan):** marked window — the mock shows a ring frame and an "Add to" pill and no top accent bar; the spec follows the mock and drops the bar and accent title. Keep the bar as well?
- **Q3 (Jan):** the L line in the accent (mock) sits close to series 0 blue. Keep it, or draw the L line in slate-500?
