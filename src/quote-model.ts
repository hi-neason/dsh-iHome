import { parseQuoteVersion, type QuoteVersion } from './quote-version.ts'
export type { QuoteVersion, QuoteLine } from './quote-version.ts'

export interface QuoteVendor {
  id: string
  name: string
  city: string
  contact: string
  scope: string
  credentials: string
  visit: string
  source: string
}

export interface QuoteBoard {
  revision: number
  vendors: QuoteVendor[]
  quotes: QuoteVersion[]
}

export function quoteObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('选商记录格式无效。')
  return value as Record<string, unknown>
}

export function quoteText(value: unknown, label: string, required = false, max = 4000): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    throw new Error('请检查' + label + '，最多 ' + max + ' 字。')
  return value.trim()
}

export function parseVendor(value: unknown): QuoteVendor {
  const row = quoteObject(value)
  return {
    id: quoteText(row.id, '团队编号', true, 120), name: quoteText(row.name, '团队名称', true, 160),
    city: quoteText(row.city ?? '', '城市', false, 100), contact: quoteText(row.contact ?? '', '联系方式'),
    scope: quoteText(row.scope ?? '', '承包范围'), credentials: quoteText(row.credentials ?? '', '资质核验'),
    visit: quoteText(row.visit ?? '', '考察记录'), source: quoteText(row.source ?? '', '资料出处'),
  }
}

function records<T extends { id: string }>(raw: unknown, parse: (entry: unknown) => T): T[] {
  if (!Array.isArray(raw)) throw new Error('选商档案列表无效。')
  const items = raw.map(parse)
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('选商记录编号重复。')
  return items
}

export function parseQuoteBoard(value: unknown): QuoteBoard {
  const row = quoteObject(value)
  if (typeof row.revision !== 'number' || !Number.isSafeInteger(row.revision) || row.revision < 0)
    throw new Error('选商档案版本无效。')
  const vendors = records(row.vendors, parseVendor)
  const quotes = records(row.quotes === undefined ? [] : row.quotes, parseQuoteVersion)
  const vendorIds = new Set(vendors.map(vendor => vendor.id))
  const versions = new Set<string>()
  for (const quote of quotes) {
    if (!vendorIds.has(quote.vendorId)) throw new Error('报价关联的团队不存在。')
    const key = JSON.stringify([quote.vendorId, quote.version])
    if (versions.has(key)) throw new Error('同一团队的报价版本名称须唯一。')
    versions.add(key)
  }
  return { revision: row.revision, vendors, quotes }
}

export const quoteCollections = ['vendors', 'quotes'] as const
export type QuoteCollection = typeof quoteCollections[number]
export class QuoteConflict extends Error {}

export function changeQuoteBoard(board: QuoteBoard, value: unknown): QuoteBoard {
  const raw = quoteObject(value)
  const collection = quoteCollections.find(name => name === raw.collection)
  if (!collection || !Number.isSafeInteger(raw.expectedRevision) || Number(raw.expectedRevision) < 0)
    throw new Error('请指定记录类型和读取时的档案版本。')
  const record = quoteObject(raw.record)
  const previous = board[collection].find(item => item.id === record.id)
  const rows = previous ? board[collection].map(item => item.id === record.id ? record : item) : [...board[collection], record]
  const next = parseQuoteBoard({ ...board, [collection]: rows, revision: board.revision + 1 })
  const saved = next[collection].find(item => item.id === record.id)
  if (!saved) throw new Error('请使用没有首尾空格的记录编号。')
  if (previous && JSON.stringify(saved) === JSON.stringify(previous)) return board
  if (raw.expectedRevision !== board.revision) throw new QuoteConflict('选商档案已有更新，请刷新并核对后再保存。')
  if (previous && collection === 'quotes') throw new Error('报价原版已保存，请另存新版本。')
  return next
}
