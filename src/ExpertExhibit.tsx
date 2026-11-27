import { useEffect, useRef, useState } from 'react'
import { modules, type ModuleId } from './modules'
import type { mountExpertScene } from './expert-scene'
import poster from './assets/team/studio.webp'

export function ExpertExhibit({ onOpen }: { onOpen: (id: ModuleId) => Promise<void> }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const pins = useRef<HTMLDivElement>(null)
  const scene = useRef<ReturnType<typeof mountExpertScene>>()
  const opening = useRef(false)
  const [ready, setReady] = useState(false)
  const [paused, setPaused] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void import('./expert-scene').then(({ mountExpertScene }) => {
      if (active && canvas.current && pins.current) scene.current = mountExpertScene(canvas.current, pins.current, setReady)
    }).catch(() => { if (active) setReady(false) })
    return () => { active = false; scene.current?.dispose(); scene.current = undefined }
  }, [])

  async function openExpert(id: ModuleId) {
    if (opening.current) return
    opening.current = true
    setError('')
    try { await onOpen(id) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法打开专家工作台，请重试。') }
    finally { opening.current = false }
  }
  return <section className="ih-hub-hero" aria-label="装修专家工作室">
    <div className="ih-hub-intro">
      <h1>我的装修<wbr /><span>专家团</span></h1>
      <p>从量房到入住，点选专家聊聊。</p>
      {error && <p role="alert">{error}</p>}
    </div>
    <div className="ih-studio" data-ready={ready}>
      {!ready && <img className="ih-studio-poster" src={poster} alt="十位装修专家所在的微缩工作室" />}
      <canvas ref={canvas} className="ih-studio-canvas" role="img" aria-label="三维装修工作室，十位专家正在查看图纸、比选材料、检查现场和安排任务" />
      <div className="ih-expert-pins" ref={pins} hidden={!ready}>
        {modules.filter(role => role.id !== 'budget').map(role =>
          <button type="button" key={role.id} data-expert={role.id} aria-label={'与' + role.title + '对话'}
            onClick={() => void openExpert(role.id)}><span>{role.title} ↗</span></button>)}
      </div>
    </div>
    {ready && <button className="ih-motion-toggle" type="button" aria-label={paused ? '播放首页动效' : '暂停首页动效'}
      onClick={() => { scene.current?.setPaused(!paused); setPaused(!paused) }}>
      <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        {paused ? <path d="M6 3.5 16 10 6 16.5z" /> : <path d="M5 4h3.5v12H5zm6.5 0H15v12h-3.5z" />}
      </svg>
    </button>}
  </section>
}
