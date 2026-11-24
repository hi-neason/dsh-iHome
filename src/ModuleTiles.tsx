import { useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { modules, type ModuleId } from './modules'
import archiveArt from './assets/modules/archive.webp'
import knowledgeArt from './assets/modules/knowledge.webp'
import designArt from './assets/modules/design.webp'
import materialsArt from './assets/modules/materials.webp'
import quotesArt from './assets/modules/quotes.webp'
import budgetArt from './assets/modules/budget.webp'
import siteArt from './assets/modules/site.webp'
import handoverArt from './assets/modules/handover.webp'

export const moduleArtwork: Record<ModuleId, { src: string, tint: string }> = {
  archive: { src: archiveArt, tint: '#58b298' },
  knowledge: { src: knowledgeArt, tint: '#a4aebc' },
  design: { src: designArt, tint: '#b49377' },
  materials: { src: materialsArt, tint: '#b9a06c' },
  quotes: { src: quotesArt, tint: '#a29ab5' },
  budget: { src: budgetArt, tint: '#cd9944' },
  site: { src: siteArt, tint: '#c28b72' },
  handover: { src: handoverArt, tint: '#7aa2ab' },
}

export type OpenModule = (id: ModuleId) => Promise<void>

export function ModuleTiles({ onOpenModule }: { onOpenModule: OpenModule }) {
  const [pending, setPending] = useState<ModuleId | null>(null)
  const opening = useRef(false)
  const [error, setError] = useState('')
  async function open(id: ModuleId) {
    if (opening.current) return
    opening.current = true
    setError('')
    setPending(id)
    try {
      await onOpenModule(id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法打开模块会话，请重试。')
    } finally {
      opening.current = false
      setPending(null)
    }
  }
  return <>
    {error && <p className="ih-open-error" role="alert">{error}</p>}
    <div className="ih-tiles">
      {modules.map(({ id, title, description }, index) => (
        <button type="button" key={id} data-module={id} className="ih-tile" disabled={pending !== null} aria-busy={pending === id} onClick={() => void open(id)}
          style={{ '--ih-tint': moduleArtwork[id].tint, '--ih-order': index } as CSSProperties}>
          <span className="ih-tile-art" aria-hidden="true">
            <img src={moduleArtwork[id].src} alt="" width="350" height="350" draggable={false} />
          </span>
          <span className="ih-tile-arrow" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M4.5 15.5 15 5M5.5 5H15v9.5" />
            </svg>
          </span>
          <span className="ih-tile-copy"><strong>{title}</strong><span>{pending === id ? '正在打开会话…' : description}</span></span>
        </button>
      ))}
    </div>
  </>
}
