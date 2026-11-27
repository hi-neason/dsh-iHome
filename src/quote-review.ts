export interface QuoteReview {
  id: string
  quoteId: string
  topic: string
  question: string
  source: string
  answer: string
  answerSource: string
  status: 'open' | 'answered'
}

export const contractQuestions = [
  { topic: '付款节点', question: '各期支付金额、触发付款的验收条件和尾款支付时间分别是什么？' },
  { topic: '工期', question: '何时开工、何时完工？哪些情形可以顺延，双方如何确认？' },
  { topic: '材料替换', question: '约定的品牌或型号缺货时，谁提出替代方案、如何核价、何时取得书面同意？' },
  { topic: '增项书面确认', question: '增减项施工前，双方如何书面确认工程量、价格和工期影响？' },
  { topic: '验收', question: '隐蔽工程和竣工分别按哪些标准验收，谁签字，问题如何整改复验？' },
  { topic: '保修', question: '各工种保修范围、起算日、期限和报修联系人如何约定？' },
  { topic: '税费与清运', question: '报价含哪些税费、开票费用和垃圾清运费用？另收部分按什么标准结算？' },
] as const

export function parseQuoteReview(value: unknown): QuoteReview {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('合同核对记录格式有误。')
  const raw = value as Record<string, unknown>
  function field(key: string, label: string, limit: number, required = false): string {
    const text = raw[key]
    if (typeof text !== 'string' || text.length > limit || (required && !text.trim())) {
      throw new Error(`${label}请填写${limit}字以内的${required ? '非空' : ''}文本。`)
    }
    return text.trim()
  }
  if (raw.status !== 'open' && raw.status !== 'answered') throw new Error('问题状态无效。')
  const answer = field('answer', '商家书面答复', 12000)
  const answerSource = field('answerSource', '答复出处', 2000)
  if (Boolean(answer) !== Boolean(answerSource) || (raw.status === 'answered' && !answer)) {
    throw new Error('记录书面答复时请同时填写答复原文和出处，尚无答复时保持待澄清。')
  }
  return { id: field('id', '问题编号', 200, true), quoteId: field('quoteId', '报价版本编号', 200, true),
    topic: field('topic', '核对主题', 250, true), question: field('question', '澄清问题', 6000, true),
    source: field('source', '原约定与出处', 6000), answer, answerSource, status: raw.status }
}

export function assertUniqueQuoteReviews(reviews: readonly QuoteReview[]): void {
  const keys = new Set<string>()
  for (const review of reviews) {
    const key = JSON.stringify([review.quoteId, review.topic, review.question, review.source].map(value => value.trim().replace(/\s+/gu, ' ')))
    if (keys.has(key)) throw new Error('此版本已有相同主题、问题和出处的澄清记录，请更新已有记录。')
    keys.add(key)
  }
}
