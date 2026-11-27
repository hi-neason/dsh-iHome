import { useEffect, useState, type FormEvent } from 'react'
import { requestIHome } from './ihome-http'
import { parseQuoteBoard, parseVendor, type QuoteBoard, type QuoteCollection, type QuoteVendor } from './quote-model'
import { QuoteAudit } from './QuoteAudit'
import { QuoteAnalysis } from './QuoteAnalysis'
import { QuoteIntake } from './QuoteIntake'
import css from './quote-workbench.css'

const vendorFields = [
  ['name', '团队名称'], ['city', '项目城市'], ['contact', '联系人与电话'], ['scope', '承包方式与范围'],
  ['credentials', '资质材料与核验情况'], ['visit', '量房、案例与考察笔记'], ['source', '资料出处或核验凭据'],
] as const

function Vendors({ board, onSave }: { board: QuoteBoard, onSave: (vendor: QuoteVendor) => Promise<void> }) {
  const [draft, setDraft] = useState<QuoteVendor>()
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!draft || busy) return
    setBusy(true)
    try { await onSave(draft); setDraft(undefined) } catch { /* Parent shows the error and keeps the draft. */ }
    finally { setBusy(false) }
  }
  return <section><header><h2>候选团队</h2>{!draft && <button onClick={() => setDraft(parseVendor({ id: crypto.randomUUID(), name: '新团队' }))}>添加团队</button>}</header>
    {draft && <form onSubmit={submit}><fieldset disabled={busy}>
      {vendorFields.map(([key, label]) => <label key={key}>{label}
        {key === 'name' || key === 'city' || key === 'contact'
          ? <input required={key === 'name'} maxLength={key === 'name' ? 160 : key === 'city' ? 100 : 4000} value={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.value })} />
          : <textarea rows={2} maxLength={4000} value={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.value })} />}
      </label>)}
      <div className="ih-quote-actions"><button type="submit">保存团队</button><button type="button" onClick={() => setDraft(undefined)}>取消</button></div>
    </fieldset></form>}
    {!board.vendors.length && !draft && <p>添加第一家准备接洽的装修团队，记录量房情况、承包范围和核验依据。</p>}
    {board.vendors.map(vendor => <article key={vendor.id}><header><h3>{vendor.name}</h3><button disabled={!!draft} onClick={() => setDraft(vendor)}>编辑团队</button></header>
      <dl>{vendorFields.filter(([key]) => key !== 'name' && vendor[key]).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{vendor[key]}</dd></div>)}</dl>
    </article>)}
  </section>
}

const sections = { vendors: '候选团队', quotes: '报价版本', compare: '同口径比价', audit: '核价' }
export function QuoteWorkbench({ onAsk }: { onAsk: (prompt: string) => void }) {
  const [board, setBoard] = useState<QuoteBoard>()
  const [tab, setTab] = useState<keyof typeof sections>('vendors')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reload, setReload] = useState(0)
  useEffect(() => {
    const abort = new AbortController()
    requestIHome('quotes', { signal: abort.signal }).then(r => r.json()).then(parseQuoteBoard).then(next => {
      if (!abort.signal.aborted) { setBoard(next); setError('') }
    }).catch(cause => { if (!abort.signal.aborted) setError(cause.message) })
    return () => abort.abort()
  }, [reload])
  async function save(collection: QuoteCollection, record: unknown) {
    if (!board) throw new Error('选商档案尚未载入。')
    setError(''); setNotice('')
    try {
      const response = await requestIHome('quotes', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedRevision: board.revision, collection, record }) })
      setBoard(parseQuoteBoard(await response.json()))
      setNotice('已保存到本机。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败。')
      throw cause
    }
  }
  return <div className="ih-quotes"><style>{css}</style>
    <div className="ih-quote-actions"><button onClick={() => onAsk('请帮我比较装修团队和报价，先核对已有依据。')}>咨询分析师 ↗</button>
      <button onClick={() => { setBoard(undefined); setNotice(''); setReload(n => n + 1) }}>重新载入档案</button></div>
    {error && <p role="alert">{error}</p>}{notice && <small role="status">{notice}</small>}
    {!board ? <p>{error ? '暂时无法打开档案。' : '正在读取选商档案…'}</p> : <>
      <nav aria-label="选商核价功能">{(Object.keys(sections) as (keyof typeof sections)[]).map(key =>
        <button key={key} aria-pressed={tab === key} onClick={() => { setTab(key); setNotice('') }}>{sections[key]}</button>)}</nav>
      {tab === 'audit' && <QuoteAudit board={board} onSaveReference={row => save('references', row)} />}
      {tab === 'compare' && <QuoteAnalysis board={board} />}
      {tab === 'quotes' && <QuoteIntake board={board} onSave={row => save('quotes', row)} />}
      {tab === 'vendors' && <Vendors board={board} onSave={row => save('vendors', row)} />}
    </>}
  </div>
}
