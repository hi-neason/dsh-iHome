import type { QuoteBoard, QuoteLine, QuoteVersion } from './quote-model.ts'
import { basisText, calculatedAmount, ownerScopeDifferences, quoteCents, unitBasis } from './quote-analysis.ts'
import type { QuoteReference } from './quote-reference.ts'
import { quoteStatusLabels } from './quote-version.ts'

export interface AuditQuestion {
  item: string
  kind: '资料' | '范围' | '算术' | '参照单价'
  evidence: string
  question: string
  source: string
}
interface ReferenceCheck { reference: QuoteReference, difference: number | null, reason: string }

function referenceCheck(quote: QuoteVersion, line: QuoteLine, city: string, reference: QuoteReference, asOfDate: string): ReferenceCheck {
  const cityKey = (value: string) => basisText(value).replace(/市$/, '')
  const reasons: string[] = []
  if (!city.trim() || cityKey(city) !== cityKey(reference.city)) reasons.push('城市不同或未填')
  if (reference.date > asOfDate) reasons.push('采价晚于核查基准日')
  if (!line.spec.trim() || basisText(line.spec) !== basisText(reference.spec)) reasons.push('规格或工艺不同或未填')
  if (!quote.scope.trim() || basisText(quote.scope) !== basisText(reference.scope)) reasons.push('承包口径不同或未填')
  if (!line.unit.trim() || unitBasis(line.unit) !== unitBasis(reference.unit)) reasons.push('计量单位不同或未填')
  if (line.status !== 'included') reasons.push('该项未确认为已含')
  if (line.unitPrice === null) reasons.push('缺少书面单价')
  return { reference, reason: reasons.join('、'), difference: reasons.length ? null : (quoteCents(line.unitPrice!) - quoteCents(reference.unitPrice)) / 100 }
}

export function auditDateToday(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function auditQuote(board: QuoteBoard, quoteId: string, asOfDate = auditDateToday()) {
  const quote = board.quotes.find(item => item.id === quoteId)
  if (!quote) throw new Error('找不到要核查的报价版本。')
  const vendor = board.vendors.find(item => item.id === quote.vendorId)
  const questions: AuditQuestion[] = []
  const add = (item: string, kind: AuditQuestion['kind'], evidence: string, question: string, source: string) => {
    questions.push({ item, kind, evidence, question, source })
  }
  if (!quote.source) add('原报价', '资料', '整单出处未填', '请提供带日期和版本的原始报价单。', '')
  if (!quote.scope) add('原报价', '范围', '承包口径未填', '哪些工作由业主承担，哪些计入商家报价？', quote.source)
  if (!quote.date) add('原报价', '资料', '报价日期未填', '这份报价的出具日期是什么？', quote.source)

  let knownIncludedCents = 0
  let knownIncludedCount = 0
  let complete = quote.lines.length > 0
  const keyCounts = new Map<string, number>()
  for (const line of quote.lines) keyCounts.set(line.key, (keyCounts.get(line.key) ?? 0) + 1)
  const scopeItems = new Map((board.scopeItems ?? []).map(item => [item.key, item]))
  for (const scope of scopeItems.values()) {
    if (!keyCounts.has(scope.key)) add(scope.label, '范围', `业主要求项“${scope.key}”未列入本版报价`,
      '请确认是否已计入其他分项，并注明对应行。如需另计，请按询价底稿补充书面报价。', [scope.source, quote.source].filter(Boolean).join(' · '))
  }
  const references = new Map<string, QuoteReference[]>()
  for (const reference of board.references) {
    const group = references.get(reference.key)
    if (group) group.push(reference)
    else references.set(reference.key, [reference])
  }
  const checkedLines = quote.lines.map(line => {
    const source = [quote.source, line.source].filter(Boolean).join(' · ')
    const scope = scopeItems.get(line.key)
    if (scope) {
      const differences = ownerScopeDifferences(scope, line)
      if (line.status !== 'included') differences.push(`业主要求项标注为${quoteStatusLabels[line.status]}`)
      if (differences.length) add(line.label, '范围', differences.join('；'), '请对照业主底稿说明差异并确认由谁承担，必要时提供修订报价。', [scope.source, source].filter(Boolean).join(' · '))
    }
    const calculated = calculatedAmount(line)
    const amount = line.amount ?? calculated
    const duplicate = keyCounts.get(line.key)! > 1
    if (duplicate) {
      complete = false
      add(line.label, '范围', `项目键 ${line.key} 重复`, '这些分项覆盖哪些不同工作？请核对是否重复计价。', source)
    }
    if (line.status === 'included' || line.status === 'allowance') {
      const absent = [!line.spec && '规格或工艺', !line.unit && '计量单位', line.quantity === null && '工程量', line.unitPrice === null && '单价'].filter(Boolean)
      if (absent.length) add(line.label, '资料', `缺少${absent.join('、')}`, `请补充本项的${absent.join('、')}，并说明计价依据。`, source)
      if (line.quantity === 0) add(line.label, '资料', '工程量为零', '本项实际工程量是多少？是否已在其他项目中计价？', source)
      if (line.amount !== null && calculated !== null && quoteCents(line.amount) !== quoteCents(calculated)) {
        add(line.label, '算术', `原列合价 ${line.amount} 元，按工程量乘单价为 ${calculated} 元`, '请核对工程量、单价和合价，并注明优惠或调整。', source)
      }
    }
    if (line.status === 'included') {
      if (amount === null || duplicate) complete = false
      else { knownIncludedCount++; knownIncludedCents += quoteCents(amount) }
    } else if (line.status === 'allowance' || line.status === 'unknown') {
      complete = false
      add(line.label, '范围', line.status === 'allowance' ? '暂估项目' : '承包归属待确认', '本项是否已计入原报总额？请写明确定金额或结算方式。', source)
    } else if (amount !== null && amount !== 0) {
      complete = false
      add(line.label, '范围', `标注${line.status === 'owner' ? '业主自购' : '排除'}，同时列出 ${amount} 元`, '这个金额只是参考，还是计入了原报总额？', source)
    }
    const checks = (references.get(line.key) ?? []).map(ref => referenceCheck(quote, line, vendor?.city || '', ref, asOfDate))
    const matched = checks.filter(check => check.difference !== null)
    if (matched.length && (matched.every(check => check.difference! > 0) || matched.every(check => check.difference! < 0))) {
      const values = matched.map(check => check.reference.unitPrice)
      const samplePrices = `${Math.min(...values)}–${Math.max(...values)}`
      add(line.label, '参照单价', `报价单价 ${line.unitPrice} 元/${line.unit}，${matched.length} 条可比样本范围 ${samplePrices} 元/${line.unit}`,
        '请说明与已记录样本的价差，是否存在税费、运输、用量或服务条件差异？', source)
    }
    return { line, calculated, checks }
  })
  const knownIncluded = knownIncludedCount ? knownIncludedCents / 100 : null
  const reconciled = complete && knownIncluded !== null && quote.statedTotal !== null
  const totalDifference = reconciled ? (quoteCents(quote.statedTotal!) - knownIncludedCents) / 100 : null
  if (quote.statedTotal === null) add('原报总额', '资料', '未提供原报总额', '请提供书面合计及税费、优惠或其他调整。', quote.source)
  if (totalDifference !== null && totalDifference !== 0) add('原报总额', '算术', `原报总额 ${quote.statedTotal} 元，已含分项累计 ${knownIncluded} 元，差额 ${totalDifference} 元`, '请逐项列明差额来自哪些费用、折扣或调整。', quote.source)
  return { quote, checkedLines, questions, knownIncluded, knownIncludedCount, totalDifference }
}
