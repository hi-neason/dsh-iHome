import type { QuoteBoard, QuoteLine, QuoteVersion } from './quote-model.ts'

import { quoteStatusLabels } from './quote-version.ts'

export function basisText(value: string) { return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase() }
export function unitBasis(value: string) {
  const unit = basisText(value)
  if (['m2', 'm²', '平方米', '平米'].includes(unit)) return 'm²'
  if (['m3', 'm³', '立方米'].includes(unit)) return 'm³'
  if (['米', 'm'].includes(unit)) return 'm'
  return unit
}
export function quoteCents(value: number) {
  return Math.round((value + Number.EPSILON * Math.abs(value)) * 100)
}
export function calculatedAmount(line: QuoteLine) {
  return line.quantity !== null && line.unitPrice !== null ? quoteCents(line.quantity * line.unitPrice) / 100 : null
}
function lineAmount(line: QuoteLine) { return line.amount ?? calculatedAmount(line) }
export function quoteVersions(board: QuoteBoard, vendorId: string) {
  return board.quotes.filter(quote => quote.vendorId === vendorId).reverse().sort((a, b) => b.date.localeCompare(a.date))
}

interface Cell { lines: QuoteLine[], amount: number | null }
interface Row { key: string, label: string, cells: Cell[], issues: string[], spread: number | null }

function comparisonIssues(cells: Cell[], quotes: QuoteVersion[]) {
  const issues: string[] = []
  if (quotes.length < 2) issues.push('至少需要两家报价')
  if (cells.some(cell => !cell.lines.length)) issues.push('有商家未列此项')
  if (cells.some(cell => cell.lines.length > 1)) issues.push('项目键重复，请拆分或核对')
  const lines = cells.flatMap(cell => cell.lines)
  for (const status of new Set(lines.map(line => line.status))) {
    if (status !== 'included') issues.push(quoteStatusLabels[status])
  }
  function checkBasis(values: string[], name: string) {
    if (values.includes('')) issues.push(`${name}未明确`)
    else if (new Set(values).size > 1) issues.push(`${name}不同`)
  }
  checkBasis(quotes.map(quote => basisText(quote.scope)), '承包口径')
  checkBasis(lines.map(line => unitBasis(line.unit)), '单位')
  checkBasis(lines.map(line => basisText(line.spec)), '规格或工艺')
  if (lines.some(line => line.quantity === null || line.quantity <= 0)) issues.push('工程量待核实')
  else if (new Set(lines.map(line => line.quantity)).size > 1) issues.push('工程量不同')
  if (lines.some(line => line.status === 'included' && lineAmount(line) === null)) issues.push('缺少金额')
  if (lines.some(line => {
    const calculated = calculatedAmount(line)
    return calculated !== null && line.amount !== null && quoteCents(calculated) !== quoteCents(line.amount)
  })) issues.push('原列合价与计算值不同')
  return issues
}

/** An empty string omits that vendor. Unspecified vendors default to their latest dated quotation. */
export function compareQuotes(board: QuoteBoard, selectedVersions: Record<string, string> = {}) {
  const quotes = board.vendors.flatMap(vendor => {
    const versions = quoteVersions(board, vendor.id)
    const selection = Object.hasOwn(selectedVersions, vendor.id) ? selectedVersions[vendor.id] : undefined
    const quote = selection === undefined ? versions[0] : versions.find(version => version.id === selection)
    return quote ? [quote] : []
  })
  const labels = new Map<string, string>()
  const indexed = quotes.map(quote => {
    const entries = new Map<string, QuoteLine[]>()
    for (const line of quote.lines) {
      if (!labels.has(line.key)) labels.set(line.key, line.label)
      const group = entries.get(line.key)
      if (group) group.push(line)
      else entries.set(line.key, [line])
    }
    return entries
  })
  const rows: Row[] = []
  const subtotals = quotes.map(() => 0)
  let comparableCount = 0
  for (const [key, label] of labels) {
    const cells = indexed.map(entries => {
      const lines = entries.get(key) ?? []
      return { lines, amount: lines.length === 1 ? lineAmount(lines[0]) : null }
    })
    const issues = comparisonIssues(cells, quotes)
    let spread = null
    if (!issues.length) {
      const cents = cells.map(cell => quoteCents(cell.amount!))
      spread = (Math.max(...cents) - Math.min(...cents)) / 100
      cents.forEach((price, column) => { subtotals[column] += price })
      comparableCount++
    }
    rows.push({ key, label, cells, issues, spread })
  }
  return { quotes, rows, comparableCount, subtotals: subtotals.map(value => comparableCount ? value / 100 : null) }
}
