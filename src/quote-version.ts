export type QuoteLineStatus = 'included' | 'excluded' | 'allowance' | 'owner' | 'unknown'

export interface QuoteLine {
  key: string
  label: string
  unit: string
  quantity: number | null
  unitPrice: number | null
  amount: number | null
  spec: string
  status: QuoteLineStatus
  source: string
}

export interface QuoteVersion {
  id: string
  vendorId: string
  version: string
  date: string
  source: string
  scope: string
  statedTotal: number | null
  lines: QuoteLine[]
}

export const quoteStatusLabels: Record<QuoteLineStatus, string> = {
  included: '包含', excluded: '排除', allowance: '暂估', owner: '甲供', unknown: '待确认',
}

function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('报价记录格式有误。')
  return raw as Record<string, unknown>
}

function text(value: unknown, label: string, limit: number, required = false): string {
  if (typeof value !== 'string' || value.length > limit || (required && !value.trim())) {
    throw new Error(`${label}请填写${limit}字以内的${required ? '非空' : ''}文本。`)
  }
  return value.trim()
}

function numberOrNull(value: unknown, label: string): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER / 100) {
    throw new Error(`${label}请填写有效的非负数，未知时留空。`)
  }
  return value
}

function parseLine(raw: unknown): QuoteLine {
  const line = object(raw)
  if (typeof line.status !== 'string' || !Object.hasOwn(quoteStatusLabels, line.status)) {
    throw new Error('承包口径须选包含、排除、暂估、甲供或待确认。')
  }
  return {
    key: text(line.key, '对齐项', 200, true), label: text(line.label, '原项目名称', 500, true),
    unit: text(line.unit, '单位', 80), quantity: numberOrNull(line.quantity, '工程量'),
    unitPrice: numberOrNull(line.unitPrice, '单价'), amount: numberOrNull(line.amount, '原合价'),
    spec: text(line.spec, '规格与工艺', 4000), status: line.status as QuoteLineStatus,
    source: text(line.source, '分项出处', 2000, true),
  }
}

function checkLines(lines: QuoteLine[]): QuoteLine[] {
  if (!lines.length || lines.length > 2000) throw new Error('每份报价需录入 1 至 2000 条分项。')
  const keys = new Set<string>()
  for (const line of lines) {
    if (keys.has(line.key)) throw new Error(`同一报价内的对齐项重复：${line.key}。可按房间、工序细分。`)
    keys.add(line.key)
  }
  return lines
}

/** Preserve suppliers' stated amounts and missing values for the audit step. */
export function parseQuoteVersion(raw: unknown): QuoteVersion {
  const record = object(raw)
  const date = text(record.date, '报价日期', 10, true)
  const parsed = new Date(date + 'T00:00:00Z')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith('0000') || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error('报价日期请填写有效的 YYYY-MM-DD。')
  }
  if (!Array.isArray(record.lines) || record.lines.length > 2000) throw new Error('分项清单格式有误或超过 2000 条。')
  const lines = record.lines.map((line, i) => {
    try { return parseLine(line) }
    catch (error) { throw new Error(`分项 ${i + 1}：${error instanceof Error ? error.message : '格式有误。'}`) }
  })
  return {
    id: text(record.id, '报价编号', 200, true), vendorId: text(record.vendorId, '候选团队编号', 200, true),
    version: text(record.version, '报价版本', 200, true), date, source: text(record.source, '报价出处', 2000, true),
    scope: text(record.scope, '承包范围', 4000), statedTotal: numberOrNull(record.statedTotal, '原报价总额'),
    lines: checkLines(lines),
  }
}

export const quoteTsvHeader = '对齐项\t原项目名称\t单位\t工程量\t单价\t原合价\t规格与工艺\t承包口径\t分项出处'

function decimal(cell: string, label: string): number | null {
  if (!cell) return null
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(cell)) throw new Error(`${label}请填写十进制非负数，未知时留空。`)
  return numberOrNull(Number(cell), label)
}

/** One spreadsheet row per line. Accept a header and empty numeric cells. */
export function parseQuoteTsv(input: string): QuoteLine[] {
  if (input.length > 2_000_000) throw new Error('粘贴内容过长，请分批录入。')
  const rows = input.replace(/^\uFEFF/, '').split(/\r\n?|\n/)
  const lines: QuoteLine[] = []
  for (const [index, row] of rows.entries()) {
    if (!row.trim()) continue
    const cells = row.split('\t').map(cell => cell.trim())
    if (!lines.length && cells.join('\t') === quoteTsvHeader) continue
    try {
      if (cells.length !== 9) throw new Error('请按示例粘贴 9 列，以制表符分隔。')
      const [key, label, unit, quantity, unitPrice, amount, spec, statusLabel, source] = cells
      const status = Object.entries(quoteStatusLabels).find(([key, value]) => key === statusLabel || value === statusLabel)?.[0]
      lines.push(parseLine({ key, label, unit, quantity: decimal(quantity, '工程量'), unitPrice: decimal(unitPrice, '单价'),
        amount: decimal(amount, '原合价'), spec, status, source }))
    } catch (error) {
      throw new Error(`粘贴内容第 ${index + 1} 行：${error instanceof Error ? error.message : '格式有误。'}`)
    }
  }
  return checkLines(lines)
}
