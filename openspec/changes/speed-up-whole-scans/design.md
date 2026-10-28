# Design

## Context

See proposal.md "Why". This design follows two of Jan's decisions:
- D-117: „der datensee wird bald TBs haben"; „im see stochern über alles ist ja quatsch". No whole-data scans; finding is the search tool's job.
- D-118: „das einzige, was ich da noch wünsche ist die density in der zeitauswahl. die sollte einfach immer in niedrigster prio gefüllt werden". The calendar is filled day by day at the lowest priority.

### Measured facts

Measured by the lead on 2026-10-28, about 17:10 CET, against carserver: read-only user `letsview`, `readonly=2`, `max_execution_time` 30 s, `max_threads` 4. These limits are set on the ClickHouse side. We cannot add DDL or materialized views.

| Fact | Value |
|---|---|
| Table | `sdlog.signals`: MergeTree, `PARTITION BY vehicle`, `ORDER BY (vehicle, signal, utc)`, `utc Nullable(DateTime64(3))`, granularity 8192 |
| smart451 | 768,223,646 rows from 2026-10-11 12:34 to 2026-10-28 15:16 UTC, still growing (490 M on 2026-10-23) |
| One day (2026-10-27) | 114.9 M rows; 10,535 distinct seconds (2.9 h logged) |
| `count(), min(utc), max(utc)` over the vehicle | 19.5 s |
| `uniqExact(toStartOfSecond(utc))` | whole vehicle: TIMEOUT at 30 s; one day: 9.9 s (11.6 M rows/s) |
| `count()` over 8 days (filter on `utc`) | 1.5 s |
| `count()` with only the vehicle filter | from part metadata, 3.4 ms (2026-10-17, data-gaps G9) |
| Logger-gap query | ≈ 7 s for 131 M rows (2026-10-17; 18.7 M rows/s) |
| Hourly counts of one smart451 day | 5.1 s; a month in one query hits the 30 s limit (D-118) |
| Running server | `/gaps`, `/value` 502 after 30 s, `/density` 502 after 50 s (`refExtent` 19.5 s + buckets timeout) |

Further findings from reading the code:
- **Already bounded:** scoped mode exists, with `guardScoped` (`apps/server/src/scope.ts:253`) and `routeScope` → 409 `scope_required` (`apps/server/src/http.ts:205-224`). Every scan method already takes `scope`.
- **Full mode scans the whole data:**
  - the start-up catalog `SELECT DISTINCT vehicle, signal` (`clickhouse.ts:248-262`)
  - the density, gap and event prefetch of every data ref (`routes/series.ts:307-322`, `routes/events.ts:86-92`)
  - the gap poll over all data refs (`routes/series.ts:273-305`)
- **Object scope (Unlink) scans the whole vehicle:**
  - one `refExtent` over the vehicle (`objectScope.ts:20-68`, 19.5 s now)
  - the coarse density (`density.ts:169`)
  - the vehicle's own `listSignals` (`scope.ts:170`)
  - work windows of up to 32 d (`case.ts:41`), which hold up to 3.7 G rows of smart451
- **Calendar:** a 32-d window is one `refBuckets` (`calendar.ts`), which for a month of smart451 is the whole recording.
- **`case drives REF`:** reads `/api/density?dataRef=REF`, the whole data ref in full mode (`apps/cli/src/case.ts:82-104`).
- **Defaults:** Jan's `.env` sets no `KIPSCOPE_CATALOG`, so he runs full mode. `scopeApp.ts` (server tests) passes `mode: "full"` itself.
- **Smoke:** `pnpm smoke` opens the user's free workspace, sets no scope and blocks the page's writes (`scripts/smoke.mjs:172-206`).

## Goals / Non-Goals

**Goals:**
- No source call reads more than the scan bound, in any mode, except the calendar's vehicle-days. Those read one day each, at `idle`.
- A request that would exceed the bound answers `too_wide` within about one count (≤ 1 s on smart451 at the 7-d span), never 502 after 30 s.
- Value and series never wait for gap info of more than their scope or work window.
- `pnpm smoke` runs scoped and passes twice in a row on carserver.
- Identical answers on the test DB wherever the bound is not hit (the existing suite keeps its values, except the call counts named in the deltas).

**Non-Goals:**
- Chunked or cached whole-recording scans (the first idea for T-15, superseded by D-117).
- A per-vehicle session index on the server. Sessions come from the search tool's catalog or `case drives`.
- Removing full mode (Q-1).
- Bounding `/api/extent` of one signal, `stateChanges` and computed series beyond their scope. These read one signal or their inputs inside a scope, which the bound already limits.
- A native ADX `series` check (B9).
- Changing the patience hint (D-113). Unlink no longer queries, so the hint does not show.

## Shared interfaces

Server, web and CLI engineers build against these in parallel. Times are decimal ns strings on the wire.

### `packages/shared`

```ts
// series.ts: ApiError.error gains (code "too_wide", HTTP 422)
rows?: string;     // the range's refCount when the row budget decided
limit?: string;    // KIPSCOPE_SCAN_ROWS
span?: string;     // to − from (ns) when the span decided
maxSpan?: string;  // KIPSCOPE_SCAN_SPAN (ns)

// workspace.ts: CommandResult failure code union gains "too_wide", with the same four optional fields.

// scope.ts
export function tooWideText(e: { rows?: string; limit?: string; span?: string; maxSpan?: string }): string;
//   scope "Too wide answers": counts with "," groups (en-US), spans with formatSpan.
export function windowsScope(ws: Workspace, pad: bigint): WorkspaceScope | undefined;
//   viewScope's rule over the workspace: the first timeseries window's first signal's data ref; the union
//   of the timeseries windows' ranges and the cursors, padded by `pad` on each side; undefined
//   without a timeseries window with a signal.

// time.ts: moved from apps/web/src/time/strip.ts:66, unchanged rule (the strip keeps importing it)
export function formatSpan(ns: bigint): string;

// meta.ts: ServerMeta gains
limits: { scanRows: number; scanSpan: string; scopePad: string };

// case.ts
export const WORK_MIN_NS = 6n * 3_600_000_000_000n;
export function workWindow(view: TimeRange, scope: WorkspaceScope, maxSpanNs: bigint): TimeRange; // B3
export function objectSpan(
  cases: CasesDocument, dataRef: string, current: WorkspaceScope, pad: bigint,
): WorkspaceScope; // B4, object: true
// WORK_SPAN_MAX_NS (32 d) stays: it bounds /api/calendar windows and case drives ranges.

// calendar.ts: CalendarDensity gains
pending?: { from: string; to: string }[]; // UTC days of the window not counted yet; absent: none
export const CALENDAR_PENDING_REFETCH_MS = 3_000;
```

### HTTP

| Route / call | New answer |
|---|---|
| `GET /api/density`, `/api/gaps`, `/api/series`, `/api/value`, `/api/events`, `/api/catalog`, `/api/signals` (when a list load is refused) | 422 `{error: {code: "too_wide", message: tooWideText(…), rows?, limit?, span?, maxSpan?}}` |
| `POST /api/commands` `scope.set`, `view.open`, `case.go` / `case.step` / `case.link` | 422 `CommandResult {ok: false, code: "too_wide", message, …}`; workspace unchanged |
| `GET /api/density?dataRef&from&to`, scoped mode, no workspace scope | 200, source calls scoped to `{dataRef, from, to}` (was 409) |
| `GET /api/density` in an object scope without `from`/`to` | 400 `invalid_request` (was coarse); `Density.coarse` is never set |
| `GET /api/gaps`, `/api/events` in an object scope, window over `KIPSCOPE_SCAN_SPAN` | 422 `too_wide` (was 400 over 32 d) |
| `GET /api/calendar` unlinked or full mode | `pending` when days are not counted yet |
| `GET /api/meta` | `limits` |

### Server-internal, pinned between server write areas

```ts
// apps/server/src/scanBound.ts (new, S1)
export class TooWideError extends Error {
  readonly rows?: number; readonly limit?: number; readonly span?: bigint; readonly maxSpan?: bigint;
}
export interface ScanBound {
  readonly rows: number;
  readonly spanNs: bigint;
  /** Resolves when the range is within the bound, rejects with TooWideError; `range` undefined = whole data ref. */
  check(dataRef: string, range?: Scope): Promise<void>;
  /** The cached or fresh refCount of the range (shared with check). */
  count(dataRef: string, range?: Scope): Promise<number>;
}
export function createScanBound(
  source: Pick<DataSource, "refCount">,
  limits: { rows: number; spanNs: bigint },
  now?: () => number,
): ScanBound;

// apps/server/src/http.ts (S1)
export function tooWide(reply: FastifyReply, error: TooWideError): FastifyReply; // 422
// routeScope gains an option: in scoped mode without a scope, `ownWindow` is used as the source
// scope instead of answering 409.
routeScope(deps, request, reply, opts?: { ownWindow?: Scope });

// AppDeps (S1 wires in main.ts/app.ts): bound: ScanBound; calendarDays: CalendarDays

// apps/server/src/priority.ts (S3): QueryClass gains "idle", last in QUERY_CLASSES.

// apps/server/src/calendarDays.ts (new, S3)
export class CalendarDays {
  constructor(source: Pick<DataSource, "refCount" | "refBuckets">, opts: {
    dir: string;                 // <stateDir>/calendar
    sourceInfo: SourceInfo;      // kind, database, table: the file's identity
    scanRows: number;
    now?: () => number;
    warn(message: string): void;
  });
  /** 60 s buckets of the counted days in [from, to) and the UTC days not counted yet; queues those, front first. */
  window(dataRef: string, from: bigint, to: bigint): { buckets: GridBucket[]; pending: { from: bigint; to: bigint }[] };
  /** Days to count ahead (B6), behind any window() asks. */
  want(dataRef: string, days: readonly bigint[]): void;
  stop(): void;
}
// CalendarCache (S3) gains the constructor argument `days: CalendarDays` and uses it on the
// vehicle-day path; its `get(dataRef, from, to, scope)` signature stays, so the route is unchanged.
// fillAhead(days, workspaces): () => void (S3, in calendarDays.ts) is started by S2 in routes/series.ts.

// apps/server/src/fallbacks.ts (S1): completeSource(adapter, { scanRows?: number }), see B9.
// apps/server/src/scope.ts (S4): CatalogStore options gain `bound: ScanBound`; a refused list
// load rejects with TooWideError, which list routes and commands map to 422 too_wide.
// apps/server/src/objectScope.ts (S4):
export function workWindowOf(
  query: { from?: bigint; to?: bigint }, scope: WorkspaceScope | undefined, maxSpanNs: bigint,
): { from: bigint; to: bigint } | undefined; // WorkWindowError (400) without from/to; TooWideError over maxSpanNs
// ObjectExtents and objectExtentsOf are removed (S4); routes/series.ts (S2) and routes/events.ts
// (S4) pass deps.bound.spanNs.
```

## Decisions

### B1 The scan bound: 150 M rows, 7 d

`KIPSCOPE_SCAN_ROWS` defaults to 150,000,000, `KIPSCOPE_SCAN_SPAN` to `7d`. The rows decide the cost; the span check only saves the count on ranges that are surely too wide.
- **Rows:** the slowest measured whole-range work is `uniqExact` per second, 11.6 M rows/s. 150 M rows take about 13 s, less than half of the 30 s limit. The logger-gap query (18.7 M rows/s) takes about 8 s.
  - Off by 2× upward (300 M): about 26 s at the slowest rate, so timeouts under load. Rejected.
  - Off by 2× downward (75 M): one full smart451 day (114.9 M) is refused, and the 1-d scope of the lead's measurement fails. Rejected.
  - So 150 M is the largest value that keeps a 2× margin. A rate twice as slow as measured still stays under 30 s (26 s, no margin), which L-1 checks.
  - If smart451's busiest days grow past 150 M rows (+30 %), a 1-d scope is refused and the user picks a shorter one. Sessions are hours.
- **Span:** a count over 8 days took 1.5 s, so refusing a 7-d range costs at most about 1.3 s.
  - Off by 2× upward (14 d): about 3 s to refuse; harmless.
  - Off by 2× downward (3.5 d): sparse sessions of 4–7 d with few rows are refused although their rows would fit.
- Both are environment variables, so Jan can tune them without a release.

### B2 One count per range, shared

`createScanBound` keeps one `refCount` promise per `(dataRef, from, to)`: single-flight, kept 5 min, a failure not kept, at most 256 entries with the least recently used dropped. The checks that share it:
- the scope's list load
- its density
- its gap info, which already counted first (`gaps.ts` `startLogger`): that count now comes from the bound, so gaps send no extra query
- its calendar on the plain path

For a whole data ref (full mode) the count is the metadata-only `count()`, 3.4 ms.
- **5 min:** off by 2× (10 min), a live range that crossed the budget is refused up to 10 min late, which is harmless. At 2.5 min, one more count per range every 2.5 min.
- **256 entries:** each is three strings and a number; off by 2× either way it is still nothing.
- **Alternative rejected:** a span bound only. Rates differ per vehicle and grow (490 M → 768 M in 5 days), so only rows track the cost.

### B3 Work window: view ± one span, 6 h to `KIPSCOPE_SCAN_SPAN`, whole hours

`workWindow(view, scope, maxSpan)`:
1. Start from `[from − span, to + span]`, where span is the view's own span.
2. If that is shorter than 6 h, take the 6 h centred on the view instead.
3. If it is longer than `maxSpan − 2 h`, take `maxSpan − 2 h` centred on the view's centre instead.
4. Floor `from` and ceil `to` to whole UTC hours, so the result is at most `maxSpan`.
5. Cut to the scope.

Whole hours replace whole days so that a window fits under 7 d with room to spare.
- **6 h:** smart451's busiest day logged 2.9 h with 114.9 M rows, so 6 h around a view holds at most one such day's rows, within 150 M.
  - Off by 2× upward (12 h): heavy windows are refused more often and fall back to the shown range.
  - Off by 2× downward (3 h): a pan of more than 3 h fetches gaps, events and drives again.
- **Fallback:** when a work window answers `too_wide`, the web asks once with the shown range (object-view "Gaps and events follow the view").
- **Alternative rejected:** keeping 32 d (up to 3.7 G rows of smart451).

### B4 Unlink from the catalog

`objectSpan(cases, dataRef, current, pad)` is the union of `caseScope(entry, pad)` over the entries whose data ref is `dataRef`, widened to hold `current`, with `object: true`. `routes/workspace.ts` passes it where it passed `objectExtentsOf(deps).get(…)`. `ObjectExtents` and its `refExtent` go. `caseApply` keeps taking the extent as an argument, so `packages/shared` only adds `objectSpan`.
- **Origin:** D-117 supersedes D-086's "whole series" for the source; Q-3 offers D-087 Q-5's retention window instead.
- **What the user sees:** Unlink answers at once, and the patience hint (D-113) no longer shows.

### B5 Object scope without whole-vehicle reads

- The coarse density goes (object-view REMOVED). The strip in an object scope asks only `/api/density?from&to` for the work window. It draws the presence line and drives there, and the catalog marks everywhere. Its label reads `… in catalog`.
- `CatalogStore` in an object scope keeps returning the last linked session's list with `partial: true`. It no longer calls `listSignals(objectScope)` (`scope.ts:170`).
- **Q-4:** whether a work-window list should be added later.

### B6 Calendar day store (D-118)

**Unit.** One UTC day of one data ref is one vehicle-day.
- It is counted by one `refBuckets(ref, 60 s, false, {ref, day, day + 1 d})`, after the bound's `refCount` of that day.
- A day above the bound's rows is counted in four 6 h parts instead.
- 60 s buckets give both the hours and the drives on the calendar's 60 s grid (range-picker R3), so the day store answers exactly what one `refBuckets` over the window answered. Drives across day edges come out right, because `findDrives` runs over the concatenated buckets.
- **Alternative rejected:** hourly counts only. They lose the drives.

**Class.** `idle`, after `preload` in `QUERY_CLASSES`. The queue (`queue.ts`) starts an idle task only while no interactive task runs or waits, and while no other idle task runs. It still never takes the kept slot. Requests never raise idle work (D-118 „immer in niedrigster prio").
- **One in flight:** a day takes about 5.1 s on carserver. Two in flight would halve the fill time but use half of carserver's 4 cores during a user's idle moments. At one, two months of one vehicle take about 5 min of otherwise idle time (D-118).

**File.** `<KIPSCOPE_STATE_DIR>/calendar/<encodeURIComponent(dataRef)>.json`:

```json
{"version": 1, "source": {"kind": "clickhouse", "database": "sdlog", "table": "signals"}, "grid": "60000000000",
 "days": {"<day start ns>": {"countedAt": "<ns>", "final": true, "buckets": [["<start ns>", 1234], …]}}}
```

- It is written as a temporary file renamed in place, at most once per 10 s per data ref (off by 2× either way: up to 20 s or 5 s of counted days lost on a crash, which are counted again).
- A file of another source, or one that does not parse, is ignored with one log line.
- **Size:** smart451 logged 10,535 s on its busiest day, at most about 180 non-empty minutes, so about 66 k pairs, ≈ 1.5 MB per vehicle-year. At 2× that, 3 MB, still small.

**Final.** A day is final once it was counted when its end lay more than 1 h in the past; it is never counted again. Other counted days are counted again at most every 5 min while an open workspace uses the data ref.
- **1 h:** the logger uploads in chunks, and a backfill after the gap info was computed happened (D-068 G9).
  - Off by 2× upward (2 h): one more recount of yesterday, which is harmless.
  - Off by 2× downward (30 min): rows of yesterday uploaded more than 30 min after midnight are never counted, because the day is already final. Late uploads are the risk either way; Q-6 asks whether a manual "recount" is wanted.
- **5 min:** as the gap poll. Off by 2× either way, today's bars are 10 min or 2.5 min stale.

**Fill ahead.** `fillAhead` runs every 5 min (`GAP_REFRESH_MS`) and on every change to the set of open workspaces. For each open workspace it wants:
- the data ref: the scope's, or the first timeseries window's first signal's
- the UTC days of the UTC month that holds that window's range start and of the month before, ±1 day for local time zones

`window()` asks go first, newest day first.
- **Two months:** the picker shows two (D-116). Off by 2× (four months): 4 × 30 × 5.1 s ≈ 10 min of idle source time per vehicle once; one month: the left month of the picker fills on open.

**Paths.** A plain (non-object) scope keeps today's single exact scoped `refBuckets`, after the bound. This keeps D-116's "with a linked catalog it shows the session only" exact to the row. Object scopes and full mode without a scope use the day store, cut to the object scope.

**Web.** `CalendarDensity.pending` marks UTC days. A local day that overlaps one shows the dotted baseline. While the picker is open with `pending`, it refetches every 3 s (off by 2×: 6 s feels laggy on a 5 s day, 1.5 s doubles the requests, all cache hits).

### B7 Scoped by default; full stays opt-in

`catalogMode` defaults to `scoped` (`config.ts:241-246`).

Full mode keeps its catalog load (a whole-table `SELECT DISTINCT`), so it is documented as for small sources only. The bound limits everything after the load:
- density and gap prefetch, gap polls and events prefetch only for data refs whose metadata count is within the bound
- requests for larger data refs answer `too_wide`

Migration:
- **Test DB:** `scopeApp.ts` already passes `mode: "full"`. `config.test.ts` gets the new default. Any test that builds a config through `loadConfig` without the variable and relies on full mode sets `KIPSCOPE_CATALOG=full` (tester, T-2).
- **Jan's local use:** nothing to set. The dev server starts scoped, and Jan's workspace shows the Scope card prefilled from his windows. `kipscope scope set smart451 …` or `kipscope case drives smart451 FROM TO > drives.json` with `kipscope case open drives.json` give him sessions. The README "Run" section says so; `.env.example` lists the new default and both bound variables.
- **Rollback:** `KIPSCOPE_CATALOG=full` with the bound at its defaults gives today's behaviour for small sources.

### B8 Scope card

`apps/web/src/help/ScopeCard.tsx` is a new card. It is placed by `App.tsx` above the Start card when `meta.catalog.mode === "scoped"` and the workspace has no scope. It is never shown while a catalog is open, since a catalog always sets a scope.
- **Fields:** From and To are parsed with `parseTime` (`packages/shared/src/localtime.ts:86`), the CLI's time rule. The data ref field suggests the data refs of the workspace's signal IDs.
- **Prefill:** `windowsScope(workspace, BigInt(meta.limits.scopePad))`.
- **Windows meanwhile:** timeseries windows check `no_scope` and draw `No scope set` without requests, so nothing reports an error before a scope exists.
- **Alternative rejected:** setting the derived scope silently on start (Q-5). It would scan without the user choosing the range.

### B9 Series bound in the fallback; ADX

`completeSource(adapter, {scanRows})` makes the `series` fallback throw `TooWideError` when its `count` exceeds `scanRows`, before `raw` or `buckets`. ClickHouse uses that fallback, so its series are bounded with no extra query.

ADX:
- ADX's native `series` sends no count, so it is not checked: its scope bounds it, and ADX enforces its own limits.
- Its `refCount`, `refBuckets`, `loggerGaps` and `listSignals` take the scope already, so the bound, the day store and the work windows work unchanged.
- In full mode on ADX the start-up catalog would still be a whole-table summarize: full mode is for small sources (B7).

No adapter and no contract file changes (data-source "No contract change").

### B10 `case drives REF FROM TO`

The CLI (`apps/cli/src/case.ts`) loops over the UTC days of `[FROM, TO)`, at most 32 days.
- One `GET /api/density?dataRef=REF&from=<day ∩ range>&to=…` at a time; on `too_wide`, four 6 h parts.
- Drives are merged where one ends exactly at a part edge and the next starts there.
- The server allows this density without a workspace scope in scoped mode (`routeScope` `ownWindow`), bounded like any scan.
- **Cost:** about 5 s per smart451 day (one detail density), so 2.7 min for 32 days. Off by 2× slower: 5.4 min, acceptable for a test aid run once.

### B11 Smoke with its own scoped workspace

`scripts/smoke.mjs`:
1. Before Chrome starts, it posts `/api/workspaces {open: {view}}` itself (Node `fetch`, not through the page). The view is a v1 document with `scope` from `--scope REF FROM TO` (default `smart451 2026-10-27T00:00:00Z 2026-10-28T00:00:00Z`, 114.9 M rows, within 150 M) and one timeseries window with `--signal` (default `smart451/BMS.cell_voltage_max`) over 10:00–11:00Z.
2. It opens `/w/<id>`, with the page's writes still blocked as today.
3. It deletes the workspace with `DELETE /api/workspaces/<id>` on every exit path.

The `--preview` run does the same against the preview's proxy target.
- **Default day:** if 2026-10-27 grows past the bound by a later backfill, the smoke reports `too_wide` and the lead passes `--scope`. The default stays a measured fact, not a guess.

## Risks / Trade-offs

- [Full mode's catalog load stays a whole-table scan] → It is opt-in, documented for small sources, and not the default. Q-1 asks whether to delete it.
- [A heavy day grows past 150 M rows] → That day's 1-d scope is refused with a clear text; the user picks hours. Sessions from the search tool are hours.
- [`refCount` with a time filter is a scan of `utc`] → It takes ≤ 1.3 s at the 7-d span, and is shared per range for 5 min.
- [Unlink spans only the catalog's sessions] → Data between and beyond those sessions is still reachable inside the span, but not before or after it. This is D-117's direction; Q-3 offers the retention window.
- [Day store missing a late chunk of a final day] → The 1 h lag (B6); Q-6 asks about a recount.
- [The real-data scenarios of other specs (cursors, events, …) assume full mode on smart451] → They run with a scope now. Those outside this change's deltas belong to todo Q-08.
- [The idle class never runs on a busy server] → That is by design (D-118). The calendar shows days not counted yet, and the UI user and L-1 report the fill time.

## Migration Plan

1. Merge with the defaults. Jan's dev server restarts scoped, his workspace shows the Scope card, and he sets a scope or opens a catalog.
2. The state directory gains `calendar/`. Deleting it only costs a recount.
3. Rollback: `KIPSCOPE_CATALOG=full` (small sources), or revert the change.

## Questions for Jan

Jan, 2026-10-28: „ja passt“: every default below stands (Q-1 … Q-7).

Each has a default that the specs and tasks use; an answer other than the default changes only the named requirement.

- **Q-1 Full mode:** keep `KIPSCOPE_CATALOG=full` as an opt-in for small sources such as the test DB and demos (**default**), or remove it entirely? Removing it means migrating about 20 server test files to scopes (one more round).
- **Q-2 Bounds:** 150 M rows and 7 d per query, and a work window of 6 h to 7 d (**default**, B1, B3). With these a full smart451 day is a valid scope today; a week is not.
- **Q-3 Unlink span:** the span of the catalog's sessions of that vehicle, padded (**default**, D-117)? Or D-087 Q-5's "the source's retention ending now" (`KIPSCOPE_OBJECT_RETENTION`)? The latter makes the strip mostly empty, but lets one pan before the first session.
- **Q-4 Signal list while unlinked:** the last linked session's list only (**default**), or also the list of the current work window (one more bounded scan per window)? With the default, a signal that never occurs in that session cannot be added while unlinked.
- **Q-5 Workspace without a scope:** the Scope card, prefilled from the windows, with the windows quiet (**default**)? Or set that derived scope automatically on start?
- **Q-6 Calendar days:** final 1 h after their end and never recounted (**default**)? Or also a manual "Recount day" in the day's tooltip menu, for late backfills?
- **Q-7 Calendar in a plain scope:** keep D-116's "session only" (**default**)? Or show the vehicle's other days from the day store, muted? Picking such a day would then mean leaving the scope.
