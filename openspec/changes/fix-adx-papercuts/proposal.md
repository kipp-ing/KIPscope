# Proposal

## Why

Jan tested on ADX with Edge on Windows (D-112, 2026-10-23): „4 digits geht nicht (wenn es im submenü ausgeblendet ist?) und unlink reagiert langsam. im ergebnis zu erwarten, der nutzer weiß nur nicht dass was passiert". Choosing `4 digits` in the native `<select>` inside the "⋯" menu closes the menu and Digits stays 3: Edge reports the select's popup as a pointer down outside the menu, and `OverflowMenu` closes on that. Unlink and Link send a command that reloads the vehicle's signal list (seconds on ADX), and nothing on screen says that something is happening: the progress line of DW4 runs only for steps with a session target.

## What Changes

- **Digits as a segmented control** (D-112 (1)): the `<select aria-label="Digits">` in the "⋯" menu becomes a two-button segmented control `3 | 4` (`role="radiogroup"`, `aria-label` `Digits`, buttons `role="radio"` with `aria-checked`, arrow keys move and choose). It sends the same `workspace.setOptions {digits}` command. The menu stays open after a choice. Opening the menu by keyboard focuses the checked button.
- **Unlink and Link show progress** (D-112 (2)): from the click until the result's revision is rendered or the command is refused, the context row is `aria-busy`, the progress line of DW4 runs, and the action button reads `Unlinking…` or `Linking…` and is disabled, in the action slot's fixed 64 × 24 px box.
- Requirements that name the Digits select are reworded: `number-format` "Digits option", `saved-views` "Top-row overflow menu", `timeseries-window` "Option bar".

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `number-format`: "Digits option" names the segmented control and its evidence.
- `saved-views`: "Top-row overflow menu" keyboard scenario uses the segmented control.
- `timeseries-window`: "Option bar" names a Digits control instead of a select.
- `case-navigation`: new requirement "Unlink and Link show progress".

## Impact

- `apps/web/src/bar/OptionBar.tsx`, `apps/web/src/bar/OverflowMenu.tsx` (first focus), `apps/web/src/bar/bar.css`
- `apps/web/src/case/sessionBar.ts` (pure helper), `apps/web/src/case/SessionBar.tsx`, `apps/web/src/case/case.css`, `apps/web/src/App.tsx` (`caseCommand`)
- tests in `apps/web/test/bar.test.ts`, `apps/web/test/sessionBar.test.ts`
- No change to `packages/shared`, the server, the HTTP API or the CLI.

## Out of scope

- Any other control in the "⋯" menu or elsewhere; any other native select.
- Showing the linked slots (title, duration, `SESSION`) before Link's result is in; Unlink's slots before its result.
- Making Unlink or Link faster on ADX (the signal list reload itself).
- Any other change.
