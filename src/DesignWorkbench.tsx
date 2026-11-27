import { useEffect, useRef, useState, type FormEvent } from 'react'
import { DesignRoomLink } from './DesignRoomLink'
import { DesignVersions } from './DesignVersions'
import { DesignProjectFiles } from './DesignProjectFiles'
import { DesignAssets } from './DesignAssets'
import { loadDesignAssets } from './design-glb'
import { DesignSpace } from './DesignSpace'
import { ReferencedPlan, DesignReferenceEditor } from './DesignReference'
import type { ArchiveService } from './archive-model'
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

export function DesignWorkbench({ onAsk, archive }: { archive: ArchiveService, onAsk: (prompt: string) => void }) {
  const [state, setState] = useState<DesignState>()
  const [versionId, setVersionId] = useState('')
  const [floorId, setFloorId] = useState('')
  const [editor, setEditor] = useState<{ kind: 'add' | 'edit', revision: number } | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [undo, setUndo] = useState<{ designId: string, revision: number, model: DesignModel }>()
  const [view, setView] = useState<'plan' | 'space'>('plan')
  const [allFloors, setAllFloors] = useState(true)
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
  const version = scheme.versions.find(entry => entry.id === versionId)
  const model = version?.model ?? scheme.model
  function viewVersion(id: string) {
    setVersionId(id)
    setEditor(null)
    setSelectedId(null)
  }
  const floor = model.floors.find(level => level.id === floorId) ?? model.floors[0]
  const replace = async (value: DesignModel) => {
    if (version) return false
    const saved = await apply({ action: 'replace', designId: scheme.id, model: value })
    if (saved) setUndo({ designId: scheme.id, revision: state.revision + 1, model })
    return saved
  }
  const room = floor.items.find(item => item.id === selectedId && item.kind === 'room')
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
    <DesignVersions key={'versions:' + scheme.id} state={state} scheme={scheme} version={version} busy={busy} change={apply} onView={viewVersion} />
    <div className="ih-design-bar">
      <label>当前楼层 <select value={floor.id} onChange={e => { setFloorId(e.target.value); setSelectedId(null) }}>
        {model.floors.map(level => <option key={level.id} value={level.id}>{level.name}</option>)}
      </select></label>
      <button disabled={busy || !!version} onClick={() => setEditor({ kind: 'edit', revision: state.revision })}>楼层设置</button>
      <button disabled={busy || !!version} onClick={() => setEditor({ kind: 'add', revision: state.revision })}>添加楼层</button>
    </div>
    {error && <p role="alert">{error}</p>}
    <p className="ih-design-caption">标高 {floor.elevation} m · 层高 {floor.height} m · {floor.walls.length} 面墙 · {floor.openings.length} 个门窗</p>
    <div className="ih-design-bar">
      <button type="button" disabled={busy || !!version || !canUndo} onClick={async () => {
        if (canUndo && await apply({ action: 'replace', designId: scheme.id, model: undo.model })) setUndo(undefined)
      }}>撤销上次编辑</button>
      <button onClick={() => {
        const element = [...floor.walls, ...floor.items, ...floor.openings, ...(floor.assets ?? [])].find(value => value.id === selectedId)
        const context = [`方案「${scheme.name}」(${scheme.id})`, version && `历史版本「${version.name}」(${version.id})`,
          `楼层「${floor.name}」(${floor.id})`, element && `对象「${element.name}」(${element.id})`].filter(Boolean).join('，')
        onAsk('/户型设计师 ' + context + '。' + (version ? '请结合这个版本讨论备选设计。' : '我想调整这里的设计：'))
      }}>与设计师讨论{selectedId ? '所选对象' : '本层'}</button>
      <button onClick={() => onAsk('/户型设计师 请结合家庭档案中的家人、居住需求和实测尺寸，评审方案「' + scheme.name + '」(' + scheme.id + ')' +
        (version ? ' 的当前草稿，和保存版本「' + version.name + '」(' + version.id + ') 比较' : ' 的当前草稿') +
        '。指出使用冲突、可选布局和还需要实测的位置。')}>评审{version ? '并比较版本' : '布局'}</button>
      {document.fullscreenEnabled && <button type="button" onClick={toggleFullscreen}>切换全屏</button>}
    </div>
    <div role="group" aria-label="视图" className="ih-design-bar">
      <button aria-pressed={view === 'plan'} onClick={() => setView('plan')}>平面图</button>
      <button aria-pressed={view === 'space'} onClick={() => setView('space')}>3D 立体图</button>
      {view === 'space' && <label><input type="checkbox" checked={allFloors} onChange={e => setAllFloors(e.target.checked)} /> 显示整栋</label>}
    </div>
    {view === 'space' ? <DesignSpace key={'space:' + scheme.id} model={model} floorId={floor.id}
      loadAssets={loadDesignAssets} allFloors={allFloors} selectedId={selectedId} onSelect={id => {
        setSelectedId(id)
        const level = model.floors.find(value => [...value.walls, ...value.openings, ...value.items, ...(value.assets ?? [])].some(element => element.id === id))
        if (level) setFloorId(level.id)
      }} /> : <ReferencedPlan key={'plan:' + scheme.id + ':' + (version?.id ?? '')} model={model} floorId={floor.id} selectedId={selectedId} onSelect={setSelectedId} onChange={replace} readonly={!!version} />}
    {room && <DesignRoomLink archive={archive} value={room.roomId} disabled={busy || !!version}
      change={roomId => void replace({ ...model, floors: model.floors.map(level => level.id === floor.id ? {
        ...level, items: level.items.map(item => item.id === room.id ? { ...item, roomId } : item),
      } : level) })} />}
    <DesignReferenceEditor key={'reference:' + scheme.id + ':' + floor.id + ':' + (version?.id ?? state.revision)} floor={floor} archive={archive}
      disabled={busy || !!version} save={reference => replace({ ...model, floors: model.floors.map(level => level.id === floor.id ? { ...level, reference } : level) })} />
    <DesignAssets key={'assets:' + scheme.id + ':' + floor.id} model={model} floorId={floor.id} readonly={busy || !!version} onChange={replace} />
    <DesignProjectFiles scheme={scheme} disabled={busy} onImport={async design => {
      const ok = await apply({ action: 'import', design })
      if (ok) { viewVersion(''); setFloorId('') }
      return ok
    }} />
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
