import { useState } from 'react'
import { FamilyArchive } from './FamilyArchive'
import { ModuleDetail } from './ModuleDetail'
import { ModuleTiles, moduleArtwork, type OpenModule } from './ModuleTiles'
import { modules, type ModuleId } from './modules'
import type { ArchiveService } from './archive-model'
import homeCss from './home.css'

interface WorkbenchProps {
  id: ModuleId | null
  archiveService: ArchiveService
  onAsk: (prompt: string) => void
  onOpenModule: OpenModule
}

/** The DSH detail pane provides its own tab header and resizing controls. */
export function ModuleWorkbench({ id, archiveService, onAsk, onOpenModule }: WorkbenchProps) {
  const [choosing, setChoosing] = useState(false)
  const module = modules.find(item => item.id === id)
  const showDirectory = !module || choosing
  return <section className="ih-home ih-workbench" aria-label="iHome 工作台" lang="zh-CN">
    <style>{homeCss}</style>
    <div className="ih-workbench-page">
      <header className="ih-workbench-header">
        {!showDirectory && module && <img src={moduleArtwork[module.id].src} alt="" width="46" height="46" />}
        <h1>{showDirectory ? '选择装修模块' : module.title}</h1>
        {module && <button type="button" onClick={() => setChoosing(!choosing)}>
          {choosing ? '返回' + module.title : '切换模块'}
        </button>}
      </header>
      {showDirectory ? <nav aria-label="切换装修模块"><ModuleTiles onOpenModule={async next => {
        await onOpenModule(next)
        setChoosing(false)
      }} /></nav> : id === 'archive'
        ? <FamilyArchive service={archiveService} onAsk={onAsk} />
        : <ModuleDetail key={id} id={id} onAsk={onAsk} />}
    </div>
  </section>
}
