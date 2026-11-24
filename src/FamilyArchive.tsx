import { useCallback, useEffect, useRef, useState } from 'react'
import { ArchiveFiles } from './ArchiveFiles'
import { ArchiveNeeds } from './ArchiveNeeds'
import { HouseRecords } from './HouseRecords'
import { currentHouse, validateArchive, type Archive, type ArchiveService } from './archive-model'
import css from './family-archive.css'

const tabs = ['居住需求', '家人与房屋', '资料与备份'] as const
type Tab = typeof tabs[number]
// Keep the active view when a DSH conversation temporarily unmounts the panel.
let lastTab: Tab = '居住需求'

export function FamilyArchive({ service, onAsk }: { service: ArchiveService, onAsk: (prompt: string) => void }) {
  const [archive, setArchive] = useState<Archive>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<Tab>(lastTab)
  const [saved, setSaved] = useState(false)
  const generation = useRef(0)
  const saving = useRef(false)
  const loading = useRef(false)
  const refresh = useCallback(async (silent = false) => {
    if (saving.current || (silent && loading.current)) return
    loading.current = true
    const request = ++generation.current
    try {
      const next = await service.load()
      if (request === generation.current) {
        setArchive(current => current?.revision === next.revision ? current : next)
        if (!silent) setError('')
      }
    } catch (cause) {
      if (!silent && request === generation.current) setError(cause instanceof Error ? cause.message : '无法读取本机档案。')
    } finally { if (request === generation.current) loading.current = false }
  }, [service])
  useEffect(() => {
    void refresh()
    const visible = () => { if (!document.hidden) void refresh() }
    const focus = () => void refresh()
    const interval = window.setInterval(() => { if (!document.hidden) void refresh(true) }, 3000)
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', visible)
    return () => {
      ++generation.current
      window.clearInterval(interval)
      window.removeEventListener('focus', focus)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [refresh])
  async function save(next: Archive) {
    if (saving.current) return false
    saving.current = true
    ++generation.current
    setBusy(true); setError(''); setSaved(false)
    try {
      const written = await service.save(validateArchive(next))
      setArchive(written); setSaved(true)
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试。')
      // Reconcile the host snapshot even when transport failed after a durable write.
      try { setArchive(await service.load()) } catch { /* Keep the editor and the original save error. */ }
      return false
    } finally { saving.current = false; loading.current = false; setBusy(false) }
  }
  const house = archive ? currentHouse(archive) : undefined
  useEffect(() => { lastTab = tab }, [tab])
  return <section className="ih-family-archive" aria-label="本地家庭档案"><style>{css}</style>
    {error && <div className="ih-archive-error" role="alert"><span>{error}</span>
      <button type="button" disabled={busy} onClick={() => void refresh()}>重新载入</button></div>}
    {!archive || !house ? <p role="status">{error ? '档案暂时无法打开。' : '正在读取本机档案…'}</p> : <>
      <div className="ih-archive-bar">
        <nav className="ih-archive-tabs" aria-label="家庭档案视图">{tabs.map(item =>
          <button key={item} aria-label={item} aria-current={tab === item ? 'page' : undefined} onClick={() => setTab(item)}>{item}</button>)}</nav>
        <div className="ih-archive-status">{tab !== '居住需求' && <button disabled={busy} onClick={() => void refresh()}>刷新档案</button>}
          <small role="status">{busy ? '正在保存…' : saved ? '已保存到本机' : '本机档案'}</small></div>
      </div>
      <div key={house.id}>
        {tab === '居住需求' && <ArchiveNeeds archive={archive} houseId={house.id} busy={busy} save={save} saveError={error} onAsk={onAsk} />}
        {tab === '家人与房屋' && <HouseRecords archive={archive} houseId={house.id} save={save} busy={busy} saveError={error} onAsk={onAsk} />}
        {tab === '资料与备份' && <ArchiveFiles archive={archive} houseId={house.id} service={service} save={save} busy={busy} />}
      </div>
    </>}
  </section>
}
