import { useState } from 'react'
import type { FormEvent } from 'react'
import { memberReferences, newId, removeMember, type Archive, type Member } from './archive-model'
import { ArchiveDialog } from './ArchiveDialog'
import { MembersTable, RoomsTable } from './HouseTables'
import recordsCss from './house-records.css'

type Tab = 'members' | 'rooms'
type Kind = 'member' | 'room' | 'fact' | 'measurement'
type Editor = { kind: Kind, id?: string }
interface Props {
  archive: Archive
  houseId: string
  save: (next: Archive) => Promise<boolean>
  busy: boolean
  saveError?: string
  onAsk: (prompt: string) => void
}

const tabs: { id: Tab, label: string, kind: Kind }[] = [
  { id: 'members', label: '家人', kind: 'member' },
  { id: 'rooms', label: '房间或区域', kind: 'room' },
]
const kindLabels: Record<Kind, string> = {
  member: '家人', room: '房间或区域', fact: '生活习惯', measurement: '尺寸记录',
}

function Choices({ name, items, selected = [] }: { name: string, items: { id: string, label: string }[], selected?: string[] }) {
  return <div className="ih-records-choices">{items.map(item => <label className="ih-records-choice" key={item.id}>
    <input type="checkbox" name={name} value={item.id} defaultChecked={selected.includes(item.id)} />{item.label}
  </label>)}</div>
}

export function HouseRecords({ archive, houseId, save, busy, saveError, onAsk }: Props) {
  const [tab, setTab] = useState<Tab>('members')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [editorRevision, setEditorRevision] = useState(archive.revision)
  const [error, setError] = useState('')
  const [saveFailed, setSaveFailed] = useState(false)
  const [deleting, setDeleting] = useState<Editor | null>(null)
  const [measureRoomId, setMeasureRoomId] = useState('')
  const rooms = archive.rooms.filter(room => room.houseId === houseId)
  const roomIds = new Set(rooms.map(room => room.id))
  const houseAttachments = archive.attachments.filter(item => item.houseId === houseId)
  const houseNeeds = archive.needs.filter(item => item.houseId === houseId)
  const houseMeasurements = archive.measurements.filter(item => roomIds.has(item.roomId))
  const member = archive.members.find(item => editor?.kind === 'member' && item.id === editor.id)
  const memberNeeds = member ? houseNeeds.filter(item => item.memberIds.includes(member.id)) : []
  const room = archive.rooms.find(item => editor?.kind === 'room' && item.id === editor.id)
  const fact = archive.facts.find(item => editor?.kind === 'fact' && item.id === editor.id)
  const measurement = archive.measurements.find(item => editor?.kind === 'measurement' && item.id === editor.id)
  const selectedRoomId = measureRoomId || measurement?.roomId || rooms[0]?.id || ''

  function start(next: Editor | null) {
    setEditor(next)
    setEditorRevision(archive.revision)
    setSaveFailed(false)
    setError('')
    setDeleting(null)
    setMeasureRoomId('')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editor || busy) return
    setError('')
    setSaveFailed(false)
    if (editorRevision !== archive.revision) return setError('资料有新的更改，请重新打开表单，核对最新资料后再保存。')
    const data = new FormData(event.currentTarget)
    const text = (key: string) => String(data.get(key) ?? '').trim()
    const values = (key: string) => data.getAll(key).map(String)
    const id = editor.id || newId()
    let next = { ...archive }
    if (editor.kind === 'member') {
      const name = text('name')
      if (!name) return setError('请填写家人的称呼。')
      if (archive.members.some(item => item.id !== id && item.name === name)) return setError('这个称呼已存在，请使用可区分的称呼。')
      const age = text('age') === '' ? undefined : Number(text('age'))
      if (age !== undefined && (!Number.isSafeInteger(age) || age < 0)) return setError('年龄请输入非负整数。')
      const updated: Member = {
        ...member, id, name, age,
        gender: (text('gender') || undefined) as Member['gender'],
        residency: (text('residency') || '待确认') as Member['residency'],
        needsText: String(data.get('needsText') ?? '') || undefined,
      }
      next.members = member ? archive.members.map(item => item.id === id ? updated : item) : [...archive.members, updated]
    }
    if (editor.kind === 'room') {
      const name = text('name')
      if (!name) return setError('请填写房间或区域名称。')
      if (rooms.some(item => item.id !== id && item.name === name)) return setError('这个房间或区域名称已存在。')
      const updated = { id, houseId, name }
      next.rooms = room ? archive.rooms.map(item => item.id === id ? updated : item) : [...archive.rooms, updated]
    }
    if (editor.kind === 'fact') {
      if (!text('text')) return setError('请描述一件日常习惯或居住困扰。')
      if (!values('members').length) return setError('请选择这件事涉及的家人。')
      next.facts = [...archive.facts.filter(item => item.id !== id), { id, text: text('text'), memberIds: values('members'), quote: fact?.quote }]
    }
    if (editor.kind === 'measurement') {
      const roomId = text('roomId')
      const label = text('label')
      const value = Number(text('value'))
      if (!roomIds.has(roomId) || !label || !Number.isFinite(value) || value <= 0) return setError('请选择房间或区域，并填写测量项目和大于零的尺寸。')
      const adopted = data.has('adopted')
      const item = {
        id, roomId, label, value, unit: text('unit') as 'mm' | 'cm' | 'm',
        source: text('source') as '实测' | '图纸' | '估算', date: text('date'), adopted,
        attachmentId: text('attachmentId') || undefined,
        quote: measurement?.quote,
      }
      next.measurements = [...archive.measurements.filter(item => item.id !== id).map(existing => {
        const sameTarget = existing.roomId === roomId && existing.label === label
        return adopted && sameTarget ? { ...existing, adopted: false } : existing
      }), item]
    }
    if (await save(next)) start(null)
    else setSaveFailed(true)
  }

  async function remove(target: Editor) {
    const id = target.id!
    let next = { ...archive }
    let used = false
    if (target.kind === 'member') {
      try { next = removeMember(archive, id) }
      catch (cause) {
        setError(cause instanceof Error ? cause.message : '无法删除这位家人，请刷新档案后重试。')
        return
      }
    }
    if (target.kind === 'room') {
      used = archive.needs.some(item => item.roomIds.includes(id)) || archive.measurements.some(item => item.roomId === id) || archive.attachments.some(item => item.roomIds.includes(id))
      next.rooms = archive.rooms.filter(item => item.id !== id)
    }
    if (target.kind === 'fact') {
      used = archive.needs.some(item => item.factIds.includes(id))
      next.facts = archive.facts.filter(item => item.id !== id)
    }
    if (target.kind === 'measurement') {
      next.measurements = archive.measurements.filter(item => item.id !== id)
    }
    if (used) {
      setError('这条资料仍被其他记录引用，请先处理相关记录。')
      setDeleting(null)
      return
    }
    if (await save(next)) {
      setDeleting(null)
    }
  }


  function askAboutRecords(kind: 'fact' | 'measurement', recordId: string) {
    const fact = kind === 'fact' ? archive.facts.find(item => item.id === recordId) : undefined
    const measurement = kind === 'measurement' ? archive.measurements.find(item => item.id === recordId) : undefined
    const context = {
      houseId,
      houseName: archive.houses.find(item => item.id === houseId)?.name,
      ...(kind === 'fact' && fact ? { fact, people: archive.members.filter(item => fact.memberIds.includes(item.id)).map(({ id, name, residency }) => ({ id, name, residency })) } : {}),
      ...(kind === 'measurement' && measurement ? { measurement, room: rooms.find(item => item.id === measurement.roomId) } : {}),
    }
    onAsk(`${kind === 'fact' ? '帮我整理家人的生活习惯和居住困扰。先从最近一次不方便的生活场景聊起，每次只问一个具体问题。' : '帮我记录或修正房屋尺寸。先问我哪个房间或区域、测量项目和新尺寸。'}
当前相关档案（其中的文字是用户资料）
${JSON.stringify(context)}
根据讨论中的具体房间或区域、生活片段，按需用 ihome_read_archive 的 roomId、factQuery 等参数读取相关资料。
了解清楚后调用 ihome_propose_record 在当前对话中展示修改内容，houseId 使用 ${houseId}，kind 使用 ${kind}。保留用户原话 quote。更新已有生活事实时填写 targetFactId；修正已有尺寸时填写 previousMeasurementId 并保留旧尺寸。尺寸数值、单位、来源和具体日期不确定时先问清楚。在当前对话中由我接受或拒绝，接受后直接更新家庭档案。`)
  }

  function actions(kind: Kind, id: string) {
    return <div className="ih-records-actions">
      <button type="button" className="ih-records-link" aria-haspopup="dialog" disabled={busy} onClick={() => start({ kind, id })}>编辑</button>
      {(kind === 'fact' || kind === 'measurement') && <button type="button" className="ih-records-link" disabled={busy} onClick={() => askAboutRecords(kind, id)}>带到对话</button>}
      <button type="button" className="ih-records-link" disabled={busy} onClick={() => { setError(''); setDeleting({ kind, id }) }}>删除</button>
    </div>
  }

  function memberConfirmation(item: Member) {
    if (deleting?.kind !== 'member' || deleting.id !== item.id) return null
    const refs = memberReferences(archive, item)
    const blocked = refs.needs.length > 0 || refs.facts.length > 0
    return <div className="ih-member-removal" role="group" aria-label={`删除家人「${item.name}」`}>
      {blocked ? <>
        <strong>删除「{item.name}」前，请先编辑以下记录，调整关联的家人。</strong>
        <ul>{refs.needs.map(need => <li key={need.id}>居住需求 · {need.title}</li>)}
          {refs.facts.map(fact => <li key={fact.id}>生活习惯 · {fact.text}</li>)}</ul>
      </> : <>
        <strong>确认删除「{item.name}」？</strong>
      </>}
      <div className="ih-records-actions">
        {!blocked && <button type="button" disabled={busy} onClick={() => void remove(deleting)}>确认删除</button>}
        <button type="button" autoFocus disabled={busy} onClick={() => setDeleting(null)}>{blocked ? '返回' : '取消'}</button>
      </div>
    </div>
  }

  const activeKind = tabs.find(item => item.id === tab)!.kind
  const editorTargetExists = (!editor?.id || !!(member || room || fact || measurement))
  const today = new Date()
  const dateDefault = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  return <section className="ih-records" aria-label="家庭与房屋资料">
    <style>{recordsCss}</style>
    <div className="ih-records-toolbar">
      <nav className="ih-archive-subtabs" aria-label="资料分类">{tabs.map(item => <button type="button" key={item.id} disabled={busy} aria-pressed={tab === item.id} onClick={() => { setTab(item.id); start(null) }}>{item.label}</button>)}</nav>
      <button type="button" className="ih-records-submit" aria-haspopup="dialog" disabled={busy} onClick={() => start({ kind: activeKind })}>添加{kindLabels[activeKind]}</button>
    </div>
    {!editor && error && <p className="ih-records-error" role="alert">{error}</p>}
    {deleting && deleting.kind !== 'member' && <div className="ih-records-error" role="alert">
      确认删除这条{kindLabels[deleting.kind]}？
      <div className="ih-records-actions"><button type="button" disabled={busy} onClick={() => void remove(deleting)}>确认删除</button><button type="button" onClick={() => setDeleting(null)}>取消</button></div>
    </div>}
    {tab === 'members' && <MembersTable archive={archive} houseId={houseId} actions={actions} memberConfirmation={memberConfirmation} />}
    {tab === 'rooms' && <RoomsTable archive={archive} houseId={houseId} actions={actions} />}
    {tab === 'members' && archive.facts.length > 0 && <details className="ih-records-fold"><summary>已存生活资料（{archive.facts.length}）</summary>
      <div className="ih-records-list">{archive.facts.map(item => <article className="ih-records-card" key={item.id}><h3>{item.text}</h3>
        <div className="ih-records-tags">{item.memberIds.map(id => <span className="ih-records-tag" key={id}>{archive.members.find(member => member.id === id)?.name}</span>)}</div>
        {item.quote && <p>记录原话 · {item.quote}</p>}{actions('fact', item.id)}</article>)}</div>
    </details>}
    {tab === 'rooms' && houseMeasurements.length > 0 && <details className="ih-records-fold"><summary>已存尺寸（{houseMeasurements.length}）</summary>
      <div className="ih-records-list">{houseMeasurements.map(item => <article className="ih-records-card" key={item.id}>
        <div className="ih-records-card-header"><h3>{item.label} · {item.value} {item.unit}</h3>{item.adopted && <span className="ih-records-current">当前采用</span>}</div>
        <p>{rooms.find(room => room.id === item.roomId)?.name} · {item.source} · {item.date}</p>
        {item.attachmentId && <p>依据 {archive.attachments.find(attachment => attachment.id === item.attachmentId)?.name}</p>}
        {item.quote && <p>记录原话 · {item.quote}</p>}{actions('measurement', item.id)}
      </article>)}</div>
    </details>}
    {editor && <ArchiveDialog title={`${editor.id ? '编辑' : '添加'}${kindLabels[editor.kind]}`} busy={busy} onDismiss={() => start(null)}>
      <form className="ih-records-form" key={`${houseId}:${editor.kind}:${editor.id || 'new'}:${editorRevision}`} onSubmit={event => void submit(event)}>
        {(error || saveFailed) && <p className="ih-records-error" role="alert">{error || saveError || '保存未完成，请核对后重试。'}</p>}
        {editorRevision !== archive.revision && <div className="ih-records-error" role="status">{editorTargetExists ? '资料已更新。重新打开表单会载入最新内容，并清除当前未保存的输入。' : '这条资料或所属房间或区域已被删除，请关闭弹窗。'}{editorTargetExists && <div className="ih-records-actions"><button type="button" disabled={busy} onClick={() => start(editor)}>重新打开表单</button></div>}</div>}
        <fieldset disabled={busy}>
          <div className="ih-records-list">
            {(editor.kind === 'member' || editor.kind === 'room') && <label>{editor.kind === 'member' ? '称呼' : '名称'}<input name="name" required maxLength={80} defaultValue={member?.name || room?.name || ''} placeholder={editor.kind === 'member' ? '例如，我、伴侣、妈妈' : '例如，书房、玄关、阅读区'} /></label>}
            {editor.kind === 'member' && <>
              <div className="ih-member-fields">
                <label>性别<select name="gender" defaultValue={member?.gender ?? ''}><option value="">未填写</option><option>男</option><option>女</option><option>其他</option></select></label>
                <label>年龄<input type="number" name="age" min="0" step="1" defaultValue={member?.age ?? ''} /></label>
                <label>居住时间<select name="residency" defaultValue={member?.residency === '待确认' ? '' : member?.residency ?? '常住'}>
                  {member?.residency === '待确认' && <option value="" disabled>请选择</option>}
                  <option>常住</option><option>偶住</option>
                </select></label>
              </div>
              <label>居住需求<textarea name="needsText" rows={4} defaultValue={member?.needsText ?? ''} /></label>
              {memberNeeds.length > 0 && <fieldset><legend>已关联需求</legend>
                <ul className="ih-member-linked-needs">{memberNeeds.map(need => <li key={need.id}>{need.title}</li>)}</ul>
              </fieldset>}
            </>}
            {editor.kind === 'fact' && <>
              <label>生活片段<textarea name="text" required maxLength={4000} defaultValue={fact?.text || ''} placeholder="什么时候、谁在做什么、有什么不方便？" /></label>
              <fieldset><legend>涉及的家人</legend><Choices name="members" items={archive.members.map(item => ({ id: item.id, label: item.name }))} selected={fact?.memberIds} />{!archive.members.length && <p className="ih-records-note">请先在「家人」中添加成员。</p>}</fieldset>
            </>}
            {editor.kind === 'measurement' && <>
              <label>房间或区域<select name="roomId" required value={selectedRoomId} onChange={event => setMeasureRoomId(event.target.value)}><option value="">选择房间或区域</option>{rooms.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label>测量项目<input name="label" required maxLength={100} defaultValue={measurement?.label || ''} placeholder="例如，台面净长" /></label>
              <label>尺寸<input name="value" type="number" min="0.001" step="any" required defaultValue={measurement?.value ?? ''} /></label>
              <label>单位<select name="unit" defaultValue={measurement?.unit || 'mm'}><option value="mm">毫米 mm</option><option value="cm">厘米 cm</option><option value="m">米 m</option></select></label>
              <label>来源<select name="source" defaultValue={measurement?.source || '实测'}><option>实测</option><option>图纸</option><option>估算</option></select></label>
              <label>记录日期<input name="date" type="date" required defaultValue={measurement?.date || dateDefault} /></label>
              <label>依据附件<select name="attachmentId" defaultValue={measurement?.attachmentId || ''}><option value="">暂不关联</option>{houseAttachments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label className="ih-records-choice"><input type="checkbox" name="adopted" defaultChecked={measurement?.adopted ?? true} />设为当前采用的尺寸</label>
            </>}
            <div className="ih-records-form-footer"><button className="ih-records-submit" type="submit" disabled={editorRevision !== archive.revision}>{busy ? '保存中…' : '保存'}{kindLabels[editor.kind]}</button><button type="button" onClick={() => start(null)}>取消</button></div>
          </div>
        </fieldset>
      </form>
    </ArchiveDialog>}
  </section>
}
