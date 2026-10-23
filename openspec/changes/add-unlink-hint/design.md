# Design

## Context

D-113 on top of D-112. Web only; no shared type, HTTP payload or server change.

- `App.tsx` `caseCommand` already tracks a pending Unlink: `actionPending` (state and ref) is `"Unlinking…"` from the click; `endStep` clears it when the result's revision is rendered (`ack.onRendered` with `awaitedRevision`) or in `settle` on a refusal or failure; a newer command that starts a pending state (`startsPending`) bumps `pendingSeq` and replaces it.
- The session bar's title slot (`slot-title`, `minmax(0, 1fr)`, `overflow: hidden`, flex with `gap: 10px`) already carries the transient case message of the open note (`session-open-note`, `role="status"`, X4a, DW7). The message line (`StatusBar`) is one shared slot for errors and notices; its state machine (`nextStrip`, `resultNotice` dismissed at the next dispatch) would need a timed entry, and it sits at the bottom of the viewport, far from the clicked button.
- The server caches a vehicle's extent for 5 minutes (`apps/server/src/objectScope.ts` `EXTENT_TTL_MS`), so only a cold Unlink is slow; a warm one is not.

## Goals / Non-Goals

**Goals:** the hint of D-113 next to the clicked button, heard by screen readers, gone exactly when `Unlinking…` goes, without moving any slot.

**Non-Goals:** see proposal "Out of scope".

## Pinned interfaces (web only)

```ts
// apps/web/src/help/hints.ts, in HINTS
unlinkSlow: "Unlinking: reading the whole vehicle's time range; this can take a few seconds",

// apps/web/src/case/sessionBar.ts
/** How long an Unlink runs before the patience hint shows (D-113). */
export const UNLINK_HINT_DELAY_MS = 1000;
/** True only for a pending Unlink; Link never gets the hint (D-113). */
export function patienceHintFor(action: PendingAction | undefined): boolean;
/** Calls `show` once after `delayMs` (setTimeout); the returned function cancels it,
 *  and is a no-op once `show` ran. */
export function startPatienceTimer(show: () => void, delayMs?: number): () => void; // default UNLINK_HINT_DELAY_MS

// apps/web/src/case/SessionBar.tsx, new optional prop
unlinkHint?: boolean; // the hint text shows while true and actionPending === "Unlinking…"
```

The tester imports `patienceHintFor`, `startPatienceTimer`, `UNLINK_HINT_DELAY_MS` from `../src/case/sessionBar.ts` and `HINTS` from `../src/help/hints.ts`.

## Decisions

- **Place: the title slot.** It already holds a transient case message with `role="status"`, it is beside the clicked button, and its box is the grid's `minmax(0, 1fr)` with `overflow: hidden`, so content inside it cannot move another slot (D-095). The message line was rejected (see Context).
- **Markup.** While `actionPending === "Unlinking…"` the slot renders, after `slot-title-text` and before the open note, `<span className="session-unlink-hint" role="status" title={text}>{text}</span>` with `text = unlinkHint ? HINTS.unlinkSlow : ""` (`title` omitted while empty). The live region exists from the click and only its text changes at 1000 ms, which screen readers announce more reliably than a region inserted with its text. Otherwise no such span.
- **CSS** (`case.css`): `.context-row .session-unlink-hint { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); }`. The title text keeps its `min-width: 8ch` and gives way last; the hint truncates before it.
- **App wiring.** `const [unlinkHint, setUnlinkHint] = useState(false)` and `cancelHint = useRef<(() => void) | undefined>()`. In `caseCommand`, when `starts`: cancel any running timer, `setUnlinkHint(false)`, and if `patienceHintFor(action)` set `cancelHint.current = startPatienceTimer(() => setUnlinkHint(true))`. `endStep` cancels the timer, clears the ref and sets `unlinkHint` false, in the same batch that clears `actionPending`. An effect cleanup cancels the timer on unmount. Pass `unlinkHint` to `SessionBar`.
- **Delay: 1000 ms.** D-113 says "about 1 s"; about 1 s is also the usual limit of an uninterrupted flow, below which the button text and the progress line are feedback enough. Off by a factor of two: at 2000 ms the user waits 2 s with only `Unlinking…` and the line, and the hint still stands 10–16 s of a 12–18 s Unlink, acceptable; at 500 ms the hint would flash on Unlinks of 0.5–1 s, which is the flicker D-113 wants to avoid. The constant is the one place to change it.
- **UI timing window 950–1500 ms.** `setTimeout` fires no earlier than 1000 ms after the call, which runs a few ms after the `pointerdown` that sets `t0`; 50 ms below covers the click's own handling. 500 ms above covers React's commit and a busy main thread while the strip renders; a hint later than 1500 ms would be twice as late as specified in the user's eye and is a finding.
- **Slow run threshold 3 s.** A cold Unlink on smart451 takes 12–18 s (D-113); a run under 3 s means the extent was cached, so the run is repeated after the 5-minute cache lifetime. Off by a factor of two (6 s or 1.5 s) the check still separates cold (≥ 12 s) from warm.

## Risks / Trade-offs

- `endStep` and `caseCommand` are on the step path. The existing sessionBar tests and case-navigation "Unlink and Link on smart451" must stay green.
- A warm Unlink may still take over 1 s if the signal list reload is slow; then the hint shows on it too, which D-113 allows ("still on its way after about 1 s").
