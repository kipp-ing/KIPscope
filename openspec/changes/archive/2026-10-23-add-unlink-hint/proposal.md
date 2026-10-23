# Proposal

## Why

Unlink reads the vehicle's extent (first and last row); on carserver that takes 12–18 s for smart451's 490 M rows, since `utc` is the third sort key (D-113). D-112 gave Unlink the progress line and `Unlinking…`, but after a few seconds of that the user still does not know why it takes so long. Jan declined a background prefetch of the extent: „naja, wenn man einen session katalog durchklickt wird quasi permanent vorgeladen? das wäre too much. lieber eine info: geduld es passiert was" (D-113).

## What Changes

- **Patience hint on a slow Unlink** (D-113): while an Unlink is still on its way 1 s after the click, the session bar's title slot shows `Unlinking: reading the whole vehicle's time range; this can take a few seconds` (from the hints table), in a `role="status"` region so screen readers hear it. It goes when the result's revision is rendered or the command is refused or fails, exactly when `Unlinking…` goes. It never shows for an Unlink that ends within 1 s, nor for Link. No slot box moves.
- The progress line, `aria-busy` and `Unlinking…` / `Linking…` of D-112 stay as they are.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `case-navigation`: new requirement "Patience hint on a slow Unlink".

## Impact

- `apps/web/src/help/hints.ts` (one entry), `apps/web/src/case/sessionBar.ts` (pure helpers), `apps/web/src/case/SessionBar.tsx`, `apps/web/src/case/case.css`, `apps/web/src/App.tsx` (`caseCommand`, `endStep`)
- tests in `apps/web/test/sessionBar.test.ts`, `apps/web/test/hints.test.ts`
- No change to `packages/shared`, the server, the HTTP API or the CLI.

## Out of scope

- Any prefetch or longer cache of the vehicle's extent (declined in D-113); making Unlink faster.
- A hint for Link, for steps, or for any other slow command.
- A countdown, an estimate of the remaining time, or a cancel button.
- Moving the open note or any other content of the title slot.
- Any other change.
