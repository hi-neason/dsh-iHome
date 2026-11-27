import { IHOME_TEAM_PRESET_ID } from './agent-presets.ts'
import type { ArchiveTool } from './archive-host'
import { isIHomeToolContext, type IHomeToolContext } from './ihome-workspace-path.ts'

export const CONSULT_EXPERT_TOOL = 'ihome_consult_expert'
export type ExpertRole = 'ihome-needs-analyst' | 'ihome-task-assistant' | 'ihome-floorplan-designer' | 'ihome-quotes-analyst'
export type IHomeAgentRole = ExpertRole | 'coordinator' | 'unsupported'
export const expertProviders: Record<ExpertRole, string> = {
  'ihome-needs-analyst': 'ihome-needs-expert',
  'ihome-task-assistant': 'ihome-task-expert',
  'ihome-floorplan-designer': 'ihome-floorplan-expert',
  'ihome-quotes-analyst': 'ihome-quotes-expert',
}
const expertNames: Record<ExpertRole, string> = {
  'ihome-needs-analyst': '需求分析师',
  'ihome-task-assistant': '任务待办助理',
  'ihome-floorplan-designer': '户型设计师',
  'ihome-quotes-analyst': '选商核价分析师',
}
interface SessionIdentity {
  header: { cwd?: string, parentSession?: string, delegationDepth?: number, origin?: string, agentPreset?: string }
  snapshotEvents?(): readonly { type: string, data: unknown }[]
}

/** DSH writes the first descriptor before publishing a child and restores it on resume. */
export function expertRole(context: IHomeToolContext): IHomeAgentRole {
  const session = context.agent?.session as SessionIdentity | undefined
  if (!session) return 'unsupported'
  const event = session.snapshotEvents?.().find(event => event.type === 'subagent/descriptor')
  const isChild = Boolean(session.header.parentSession || session.header.delegationDepth || session.header.origin === 'subagent' || event)
  if (!isChild) return 'coordinator'
  if (!event || !session.header.parentSession || session.header.delegationDepth !== 1) return 'unsupported'
  const descriptor = event.data as { version?: number, mode?: string, provider?: string } | null
  if (descriptor?.version !== 3 || descriptor.mode !== 'continuable') return 'unsupported'
  return (Object.keys(expertProviders) as ExpertRole[]).find(role => expertProviders[role] === descriptor.provider) ?? 'unsupported'
}

export const coordinatorTools: ReadonlySet<string> = new Set(['skill', 'ihome_read_archive', 'ihome_propose_need', 'ihome_propose_record', 'ihome_read_tasks', 'ihome_propose_task', 'ihome_read_design', 'ihome_read_design_reference', 'ihome_propose_design', 'ihome_review_design', 'ihome_propose_design_decision', 'ihome_read_quotes', 'ihome_propose_quote', CONSULT_EXPERT_TOOL])
const needsTools = new Set(['skill', 'ihome_read_archive'])
const taskTools = new Set(['skill', 'ihome_read_archive', 'ihome_read_tasks'])
const designerTools = new Set(['skill', 'ihome_read_archive', 'ihome_read_design', 'ihome_read_design_reference', 'ihome_review_design'])
const quotesTools = new Set(['skill', 'ihome_read_archive', 'ihome_read_quotes'])
const noTools = new Set<string>()
export function allowedExpertTools(context: IHomeToolContext): ReadonlySet<string> {
  if (!isIHomeToolContext(context)) return noTools
  switch (expertRole(context)) {
    case 'coordinator': return coordinatorTools
    case 'ihome-needs-analyst': return needsTools
    case 'ihome-task-assistant': return taskTools
    case 'ihome-floorplan-designer': return designerTools
    case 'ihome-quotes-analyst': return quotesTools
    default: return noTools
  }
}

export interface ExpertContentBlock { type: string, [key: string]: unknown }
const pendingStarts = new Map<string, { parent: object, provider: string }>()

interface ActivationResult {
  stopReason: string
  output: readonly unknown[]
  diagnostic?: string
}
export interface ExpertDispatchContext {
  tools: { register(tool: ArchiveTool, options: { when(context: IHomeToolContext): boolean }): unknown }
  subagents: {
    registerProvider(provider: {
      name: string
      capabilities: { agentOptions: boolean, agentPreset: boolean, outputSchema: boolean, depthLimit: boolean }
      inheritsParentContext: boolean
      prepareContinuable(request: { sessionId: string, parent: NonNullable<IHomeToolContext['agent']>, signal: AbortSignal }): Promise<Record<string, never>>
    }): unknown
    startActivation(spec: {
      provider: string, label: string, parent: NonNullable<IHomeToolContext['agent']>, signal: AbortSignal,
      prompt: ExpertContentBlock[], delivery: 'caller', maxDepth: number, childId: string, agentPreset?: string,
    }): Promise<{ childId: string, result: Promise<ActivationResult>, dispose(): Promise<void> }>
  }
}

export function isIHomeRoot(context: IHomeToolContext): boolean {
  return isIHomeToolContext(context) && expertRole(context) === 'coordinator'
}

export function isIHomeCoordinator(context: IHomeToolContext): boolean {
  if (!isIHomeRoot(context)) return false
  const agent = context.agent as NonNullable<IHomeToolContext['agent']> & {
    ctx?: { get(name: 'agentPresets'): { composedPreset(context: unknown): string | undefined } | undefined }
  }
  const preset = agent.ctx?.get('agentPresets')?.composedPreset(agent.ctx)
    ?? (agent.session as SessionIdentity).header.agentPreset
  return preset === 'ihome-needs-analyst'
}

/** Mounted once on the plugin host, never once per preset revision. */
export function mountExpertDispatch(ctx: ExpertDispatchContext): void {
  for (const provider of Object.values(expertProviders)) {
    ctx.subagents.registerProvider({
      name: provider,
      capabilities: { agentOptions: true, agentPreset: true, outputSchema: false, depthLimit: true },
      inheritsParentContext: false,
      async prepareContinuable({ sessionId, parent, signal }) {
        signal.throwIfAborted()
        const pending = pendingStarts.get(sessionId)
        if (!isIHomeRoot({ agent: parent }) || pending?.parent !== parent || pending.provider !== provider) throw new Error('专家委派仅能由 iHome工作区的主 Agent 发起。')
        return {}
      },
    })
  }
  ctx.tools.register({
    name: CONSULT_EXPERT_TOOL,
    description: '在同一主会话委派需求分析师、户型设计师、选商核价分析师或任务待办助理执行独立分析。专家可读取本地数据，返回分析与修改建议。请提供具体 task 和必要的对话 context。专家无法修改数据；由主 Agent 审阅后调用 propose 工具，在主对话中请用户确认。',
    parameters: { type: 'object', additionalProperties: false, properties: {
      expert: { type: 'string', enum: Object.keys(expertProviders) },
      task: { type: 'string', minLength: 1, maxLength: 12000 },
      context: { type: 'string', maxLength: 24000 },
    }, required: ['expert', 'task'] },
    output: { schema: {}, render(_args, value) { return [{ type: 'text', text: JSON.stringify(value) }] } },
    async execute(raw, execution) {
      return consultExpert(ctx, raw, execution)
    },
  }, { when: isIHomeCoordinator })
}


/** Forward the current visible user message's native image/file references on ordinary tool dispatch. */
function currentUserAttachments(agent: NonNullable<IHomeToolContext['agent']>): ExpertContentBlock[] {
  const session = agent.session as SessionIdentity & { surface?: { nodes: readonly number[] } }
  const visible = new Set(session.surface?.nodes ?? [])
  const events = session.snapshotEvents?.() ?? []
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index] as { seq?: number, type: string, data: unknown }
    if (event.type !== 'user/message' || (session.surface && !visible.has(event.seq!))) continue
    const message = event.data as { source?: { kind: string }, content?: ExpertContentBlock[] }
    if (message.source?.kind !== 'user') continue
    return (message.content ?? []).filter(block => block.type === 'image' || block.type === 'file')
  }
  return []
}

/** Shared entry for model tool calls and explicit user expert commands. */
export async function consultExpert(
  ctx: Pick<ExpertDispatchContext, 'subagents'>,
  raw: unknown,
  execution: IHomeToolContext & { signal: AbortSignal },
  options: { explicit?: true, attachments?: readonly ExpertContentBlock[] } = {},
) {
  execution.signal.throwIfAborted()
  if (!(options.explicit ? isIHomeRoot(execution) : isIHomeCoordinator(execution)) || !execution.agent) throw new Error('请在 iHome 主会话中调度专家。')
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('专家委派参数无效。')
  const args = raw as Record<string, unknown>
  if (typeof args.expert !== 'string' || !Object.hasOwn(expertProviders, args.expert)) throw new Error('请选择需求分析师、户型设计师、选商核价分析师或任务待办助理。')
  if (typeof args.task !== 'string' || !args.task.trim() || args.task.length > 12000) throw new Error('请提供有效的专家任务，最多 12000 字。')
  if (args.context !== undefined && (typeof args.context !== 'string' || args.context.length > 24000)) throw new Error('专家上下文最多 24000 字。')
  const expert = args.expert as ExpertRole
  const deliverable = expert === 'ihome-floorplan-designer'
    ? '建模请求请返回当前可以绘制的几何变更。房名和用途可以留空，局部疑点随提案说明。仅在请求评审时分析居住需求。'
    : '请返回分析、待澄清问题及建议修改。'
  const text = [`本次委派任务\n${args.task.trim()}`, args.context && `主会话提供的相关上下文\n${args.context}`,
    deliverable, '任何数据写入和用户确认都交给主 Agent 处理。'].filter(Boolean).join('\n\n')
  const childId = crypto.randomUUID()
  const provider = expertProviders[expert]
  pendingStarts.set(childId, { parent: execution.agent, provider })
  let activation: Awaited<ReturnType<ExpertDispatchContext['subagents']['startActivation']>>
  try {
    activation = await ctx.subagents.startActivation({
      provider, childId, label: expertNames[expert], parent: execution.agent,
      ...(!isIHomeCoordinator(execution) ? { agentPreset: IHOME_TEAM_PRESET_ID } : {}),
      signal: execution.signal, prompt: [{ type: 'text', text }, ...structuredClone(options.attachments ?? currentUserAttachments(execution.agent))], delivery: 'caller', maxDepth: 1,
    })
  } finally {
    pendingStarts.delete(childId)
  }
  // rc.5 only observes startActivation's signal before publication. After
  // acceptance, cancellation must address the exact returned activation.
  let disposal: Promise<void> | undefined
  const dispose = () => disposal ??= Promise.resolve().then(() => activation.dispose())
  let rejectCancellation!: (reason: unknown) => void
  const cancellation = new Promise<never>((_resolve, reject) => { rejectCancellation = reject })
  const onAbort = () => {
    // Observe rejection immediately. The finally block awaits the same
    // promise and reports teardown failure without an unhandled rejection.
    void dispose().catch(() => undefined)
    rejectCancellation(execution.signal.reason)
  }
  execution.signal.addEventListener('abort', onAbort, { once: true })
  if (execution.signal.aborted) onAbort()
  try {
    const result = await Promise.race([activation.result, cancellation])
    execution.signal.throwIfAborted()
    return { expert, childSessionId: activation.childId, status: result.stopReason, output: result.output,
      ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}) }
  } finally {
    execution.signal.removeEventListener('abort', onAbort)
    await dispose()
  }
}
