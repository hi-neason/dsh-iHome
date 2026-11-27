import { compareQuotes } from './quote-analysis.ts'
import type { QuoteBoard } from './quote-model.ts'
import { quoteObject, quoteText, QuoteConflict } from './quote-model.ts'
import { auditDateToday, auditQuote } from './quote-audit.ts'

export interface AssessmentSelection {
  vendorId: string
  documentIds: string[]
  quoteId: string | null
  researchId: string | null
}
const dimensions = ['设计', '报价', '合同', '口碑', '综合'] as const
const sourceTypes = ['document', 'quote', 'research', 'vendor', 'scope', 'reference', 'clarification'] as const
type SourceType = typeof sourceTypes[number]
interface Citation { type: SourceType, id: string, at: string, excerpt: string }
interface Finding { dimension: typeof dimensions[number], status: 'finding' | 'gap', detail: string, citations: Citation[], question: string }
export interface CompanyAssessment {
  id: string
  basisRevision: number
  selections: AssessmentSelection[]
  summary: string
  findings: Finding[]
  date: string
  report: string
}

function list<T>(value: unknown, label: string, parse: (item: unknown) => T, min: number): T[] {
  if (!Array.isArray(value) || value.length < min) throw new Error('请核对' + label + '列表。')
  return value.map(parse)
}
function enumValue<T extends string>(value: unknown, choices: readonly T[]): T {
  const found = choices.find(choice => choice === value)
  if (!found) throw new Error('审核记录类别无效，支持 ' + choices.join('、') + '。')
  return found
}
const recordId = (v: unknown) => quoteText(v, '依据编号', true, 200)
const optionalId = (v: unknown) => v == null ? null : recordId(v)

export function parseSelections(raw: unknown): AssessmentSelection[] {
  const selections = list(raw, '审核范围', value => {
    const row = quoteObject(value)
    const documentIds = list(row.documentIds, '所选原件', recordId, 0)
    if (new Set(documentIds).size !== documentIds.length) throw new Error('同一份原件版本只能选一次。')
    return { vendorId: recordId(row.vendorId), documentIds, quoteId: optionalId(row.quoteId), researchId: optionalId(row.researchId) }
  }, 1)
  if (new Set(selections.map(s => s.vendorId)).size !== selections.length) throw new Error('每家公司只能选择一次。')
  return selections
}

function resolveSelection(board: QuoteBoard, selection: AssessmentSelection) {
  const { vendorId, documentIds, quoteId, researchId } = selection
  const vendor = board.vendors.find(item => item.id === vendorId)
  if (!vendor) throw new Error('找不到所选装修公司。')
  const documents = documentIds.map(id => {
    const doc = board.documents.find(item => item.id === id && item.vendorId === vendorId)
    if (!doc) throw new Error('所选原件版本不属于这家公司。')
    return { id: doc.id, title: doc.title, version: doc.version, kind: doc.kind, name: doc.file.name }
  })
  const quote = board.quotes.find(item => item.id === quoteId && item.vendorId === vendorId)
  const research = board.research.find(item => item.id === researchId && item.vendorId === vendorId)
  if (quoteId && !quote) throw new Error('所选报价版本不属于这家公司。')
  if (researchId && !research) throw new Error('所选网上评价记录不属于这家公司。')
  return { vendor, documents, quote, research }
}

export function assessmentBasis(board: QuoteBoard, raw: unknown) {
  const selections = parseSelections(raw)
  const companies = selections.map(selection => {
    const { vendor, documents, quote, research } = resolveSelection(board, selection)
    const audit = quote ? auditQuote(board, quote.id) : undefined
    return { vendor, documents, research: research ?? null, quote: quote && audit ? {
      id: quote.id, version: quote.version, scope: quote.scope, source: quote.source, statedTotal: quote.statedTotal,
      lineCount: quote.lines.length, knownIncluded: audit.knownIncluded, totalDifference: audit.totalDifference,
      issues: audit.questions.slice(0, 30), issueCount: audit.questions.length,
      matchedReferenceCount: audit.checkedLines.reduce((n, line) => n + line.checks.filter(c => c.difference !== null).length, 0),
      hint: '用 ihome_read_quotes 的 quoteId 读取原始分项、每条带出处的参照单价和澄清答复。',
    } : null }
  })
  const withoutQuote = selections.filter(s => !s.quoteId).map(s => s.vendorId)
  let comparison
  if (selections.length > 1 && !withoutQuote.length) {
    const versions = new Map(selections.map(s => [s.vendorId, s.quoteId!]))
    const selectedIds = Object.fromEntries(board.vendors.map(v => [v.id, versions.get(v.id) ?? '']))
    const result = compareQuotes(board, selectedIds)
    comparison = { comparableCount: result.comparableCount, itemCount: result.rows.length,
      quotes: result.quotes.map((q, index) => ({ vendorId: q.vendorId, quoteId: q.id, statedTotal: q.statedTotal, comparableSubtotal: result.subtotals[index] })),
      rows: result.rows.slice(0, 40).map(row => ({ key: row.key, label: row.label, issues: row.issues, spread: row.spread })),
      hint: '用 ihome_read_quotes 的 quoteIds 读取全部对齐行及各公司书面原值。' }
  }
  return { basisRevision: board.revision, selections, companies, scopeItems: board.scopeItems,
    ...(selections.length > 1 ? { comparison: comparison ?? null, companiesWithoutStructuredQuote: withoutQuote } : {}),
    readOriginals: '按所选 vendorId 和 documentId 调用 ihome_read_quote_source 阅读原件，区分已读和未读范围。' }
}

function parseDraft(value: unknown) {
  const row = quoteObject(value)
  if (typeof row.basisRevision !== 'number' || !Number.isSafeInteger(row.basisRevision) || row.basisRevision < 0)
    throw new Error('需要审核所用的档案版本 basisRevision。')
  const findings = list(row.findings, '审核发现', value => {
    const f = quoteObject(value)
    const status = enumValue(f.status, ['finding', 'gap'] as const)
    const citations = list(f.citations, '引用', value => {
      const c = quoteObject(value)
      return { type: enumValue(c.type, sourceTypes), id: recordId(c.id),
        at: quoteText(c.at, '原文位置', true, 500), excerpt: quoteText(c.excerpt, '证据摘录', true, 2000) }
    }, status === 'gap' ? 0 : 1)
    return { dimension: enumValue(f.dimension, dimensions), status, detail: quoteText(f.detail, '审核意见', true),
      citations, question: quoteText(f.question ?? '', '需书面澄清的问题', status === 'gap') }
  }, 1)
  return { id: recordId(row.id), basisRevision: row.basisRevision, selections: parseSelections(row.selections),
    summary: quoteText(row.summary, '审核结论', true), findings }
}

export function parseAssessment(value: unknown): CompanyAssessment {
  const row = quoteObject(value)
  return { ...parseDraft(row), date: quoteText(row.date, '审核日期', true, 10), report: quoteText(row.report, '归档报告', true, 200000) }
}

export function freezeAssessment(board: QuoteBoard, value: unknown): CompanyAssessment {
  const draft = parseDraft(value)
  const existing = board.assessments.find(item => item.id === draft.id)
  if (existing) {
    if (JSON.stringify(parseDraft(existing)) !== JSON.stringify(draft)) throw new Error('审核报告已归档，请另存新报告。')
    return existing
  }
  if (draft.basisRevision !== board.revision) throw new QuoteConflict('审核所依据的档案已有更新，请重新核对选定版本后归档。')
  const sources = new Map<string, string>()
  const add = (type: SourceType, id: string, label: string) => sources.set(JSON.stringify([type, id]), label)
  const date = auditDateToday()
  const lines = [draft.selections.length === 1 ? '公司材料审核' : '多家公司比较', date, '档案版本 ' + draft.basisRevision, '', '本次审核依据']
  for (const s of draft.selections) {
    const { vendor, documents, quote, research } = resolveSelection(board, s)
    const name = vendor.name + (vendor.city ? ' · ' + vendor.city : '') + '（' + vendor.id + '）'
    lines.push(name)
    add('vendor', vendor.id, name)
    for (const doc of documents) {
      const label = name + ' / ' + doc.title + ' · ' + doc.version + ' · ' + doc.name
      lines.push('  原件　' + label); add('document', doc.id, label)
    }
    if (quote) {
      const label = name + ' / ' + quote.version + ' · ' + quote.source
      lines.push('  结构化报价　' + label); add('quote', quote.id, label)
      const keys = new Set(quote.lines.map(line => line.key))
      for (const ref of board.references.filter(r => keys.has(r.key))) add('reference', ref.id, ref.city + ' · ' + ref.date + ' · ' + ref.source)
      for (const review of board.reviews.filter(r => r.quoteId === quote.id)) add('clarification', review.id, label + ' · ' + review.topic + ' · ' + review.source)
    }
    if (research) {
      const label = name + ' / 网上评价 · ' + research.date
      lines.push('  调研　' + label); add('research', research.id, label)
    }
  }
  for (const item of board.scopeItems) add('scope', item.id, item.label + ' · ' + item.source)
  lines.push('', '结论', draft.summary)
  for (const finding of draft.findings) {
    lines.push('', finding.dimension + ' · ' + (finding.status === 'gap' ? '待补证' : '审核发现'), finding.detail)
    for (const citation of finding.citations) {
      const label = sources.get(JSON.stringify([citation.type, citation.id]))
      if (!label) throw new Error('引用超出本次所选公司、资料或报价的范围。')
      lines.push('  依据　' + label + ' / ' + citation.at + ' — ' + citation.excerpt)
    }
    if (finding.question) lines.push('  请商家确认　' + finding.question)
  }
  return parseAssessment({ ...draft, date, report: lines.join('\n') })
}

export const assessmentRecordHint = 'assessments: id,basisRevision(实际读取的档案版本),selections:[{vendorId,documentIds,quoteId,researchId}](可空项用null),summary,findings:[{dimension(设计/报价/合同/口碑/综合),status(finding/gap),detail,citations:[{type(document/quote/research/vendor/scope/reference/clarification),id,at(页或条款、单元格、原帖URL等位置),excerpt(原文或可核对的数字)}],question}]。发现须引用选定依据；缺口可用空引用并提出需澄清的问题。'
