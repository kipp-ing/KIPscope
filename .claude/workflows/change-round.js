export const meta = {
  name: 'change-round',
  description: 'KIPscope: build rounds for an OpenSpec change (build, test, UI check, review, spec check) until done',
  whenToUse: 'args: {change: "add-sna-handling", date: "YYYY-MM-DD", maxRounds?: 3, hint?: "..."}. Spec, design and tasks of the change must exist.',
  phases: [{ title: 'Plan' }, { title: 'Build' }, { title: 'Check' }, { title: 'Judge' }, { title: 'Pace', detail: 'spec check and decision' }],
}

const CHANGE = args && args.change
if (!CHANGE) throw new Error('args.change is required')
const DATE = (args && args.date) || 'unknown'
const MAX = (args && args.maxRounds) || 3
const HINT = args && args.hint ? `\nHint from the lead: ${args.hint}` : ''
const ROLE = r =>
  `Work in the role defined in .claude/agents/ks-${r}.md (read it first) and follow docs/team.md. Change: openspec/changes/${CHANGE}/. Date ${DATE}.${HINT}`
// Token budget (docs/team.md): opus only for short complex work, sonnet for the rest.
const SONNET = { model: 'sonnet', agentType: 'general-purpose' }
const OPUS = { model: 'opus', agentType: 'general-purpose' }
const cut = (s, n) => (s && s.length > n ? `${s.slice(0, n)} …[cut]` : s || '(no report)')
// Summaries passed between agents: open scenarios and findings only.
const open = c =>
  c
    ? JSON.stringify({
        open: c.scenarios.filter(s => s.state !== 'fulfilled'),
        fulfilled: c.scenarios.filter(s => s.state === 'fulfilled').map(s => s.name),
        findings: c.findings,
      })
    : '(no answer)'

const TASKS = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      role: { type: 'string', enum: ['engineer', 'tester'] },
      area: { type: 'string', description: 'write area, e.g. apps/web/src' },
      tasks: { type: 'array', items: { type: 'string' }, description: 'task numbers / scenario names' },
      brief: { type: 'string' },
    },
    required: ['role', 'area', 'tasks', 'brief'],
  },
}
const PLAN = { type: 'object', properties: { tasks: TASKS }, required: ['tasks'] }
const CHECK = {
  type: 'object',
  properties: {
    scenarios: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          state: { type: 'string', enum: ['fulfilled', 'missed', 'not_run'] },
          evidence: { type: 'string', description: 'at most 2 lines: command or action and shortened result' },
        },
        required: ['name', 'state', 'evidence'],
      },
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'should', 'could', 'note'] },
          where: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['severity', 'text'],
      },
    },
  },
  required: ['scenarios', 'findings'],
}
const PACE = {
  type: 'object',
  properties: {
    scenarios: CHECK.properties.scenarios,
    decision: { type: 'string', enum: ['done', 'continue', 'needs_jan'] },
    reason: { type: 'string' },
    tasks: TASKS,
  },
  required: ['scenarios', 'decision', 'reason', 'tasks'],
}

phase('Plan')
const plan = await agent(
  `${ROLE('pacer')}
Plan round 1: split ALL open build tasks of tasks.md into 1–4 engineer tasks with disjoint write areas, plus one tester task (area: test dirs, fixtures, seed script) that writes the scenario tests in parallel. Do not defer a task to a later round unless it needs another task's output; a small task gets its own engineer or joins one in the same area.`,
  { label: 'plan', phase: 'Plan', schema: PLAN, ...SONNET },
)
let tasks = (plan && plan.tasks) || []

let result = { decision: 'continue', reason: '' }
let round = 0
let lastCheck = null
while (round < MAX && tasks.length) {
  round++
  log(`Round ${round}: ${tasks.length} task(s)`)

  const reports = await parallel(
    tasks.map(t => () =>
      agent(
        `${ROLE(t.role)}
Round ${round}. Write area: ${t.area}. Tasks: ${t.tasks.join(', ')}.
${t.brief}`,
        { label: `${t.role}:${t.area}`, phase: 'Build', ...(t.role === 'tester' ? SONNET : OPUS) },
      ),
    ),
  )
  const buildText = reports.map((r, i) => `## ${tasks[i].role} ${tasks[i].area}\n${cut(r, 1500)}`).join('\n\n')

  // Follow-up rounds check light: the UI user runs again only if the round touched the web app.
  const touchesWeb = tasks.some(t => t.role === 'engineer' && /apps\/web/.test(t.area))
  const [test, uiNow] = await parallel([
    () =>
      agent(
        `${ROLE('tester')}
Check phase, round ${round}: run pnpm build, pnpm test and pnpm lint once and judge every scenario of the change. Write nothing. Build reports:\n${buildText}`,
        { label: `test:r${round}`, phase: 'Check', schema: CHECK, ...SONNET },
      ),
    () =>
      round === 1 || touchesWeb
        ? agent(
            `${ROLE('ui-user')}
Round ${round}: check ${round === 1 ? 'every UI scenario of the change' : 'only the UI scenarios this round touched'} in the running app on real data. Build reports:\n${buildText}`,
            { label: `ui:r${round}`, phase: 'Check', schema: CHECK, ...SONNET },
          )
        : null,
  ])
  if (round > 1 && !touchesWeb) log(`Round ${round}: web untouched, UI check carried over from round ${round - 1}`)
  const ui = uiNow || (lastCheck && lastCheck.ui)

  const review = await agent(
    `${ROLE('reviewer')}\nReview round ${round} (${round === 1 ? 'whole change' : "only this round's diff"}). Do not rerun the suite.\nBuild reports:\n${buildText}\n\nTester (open only):\n${open(test)}`,
    { label: `review:r${round}`, phase: 'Judge', schema: CHECK, ...OPUS },
  )

  // The pacer also does the spec check (judge scenarios, tick tasks): one sonnet agent instead of two.
  const pace = await agent(
    `${ROLE('pacer')}
Round ${round} of at most ${MAX}. Judge every scenario of the change against the evidence below (do not rerun the suite) and tick fulfilled tasks in tasks.md. Then decide done/continue/needs_jan, append the round line to rounds.md and, for continue, give the next tasks (engineer and/or tester) from open findings only.
Build reports:\n${buildText}\n\nTester:\n${JSON.stringify(test)}\n\nUI user:\n${JSON.stringify(ui)}\n\nReviewer:\n${open(review)}`,
    { label: `pace:r${round}`, phase: 'Pace', schema: PACE, ...SONNET },
  )
  lastCheck = { test, ui, review, spec: pace && { scenarios: pace.scenarios || [], findings: [] } }
  result = pace || { decision: 'needs_jan', reason: 'pacer gave no answer', tasks: [] }
  if (result.decision !== 'continue') break
  tasks = result.tasks
}
if (result.decision === 'continue') log(`Round limit ${MAX} reached, scenarios still open`)
const summary = lastCheck && Object.fromEntries(Object.entries(lastCheck).map(([k, v]) => [k, v ? JSON.parse(open(v)) : null]))
return { change: CHANGE, rounds: round, decision: result.decision, reason: result.reason, check: summary }
