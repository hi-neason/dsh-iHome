import { useState, type FormEvent } from 'react'
import { parseVendor, type QuoteBoard, type QuoteVendor } from './quote-model'

const fields = [
  ['name', '公司名称'], ['city', '项目城市'], ['contact', '联系人与电话'], ['scope', '承包方式与范围'],
  ['credentials', '资质材料与核验情况'], ['visit', '量房、案例与考察笔记'], ['source', '资料出处或核验凭据'],
] as const

function ProfileEditor({ initial, save, close }: {
  initial?: QuoteVendor, save: (record: QuoteVendor) => Promise<void>, close: () => void,
}) {
  const [draft, setDraft] = useState<QuoteVendor>(() => initial ?? {
    id: crypto.randomUUID(), name: '', city: '', contact: '', scope: '', credentials: '', visit: '', source: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try { await save(parseVendor(draft)); close() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '公司档案保存失败。') }
    finally { setBusy(false) }
  }
  return <form className="ih-company-editor" onSubmit={event => void submit(event)}><fieldset disabled={busy}>
    <legend>{initial ? '编辑公司档案' : '添加装修公司'}</legend>
    <div className="ih-company-fields">{fields.map(([key, label]) => <label key={key}>{label}
      {['name','city','contact'].includes(key)
        ? <input required={key === 'name'} maxLength={key === 'name' ? 160 : key === 'city' ? 100 : 4000}
          value={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.value })}/>
        : <textarea rows={2} maxLength={4000} value={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.value })}/>}
    </label>)}</div>
    {error && <p role="alert">{error}</p>}
    <div className="ih-quote-actions"><button type="submit">{busy ? '正在保存…' : '保存公司'}</button>
      <button type="button" onClick={close}>取消</button></div>
  </fieldset></form>
}

export function CompanyDirectory({ board, save, open }: {
  board: QuoteBoard, save: (record: QuoteVendor) => Promise<void>, open: (id: string) => void,
}) {
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [showWithdrawn, setShowWithdrawn] = useState(false)
  const withdrawn = board.vendors.filter(row => row.withdrawn).length
  const search = query.trim().toLocaleLowerCase()
  const companies = board.vendors.filter(row => Boolean(row.withdrawn) === showWithdrawn && [row.name, row.city, row.contact].some(value => value.toLocaleLowerCase().includes(search)))
  return <section aria-label="装修公司清单">
    <header className="ih-company-heading"><h2>装修公司</h2>
      {!adding && <button className="ih-company-primary" onClick={() => setAdding(true)}>添加公司</button>}</header>
    {adding && <ProfileEditor close={() => setAdding(false)} save={async record => { await save(record); open(record.id) }}/>}
    {!board.vendors.length && !adding && <p className="ih-company-empty">还没有候选公司。添加后，可以按公司整理设计图、报价单和合同。</p>}
    {(withdrawn > 0 || showWithdrawn) && <nav aria-label="公司候选状态">
      <button type="button" aria-pressed={!showWithdrawn} onClick={() => setShowWithdrawn(false)}>候选公司（{board.vendors.length - withdrawn}）</button>
      <button type="button" aria-pressed={showWithdrawn} onClick={() => setShowWithdrawn(true)}>已退出（{withdrawn}）</button>
    </nav>}
    {!search && board.vendors.length > 0 && !companies.length && <p>{showWithdrawn ? '没有已退出的公司。' : '当前没有在选公司。'}</p>}
    {(board.vendors.length > 1 || query) && <label className="ih-company-search">查找公司
      <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="公司名称、城市或联系人"/></label>}
    {search && !companies.length && <p>没有匹配的公司。</p>}
    <ul className="ih-company-list">{companies.map(company => {
      const documents = board.documents.filter(doc => doc.vendorId === company.id).length
      const quotes = board.quotes.filter(quote => quote.vendorId === company.id).length
      return <li key={company.id}><button type="button" onClick={() => open(company.id)} aria-label={'打开公司档案：' + company.name}>
        <span><strong>{company.name}</strong>{(company.city || company.scope) &&
          <small>{[company.city,company.scope].filter(Boolean).join(' · ')}</small>}
          <span className="ih-company-count">{documents} 份原件 · {quotes} 份报价明细</span></span>
        <span aria-hidden="true">›</span>
      </button></li>
    })}</ul>
  </section>
}

export function CompanyProfile({ company, save }: { company: QuoteVendor, save: (row: QuoteVendor) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [savingStatus, setSavingStatus] = useState(false)
  async function changeStatus() {
    setSavingStatus(true)
    try { await save({ ...company, withdrawn: !company.withdrawn }) }
    catch { /* The workbench displays save errors. */ }
    finally { setSavingStatus(false) }
  }
  return <section aria-label="公司基本信息">
    <header className="ih-company-heading"><div><h2>{company.name}</h2>
      {(company.city || company.scope) && <p>{[company.city,company.scope].filter(Boolean).join(' · ')}</p>}</div>
      {!editing && <div className="ih-quote-actions"><button type="button" disabled={savingStatus} onClick={() => setEditing(true)}>编辑公司</button>
        <button type="button" disabled={savingStatus} onClick={() => void changeStatus()}>{company.withdrawn ? '恢复候选' : '退出候选'}</button></div>}</header>
    {company.withdrawn && <p className="ih-company-count">已退出候选，历史资料和报告可继续查看。</p>}
    {editing ? <ProfileEditor initial={company} save={save} close={() => setEditing(false)}/> :
      fields.some(([key]) => !['name','city','scope'].includes(key) && company[key]) &&
      <details className="ih-company-summary"><summary>联系与考察记录</summary><dl>
        {fields.filter(([key]) => !['name','city','scope'].includes(key) && company[key]).map(([key,label]) =>
          <div key={key}><dt>{label}</dt><dd>{company[key]}</dd></div>)}
      </dl></details>}
  </section>
}
