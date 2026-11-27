import { useState, type ReactNode } from 'react'
import { useQuoteBoard } from './useQuoteBoard'
import type { QuoteBoard, QuoteCollection, QuoteVendor } from './quote-model'
import { CompanyDirectory, CompanyProfile } from './QuoteCompanyProfile'
import { CompanyDocuments } from './QuoteCompanyDocuments'
import { QuoteScope } from './QuoteScope'
import { QuoteDecisionPanel } from './QuoteDecision'
import { QuoteReviewPanel } from './QuoteReview'
import { QuoteAudit } from './QuoteAudit'
import { QuoteAnalysis } from './QuoteAnalysis'
import { QuoteIntake } from './QuoteIntake'
import css from './quote-workbench.css'

export interface QuoteWorkbenchContext {
  board: QuoteBoard
  onAsk: (prompt: string) => void
  save: (collection: QuoteCollection, record: unknown) => Promise<void>
}
export interface QuoteCompanyContext extends QuoteWorkbenchContext { vendor: QuoteVendor }
interface Props {
  onAsk: (prompt: string) => void
  sessionId?: string
  openDocument?: (address: string) => void
  renderCompanyAudit?: (ctx: QuoteCompanyContext) => ReactNode
  renderCompanyReputation?: (ctx: QuoteCompanyContext) => ReactNode
  renderCompanyComparison?: (ctx: QuoteWorkbenchContext) => ReactNode
}

const tools = { scope: '询价底稿', quotes: '报价版本', compare: '同口径比价', audit: '核价', reviews: '合同与澄清', decisions: '选商决定' }
function QuoteTools({ board, save, onAsk }: QuoteWorkbenchContext) {
  const [active, setActive] = useState<keyof typeof tools>('scope')
  return <section aria-label="报价工具"><header className="ih-company-heading"><h2>报价工具</h2></header>
    <div className="ih-quote-actions"><button type="button" onClick={() => onAsk('/选商核价分析师 请帮我比较装修团队和报价，先核对已有依据。')}>咨询分析师 ↗</button>
      <button type="button" onClick={() => onAsk('/选商核价分析师 请审阅随这条消息附上的报价或合同，按文件、页码或工作表引用，先列出已读范围、报价分项和待确认项。')}>审阅对话附件 ↗</button></div>
    <nav aria-label="选商核价功能">{(Object.keys(tools) as (keyof typeof tools)[]).map(key =>
      <button type="button" key={key} aria-pressed={active === key} onClick={() => setActive(key)}>{tools[key]}</button>)}</nav>
    {active === 'scope' && <QuoteScope board={board} onSave={row => save('scopeItems', row)} />}
    {active === 'decisions' && <QuoteDecisionPanel board={board} onSave={row => save('decisions', row)} />}
    {active === 'reviews' && <QuoteReviewPanel board={board} onSave={row => save('reviews', row)} />}
    {active === 'audit' && <QuoteAudit board={board} onSaveReference={row => save('references', row)} />}
    {active === 'compare' && <QuoteAnalysis board={board} />}
    {active === 'quotes' && <QuoteIntake board={board} onSave={row => save('quotes', row)} />}
  </section>
}

function CompanyDetail({ context, back, acceptBoard, sessionId, openDocument, renderCompanyAudit, renderCompanyReputation }: {
  context: QuoteCompanyContext
  back: () => void
  acceptBoard: (board: QuoteBoard) => void
} & Pick<Props, 'openDocument' | 'sessionId' | 'renderCompanyAudit' | 'renderCompanyReputation'>) {
  const [active, setActive] = useState<'documents' | 'audit' | 'reputation' | 'quotes'>('documents')
  const { board, vendor, save } = context
  return <section aria-label="公司档案详情">
    <button className="ih-company-back" type="button" onClick={back}>‹ 返回公司清单</button>
    <CompanyProfile company={vendor} save={row => save('vendors', row)}/>
    <nav aria-label="公司档案栏目">
      <button type="button" aria-pressed={active === 'documents'} onClick={() => setActive('documents')}>公司资料</button>
      {renderCompanyAudit && <button type="button" aria-pressed={active === 'audit'} onClick={() => setActive('audit')}>公司审核</button>}
      {renderCompanyReputation && <button type="button" aria-pressed={active === 'reputation'} onClick={() => setActive('reputation')}>网上评价</button>}
      <button type="button" aria-pressed={active === 'quotes'} onClick={() => setActive('quotes')}>报价明细</button>
    </nav>
    {active === 'documents' && <CompanyDocuments board={board} company={vendor} acceptBoard={acceptBoard} sessionId={sessionId} openDocument={openDocument}/>}
    {active === 'audit' && renderCompanyAudit?.(context)}
    {active === 'reputation' && renderCompanyReputation?.(context)}
    {active === 'quotes' && <QuoteIntake board={{ ...board, vendors: [vendor], quotes: board.quotes.filter(row => row.vendorId === vendor.id) }} onSave={row => save('quotes', row)}/>}
  </section>
}

export function QuoteWorkbench({ onAsk, sessionId, openDocument, renderCompanyAudit, renderCompanyReputation, renderCompanyComparison }: Props) {
  const { board, error, notice, setNotice, save, reload, containerRef, acceptBoard } = useQuoteBoard()
  const [page, setPage] = useState<'companies' | 'compare' | 'tools'>('companies')
  const [companyId, setCompanyId] = useState('')
  const selected = board?.vendors.find(company => company.id === companyId)
  const context = board && { board, onAsk, save }
  function navigate(next: typeof page) {
    setPage(next)
    setNotice('')
    if (next === 'companies') setCompanyId('')
  }
  return <div ref={containerRef} className="ih-quotes"><style>{css}</style>
    <nav className="ih-company-navigation" aria-label="选商工作台">
      <button type="button" aria-pressed={page === 'companies'} onClick={() => navigate('companies')}>公司档案</button>
      <button type="button" aria-pressed={page === 'compare'} onClick={() => navigate('compare')}>公司对比</button>
      <button type="button" aria-pressed={page === 'tools'} onClick={() => navigate('tools')}>报价工具</button>
      <button type="button" className="ih-company-reload" onClick={() => void reload()}>重新载入档案</button>
    </nav>
    {error && <p role="alert">{error}</p>}{notice && <small role="status">{notice}</small>}
    {!board || !context ? <p>{error ? '暂时无法打开档案。' : '正在读取选商档案…'}</p> :
      page === 'tools' ? <QuoteTools {...context}/> :
      page === 'compare' ? (renderCompanyComparison ? renderCompanyComparison(context) : <QuoteAnalysis board={board}/>) :
      selected ? <CompanyDetail key={selected.id} context={{ ...context, vendor: selected }} back={() => setCompanyId('')}
        acceptBoard={acceptBoard} sessionId={sessionId} openDocument={openDocument}
        renderCompanyAudit={renderCompanyAudit} renderCompanyReputation={renderCompanyReputation}/> :
      <CompanyDirectory board={board} open={setCompanyId} save={row => save('vendors', row)}/>}
  </div>
}
