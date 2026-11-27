import test from 'node:test'
import assert from 'node:assert/strict'
import { auditDateToday } from '../src/quote-audit.ts'
import { parseVendorResearch, vendorResearchPrompt } from '../src/vendor-research.ts'

const source = {
  title: '某业主的水电验收记录', url: 'https://example.org/reviews/17',
  kind: 'owner', identity: 'matched', basis: '项目页标注示例公司重庆分店的完整名称。',
  accessed: '2026-11-27', published: '2026 年 11 月', author: '公开署名', excerpt: '按预约完成验收。',
}
const report = {
  id: 'r1', vendorId: 'company-1', company: '示例公司', city: '重庆', branch: '江北门店', date: '2026-11-27',
  summary: '原文 [1] 记录一次验收经历。', limitations: '只取得一个项目的公开记录。', questions: ['隐蔽工程由谁签字？'], sources: [source],
}

test('preserves original quotes and branch attribution for each source', () => {
  const other = { ...source, published: '', identity: 'other-branch', basis: '正文列的是广州门店。', url: 'https://example.org/reviews/18' }
  const input = { ...report, sources: [source, other] }
  assert.deepEqual(parseVendorResearch(input), input)
  assert.throws(() => parseVendorResearch({ ...report, sources: [{ ...source, basis: '' }] }), /判断依据/)
  assert.throws(() => parseVendorResearch({ ...report, sources: [{ ...source, identity: 'approximate' }] }), /归属/)
  assert.throws(() => parseVendorResearch({ ...report, sources: [{ ...source, kind: 'reliable' }] }), /来源类型/)
})

test('keeps an inaccessible or inconclusive investigation and its limitations', () => {
  const input = { ...report, summary: '未取得指定门店可引原文。', limitations: '所给页面需要登录，未读到评论。', questions: [], sources: [] }
  assert.deepEqual(parseVendorResearch(input), input)
  assert.throws(() => parseVendorResearch({ ...input, limitations: '' }), /局限/)
  assert.throws(() => parseVendorResearch({ ...input, sources: null }), /原文/)
})

test('rejects unsafe citations and invalid or inconsistent read dates', () => {
  for (const url of ['file:///etc/hosts', 'javascript:alert(1)', 'https://name:pw@example.org/', 'https://example.org/a b']) {
    assert.throws(() => parseVendorResearch({ ...report, sources: [{ ...source, url }] }), /HTTP/)
  }
  for (const date of ['2026-02-30', '2026-2-03', '0000-01-01']) assert.throws(() => parseVendorResearch({ ...report, date }), /调研日期/)
  assert.throws(() => parseVendorResearch({ ...report, sources: [{ ...source, accessed: '2026-12-01' }] }), /晚于/)
})

test('prepares an explicitly scoped draft and does not include unrelated private company file fields', () => {
  const vendor = { id: report.vendorId, name: report.company, contact: '私人电话 13000000000', source: '合同地址' }
  const prompt = vendorResearchPrompt(vendor, '重庆', '江北门店', '增项和售后', 'https://example.org/start\nhttps://example.org/start')
  assert.match(prompt, /^\/选商核价分析师 /)
  const scope = JSON.parse(prompt.split('\n')[1])
  assert.deepEqual(scope, { vendorId: vendor.id, company: vendor.name, city: '重庆', branch: '江北门店', focus: '增项和售后', urls: ['https://example.org/start'], requestedOn: auditDateToday() })
  assert.doesNotMatch(prompt, /私人电话|13000000000|合同地址/)
  assert.throws(() => vendorResearchPrompt(vendor, '', '', '', ''), /城市/)
  assert.throws(() => vendorResearchPrompt(vendor, '重庆', '', '', 'data:text/plain,test'), /HTTP/)
})

test('warns before sending a combined set of valid links beyond the expert task limit', () => {
  const vendor = { id: 'v1', name: '示例公司' }
  const links = Array.from({ length: 4 }, (_, i) => 'https://example.org/' + i + 'a'.repeat(2975))
  assert.ok(vendorResearchPrompt(vendor, '重庆', '', '', links.slice(0, 3).join('\n')).length < 12000)
  assert.throws(() => vendorResearchPrompt(vendor, '重庆', '', '', links.join('\n')), /分批提交网页线索/)
})
