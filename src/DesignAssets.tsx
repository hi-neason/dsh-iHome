import { useEffect, useRef, useState } from 'react'
import { ArchiveDialog } from './ArchiveDialog'
import type { DesignAsset, DesignModel } from './design-model'
import { disposeGLB, exportDesignGLB, loadGLB } from './design-glb'
import { storeDesignAsset } from './design-media-client'

export function DesignAssets({ model, floorId, readonly, onChange }: {
  model: DesignModel, floorId: string, readonly: boolean,
  onChange: (model: DesignModel) => Promise<boolean>,
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [editing, setEditing] = useState<DesignAsset | null>(null)
  const latest = useRef({ model, floorId, readonly }); latest.current = { model, floorId, readonly }
  const editingFloor = useRef(floorId)
  const base = useRef(model), active = useRef(false), mounted = useRef(true)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort() } }, [])
  const floor = model.floors.find(value => value.id === floorId)
  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (active.current) return
    active.current = true; setBusy(true); setError('')
    controller.current = new AbortController()
    try { await action(controller.current.signal) }
    catch (value) { if (mounted.current) setError(value instanceof Error ? value.message : String(value)) }
    finally { active.current = false; if (mounted.current) setBusy(false) }
  }
  async function replace(assets: DesignAsset[], original: DesignModel, originalFloor = floorId) {
    if (!mounted.current || latest.current.readonly || latest.current.model !== original || latest.current.floorId !== originalFloor) throw new Error('方案已发生变化，请重新操作。')
    return onChange({ ...original, floors: original.floors.map(value => value.id === originalFloor ? { ...value, assets } : value) })
  }
  return <section aria-label="三维模型素材">
    <div className="ih-design-bar">
      <label>导入 GLB <input type="file" accept=".glb,model/gltf-binary" disabled={readonly || busy || !floor} onChange={event => {
        const file = event.target.files?.[0]; event.target.value = ''
        if (!file || !floor) return
        const original = model, originalFloor = floorId
        void run(async signal => {
          if (file.size > 64 * 1024 * 1024) throw new Error('GLB 文件不得超过 64 MiB。')
          const scene = await loadGLB(await file.arrayBuffer(), signal)
          disposeGLB(scene)
          signal.throwIfAborted()
          const assetId = await storeDesignAsset(file, file.name)
          signal.throwIfAborted()
          await replace([...(floor.assets ?? []), { id: crypto.randomUUID(), name: file.name.slice(0, 160), assetId,
            x: 0, y: 0, z: 0, scale: 1, rotation: 0 }], original, originalFloor)
        })
      }} /></label>
      <button disabled={busy} onClick={() => void run(async signal => {
        const blob = await exportDesignGLB(model, signal)
        const url = URL.createObjectURL(blob), link = document.createElement('a')
        link.href = url; link.download = 'iHome-整栋模型.glb'; link.click()
        setTimeout(() => URL.revokeObjectURL(url), 10000)
      })}>导出整栋 GLB</button>
    </div>
    <p className="ih-design-caption">GLB 可放在本层任意位置。导入文件须内嵌贴图和几何数据，最大 64 MiB。</p>
    {error && <p role="alert">{error}</p>}
    {!!floor?.assets?.length && <table><thead><tr><th>模型</th><th>缩放</th><th>操作</th></tr></thead><tbody>
      {floor.assets.map(asset => <tr key={asset.id}><td>{asset.name}</td><td>{asset.scale}</td><td>
        <button disabled={readonly || busy} onClick={() => { base.current = model; editingFloor.current = floorId; setEditing({ ...asset }) }}>位置与尺寸</button>
        <button disabled={readonly || busy} onClick={() => void run(async () => { await replace(floor.assets!.filter(value => value.id !== asset.id), model) })}>移除</button>
      </td></tr>)}
    </tbody></table>}
    {editing && <ArchiveDialog title="模型位置与尺寸" busy={busy} onDismiss={() => setEditing(null)}>
      <form className="ih-design-form" onSubmit={event => {
        event.preventDefault()
        void run(async () => {
          const sourceFloor = base.current.floors.find(value => value.id === editingFloor.current)
          if (await replace((sourceFloor?.assets ?? []).map(asset => asset.id === editing.id ? editing : asset), base.current, editingFloor.current)) setEditing(null)
        })
      }}><fieldset disabled={busy || readonly}>
        <label>名称<input required maxLength={160} value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></label>
        {([['x','X 位置（米）'],['z','Z 位置（米）'],['y','离楼层高度（米）'],['scale','等比缩放'],['rotation','旋转（度）']] as const).map(([key,label]) =>
          <label key={key}>{label}<input required type="number" step="any" min={key === 'scale' ? 0.001 : undefined}
            value={editing[key]} onChange={e => setEditing({ ...editing, [key]: e.target.valueAsNumber })} /></label>)}
        <button type="submit">保存</button>
      </fieldset></form>
    </ArchiveDialog>}
  </section>
}
