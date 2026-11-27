import test from 'node:test'
import assert from 'node:assert/strict'
import { assertUniqueQuoteReviews, contractQuestions, parseQuoteReview } from '../src/quote-review.ts'

const existing = { id: 'r1', quoteId: 'quote-A-rev2', topic: '付款节点', question: '什么条件下支付尾款？',
  source: '合同第 5 条', answer: '', answerSource: '', status: 'open' }

test('合同核对覆盖七项条款，每一项可生成具体问题', () => {
  assert.deepEqual(contractQuestions.map(item => item.topic), ['付款节点', '工期', '材料替换', '增项书面确认', '验收', '保修', '税费与清运'])
  for (const {topic, question} of contractQuestions) assert.ok(parseQuoteReview({ ...existing, topic, question, source: '' }).question)
})

test('书面答复和出处须配对，已有答复仍可继续追问', () => {
  assert.deepEqual(parseQuoteReview(existing), existing)
  assert.throws(() => parseQuoteReview({ ...existing, status: 'answered' }), /答复原文和出处/)
  assert.throws(() => parseQuoteReview({ ...existing, answerSource: '第2版补充函' }), /答复原文和出处/)
  assert.throws(() => parseQuoteReview({ ...existing, answer: '现场确认' }), /答复原文和出处/)
  const replied = { ...existing, status: 'answered', answer: '竣工验收合格后付尾款', answerSource: '补充条款第3条' }
  assert.deepEqual(parseQuoteReview(replied), replied)
  assert.deepEqual(parseQuoteReview({ ...replied, status: 'open' }), { ...replied, status: 'open' })
})

test('同一报价版本重复来源与问题须更新原记录，其他版本的澄清保持独立', () => {
  assert.throws(() => assertUniqueQuoteReviews([existing, { ...existing, id: 'r2', question: ' 什么条件下支付尾款？ ' }]), /已有相同/)
  assert.doesNotThrow(() => assertUniqueQuoteReviews([existing, { ...existing, id: 'r2', quoteId: 'quote-A-rev3' }]))
  assert.doesNotThrow(() => assertUniqueQuoteReviews([existing, { ...existing, id: 'r2', source: '合同第 6 条' }]))
})

test('无效状态、空问题、超长证据均拒绝保存', () => {
  for (const invalid of [{ quoteId: '' }, { question: ' ' }, { topic: ' ' }, { status: 'resolved' }, { source: 'x'.repeat(6001) }]) {
    assert.throws(() => parseQuoteReview({ ...existing, ...invalid }))
  }
})
