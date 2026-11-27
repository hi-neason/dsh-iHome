import { useEffect, useRef, useState, type FormEvent } from 'react'
import { downloadQuoteDocument, quoteDocumentPreviewAddress, setQuoteDocumentInactive, uploadQuoteDocument } from './quote-document-client'
import { maxQuoteDocumentBytes, quoteDocumentKinds, type QuoteDocument, type QuoteDocumentKind } from './quote-documents'
import type { QuoteBoard, QuoteVendor } from './quote-model'

export function companyDocumentSeries(board: QuoteBoard, vendorId: string) {
  const groups = new Map<string, QuoteDocument[]>()
  // Display newly uploaded versions first, including uploads with the same timestamp.
  const documents = board.documents.filter(doc => doc.vendorId === vendorId).reverse()
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
  for (const doc of documents) {
    const key = JSON.stringify([doc.kind, doc.title])
    const group = groups.get(key)
    if (group) group.push(doc)
    else groups.set(key, [doc])
  }
  return [...groups.values()]
}

export function suggestedVersion(versions: QuoteDocument[]) {
  const used = new Set(versions.map(doc => doc.version))
  let index = versions.length + 1
  while (used.has('V' + index)) index++
  return 'V' + index
}

function DocumentUpload({ company, versions, acceptBoard, close }: {
  company: QuoteVendor, versions: QuoteDocument[], acceptBoard: (board: QuoteBoard) => void, close: () => void,
}) {
  const existing = versions[0]
  const [kind, setKind] = useState<QuoteDocumentKind>(existing?.kind ?? 'quote')
  const [title, setTitle] = useState(existing?.title ?? '')
  const [version, setVersion] = useState(() => suggestedVersion(versions))
  const [file, setFile] = useState<File>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const id = useRef('')
  const request = useRef<AbortController>()
  useEffect(() => () => request.current?.abort(), [])
  async function upload(event: FormEvent) {
    event.preventDefault()
    if (request.current) return
    if (!file || !file.size || file.size > maxQuoteDocumentBytes) { setError('请选择一份非空、24 MB 以内的文件。'); return }
    const controller = new AbortController()
    request.current = controller
    id.current ||= crypto.randomUUID()
    setBusy(true)
    setError('')
    try {
      const next = await uploadQuoteDocument({ id: id.current, vendorId: company.id, kind, title, version }, file, controller.signal)
      controller.signal.throwIfAborted()
      acceptBoard(next)
      close()
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '资料上传失败。')
    } finally {
      request.current = undefined
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  return <form className="ih-company-editor" onChange={() => { id.current = ''; setError('') }} onSubmit={event => void upload(event)}><fieldset disabled={busy}>
    <legend>{existing ? '上传新版本' : '上传公司资料'}</legend>
    <label>原件文件<input required type="file" onChange={e => {
      const chosen = e.target.files?.[0]
      setFile(chosen)
      if (chosen && !title.trim() && !existing) setTitle(chosen.name.replace(/\.[^.]+$/, '') || chosen.name)
    }}/></label>
    <div className="ih-company-fields">
      <label>资料类型<select disabled={!!existing} value={kind} onChange={e => setKind(e.target.value as QuoteDocumentKind)}>
        {(Object.entries(quoteDocumentKinds) as [QuoteDocumentKind, string][]).map(([value,label]) => <option value={value} key={value}>{label}</option>)}
      </select></label>
      <label>资料名称<input required readOnly={!!existing} value={title} maxLength={240} onChange={e => setTitle(e.target.value)}/></label>
      <label>版本<input required value={version} maxLength={120} onChange={e => setVersion(e.target.value)}/></label>
    </div>
    {error && <p role="alert">{error}</p>}
    <div className="ih-quote-actions"><button type="submit">{busy ? '正在上传…' : '保存原件'}</button>
      <button type="button" onClick={close}>取消上传</button></div>
  </fieldset></form>
}

interface PreviewProps { sessionId?: string, openDocument?: (address: string) => void }

function DocumentVersion({ doc, sessionId, openDocument, revision, acceptBoard }: {
  doc: QuoteDocument, revision: number, acceptBoard: (next: QuoteBoard) => void,
} & PreviewProps) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const request = useRef<AbortController>()
  useEffect(() => () => request.current?.abort(), [])
  async function act(action: 'open' | 'download' | 'status') {
    if (request.current) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError('')
    try {
      if (action === 'status') {
        const next = await setQuoteDocumentInactive(doc.vendorId, doc.id, !doc.inactive, revision, controller.signal)
        controller.signal.throwIfAborted()
        acceptBoard(next)
      } else if (action === 'open' && sessionId && openDocument) {
        const address = await quoteDocumentPreviewAddress(doc.vendorId, doc.id, sessionId, controller.signal)
        controller.signal.throwIfAborted()
        openDocument(address)
      } else {
        const blob = await downloadQuoteDocument(doc.vendorId, doc.id, controller.signal)
        controller.signal.throwIfAborted()
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.download = doc.file.name
        link.href = url
        document.body.appendChild(link)
        link.click()
        link.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '原件操作失败。')
    } finally {
      request.current = undefined
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  const uploaded = new Date(doc.uploadedAt).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
  const size = doc.file.bytes < 1024 ? doc.file.bytes + ' B' : Math.ceil(doc.file.bytes / 1024) + ' KB'
  return <div className="ih-company-version"><strong>{doc.version}</strong><span>{doc.file.name}</span>
    <small>{uploaded} · {size}</small>
    <div className="ih-quote-actions">{sessionId && openDocument && <button type="button" disabled={busy} onClick={() => void act('open')}>打开原件</button>}
      <button type="button" disabled={busy} onClick={() => void act('download')}>下载原件</button>
      <button type="button" disabled={busy} onClick={() => void act('status')}>{doc.inactive ? '恢复使用' : '停用此版'}</button></div>
    {error && <p role="alert">{error}</p>}
  </div>
}

export function CompanyDocuments({ board, company, acceptBoard, sessionId, openDocument }: {
  board: QuoteBoard, company: QuoteVendor, acceptBoard: (value: QuoteBoard) => void,
} & PreviewProps) {
  const [upload, setUpload] = useState<QuoteDocument[] | null>(null)
  const [filter, setFilter] = useState<QuoteDocumentKind | ''>('')
  const groups = companyDocumentSeries(board, company.id)
  const [showInactive, setShowInactive] = useState(false)
  const inactive = groups.flat().filter(doc => doc.inactive).length
  const categorized = groups.filter(group => !filter || group[0].kind === filter)
  const visible = categorized.flatMap(allVersions => {
    const versions = allVersions.filter(doc => Boolean(doc.inactive) === showInactive)
    return versions.length ? [{ versions, allVersions }] : []
  })
  const actions = { sessionId, openDocument, revision: board.revision, acceptBoard }
  return <section aria-label="这家公司的资料"><header className="ih-company-heading"><h3>公司资料</h3>
    {!upload && <button type="button" onClick={() => setUpload([])}>上传资料</button>}</header>
    {upload && <DocumentUpload company={company} versions={upload} acceptBoard={next => { acceptBoard(next); setFilter(''); setShowInactive(false) }} close={() => setUpload(null)}/>}
    {(inactive > 0 || showInactive) && <nav aria-label="资料使用状态">
      <button type="button" aria-pressed={!showInactive} onClick={() => setShowInactive(false)}>使用中</button>
      <button type="button" aria-pressed={showInactive} onClick={() => setShowInactive(true)}>已停用（{inactive}）</button>
    </nav>}
    {!!groups.length && <label className="ih-company-filter">筛选资料<select value={filter} onChange={e => setFilter(e.target.value as QuoteDocumentKind | '')}>
      <option value="">全部资料</option>
      {(Object.entries(quoteDocumentKinds) as [QuoteDocumentKind,string][]).map(([id,label]) => <option key={id} value={id}>{label}</option>)}
    </select></label>}
    {!visible.length && !upload && <p className="ih-company-empty">{!groups.length ? '还没有上传这家公司的原件。' : showInactive ? '没有符合条件的已停用资料。' : filter ? '这个分类还没有资料。' : '当前没有使用中的原件。'}</p>}
    {visible.map(({ versions, allVersions }) => {
      const latest = versions[0]
      return <article className="ih-company-document" key={JSON.stringify([latest.kind,latest.title])}>
        <header><div><small>{quoteDocumentKinds[latest.kind]}</small><h4>{latest.title}</h4></div>
          <button type="button" disabled={!!upload} onClick={() => setUpload(allVersions)}>上传新版本</button></header>
        <DocumentVersion key={latest.id} doc={latest} {...actions}/>
        {versions.length > 1 && <details><summary>历史版本（{versions.length - 1}）</summary>
          {versions.slice(1).map(doc => <DocumentVersion key={doc.id} doc={doc} {...actions}/>)}
        </details>}
      </article>
    })}
  </section>
}
