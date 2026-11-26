import { useRef, useState, type CSSProperties } from 'react'
import { modules, stages, type ModuleId } from './modules'
import portraits from './assets/team/portraits.webp'
import documentPortrait from './assets/team/documents.webp'
import taskPortrait from './assets/team/tasks.webp'
import directoryCss from './expert-directory.css'

export type OpenModule = (id: ModuleId) => Promise<void>
type AgentId = Exclude<ModuleId, 'budget'>

const portraitOrder = ['archive', 'design', 'quotes', 'materials', 'site', 'handover', 'movein', 'knowledge'] as const
const generalAgents = ['knowledge', 'documents', 'tasks'] as const

export function AgentPortrait({ id }: { id: AgentId }) {
  const standalone = id === 'documents' || id === 'tasks'
  const portrait = id === 'tasks' ? taskPortrait : documentPortrait
  const index = standalone ? 0 : portraitOrder.indexOf(id)
  const style: CSSProperties = {
    backgroundImage: 'url(' + (standalone ? portrait : portraits) + ')',
    backgroundSize: standalone ? 'cover' : '400% 200%',
    backgroundPosition: standalone ? 'center' : `${(index % 4) * 100 / 3}% ${Math.floor(index / 4) * 100}%`,
  }
  return <span className="ih-portrait" style={style} aria-hidden="true" />
}

function Arrow() {
  return <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M4 16 15 5M5 5h10v10" />
  </svg>
}

export function ModuleTiles({ onOpenModule }: { onOpenModule: OpenModule }) {
  const [pending, setPending] = useState<ModuleId | null>(null)
  const opening = useRef(false)
  const [error, setError] = useState('')
  async function open(id: AgentId) {
    if (opening.current) return
    opening.current = true
    setError('')
    setPending(id)
    try {
      await onOpenModule(id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法打开会话，请重试。')
    } finally {
      opening.current = false
      setPending(null)
    }
  }

  function card(id: AgentId) {
    const { title, description } = modules.find(item => item.id === id)!
    return <button key={id} type="button" data-module={id} className="ih-expert-card"
      disabled={pending !== null} aria-busy={pending === id} onClick={() => void open(id)}>
      <span className="ih-expert-photo"><AgentPortrait id={id} /></span>
      <span className="ih-expert-copy">
        <strong>{title}</strong>
        <span className="ih-expert-description">{pending === id ? '正在打开会话…' : description}</span>
      </span>
      <span className="ih-expert-arrow"><Arrow /></span>
    </button>
  }

  return <div className="ih-expert-directory">
    <style>{directoryCss}</style>
    {error && <p className="ih-expert-error" role="alert">{error}</p>}
    <div className="ih-expert-stages" aria-label="装修阶段专家">
      {stages.map(stage => <section key={stage.id} className="ih-expert-stage" data-stage={stage.id} aria-label={stage.title}>
        <h2>{stage.title}</h2>
        <div className="ih-expert-stage-list">{stage.agentIds.map(id => card(id))}</div>
      </section>)}
    </div>
    <section className="ih-expert-general" aria-label="通用助手">
      <h2>通用助手</h2>
      <div className="ih-expert-general-list">{generalAgents.map(id => card(id))}</div>
    </section>
  </div>
}
