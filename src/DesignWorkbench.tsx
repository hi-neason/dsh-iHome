import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArchiveDialog } from './ArchiveDialog'
import { loadDesigns, changeDesign } from './design-client'
import type { DesignCommand, DesignFloor, DesignModel, DesignState } from './design-model'
import css from './design-workbench.css'

type EditCommand = Omit<DesignCommand, 'expectedRevision'>
function FloorEditor({ floor, elevation, busy, save, close }: {
  floor?: DesignFloor, elevation: number, busy: boolean,
  save: (floor: DesignFloor) => Promise<boolean>, close: () => void,
}) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const next: DesignFloor = {
      ...(floor ?? { id: crypto.randomUUID(), walls: [], openings: [], items: [] }),
      name: String(values.get('name')).trim(), elevation: Number(values.get('elevation')),
      height: Number(values.get('height')),
    }
    if (await save(next)) close()
  }
  return <ArchiveDialog title={floor ? '楼层设置' : '添加楼层'} busy={busy} onDismiss={close}>
    <form className="ih-design-form" onSubmit={submit}><fieldset disabled={busy}>
      <label>楼层名称<input name="name" required maxLength={80} defaultValue={floor?.name} placeholder="例如，二层或地下室" /></label>
      <label>标高（米）<input name="elevation" type="number" step="any" required defaultValue={floor?.elevation ?? elevation} /></label>
      <label>层高（米）<input name="height" type="number" min="0.1" step="any" required defaultValue={floor?.height ?? 3} /></label>
      <button type="submit">保存楼层</button>
    </fieldset></form>
  </ArchiveDialog>
}

export function DesignWorkbench() {
  const [state, setState] = useState<DesignState>()
  const [floorId, setFloorId] = useState('')
  const [editor, setEditor] = useState<'add' | 'edit' | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const writing = useRef(false)
  const mounted = useRef(false)

  async function refresh() {
    if (writing.current) return
    try {
      const data = await loadDesigns()
      if (mounted.current) setState(current => !current || current.revision < data.revision ? data : current)
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : '无法读取户型。')
    }
  }
  useEffect(() => {
    mounted.current = true
    void refresh()
    const update = () => { if (!document.hidden) void refresh() }
    const timer = window.setInterval(update, 3000)
    window.addEventListener('focus', update)
    return () => { mounted.current = false; clearInterval(timer); window.removeEventListener('focus', update) }
  }, [])
  async function apply(command: EditCommand) {
    if (!state || writing.current) return false
    writing.current = true
    setBusy(true)
    setError('')
    try {
      const updated = await changeDesign({ ...command, expectedRevision: state.revision })
      if (mounted.current) setState(updated)
      return true
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : '保存失败。')
      return false
    } finally {
      writing.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const scheme = state?.designs.find(item => item.id === state.activeId)
  if (!state || !scheme) return <section role="status">{error || '正在载入本地户型…'} {error && <button onClick={refresh}>重新载入</button>}</section>
  const model = scheme.model
  const floor = model.floors.find(level => level.id === floorId) ?? model.floors[0]
  const replace = (value: DesignModel) => apply({ action: 'replace', designId: scheme.id, model: value })
  return <section className="ih-design" aria-label="户型设计工作台">
    <style>{css}</style>
    <header className="ih-design-heading"><h2>{scheme.name}</h2><span>{model.floors.length} 层</span></header>
    <div className="ih-design-bar">
      <label>当前楼层 <select value={floor.id} onChange={e => setFloorId(e.target.value)}>
        {model.floors.map(level => <option key={level.id} value={level.id}>{level.name}</option>)}
      </select></label>
      <button disabled={busy} onClick={() => setEditor('edit')}>楼层设置</button>
      <button disabled={busy} onClick={() => setEditor('add')}>添加楼层</button>
    </div>
    {error && <p role="alert">{error}</p>}
    <p className="ih-design-caption">标高 {floor.elevation} m · 层高 {floor.height} m · {floor.walls.length} 面墙 · {floor.openings.length} 个门窗</p>
    {editor && <FloorEditor floor={editor === 'edit' ? floor : undefined}
      elevation={Math.max(...model.floors.map(level => level.elevation + level.height))}
      busy={busy} close={() => setEditor(null)} save={async next => {
        const floors = editor === 'add' ? [...model.floors, next] : model.floors.map(level => level.id === next.id ? next : level)
        const saved = await replace({ ...model, floors })
        if (saved) setFloorId(next.id)
        return saved
      }} />}
  </section>
}
