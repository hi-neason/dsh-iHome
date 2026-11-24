import { useState, type ChangeEvent } from 'react'
import { inspectBackup, packArchive, restoreFiles, type BackupPreview } from './archive-backup'
import { newId, type Archive, type ArchiveService, type Attachment } from './archive-model'

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function RoomLinks({ archive, houseId, roomIds, change, disabled }: {
  archive: Archive, houseId: string, roomIds: string[], change: (links: string[]) => void, disabled: boolean
}) {
  const rooms = archive.rooms.filter(r => r.houseId === houseId)
  if (!rooms.length) return null
  return <fieldset className="ih-attachment-rooms" disabled={disabled}><legend>关联房间</legend>{rooms.map(room =>
    <label key={room.id}><input type="checkbox" checked={roomIds.includes(room.id)} onChange={e =>
      change(e.target.checked ? [...roomIds, room.id] : roomIds.filter(id => id !== room.id))} />{room.name}</label>)}</fieldset>
}

export function ArchiveFiles({ archive, houseId, service, busy, save }: {
  archive: Archive, houseId: string, service: ArchiveService, busy: boolean, save: (next: Archive) => Promise<boolean>
}) {
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState<{ backup: BackupPreview, revision: number } | null>(null)
  const [links, setLinks] = useState<string[]>([])
  const [removing, setRemoving] = useState('')
  const disabled = busy || working
  async function run(action: () => Promise<void>) {
    if (disabled) return
    setMessage('')
    setWorking(true)
    try { await action() }
    catch (error) { setMessage(error instanceof Error ? error.message : '操作失败，请重试。') }
    finally { setWorking(false) }
  }
  function pick(event: ChangeEvent<HTMLInputElement>, action: (files: File[]) => Promise<void>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length) void run(() => action(files))
  }
  const attachments = archive.attachments.filter(a => a.houseId === houseId)
  return <div className="ih-archive-files">
    <section><h2>图纸与现场资料</h2>
      <p>原件保存在本机。可将一份图纸关联到多个房间，在量房记录和装修决定中引用。</p>
      <RoomLinks archive={archive} houseId={houseId} roomIds={links} change={setLinks} disabled={disabled} />
      <label className="ih-file-picker">导入原件<input aria-label="导入原件" type="file" multiple disabled={disabled} onChange={event => pick(event, async files => {
        const imported: Attachment[] = []
        for (const source of files) {
          const file = await service.uploadFile(source)
          const date = new Date().toLocaleDateString('sv-SE')
          imported.push({ id: newId(), houseId, file, name: source.name, date, roomIds: links })
        }
        if (await save({ ...archive, attachments: [...archive.attachments, ...imported] })) setMessage('原件已归档。')
      })} /></label>
      {attachments.length > 0 && <ul className="ih-file-list">{attachments.map(a => <li key={a.id}>
        <div><strong>{a.name}</strong><small>{a.date} · {Math.max(1, Math.round(a.file.bytes / 1024))} KB</small>
          <RoomLinks archive={archive} houseId={houseId} roomIds={a.roomIds} disabled={disabled} change={roomIds =>
            void save({ ...archive, attachments: archive.attachments.map(item => item.id === a.id ? { ...item, roomIds } : item) })} /></div>
        <div className="ih-archive-actions"><button disabled={disabled} onClick={() => void run(async () => download(await service.downloadFile(a.id), a.name))}>下载原件</button>
          <button disabled={disabled} onClick={() => {
            if (archive.measurements.some(m => m.attachmentId === a.id) || archive.decisions.some(d => d.attachmentIds.includes(a.id))) {
              setMessage('量房记录或装修决定仍引用此原件，请先解除引用。')
            } else if (removing === a.id) {
              void save({ ...archive, attachments: archive.attachments.filter(item => item.id !== a.id) })
              setRemoving('')
            } else setRemoving(a.id)
          }}>{removing === a.id ? '确认移除' : '移除'}</button>
          {removing === a.id && <button onClick={() => setRemoving('')}>取消</button>}</div>
      </li>)}</ul>}
    </section>
    <section><h2>整份家庭档案备份</h2><p>将房屋资料、居住需求和附件原件保存为一个 .ihome 文件，可在另一台电脑恢复。</p>
      {archive.houses.length > 1 && <p>档案中留存的旧版房屋资料会一并备份。</p>}
      <div className="ih-archive-actions"><button disabled={disabled} onClick={() => void run(async () =>
        download(await packArchive(archive, service), archive.familyName + '.ihome'))}>导出备份</button>
        <label className="ih-file-picker">选择备份恢复<input aria-label="选择备份恢复" type="file" accept=".ihome" disabled={disabled}
          onChange={event => pick(event, async ([source]) => {
            setPending(null)
            setPending({ backup: await inspectBackup(source), revision: archive.revision })
          })} /></label></div>
      {pending && <div className="ih-restore-preview"><strong>恢复「{pending.backup.archive.familyName}」</strong>
        <p>将用「{pending.backup.archive.houses[0].name}」的备份替换当前档案，其中包含 {pending.backup.archive.needs.length} 条需求、{pending.backup.archive.attachments.length} 份资料。</p>
        {pending.backup.archive.houses.length > 1 && <p>此旧版备份还包含历史房屋资料，恢复时会完整保留，工作台显示第一份房屋档案。</p>}
        <div className="ih-archive-actions"><button disabled={disabled} onClick={() => void run(async () => {
          if (archive.revision !== pending.revision) throw new Error('当前档案已变化，请重新选择备份后核对。')
          await restoreFiles(pending.backup, service)
          if (await save({ ...pending.backup.archive, revision: pending.revision })) {
            setPending(null); setMessage('家庭档案和原件已恢复。')
          }
        })}>确认替换并恢复</button><button disabled={disabled} onClick={() => setPending(null)}>取消</button></div></div>}
    </section>
    <div role="status">{working ? '正在处理本地文件…' : message}</div>
  </div>
}
