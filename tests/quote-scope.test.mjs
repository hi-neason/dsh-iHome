import test from 'node:test'
import assert from 'node:assert/strict'
import { compareQuotes } from '../src/quote-analysis.ts'
import { auditQuote } from '../src/quote-audit.ts'
import { parseQuoteScopeItem, assertUniqueScopeKeys } from '../src/quote-scope.ts'

const scope = { id:'s1',key:'water',label:'公卫地面防水',unit:'平方米',quantity:8,spec:'防水两遍',source:'施工图 D2 第4行' }
const line = { key:'wall',label:'粉刷',unit:'平方米',quantity:8,unitPrice:50,amount:400,spec:'A 级',status:'included',source:'报价 p1' }
function make(scopeItems, a = [line], b = [line]) {
  const vendors = [{id:'a',name:'甲',city:'重庆'},{id:'b',name:'乙',city:'重庆'}]
  const quotes = vendors.map((v, i) => ({id:v.id+'1',vendorId:v.id,version:'原版',date:'2026-10-01',source:v.name+'原报价',scope:'半包',statedTotal:400,lines:i?b:a}))
  return {vendors, quotes, references:[], scopeItems}
}

test('owner scope exposes items omitted by all contractors, preserving actual quoted costs and sources', () => {
  const board=make([scope])
  const comparison=compareQuotes(board)
  assert.equal(comparison.rows.length,2)
  const missing=comparison.rows.find(row=>row.key==='water')
  assert.deepEqual(missing.scopeItem,scope)
  assert.equal(missing.spread,null)
  assert.ok(missing.issues.includes('该底稿项在所选报价中均未列明'))
  assert.deepEqual(missing.cells.map(cell=>cell.amount),[null,null])
  assert.deepEqual(comparison.subtotals,[400,400])
  for (const quote of board.quotes) {
    const question=auditQuote(board,quote.id).questions.find(item=>item.item===scope.label)
    assert.match(question.evidence,/未列入本版报价/)
    assert.ok(question.source.includes(scope.source) && question.source.includes(quote.source))
  }
})

test('checks each contractor against owner specifications even when vendors agree with each other', () => {
  const required = {...scope,key:'wall',label:'客厅墙面',spec:'B 级',quantity:9}
  const board = make([required],[{...line,unit:'项'}],[line])
  const row = compareQuotes(board).rows[0]
  assert.equal(row.spread,null)
  assert.equal(row.cells[0].scopeIssues.length,3)
  assert.equal(row.cells[1].scopeIssues.length,2)
  assert.match(auditQuote(board,'a1').questions[0].evidence,/规格与底稿不符/)
  assert.match(auditQuote(board,'a1').questions[0].source,/施工图 D2 第4行.*甲原报价.*报价 p1/)
  assert.equal(compareQuotes(make([required])).comparableCount,0)
  const good = {...required,spec:'A 级',quantity:8,unit:'㎡'}
  assert.equal(compareQuotes(make([good])).comparableCount,1)
  assert.equal(auditQuote(make([good]),'b1').questions.length,0)
})

test('a partial scope only constrains fields the owner specified; explicit exclusions are questions on that quote', () => {
  const partial = {...scope,key:'wall',unit:'',quantity:null,spec:''}
  const board=make([partial], [line], [{...line,status:'excluded'}])
  assert.deepEqual(compareQuotes(board).rows[0].cells[0].scopeIssues,[])
  assert.match(auditQuote(board,'b1').questions[0].evidence,/业主要求项标注为排除/)
  assert.equal(auditQuote(board,'a1').questions.length,0)
  assert.equal(compareQuotes(make(undefined)).comparableCount,1)
})

test('scope keys and sources are required, optional measurements remain unknown and distinct items cannot share a key', () => {
  assert.deepEqual(parseQuoteScopeItem({...scope,key:' water '}),scope)
  assert.equal(parseQuoteScopeItem({...scope,unit:'',quantity:undefined}).quantity,null)
  for (const changes of [{id:''},{key:' '},{source:''},{label:''},{quantity:-1},{quantity:Infinity}]) assert.throws(()=>parseQuoteScopeItem({...scope,...changes}))
  assert.throws(()=>assertUniqueScopeKeys([scope,{...scope,id:'s2'}]),/重复/)
})
