import test from 'node:test'
import assert from 'node:assert/strict'
import { parseQuoteVersion, parseQuoteTsv, quoteTsvHeader } from '../src/quote-version.ts'

const line = { key: '厨房地面', label: '地面铺砖', unit: '㎡', quantity: 18.5, unitPrice: 60, amount: 1100,
  spec: '业主供砖，含铺贴辅材', status: 'included', source: '原件第 2 页第 4 行' }
const quote = { id: 'quote-1', vendorId: 'vendor-1', version: '初稿', date: '2024-02-29',
  scope: '半包', source: '施工队报价表.xlsx', statedTotal: 1100, lines: [line] }

test('保留商家原始合价、零价和未知金额；新版本修改不影响原始记录', () => {
  const original = parseQuoteVersion(quote)
  assert.deepEqual(original, quote)
  const revised = parseQuoteVersion({ ...original, id: 'quote-2', version: '二稿' })
  revised.lines[0].amount = null
  assert.equal(original.lines[0].amount, 1100)
  assert.equal(parseQuoteVersion(revised).lines[0].amount, null)
  assert.equal(parseQuoteVersion({ ...quote, statedTotal: 0 }).statedTotal, 0)
})

test('报价版本验证有效日期、有效数值、唯一对齐项与可定位出处', () => {
  assert.throws(() => parseQuoteVersion({ ...quote, date: '2025-02-29' }), /日期/)
  assert.throws(() => parseQuoteVersion({ ...quote, statedTotal: -1 }), /总额/)
  assert.throws(() => parseQuoteVersion({ ...quote, lines: [] }), /分项/)
  assert.throws(() => parseQuoteVersion({ ...quote, lines: [line, { ...line, key: ' 厨房地面 ' }] }), /重复/)
  for (const changes of [{ source: ' ' }, { unitPrice: NaN }, { amount: Infinity }, { quantity: -1 }, { status: '__proto__' }]) {
    assert.throws(() => parseQuoteVersion({ ...quote, lines: [{ ...line, ...changes }] }), /分项 1/)
  }
})

test('表格粘贴处理表头、Excel 行尾和空数字，状态可从中文或英文录入', () => {
  const paste = [quoteTsvHeader, '客厅墙面\t面漆\t㎡\t42.5\t0\t0\t一底两面\t包含\tP1',
    '清运\t垃圾清运\t车\t\t\t\t\tunknown\tP2'].join('\r\n')
  const [paint, waste] = parseQuoteTsv('\uFEFF' + paste)
  assert.deepEqual([paint.quantity, paint.unitPrice, paint.amount, paint.status], [42.5, 0, 0, 'included'])
  assert.deepEqual([waste.quantity, waste.unitPrice, waste.amount, waste.status], [null, null, null, 'unknown'])
  assert.equal(waste.source, 'P2')
})

test('拒绝整批不完整粘贴并给出原表行号', () => {
  const first = '地面\t地面铺砖\t㎡\t12\t30\t360\t800砖\t暂估\t第2页'
  assert.throws(() => parseQuoteTsv([quoteTsvHeader, first, '墙面\t墙砖'].join('\n')), /第 3 行/)
  assert.throws(() => parseQuoteTsv(first.replace('12', '12元')), /工程量/)
  assert.throws(() => parseQuoteTsv(first + '\n' + first), /重复/)
  assert.throws(() => parseQuoteTsv(quoteTsvHeader), /分项/)
})
