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
