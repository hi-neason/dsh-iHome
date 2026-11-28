import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { formatExpenseAmount, prepareExpenseChange, queryExpenses, validateExpenseBoard } from '../src/expense-model.ts'
import { iHomeWorkspacePath } from '../src/ihome-workspace-path.ts'

const bundle = await build({ entryPoints: ['src/expense-host.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { mountExpenses } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
const empty = { revision: 0, entries: [] }
const create = { action: 'create', expectedRevision: 0, expenseId: 'transaction-1', title: '设计定金', date: '2026-11-28',
  payee: '设计工作室', category: '设计费', stage: 'design', kind: 'payment', amountCents: 10001 }
const accept = async ({ questions: [question] }) => ({ answers: [{ id: question.id, selected: ['接受'] }] })
function context(provider, cwd = iHomeWorkspacePath(), signal = new AbortController().signal) {
  const header = { cwd }
  const events = []
  if (provider) {
    Object.assign(header, { parentSession: 'parent', delegationDepth: 1, origin: 'subagent' })
    events.push({ type: 'subagent/descriptor', data: { version: 3, mode: 'continuable', provider } })
  }
  return { signal, agent: { session: { header, snapshotEvents: () => events } } }
}
async function fixture(ask = accept, beforeWrite) {
  let board, route, cleanup, closed = false
  const tools = []
  const table = { get: () => board, put: async (_key, value) => { board = value },
    async update(_key, transform) { await beforeWrite?.(); board = transform(board); return board } }
  await mountExpenses({
    storageDomain: { async open(spec) { assert.equal(spec.name, 'ihome_expenses'); return { table: () => table, close: async () => { closed = true } } } },
    effect: async setup => { cleanup = await setup() }, userQuestions: { ask },
    connection: { fetch: { register(value) { route = value; return () => { route = undefined } } } },
    tools: { register(tool, options) { tools.push({ tool, options }); return () => tools.splice(tools.findIndex(item => item.tool === tool), 1) } },
  })
  return { table, tools, board: () => board, cleanup: () => cleanup(), closed: () => closed,
    run: (name, args, execution = context()) => tools.find(item => item.tool.name === name).tool.execute(args, execution),
    http: (query = '', method = 'GET') => route.fetch(new Request('http://localhost/api/ihome/expenses' + query, { method })),
  }
}

test('financial entries validate exact amounts, dates and identity', () => {
  for (const fields of [{ amountCents: 0 }, { amountCents: -1 }, { amountCents: 1.01 }, { amountCents: Number.MAX_SAFE_INTEGER + 1 },
    { date: '2026-02-29' }, { date: '0000-01-01' }, { title: '' }, { stage: 'bogus' }, { kind: 'planned' }, { expenseId: '' }]) {
    assert.throws(() => prepareExpenseChange(empty, { ...create, ...fields }))
  }
  const board = prepareExpenseChange(empty, create).next
  assert.throws(() => validateExpenseBoard({ ...board, entries: [...board.entries, ...board.entries] }), /编号重复/)
  assert.throws(() => prepareExpenseChange(board, { action: 'update', expectedRevision: 0, expenseId: create.expenseId, amountCents: null }), /金额/)
  assert.equal(formatExpenseAmount(Number.MAX_SAFE_INTEGER), '90071992547409.91')
  assert.equal(formatExpenseAmount(-101), '-1.01')
  const minimal = prepareExpenseChange(empty, { ...create, payee: undefined, category: undefined })
  assert.equal(minimal.next.entries[0].payee, '')
  assert.equal(minimal.next.entries[0].category, '')
  assert.match(minimal.summary, /收款方：未填写[\s\S]*类别：未填写/)
})

test('stable transaction IDs deduplicate retries while preserving identical real payments', () => {
  const initial = prepareExpenseChange(empty, create)
  const board = { ...initial.next, revision: 1 }
  assert.equal(prepareExpenseChange(board, create).changed, false)
  assert.throws(() => prepareExpenseChange(board, { ...create, expectedRevision: 1, amountCents: 200 }), /编号已使用/)
  const repeatedPayment = prepareExpenseChange(board, { ...create, expectedRevision: 1, expenseId: 'transaction-2' })
  assert.equal(repeatedPayment.next.entries.length, 2)
  const changed = prepareExpenseChange(board, { action: 'update', expectedRevision: 1, expenseId: create.expenseId, notes: '支付凭证 #123' })
  assert.deepEqual(changed.next.entries[0], { ...board.entries[0], notes: '支付凭证 #123' })
  assert.match(changed.summary, /更新前[\s\S]*更新后[\s\S]*支付凭证 #123/)
  const deleted = prepareExpenseChange(board, { action: 'delete', expectedRevision: 1, expenseId: create.expenseId })
  assert.equal(deleted.next.entries.length, 0)
})

test('stage and date summaries count refunds once with integer precision', () => {
  const entry = prepareExpenseChange(empty, create).next.entries[0]
  const board = { revision: 4, entries: [entry,
    { ...entry, id: 'refund', kind: 'refund', amountCents: 10 },
    { ...entry, id: 'material', stage: 'construction', date: '2026-11-29', amountCents: 20 }] }
  const all = queryExpenses(board)
  assert.equal(all.summary.paymentCents, 10021)
  assert.equal(all.summary.refundCents, 10)
  assert.equal(all.summary.netCents, 10011)
  assert.equal(queryExpenses(board, { stage: 'design' }).summary.netCents, 9991)
  assert.deepEqual(queryExpenses(board, { from: '2026-11-29', to: '2026-11-29' }).entries.map(item => item.id), ['material'])
  assert.throws(() => queryExpenses(board, { from: '2026-12-01', to: '2026-11-01' }), /日期范围/)
  assert.throws(() => validateExpenseBoard({ revision: 0, entries: [
    { ...entry, amountCents: Number.MAX_SAFE_INTEGER }, { ...entry, id: 'overflow', amountCents: 1 },
  ] }), /精确计算/)
})

test('confirmed tools persist to the ledger and expose revision-aware read-only HTTP', async () => {
  const questions = []
  const f = await fixture(async request => { questions.push(request.questions[0]); return accept(request) })
  assert.equal((await f.run('ihome_propose_expense', create)).status, 'applied')
  assert.match(questions[0].detail, /付款 100.01 元[\s\S]*设计定金[\s\S]*2026-11-28/)
  assert.equal((await f.run('ihome_propose_expense', create)).status, 'unchanged')
  assert.equal(questions.length, 1)
  assert.equal((await (await f.http()).json()).summary.netCents, 10001)
  assert.equal((await f.http('?revision=1')).status, 204)
  assert.equal((await f.http('', 'POST')).status, 405)
  await f.cleanup()
  assert.equal(f.closed(), true)
  assert.equal(f.tools.length, 0)
})

test('workspace and expert tool permissions guard ledger reads and mutations', async () => {
  const f = await fixture()
  for (const { tool, options } of f.tools) {
    const outside = context(undefined, '/tmp')
    assert.equal(options.when(outside), false)
    await assert.rejects(tool.execute(create, outside), /仅在 iHome工作区/)
  }
  assert.equal((await f.run('ihome_read_expenses', {}, context('ihome-finance-expert'))).entries.length, 0)
  await assert.rejects(f.run('ihome_propose_expense', create, context('ihome-finance-expert')), /权限/)
  await assert.rejects(f.run('ihome_read_expenses', {}, context('ihome-fengshui-expert')), /权限/)
})

test('declined and cancelled confirmations leave the ledger intact', async () => {
  for (const answers of [[], [{ id: 'apply-expense-change', selected: ['不接受'] }],
    [{ id: 'apply-expense-change', selected: ['接受'], custom: '金额改一下' }]]) {
    const f = await fixture(async () => ({ answers }))
    const reply = await f.run('ihome_propose_expense', create)
    assert.equal(reply.status, 'not_applied')
    assert.deepEqual(reply, JSON.parse(JSON.stringify(reply)))
    assert.deepEqual(f.board(), empty)
  }
  const controller = new AbortController()
  const f = await fixture(async request => { controller.abort(); return accept(request) })
  await assert.rejects(f.run('ihome_propose_expense', create, context(undefined, iHomeWorkspacePath(), controller.signal)), { name: 'AbortError' })
  assert.deepEqual(f.board(), empty)
})

test('concurrent confirmed proposals preserve the first write and report stale revisions', async () => {
  const f = await fixture()
  const results = await Promise.all([
    f.run('ihome_propose_expense', create),
    f.run('ihome_propose_expense', { ...create, expenseId: 'transaction-2' }),
  ])
  assert.deepEqual(results.map(item => item.status).sort(), ['applied', 'conflict'])
  assert.equal(f.board().revision, 1)
  assert.equal(f.board().entries.length, 1)
  const failing = await fixture(accept, () => { throw new Error('disk unavailable') })
  await assert.rejects(failing.run('ihome_propose_expense', create), /disk unavailable/)
  assert.deepEqual(failing.board(), empty)
})

test('expense reads provide the current local calendar date for relative transaction dates', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 28, 0, 30).getTime() })
  const f = await fixture()
  const result = await f.run('ihome_read_expenses', {}, context('ihome-finance-expert'))
  assert.equal(result.today, '2026-11-28')
  assert.equal(result.revision, 0)
  assert.deepEqual(result.entries, [])
})
