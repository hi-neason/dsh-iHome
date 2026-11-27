import { useState } from 'react'
import type { QuoteBoard, QuoteVendor } from './quote-model'
import type { AssessmentSelection, CompanyAssessment } from './quote-assessment'
import { companyDocumentSeries } from './QuoteCompanyDocuments'
import { quoteDocumentKinds } from './quote-documents'
import { quoteVersions } from './quote-analysis'

export function initialSelection(board: QuoteBoard, vendorId: string): AssessmentSelection {
  const documents = companyDocumentSeries(board, vendorId)
  return { vendorId, documentIds: documents.map(group => group[0].id), quoteId: quoteVersions(board, vendorId)[0]?.id ?? null,
    researchId: board.research.filter(r => r.vendorId === vendorId).at(-1)?.id ?? null }
}

export function EvidencePicker({ board, selection, change }: {
  board: QuoteBoard, selection: AssessmentSelection, change: (next: AssessmentSelection) => void
}) {
  const docs = board.documents.filter(d => d.vendorId === selection.vendorId)
  const quotes = quoteVersions(board, selection.vendorId)
  const research = board.research.filter(r => r.vendorId === selection.vendorId).slice().reverse()
  return <div>
    {docs.length ? <fieldset><legend>参与审核的原件</legend>{docs.map(doc => <label key={doc.id} style={{ display: 'flex', alignItems: 'baseline' }}>
      <input type="checkbox" checked={selection.documentIds.includes(doc.id)} onChange={event => change({ ...selection,
        documentIds: event.target.checked ? [...selection.documentIds, doc.id] : selection.documentIds.filter(id => id !== doc.id) })}/>
      <span>{quoteDocumentKinds[doc.kind]} · {doc.title} · {doc.version}<br/><small>{doc.file.name}</small></span></label>)}</fieldset> :
      <p>尚无归档原件，可先审核已有记录并列出需向公司补要的资料。</p>}
    <label>用于复算的报价版本<select value={selection.quoteId ?? ''} onChange={e => change({ ...selection, quoteId: e.target.value || null })}>
      <option value="">不使用结构化报价</option>{quotes.map(q => <option key={q.id} value={q.id}>{q.version} · {q.date}</option>)}</select></label>
    <label>网上评价依据<select value={selection.researchId ?? ''} onChange={e => change({ ...selection, researchId: e.target.value || null })}>
      <option value="">不使用调研记录</option>{research.map((r, i) => <option key={r.id} value={r.id}>{r.city} {r.branch} · {r.date} · 第 {research.length - i} 次</option>)}</select></label>
  </div>
}

export function AssessmentHistory({ records }: { records: CompanyAssessment[] }) {
  return <section><h3>已归档报告（{records.length}）</h3>{records.slice().reverse().map(record => <details key={record.id}>
    <summary>{record.date} · {record.summary}</summary><pre className="ih-quote-report">{record.report}</pre>
  </details>)}</section>
}

export function AssessmentRequest({ selections, onAsk, comparing = false }: {
  selections: AssessmentSelection[], onAsk: (prompt: string) => void, comparing?: boolean
}) {
  const scope = JSON.stringify(selections)
  const task = comparing ? '对选中的装修公司逐维比较。先用 assessmentScope 读取指定范围，核对参与公司和版本；按设计覆盖、承包范围、可比价格、合同条件、口碑及证据缺口逐家并列。' :
    '请审核这家装修公司的材料。先用 assessmentScope 读取指定范围，然后实际阅读所选原件；交叉核对图纸与报价、报价与合同，检查单价依据和网上评价。'
  const prompt = '/选商核价分析师 ' + task + '\nassessmentScope=' + scope +
    '\n列出已读范围、引用、发现与需商家书面回答的问题。返回可用 ihome_propose_quote 归档的 assessments 记录，主会话请展示报告并询问是否保存。'
  const excessive = prompt.length > 12000
  return <><button disabled={excessive || !selections.length || (comparing && selections.length < 2)}
    onClick={() => onAsk(prompt)}>{comparing ? '比较所选公司' : '审核所选材料'} ↗</button>
    {excessive ? <p role="alert">本次选择超出单轮会话容量，请分批选择资料。</p> : <p><small>点击后在专家团对话中发送，分析完成后可确认归档。</small></p>}</>
}

export function CompanyAssessmentPanel({ board, vendor, onAsk }: { board: QuoteBoard, vendor: QuoteVendor, onAsk: (prompt: string) => void }) {
  const [chosen, setChosen] = useState<AssessmentSelection>()
  const selection = chosen?.vendorId === vendor.id ? chosen : initialSelection(board, vendor.id)
  return <section><h3>{vendor.name} · 材料审核</h3>
    <EvidencePicker board={board} selection={selection} change={setChosen}/>
    <AssessmentRequest selections={[selection]} onAsk={onAsk}/>
    <AssessmentHistory records={board.assessments.filter(a => a.selections.length === 1 && a.selections[0].vendorId === vendor.id)}/>
  </section>
}
