# Design

## Context

A search tool's team (finder; not part of KIPscope and not named here, D-090) built against `docs/handoff.md` and the `add-case-open` code and reported findings in GitHub issue #1 (comment 2026-10-21). The lead checked each against the code; Jan approved group 1. The facts this design rests on:

| # | Finding | Where today |
|---|---|---|
| 1 | "drop … alternately before and after `current`" empties a short side first (current 2 of 3,540, budget 213: both predecessors dropped although they fit); the CLI only refuses | `docs/handoff.md:177`; `apps/cli/src/case.ts:66-71`; `MAX_LINK_CHARS = 8_192` in `packages/shared/src/views.ts:39` |
| 2a | length limits are zod `min`/`max` on strings, i.e. JavaScript string length (UTF-16 code units) | `packages/shared/src/case.ts:44-84` |
| 2b | one bad entry refuses the whole catalog | `case.ts:363-374`; case-handoff "Catalog document" („refused as a whole") |
| 2c | with `view`, every timeseries window gets the session scope; cursors are dropped | `packages/shared/src/caseApply.ts:179-193`; case-handoff "View in the payload" |
| 2d | the server sets no Cross-Origin-Opener-Policy; the named tab needs the opener relationship | `apps/server/src/web.ts:76-79`; `docs/handoff.md:178` |
| 3 | the back-link warning is shown on the link path, but replaced in the single message slot when a case notice is shown just before; the file-drop path throws the answer away before `location.assign` | `apps/server/src/case.ts:212`; `apps/web/src/App.tsx:1481-1497`; `apps/web/src/filedrop.ts:66-73` |
| 4 | `origin.url` is kept only on an exact `KIPSCOPE_FINDER_ORIGINS` match; the Host guard accepts loopback on any port | `apps/server/src/case.ts:236-246`; `apps/server/src/access.ts:7-12, 34-61` |


## Goals / Non-Goals

**Goals:** close the five findings with the smallest change; ship the trim rule as code the finder can port; keep every interface two write areas share pinned below.

**Non-Goals:** see the proposal's "Out of scope"; the missing events table (finding 5) is in the backlog (docs/status.md, Next 5).

## Decisions

### X1: Balanced trim (pinned, new `packages/shared/src/caseTrim.ts`, exported from `index.ts`)

```ts
/** What trimCases needs of a catalog; unknown keys pass through unchanged. */
export interface TrimmableCases {
  cases: readonly unknown[];
  /** Default 0. */
  current?: number;
}

export type TrimResult<D> =
  | {
      ok: true;
      /** The input object itself when nothing was dropped; else {...doc, cases: slice, current}. */
      doc: D;
      /** encode(doc): the text whose length was measured (the link, or what a signer gave). */
      text: string;
      dropped: { before: number; after: number };
    }
  | { ok: false; code: "link_too_long"; /** Length with current alone. */ chars: number };

/**
 * Balanced trim (case-handoff "Balanced trim"). Pure apart from `encode`. Throws RangeError when
 * `cases` is empty or `current` is not an integer in [0, cases.length).
 */
export function trimCases<D extends TrimmableCases>(
  doc: D,
  options: { maxChars: number; encode: (doc: D) => string | Promise<string> },
): Promise<TrimResult<D>>;
```

- **Drop order:** with `b` sessions before `current` and `a` after, the k-th drop removes the first session when `b ≥ a` and `b > 0` (then `b−1`, `current−1`), else the last (`a−1`). The window after k drops is computed without encoding.
- **Search:** `encode` the untouched document (fits → return it, `===`); `encode` the window with `current` alone (`k = n − 1`; does not fit → `link_too_long`); then bisect k between them, keeping the smallest k that fits and its text. At most ⌈log2 n⌉ + 2 calls. Bisection assumes the length does not grow when a session is dropped; with deflate or a signature that can be off by a session in rare cases, and the result still fits.
- **No session cap:** `trimCases` takes any length (the finder may trim a 3,540-session result list before it builds the 2,000-session document); the 2,000 limit stays the server's.
- **Why the longer side:** it keeps the neighbours on both sides as long as either side has more than the other; a short side is never emptied while the long side has more.

### X2: CLI `case url --trim` (pinned, `apps/cli/src/args.ts`, `apps/cli/src/case.ts`)

- `CaseInvocation` `url` gains `trim?: true`; `--trim` joins `FLAG_OPTIONS` and is accepted only by `case url` (`take(1, ["--trim"])`).
- With `--trim`: a JWS → `CliError("usage", "usage", "a signed catalog cannot be trimmed: trim the document before signing")`; an unsigned code → `decodeCasesLink`; a document → used as it is after checking `cases` is a non-empty array and `current` (default 0) an integer index into it (else usage). Then `trimCases(doc, {maxChars: MAX_LINK_CHARS, encode: async (d) => casesLinkUrl(origin, await encodeCasesLink(d))})`; `ok: false` → exit 2 `link_too_long` naming `chars`.
- Output: `local` `{url, dropped: {before, after}, position: "<current + 1> / <cases.length>"}`. Without `--trim` nothing changes.
- Help text: the `case url` line names `[--trim]`.

### X3: Loopback back link in identity `none` (`apps/server/src/case.ts`)

`listedOrigin(url, origins, identity)`: kept when the URL is `http:`/`https:` and either its origin is in `origins`, or `identity === "none"` and `isLoopbackHost(new URL(url).hostname)` (`access.ts`; `hostname` of `http://[::1]:8080/` is `[::1]`, which the set holds). The warning text stays `origin.url <url> dropped: its origin is not in KIPSCOPE_FINDER_ORIGINS`.

### X4: Open report shown on every path (pinned, `apps/web`)

New `apps/web/src/workspaces/caseReport.ts`:

```ts
export const CASE_REPORT_KEY = "kipscope.caseOpenReport";
type ReportStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;
/** Stores {workspace, report} for the next page load of this tab; never throws. Default store: sessionStorage. */
export function stashCaseReport(workspaceId: string, report: CaseOpenReport, store?: ReportStore): void;
/** The stored report when it belongs to `workspaceId`; removes the entry in every case; never throws. */
export function takeCaseReport(workspaceId: string, store?: ReportStore): CaseOpenReport | undefined;
```

- `openDroppedCatalog(file, deps)` gains `deps.store?: ReportStore` and calls `stashCaseReport(answer.workspace.id, answer.case, store)` before `go`. `sessionStorage` is per tab and survives `location.assign` in that tab.
- `apps/web/src/workspaces/startup.ts`: after the workspace `id` is settled and when `cases` is still undefined, `cases = takeCaseReport(id)`. The `ready` result then carries it exactly as after a link, so `App.tsx` needs no second path.
- New in `apps/web/src/case/sessionBar.ts`:

```ts
/** The open's one notice (case-handoff "Open warnings shown"): alignment fallback and missing
 *  signals as caseResultEvents words them, then the report's warnings, joined by " · "; [] when empty. */
export function caseOpenEvents(
  report: CaseOpenReport,
  after: WorkspaceCase,
  nameOf?: (signalId: string) => string | undefined,
): StripEvent[];
```

- `App.tsx` (the effect at :1481-1497) calls `showResult(caseOpenEvents(report, openedCase, nameOf))` and drops its separate `setNotice(warnings)`. Like every case notice it ends with the tab's next command (case-navigation "Case notices clear on the next command").

### X4a: Open report in the session bar (pinned, `apps/web/src/case/`, `App.tsx`)

Jan's choice after the hand check: the bottom bar's slot cuts the text off, so the open's notice also goes to the top.

- `sessionBar.ts`: `openNoteText(report: CaseOpenReport, after: WorkspaceCase, nameOf?): string | undefined` gives the text `caseOpenEvents` shows (which now builds its notice from it), and `endsOpenNote(input: CommandInput, result: CommandResult): boolean` is true only for an accepted `case.go`, `case.step` or `case.unlink`.
- `SessionBar.tsx` props gain `openNote?: string` and `onDismissNote?: () => void`. It renders `<span class="session-open-note" title={openNote}>⚠ {openNote}</span>` and a `✕` button (`aria-label` and `title` `Dismiss`) right after `.session-text` (after the vehicle text while unlinked).
- `case.css`: the note is warning-toned with the existing tokens, `white-space: nowrap`, `overflow: hidden`, `text-overflow: ellipsis`, `flex: 0 1 auto`, `min-width: 6em`, `max-width: 40%`. The bar stays one line and ≤ 56 px; the session text still shrinks first.
- `App.tsx` holds the note (`useState`), sets it where the open's effect calls `showResult(caseOpenEvents(…))`, clears it on ✕ and when `endsOpenNote` holds for a command result. The bottom bar keeps its notice under the existing rule.
- **Lifetime, why so:** the existing case notice rule ("Case notices clear on the next command", D-089) ends a notice at the next accepted command. That is right for the bottom bar's step messages, but it is why the warning went unnoticed. The bar note describes the opened catalog and session, so it lasts until the user leaves that session (`case.go`, `case.step`, `case.unlink`) or dismisses it. Window commands, `case.align` and refusals keep it, and a reload drops it (the report is taken once, X4).

### X5: Documents

- `docs/handoff.md`: "The link" bullet "Trimming" rewritten to the X1 rule with the 3,540/213 example and a pointer to `trimCases` and `kipscope case url --trim`; a "Lengths" note under the key tables (UTF-16 code units, `"é".length` 1, `"😀".length` 2; the inflated limit in UTF-8 bytes); under the errors table, `invalid_catalog` refuses the whole catalog, no session is skipped; under `view`, each chart opens at `[from − pad, to + pad)` of `current`, the view's chart times and cursors are not used; under the named tab, KIPscope sets no `Cross-Origin-Opener-Policy`, `window.open(url, "kipscope")` and `<a target="kipscope">` reuse the tab only while the finder keeps the opener relationship, so no `noopener`/`rel="noopener"` and no COOP `same-origin` on the finder page (nor on a proxy in front of KIPscope), else every click opens a new tab; the `origin.url` row and `KIPSCOPE_FINDER_ORIGINS` row name the loopback rule in `none`.
- `README.md`: the `case url` row names `--trim`.

## Numbers: what if off by a factor of two

| Number | Source | ×2 or ÷2 |
|---|---|---|
| ⌈log2 n⌉ + 2 encodes | X1 bisection | 2,000 sessions: 13 encodes of ≤ ~300 KB JSON, a few ms each; twice the calls or twice the cost stays under 0.2 s. A linear search would need up to ~1,750 encodes. |
| 8,192 characters | D-070, unchanged | Not this change's number. |
| Report in `sessionStorage` | X4 | A few hundred bytes (signal names, one URL) of a 5 MB quota. |

## Security

- **Loopback back link (X3):** only in identity `none`, where one local user owns the server and the Host guard already trusts loopback on any port. The link is a top-level navigation the user clicks; it can reach only the clicking user's own machine. On a server (any other identity) the rule is unchanged.
- **Stored report (X4):** same tab, same origin, removed at its first read; it holds what the message line shows anyway.

## Test fixtures (pinned for the tester)

- L(n) and its encoder: case-handoff "Balanced trim".
- C4: catalog of `add-case-open` design "Test fixtures" (`apps/web/test/caseFixtures.ts`, server and CLI tests).
- The 2,000-session catalog: `apps/cli/test/cli.test.ts` › "prints a catalog link".

## Manual checks

- UI user: "Dropped file on smart451" and "Note on smart451" (case-handoff).

## Ledger entry on archive (proposed D-091; the lead writes it)

**D-091: Handoff findings of the search tool's team.** A link too long is trimmed by dropping the far end of the longer side around `current` (tie: before), shipped as `trimCases` and `kipscope case url --trim`. In identity `none` a loopback `origin.url` is kept on any port. The open report's warnings show on every open path with the case notice. The guide states UTF-16 lengths, whole-catalog refusal, the view's times and the opener rule.
