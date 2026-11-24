import { useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent } from 'react'
import { GitHubIcon, XiaohongshuIcon } from './AuthorIcons'
import { HouseExhibit } from './HouseExhibit'
import { ModuleDetail } from './ModuleDetail'
import { modules, type ModuleId } from './modules'
import archiveArt from './assets/modules/archive.webp'
import knowledgeArt from './assets/modules/knowledge.webp'
import designArt from './assets/modules/design.webp'
import materialsArt from './assets/modules/materials.webp'
import quotesArt from './assets/modules/quotes.webp'
import budgetArt from './assets/modules/budget.webp'
import siteArt from './assets/modules/site.webp'
import handoverArt from './assets/modules/handover.webp'
import homeCss from './home.css'

const artwork: Record<ModuleId, { src: string, tint: string }> = {
  archive: { src: archiveArt, tint: '#58b298' },
  knowledge: { src: knowledgeArt, tint: '#a4aebc' },
  design: { src: designArt, tint: '#b49377' },
  materials: { src: materialsArt, tint: '#b9a06c' },
  quotes: { src: quotesArt, tint: '#a29ab5' },
  budget: { src: budgetArt, tint: '#cd9944' },
  site: { src: siteArt, tint: '#c28b72' },
  handover: { src: handoverArt, tint: '#7aa2ab' },
}

function StudioMark() {
  return (
    <svg width="30" height="30" viewBox="0 0 36 36" fill="currentColor" aria-hidden="true">
      <path d="M2 18 18 4l4.8 4.2L7.3 22v10H2zM11 22.3l15-13.2 4.4 3.9-14.1 12.1V32H11zM20 25.5l12-10.2 2 1.7v15h-5.3v-8.8L25.3 26v6H20z" />
    </svg>
  )
}

function HubHero({ paused, onToggle }: { paused: boolean, onToggle: () => void }) {
  const control = paused ? '播放首页动效' : '暂停首页动效'
  function followPointer(event: PointerEvent<HTMLDivElement>) {
    if (paused || event.pointerType !== 'mouse' || !window.matchMedia('(prefers-reduced-motion: no-preference)').matches) return
    const hero = event.currentTarget
    const bounds = hero.getBoundingClientRect()
    const across = (event.clientX - bounds.left) / bounds.width - 0.5
    const down = (event.clientY - bounds.top) / bounds.height - 0.5
    hero.style.setProperty('--ih-pan-x', `${across * 16}px`)
    hero.style.setProperty('--ih-pan-y', `${down * 9}px`)
  }

  return (
    <div className="ih-hub-hero" data-paused={paused} onPointerMove={followPointer}
      onPointerLeave={event => {
        event.currentTarget.style.removeProperty('--ih-pan-x')
        event.currentTarget.style.removeProperty('--ih-pan-y')
      }}>
      <div className="ih-hub-light" aria-hidden="true" />
      <div className="ih-hub-intro">
        <h1>我的装修工作台</h1>
        <p>从第一次量房，到入住后的保修。<br />选择你眼下要做的事。</p>
      </div>
      <div className="ih-hub-exhibit"><HouseExhibit /></div>
      <button className="ih-motion-toggle" type="button" aria-label={control} title={control} onClick={onToggle}>
        <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          {paused ? <path d="M6 3.5 16 10 6 16.5z" /> : <path d="M5 4h3.5v12H5zm6.5 0H15v12h-3.5z" />}
        </svg>
      </button>
    </div>
  )
}

export function Home({ onAsk }: { onAsk: (prompt: string) => void }) {
  const [active, setActive] = useState<ModuleId | null>(null)
  const [paused, setPaused] = useState(false)
  const panel = useRef<HTMLElement>(null)
  const detailHeading = useRef<HTMLHeadingElement>(null)
  const rememberedTile = useRef<{ id: ModuleId, scroll: number } | null>(null)
  const selected = modules.find(module => module.id === active)

  function openModule(id: ModuleId) {
    rememberedTile.current = { id, scroll: panel.current?.scrollTop ?? 0 }
    setActive(id)
  }

  useLayoutEffect(() => {
    const root = panel.current
    if (!root) return
    if (active) {
      root.scrollTop = 0
      detailHeading.current?.focus({ preventScroll: true })
    } else if (rememberedTile.current) {
      const { id, scroll } = rememberedTile.current
      root.scrollTop = scroll
      root.querySelector<HTMLButtonElement>(`[data-module="${id}"]`)?.focus({ preventScroll: true })
    }
  }, [active])

  return (
    <section className="ih-home" lang="zh-CN" aria-label="iHome 装修工作台" ref={panel}
      onKeyDown={event => {
        if (active && event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing) {
          event.stopPropagation()
          setActive(null)
        }
      }}>
      <style>{homeCss}</style>
      <div className={selected ? 'ih-page' : 'ih-page ih-page-hub'}>
        <header className="ih-masthead">
          <div className="ih-brand"><StudioMark /><span>iHome</span></div>
        </header>
        {selected ? (
          <div className="ih-detail-header">
            <button className="ih-back" type="button" onClick={() => setActive(null)}>
              <span aria-hidden="true">←</span> 返回工作台
            </button>
            <div className="ih-detail-title">
              <h1 tabIndex={-1} ref={detailHeading}>{selected.title}</h1>
              <img src={artwork[selected.id].src} width="66" height="66" alt="" />
            </div>
          </div>
        ) : (
          <>
            <HubHero paused={paused} onToggle={() => setPaused(value => !value)} />
            <nav className="ih-library" aria-label="装修功能模块">
              <h2>全部模块</h2>
              <div className="ih-tiles">
                {modules.map(({ id, title, description }, index) => (
                  <button type="button" key={id} data-module={id} className="ih-tile" onClick={() => openModule(id)}
                    style={{ '--ih-tint': artwork[id].tint, '--ih-order': index } as CSSProperties}>
                    <span className="ih-tile-art" aria-hidden="true">
                      <img src={artwork[id].src} alt="" width="350" height="350" draggable={false} />
                    </span>
                    <span className="ih-tile-arrow" aria-hidden="true">
                      <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4">
                        <path d="M4.5 15.5 15 5M5.5 5H15v9.5" />
                      </svg>
                    </span>
                    <span className="ih-tile-copy"><strong>{title}</strong><span>{description}</span></span>
                  </button>
                ))}
              </div>
            </nav>
            <footer className="ih-author" aria-label="作者信息">
              <span>作者</span>
              <a href="https://github.com/hi-neason/dsh-iHome" target="_blank" rel="noopener noreferrer" aria-label="dsh-iHome（GitHub 开源项目）">
                <GitHubIcon /><span>dsh-iHome</span>
              </a>
              <a href="https://www.xiaohongshu.com/user/profile/61a270ff0000000021025a3f" target="_blank" rel="noopener noreferrer" aria-label="爱屋日记（小红书）">
                <XiaohongshuIcon /><span>爱屋日记</span>
              </a>
            </footer>
          </>
        )}
        <ModuleDetail id={active} onAsk={onAsk} />
      </div>
    </section>
  )
}
