# Design

## Context

Thirteen bug fixes and four doc items from the review day of 2026-10-28 ([docs/todo.md](../../../docs/todo.md)); see proposal.md "Why". The main specs already state the intended behaviour; the deltas add one sentence and a testable scenario per fix. The fixes are local: no new route, no payload change, no new type in `packages/shared`. Server, web, CLI and shared work runs in parallel on disjoint files (tasks.md "Write areas").

## Goals / Non-Goals

**Goals:**
- Each fix pinned to its file and function, so an engineer needs no exploration.
- Every fix behind a test that fails today (the tester writes it from the scenario first).

**Non-Goals:**
- Refactors beyond the fix (the one exception: the cursor click logic moves into a testable class, T-07).
- The default workspace (`defaultOf`, CLI without `--workspace`) during a catalog open: it may pick the workspace being filled. Not found by the review, not in todo.md; noted under Risks.
- Other Caps Lock letters (`t`, `p`, `n`), committing a waiting click on close: proposal "Out of scope".

## Shared interfaces

None between write areas. Two HTTP answers are new and need no client change:

| Route | New answer | Body | Client |
|---|---|---|---|
| `POST /api/commands` with `type: "view.markSaved"` | 400 | `CommandResult {ok: false, code: "invalid_command", message: "views are marked saved only by POST /api/views"}` | Neither the web nor the CLI sends it (only `routes/views.ts` executes it on the store directly) |
| `GET /api/case/preview?index=N`, entry N outside the grant | 403 | `apiError` form, code `forbidden_data`, message `data ref <ref> is not permitted` (the guard's text, `guard.ts` `forbiddenData`) | `apps/web/src/preload/preload.ts` `run` rejects and ends that preload run, as on any failed preview today; no change |

## Decisions

### T-01 Zoom history key (`apps/web/src/chart/zoom.ts`, `apps/web/src/App.tsx`)

New export in `zoom.ts`, beside `historyKey`:

```ts
/**
 * History and pending-navigation key of a window in `ws` (case-navigation "Zoom history per
 * session"): historyKey(ws.linkTime, windowId, index) with index = ws.case.current while a catalog
 * is open and linked, else no index. `ws` undefined: historyKey(true, windowId).
 */
export function workspaceHistoryKey(
  ws: Pick<Workspace, "linkTime" | "case"> | undefined,
  windowId: string,
): string;
```

`App.tsx`: `navKeyOf` (line ~192) is replaced by `workspaceHistoryKey`, and the three direct calls go through it too: `onZoomed` (~789), `onBack` (~872, both the history and the `pendingNav` delete), `canGoBack` (~1438, with `workspace` instead of `linked`). Every call passes `liveRef.current.workspace` (or `workspace` in render), so a key never mixes the state of two renders. Afterwards `App.tsx` imports `workspaceHistoryKey`, not `historyKey`.

- **Unlinked has no index (spec owner's pick, a necessary consequence):** while unlinked the windows show the whole vehicle, outside every session's scope; a Back there into a session range, or after Link a Back into a vehicle range, would set a range the other mode's scope clamps. So the vehicle view keeps one history of its own (the key without index), and Link returns to the session's. Alternative considered: index also while unlinked (`case.current` is the session left); rejected for the reason above. The lead may put this to Jan; it changes no task.
- `pendingNav` uses the same key; an entry under the old session's key is ended by the existing effect (server range outside its chain) after the step.
- No eviction of old keys: one `ZoomHistory` per (window or `*`) × session index; a catalog of 200 sessions stepped through fully makes 200 small histories in the tab. Twice that is still a few hundred arrays of ranges; no limit needed.

### T-02 `view.markSaved` at the command endpoint (`apps/server/src/routes/workspace.ts`)

`namedViewOpen(body)` (line ~483) becomes `endpointRefusal(body): string | undefined`, giving the message for a named `view.open` (as today) or for any `view.markSaved` (table above), else undefined. `POST /api/commands` answers 400 with that message. `routes/views.ts` keeps calling `workspace.execute({type: "view.markSaved", …})` on the store, which never passes this endpoint. `applyCommand` is unchanged.

### T-03 Preview grant (`apps/server/src/routes/case.ts`)

In `GET /api/case/preview`, right after `caseEntryOf` gave `target` and before `caseScope` / `catalogs.load`: `if (!covers(deps.workspaces.grantOf(entry.record.id), target.dataRef)) return apiError(reply, 403, "forbidden_data", \`data ref ${target.dataRef} is not permitted\`)`. `covers` from `../rights.ts`, the grant the same way `runCommand` gets it (`workspace.ts` ~line 110). The route's guard config (`dataRefs: false`) stays: the data ref comes from the catalog, not the request, as for `case.go`.

### T-04 Filling workspace (`apps/server/src/workspaces.ts`, `apps/server/src/routes/workspaces.ts`)

Registry:

```ts
create(owner: string, options?: { filling?: boolean }): WorkspaceEntry;
/** Ends the fill of a catalog open: filling false, claimedAt = now (a reuse skips it for REUSE_CLAIM_MS). No-op for an unknown ID. */
filled(id: string): void;
```

- `Held` gains `filling: boolean` (in memory only, never written; a restart starts with none).
- `reuseOf` skips a held entry with `filling`; `create`'s eviction at the limit skips it (`find((e) => !hasClients(e) && !filling(e))`).
- `openCase` builds a new `Held` through `add`; it copies `filling` (and `claimedAt`) from the old one, so the fill survives the swap.
- Route `openCases`: `workspaces.create(user, { filling: true })`; everything after it runs in `try { … } finally { workspaces.filled(id); }`. The failure paths delete the workspace first (`fail`), so `filled` is a no-op there; on success the opener's tab gets the 10 s claim before its live connect (`touch`) clears it.
- Alternative considered: claim with `claimedAt` at create time only. Rejected: the loads before `openCase` can take longer than 10 s on ADX (D-113 measured 12–18 s for a vehicle's extent), and an expired claim brings the race back.

### T-05 Edge points under another scope (`apps/web/src/chart/cache.ts`)

New exported pure helper:

```ts
/**
 * `tile` as the server would answer it under `scope` (series-cache "Tiles kept across scopes"):
 * a raw tile without `before` when before.t < scope.from, without `after` when after.t >= scope.to;
 * the same object when nothing is dropped (also for bucket tiles and without a scope).
 */
export function scopedTile(tile: Tile, scope: CacheScope | undefined): Tile;
```

`CacheScope` gets `export`. `use()` returns `scopedTile(found[1].tile, scope)` instead of the stored tile, so `findUpTo`'s own, parent (`deriveRaw`) and merged (`mergeUp`) paths all see the scoped tile; the stored tile keeps both points. To keep the object stable across frames, `Stored` keeps the last copy: `scoped?: { key: string; tile: Tile }` (one entry, the last scope key asked); a copy is made only when a point is dropped. Times compare as `BigInt(point.t)`.

### T-06 Esc for the range picker (`apps/web/src/bar/RangePicker.tsx`)

The `onKeyDown` on the dialog root (line ~444) goes. Instead, while mounted, the picker adds one `keydown` listener on `document` (`useEffect` with cleanup) that, for `Escape` with `!e.defaultPrevented`, calls `preventDefault`, `stopPropagation` and the latest `onClose` (through a ref). `onClose` is `RangeControl`'s `close`, which already returns focus to the range button. `App.tsx` stays as it is: it ignores keys while the picker is open, and `document` listeners run before its `window` listener. A control inside the picker that wants Esc for itself calls `preventDefault` (none does today).

### T-07 Waiting cursor click (`apps/web/src/chart/cursors.ts`, `apps/web/src/chart/TimeseriesWindow.tsx`)

New class in `cursors.ts` that owns today's `pendingClick` logic of `TimeseriesWindow.tsx` (`placeClick` ~913, the double-click part of `dblclick` ~1256):

```ts
export class CursorClick {
  constructor(
    gate: ClickGate,
    on: {
      preview: (name: CursorName, t: bigint | undefined) => void;
      commit: (name: CursorName, t: bigint) => void;
    },
  );
  /** A click of `name` at t: a waiting click of the other cursor is committed now; preview(name, t); commit after the gate's interval. */
  place(name: CursorName, t: bigint): void;
  /** The double-click's clicks place no cursor: drops the waiting click, preview(name, undefined). */
  doubleClick(): void;
  /** The window closes: drops the waiting click and calls preview(name, undefined) when one waited. */
  dispose(): void;
}
```

`TimeseriesWindow.tsx` makes one `CursorClick` per window (`useMemo`, callbacks through the existing `onCursorPreviewRef` / `onCursorCommitRef`), calls `place` where `placeClick` was, `doubleClick` in the `dblclick` binding, and `dispose` in the unmount effect that today calls `gate.dispose()`. `ClickGate` is unchanged. Dropping (not committing) on close: the spec's "one `cursor.set` once the interval has passed" assumes the window still exists; a commit after its window is gone would place a cursor the user can no longer see being placed.

### T-08 Caps Lock (`apps/web/src/keys.ts`)

In `navKey`: `case "a": case "A": return e.shiftKey ? "cursorA" : undefined;` and the same for `b` / `B`. With Caps Lock and Shift the browser reports `a`; with Caps Lock and no Shift `A` with `shiftKey` false, which stays unbound.

### T-10 `state` in order (`apps/cli/src/run.ts`)

`case "state"`: `const current = await lookups.workspace();` then `const render = await client.get<RenderStatus>("/api/render-status");`. The client prefixes the second request with the workspace of the first answer (cli "One workspace per call"). One more round trip, a few ms on loopback.

### T-11, T-12 Highlight ranges (`packages/shared/src/search.ts`)

- `ranges` continues the search for a term at `i + 1` instead of `i + t.length`; the merge already joins overlaps.
- New private helper:

  ```ts
  /** Lower case of `text` per code point; from[j] / to[j]: the UTF-16 span in `text` of the code point that lower unit j came from. */
  function foldCase(text: string): { lower: string; from: number[]; to: number[] };
  ```

  `buildSearchIndex` builds every lower-case field with `foldCase(x).lower` (so tiers and ranges see the same text). `ranges(original, terms)` takes the original string, folds it, finds the terms in `lower`, maps each found `[s, e)` to `[from[s], to[e - 1]]`, then sorts and merges as today. `searchSignals` passes `s.name`, `shownName(s)`, `s.unit ?? ""` and `s.description ?? ""`. Ranges are built only for matched signals, as today. A fast path is allowed: when `lower.length === text.length` and no code point changed length, the maps are the identity.
- Cost: folding per code point is slower than one `toLowerCase`; the index is built once per catalog (≤ 10,000 signals, concept §3). Twice the signals or twice the cost stays within a few ms per build; the per-keystroke work is unchanged except for matched rows' ranges.

### T-13 Sidebar icon (`apps/web/src/styles.css`)

`.option-bar-slot .sidebar-toggle` (line ~766): `color: var(--label)` instead of `var(--text)`.

### T-14 CLI nits (`apps/cli/src/args.ts`)

- `take` (line ~434): when `max` is `Number.POSITIVE_INFINITY` the message is `` `${form} takes at least ${min} argument${min === 1 ? "" : "s"}, got ${args.length} (see --help)` ``; the other two forms stay. `events list` (`[0, ∞)`) never fails the count.
- `calc add` and `calc edit`: after reading `--name`, `if (name !== undefined && name.trim() === "") usage("NAME is empty")`. `--unit ""` stays allowed (ComputedUnit allows `""`). Same check text as `fav add` (`NAME is empty`).

### Docs and cleanup

- `docs/http-api.md` line 18 "Request class": `GET /api/series`, `GET /api/extent`, `GET /api/calendar` and `GET /api/case/preview`. `apps/server/src/http.ts` comment above `withRequestClass` (~line 240): "Only `/api/series`, `/api/extent`, `/api/calendar` and `/api/case/preview` call it". `case-preload` "Preload class" gains `/api/calendar` (D-116).
- `README.md` "CLI" table, after `diff on|off`: `` `digits 3\|4` | `workspace.setOptions {digits}`: significant digits of values in every UI of the workspace ``; after `measurement clear`: `` `events filter FILTER…` | `events.setFilter`: the filter of the events line and list (`""` for no filter words) ``, `` `events add SIGNAL` | `events.addSignal`: state changes of SIGNAL on the events line ``, `` `events remove SIGNAL` | `events.removeSignal` ``, `` `events list [FILTER…] [--ref DATAREF] [--from TIME --to TIME] [--table]` | `GET /api/events`: the events of DATAREF (default: that of the first signal shown) under FILTER (default: the workspace's); `--table` prints lines instead of JSON ``. The engineer checks the route and wording against `apps/cli/src/run.ts` and the `--help` text (args.ts lines 89–111) and keeps the table's style. Output-key sentence (line ~312): `` `ok`, `outcome`, `exitCode`, and where they apply `workspace`, `accepted`, `command`, `revision`, `created`, `createdWindow`, `removedWindow`, `render`, `data`, `local`, `error` `` (the order of `apps/cli/src/output.ts`).
- Dead code (D-092 removed the Span select and the header range): `SPAN_PRESETS` and its `NS_PER_S` in `apps/web/src/bar/bar.ts`; `formatRange` in `apps/web/src/time/axis.ts` (and any import only it used); the `describe("formatRange")` block and its import in `apps/web/test/axis.test.ts`. `bar.test.ts`'s regex that asserts `SPAN_PRESETS` is absent from `OptionBar.tsx` stays.
- `docs/status.md` needs nothing (proposal).

## Numbers

| Number | Where from | Off by a factor of two |
|---|---|---|
| 10 s reuse claim after a fill | design M4 of the workspaces spec, unchanged | A tab that needs 20 s to connect could be shared with a reuse, as today for any reuse; the fill itself is covered by `filling`, not by time |
| 500 ms double-click interval (`DOUBLE_CLICK_MS`) | existing | The ghost window is as long as the interval; the fix does not depend on its length |
| 1 s wait in the ghost-line UI check | spec owner | 2× the 500 ms interval, so the read-back comes after the gate would have fired and a stray `cursor.set` would show in `kipscope state`; at 0.25 s such a commit could still be pending and the check would pass on a broken build. Longer waits change nothing |
| 5 s / 2 s / 10 s offsets in the cache scenario | spec owner | Any positive values with S2 inside the edge points and S3 outside them give the same result |
| 10,000 signals | concept §3 | `foldCase` cost: see T-12 |

## Risks / Trade-offs

- [`workspaceHistoryKey` changes the key of every existing history when a catalog is open] → histories are per tab and in memory; the only visible effect is the intended one. The UI check "Back per session on smart451" and the existing time-navigation Back checks guard it.
- [`scopedTile` copies could break identity-based memos] → the per-entry `scoped` cache returns one object per scope key; `cache.test.ts` "keeps tiles across scopes" must stay green.
- [A document `keydown` listener could catch an Esc meant for something else while the picker is open] → the picker closes on any outside pointer down, so nothing else is open; inner controls keep theirs with `preventDefault`.
- [`filled` in `finally` also runs after an unexpected throw] → the throw paths delete the workspace (`fail`, the `openCase` catch); for any other throw the workspace stays, claimed for 10 s and then reusable, as before this change.
- [Default workspace during a catalog open] → `defaultOf` may return the filling workspace to a CLI call without `--workspace`; its command lands in the store `openCase` replaces. Not in todo.md; left for a later finding.
- [A refused preview ends the preload run] → only for a catalog entry outside the grant, which only state carried over from identity `none` produces; the step itself is refused the same way.
