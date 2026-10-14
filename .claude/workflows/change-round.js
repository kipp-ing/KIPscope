export const meta = {
  name: 'change-round',
  description: 'letsview: build rounds for an OpenSpec change (build, test, UI check, review, spec check) until done',
  whenToUse: 'args: {change: "add-sna-handling", date: "YYYY-MM-DD", maxRounds?: 3, hint?: "..."}. Spec, design and tasks of the change must exist.',
  phases: [{ title: 'Plan' }, { title: 'Build' }, { title: 'Check' }, { title: 'Judge' }, { title: 'Pace' }],
}

const CHANGE = args && args.change
if (!CHANGE) throw new Error('args.change is required')
const DATE = (args && args.date) || 'unknown'
const MAX = (args && args.maxRounds) || 3
const HINT = args && args.hint ? `\nHint from the lead: ${args.hint}` : ''
const ROLE = r =>
  `Work in the role defined in .claude/agents/lv-${r}.md (read it first) and follow docs/team.md. Change: openspec/changes/${CHANGE}/. Date ${DATE}.${HINT}`
const SONNET = { model: 'sonnet', agentType: 'general-purpose' }
const OPUS = { agentType: 'general-purpose' }

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
          evidence: { type: 'string' },
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
    decision: { type: 'string', enum: ['done', 'continue', 'needs_jan'] },
    reason: { type: 'string' },
    tasks: TASKS,
  },
  required: ['decision', 'reason', 'tasks'],
}

phase('Plan')
const plan = await agent(
  `${ROLE('pacer')}
Plan round 1: split the open tasks of tasks.md into 1–3 engineer tasks with disjoint write areas, plus one tester task (area: test dirs, fixtures, seed script) that writes the scenario tests in parallel.`,
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
  const buildText = reports.map((r, i) => `## ${tasks[i].role} ${tasks[i].area}\n${r || '(no report)'}`).join('\n\n')

  const [test, ui] = await parallel([
    () =>
      agent(
        `${ROLE('tester')}
Check phase, round ${round}: run pnpm build, pnpm test and pnpm lint once and judge every scenario of the change. Write nothing. Build reports:\n${buildText}`,
        { label: `test:r${round}`, phase: 'Check', schema: CHECK, ...SONNET },
      ),
    () =>
      agent(
        `${ROLE('ui-user')}
Round ${round}: check every UI scenario of the change in the running app on real data. Build reports:\n${buildText}`,
        { label: `ui:r${round}`, phase: 'Check', schema: CHECK, ...SONNET },
      ),
  ])
  const evidence = `Build reports:\n${buildText}\n\nTester:\n${JSON.stringify(test)}\n\nUI user:\n${JSON.stringify(ui)}`

  const [review, spec] = await parallel([
    () =>
      agent(`${ROLE('reviewer')}\nReview round ${round}. Do not rerun the suite.\n${evidence}`, {
        label: `review:r${round}`,
        phase: 'Judge',
        schema: CHECK,
        ...OPUS,
      }),
    () =>
      agent(
        `${ROLE('spec-owner')}\nAfter round ${round}: judge every scenario against the evidence and tick fulfilled tasks in tasks.md. Do not rerun the suite.\n${evidence}`,
        { label: `spec:r${round}`, phase: 'Judge', schema: CHECK, ...OPUS },
      ),
  ])
  lastCheck = { test, ui, review, spec }

  const pace = await agent(
    `${ROLE('pacer')}
Round ${round} of at most ${MAX}. Decide done/continue/needs_jan, append the round line to rounds.md and, for continue, give the next tasks (engineer and/or tester) from open findings only.
Checks:\n${JSON.stringify(lastCheck)}`,
    { label: `pace:r${round}`, phase: 'Pace', schema: PACE, ...SONNET },
  )
  result = pace || { decision: 'needs_jan', reason: 'pacer gave no answer', tasks: [] }
  if (result.decision !== 'continue') break
  tasks = result.tasks
}
if (result.decision === 'continue') log(`Round limit ${MAX} reached, scenarios still open`)
return { change: CHANGE, rounds: round, decision: result.decision, reason: result.reason, check: lastCheck }
