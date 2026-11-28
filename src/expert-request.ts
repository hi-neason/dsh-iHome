import { consultExpert, isIHomeRoot, type ExpertDispatchContext, type ExpertRole } from './expert-dispatch.ts'
import type { IHomeToolContext } from './ihome-workspace-path.ts'

interface Message {
  id: string
  role?: string
  source?: { kind: string }
  content: readonly { type: string, text?: string, [key: string]: unknown }[]
}
type Agent = NonNullable<IHomeToolContext['agent']>
type Decision = { kind: 'reject' } | { kind: 'enter', messages: Message[], startsRequestSeries?: true }
export interface ExpertRequestContext extends Pick<ExpertDispatchContext, 'subagents'> {
  on(event: 'agent/pre-step', listener: (
    payload: { agent: Agent, messages: Message[], signal: AbortSignal },
    next: () => Promise<Decision>,
  ) => Promise<Decision>): unknown
  systemPrompt: {
    context(provider: { name: string, order: number, required: true, interpolate: false, text(context: IHomeToolContext): string }): unknown
  }
}

export function parseExpertRequest(text: string): { expert: ExpertRole, task: string } | undefined {
  const match = /^\/(需求分析师|任务待办助理|户型设计师|选商核价分析师|财务经费专员|风水大师)(?:\s+([\s\S]*))?$/.exec(text.replace(/^[ \t]+/, ''))
  if (!match) return undefined
  const roles: Record<string, ExpertRole> = { 需求分析师: 'ihome-needs-analyst', 任务待办助理: 'ihome-task-assistant', 户型设计师: 'ihome-floorplan-designer', 选商核价分析师: 'ihome-quotes-analyst', 财务经费专员: 'ihome-finance-specialist', 风水大师: 'ihome-fengshui-master' }
  return { expert: roles[match[1]], task: (match[2] ?? '').trim() }
}
function messageText(message: Message): string {
  return message.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n')
}

/** Current visible human/model text, followed by the still-uncommitted inbound batch. */
function conversationContext(agent: Agent, incoming: Message[], current: Message): string {
  const session = agent.session as Agent['session'] & {
    surface?: { nodes: readonly number[] }
    snapshotEvents?(): readonly { seq: number, type: string, data: unknown }[]
  }
  const visible = new Set(session.surface?.nodes ?? [])
  const history: Message[] = []
  for (const event of session.snapshotEvents?.() ?? []) {
    if (!visible.has(event.seq)) continue
    if (event.type === 'user/message') {
      const message = event.data as Message
      if (message.source?.kind === 'user') history.push(message)
    } else if (event.type === 'assistant/message') {
      history.push((event.data as { message: Message }).message)
    }
  }
  const seen = new Set<string>([current.id])
  return [...history, ...incoming.filter(message => message.source?.kind === 'user')].filter(message => {
    if (seen.has(message.id)) return false
    seen.add(message.id)
    return true
  })
    .map(message => `${message.role === 'assistant' ? '助手' : '业主'}\n${messageText(message)}`).join('\n\n').slice(-24000)
}

/** Deterministic user routing before the coordinator's next model request. */
export function mountExpertRequests(ctx: ExpertRequestContext): void {
  const reports = new WeakMap<Agent, string>()
  const completed = new WeakMap<Agent, Map<string, string>>()
  ctx.systemPrompt.context({
    name: 'ihome:explicit-expert-report', order: 900, required: true, interpolate: false,
    text: context => context.agent && isIHomeRoot(context) ? reports.get(context.agent) ?? '' : '',
  })
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    reports.delete(agent)
    const decision = await next()
    if (decision.kind === 'reject' || !isIHomeRoot({ agent })) return decision
    signal.throwIfAborted()
    const cache = completed.get(agent) ?? new Map<string, string>()
    completed.set(agent, cache)
    const results: string[] = []
    for (const message of decision.messages) {
      if (message.source?.kind !== 'user') continue
      const request = parseExpertRequest(messageText(message))
      if (!request) continue
      if (!request.task && request.expert === 'ihome-floorplan-designer' && message.content.some(block => block.type === 'image')) request.task = '请根据这张户型图为当前方案生成可编辑的 Three.js 楼层模型；缺少尺寸时明确估算依据。'
      let report = cache.get(message.id)
      if (report === undefined) {
        if (!request.task) {
          report = '业主已选择专家但尚未提供任务。请询问需要该专家协助的具体问题。'
        } else {
          try {
            const attachments = message.content.filter(block => block.type !== 'text')
            const result = await consultExpert(ctx, { ...request, context: conversationContext(agent, decision.messages, message) }, { agent, signal }, { explicit: true, attachments })
            signal.throwIfAborted()
            report = JSON.stringify(result)
          } catch (error) {
            signal.throwIfAborted()
            report = JSON.stringify({ expert: request.expert, status: 'error', task: request.task,
              diagnostic: error instanceof Error ? error.message : '专家暂时无法启动，请稍后重试。' })
          }
        }
        cache.set(message.id, report)
        if (cache.size > 32) cache.delete(cache.keys().next().value!)
      }
      results.push(report)
    }
    signal.throwIfAborted()
    if (results.length) reports.set(agent, [
      '以下是业主显式选择专家后，由宿主实际执行得到的结果。请综合回复，标明专家身份，避免对相同任务重复委派。专家建议不表示数据已保存，修改仍须通过主会话的 propose 工具确认。',
      ...results,
    ].join('\n\n'))
    return decision
  })
}
