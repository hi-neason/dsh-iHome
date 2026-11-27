import test from 'node:test'
import assert from 'node:assert/strict'
import { registerQuoteTools } from '../src/quote-tools.ts'
import { changeQuoteBoard, parseQuoteBoard } from '../src/quote-model.ts'
import { iHomeWorkspacePath } from '../src/ihome-workspace-path.ts'

function execution(provider, cwd = iHomeWorkspacePath()) {
  const session = { header: { cwd } }
  if (provider) {
    Object.assign(session.header, { parentSession: 'parent', delegationDepth: 1, origin: 'subagent' })
    session.snapshotEvents = () => [{ type: 'subagent/descriptor', data: { version: 3, mode: 'continuable', provider } }]
  }
  return { agent: { session }, signal: new AbortController().signal }
}
const accept = (request) => ({ answers: [{ id: request.questions[0].id, selected: ['接受'] }] })
function fixture(ask = accept) {
  let board = parseQuoteBoard({ revision: 0, vendors: [] }), writes = 0
  const questions = [], registry = new Map(), disposers = []
  const save = async (args, signal) => {
    signal.throwIfAborted()
    const next = changeQuoteBoard(board, args)
    if (next !== board) writes++
    return board = next
  }
  registerQuoteTools({ tools: { register(tool, options) { registry.set(tool.name, { tool, options }); return () => registry.delete(tool.name) } },
    userQuestions: { async ask(request) { questions.push(request.questions[0]); return ask(request, save) } } },
  () => board, save, disposers)
  const tool = name => registry.get('ihome_' + name + '_quote' + (name === 'read' ? 's' : ''))
  return { board: () => board, writes: () => writes, questions, tool, registry, disposers,
    read: (raw = {}, context = execution()) => tool('read').tool.execute(raw, context),
    propose: (collection, record, revision = board.revision, context = execution()) => tool('propose').tool.execute({ expectedRevision: revision, collection, record }, context) }
}
const firstVendor = { id: 'v1', name: '甲装修', city: '重庆', source: '考察日记' }
const line = { key: '主卧墙面', label: '乳胶漆', unit: '㎡', quantity: 10, unitPrice: 30, amount: 300, status: 'included', spec: '一底两面', source: '第一张第7行' }
const quote = { id: 'q1', vendorId: 'v1', version: '首稿', date: '2026-11-25', source: '甲报价', scope: '半包', statedTotal: 300, lines: [line] }

test('工具仅在对应工作区与授权专家可见且可执行；处置移除全部注册', async () => {
  const f = fixture(), child = execution('ihome-quotes-expert')
  assert.equal(f.tool('read').options.when(child), true)
  assert.equal(f.tool('propose').options.when(child), false)
  assert.equal((await f.read({}, child)).revision, 0)
  await assert.rejects(f.propose('vendors', firstVendor, 0, child), /权限/)
  for (const invalid of [execution('ihome-task-expert'), execution('unknown'), execution(undefined, '/tmp/foreign')]) {
    assert.equal(f.tool('read').options.when(invalid), false)
    await assert.rejects(f.read({}, invalid), /权限/)
    await assert.rejects(f.propose('vendors', firstVendor, 0, invalid), /权限/)
  }
  assert.equal(f.questions.length, 0)
  f.disposers.forEach(dispose => dispose())
  assert.equal(f.registry.size, 0)
})

test('只有明确接受并且未取消才写入；拒绝、自由意见、错误问题编号都保持原状', async () => {
  for (const answer of [
    () => ({ answers: [] }),
    ({ questions: [q] }) => ({ answers: [{ id: q.id, selected: ['不接受'] }] }),
    ({ questions: [q] }) => ({ answers: [{ id: q.id, selected: ['接受'], custom: '先改一下' }] }),
    () => ({ answers: [{ id: 'unrelated', selected: ['接受'] }] }),
  ]) {
    const f = fixture(answer)
    assert.equal((await f.propose('vendors', firstVendor)).status, 'not_applied')
    assert.equal(f.writes(), 0)
  }
  const abort = new AbortController(), f = fixture(request => { abort.abort(); return accept(request) })
  await assert.rejects(f.propose('vendors', firstVendor, 0, { ...execution(), signal: abort.signal }))
  assert.equal(f.writes(), 0)
})

test('版本检查发生在确认前及写入时，幂等重试不提问，显示更新前后全部字段', async () => {
  const f = fixture()
  assert.equal((await f.propose('vendors', firstVendor, 2)).status, 'conflict')
  assert.equal(f.questions.length, 0)
  assert.equal((await f.propose('vendors', firstVendor)).status, 'applied')
  assert.equal((await f.propose('vendors', firstVendor, 0)).status, 'unchanged')
  assert.equal(f.questions.length, 1)
  assert.equal((await f.propose('vendors', { ...firstVendor, name: '甲施工团队' })).status, 'applied')
  assert.match(f.questions[1].detail, /原记录[\s\S]*甲装修[\s\S]*修改为[\s\S]*甲施工团队/)
  const concurrent = fixture(async (request, save) => {
    await save({ expectedRevision: 0, collection: 'vendors', record: { id: 'other', name: '其他团队' } }, request.signal)
    return accept(request)
  })
  assert.equal((await concurrent.propose('vendors', firstVendor)).status, 'conflict')
  assert.equal(concurrent.writes(), 1)
  assert.equal(concurrent.board().vendors[0].id, 'other')
})

test('确认逐行展示大型报价及最后一项，目录可查询版本全文与核查', async () => {
  const f = fixture()
  await f.propose('vendors', firstVendor)
  const lines = Array.from({ length: 42 }, (_, i) => ({ ...line, key: 'a' + i, label: '项目 ' + i, source: '来源行 ' + i }))
  await f.propose('quotes', { ...quote, lines })
  for (let i = 0; i < lines.length; i++) assert.ok(f.questions[1].detail.includes('来源行 ' + i))
  const index = await f.read()
  assert.equal(index.quotes[0].lines, undefined)
  assert.equal(index.quotes[0].lineCount, 42)
  assert.match(index.quotes[0].queryHint, /quoteId/)
  const result = await f.read({ quoteId: 'q1' })
  assert.equal(result.quote.lines.length, 42)
  assert.equal(result.audit.totalDifference, 300 - 42 * 300)
  await assert.rejects(f.read({ vendorId: 'v1', quoteId: 'q1' }), /一种/)
  assert.equal((await f.read({ vendorId: 'v1' })).quotes.length, 1)
  await assert.rejects(f.read({ quoteId: 'missing' }), /不存在/)
})

test('完整记录、指定版本比较、澄清及冻结决定可从数字人往返', async () => {
  const f = fixture()
  for (const [id, name] of [['v1','甲装修'],['v2','乙装修'],['v3','丙装修']]) {
    await f.propose('vendors', { ...firstVendor, id, name })
    await f.propose('quotes', { ...quote, id: 'q'+id.slice(1), vendorId: id, lines: [{ ...line, spec: id === 'v2' ? '不同做法' : line.spec }] })
  }
  await f.propose('quotes', { ...quote, id: 'new', version: '二稿' })
  assert.deepEqual((await f.read({ quoteIds: ['q1','q3'] })).comparison.quotes.map(item => item.id), ['q1','q3'])
  assert.equal((await f.read({ quoteIds: ['q1','q2'] })).comparison.comparableCount, 0)
  await assert.rejects(f.read({ quoteIds: ['q1','new'] }), /每家/)
  const reference = { id: 'ref', key: line.key, city: '重庆', date: quote.date, source: '同城询价函', unit: line.unit, spec: line.spec, scope: quote.scope, unitPrice: 29 }
  await f.propose('references', reference)
  await f.propose('reviews', { id:'review', quoteId:'q1', topic:'保修', question:'如何报修？', source:'合同第2条', status:'open', answer:'', answerSource:'' })
  assert.equal((await f.read({ quoteId:'q1' })).reviews.length, 1)
  const decision = { id: 'decision', quoteId: 'q1', comparedQuoteIds: ['q1','q3'], reason: '书面约定清楚' }
  await f.propose('decisions', decision)
  assert.match(f.questions.at(-1).detail, /甲装修 · 首稿[\s\S]*丙装修 · 首稿[\s\S]*书面约定清楚/)
  const original = await f.read({ decisionId: 'decision' })
  assert.match(original.decision.report, /选定团队与版本　甲装修 · 首稿/)
  assert.equal((await f.read({ vendorId: 'v2' })).decisions.length, 0)
  assert.equal((await f.propose('decisions', decision, 0)).status, 'unchanged')
})

test('底稿可从主会话确认，报价专家读取该要求并识别整份报价的遗漏', async () => {
  const f = fixture()
  const scope = { id: 's', key: '清运', label: '垃圾清运', quantity: null, spec: '', unit: '', source: '业主清单第3项' }
  await f.propose('scopeItems', scope)
  await f.propose('vendors', firstVendor)
  await f.propose('quotes', quote)
  const specialist = execution('ihome-quotes-expert')
  assert.equal((await f.read({}, specialist)).scopeItems[0].source, scope.source)
  assert.match(JSON.stringify((await f.read({ quoteId: 'q1' }, specialist)).audit.questions), /业主清单第3项/)
})

test('网上评价须确认，按公司回查；同名公司隔离且复查保留原报告', async () => {
  const f = fixture()
  for (const id of ['v1','v2']) await f.propose('vendors', { ...firstVendor, id })
  const report = { id:'r1', vendorId:'v1', company:firstVendor.name, city:'重庆', branch:'北店', date:'2026-11-27',
    summary:'商家披露保修承诺。', limitations:'只有商家原文。', questions:['是否有维修工单？'],
    sources:[{ title:'商家说明', url:'https://example.org/north', kind:'merchant', identity:'matched', basis:'公司名和门店地址相符',
      accessed:'2026-11-27', excerpt:'保修期间可联系门店。' }] }
  await assert.rejects(f.propose('research', { ...report, company:'别家公司' }), /名称/)
  assert.equal((await f.propose('research', report)).status, 'applied')
  assert.match(f.questions.at(-1).detail, /https:\/\/example\.org\/north[\s\S]*保修期间可联系门店/)
  assert.equal((await f.propose('research', report, 0)).status, 'unchanged')
  await assert.rejects(f.propose('research', { ...report, summary:'新结论' }), /另存/)
  assert.equal((await f.read({ vendorId:'v2' })).research.length, 0)
  assert.equal((await f.read({ vendorId:'v1' })).research[0].sources[0].identity, 'matched')
  await f.propose('research', { ...report, id:'r2', sources:[], summary:'本次未取得原文。' })
  assert.deepEqual((await f.read({ vendorId:'v1' })).research.map(r => r.id), ['r1','r2'])
})
