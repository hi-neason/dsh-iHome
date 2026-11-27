import test from 'node:test'
import assert from 'node:assert/strict'
import { auditQuote } from '../src/quote-audit.ts'
import { parseQuoteReference } from '../src/quote-reference.ts'

const base = { key:'wall', label:'客厅墙面', unit:'平方米', quantity:3, unitPrice:10, amount:32, spec:'两遍面漆', status:'included', source:'P1 行3' }
const reference = { id:'r', key:'wall', unit:'㎡', unitPrice:8, spec:'两遍面漆', scope:'包工包料', date:'2026-09-01', source:'重庆门店 A 询价单9号', city:'重庆市' }
const make = (lines, references=[], overrides={}) => ({ vendors:[{id:'v',name:'门店一',city:'重庆'}], references, quotes:[{id:'q', vendorId:'v', version:'A', date:'2026-09-15', scope:'包工包料', source:'9月报价单', statedTotal:35, lines, ...overrides}] })

test('verifies vendor extended amount and original total separately, with traceable questions', () => {
  const result = auditQuote(make([base]), 'q')
  assert.equal(result.knownIncluded,32)
  assert.equal(result.totalDifference,3)
  assert.deepEqual(result.questions.map(item=>item.kind),['算术','算术'])
  assert.equal(result.checkedLines[0].calculated,30)
  assert.match(result.questions[0].source,/9月报价单 · P1 行3/)
  assert.throws(()=>auditQuote(make([]),'unknown'), /找不到/)
})

test('uses only comparable unit-price evidence, keeps disqualified samples and the reason', () => {
  const mismatches = [{unit:'项'},{scope:'仅材料'},{spec:'三遍面漆'},{city:'成都'},{date:'2026-09-20'}]
  const result = auditQuote(make([{...base,amount:30}], [reference,...mismatches.map((extra,i)=>({...reference,id:`b${i}`,...extra})),{...reference,key:'roof'}]),'q')
  const checks=result.checkedLines[0].checks
  assert.equal(checks.length,6)
  assert.deepEqual(checks.map(c=>c.difference), [2,null,null,null,null,null])
  assert.deepEqual(checks.slice(1).map(c=>c.reason.split('不同')[0]), ['计量单位','承包口径','规格或工艺','城市','缺少报价日期或采价晚于报价'])
  assert.equal(checks[0].reference.source,reference.source)
  assert.equal(result.questions.filter(q=>q.kind==='参照单价').length,1)
  const inside=auditQuote(make([base],[reference,{...reference,id:'r2',unitPrice:12}]),'q')
  assert.equal(inside.questions.filter(q=>q.kind==='参照单价').length,0)
})

test('never fills a missing total or uncertain scope with zero and keeps the known subtotal', () => {
  const missing={...base,key:'second',amount:null,quantity:null,unitPrice:null}
  for (const extra of [missing,{...missing,status:'owner',amount:200},{...missing,status:'allowance'},{...missing,status:'unknown'}]) {
    const result=auditQuote(make([base,extra]),'q')
    assert.equal(result.knownIncluded,32)
    assert.equal(result.totalDifference,null)
    assert.ok(result.questions.some(q=>q.item===extra.label))
  }
  const zero=auditQuote(make([{...base,unitPrice:0,amount:0}],[],{statedTotal:0}),'q')
  assert.equal(zero.totalDifference,0)
  assert.equal(auditQuote(make([missing]),'q').knownIncluded,null)
})

test('reference requires verifiable source, applicable local basis and a real calendar date', () => {
  assert.deepEqual(parseQuoteReference(reference),reference)
  for (const extra of [{city:' '},{source:''},{key:''},{scope:''},{spec:''},{unit:''},{date:'2026-02-29'},{unitPrice:NaN},{unitPrice:-1}]) {
    assert.throws(()=>parseQuoteReference({...reference,...extra}))
  }
})
