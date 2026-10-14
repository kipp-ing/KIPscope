# Team and round flow

Adopted from the PCB-dev placer team (D-013), slimmed down for letsview: the suite runs in seconds, so there is no test manager; the pacer also takes the watchdog's stop rules.

| Role | Agent file | Model | Writes |
|---|---|---|---|
| Lead dev | main session | opus | commits, push, `docs/status.md`, `docs/decisions.md`, demos to Jan; no product code |
| Spec owner | [lv-spec-owner](../.claude/agents/lv-spec-owner.md) | opus | `openspec/` |
| Engineer | [lv-engineer](../.claude/agents/lv-engineer.md) | opus | assigned `src/` area only |
| Tester | [lv-tester](../.claude/agents/lv-tester.md) | sonnet | `*/test/`, test fixtures, `apps/server/scripts/seed-test-db.ts` |
| UI user | [lv-ui-user](../.claude/agents/lv-ui-user.md) | sonnet | nothing; reports with screenshots |
| Reviewer | [lv-reviewer](../.claude/agents/lv-reviewer.md) | opus | nothing; findings only |
| Pacer | [lv-pacer](../.claude/agents/lv-pacer.md) | sonnet | round log `openspec/changes/<change>/rounds.md` |

## One change

1. **Spec:** the spec owner writes the change's specs, design and tasks. Every scenario is testable and names its evidence. The design pins shared interfaces (DTOs in `packages/shared`) so server and web can be built in parallel. The lead reads it and asks Jan where a decision is his.
2. **Rounds:** workflow [.claude/workflows/change-round.js](../.claude/workflows/change-round.js), args `{change, date, maxRounds?, hint?}`:
   - Pacer splits open tasks into 1–3 tasks with disjoint write areas.
   - Build: engineers implement, the tester writes the scenario tests in parallel (test-first from the spec).
   - Check: the tester runs `pnpm build && pnpm test && pnpm lint`, the UI user drives the app in Chrome on real data; then the reviewer and the spec owner judge from their outputs.
   - Pacer: `done`, `continue` (new tasks from open findings only) or `needs_jan`.
3. **Lead:** commits, shows Jan the result. Jan says: good / not good. Then archive.

## Rules for every role

- Git: no `stash`, `reset`, `checkout`, `restore`, `clean`, `commit` or `push`. Other agents work in the same tree in parallel; compare with `git diff`. Only the lead commits.
- Jan's decisions (`docs/decisions.md`, D-nnn) are never changed or reinterpreted. If one turns out unreachable, report a finding; only Jan changes it.
- No process kills: never pipe a port lookup into `kill` (Docker Desktop owns forwarded ports). Dev servers and the SSH tunnel are the lead's job.
- A check that did not run is `not_run`, never `pass`.
