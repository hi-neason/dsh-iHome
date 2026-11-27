import { assessmentBasis, assessmentRecordHint } from './quote-assessment.ts'
import { quoteDocumentInfo } from './quote-documents.ts'
import type { ArchiveHostContext, ArchiveTool } from './archive-host'
import { allowedExpertTools } from './expert-dispatch.ts'
import { compareQuotes } from './quote-analysis.ts'
import { auditDateToday, auditQuote } from './quote-audit.ts'
import { changeQuoteBoard, QuoteConflict, quoteCollections, quoteObject, type QuoteBoard, type QuoteCollection } from './quote-model.ts'
import { quoteStatusLabels } from './quote-version.ts'

const output: ArchiveTool['output'] = { schema: {}, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }
const recordTypes: Record<QuoteCollection, string> = { assessments: '材料审核报告', research: '网上评价调研', vendors: '候选团队', scopeItems: '业主询价底稿', quotes: '报价版本', references: '参照单价', reviews: '商家澄清', decisions: '选商决定' }
const fieldNames: Record<string, string> = {
  company: '调研时的公司名称', branch: '门店或区域', summary: '发现', limitations: '局限', questions: '待问问题', sources: '原文依据',
  id: '记录编号', name: '团队名称', city: '城市', contact: '联系方式', scope: '承包范围', credentials: '资质核验',
  visit: '考察记录', source: '出处', vendorId: '团队', version: '版本名称', date: '日期', statedTotal: '原报总额（元）',
  lines: '报价分项', key: '对齐项', label: '原项目名称', unit: '计量单位', quantity: '工程量', unitPrice: '单价（元）',
  amount: '原列合价（元）', spec: '规格与工艺', status: '状态', quoteId: '报价版本', topic: '核对主题',
  question: '澄清问题', answer: '商家书面答复', answerSource: '答复出处', comparedQuoteIds: '参与比较的报价', reason: '选商理由',
}
const statusNames: Record<string, string> = { ...quoteStatusLabels, open: '待澄清', answered: '已答复' }

function identifyQuote(board: QuoteBoard, id: string) {
  const quote = board.quotes.find(item => item.id === id)
  if (!quote) return id
  const team = board.vendors.find(item => item.id === quote.vendorId)
  return `${team?.name ?? quote.vendorId} · ${quote.version}（${id}）`
}

function describe(record: unknown, board: QuoteBoard): string {
  function lines(row: Record<string, unknown>): string[] {
    return Object.entries(row).flatMap(([key, value]): string[] => {
      const label = fieldNames[key] ?? key
      if (key === 'sources' && Array.isArray(value)) return value.map((s, index) => {
        const ref = quoteObject(s)
        return [`[${index + 1}] ${ref.title} · ${ref.url}`, String(ref.excerpt), `${ref.kind} · ${ref.identity} · ${ref.basis}`,
          `署名 ${ref.author || '未披露'} · 发布 ${ref.published || '未披露'} · 查阅 ${ref.accessed}`].join('\n')
      })
      if (key === 'lines' && Array.isArray(value)) {
        return [`共 ${value.length} 条报价分项`, ...value.flatMap((entry, index) => ['分项 ' + (index + 1), ...lines(quoteObject(entry)), ''])]
      }
      if (key === 'comparedQuoteIds' && Array.isArray(value)) return [label + '：' + value.map(id => identifyQuote(board, String(id))).join('、')]
      if (key === 'quoteId' && typeof value === 'string') return [label + '：' + identifyQuote(board, value)]
      if (key === 'vendorId') return [label + '：' + (board.vendors.find(item => item.id === value)?.name ?? '') + '（' + value + '）']
      if (key === 'status' && typeof value === 'string') return [label + '：' + (statusNames[value] ?? value)]
      return [label + '：' + (value === null || value === '' ? '未提供' : typeof value === 'object' ? JSON.stringify(value) : String(value))]
    })
  }
  // The native question detail renders Markdown. Display supplier-supplied text verbatim.
  return lines(quoteObject(record)).join('\n').split('\n').map(line => '    ' + line).join('\n')
}

const queryHint = '用 assessmentScope 指定审核的公司及材料版本，用 assessmentId 回看冻结报告。用 quoteId 读取一份完整报价及核查，用 vendorId 查看该团队资料，用 quoteIds 比较不同团队指定版本。'
function readQuotes(board: QuoteBoard, raw: unknown) {
  const query = quoteObject(raw)
  if (Object.keys(query).some(key => !['quoteId','quoteIds','vendorId','decisionId','assessmentScope','assessmentId'].includes(key)) || Object.keys(query).length > 1) throw new Error('每次请选择一种读取条件。')
  if ('assessmentScope' in query) return assessmentBasis(board, query.assessmentScope)
  if ('assessmentId' in query) {
    const assessment = board.assessments.find(item => item.id === query.assessmentId)
    if (!assessment) throw new Error('指定的审核报告不存在。')
    return { revision: board.revision, assessment }
  }
  if ('quoteIds' in query) {
    const ids = query.quoteIds
    if (!Array.isArray(ids) || ids.length < 2 || ids.some(id => typeof id !== 'string')) throw new Error('比价需指定至少两家团队的报价版本编号。')
    const rows = ids.map(id => {
      const quote = board.quotes.find(item => item.id === id)
      if (!quote) throw new Error('指定的报价版本不存在。')
      return quote
    })
    if (new Set(rows.map(row => row.vendorId)).size !== rows.length) throw new Error('每家团队只能选择一个版本。')
    const selected = Object.fromEntries(board.vendors.map(vendor => [vendor.id, '']))
    for (const quote of rows) selected[quote.vendorId] = quote.id
    return { revision: board.revision, comparison: compareQuotes(board, selected) }
  }
  const { decisions } = board
  if ('decisionId' in query) {
    const decision = decisions.find(item => item.id === query.decisionId)
    if (!decision) throw new Error('指定的选商决定不存在。')
    return { revision: board.revision, decision }
  }
  if ('quoteId' in query) {
    const quote = board.quotes.find(item => item.id === query.quoteId)
    if (!quote) throw new Error('指定的报价版本不存在。')
    const { quote: _quote, ...audit } = auditQuote(board, quote.id)
    return { revision: board.revision, quote, vendor: board.vendors.find(item => item.id === quote.vendorId),
      audit, reviews: board.reviews.filter(item => item.quoteId === quote.id) }
  }
  const vendors = 'vendorId' in query ? board.vendors.filter(item => item.id === query.vendorId) : board.vendors
  if ('vendorId' in query && !vendors.length) throw new Error('指定的候选团队不存在。')
  const quotes = 'vendorId' in query ? board.quotes.filter(item => item.vendorId === query.vendorId) : board.quotes
  const quoteIds = new Set(quotes.map(item => item.id))
  const compact = quotes.reduce((sum, quote) => sum + quote.lines.length, 0) > 40
  const keys = new Set(quotes.flatMap(quote => quote.lines.map(line => line.key)))
  const relevantDecisions = 'vendorId' in query ? decisions.filter(item => item.comparedQuoteIds.some(id => quoteIds.has(id))) : decisions
  return { revision: board.revision, vendors,
    assessments: board.assessments.filter(a => !('vendorId' in query) || a.selections.some(s => s.vendorId === query.vendorId))
      .map(a => ({ id: a.id, date: a.date, summary: a.summary, selections: a.selections })),
    research: board.research.filter(r => !('vendorId' in query) || r.vendorId === query.vendorId).map(r => 'vendorId' in query ? r : { id: r.id, vendorId: r.vendorId, date: r.date, company: r.company, branch: r.branch }),
    documents:board.documents.filter(doc => !('vendorId' in query) || doc.vendorId === query.vendorId).map(quoteDocumentInfo), scopeItems: board.scopeItems, quotes: quotes.map(quote => {
    if (!compact && JSON.stringify(quote).length <= 12000) return quote
    const { lines, ...metadata } = quote
    return { ...metadata, lineCount: lines.length, queryHint }
  }), reviews: board.reviews.filter(item => quoteIds.has(item.quoteId)),
  references: 'vendorId' in query ? board.references.filter(item => keys.has(item.key)) : board.references,
  decisions: relevantDecisions.map(item => JSON.stringify(item).length <= 12000 ? item
    : { id: item.id, quoteId: item.quoteId, comparedQuoteIds: item.comparedQuoteIds, reason: item.reason, queryHint: '用 decisionId 读取完整决定和冻结报告。' }), queryHint }
}

const recordDescription = [
  '提交一条完整记录。新记录自拟唯一 id，重试沿用同一 id。更新前先读全原值并保留未改字段。',
  'vendors: id,name 必填；city,contact,scope,credentials,visit,source 是字符串。',
  'quotes: id,vendorId,version,date(YYYY-MM-DD),source,scope,statedTotal(元或null),lines；每行 key(本版唯一的对齐项),label(原名),unit,quantity,unitPrice,amount,spec,status,source(原文位置)。数量、单价、原合价未知填null。status=included/excluded/allowance/owner/unknown。复报价另起 id 和版本名。',
  'scopeItems: id,key(与报价分项一致),label,unit,quantity(未知为null),spec,source(图纸或业主确认范围出处)。',
  'references: id,key,city,date(YYYY-MM-DD),source,unit,spec,scope,unitPrice(元)。',
  'reviews: id,quoteId,topic,question,source,answer,answerSource,status(open/answered)；未答复时两个答复字段为空串，已答复须有原文及来源。',
  assessmentRecordHint,
  'research: id,vendorId,company(档案名),city,branch,date(YYYY-MM-DD),summary,limitations,questions(字符串数组),sources(已打开的原文数组，可空)。每条来源含 title,url,kind(owner/merchant/official/other),identity(matched/uncertain/other-branch),basis(归属依据),author,published,accessed(YYYY-MM-DD),excerpt。复查另存新 id。',
  'decisions: id,quoteId(业主选中的版本),comparedQuoteIds(包含选中项，每家一版),reason(取舍依据)。宿主生成冻结报告。仅在业主已选定版本时提出。',
].join('\n')

export function registerQuoteTools(
  ctx: Pick<ArchiveHostContext, 'tools' | 'userQuestions'>, read: () => QuoteBoard,
  save: (args: unknown, signal: AbortSignal) => Promise<QuoteBoard>, disposers: (() => void | Promise<void>)[],
): void {
  function register(tool: ArchiveTool) {
    disposers.push(ctx.tools.register({ ...tool, async execute(raw, execution) {
      execution.signal.throwIfAborted()
      if (!allowedExpertTools(execution).has(tool.name)) throw new Error('当前工作区或专家没有使用此选商工具的权限。')
      return tool.execute(raw, execution)
    } }, { when: context => allowedExpertTools(context).has(tool.name) }))
  }
  register({ name: 'ihome_read_quotes', description: '读取本机选商档案及 revision。空参数返回团队、报价、样本、澄清和决定，大报价返回目录。' + queryHint + '用 decisionId 读取冻结报告。',
    parameters: { type: 'object', additionalProperties: false, properties: { vendorId: { type: 'string' }, quoteId: { type: 'string' }, decisionId: { type: 'string' },
      assessmentId: { type: 'string' }, assessmentScope: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false,
        required: ['vendorId', 'documentIds'], properties: { vendorId: { type: 'string' }, documentIds: { type: 'array', items: { type: 'string' } },
          quoteId: { type: ['string','null'] }, researchId: { type: ['string','null'] } } } },
      quoteIds: { type: 'array', minItems: 2, uniqueItems: true, items: { type: 'string' } } } }, output,
    async execute(raw) { return { today: auditDateToday(), ...readQuotes(read(), raw) } },
  })
  register({ name: 'ihome_propose_quote', description: '在当前主会话向业主展示修改，接受后保存。先读最新 revision，再传 expectedRevision、collection 和 record。' + recordDescription,
    parameters: { type: 'object', additionalProperties: false, required: ['expectedRevision', 'collection', 'record'], properties: {
      expectedRevision: { type: 'integer', minimum: 0 }, collection: { type: 'string', enum: quoteCollections }, record: { type: 'object', description: recordDescription },
    } }, output,
    async execute(raw, { agent, signal }) {
      if (!agent) throw new Error('请在 iHome 主会话中修改选商档案。')
      try {
        // Retain the exact proposal across the asynchronous owner confirmation.
        const args = quoteObject(structuredClone(raw))
        const before = read()
        const next = changeQuoteBoard(before, args)
        const collection = args.collection as QuoteCollection
        const recordId = String(quoteObject(args.record).id).trim()
        if (before.revision === next.revision) return { status: 'unchanged', revision: before.revision, id: recordId }
        const previous = before[collection].find(entry => entry.id === recordId)
        const updated = next[collection].find(entry => entry.id === recordId)!
        const detail = [previous ? '原记录\n\n' + describe(previous, before) + '\n\n修改为' : '新增' + recordTypes[collection],
          'findings' in updated ? updated.report.split('\n').map(line => '    ' + line).join('\n')
          : describe('comparedQuoteIds' in updated ? { id: updated.id, quoteId: updated.quoteId, comparedQuoteIds: updated.comparedQuoteIds, reason: updated.reason } : updated, next)].join('\n\n')
        const id = 'apply-quote-change'
        const { answers } = await ctx.userQuestions.ask({ agent, signal, questions: [{ id, header: '选商核价',
          question: '接受这项' + recordTypes[collection] + '记录并保存吗？', detail, options: [{ label: '接受' }, { label: '不接受' }] }] })
        signal.throwIfAborted()
        const [answer] = answers
        if (answers.length !== 1 || answer?.id !== id || answer.custom?.trim() || answer.selected.length !== 1 || answer.selected[0] !== '接受') return { status: 'not_applied', message: '本次选商记录未保存。' }
        const saved = await save(args, signal)
        const receipt = { status: 'applied', revision: saved.revision, collection, id: recordId }
        if (collection !== 'assessments') return receipt
        const assessment = saved.assessments.find(a => a.id === recordId)!
        const gaps = assessment.findings.filter(f => f.status === 'gap').length
        return { ...receipt, summary: assessment.summary, counts: {
          total: assessment.findings.length, findings: assessment.findings.length - gaps, gaps,
        } }
      } catch (error) {
        if (error instanceof QuoteConflict) return { status: 'conflict', message: error.message }
        throw error
      }
    },
  })
}
