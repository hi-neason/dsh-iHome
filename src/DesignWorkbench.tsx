import { useEffect, useRef, useState, type FormEvent } from 'react'
import { DesignPlan } from './DesignPlan'
import { ArchiveDialog } from './ArchiveDialog'
import { loadDesigns, changeDesign } from './design-client'
import type { DesignCommand, DesignFloor, DesignModel, DesignState } from './design-model'
import css from './design-workbench.css'

type EditCommand = Omit<DesignCommand, 'expectedRevision'>
function FloorEditor({ floor, elevation, busy, error, save, close }: {
  floor?: DesignFloor, elevation: number, busy: boolean, error: string,
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
      {error && <p role="alert">{error}</p>}
      <button type="submit">保存楼层</button>
    </fieldset></form>
  </ArchiveDialog>
}

export function DesignWorkbench() {
  const [state, setState] = useState<DesignState>()
  const [floorId, setFloorId] = useState('')
  const [editor, setEditor] = useState<{ kind: 'add' | 'edit', revision: number } | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [undo, setUndo] = useState<{ designId: string, revision: number, model: DesignModel }>()
  const panel = useRef<HTMLElement>(null)
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
  const replace = async (value: DesignModel) => {
    const saved = await apply({ action: 'replace', designId: scheme.id, model: value })
    if (saved) setUndo({ designId: scheme.id, revision: state.revision + 1, model })
    return saved
  }
  const canUndo = undo && undo.designId === scheme.id && undo.revision === state.revision
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === panel.current) await document.exitFullscreen()
      else await panel.current?.requestFullscreen()
    } catch { setError('当前窗口无法进入全屏。') }
  }
  return <section ref={panel} aria-busy={busy} className="ih-design" aria-label="户型设计工作台">
    <style>{css}</style>
    <header className="ih-design-heading"><h2>{scheme.name}</h2><span>{model.floors.length} 层</span></header>
    <div className="ih-design-bar">
      <label>当前楼层 <select value={floor.id} onChange={e => { setFloorId(e.target.value); setSelectedId(null) }}>
        {model.floors.map(level => <option key={level.id} value={level.id}>{level.name}</option>)}
      </select></label>
      <button disabled={busy} onClick={() => setEditor({ kind: 'edit', revision: state.revision })}>楼层设置</button>
      <button disabled={busy} onClick={() => setEditor({ kind: 'add', revision: state.revision })}>添加楼层</button>
    </div>
    {error && <p role="alert">{error}</p>}
    <p className="ih-design-caption">标高 {floor.elevation} m · 层高 {floor.height} m · {floor.walls.length} 面墙 · {floor.openings.length} 个门窗</p>
    <div className="ih-design-bar">
      <button type="button" disabled={busy || !canUndo} onClick={async () => {
        if (canUndo && await apply({ action: 'replace', designId: scheme.id, model: undo.model })) setUndo(undefined)
      }}>撤销上次编辑</button>
      {document.fullscreenEnabled && <button type="button" onClick={toggleFullscreen}>切换全屏</button>}
    </div>
    <DesignPlan key={scheme.id} model={model} floorId={floor.id} selectedId={selectedId} onSelect={setSelectedId} onChange={replace} />
    {editor?.revision === state.revision && <FloorEditor error={error} floor={editor.kind === 'edit' ? floor : undefined}
      elevation={Math.max(...model.floors.map(level => level.elevation + level.height))}
      busy={busy} close={() => setEditor(null)} save={async next => {
        const floors = editor.kind === 'add' ? [...model.floors, next] : model.floors.map(level => level.id === next.id ? next : level)
        const saved = await replace({ ...model, floors })
        if (saved) setFloorId(next.id)
        return saved
      }} />}
  </section>
}
