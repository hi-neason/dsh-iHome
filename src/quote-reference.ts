export interface QuoteReference {
  id: string
  key: string
  city: string
  date: string
  source: string
  unit: string
  spec: string
  scope: string
  unitPrice: number
}

export function parseQuoteReference(value: unknown): QuoteReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('参照单价格式有误。')
  const raw = value as Record<string, unknown>
  function field(key: string, label: string, limit = 300) {
    const entry = raw[key]
    if (typeof entry !== 'string' || !entry.trim() || entry.length > limit) throw new Error(`请填写有效的${label}。`)
    return entry.trim()
  }
  const date = field('date', '采价日期', 10)
  const instant = new Date(`${date}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith('0000-') || !Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, 10) !== date) {
    throw new Error('采价日期无效。')
  }
  const unitPrice = raw.unitPrice
  if (typeof unitPrice !== 'number' || !Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > Number.MAX_SAFE_INTEGER / 100) {
    throw new Error('参照单价须为有效的非负金额。')
  }
  return { id: field('id', '参照编号'), key: field('key', '对照项目'), city: field('city', '采价城市'), date,
    source: field('source', '价格出处', 2000), unit: field('unit', '计量单位'), spec: field('spec', '材料规格或工艺', 1500),
    scope: field('scope', '承包口径', 1500), unitPrice }
}
