import { stages } from './modules.ts'

export const expenseStages = [...stages.map(({ id, title }) => ({ id, title })), { id: 'other', title: '其他支出' }] as const
export type ExpenseStage = typeof expenseStages[number]['id']
export interface ExpenseEntry {
  id: string
  title: string
  date: string
  payee: string
  category: string
  stage: ExpenseStage
  kind: 'payment' | 'refund'
  amountCents: number
  notes: string
}
export interface ExpenseBoard { revision: number, entries: ExpenseEntry[] }
export interface ExpenseTotals { paymentCents: number, refundCents: number, netCents: number }
export interface ExpenseView extends ExpenseBoard {
  summary: ExpenseTotals & { stages: (ExpenseTotals & { stage: ExpenseStage })[] }
}
export class ExpenseConflict extends Error {}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('账目数据格式无效。')
  return value as Record<string, unknown>
}
function text(value: unknown, name: string, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error(`${name}格式无效。`)
  return value.trim()
}
function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('账本版本无效。')
  return value
}
function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) throw new Error('账目日期请填写 YYYY-MM-DD。')
  const parsed = new Date(value + 'T00:00:00Z')
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error('账目日期无效。')
  return value
}
function stage(value: unknown): ExpenseStage {
  if (!expenseStages.some(item => item.id === value)) throw new Error('账目阶段无效。')
  return value as ExpenseStage
}
function entry(value: unknown): ExpenseEntry {
  const raw = object(value)
  if (raw.kind !== 'payment' && raw.kind !== 'refund') throw new Error('请选择付款或退款。')
  if (typeof raw.amountCents !== 'number' || !Number.isSafeInteger(raw.amountCents) || raw.amountCents <= 0) throw new Error('金额请填写大于零的整数分。')
  return { id: text(raw.id, '账目编号', 200, true), title: text(raw.title, '用途', 240, true),
    date: date(raw.date), payee: text(raw.payee === undefined ? '' : raw.payee, '收款方', 240), category: text(raw.category === undefined ? '' : raw.category, '类别', 120),
    stage: stage(raw.stage), kind: raw.kind, amountCents: raw.amountCents, notes: text(raw.notes, '凭证与备注', 10000) }
}
export function summarizeExpenses(entries: ExpenseEntry[]): ExpenseView['summary'] {
  const summary: ExpenseView['summary'] = { paymentCents: 0, refundCents: 0, netCents: 0,
    stages: expenseStages.map(item => ({ stage: item.id, paymentCents: 0, refundCents: 0, netCents: 0 })) }
  for (const item of entries) {
    const totals = summary.stages.find(part => part.stage === item.stage)!
    const field = item.kind === 'payment' ? 'paymentCents' : 'refundCents'
    summary[field] += item.amountCents
    if (!Number.isSafeInteger(summary[field])) throw new Error('账目合计超出可精确计算的金额范围。')
    totals[field] += item.amountCents
    totals.netCents = totals.paymentCents - totals.refundCents
  }
  summary.netCents = summary.paymentCents - summary.refundCents
  return summary
}
export function validateExpenseBoard(value: unknown): ExpenseBoard {
  const raw = object(value)
  if (!Array.isArray(raw.entries)) throw new Error('账目列表格式无效。')
  const entries = raw.entries.map(entry)
  if (new Set(entries.map(item => item.id)).size !== entries.length) throw new Error('账目编号重复。')
  summarizeExpenses(entries)
  return { revision: revision(raw.revision), entries }
}
export function queryExpenses(board: ExpenseBoard, value: unknown = {}): ExpenseView {
  const raw = object(value)
  const selectedStage = raw.stage === undefined ? undefined : stage(raw.stage)
  const from = raw.from === undefined ? undefined : date(raw.from)
  const to = raw.to === undefined ? undefined : date(raw.to)
  if (from && to && from > to) throw new Error('账目日期范围无效。')
  const entries = board.entries.filter(item => (!selectedStage || item.stage === selectedStage)
    && (!from || item.date >= from) && (!to || item.date <= to))
  return { revision: board.revision, entries, summary: summarizeExpenses(entries) }
}
export function formatExpenseAmount(amountCents: number): string {
  const absolute = Math.abs(amountCents)
  return `${amountCents < 0 ? '-' : ''}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`
}
function describe(item: ExpenseEntry): string {
  return [`${item.kind === 'payment' ? '付款' : '退款'} ${formatExpenseAmount(item.amountCents)} 元`,
    `用途：${item.title}`, `日期：${item.date}`, `收款方：${item.payee || '未填写'}`, `类别：${item.category || '未填写'}`,
    `阶段：${expenseStages.find(part => part.id === item.stage)!.title}`, `凭证与备注：${item.notes || '未填写'}`].join('\n')
}
export function prepareExpenseChange(board: ExpenseBoard, value: unknown) {
  const raw = object(value)
  if (!['create', 'update', 'delete'].includes(String(raw.action))) throw new Error('请选择新增、更新或删除账目。')
  const expectedRevision = revision(raw.expectedRevision)
  const expenseId = text(raw.expenseId, '账目编号', 200, true)
  const previous = board.entries.find(item => item.id === expenseId)
  if (raw.action === 'delete') {
    if (!previous) return { changed: false, next: board, summary: '', expenseId }
    if (expectedRevision !== board.revision) throw new ExpenseConflict('账本已有更新，请读取最新账本后重新确认。')
    return { changed: true, next: { ...board, entries: board.entries.filter(item => item.id !== expenseId) }, summary: '删除账目\n' + describe(previous), expenseId }
  }
  if (raw.action === 'update' && !previous) throw new Error('这条账目已不存在，请重新读取账本。')
  const base = raw.action === 'update' ? previous : undefined
  const fields = Object.fromEntries(['title', 'date', 'payee', 'category', 'stage', 'kind', 'amountCents', 'notes']
    .filter(key => raw[key] !== undefined).map(key => [key, raw[key]]))
  const nextEntry = entry({ notes: '', ...base, ...fields, id: expenseId })
  if (previous && JSON.stringify(previous) === JSON.stringify(nextEntry)) return { changed: false, next: board, summary: '', expenseId }
  if (raw.action === 'create' && previous) throw new ExpenseConflict('这个账目编号已使用，请读取账本核对后更新原账目，或为另一笔交易使用新的编号。')
  if (expectedRevision !== board.revision) throw new ExpenseConflict('账本已有更新，请读取最新账本后重新确认。')
  const entries = previous ? board.entries.map(item => item.id === expenseId ? nextEntry : item) : [...board.entries, nextEntry]
  return { changed: true, next: validateExpenseBoard({ ...board, entries }), expenseId,
    summary: previous ? '更新前\n' + describe(previous) + '\n\n更新后\n' + describe(nextEntry) : '新增账目\n' + describe(nextEntry) }
}
