import { useEffect, useRef, useState } from 'react'
import { DesignList } from './DesignList'
import { DesignSpace } from './DesignSpace'
import { changeDesign, loadDesigns } from './design-client'
import { loadDesignAssets } from './design-glb'
import type { DesignCommand, DesignScheme, DesignState } from './design-model'
import css from './design-workbench.css'

type EditCommand = Omit<DesignCommand, 'expectedRevision'>

export function DesignWorkbench({ onAsk }: { onAsk: (prompt: string) => void }) {
  const [state, setState] = useState<DesignState>()
  const [openedId, setOpenedId] = useState<string | null>(null)
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
    if (!state || !mounted.current || writing.current) return false
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
  if (!state) return <section role="status">{error || '正在载入本地户型…'} {error && <button onClick={refresh}>重新载入</button>}</section>
  const scheme = state.designs.find(item => item.id === openedId)
  if (!scheme) return <section className="ih-design" aria-label="户型方案">
    <style>{css}</style>
    <DesignList schemes={state.designs} busy={busy} error={error} change={apply} open={async id => {
      if (writing.current) return
      if (state.activeId === id || await apply({ action: 'activate', designId: id })) {
        setError('')
        setOpenedId(id)
      }
    }} />
  </section>
  return <SchemeViewer key={scheme.id} scheme={scheme} busy={busy} error={error}
    onAsk={onAsk} apply={apply} back={() => { setOpenedId(null); setError('') }} />
}

function SchemeViewer({ scheme, busy, error, onAsk, apply, back }: {
  scheme: DesignScheme, busy: boolean, error: string, onAsk(prompt: string): void,
  apply(command: EditCommand): Promise<boolean>, back(): void,
}) {
  const { model } = scheme
  const hasGeometry = model.floors.some(floor =>
    floor.source || floor.walls.length || floor.items.length || floor.assets?.length)
  const hasContent = hasGeometry || model.floors.some(floor => floor.reference)
  const [view, setView] = useState<'plan' | 'space'>(!hasGeometry && hasContent ? 'plan' : 'space')
  const [floorId, setFloorId] = useState(() => model.floors.find(level => level.reference)?.id ?? model.floors[0].id)
  const [whole, setWhole] = useState(true)
  const floor = model.floors.find(level => level.id === floorId) ?? model.floors[0]
  const allFloors = view === 'space' && whole && model.floors.length > 1
  const ask = () => {
    const context = '方案「' + scheme.name + '」(' + scheme.id + ')'
    const subject = allFloors ? context + '的整栋模型' : context + '的「' + floor.name + '」(' + floor.id + ')'
    onAsk('/户型设计师 ' + (hasContent ? '我想调整' + subject + '：' :
      '请根据我提供的布局描述或户型图，为' + context + '建立 Three.js 模型，先画墙体、门窗和空间轮廓。'))
  }
  return <section className="ih-design ih-scheme-viewer" aria-label="户型方案预览" aria-busy={busy}>
    <style>{css}</style>
    <header className="ih-design-heading ih-viewer-heading">
      <button type="button" className="ih-design-back" disabled={busy} onClick={back}>‹ 返回方案列表</button>
      <h2>{scheme.name}</h2>
    </header>
    {error && <p role="alert">{error}</p>}
    {hasContent ? <>
      <div className="ih-viewer-tools">
        <div className="ih-view-pair" role="group" aria-label="视图">
          <button type="button" aria-pressed={view === 'plan'} onClick={() => setView('plan')}>平面图</button>
          <button type="button" aria-pressed={view === 'space'} onClick={() => setView('space')}>3D 立体图</button>
        </div>
        {model.floors.length > 1 && <select aria-label="楼层" value={allFloors ? '' : floor.id} onChange={event => {
          const id = event.target.value
          if (id) setFloorId(id)
          if (view === 'space') setWhole(!id)
        }}>
          {view === 'space' && <option value="">整栋</option>}
          {model.floors.map(level => <option value={level.id} key={level.id}>{level.name}</option>)}
        </select>}
      </div>
      <DesignSpace model={model} mode={view} allFloors={allFloors} floorId={floor.id} loadAssets={loadDesignAssets} />
      <div className="ih-viewer-actions">
        <button type="button" className="ih-design-chat" onClick={ask}>在会话中修改</button>
        <button type="button" disabled={busy || !scheme.previousModel}
          onClick={() => void apply({ action: 'undo', designId: scheme.id })}>撤销上次修改</button>
      </div>
    </> : <div className="ih-viewer-empty">
      <h3>这个方案还没有模型</h3>
      <p>在会话里描述布局，或发一张户型图。</p>
      <button type="button" className="ih-design-chat" onClick={ask}>在会话中建模</button>
      {scheme.previousModel && <button type="button" disabled={busy}
        onClick={() => void apply({ action: 'undo', designId: scheme.id })}>撤销上次修改</button>}
    </div>}
  </section>
}
