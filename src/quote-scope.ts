export interface QuoteScopeItem {
  id: string
  key: string
  label: string
  unit: string
  quantity: number | null
  spec: string
  source: string
}

export function parseQuoteScopeItem(value: unknown): QuoteScopeItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('询价底稿格式有误。')
  const raw = value as Record<string, unknown>
  function field(key: string, label: string, limit: number, required = false) {
    const input = raw[key] ?? ''
    if (typeof input !== 'string' || input.length > limit || (required && !input.trim())) throw new Error(`请填写有效的${label}，最多 ${limit} 字。`)
    return input.trim()
  }
  const quantity = raw.quantity ?? null
  if (quantity !== null && (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0 || quantity > Number.MAX_SAFE_INTEGER / 100)) {
    throw new Error('底稿工程量请填正数，尚未确定时留空。')
  }
  return { id: field('id', '底稿编号', 200, true), key: field('key', '对齐项', 200, true), label: field('label', '要求项目名称', 500, true),
    unit: field('unit', '单位', 80), quantity, spec: field('spec', '规格与工艺', 4000), source: field('source', '底稿出处', 2000, true) }
}

export function assertUniqueScopeKeys(items: readonly QuoteScopeItem[]) {
  const keys = new Set<string>()
  for (const item of items) {
    if (keys.has(item.key)) throw new Error(`询价底稿的对齐项“${item.key}”重复，请按房间或工序细分。`)
    keys.add(item.key)
  }
}
