import { compareQuotes } from './quote-analysis.ts'
import { auditDateToday, auditQuote } from './quote-audit.ts'
import { contractQuestions } from './quote-review.ts'
import type { QuoteBoard } from './quote-model.ts'

export interface DecisionInput { id: string, quoteId: string, comparedQuoteIds: string[], reason: string }
export interface QuoteDecision extends DecisionInput { date: string, report: string }

function input(raw: Record<string, unknown>): DecisionInput {
  const string = (value: unknown, max: number) => {
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('请填写有效的选商记录编号、选定版本和选择理由。')
    return value.trim()
  }
  if (!Array.isArray(raw.comparedQuoteIds) || !raw.comparedQuoteIds.length) throw new Error('请指定本次考虑的报价版本。')
  const comparedQuoteIds = raw.comparedQuoteIds.map(id => string(id, 200))
  const quoteId = string(raw.quoteId, 200)
  if (new Set(comparedQuoteIds).size !== comparedQuoteIds.length || !comparedQuoteIds.includes(quoteId))
    throw new Error('选定版本必须在本次考虑的版本中，版本不能重复。')
  return { id: string(raw.id, 200), quoteId, comparedQuoteIds, reason: string(raw.reason, 6000) }
}

export function parseDecision(value: unknown): QuoteDecision {
  if (!value || typeof value !== 'object') throw new Error('选商决定格式有误。')
  const raw = value as Record<string, unknown>
  if (typeof raw.report !== 'string' || !raw.report.trim() || typeof raw.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date))
    throw new Error('选商决定缺少当时生成的报告或日期。')
  return { ...input(raw), date: raw.date, report: raw.report }
}

const money = (n: number | null) => n === null ? '未提供' : n.toLocaleString('zh-CN', { style: 'currency', currency: 'CNY' })

export function freezeDecision(board: QuoteBoard, raw: Record<string, unknown>): QuoteDecision {
  const draft = input(raw)
  const existing = board.decisions.find(row => row.id === draft.id)
  if (existing) {
    if (JSON.stringify(input({ ...existing })) !== JSON.stringify(draft)) throw new Error('选商决定已归档。修改选择请另存新的决定。')
    return existing
  }
  const selection = Object.fromEntries(board.vendors.map(vendor => [vendor.id, '']))
  for (const id of draft.comparedQuoteIds) {
    const quote = board.quotes.find(item => item.id === id)
    if (!quote || selection[quote.vendorId]) throw new Error('请选择真实存在的报价，每家团队限一个版本。')
    selection[quote.vendorId] = id
  }
  const date = auditDateToday()
  const result = compareQuotes(board, selection)
  const names = new Map(board.vendors.map(vendor => [vendor.id, vendor.name]))
  const chosen = result.quotes.find(quote => quote.id === draft.quoteId)!
  const title = (quote: typeof chosen) => names.get(quote.vendorId) + ' · ' + quote.version
  const out = ['选商决定与报价核对报告', '决定日期　' + date, '选定团队与版本　' + title(chosen),
    '商家原报总额　' + money(chosen.statedTotal), '业主选择理由　' + draft.reason,
    '', '本次考虑的报价与考察依据']
  result.quotes.forEach((quote, index) => {
    const vendor = board.vendors.find(row => row.id === quote.vendorId)!
    out.push(title(quote) + '　' + quote.date + '　' + money(quote.statedTotal),
      '  报价出处　' + quote.source, '  承包范围　' + (quote.scope || '待确认'),
      '  共同可比分项小计（' + result.comparableCount + ' 项）　' + money(result.subtotals[index]))
    for (const [label, value] of [['城市', vendor.city], ['考察', vendor.visit], ['资质材料与核验情况', vendor.credentials], ['资料出处', vendor.source]])
      if (value) out.push('  ' + label + '　' + value)
  })
  out.push('', '分项比较')
  for (const row of result.rows) {
    out.push(row.label + '（' + row.key + '）　' + (row.issues.length ? row.issues.join('、') : '最高最低差额 ' + money(row.spread)))
    if (row.scopeItem) {
      const item = row.scopeItem
      out.push('  业主询价底稿　' + (item.quantity ?? '数量待定') + ' ' + item.unit + '　' + item.spec + '　出处 ' + item.source)
    }
    row.cells.forEach((cell, index) => out.push('  ' + title(result.quotes[index]) + '　' +
      (cell.lines.length ? money(cell.amount) + '　' + cell.lines.map(line => line.source).join('、') : '未列项') + (cell.scopeIssues.length ? '　' + cell.scopeIssues.join('、') : '')))
  }
  for (const quote of result.quotes) {
    const audit = auditQuote(board, quote.id, date)
    out.push('', title(quote) + ' · 核价与澄清')
    for (const { line, checks } of audit.checkedLines) for (const check of checks) {
      const ref = check.reference
      out.push('  ' + line.label + ' · 参考样本 ' + ref.city + ' ' + ref.date + ' ' + money(ref.unitPrice) + '/' + ref.unit +
        '　' + ref.spec + '　' + ref.scope + '　' + ref.source + '　' + (check.reason || '报价减参照 ' + money(check.difference)))
    }
    for (const q of audit.questions) out.push('  核价提示　' + q.item + '　' + q.evidence + '　' + q.question + '　' + q.source)
    const reviews = board.reviews.filter(item => item.quoteId === quote.id)
    for (const r of reviews) out.push('  ' + (r.status === 'answered' ? '已答复' : '待澄清') + '　' + r.topic + '　' + r.question,
      '  原约定及出处　' + (r.source || '未提供'), '  商家答复　' + (r.answer || '待答复') + (r.answerSource ? '　出处 ' + r.answerSource : ''))
    const unreviewed = contractQuestions.filter(q => !reviews.some(r => r.topic === q.topic))
    if (unreviewed.length) out.push('  尚未核对的合同主题　' + unreviewed.map(q => q.topic).join('、'))
  }
  return { ...draft, date, report: out.join('\n') }
}
