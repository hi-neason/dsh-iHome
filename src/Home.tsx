import { GitHubIcon, XiaohongshuIcon } from './AuthorIcons'
import { ExpertExhibit } from './ExpertExhibit'
import { ModuleTiles, type OpenModule } from './ModuleTiles'
import homeCss from './home.css'

function StudioMark() {
  return (
    <svg width="30" height="30" viewBox="0 0 36 36" fill="currentColor" aria-hidden="true">
      <path d="M2 18 18 4l4.8 4.2L7.3 22v10H2zM11 22.3l15-13.2 4.4 3.9-14.1 12.1V32H11zM20 25.5l12-10.2 2 1.7v15h-5.3v-8.8L25.3 26v6H20z" />
    </svg>
  )
}

export function Home({ onOpenModule }: { onOpenModule: OpenModule }) {
  return <section className="ih-home" lang="zh-CN" aria-label="iHome 首页">
    <style>{homeCss}</style>
    <div className="ih-page ih-page-hub">
      <header className="ih-masthead">
        <div className="ih-brand"><StudioMark /><span>iHome</span></div>
      </header>
      <ExpertExhibit onOpen={onOpenModule} />
      <nav className="ih-library" aria-label="装修专家团">
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
