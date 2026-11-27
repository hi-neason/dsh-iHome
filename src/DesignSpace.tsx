import { useEffect, useRef, useState } from 'react'
import type { DesignModel } from './design-model'
import type { mountDesignScene, DesignAssetLoader } from './design-scene'
import css from './design-space.css'

export interface DesignSpaceProps {
  model: DesignModel
  floorId: string
  selectedId: string | null
  onSelect(id: string | null): void
  allFloors: boolean
  loadAssets?: DesignAssetLoader
}

export function DesignSpace({ model, floorId, selectedId, onSelect, allFloors, loadAssets }: DesignSpaceProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const scene = useRef<ReturnType<typeof mountDesignScene>>()
  const latest = useRef({ model, floorId, selectedId, onSelect, allFloors, loadAssets })
  latest.current = { model, floorId, selectedId, onSelect, allFloors, loadAssets }
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setError('')
    setReady(false)
    void import('./design-scene').then(({ mountDesignScene }) => {
      if (!active || !canvas.current) return
      scene.current = mountDesignScene(canvas.current, id => latest.current.onSelect(id), message => { if (active) setError(message) })
      const value = latest.current
      scene.current.update(value.model, value, value.loadAssets)
      setReady(true)
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '无法启动 3D 显示。') })
    return () => { active = false; scene.current?.dispose(); scene.current = undefined }
  }, [attempt])
  useEffect(() => { scene.current?.update(model, { floorId, selectedId, allFloors }, loadAssets) }, [model, floorId, selectedId, allFloors, loadAssets])
  return <section className="ih-design-space" aria-label="房屋三维模型">
    <style>{css}</style>
    <div className="ih-design-space-stage">
      <canvas ref={canvas} aria-label="可旋转缩放的房屋立体图，拖动旋转，右键拖动平移，滚轮缩放" />
      {ready && <button className="ih-design-space-fit" type="button" onClick={() => scene.current?.fit()}>适应画布</button>}
      {!ready && !error && <p className="ih-design-space-status" role="status">正在加载立体模型…</p>}
      {error && <div className="ih-design-space-status" role="alert"><p>{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>重新加载 3D</button></div>}
    </div>
    <p className="ih-design-space-hint">拖动旋转 · 右键拖动平移 · 滚轮缩放 · 点击选择对象</p>
  </section>
}
