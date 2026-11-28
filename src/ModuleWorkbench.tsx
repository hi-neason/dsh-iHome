import { useState } from 'react'
import { FamilyArchive } from './FamilyArchive'
import { DocumentLibrary } from './DocumentLibrary'
import { CompanyComparison } from './CompanyComparison'
import { CompanyAssessmentPanel } from './CompanyAssessment'
import { VendorResearch } from './VendorResearch'
import { QuoteWorkbench } from './QuoteWorkbench'
import { TaskWorkbench } from './TaskWorkbench'
import { ExpenseWorkbench } from './ExpenseWorkbench'
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
  archiveService: ArchiveService
  taskService: TaskService
  onAsk: (prompt: string) => void
  onOpenModule: OpenModule
}

/** The DSH detail pane provides its own tab header and resizing controls. */
export function ModuleWorkbench({ id, archiveService, taskService, onAsk, onOpenModule, sessionId, openDocument }: WorkbenchProps) {
  const [choosing, setChoosing] = useState(false)
  const module = modules.find(item => item.id === id)
  const showDirectory = !module || choosing
  return <section className="ih-home ih-workbench" aria-label="iHome 工作台" lang="zh-CN">
    <style>{homeCss}</style>
    <div className="ih-workbench-page">
      <header className="ih-workbench-header">
        {!showDirectory && module && <AgentPortrait id={module.id} />}
        <h1>{showDirectory ? '我的装修专家团' : module.title}</h1>
        {module && <button type="button" onClick={() => setChoosing(!choosing)}>
          {choosing ? '返回' + module.title : '切换专家'}
        </button>}
      </header>
      {showDirectory ? <nav aria-label="切换装修专家"><ModuleTiles onOpenModule={async next => {
        await onOpenModule(next)
        setChoosing(false)
      }} /></nav> : id === 'archive'
        ? <FamilyArchive service={archiveService} onAsk={onAsk} />
        : id === 'documents' ? <DocumentLibrary service={archiveService} />
        : id === 'design' ? <DesignWorkbench onAsk={onAsk} />
        : id === 'quotes' ? <QuoteWorkbench onAsk={onAsk} sessionId={sessionId} openDocument={openDocument}
          renderCompanyComparison={ctx => <CompanyComparison {...ctx}/>}
          renderCompanyAudit={ctx => <CompanyAssessmentPanel {...ctx}/>}
          renderCompanyReputation={ctx => <VendorResearch {...ctx}/>} />
        : id === 'tasks' ? <TaskWorkbench service={taskService} onAsk={onAsk} />
        : id === 'budget' ? <ExpenseWorkbench onAsk={onAsk} />
        : <ModuleDetail key={id} id={id} onAsk={onAsk} />}
    </div>
  </section>
}
