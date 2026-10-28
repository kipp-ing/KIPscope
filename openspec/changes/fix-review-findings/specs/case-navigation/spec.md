## MODIFIED Requirements

### Requirement: Zoom history per session
The zoom history ("Back") SHALL be kept per catalog index in the tab: a step SHALL push no entry, and stepping back to a session SHALL restore its history. Every place in the web app that reads or writes a history, or the pending navigation keyed like it (a zoom, a navigation step, Back, whether Back is enabled), SHALL use the same key: the window's key (shared `*` while "Link time axes" is on, else the window ID) plus the current catalog index while a catalog is open and linked; without a catalog, and while unlinked (the whole vehicle, no session shown), the key carries no index. Origin: exploration UX sketch („Back history is per session"), accepted by D-086; one key at every place: review day 2026-10-28 T-01 (`historyKey` took a `caseIndex`, add-case-open K7, that `App.tsx` never passed, so Back after `[` / `]` popped another session's range); no index while unlinked: necessary consequence (an unlinked catalog shows no session, and its ranges lie outside every session's scope).

#### Scenario: Back after stepping back
- **WHEN** at entry 0 the user zooms twice, steps to entry 2, zooms once, steps back to entry 0 and presses Back
- **THEN** the range is the one before entry 0's second zoom (shifted by nothing, same session)
- **Evidence:** `apps/web/test/zoom.test.ts` › "keeps the zoom history per session"

#### Scenario: Key of a workspace
- **WHEN** the pure helper `workspaceHistoryKey(ws, windowId)` gets, for window `w1`: a linked-time workspace without a catalog; the same with C4 open, linked, at current 0; at current 2; the same at current 2 but unlinked; a workspace with `linkTime` false and C4 linked at current 2 for `w1` and for `w2`; and `undefined`
- **THEN** it gives `historyKey(true, "w1")`, `historyKey(true, "w1", 0)`, `historyKey(true, "w1", 2)`, `historyKey(true, "w1")`, `historyKey(false, "w1", 2)`, `historyKey(false, "w2", 2)` and `historyKey(true, "w1")`; the keys at current 0 and current 2 differ
- **Evidence:** `apps/web/test/zoom.test.ts` › "keys the history by the workspace's catalog session"; `grep -n "historyKey(" apps/web/src/App.tsx` prints no line (every key in `App.tsx` comes from `workspaceHistoryKey`)

#### Scenario: Back per session on smart451
- **WHEN** a catalog from `kipscope case drives smart451` (at least 3 sessions) is open at the first session (position `1 / <n>`), linked, one timeseries window, at 1440×900; the user presses `+` twice, `]` twice, reads "Back", presses `+` once, presses `[` twice and presses Backspace
- **THEN** after the two `]` (position `3 / <n>`) "Back" is disabled, since that session has no history yet; after the two `[` (position `1 / <n>`) "Back" is enabled; the Backspace sets the window's range to the one shown after the first `+` (the range before the second zoom); `kipscope state` then shows `case.current` 0 and that range
- **Evidence:** UI check on smart451 (`kipscope state` window range after each step; "Back" `disabled` read from the page after the two `]` and after the two `[`; one screenshot after the Backspace)
