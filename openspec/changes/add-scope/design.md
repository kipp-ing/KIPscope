# Design

## Context

- **Inputs:** D-078: „KIPscope shows one case at a time: a **scope** (one data ref and one time window) … Every source query is bounded by the scope; nothing scans a data ref's whole history. The scope is a hard edge for now: navigation stops there, widening it is an explicit step." D-079 (multiuser later), D-080 (books later), D-074 (lean contract: 7 required methods, fallbacks, one conformance suite), D-070 (view document v1, tolerant reading, `#view=` links). Issue #1 items 1–5 and its acceptance. Concept §8: the saved state includes the „Datenreferenz". Concept §9: „Untersuchung direkt öffnen: Datensatz, Zeitpunkt, Vor-/Nachlauf".
- **Data facts (issue #1, real ADX table, viewer rights):** one data ref, 24 h: the catalog takes ≤ 1.6 s and lists ≈ 2,300 signals. Unscoped, that ref's history buckets and the table-wide distinct (dataref, signal) both time out at 120 s, and `catalog not loaded; retrying` repeats forever. The prototype with a static scope (a filtered sub-expression around the table) loads the catalog in 3 s and series in < 1.5 s.
- **Code today:** `datasource.ts` `SourceAdapter` (7 required, 7 optional, `events` capability); `fallbacks.ts` `completeSource` computes the optional ones from the core with `TIME_MIN … TIME_MAX` ranges; one global `Catalog` (`catalog.ts`) loaded at start with retries (`keepCatalogLoaded`). After each load, density, gap info and events are prefetched for every data ref (`density.ts`, `gaps.ts`, `events.ts`). Gap info polls `refCount` every 5 min. Routes take `dataRef` or `signal` and query unbounded history (`routes/series.ts`, `routes/events.ts`). `ApplyContext` (`packages/shared/src/apply.ts`) checks signals against the one catalog. `view.open` is applied synchronously through `workspace.execute`.
- **Query classes (`improve-query-priority`, done):** four classes, highest first: `interactive`, `metadata`, `background`, `preload` (`apps/server/src/priority.ts`, `withPriority(class, …)`). Routes and catalog loads are `interactive`. Prefetches and polls are `background`. Neighbour preloading (D-078) is `preload`. That change also decides which signals get their periods measured. This change does not touch `queue.ts`, `priority.ts` or that choice. It only passes the scope to the queries that the gap info, density and events already send, and builds on that change's `gaps.ts`.

## Goals / Non-Goals

**Goals:** a scope bounds every source query of a workspace. In scoped mode no query runs without a data ref and a time filter. A view or link opens with a scope and its signal list. The strip, gaps and events cover the scope. Navigation stops at the edge, and "Widen" is the explicit step. The adapter contract is pinned well enough that the Azure users can write their adapter part against it.

**Non-goals:** see proposal "Out of scope".

## Decisions

### Z0: Mode flag, optional scope (the simpler design; spec owner's choice)

Two designs were weighed:

- **(chosen) Optional scope plus a catalog mode.** `workspace.scope` is optional. Without it, everything works as today (full mode only). With it, everything is bounded, in both modes. `KIPSCOPE_CATALOG=scoped` removes the start-up catalog and demands a scope.
- **(not chosen) Scope always present,** "whole data ref" as the default for small sources. This needs a data-ref picker before the first signal can be shown, since the explorer lists all data refs today. It needs a whole-ref extent query to build the default, which is unbounded, so it contradicts D-078 on ADX anyway. It also changes every existing strip, catalog and prefetch scenario, with no gain for ClickHouse users.

The chosen design keeps the issue's „without a scope, behaviour stays as it is today", leaves all existing tests valid, and adds the scope as one code path that both modes share.

### Z1: Source contract (pinned, `apps/server/src/datasource.ts`)

```ts
/** One data ref and a half-open window [from, to), from < to (D-078, issue #1 item 1). */
export interface Scope {
  dataRef: string;
  from: Timestamp; // bigint ns
  to: Timestamp;
}
```

**Rule for every method that takes `scope`:** with a scope, the method answers exactly as if the source held only the timestamped rows (and event rows) of `scope.dataRef` with `scope.from ≤ time < scope.to`. Without a scope it answers as today. Where the method also takes a data ref or a `SignalRef`, the server never passes a scope of another data ref. An adapter MAY ignore `scope.dataRef` there, and MUST apply the time bounds. `abort` stays the last parameter.

| Method | New signature | With scope |
|---|---|---|
| `listSignals` (required) | `listSignals(scope?: Scope, abort?)` | signals of `scope.dataRef` with ≥ 1 row in scope; `text` from those rows |
| `before` (required) | `before(ref, t, scope?, abort?)` | last point in `[scope.from, min(t, scope.to))` |
| `after` (required) | `after(ref, t, scope?, abort?)` | first point in `[max(t, scope.from), scope.to)` |
| `refBuckets` (required) | `refBuckets(dataRef, width, times, scope?, abort?)` | non-empty buckets of the rows in scope (a bucket may be cut by an edge) |
| `raw`, `buckets`, `count` | unchanged | the server only sends ranges inside the active scope (Z5) |
| `extent` | `extent(ref, scope?, abort?)` | first and last point in scope |
| `refExtent` | `refExtent(dataRef, scope?, abort?)` | count, first, last of rows in scope |
| `refCount` | `refCount(dataRef, scope?, abort?)` | rows in scope (exact; no null-time rows) |
| `loggerGaps` | `loggerGaps(dataRef, grid, minGap, scope?, abort?)` | gaps between consecutive rows in scope; `last` = last row in scope |
| `firstTimes` | `firstTimes(dataRef, names, rows, scope?, abort?)` | up to `rows` times per name, from the rows in scope; no query for `[]` |
| `stateChanges` | `stateChanges(ref, by, limit, scope?, abort?)` | the first row in scope plus each change within the scope |
| `events` (capability) | `events(dataRef, limit, scope?, abort?)` | event rows in scope |

`DataSource = Required<SourceAdapter>` as today. `ping` and `info` are unchanged. `ping` reads no table rows, so it is the only query exempt from "no query without a data ref and a time filter".

### Z2: Fallbacks with a scope (pinned, `fallbacks.ts`)

Each fallback passes the scope through and swaps its `TIME_MIN … TIME_MAX` for `scope.from … scope.to`:

- `extent`: `after(ref, TIME_MIN, scope)` and `before(ref, TIME_MAX, scope)`.
- `refExtent`: `refBuckets(dataRef, MAX_BUCKET_WIDTH, true, scope)`.
- `refCount`: `refExtent(dataRef, scope)`.
- `loggerGaps`: `refBuckets(dataRef, grid, true, scope)`.
- `firstTimes`: `raw(name, scope.from, scope.to, rows)`.
- `stateChanges`: the page scan starts at `scope.from` and ends at `scope.to`.
- `count`: unchanged, because it already has a range.

Queueing, aborts, and `STATE_SCAN_PAGE`/`STATE_SCAN_MAX` stay as they are.

### Z3: Adapter queries (`clickhouse.ts`, `adx.ts`)

- **ClickHouse:** every query of a scoped call adds `AND <dataRef column> = {ref} AND <time column> >= {from} AND <time column> < {to}` as query parameters. `listSignals(scope)` is one `GROUP BY signal` query over the scoped rows with the text flag. Unscoped calls send byte for byte today's queries (data-source "ClickHouse answers as before").
- **ADX:** one helper builds the scoped table expression `<table> | where <dataref> == sref and <timestamp> >= sfrom and <timestamp> < sto`, with parameters `sref`, `sfrom`, `sto` and bounds rounded up to the tick as today. Every scoped query starts from that expression instead of the bare table (the prototype's „filtered sub-expression"). The same helper serves the events table. No new native method. Native `firstTimes` is the Azure users' contribution and must take `scope` as in Z1.

### Z4: Conformance cases with a scope (pinned for the tester, `apps/server/test/conformance/suite.ts`)

Two scopes over the C7 fixture of `add-adx-source` (B = `1791158400000000000`):

- **S** = `{conf-a, B + 170 s, B + 280 s}`: it holds `Beat.HB` k = 1,700 … 2,000 and 2,600 … 2,799 (501 rows) and `Diag.door` at B + 180 s (open) and B + 270 s (open). 503 rows in all.
- **S2** = `{conf-a, B + 5 s, B + 35 s}`: it holds `Lin.RAMP` n = 500 … 3,499, `Sna.CODE` n = 5 … 34, `State.MODE` n = 50 … 349 and `Beat.HB` k = 50 … 349. `conf-b/Lin.RAMP` lies in the same times but is another data ref.
- **S3** = `{conf-a, B + 230 s, B + 280 s}`: it starts inside the logger gap.

New cases, each also run `core only`:

| Case | Calls and expected answers |
|---|---|
| "lists the signals of a scope" | `listSignals(S)`: exactly `conf-a/Beat.HB` and `conf-a/Diag.door`, text only on `Diag.door`. `listSignals(S2)`: exactly `conf-a` `Beat.HB`, `Lin.RAMP`, `Sna.CODE`, `State.MODE`, no text, and no `conf-b` entry |
| "bounds the data-ref methods by a scope" | `refExtent(conf-a, S)` = {503, B + 170 s, B + 279.9 s}. `refCount(conf-a, S)` = 503. `refBuckets(conf-a, 60 s, times, S)`: starts B + 120 s (100 rows, 170 s … 179.9 s), B + 180 s (202, 180 s … 200 s), B + 240 s (201, 260 s … 279.9 s). `loggerGaps(conf-a, 1 s, 2 s, S)`: one gap B + 200 s → B + 260 s, last B + 279.9 s. With S3: no gap, last B + 279.9 s. `events(conf-a, 100, S)`: one row, `Diag.door` open at B + 180 s. `events(conf-a, 100, S2)`: none |
| "bounds the signal methods by a scope" | `extent(Lin.RAMP, S2)` = B + 5 s … B + 34.99 s. `extent(Fine.NS, S2)`: none. `before(Lin.RAMP, B + 5 s, S2)`: none. `before(Lin.RAMP, B + 40 s, S2)`: B + 34.99 s, value 3,499. `after(Lin.RAMP, B, S2)`: B + 5 s, value 500. `after(Lin.RAMP, B + 35 s, S2)`: none |
| "samples the first times in a scope" | `firstTimes(conf-a, [Lin.RAMP, Sna.CODE, Beat.HB, Nope.X], 1001, S2)`: `Lin.RAMP` 1,001 times from B + 5 s, `Sna.CODE` 30, `Beat.HB` 300, `Nope.X` absent |
| "finds state changes in a scope" | `stateChanges(State.MODE, labels 0 and 3, 100, S2)`: B + 5 s → 0, then B + 10 s → 3 after 0 at B + 9.9 s, nothing else (the SNA run is no change). `stateChanges(Diag.door, text, 100, S)`: one row, open at B + 180 s |

Every existing case keeps passing unscoped, unchanged.

### Z5: Shared DTOs (pinned, `packages/shared/src`)

```ts
// workspace.ts
/** The workspace's scope (D-078); decimal-ns strings like TimeRange; to − from ≥ MIN_SPAN_NS. */
export interface WorkspaceScope { dataRef: string; from: string; to: string }
export interface Workspace { /* … as today … */ scope?: WorkspaceScope }

// Commands (added to the Command union)
{ type: "scope.set"; dataRef: Id; from: TimeInput; to: TimeInput }   // refine: from < to, span ≥ MIN_SPAN_NS
{ type: "scope.clear" }
// view.open gains an optional server-resolved or caller-given scope:
{ type: "view.open"; view: …; name?: …; scope?: { dataRef: Id; from: TimeInput; to: TimeInput } }

export type CommandErrorCode = /* … */ | "scope_required" | "out_of_scope";
// CommandResult ok branch gains:
clamped?: true;   // the command moved a range into the scope (Z6)
// OpenReport.skipped[].reason gains "out_of_scope" (a signal of another data ref, Q-2 (a))

export interface ApplyContext {
  /* … as today, answered against the catalog of the scope the command leaves in effect … */
  /** Scoped mode (KIPSCOPE_CATALOG=scoped): scope.clear and catalog-checked commands need a scope. */
  scopeRequired?: boolean;
}

// scope.ts (new)
export const scopeKey = (s: WorkspaceScope | undefined): string; // "" without scope; else `${dataRef}|${from}|${to}`
/** Z6: keep the span and shift inside; a span wider than the scope becomes the scope. */
export function clampToScope(range: TimeRange, scope: WorkspaceScope): { range: TimeRange; clamped: boolean };
/** Z7: one span added on each side, clamped to TIME_MIN … TIME_MAX (Q-3 (a)). */
export function widenScope(scope: WorkspaceScope): WorkspaceScope;

// views.ts: Z8, the scope a view opens with, or undefined when it has no data ref or no time.
export function viewScope(doc: ViewDoc, pad: bigint): WorkspaceScope | undefined;
// views.ts: ViewDoc gains, written after `data` when the workspace has a scope:
scope?: { dataRef: string; from: string /* ISO UTC to the ns */; to: string };

// series.ts: Density gains
/** Present when computed for a scope: then first = scope.from and last = scope.to − 1 ns (Z9). */
scope?: { from: string; to: string };

// signals.ts: CatalogSnapshot gains
/** The scope this list belongs to; absent for the full catalog. */
scope?: WorkspaceScope;

// meta.ts
export type CatalogState = "loaded" | "loading" | "failed" | "no_scope";
export interface ServerMeta { /* … */ catalog: {
  mode: "full" | "scoped"; state: CatalogState; size: number; loadedAt?: string; reason?: string;
  /** The scope the state and size refer to; absent for the full catalog. */
  scope?: WorkspaceScope;
} }
```

HTTP payloads stay as they are, apart from these fields. The scope commands go through `POST /api/commands`, and there is no new route.

### Z6: Invariants and the clamp rule (pinned, `apply.ts`)

While `workspace.scope` is set, after every accepted command:

- every timeseries window's range lies within `[scope.from, scope.to]`;
- every cursor lies in `[scope.from, scope.to)`.

`clampToScope([f, t), [F, T))`, with span `s = t − f`:

- `s ≥ T − F` gives `[F, T)`;
- else `f < F` gives `[F, F + s)`;
- else `t > T` gives `[T − s, T)`;
- else the range is unchanged.

`clamped` is true iff the range changed. This one rule makes pan stop at the edge with its span intact, makes zoom out end at the whole scope, and makes "Go to" or Back land inside.

| Command | With a scope |
|---|---|
| `window.setRange`, `window.create` with range | range clamped; result `clamped: true` when changed |
| `cursor.set`, `cursor.move` to a time outside | rejected `out_of_scope` |
| `scope.set` | sets the scope; clamps every timeseries window; removes cursors outside; `clamped: true` when a range changed. Signals of another data ref stay in their windows (routes answer `out_of_scope` for them) |
| `scope.clear` | removes the scope; rejected `scope_required` when `scopeRequired` |
| `view.open` | `scope` from the command (Z10); windows clamped, with warning `ranges clamped to the scope` when one changed; cursors outside dropped, with warning `cursor A outside the scope dropped` |
| `window.addSignal`, `events.addSignal`, `view.open` without scope when `scopeRequired` and no scope | rejected `scope_required` |

Without a scope, every command behaves as today.

### Z7: Widen (Q-3)

"Widen" (UI) and `scope widen` (CLI) send one `scope.set` with `widenScope(scope)`, which gives `[from − span, to + span)`, clamped to the time bounds. A 2 h scope becomes 6 h, then 18 h, then 54 h. There is no `scope.widen` command: the server path stays the one of `scope.set`, and two tabs that widen at once each send an absolute scope.

### Z8: Scope of a view (`viewScope`, Q-1, Q-2)

1. `doc.scope` when present (no pad).
2. Else the data ref is the one of the first signal of the first timeseries window that has signals, else of any window, else of the events-line signals. Without any signal there is no scope.
3. The time is the union of every timeseries window's `[from, to)` and every cursor `t` (as `[t, t + 1 ns)`). Without either there is no scope.
4. The pad (`KIPSCOPE_SCOPE_PAD`) is applied on each side, clamped to the time bounds.

With Q-2 (a), window signals of another data ref go to `report.skipped` with reason `out_of_scope`. Events-line signals of another data ref are dropped with one warning.

### Z9: Density, gaps and events of a scope (`density.ts`, `gaps.ts`, `events.ts`)

- **Density with scope S:** one `refBuckets(S.dataRef, grid, false, S)` query, with no `refExtent`. Then `first = S.from`, `last = S.to − 1 ns`, `scope = {from, to}`, width and grid by today's rules over that span, and drives from the grid buckets as today. The bars span the scope, empty stretches included. Double-click ("whole recording") then shows the whole scope, and the drive keys step within it.
- **Gap info with S:** `loggerGaps(…, S)`. `through` is the last row in S. Periods come from `firstTimes(…, S)` for the signals that the gap info covers (which signals is `improve-query-priority`'s choice). The poll calls `refCount(S.dataRef, S)` for the active scope only.
- **Events with S:** `events(dataRef, MAX_EVENTS + 1, S)`, and `stateChanges(…, S)` for the events-line signals. The route's `from`/`to` intersect with S.
- **Caches** are keyed by `scopeKey(S)` (unscoped: by data ref as today) and dropped with that scope's catalog load. After a scope's catalog loads, the server prefetches its density, gap info and events, one after another, in the `background` class (`withPriority("background", …)`, as the full-catalog prefetches do). The poll is `background` too. Loading a scope's signal list for `scope.set` or an open is `interactive`, like every route.

### Z10: Server flow (pinned, new `apps/server/src/scope.ts`; `workspace.ts`, `routes/*`, `views.ts`, `main.ts`)

- **`CatalogStore`** holds the full catalog (full mode only, as today) and one `Catalog` per scope key. Each scope catalog is built by today's `Catalog` with `listSignals(scope)`, DBC and diag metadata and display names. The store keeps at most 4 scope catalogs and drops the least recently used. `load(scope, abort)` is single-flight per key and resolves when that catalog has loaded. `get(scope?)` returns the catalog, if any.
- **`scopeOf(request)`** is the one function a route uses to find the scope of the workspace it serves. Today that is the one workspace's `scope`. `add-multiuser` replaces it.
- **Scope-changing commands** (`scope.set`; `view.open` from `POST /api/commands`, `POST /api/views/open` and import with `open`):
  1. Resolve the target scope: the command's own, else `viewScope(doc, pad)` (Q-1 (a): in both modes).
  2. Await `catalogs.load(target)`. On failure answer 503 `catalog_unavailable` with `reason`, and leave the workspace unchanged.
  3. `workspace.execute({…command, scope: target}, contextOf(catalogs.get(target)))`.

  With no target in full mode, the open is today's path against the full catalog. With no target in scoped mode, it answers `scope_required`.
- **Other commands** get the context of the workspace's current scope catalog, or of the full catalog without a scope.
- **Routes:**

| Route | No scope, full mode | No scope, scoped mode | Scope S |
|---|---|---|---|
| `GET /api/catalog`, `/api/signals`, `POST /api/catalog/refresh` | as today | 409 `scope_required` | S's catalog (503 `catalog_unavailable` while it first loads); `CatalogSnapshot.scope` = S |
| `GET /api/extent`, `/api/series`, `/api/value` | as today | 409 `scope_required` | signal of another data ref: 409 `out_of_scope`; series range ∩ S (empty: 409 `out_of_scope`); `value` at t ∉ S: 409 `out_of_scope`; `before`/`after`/`extent` get S |
| `GET /api/density`, `/api/gaps`, `/api/events` | as today | 409 `scope_required` | `dataRef` ≠ S.dataRef: 409 `out_of_scope`; else Z9 |
| `GET /api/meta` | `mode` `full` | `mode` `scoped`, `state` `no_scope` | `scope` S, state and size of S's catalog |

- **Start-up:** in full mode as today, and a restored scope also gets its catalog loaded. In scoped mode there is no full catalog, no prefetch and no poll for all refs. A restored scope's catalog is kept loaded with `CATALOG_RETRY_MS`.
- **Scoped-mode guard:** in scoped mode the server wraps the completed source in `guardScoped`. A data call without `scope`, or a `raw`/`buckets`/`count` whose range is not inside a scope the store holds for that data ref, throws `ScopeGuardError` before it reaches the adapter, and the server logs it once per method as a bug.

### Z11: Configuration (pinned, `config.ts`, `.env.example`, `docs/data-sources.md`)

| Variable | Values | Default | Invalid |
|---|---|---|---|
| `KIPSCOPE_CATALOG` | `full`, `scoped` | `full` | stop naming the variable and both values |
| `KIPSCOPE_SCOPE_PAD` | a CLI duration (`parseDuration`: `30min`, `1h`, `0s`), ≥ 0 | `1h` | stop naming the variable |

### Z12: Web (`apps/web/src`)

- **Explorer** (`explorer/SignalExplorer.tsx`): reloads `/api/catalog` whenever `scopeKey(workspace.scope)` changes, and drops an answer whose `scope` key is not the current one. On 409 `scope_required` it shows `No scope set. Open a view link or run kipscope scope set REF FROM TO.` and stops retrying until the scope changes.
- **Strip** (`time/TimeStrip.tsx`, `time/strip.ts`): with a scope, the data ref is `scope.dataRef`. The head shows `SCOPE <ref> · <from> – <to>` (local, header format) with buttons **Widen** (one `scope.set`, disabled while pending) and, in full mode only, **Clear** (`scope.clear`). The right label reads `<shown> of <span> in scope · 1 bar = <width>`. In scoped mode without a scope it shows `No scope set`. All of it sits on one line, and the strip height stays ≤ 56 px.
- **Clamp message:** a range command whose result has `clamped` shows `Stopped at the scope edge. Widen shows more.` in the message line.
- **Windows:** a 409 `out_of_scope` shows the server's message in the window's error line, as other load errors do.
- **Footer** (`footer/items.ts`): catalog state `no_scope` reads `No scope`.

### Z13: CLI (`apps/cli/src`)

| Form | Sends | Prints |
|---|---|---|
| `scope set REF FROM TO` | `{type: "scope.set", dataRef, from, to}` (TIME rules, anchors included) | the command result; `--wait` as for other commands |
| `scope show` | `GET /api/workspace`, `GET /api/meta` | `data {scope, catalog {mode, state, size}}`, `local {from, to}` |
| `scope widen` | `GET /api/workspace`, then `scope.set` with `widenScope` | without a scope: exit 1, `error.code` `scope_required`, nothing sent |
| `scope clear` | `{type: "scope.clear"}` | the command result |

### Z14: Documents

`docs/data-sources.md` gains a section "Scope": the Z1 rule and table, "the server never sends a scope of another data ref", the Z2 fallbacks, the Z4 cases, and the ClickHouse and ADX filter shapes of Z3. The two variables of Z11 go in its variables table and in `.env.example`. `docs/http-api.md` gains a shared rule "Scope": routes are bounded by the workspace's scope, 409 `scope_required` and `out_of_scope` on routes, 422 for rejected commands. The README CLI list adds the `scope` forms.

## Questions for Jan

- **Q-1 Does opening a view set the scope in full mode too?** (a) Yes, in both modes: every open has a scope (explicit or derived and padded), so after an open no query is unbounded and navigation stops at the edge, also on ClickHouse; "Clear" in the strip returns to today's whole-history view. (b) Only in scoped mode, or when the view carries `scope`; full mode opens as today. **Recommended (a):** it is what D-078 says („shows one case at a time … every source query is bounded"), it is one code path, and it is testable on the ClickHouse test DB. The cost: your local views open with a 1 h pad and need "Widen" or "Clear" to go further. The spec is written for (a).
- **Q-2 A view whose signals come from several data refs.** (a) The scope takes the data ref of the first timeseries window's first signal. The other refs' signals are left out and reported as skipped `out_of_scope`. (b) Refuse the open with `invalid_view`. (c) Take the data ref with the most signals. **Recommended (a):** the open still shows something, the report names what is missing, and the views seen so far use one data ref. The spec is written for (a).
- **Q-3 How far one "Widen" goes.** (a) One scope span on each side (×3: 2 h → 6 h → 18 h → 54 h). (b) ×2 around the centre. (c) Straight to a fixed span such as 7 days. **Recommended (a):** few clicks from a session to days, and every step is a multiple of the case, so its context stays centred. The spec is written for (a).

**Jan's answers (2026-10-19):** „Empfehlungen übernehmen“: Q-1 (a), Q-2 (a), Q-3 (a), and the spec owner's defaults stand. Jan also: handed-over sessions are usually checked for gaps beforehand; gaps can occur but are rare („die Sessions die üblicherweise übergeben [werden] sind vorher auf lücken geprüft. es kann vorkommen, ist aber selten“), so gap info must never delay the first draw of a curve.

## Spec owner's defaults (Jan can veto)

- Z0: an optional scope plus `KIPSCOPE_CATALOG=full|scoped` (default `full`), rather than a scope that always exists.
- `KIPSCOPE_SCOPE_PAD` defaults to `1h`.
- One rule for the source contract: „as if the source held only the scope's rows". `before`/`after` do not look past the scope edge, so a value line ends there.
- Range commands are clamped (span kept, shifted inside), never rejected. Cursors outside the scope are rejected (set or move) or dropped (`scope.set`, open).
- `scope.set` to another data ref keeps the windows' signals. They show `out_of_scope` until moved or removed.
- In full mode a set scope uses its own signal list (`listSignals(scope)`) rather than a filtered full catalog, so both modes share one path.
- Widen is a client-computed `scope.set`, with no `scope.widen` command.
- Status codes: 409 for `scope_required` and `out_of_scope` on routes; 422 for rejected commands, as for every command.
- The scope catalog store keeps 4 scopes, least recently used dropped.
- The scoped-mode guard throws before the adapter, rather than only logging.
- A view's `scope` is optional and stays in `version: 1`. Older readers drop it with their usual unknown-key warning and open the view as before.

## Numbers: what if off by a factor of two

- **Pad 1 h:** 30 min still gives context around a 1–2 h window, but needs "Widen" sooner. 2 h makes a 5–6 h scope, which at the measured ≈ 1.6 s per 24 h stays well below a second on ADX. Neither is critical, and the value is a setting.
- **Widen ×3:** ×1.5 needs about twice as many clicks to reach days. ×6 reaches years in four clicks, and on ADX the catalog of a year-long scope would time out again (its failure leaves the old scope in place, Z10).
- **4 scope catalogs:** ≈ 2,300 entries each, a few MB at most. 2 would leave no room for neighbour preloading (`add-case-open`), and 8 costs nothing noticeable.
- **Conformance scopes S, S2, S3:** fixture facts, not tunables. Each one is chosen so that an edge cuts a run of rows, a logger gap or another data ref.
- **Goal "link opens on ADX within the timeout":** prototype 3 s for the catalog. Twice that is still usable, and only the Azure users can measure it on the real table.

## Risks / Trade-offs

- [A scope widened to years on ADX times out again] → the failed load leaves the old scope and catalog in place and the UI shows the error. A maximum span stays out of scope until someone needs it.
- [Third-party adapters break] → the four required methods gain a parameter (**BREAKING**). The only external adapter is the Azure users' unmerged one, and they asked for this contract.
- [A full-mode user loses whole-history browsing after an open (Q-1 (a))] → "Clear" restores it in one click.
- [`before`/`after` bounded by the scope] → a line or a cursor value right at the scope's start has no earlier neighbour. The pad makes that rare in the shown range.
- [Scope commands now await a catalog load inside `POST /api/commands`] → only `scope.set` and `view.open`. Other commands stay synchronous and are applied against the workspace as it is when they arrive.

## Fit with later changes

- `add-multiuser` (D-079): `scopeOf(request)` is the one place a request finds its workspace's scope. Catalogs are keyed by scope, so two users on the same case share one list.
- `add-case-open` (D-078): the handoff sends `view.open` with an explicit `scope`. A neighbour switch is one `scope.set`, which keeps windows and signals; it may add its own relative range move. Neighbours preload with `catalogs.load(neighbour)` into the 4-slot store, in the `preload` class of `improve-query-priority`.
- `add-signal-books` (D-080): the per-scope list holds names and today's metadata. Books later order the list and make metadata lazy, without changing the scope.

## Manual checks (lead)

- `KIPSCOPE_CATALOG=scoped` server against carserver: the start log shows no catalog load. Then `kipscope scope set smart451 "2026-10-13 14:00" "2026-10-13 16:00"`, and the explorer lists the signals within 3 s (goal). Then open a `#view=` link of a 20 min window.
- Full mode: open one of Jan's saved views, press `-` until the edge, read the message, click "Widen", then "Clear".

## Ledger entry on archive (proposed; the lead assigns the number)

- **Decision:** a scope (one data ref, `[from, to)`) is an optional workspace field. With it, every source query is bounded (contract argument `scope`, "as if the source held only the scope's rows"), the signal list is per scope, the strip, gaps and events cover the scope, and range commands are clamped into it. `KIPSCOPE_CATALOG=scoped` drops the start-up catalog and requires a scope. A view opens with its `scope` or a derived one padded by `KIPSCOPE_SCOPE_PAD` (1 h); view documents stay v1. "Widen" adds one span on each side. Jan's answers: Q-1 …, Q-2 …, Q-3 …
