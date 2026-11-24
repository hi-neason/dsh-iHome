import { useRef, useState, type FormEvent } from 'react'
import { ArchiveDialog } from './ArchiveDialog'
import { newId, type Archive, type Decision } from './archive-model'
import decisionCss from './decision-table.css'

interface DecisionTableProps {
  archive: Archive
  houseId: string
  save: (next: Archive) => Promise<boolean>
  busy: boolean
  saveError?: string
}

interface DecisionDraft {
  revision: number
  previous?: Decision
}

export function DecisionTable({ archive, houseId, save, busy, saveError }: DecisionTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DecisionDraft | null>(null)
  const [deleting, setDeleting] = useState<{ id: string, revision: number } | null>(null)
  const [error, setError] = useState('')
  const [saveFailed, setSaveFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const writeInProgress = useRef(false)
  const pending = busy || saving
  const decisions = archive.decisions.filter(item => item.houseId === houseId).slice().reverse()
  const needs = archive.needs.filter(item => item.houseId === houseId)
  const attachments = archive.attachments.filter(item => item.houseId === houseId)
  const superseded = new Set(archive.decisions.map(item => item.supersedesId).filter(Boolean))
  const targetExists = !draft?.previous || decisions.some(item => item.id === draft.previous!.id)
  const stale = !!draft && draft.revision !== archive.revision
  const message = error || (saveFailed ? saveError || '保存未完成，请重试。' : '')

  function edit(previous?: Decision) {
    setDraft({ revision: archive.revision, previous })
    setDeleting(null)
    setError('')
    setSaveFailed(false)
  }

  async function write(next: Archive) {
    if (writeInProgress.current || busy) return false
    writeInProgress.current = true
    setSaving(true)
    setError('')
    setSaveFailed(false)
    try {
      const success = await save(next)
      setSaveFailed(!success)
      return success
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存未完成，请重试。')
      return false
    } finally {
      writeInProgress.current = false
      setSaving(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft || pending) return
    if (stale || !targetExists) {
      setError('资料已更新，请重新载入并核对后保存。')
      return
    }
    const form = new FormData(event.currentTarget)
    const text = String(form.get('text') ?? '').trim()
    if (!text) { setError('请填写决定内容。'); return }
    const decision: Decision = {
      id: newId(), houseId, text, reason: String(form.get('reason') ?? '').trim(),
      needIds: form.getAll('needIds').map(String), attachmentIds: form.getAll('attachmentIds').map(String),
      supersedesId: draft.previous?.id,
    }
    if (await write({ ...archive, decisions: [...archive.decisions, decision] })) {
      setDraft(null)
      setExpandedId(decision.id)
    }
  }

  async function remove(id: string) {
    if (pending || !deleting || deleting.id !== id) return
    if (deleting.revision !== archive.revision) {
      setError('资料已更新，请重新核对这条决定后再删除。')
      return
    }
    if (archive.decisions.some(item => item.supersedesId === id)) {
      setError('后续决定仍引用这条历史记录，请先处理后续决定。')
      setDeleting(null)
      return
    }
    if (await write({ ...archive, decisions: archive.decisions.filter(item => item.id !== id) })) {
      setDeleting(null)
      setExpandedId(null)
    }
  }

  return <>
    <style>{decisionCss}</style>
    <div className="ih-needs-toolbar-actions">
      <button className="ih-needs-button ih-needs-button-primary" type="button" aria-haspopup="dialog" disabled={pending || !!draft} onClick={() => edit()}>添加装修决定</button>
    </div>
    <section className="ih-decisions" aria-label="装修决定">
      {!draft && message && <p className="ih-needs-error" role="alert">{message}</p>}
      <div className="ih-table-scroll ih-decisions-scroll" role="region" aria-label="装修决定表格" tabIndex={0}>
        <table className="ih-records-table ih-decisions-table" aria-label="装修决定">
          <thead><tr><th scope="col">决定内容</th><th scope="col">关联需求</th><th scope="col">选择理由</th><th scope="col">依据资料</th><th scope="col">状态</th></tr></thead>
          {decisions.map(item => {
            const expanded = expandedId === item.id
            const previous = decisions.find(decision => decision.id === item.supersedesId)
            const needLabels = item.needIds.map(id => needs.find(need => need.id === id)?.title || '需求已移除')
            const attachmentLabels = item.attachmentIds.map(id => attachments.find(attachment => attachment.id === id)?.name || '资料已移除')
            return <tbody key={item.id}>
              <tr>
                <th scope="row"><button className="ih-needs-description" type="button" aria-expanded={expanded} onClick={() => {
                  setExpandedId(expanded ? null : item.id)
                  setDeleting(null)
                  setError('')
                  setSaveFailed(false)
                }}><span className="ih-needs-chevron" aria-hidden="true">›</span><span className="ih-needs-title">{item.text}</span></button></th>
                <td><span className="ih-decisions-preview">{needLabels.join('、') || '—'}</span></td>
                <td><span className="ih-decisions-preview">{item.reason || '—'}</span></td>
                <td><span className="ih-decisions-preview">{attachmentLabels.join('、') || '—'}</span></td>
                <td><span className="ih-needs-priority">{superseded.has(item.id) ? '历史' : '当前'}</span></td>
              </tr>
              {expanded && <tr className="ih-needs-detail-row"><td colSpan={5}>
                <div className="ih-decisions-detail">
                  <p>{item.text}</p>
                  {item.reason && <p className="ih-needs-notice">选择理由 · {item.reason}</p>}
                  {needLabels.length > 0 && <p className="ih-needs-notice">关联需求 · {needLabels.join('、')}</p>}
                  {attachmentLabels.length > 0 && <p className="ih-needs-notice">依据资料 · {attachmentLabels.join('、')}</p>}
                  {previous && <p className="ih-needs-notice">此前决定 · {previous.text}</p>}
                </div>
                <div className="ih-needs-row-actions">
                  {deleting?.id === item.id ? <>
                    <span>{deleting.revision === archive.revision ? '确认删除这条装修决定？' : '资料已有更新，请核对当前展示的决定。'}</span>
                    <button className="ih-needs-text-button" type="button" disabled={pending} onClick={() => { setDeleting(null); setError(''); setSaveFailed(false) }}>取消</button>
                    {deleting.revision === archive.revision
                      ? <button className="ih-needs-text-button" type="button" disabled={pending} onClick={() => void remove(item.id)}>确认删除</button>
                      : <button className="ih-needs-text-button" type="button" disabled={pending} onClick={() => { setDeleting({ id: item.id, revision: archive.revision }); setError('') }}>已核对，继续删除</button>}
                  </> : <>
                    <button className="ih-needs-text-button" type="button" aria-haspopup="dialog" disabled={pending || !!draft} onClick={() => edit(item)}>更新决定</button>
                    <button className="ih-needs-text-button" type="button" disabled={pending || !!draft} onClick={() => { setDeleting({ id: item.id, revision: archive.revision }); setError(''); setSaveFailed(false) }}>删除</button>
                  </>}
                </div>
              </td></tr>}
            </tbody>
          })}
          {!decisions.length && <tbody><tr><td colSpan={5} className="ih-table-empty">还没有装修决定。</td></tr></tbody>}
        </table>
      </div>
    </section>
    {draft && <ArchiveDialog title={draft.previous ? '更新装修决定' : '添加装修决定'} busy={pending} onDismiss={() => { setDraft(null); setError(''); setSaveFailed(false) }}>
      <form className="ih-needs-quick-form ih-decisions-form" key={`${draft.previous?.id || 'new'}:${draft.revision}`} onSubmit={event => void submit(event)}>
        {message && <p className="ih-needs-error" role="alert">{message}</p>}
        {(stale || !targetExists) && <div className="ih-needs-notice" role="status">
          <p>{targetExists ? '资料已更新。重新载入会清除尚未保存的输入，并显示最新内容。' : '这条决定已被删除，请关闭弹窗。'}</p>
          {targetExists && <button className="ih-needs-text-button" type="button" disabled={pending} onClick={() => edit(decisions.find(item => item.id === draft.previous?.id))}>重新载入</button>}
        </div>}
        <fieldset disabled={pending || stale || !targetExists}>
          <label>决定内容<textarea name="text" rows={3} required maxLength={4000} defaultValue={draft.previous?.text || ''} placeholder="例如，厨房采用双排布局" /></label>
          <label>选择理由<textarea name="reason" rows={3} maxLength={4000} defaultValue={draft.previous?.reason || ''} placeholder="记录这次选择的考虑与取舍" /></label>
          <fieldset><legend>关联需求</legend><div className="ih-needs-checks">{needs.map(need => <label key={need.id}><input type="checkbox" name="needIds" value={need.id} defaultChecked={draft.previous?.needIds.includes(need.id)} />{need.title}</label>)}</div>{!needs.length && <p className="ih-needs-notice">暂无可关联的居住需求，可以直接记录决定。</p>}</fieldset>
          <fieldset><legend>依据资料</legend><div className="ih-needs-checks">{attachments.map(attachment => <label key={attachment.id}><input type="checkbox" name="attachmentIds" value={attachment.id} defaultChecked={draft.previous?.attachmentIds.includes(attachment.id)} />{attachment.name}</label>)}</div>{!attachments.length && <p className="ih-needs-notice">暂无可关联的资料。</p>}</fieldset>
          {draft.previous && <p className="ih-needs-notice">保存后生成新决定，保留此前的内容与关联。</p>}
        </fieldset>
        <div className="ih-needs-actions"><button className="ih-needs-button" type="button" disabled={pending} onClick={() => { setDraft(null); setError(''); setSaveFailed(false) }}>取消</button><button className="ih-needs-button ih-needs-button-primary" type="submit" disabled={pending || stale || !targetExists}>{pending ? '保存中…' : '保存决定'}</button></div>
      </form>
    </ArchiveDialog>}
  </>
}
