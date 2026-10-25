# How KIPscope was built

KIPscope was built by a small team of AI agents (Claude Code subagents) working spec-driven with [OpenSpec](https://github.com/Fission-AI/OpenSpec), with Jan as the only human: he wrote the concept, made the decisions and judged the results. This page describes how that setup came about, why it worked, and how to take it to another project. Everything it claims can be checked in this repository.

It is a worked example of efficient agentic coding: agents building software. Agentic engineering is broader and also covers agents set up for everyday office work; this page is only about the coding side.

## In numbers

| | |
|---|---|
| Time | 10 days, 2026-10-14 to 2026-10-23 |
| Commits | 370 |
| Changes | 43 archived ([openspec/changes/archive/](../openspec/changes/archive/)), about four a day |
| Specs | 30 capabilities ([openspec/specs/](../openspec/specs/)) |
| Decisions | 114 in the ledger ([decisions.md](decisions.md)), 48 of them quote Jan's own words |
| Tests | 150 test files, written from the specs' scenarios |
| Changes only to fix earlier ones | 2 of 43 (`fix-handoff-findings`, `fix-adx-papercuts`), both from the first use outside the dev setup |
| Cost | about €50 of AI tokens and about 8 hours of Jan's time (D-114) |
| Team definition | 8 agent files of about 20 lines each, one 180-line workflow, a 13-line [AGENTS.md](../AGENTS.md) |

## How it came about

**Concept first.** Before the repository existed, Jan had a concept for "an interactive workspace for historical time series" ([concept.md](concept.md), German, version 0.2): the workflow of an engineer looking for something in recorded data, the scope and what is out of scope, data volumes, windows, cursors, CLI remote control, persistence, a review of existing tools (Grafana, ibaAnalyzer, PlotJuggler, Seeq) and how to decide between buying, extending and building.

**Day 1, morning: the frame.** The first commit (09:46) set up OpenSpec, a minimal `AGENTS.md` and the decision ledger (D-001, D-002). Jan then made the decisions the concept had left open: build our own (D-004), server and browser (D-005), ClickHouse first (D-006), real data from his own car's logger plus a local test database (D-007). At 11:28 the concept went in together with the first change, `add-timeseries-skeleton`.

**Day 1, afternoon: the team.** At 16:41 Jan asked for an agent team "for more speed" (D-013), taken from an earlier project of his (a PCB placer) and slimmed down: the main session becomes lead dev and writes no product code; spec owner, engineers, tester, UI user, reviewer and pacer work as subagents in rounds ([team.md](team.md)). Ten minutes later came the token budget, after measuring the first change (22 agents, 1.38 M tokens): opus only for short, complex work, sonnet for the rest, summaries instead of transcripts between agents.

**Then: the process learned from its failures.**

- 2026-10-17: two crashes reached Jan although `pnpm build` had passed. A crash guard followed the same morning: `pnpm smoke` (headless Chrome against the running dev server and a production preview) as the last step of every round that touches the web app, and the lead tells Jan nothing is ready before it passed.
- 2026-10-20: a larger feature (handing sessions over from an external search tool) was first explored with screenshots and questions ([explore/](explore/)) before it was specced.
- 2026-10-21: after a cluttered workspace Jan said "we need a specialist"; a UI designer role draws mocks for Jan to iterate on before a UI change is specced ([design/](design/)).

Each of these is a commit to the team files, not a habit someone has to remember.

## Why it worked

### 1. A concept before the first line of code

The agents never had to guess what the product is for. The concept states the user's workflow ("take a hint, open the recording at the right place, load a view, compare signals, measure with cursors A/B, save and come back"), what is in scope and, just as important, what is not ("no own persistent data cache", "database latency is a given"). Every change's proposal could point to a section of it; requests that contradicted it surfaced as questions instead of features.

### 2. Every decision written down with its why, in the decider's words

[decisions.md](decisions.md) is an append-only ledger: `D-NNN: title (date)`, then context, **Decision**, **Why**, consequences. 84 of the 114 entries carry an explicit **Why** line, every one of the 43 proposals starts with `## Why`, and many entries quote Jan verbatim:

> D-113: „naja, wenn man einen session katalog durchklickt wird quasi permanent vorgeladen? das wäre too much. lieber eine info: geduld es passiert was"
> *(well, if you click through a session catalog, that preloads more or less all the time? Too much. Rather a hint: patience, something is happening.)*

This does three things:

- **Memory beyond a context window.** A new agent in a new session reads the decision and its reason, so nothing is relitigated.
- **Judgement in new cases.** An agent that knows *why* prefetching was declined (it costs source queries for every vehicle stepped through) does not reintroduce it in another form somewhere else.
- **A hard line.** The rule for every role: Jan's decisions are never changed or reinterpreted; if one turns out unreachable, that is a finding for Jan. On archive, project-wide decisions from a change's design are copied into the ledger ([openspec/config.yaml](../openspec/config.yaml)).

### 3. Every scenario names its evidence

Each scenario in a spec is a WHEN/THEN with an **Evidence** line naming the test or command that proves it:

```markdown
#### Scenario: Nanoseconds survive
- **WHEN** cursor A is at `1791896881500000001` ns and the workspace is saved, read back and opened
- **THEN** the file says `a: 2026-10-13T13:08:01.500000001Z` and the opened workspace's cursor A is `1791896881500000001`
- **Evidence:** `packages/shared/test/views.test.ts` › "keeps times exact to the nanosecond"
```

So "is it done?" is a claim that can be checked, not an agent's impression. The pacer judges every scenario as `fulfilled`, `missed` or `not_run`, and the rule that matters most is that **a check that did not run is `not_run`, never `pass`**. Agents like to report success; this rule makes a missing check visible instead of hiding it.

### 4. An engineering team, not one agent

One agent that specs, builds, tests and reviews its own work grades its own homework. The team splits that ([team.md](team.md)):

| Role | Model | Writes |
|---|---|---|
| Lead (main session) | opus | commits, status, decisions, demos to Jan; no product code |
| Spec owner | opus | the change's specs, design, tasks |
| Engineers | opus, small tasks | only their assigned area (`packages/shared`, `apps/server/src` or `apps/web/src`) |
| Tester | sonnet | tests, written from the spec in parallel with the engineers |
| UI user | sonnet | nothing; drives the app in Chrome on real data, screenshots as evidence |
| Reviewer | opus | nothing; findings on the round's diff |
| Pacer | sonnet | task checkboxes and the round log; decides how the round ends |
| Crash guard | sonnet | nothing; build and headless-Chrome smoke, pass/fail |
| UI designer | opus | mocks only, before a UI change is specced |

What makes it fast:

- **Parallel by design.** The spec owner pins the shared interfaces (DTOs in `packages/shared`) in the design, so server and web are built at the same time. The pacer cuts the open tasks into 1–4 tasks with disjoint write areas, so engineers in the same working tree cannot overwrite each other.
- **Independent checks.** The tester writes tests from the spec, not from the code; the reviewer writes no code; the UI user sees only the running app. Each checks the others' claims.
- **Small, self-contained briefs.** Each engineer brief names the files to touch and the interfaces from the design, so no agent explores the repository.
- **Narrow rights.** Only the lead commits. No agent may `stash`, `reset`, `checkout` or kill processes, since others work in the same tree.

The rounds run as one workflow ([.claude/workflows/change-round.js](../.claude/workflows/change-round.js)): plan, build and tests in parallel, check (build, test, lint, UI on real data, review), pacer, crash guard; at most three rounds per call.

### 5. A built-in stop

A round ends in one of three ways: `done`, `continue` (new tasks only from open findings) or `needs_jan`. The pacer stops with `needs_jan` when a finding comes back after a fix (loop), when code appears that no task asks for (creep), when one of Jan's decisions is touched, when a finding needs a spec change, or when only Jan can decide or do something (visual judgement, credentials, the real database).

48 of the 111 logged rounds (43%) ended with `needs_jan`. The logs show what that usually meant: a scenario's wording no longer matched code that was right, a check that needed a human hand or a running tunnel, or the round limit, rarely wrong behaviour. The agents asked where they would otherwise have guessed, and Jan's time went into decisions, not into reading code.

### 6. Small changes, specs as living documentation

43 changes in 10 days: each one small enough to spec, build, check and archive in one sitting. Archiving syncs the change's delta specs into the main specs, so [openspec/specs/](../openspec/specs/) always describes the running app, and the next change starts from that, not from someone's memory of it.

### 7. Checked on real data and in the real UI

The UI user drives the app in Chrome on the recordings of Jan's own car, the crash guard opens it in headless Chrome, and both happen before Jan sees anything. "It compiles" and "the unit tests pass" were not enough twice (2026-10-17); a check in the running app was.

### 8. Small context everywhere

`AGENTS.md` holds 13 lines of rules and links. Each agent reads only what its task needs: the change's design and the files it touches. Reports are short (build reports up to 15 lines, at most 2 lines of evidence per scenario) and the workflow passes summaries, not transcripts. Every agent costs about 40k tokens just to start, so the budget prefers fewer agents over smaller ones: no UI rerun without web changes, no extra round for a task that could have run in parallel.

### 9. The process is versioned like code

Roles, rules and the round workflow live in the repository and change by commit. When something went wrong (a crash past the build, a cluttered layout, an expensive change), the answer was a change to a team file, so the next round already worked differently.

## One feature request, end to end

On 2026-10-23 Jan, testing on Azure Data Explorer, found Unlink slow without feedback. The lead offered a background prefetch; Jan declined and asked for a patience hint instead.

| Time | Step | Commit |
|---|---|---|
| 17:36 | Jan's answer recorded as D-113 with his words and the why | `D-113: patience hint on a slow Unlink, no prefetch` |
| 17:40 | Spec owner: proposal, delta spec with scenarios, design, tasks | `add-unlink-hint: proposal, spec, design, tasks` |
| 17:54 | One round: built, tested, checked on the real vehicle (hint at 1021 ms, gone with the result) | `add-unlink-hint round 1: …` |
| 18:03 | Archived, main spec synced, status updated | `archive add-unlink-hint: …` |

27 minutes from the decision to an archived, checked feature. The proposal ([openspec/changes/archive/2026-10-23-add-unlink-hint/proposal.md](../openspec/changes/archive/2026-10-23-add-unlink-hint/proposal.md)) quotes the decision, names the files it touches and says what is out of scope ("any prefetch … declined in D-113").

## Why the first result was usually right

In Jan's experience, a feature request almost always gave the right result on the first try. The repository agrees: only 2 of 43 changes exist to fix earlier ones, and both came from the first use outside the dev setup (the search tool's team testing the handoff, Jan on Azure Data Explorer with Edge on Windows), not from a feature built wrong. The reasons are the ones above, working together:

- The request reaches the builders as a spec with scenarios, and the decision behind it with its reason, not as a one-line prompt.
- Where a decision is Jan's, the spec owner writes it into the design as an open question (Q-1, Q-2, …) and the lead asks Jan before anything is built (D-107).
- Three independent checks (tests from the spec, the UI on real data, the review) meet before Jan sees anything, and a missing check is reported as missing.
- Anything that would have been a guess stops as `needs_jan`.

## Taking it to another project

What to copy, in order of value:

1. **A concept** in the user's language before the repository: the workflow, the scope, what is out of scope, the open decisions.
2. **A decision ledger** ([decisions.md](decisions.md)): append-only, one entry per decision with **Decision** and **Why**, the decider's words quoted, and the rule that agents never reinterpret an entry.
3. **OpenSpec with evidence in every scenario**, and the rule `not_run` is never `pass`. Add the archive guidance that copies project-wide decisions into the ledger ([openspec/config.yaml](../openspec/config.yaml)).
4. **A tiny AGENTS.md** with rules and links only.
5. **The team** ([team.md](team.md), [.claude/agents/](../.claude/agents/)): a lead who writes no product code, a spec owner, engineers with disjoint write areas, a tester working from the spec, a reviewer and a pacer with stop rules. Start without the UI user, crash guard and designer if there is no UI.
6. **The round workflow** ([.claude/workflows/change-round.js](../.claude/workflows/change-round.js)) with a round limit.
7. **A check in the running product** before a human sees it (here [scripts/smoke.mjs](../scripts/smoke.mjs)).

What to adapt:

- **Write areas** follow the project's layout; the point is that no two parallel tasks touch the same files, and that shared interfaces are pinned in the design first.
- **Models and budget**: measure the first change and set the rules from that.
- **The stop rules** name what only your human can decide or do.
- **Fix the process by commit.** When a round fails in a new way, change the team file, not just the code.

What it needs from the human:

- **Fast, short decisions.** More than a third of the rounds ended with a question to Jan; the setup is efficient because his answers were quick and came with a reason.
- **Domain knowledge.** Jan knows the car, its CAN bus and what an engineer looks for; the agents knew everything else.
- **Reading results, not code.** Jan judged the running app and the scenarios' evidence; reviewing code was the reviewer's job.
