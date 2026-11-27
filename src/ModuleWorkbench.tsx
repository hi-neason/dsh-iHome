import { useState } from 'react'
import { FamilyArchive } from './FamilyArchive'
import { DocumentLibrary } from './DocumentLibrary'
import { CompanyAssessmentPanel } from './CompanyAssessment'
import { VendorResearch } from './VendorResearch'
import { QuoteWorkbench } from './QuoteWorkbench'
import { TaskWorkbench } from './TaskWorkbench'
import type { TaskService } from './task-client'
import { DesignWorkbench } from './DesignWorkbench'
import { ModuleDetail } from './ModuleDetail'
import { ModuleTiles, AgentPortrait, type OpenModule } from './ModuleTiles'
import { modules, type ModuleId } from './modules'
import type { ArchiveService } from './archive-model'
import homeCss from './home.css'

interface WorkbenchProps {
  sessionId?: string
  openDocument?: (address: string) => void
  id: ModuleId | null
  sharedTeam?: boolean
  archiveService: ArchiveService
  taskService: TaskService
  onAsk: (prompt: string) => void
  onOpenModule: OpenModule
  historyLinks?: { label: string, open(): void }[]
}

/** The DSH detail pane provides its own tab header and resizing controls. */
export function ModuleWorkbench({ id, archiveService, taskService, onAsk, onOpenModule, historyLinks, sharedTeam, sessionId, openDocument }: WorkbenchProps) {
  const [navigationError, setNavigationError] = useState('')
  const [choosing, setChoosing] = useState(false)
  const module = modules.find(item => item.id === id)
  const showDirectory = !module || choosing
  return <section className="ih-home ih-workbench" aria-label="iHome 工作台" lang="zh-CN">
    <style>{homeCss}</style>
    <div className="ih-workbench-page">
      <header className="ih-workbench-header">
        {!showDirectory && module && module.id !== 'budget' && <AgentPortrait id={module.id} />}
        <h1>{showDirectory ? '我的装修专家团' : module.title}</h1>
        {module && <button type="button" onClick={() => setChoosing(!choosing)}>
          {choosing ? '返回' + module.title : '切换专家'}
        </button>}
      </header>
      {sharedTeam && !showDirectory && <nav className="ih-team-workbench-tabs" aria-label="专家团工作台">
        {(['archive', 'design', 'quotes', 'tasks'] as const).map(next => <button type="button" key={next}
          aria-pressed={id === next} onClick={() => {
            setNavigationError('')
            void Promise.resolve(onOpenModule(next)).catch(error => setNavigationError(String(error.message ?? error)))
          }}>{next === 'archive' ? '居住需求' : next === 'design' ? '户型设计' : next === 'quotes' ? '选商核价' : '任务待办'}</button>)}
      </nav>}
      {navigationError && <p role="alert">{navigationError}</p>}
      {!showDirectory && historyLinks?.map(link => <button key={link.label} className="ih-workbench-history" type="button" onClick={link.open}>{link.label}</button>)}
      {showDirectory ? <nav aria-label="切换装修专家"><ModuleTiles onOpenModule={async next => {
        await onOpenModule(next)
        setChoosing(false)
      }} /></nav> : id === 'archive'
        ? <FamilyArchive service={archiveService} onAsk={onAsk} />
        : id === 'documents' ? <DocumentLibrary service={archiveService} />
        : id === 'design' ? <DesignWorkbench onAsk={onAsk} />
        : id === 'quotes' ? <QuoteWorkbench onAsk={onAsk} sessionId={sessionId} openDocument={openDocument}
          renderCompanyAudit={ctx => <CompanyAssessmentPanel {...ctx}/>}
          renderCompanyReputation={ctx => <VendorResearch {...ctx}/>} />
        : id === 'tasks' ? <TaskWorkbench service={taskService} onAsk={onAsk} />
        : <ModuleDetail key={id} id={id} onAsk={onAsk} />}
    </div>
  </section>
}
