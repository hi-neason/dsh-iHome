import test from 'node:test'
import assert from 'node:assert/strict'
import { compareQuotes } from '../src/quote-analysis.ts'

const line = (extra = {}) => ({ key: 'wall', label: '客厅刷墙', unit: '平方米', quantity: 2, unitPrice: 30, amount: null, spec: '两底一面', status: 'included', source: 'P2', ...extra })
const quote = (id, vendorId, lines, extra = {}) => ({ id, vendorId, lines, version: id, date: '2026-01-01', source: '报价单', scope: '包工包料', statedTotal: 500, ...extra })
const board = quotes => ({ vendors: [{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }], quotes })

test('compares only written equivalent scopes, shows the amount spread and distinct partial subtotals', () => {
  const input = board([quote('a1','a',[line(), line({key:'haul', label:'清运', status:'excluded'})]),
    quote('b1','b',[line({unit: '㎡', unitPrice: 25})])])
  const result = compareQuotes(input)
  assert.equal(result.comparableCount, 1)
  assert.equal(result.rows[0].spread, 10)
  assert.deepEqual(result.subtotals, [60, 50])
  assert.equal(result.rows[1].cells[1].amount, null)
  assert.match(result.rows[1].issues.join(' '), /未列/)
  assert.deepEqual(result.quotes.map(q => q.statedTotal), [500, 500])
})

test('incompatible and unknown measurements, specifications, contractor coverage and scope types stay out of subtotals', () => {
  for (const extra of [{unit:'项'},{unit:''},{unitPrice:null},{quantity:4},{quantity:null},{quantity:0},{spec:'进口漆'},{spec:''},
    {status:'allowance'},{status:'owner'},{status:'unknown'},{status:'excluded'},{amount:61}]) {
    const result = compareQuotes(board([quote('a1','a',[line()]), quote('b1','b',[line(extra)])]))
    assert.deepEqual(result.subtotals, [null, null], JSON.stringify(extra))
    assert.equal(result.rows[0].spread, null)
  }
  assert.match(compareQuotes(board([quote('a1','a',[line()]), quote('b1','b',[line()],{scope:'仅人工'})])).rows[0].issues.join(), /承包口径不同/)
  assert.match(compareQuotes(board([quote('a1','a',[line(),line()]), quote('b1','b',[line()])])).rows[0].issues.join(), /重复/)
})

test('selects latest quote per vendor, supports historical versions and opt-out, and keeps a written zero', () => {
  const input = board([quote('a1','a',[line()]),quote('a2','a',[line({unitPrice:0})],{date:'2026-01-02'}),quote('b1','b',[line()])])
  assert.deepEqual(compareQuotes(input).subtotals,[0,60])
  assert.equal(compareQuotes(input,{a:'a1'}).rows[0].spread,0)
  assert.equal(compareQuotes(input,{b:''}).comparableCount,0)
  assert.deepEqual(compareQuotes(input,{a:'b1'}).quotes.map(q=>q.id), ['b1'])
})
