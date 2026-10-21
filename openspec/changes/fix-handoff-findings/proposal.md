# Proposal

## Why

The team building a search tool (finder; not part of KIPscope, D-090) tried the handoff of `add-case-open` and reported findings in GitHub issue #1 (comment 2026-10-21). The lead checked them against the code; Jan approved the first group („group 1"). They are small gaps between `docs/handoff.md`, the specs and the code: a trim rule that, read literally, empties the short side first; four facts the guide does not state; a back-link warning the file-drop path throws away; and loopback finders refused in identity `none`.

## What Changes

- **Balanced trim.** New rule for a link that is too long: while it is too long, drop the far end of the *longer* side around `current` (tie: the side before), keep the order, lower `current` by the number dropped before it. Shipped as the pure function `trimCases` in `packages/shared` with test vectors; `kipscope case url --trim` uses it. `docs/handoff.md` states the new rule (it replaces "alternately before and after").
- **Guide gaps** in `docs/handoff.md`: length limits count UTF-16 code units (JavaScript string length); one bad entry refuses the whole catalog (`invalid_catalog`, no skipping); with `view` the view's chart times and cursors are replaced by the session scope `[from − pad, to + pad)`; KIPscope sets no Cross-Origin-Opener-Policy, and the named tab `kipscope` is reused only while the finder keeps the opener relationship (no `noopener`, no severing COOP), else every click opens a new tab.
- **Back-link warning on every path.** The open report's `warnings` (a dropped `origin.url`) shows in the message line after a link *and* after a dropped file, together with the case notice (missing signals, fallback) instead of replacing it.
- **Loopback finder in identity `none`.** There, an `origin.url` on `localhost`, `127.0.0.1` or `[::1]` is kept on any port, as the Host guard already accepts. Other identities unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `case-handoff`: balanced trim (new), open warnings shown on every path (new), back link accepts loopback in `none` mode, guide covers trim, string lengths, whole-catalog refusal, view times and the opener rule.
- `cli`: `case url --trim`.

## Out of scope

- Skipping bad entries with a warning instead of refusing the catalog (the finding's alternative; the spec keeps "refused as a whole").
- Missing events table (item 5 of the finding: re-sent query, `/api/meta` capability, align-to-event without events): moved to the backlog by Jan („this will be bigger"), see [docs/status.md](../../../docs/status.md) (Next 5).
- Trimming a signed catalog in the CLI (the CLI has no finder key; the finder trims before signing).
- Any other finding of the issue comment outside group 1; anything about the search tool's own code (D-090).

## Impact

- `packages/shared`: new `caseTrim.ts` (`trimCases`).
- `apps/server`: `case.ts` (loopback back link in `none`).
- `apps/web`: `filedrop.ts`, new `workspaces/caseReport.ts`, `workspaces/startup.ts`, `case/sessionBar.ts`, `App.tsx`.
- `apps/cli`: `args.ts`, `case.ts` (`--trim`).
- Docs: `docs/handoff.md`, `README.md` (CLI row).
- HTTP: no route or payload changes.
