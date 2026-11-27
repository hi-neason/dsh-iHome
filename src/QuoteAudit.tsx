import { useState, type FormEvent } from 'react'
import { auditDateToday, auditQuote } from './quote-audit'
import type { QuoteBoard, QuoteLine } from './quote-model'
import { parseQuoteReference, type QuoteReference } from './quote-reference'

const money = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' })
type Draft = Omit<QuoteReference, 'unitPrice'> & { unitPrice: string }

function ReferenceEditor({ initial, onSave, onClose }: {
  initial: Draft, onSave: (ref: QuoteReference) => Promise<void>, onClose: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try {
      const value = parseQuoteReference({ ...draft, unitPrice: draft.unitPrice.trim() ? Number(draft.unitPrice) : null })
      await onSave(value)
      onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const fields: [keyof Omit<Draft,'id'>, string, string, string][] = [
    ['key','对照项目键','text','与报价明细的项目键一致'], ['city','采价城市','text','例如重庆'],
    ['spec','材料规格或工艺','text','品牌、型号或施工做法'], ['unit','计量单位','text','例如平方米'],
    ['scope','承包口径','text','例如包工包料，含运输'], ['unitPrice','样本单价（元）','number',''],
    ['date','采价日期','date',''], ['source','样本出处','text','网页链接，或询价单名称、商家和页码']
  ]
  return <form onSubmit={event => void save(event)}><fieldset disabled={busy} className="ih-quote-fields"><legend>记录参照单价</legend>
    {fields.map(([field, label, type, placeholder]) => <label key={field}>{label}<input type={type} required value={draft[field]} placeholder={placeholder}
      min={type === 'number' ? 0 : undefined} step={type === 'number' ? 'any' : undefined}
      onChange={event => setDraft({ ...draft, [field]:event.target.value })}/></label>)}
    <div><button type="submit">{busy ? '正在保存…' : '保存参照'}</button> <button type="button" onClick={onClose}>取消</button></div>
  </fieldset>{error && <p role="alert">{error}</p>}</form>
}

export function QuoteAudit({ board, onSaveReference }: { board: QuoteBoard, onSaveReference: (record: QuoteReference) => Promise<void> }) {
  const [selected, setSelected] = useState('')
  const [historical, setHistorical] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [notice, setNotice] = useState('')
  const quote = board.quotes.find(item => item.id === selected) ?? board.quotes.at(-1)
  const asOfDate = historical && quote?.date ? quote.date : auditDateToday()
  const audit = quote && auditQuote(board, quote.id, asOfDate)
  const vendor = board.vendors.find(item => item.id === quote?.vendorId)
  const names = new Map(board.vendors.map(item => [item.id,item.name]))
  function newReference(line?: QuoteLine) {
    setNotice('')
    setDraft({ id: crypto.randomUUID(), key: line?.key ?? '', city: vendor?.city ?? '', date: '', source: '', unit: line?.unit ?? '',
      spec: line?.spec ?? '', scope: quote?.scope ?? '', unitPrice: '' })
  }
  return <section className="ih-quote-panel" aria-label="单份报价核查"><h2>单份报价核查</h2>
    {board.quotes.length > 0 && <label>报价版本<select value={quote?.id} onChange={event => setSelected(event.target.value)}>
      {board.quotes.map(item => <option key={item.id} value={item.id}>{names.get(item.vendorId)} · {item.version} · {item.date || '无日期'}</option>)}
    </select></label>}
    {audit && quote ? <>
      <p>原报总额 {quote.statedTotal === null ? '未提供' : money.format(quote.statedTotal)} · 已知已含小计 {audit.knownIncluded === null ? '待确认' : money.format(audit.knownIncluded)}（{audit.knownIncludedCount} 项）</p>
      <p>{audit.totalDifference === null ? '现有明细或承包归属不足以核对整单差额。' : audit.totalDifference === 0 ? '原报总额与已含分项合计一致。' : `原报总额减已含分项合计为 ${money.format(audit.totalDifference)}。`}</p>
      <h3>待向商家核实（{audit.questions.length}）</h3>
      {audit.questions.length ? <ul>{audit.questions.map((item,index) => <li key={index}><strong>{item.item}</strong> · {item.evidence}<br/>{item.question}{item.source && <><br/><small>{item.source}</small></>}</li>)}</ul> : <p>当前规则未发现需要澄清的问题。</p>}
      <h3>分项核算与参照单价</h3>
      <label><input type="checkbox" checked={historical} onChange={event => setHistorical(event.target.checked)}/>仅回看报价日已有的采价样本</label><p>核查基准日 {asOfDate}</p>
      {audit.checkedLines.map(({line, calculated, checks}, index) => <details key={`${quote.id}-${index}`}>
        <summary>{line.label} · {checks.filter(check => check.difference !== null).length} 条可比价格</summary>
        <p>{line.quantity ?? '工程量未填'} {line.unit} × {line.unitPrice === null ? '单价未填' : money.format(line.unitPrice)}，计算合价 {calculated === null ? '待核' : money.format(calculated)}，原列合价 {line.amount === null ? '未列' : money.format(line.amount)}。</p>
        {checks.length ? <ul>{checks.map(({ reference, reason, difference }) => <li key={reference.id}>
          {reference.city} · {reference.date} · {money.format(reference.unitPrice)}/{reference.unit} · {reference.spec} · {reference.scope}<br/>
          <small>出处 {reference.source} · {reason || `报价减参照 ${money.format(difference!)}/${reference.unit}`}</small>
        </li>)}</ul> : <p>此项目尚无参照样本。</p>}
        <button type="button" onClick={() => newReference(line)}>以此项记录参照单价</button>
      </details>)}
    </> : <p>录入商家的书面报价后，可在这里核对金额和价格依据。</p>}
    <h3>价格样本（{board.references.length}）</h3>
    {board.references.length > 0 && <details><summary>查看全部样本</summary><ul>{board.references.map(ref => <li key={ref.id}>
      {ref.key} · {money.format(ref.unitPrice)}/{ref.unit} · {ref.spec} · {ref.scope}<br/><small>{ref.city} · {ref.date} · {ref.source}</small>
    </li>)}</ul></details>}
    {draft ? <ReferenceEditor key={draft.id} initial={draft} onClose={() => setDraft(null)} onSave={async record => { await onSaveReference(record); setNotice('参照单价已保存。') }} />
      : <button type="button" onClick={() => newReference()}>添加参照单价</button>}
    {notice && <p role="status">{notice}</p>}
  </section>
}
