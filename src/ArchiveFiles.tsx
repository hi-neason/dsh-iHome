import { useRef, useState, type FormEvent } from 'react'
import { ArchiveDialog } from './ArchiveDialog'
import { attachmentStage, documentStages, newId, removeAttachment, type Archive, type ArchiveService, type Attachment, type DocumentStage } from './archive-model'
import css from './document-library.css'

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function FileEditor({ attachment, archive, houseId, allStages, busy, onDismiss, onSave }: {
  attachment?: Attachment, archive: Archive, houseId: string, allStages: boolean, busy: boolean,
  onDismiss: () => void, onSave: (fields: Pick<Attachment, 'name' | 'stage' | 'kind' | 'source' | 'notes' | 'roomIds'>, files: File[], revision: number) => Promise<void>
}) {
  const [name, setName] = useState(attachment?.name ?? '')
  const [stage, setStage] = useState<DocumentStage>(attachment ? attachmentStage(attachment) : allStages ? 'general' : 'original')
  const [kind, setKind] = useState<'document' | 'material'>(attachment?.kind ?? 'document')
  const [source, setSource] = useState(attachment?.source ?? '')
  const [notes, setNotes] = useState(attachment?.notes ?? '')
  const [roomIds, setRoomIds] = useState(attachment?.roomIds ?? [])
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState('')
  const revision = useRef(archive.revision)
  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    try { await onSave({ name: name.trim(), stage, kind, source: source.trim(), notes: notes.trim(), roomIds }, files, revision.current) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，请重试。') }
  }
  return <ArchiveDialog title={attachment ? '编辑归档信息' : '导入资料'} busy={busy} onDismiss={onDismiss}>
    <form className="ih-document-form" onSubmit={event => void submit(event)}>
      <fieldset disabled={busy}>
        {attachment ? <label>资料名称<input required value={name} onChange={event => setName(event.target.value)} /></label>
          : <label>选择本机文件<input type="file" multiple required onChange={event => setFiles(Array.from(event.target.files ?? []))} /></label>}
        {allStages && <label>所属阶段<select aria-label="所属阶段" value={stage} onChange={event => setStage(event.target.value as DocumentStage)}>
          {documentStages.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select></label>}
        <label>资料类型<select aria-label="资料类型" value={kind} onChange={event => setKind(event.target.value as 'document' | 'material')}>
          <option value="document">文档</option><option value="material">物料资料</option>
        </select></label>
        <label>来源<input value={source} onChange={event => setSource(event.target.value)} placeholder="例如，物业、设计师、产品商家" /></label>
        <label>备注<textarea rows={3} value={notes} onChange={event => setNotes(event.target.value)} placeholder="记录版本、用途或物料型号" /></label>
        {archive.rooms.some(room => room.houseId === houseId) && <fieldset className="ih-document-rooms"><legend>关联房间或区域（不选表示全屋）</legend>
          {archive.rooms.filter(room => room.houseId === houseId).map(room => <label key={room.id}>
            <input type="checkbox" checked={roomIds.includes(room.id)} onChange={event => setRoomIds(previous => event.target.checked ? [...previous, room.id] : previous.filter(id => id !== room.id))} />{room.name}
          </label>)}
        </fieldset>}
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <div className="ih-archive-actions"><button type="submit" disabled={busy}>{busy ? '正在保存…' : '保存到本机'}</button><button type="button" disabled={busy} onClick={onDismiss}>取消</button></div>
    </form>
  </ArchiveDialog>
}

export function ArchiveFiles({ archive, houseId, service, busy, save, allStages = false }: {
  archive: Archive, houseId: string, service: ArchiveService, busy: boolean, save: (next: Archive) => Promise<boolean>, allStages?: boolean
}) {
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState('')
  const [editing, setEditing] = useState<Attachment | 'new' | null>(null)
  const [removing, setRemoving] = useState<Attachment | null>(null)
  const [stage, setStage] = useState('')
  const [kind, setKind] = useState('')
  const [query, setQuery] = useState('')
  const active = useRef(false)
  const latest = useRef(archive)
  latest.current = archive
  const disabled = busy || working
  const attachments = archive.attachments.filter(item => item.houseId === houseId &&
    (allStages || attachmentStage(item) === 'original') && (!stage || attachmentStage(item) === stage) &&
    (!kind || (item.kind ?? 'document') === kind) &&
    [item.name, item.source, item.notes].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  async function run(action: () => Promise<void>) {
    if (active.current || disabled) return
    active.current = true
    setWorking(true)
    setMessage('')
    try { await action() }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : '操作失败，请重试。') }
    finally { active.current = false; setWorking(false) }
  }
  return <div className="ih-document-library"><style>{css}</style>
    <div className="ih-document-intro"><p>{allStages ? '集中保存装修各阶段的图纸、报价、现场记录与物料资料。' : '保存原始户型图、量房资料、交付照片与物业规定。'}</p>
      <button className="ih-document-import" disabled={disabled} onClick={() => setEditing('new')}>导入资料</button></div>
    <div className="ih-document-filters">
      <input type="search" aria-label="搜索资料" placeholder="搜索名称、来源或备注" value={query} onChange={event => setQuery(event.target.value)} />
      {allStages && <select aria-label="筛选阶段" value={stage} onChange={event => setStage(event.target.value)}><option value="">全部阶段</option>{documentStages.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select>}
      <select aria-label="筛选资料类型" value={kind} onChange={event => setKind(event.target.value)}><option value="">全部类型</option><option value="document">文档</option><option value="material">物料资料</option></select>
    </div>
    <div className="ih-document-scroll"><table className="ih-document-table"><thead><tr><th>资料名称</th>{allStages && <th>阶段</th>}<th>类型</th><th>房间或区域</th><th>操作</th></tr></thead>
      <tbody>{attachments.map(item => <tr key={item.id}><td><strong>{item.name}</strong><small>{item.source || '来源未填写'} · {item.date} · {Math.max(1, Math.round(item.file.bytes / 1024))} KB</small>{item.notes && <small title={item.notes}>{item.notes.length > 40 ? item.notes.slice(0, 40) + '…' : item.notes}</small>}</td>
        {allStages && <td>{documentStages.find(value => value.id === attachmentStage(item))?.title}</td>}<td>{item.kind === 'material' ? '物料资料' : '文档'}</td>
        <td>{item.roomIds.map(id => archive.rooms.find(room => room.id === id)?.name).join('、') || '全屋'}</td>
        <td><div className="ih-document-actions"><button disabled={disabled} onClick={() => setEditing(item)}>编辑</button><button disabled={disabled} onClick={() => void run(async () => download(await service.downloadFile(item.id), item.file.name))}>下载</button><button disabled={disabled} onClick={() => { setMessage(''); setRemoving(item) }}>移除</button></div></td></tr>)}</tbody></table></div>
    {!attachments.length && <p className="ih-document-empty">{query || stage || kind ? '没有符合筛选条件的资料。' : '还没有归档资料，点击「导入资料」添加本机文件。'}</p>}
    <p role="status">{working ? '正在处理本机文件…' : message}</p>
    {editing && <FileEditor attachment={editing === 'new' ? undefined : editing} archive={archive} houseId={houseId} allStages={allStages} busy={disabled} onDismiss={() => setEditing(null)} onSave={async (fields, files, revision) => {
      if (active.current || disabled) return
      active.current = true
      setWorking(true)
      try {
        if (latest.current.revision !== revision) throw new Error('资料已发生变化，请关闭弹窗并重新打开后编辑。')
        let attachments = latest.current.attachments
        if (editing === 'new') {
          if (!files.length) throw new Error('请选择要导入的文件。')
          const imported: Attachment[] = []
          for (const file of files) imported.push({ ...fields, id: newId(), houseId, name: file.name,
            date: new Date().toLocaleDateString('sv-SE'), file: await service.uploadFile(file) })
          attachments = [...attachments, ...imported]
        } else attachments = attachments.map(item => item.id === editing.id ? { ...item, ...fields } : item)
        if (latest.current.revision !== revision) throw new Error('资料已发生变化，请关闭弹窗并重新打开后编辑。')
        if (!await save({ ...latest.current, attachments, revision })) throw new Error('归档未完成，请核对页面提示后重试。')
        setEditing(null)
        setMessage('资料已保存到本机。')
      } finally { active.current = false; setWorking(false) }
    }} />}
    {removing && <ArchiveDialog title="移除资料" busy={disabled} onDismiss={() => setRemoving(null)}>
      <p>确认移除「{removing.name}」？家庭档案和文档中心会同步移除这条归档。</p>
      {message && <p role="alert">{message}</p>}
      <div className="ih-archive-actions"><button disabled={disabled} onClick={() => void run(async () => {
        if (await save(removeAttachment(latest.current, removing.id))) { setRemoving(null); setMessage('资料已移除。') }
      })}>确认移除</button><button disabled={disabled} onClick={() => setRemoving(null)}>取消</button></div>
    </ArchiveDialog>}
  </div>
}
