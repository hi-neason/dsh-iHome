import assert from 'node:assert/strict'
import test from 'node:test'
import { changeQuoteBoard, parseQuoteBoard, QuoteConflict } from '../src/quote-model.ts'

const empty = parseQuoteBoard({ revision: 0, vendors: [] })
const candidate = { collection: 'vendors', expectedRevision: 0, record: { id: 'a', name: '甲团队', city: '重庆', source: '量房记录' } }
test('candidate creation, revision conflicts and exact retries preserve the local record', () => {
  const board = changeQuoteBoard(empty, candidate)
  assert.equal(board.vendors[0].source, '量房记录')
  assert.deepEqual(changeQuoteBoard(board, candidate), board)
  assert.throws(() => changeQuoteBoard(board, { ...candidate, record: { id: 'b', name: '乙团队' } }), QuoteConflict)
  const updated = changeQuoteBoard(board, { ...candidate, expectedRevision: 1, record: { ...board.vendors[0], visit: '已看工地' } })
  assert.equal(updated.vendors.length, 1)
  assert.equal(updated.vendors[0].visit, '已看工地')
  assert.throws(() => parseQuoteBoard({ ...board, vendors: [...board.vendors, ...board.vendors] }), /重复/)
})

const quote = { id: 'q1', vendorId: 'a', version: 'v1', date: '2026-11-01', scope: '半包', source: '报价单', statedTotal: null,
  lines: [{ key: '墙漆', label: '刷漆', unit: '㎡', quantity: 3, unitPrice: 20, amount: null, spec: '', status: 'included', source: '第一行' }] }
test('quote history survives revisions and rejects missing contractors or duplicate version names', () => {
  const first = changeQuoteBoard(empty, candidate)
  const save = (board, record) => changeQuoteBoard(board, { expectedRevision: board.revision, collection: 'quotes', record })
  assert.throws(() => save(empty, quote), /团队/)
  const second = save(first, quote)
  assert.throws(() => save(second, { ...quote, statedTotal: 100 }), /另存/)
  assert.throws(() => save(second, { ...quote, id: 'q2' }), /唯一/)
  assert.deepEqual(save(second, quote), second)
  assert.equal(save(second, { ...quote, id: 'q2', version: 'v2' }).quotes.length, 2)
})
