import { useEffect, useRef, useState } from 'react'
import type { DesignModel } from './design-model'
import type { mountDesignScene, DesignAssetLoader } from './design-scene'
import css from './design-space.css'

export interface DesignSpaceProps {
  model: DesignModel
  floorId: string
  mode: 'plan' | 'space'
  allFloors: boolean
  loadAssets?: DesignAssetLoader
}

export function DesignSpace({ model, floorId, mode, allFloors, loadAssets }: DesignSpaceProps) {
  const stage = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const scene = useRef<ReturnType<typeof mountDesignScene>>()
  const latest = useRef({ model, floorId, mode, allFloors, loadAssets })
  latest.current = { model, floorId, mode, allFloors, loadAssets }
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setError('')
    setReady(false)
    void import('./design-scene').then(({ mountDesignScene }) => {
      if (!active || !canvas.current) return
      scene.current = mountDesignScene(canvas.current, message => { if (active) setError(message) })
      const value = latest.current
      scene.current.update(value.model, value, value.loadAssets)
      setReady(true)
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '无法启动 3D 显示。') })
    return () => { active = false; scene.current?.dispose(); scene.current = undefined }
  }, [attempt])
  useEffect(() => { scene.current?.update(model, { floorId, mode, allFloors }, loadAssets) }, [model, floorId, mode, allFloors, loadAssets])
  // Some DSH windows disallow OS fullscreen. Expand the same canvas inside
  // the window in that case, keeping its renderer and camera alive.
  useEffect(() => {
    const element = stage.current
    const restore = () => {
      if (!element?.matches(':popover-open')) element?.removeAttribute('popover')
    }
    element?.addEventListener('toggle', restore)
    return () => element?.removeEventListener('toggle', restore)
  }, [])
  async function toggleFullscreen() {
    const element = stage.current
    if (!element) return
    if (element.hasAttribute('popover')) {
      element.hidePopover()
      return
    }
    if (document.fullscreenElement === element) {
      await document.exitFullscreen()
      return
    }
    if (document.fullscreenEnabled) {
      try { await element.requestFullscreen(); return }
      catch { /* Fall through to an in-window view. */ }
    }
    if (element.isConnected && element.showPopover) {
      element.popover = 'auto'
      element.showPopover()
    }
  }
  return <section className="ih-design-space" aria-label={mode === 'plan' ? '房屋平面模型' : '房屋三维模型'}>
    <style>{css}</style>
    <div ref={stage} className="ih-design-space-stage">
      <canvas ref={canvas} aria-label={mode === 'plan' ? '正交俯视平面图，拖动平移，滚轮缩放' : '房屋立体图，拖动旋转，右键平移，滚轮缩放'} />
      {ready && <div className="ih-design-space-fit">
        <button type="button" aria-label="放大模型" onClick={() => scene.current?.zoom(1.25)}>＋</button>
        <button type="button" aria-label="缩小模型" onClick={() => scene.current?.zoom(.8)}>−</button>
        <button type="button" onClick={() => scene.current?.fit()}>适应画布</button>
        {(document.fullscreenEnabled || typeof HTMLElement.prototype.showPopover === 'function') && <button type="button" onClick={toggleFullscreen}>切换全屏</button>}
      </div>}
      {!ready && !error && <p className="ih-design-space-status" role="status">正在加载模型…</p>}
      {error && <div className="ih-design-space-status" role="alert"><p>{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>重新加载模型</button></div>}
    </div>
    <p className="ih-design-space-hint">{mode === 'plan' ? '正交俯视 · 拖动平移 · 滚轮缩放' : '拖动旋转 · 右键平移 · 滚轮缩放'}</p>
  </section>
}
