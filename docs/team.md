# Team and round flow

Adopted from the PCB-dev placer team (D-013), slimmed down for KIPscope: the suite runs in seconds, so there is no test manager; the pacer also takes the watchdog's stop rules.

| Role | Agent file | Model | Writes |
|---|---|---|---|
| Lead dev | main session | opus | commits, push, `docs/status.md`, `docs/decisions.md`, demos to Jan; no product code |
| Spec owner | [ks-spec-owner](../.claude/agents/ks-spec-owner.md) | opus | `openspec/` (writes the spec; edits it when a finding needs it) |
| Engineer | [ks-engineer](../.claude/agents/ks-engineer.md) | opus, small tasks | assigned `src/` area only |
| Tester | [ks-tester](../.claude/agents/ks-tester.md) | sonnet | `*/test/`, test fixtures, `apps/server/scripts/seed-test-db.ts` |
| UI user | [ks-ui-user](../.claude/agents/ks-ui-user.md) | sonnet | nothing; reports with screenshots |
| Reviewer | [ks-reviewer](../.claude/agents/ks-reviewer.md) | opus, round diff only | nothing; findings only |
| Pacer | [ks-pacer](../.claude/agents/ks-pacer.md) | sonnet | `tasks.md` checkboxes, round log `rounds.md` (also does the scenario check) |
| UI designer | [ks-ui-designer](../.claude/agents/ks-ui-designer.md) | opus | nothing in the repo; mocks (design canvas artboards) and a clutter inventory, before a UI change is specced |
| Crash guard | [ks-smoke](../.claude/agents/ks-smoke.md) | sonnet | nothing; `pnpm build` + `pnpm smoke` (headless Chrome, [scripts/smoke.mjs](../scripts/smoke.mjs)) pass/fail |

## One change

1. **Spec:** the spec owner writes the change's specs, design and tasks. Every scenario is testable and names its evidence. The design pins shared interfaces (DTOs in `packages/shared`) so server and web can be built in parallel. The lead reads it and asks Jan where a decision is his.
2. **Rounds:** workflow [.claude/workflows/change-round.js](../.claude/workflows/change-round.js), args `{change, date, maxRounds?, hint?}`:
   - Pacer splits all open tasks into 1–4 parallel tasks with disjoint write areas; it defers a task only if it needs another task's output.
   - Build: engineers implement, the tester writes the scenario tests in parallel (test-first from the spec).
   - Check: the tester runs `pnpm build && pnpm test && pnpm lint`, the UI user drives the app in Chrome on real data; then the reviewer judges the diff.
   - Pacer: judges every scenario against the evidence, ticks tasks, decides `done`, `continue` (new tasks from open findings only) or `needs_jan`.
   - Crash guard: last step of every round that touched `apps/web` or `packages/shared`, after the pacer: `pnpm build`, `pnpm smoke` against the running Vite and `pnpm smoke --preview`, before the lead shows Jan anything. A failure turns the round into `continue` with the crash as the first task (`needs_jan` in the last round, or when Vite itself needs the lead's restart).
   - Follow-up rounds check light: the reviewer looks at that round's diff only, and the UI user runs only if the round touched `apps/web` (otherwise the previous UI result carries over).
3. **Lead:** commits, shows Jan the result. Jan says: good / not good. Then archive. The lead never tells Jan something is ready before `pnpm smoke` passed against the dev server he has open (both crashes of 2026-10-17 had passed `pnpm build`); after a Vite restart or any change outside a round, run it again.

## Token budget (Jan, 2026-10-14)

> „opus agenten für komplexe aufgaben, aber nicht lang laufend. sonnet für den rest, auch dort schauen dass der kontext im rahmen bleibt“

- Opus only for complex, short work: writing the spec, an engineer task, the review. The pacer cuts engineer tasks small (one area, a few tasks each); a task that would run long is split into parallel tasks.
- Sonnet for everything else: tester, UI user, pacer (including the scenario check).
- Every agent costs about 40k tokens just to start, so fewer agents beat smaller ones: no separate spec-check agent, no UI rerun without web changes, no round for a task that could have run in parallel. Measured on `add-sna-handling`: 22 agents, 1.38 M tokens, of which rounds 2–3 (two small web follow-ups) cost about 0.7 M.
- Every agent reads only what its task needs: the change's design, the files it touches. No repo-wide exploration.
- Reports stay short: build reports ≤ 15 lines, evidence ≤ 2 lines per scenario (shortened command output, not full logs).
- The UI user reads the page as text first and takes one screenshot per scenario as evidence, not per step.
- The workflow passes summaries between agents, never full transcripts.

## Rules for every role

- Git: no `stash`, `reset`, `checkout`, `restore`, `clean`, `commit` or `push`. Other agents work in the same tree in parallel; compare with `git diff`. Only the lead commits.
- Jan's decisions (`docs/decisions.md`, D-nnn) are never changed or reinterpreted. If one turns out unreachable, report a finding; only Jan changes it.
- No process kills: never pipe a port lookup into `kill` (Docker Desktop owns forwarded ports). Dev servers and the SSH tunnel are the lead's job.
- A check that did not run is `not_run`, never `pass`.
