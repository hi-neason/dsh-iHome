import { useState } from 'react'
import type { QuoteBoard } from './quote-model'
import { compareQuotes } from './quote-analysis'
import { quoteDocumentKinds } from './quote-documents'
import type { AssessmentSelection } from './quote-assessment'
import { AssessmentHistory, AssessmentRequest, EvidencePicker, initialSelection } from './CompanyAssessment'

export function CompanyComparison({ board, onAsk }: { board: QuoteBoard, onAsk: (prompt: string) => void }) {
  const [selections, setSelections] = useState<AssessmentSelection[]>([])
  const candidates = board.vendors.filter(vendor => !vendor.withdrawn)
  const selected = selections.filter(s => candidates.some(v => v.id === s.vendorId))
  // Explicitly omit unselected vendors. The general quote screen defaults to each vendor's latest version.
  const quoteIds = Object.fromEntries(board.vendors.map(v => [v.id, selected.find(s => s.vendorId === v.id)?.quoteId ?? '']))
  const { quotes, comparableCount, subtotals } = compareQuotes(board, quoteIds)
  return <section><h2>公司对比</h2><p>选择两家或更多公司，再核对各自参与比较的资料版本。</p>
    {candidates.map(vendor => {
      const selection = selected.find(s => s.vendorId === vendor.id)
      const update = (next: AssessmentSelection) => setSelections(values => values.map(s => s.vendorId === vendor.id ? next : s))
      return <article key={vendor.id}><label style={{ display: 'flex', alignItems: 'baseline' }}>
        <input type="checkbox" checked={!!selection} onChange={event => {
          const include = event.currentTarget.checked
          setSelections(values => include ? [...values, initialSelection(board, vendor.id)] : values.filter(s => s.vendorId !== vendor.id))
        }}/>
        {vendor.name} · {vendor.city || '城市未填'}{vendor.contact && ' · ' + vendor.contact}</label>
        {selection && <details><summary>选择资料版本（{selection.documentIds.length} 份原件）</summary>
          <EvidencePicker board={board} selection={selection} change={update}/></details>}</article>
    })}
    {selected.length >= 2 && <><h3>本次对比范围</h3><div style={{ overflowX: 'auto' }} tabIndex={0} role="region" aria-label="公司对比表"><table style={{ minWidth: 600 }}>
      <thead><tr><th>公司</th><th>承包范围</th><th>资料版本</th><th>原报总额</th><th>共同可比分项</th><th>网上评价</th></tr></thead>
      <tbody>{selected.map(s => {
        const v = board.vendors.find(v => v.id === s.vendorId)!
        const index = quotes.findIndex(q => q.id === s.quoteId)
        const q = quotes[index]
        const research = board.research.find(r => r.id === s.researchId)
        return <tr key={v.id}><th scope="row">{v.name}<br/><small>{v.city}</small></th>
          <td>{q?.scope || v.scope || '待确认'}</td>
          <td>{board.documents.filter(doc => s.documentIds.includes(doc.id)).map(doc =>
            <div key={doc.id}>{quoteDocumentKinds[doc.kind]} · {doc.title} · {doc.version}</div>)}{s.documentIds.length === 0 && '未选择原件'}</td>
          <td>{q?.statedTotal == null ? '未知' : q.statedTotal.toLocaleString('zh-CN') + ' 元'}{q && <><br/><small>{q.version}</small></>}</td>
          <td>{quotes.length === selected.length && comparableCount && subtotals[index] != null ?
            comparableCount + ' 项 · ' + subtotals[index]?.toLocaleString('zh-CN') + ' 元' : '暂无全体可比小计'}</td>
          <td>{research ? research.date + ' · ' + research.sources.length + ' 条来源' : '未选择调研'}</td></tr>
      })}</tbody></table></div></>}
    <AssessmentRequest selections={selected} comparing onAsk={onAsk}/>
    <AssessmentHistory records={board.assessments.filter(a => a.selections.length > 1)}/>
  </section>
}
