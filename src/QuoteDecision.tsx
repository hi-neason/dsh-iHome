import { useRef, useState, type FormEvent } from 'react'
import { quoteVersions } from './quote-analysis'
import { freezeDecision, type DecisionInput, type QuoteDecision } from './quote-decision'
import type { QuoteBoard } from './quote-model'

function downloadReport(decision: QuoteDecision) {
  const url = URL.createObjectURL(new Blob(['\uFEFF', decision.report], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = '选商决定-' + decision.date + '-' + decision.id.replace(/[^\w-]/g, '_').slice(0, 40) + '.txt'
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function QuoteDecisionPanel({ board, onSave }: { board: QuoteBoard, onSave: (input: DecisionInput) => Promise<void> }) {
  const [versions, setVersions] = useState<Record<string, string>>({})
  const [chosen, setChosen] = useState('')
  const [reason, setReason] = useState('')
  const [preview, setPreview] = useState<QuoteDecision>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const decisionId = useRef('')
  const selected = board.vendors.flatMap(vendor => {
    const options = quoteVersions(board, vendor.id)
    const id = Object.hasOwn(versions, vendor.id) ? versions[vendor.id] : options[0]?.id
    return options.filter(q => q.id === id)
  })
  function prepare(event: FormEvent) {
    event.preventDefault()
    setError('')
    decisionId.current ||= crypto.randomUUID()
    try { setPreview(freezeDecision(board, { id: decisionId.current, quoteId: chosen, comparedQuoteIds: selected.map(q => q.id), reason })) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法生成报告。') }
  }
  async function confirm() {
    if (!preview || busy) return
    setBusy(true); setError('')
    try {
      await onSave({ id: preview.id, quoteId: preview.quoteId, comparedQuoteIds: preview.comparedQuoteIds, reason: preview.reason })
      setPreview(undefined); setChosen(''); setReason(''); decisionId.current = ''
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存决定失败。') }
    finally { setBusy(false) }
  }
  const title = (id: string) => {
    const quote = board.quotes.find(q => q.id === id)
    return quote && board.vendors.find(vendor => vendor.id === quote.vendorId)?.name + ' · ' + quote.version
  }
  return <section><h2>选商决定与报告</h2>
    {!board.quotes.length ? <p>录入候选团队的书面报价后，可在这里记录选择。</p> : preview ? <article>
      <h3>核对决定与报告</h3><pre className="ih-quote-report">{preview.report}</pre>
      <div className="ih-quote-actions"><button disabled={busy} onClick={() => void confirm()}>确认保存决定</button>
        <button disabled={busy} onClick={() => setPreview(undefined)}>返回修改</button></div>
    </article> : <form onSubmit={prepare}><fieldset><legend>本次考虑的报价</legend>
      {board.vendors.map(vendor => {
        const options = quoteVersions(board, vendor.id)
        if (!options.length) return null
        return <label key={vendor.id}>{vendor.name}<select value={selected.find(q => q.vendorId === vendor.id)?.id ?? ''}
          onChange={event => { setVersions({ ...versions, [vendor.id]: event.target.value }); if (options.some(q => q.id === chosen)) setChosen('') }}>
          <option value="">不参与本次选择</option>{options.map(q => <option key={q.id} value={q.id}>{q.version} · {q.date}</option>)}
        </select></label>
      })}
      <label>选定报价<select required value={chosen} onChange={e => setChosen(e.target.value)}><option value="">请选择</option>
        {selected.map(q => <option key={q.id} value={q.id}>{title(q.id)}</option>)}</select></label>
      <label>选择理由<textarea required maxLength={6000} rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="哪些差异影响了你的决定，还有哪些条件需要签约前确认？" /></label>
      <button type="submit">预览决定与报告</button>
    </fieldset></form>}
    {error && <p role="alert">{error}</p>}
    <h3>已保存的决定（{board.decisions.length}）</h3>
    {board.decisions.slice().reverse().map(d => <article key={d.id}><header><strong>{d.date} · {d.report.split('\n')[2]?.replace(/^选定团队与版本　/, '') || title(d.quoteId)}</strong>
      <button onClick={() => downloadReport(d)}>导出报告</button></header>
      <p>{d.reason}</p><details><summary>查看归档报告</summary><pre className="ih-quote-report">{d.report}</pre></details></article>)}
  </section>
}
