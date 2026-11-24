import { useState } from 'react'
import type { PointerEvent } from 'react'
import { GitHubIcon, XiaohongshuIcon } from './AuthorIcons'
import { HouseExhibit } from './HouseExhibit'
import { ModuleTiles, type OpenModule } from './ModuleTiles'
import homeCss from './home.css'

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

export function Home({ onOpenModule }: { onOpenModule: OpenModule }) {
  const [paused, setPaused] = useState(false)
  return <section className="ih-home" lang="zh-CN" aria-label="iHome 首页">
    <style>{homeCss}</style>
    <div className="ih-page ih-page-hub">
      <header className="ih-masthead">
        <div className="ih-brand"><StudioMark /><span>iHome</span></div>
      </header>
      <HubHero paused={paused} onToggle={() => setPaused(value => !value)} />
      <nav className="ih-library" aria-label="装修功能模块">
        <h2>全部模块</h2>
        <ModuleTiles onOpenModule={onOpenModule} />
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
    </div>
  </section>
}
