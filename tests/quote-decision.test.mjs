import test from 'node:test'
import assert from 'node:assert/strict'
import { changeQuoteBoard, parseQuoteBoard } from '../src/quote-model.ts'

const add = (board, collection, record) => changeQuoteBoard(board, { expectedRevision: board.revision, collection, record })
function fixture() {
  let board = parseQuoteBoard({ revision: 0, vendors: [] })
  for (const [id, price] of [['甲', 30], ['乙', 40]]) {
    board = add(board, 'vendors', { id, name: id + '团队', city: '重庆', visit: '工地考察' })
    board = add(board, 'quotes', { id: 'q' + id, vendorId: id, version: '初版', date: '2026-11-01',
      scope: '半包', statedTotal: price * 2, source: id + '报价单',
      lines: [{ key: '墙漆', label: '客厅刷漆', quantity: 2, unit: '㎡', spec: '一底两面', unitPrice: price, amount: null, status: 'included', source: '第2页' }] })
  }
  return add(board, 'reviews', { id: 'r', quoteId: 'q甲', topic: '保修', question: '保修期限？', source: '合同7条', answer: '', answerSource: '', status: 'open' })
}

const decision = { id: 'd', quoteId: 'q甲', reason: '工地考察符合要求，签约前追问保修。', comparedQuoteIds: ['q甲', 'q乙'] }
test('decision is generated from selected versions, survives subsequent edits and ignores client-supplied report text', () => {
  let board = add(fixture(), 'decisions', { ...decision, report: '自行捏造的总价' })
  const original = board.decisions[0].report
  for (const text of ['甲团队', '乙团队', '¥20.00', '待澄清', '合同7条', '第2页', '甲报价单', decision.reason]) assert.ok(original.includes(text), text)
  assert.ok(!original.includes('自行捏造'))
  board = add(board, 'reviews', { ...board.reviews[0], answer: '两年', answerSource: '补充函', status: 'answered' })
  board = add(board, 'vendors', { ...board.vendors[0], name: '更名' })
  assert.equal(add(board, 'decisions', decision), board)
  assert.equal(parseQuoteBoard(JSON.parse(JSON.stringify(board))).decisions[0].report, original)
  assert.throws(() => add(board, 'decisions', { ...decision, reason: '试图覆盖' }), /归档/)
  assert.ok(add(board, 'decisions', { ...decision, id: 'd2' }).decisions[1].report.includes('补充函'))
})
test('the chosen version must be amongst real versions, with at most one version per supplier', () => {
  const board = fixture()
  for (const ids of [[], ['q乙'], ['q甲', 'q甲'], ['q甲', 'missing']])
    assert.throws(() => add(board, 'decisions', { ...decision, comparedQuoteIds: ids }))
  const other = add(board, 'quotes', { ...board.quotes[0], id: 'q甲2', version: '再报价' })
  assert.throws(() => add(other, 'decisions', { ...decision, comparedQuoteIds: ['q甲', 'q甲2'] }), /每家/)
})
