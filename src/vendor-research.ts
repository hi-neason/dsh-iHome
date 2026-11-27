import { auditDateToday } from './quote-audit.ts'
import { quoteObject, quoteText, type QuoteVendor } from './quote-model.ts'

export const researchSourceKinds = { owner: '业主自述', merchant: '商家自述', official: '官方公开信息', other: '第三方信息' } as const
export const researchIdentities = { matched: '与目标相符', uncertain: '归属待核', 'other-branch': '其他门店或主体' } as const

export interface VendorResearchSource {
  title: string
  url: string
  kind: keyof typeof researchSourceKinds
  identity: keyof typeof researchIdentities
  basis: string
  author: string
  published: string
  accessed: string
  excerpt: string
}

export interface QuoteVendorResearch {
  id: string
  vendorId: string
  company: string
  city: string
  branch: string
  date: string
  summary: string
  limitations: string
  questions: string[]
  sources: VendorResearchSource[]
}

function calendarDate(value: unknown, label: string) {
  const date = quoteText(value, label, true, 10)
  const parsed = new Date(date + 'T00:00:00Z')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith('0000') || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date)
    throw new Error(label + '请使用有效的 YYYY-MM-DD。')
  return date
}

function sourceUrl(value: unknown) {
  const raw = quoteText(value, '原文链接', true, 3000)
  const url = URL.canParse(raw) ? new URL(raw) : undefined
  if (!url || !/^https?:\/\//i.test(raw) || /[\s\\]/.test(raw) || !url.hostname || url.username || url.password)
    throw new Error('原文链接请填写不含账号密码的 HTTP 或 HTTPS 地址。')
  return raw
}

function parseSource(value: unknown): VendorResearchSource {
  const source = quoteObject(value)
  const kind = source.kind
  const identity = source.identity
  if (typeof kind !== 'string' || !Object.hasOwn(researchSourceKinds, kind)) throw new Error('请注明原文的来源类型。')
  if (typeof identity !== 'string' || !Object.hasOwn(researchIdentities, identity)) throw new Error('请注明原文与目标公司的归属关系。')
  return {
    title: quoteText(source.title, '原文标题', true, 400), url: sourceUrl(source.url),
    kind: kind as VendorResearchSource['kind'], identity: identity as VendorResearchSource['identity'],
    basis: quoteText(source.basis, '主体或门店的判断依据', true, 1000), author: quoteText(source.author ?? '', '原文署名', false, 160),
    published: quoteText(source.published ?? '', '原文发布日期', false, 80), accessed: calendarDate(source.accessed, '查阅日期'),
    excerpt: quoteText(source.excerpt, '原文摘录', true, 2000),
  }
}

export function parseVendorResearch(value: unknown): QuoteVendorResearch {
  const report = quoteObject(value)
  const date = calendarDate(report.date, '调研日期')
  if (!Array.isArray(report.sources) || report.sources.length > 60) throw new Error('每份报告最多记录 60 条原文。')
  if (!Array.isArray(report.questions) || report.questions.length > 30) throw new Error('每份报告最多记录 30 个待问问题。')
  const sources = report.sources.map(parseSource)
  if (sources.some(source => source.accessed > date)) throw new Error('查阅日期不能晚于调研日期。')
  return {
    id: quoteText(report.id, '报告编号', true, 200), vendorId: quoteText(report.vendorId, '公司编号', true, 120),
    company: quoteText(report.company, '调研时的公司名称', true, 160), city: quoteText(report.city, '调研城市', true, 100),
    branch: quoteText(report.branch ?? '', '门店或区域', false, 200), date,
    summary: quoteText(report.summary, '调研发现', true, 8000), limitations: quoteText(report.limitations, '样本及访问局限', true, 4000),
    questions: report.questions.map(question => quoteText(question, '待问问题', true, 800)), sources,
  }
}

export function vendorResearchPrompt(vendor: Pick<QuoteVendor, 'id' | 'name'>, city: string, branch: string, focus: string, links: string): string {
  const urls = [...new Set(links.split(/\r?\n/).map(line => line.trim()).filter(Boolean))]
  if (urls.length > 8) throw new Error('一次最多提供 8 个网页线索。')
  const target = {
    vendorId: vendor.id, company: vendor.name, city: quoteText(city, '调研城市', true, 100),
    branch: quoteText(branch, '门店或区域', false, 200), focus: quoteText(focus, '关注事项', false, 1000),
    urls: urls.map(sourceUrl), requestedOn: auditDateToday(),
  }
  const task = '请按 ihome-vendor-research 调研这家装修公司的网上评价。\n'
    + JSON.stringify(target) + '\n先读取该公司已有报告，检索公开信息并打开原文，区分目标公司、其他门店和待核线索。按来源说明发现、样本局限及待问问题，交由主会话预览确认归档。'
  if (task.length > 12000) throw new Error('调研请求超过 12000 字，请减少或分批提交网页线索。')
  return '/选商核价分析师 ' + task
}
