import { EXPERT_TEAM_SETTINGS_ID, type AgentPresetSettingsView } from './agent-presets.ts'
import { iHomeWorkspacePath, isIHomeToolContext, type IHomeToolContext } from './ihome-workspace-path.ts'
import { allowedExpertTools, expertRole, coordinatorTools } from './expert-dispatch'
import { skillBodies } from './expert-skill-bodies'

export const name = 'ihome-expert-team'
export const inject = ['ihomeAgentSettings', 'systemPrompt', 'skills', 'tools']

interface Lookup { cwd?: string, signal?: AbortSignal, scope?: IHomeToolContext['agent'] }
interface SkillCandidate {
  name: string
  description: string
  invocation: { modelInvocable: boolean, userInvocable: boolean }
  source: string
  provider: string
  rank: number
  locator: string
}
interface PresetContext {
  ihomeAgentSettings: {
    get(id: string): AgentPresetSettingsView
    subscribe(listener: () => void): () => void
  }
  systemPrompt: {
    getSectionOrder(name: 'DEPLOYMENT_PERSONA_PREFIX'): number
    section(section: { name: string, order: number, interpolate: false, text(context: IHomeToolContext): string }): () => void
  }
  tools: {
    definitions(): readonly { name: string }[]
    restrict(filter: { deny: string[] }): () => void
    guard(check: (execution: IHomeToolContext & { name: string }) => string | undefined): () => void
  }
  skills: {
    registerProvider(create: (control: { invalidate(): void, signal: AbortSignal }) => {
      name: string
      list(options: Lookup): Promise<SkillCandidate[]>
      get(candidate: SkillCandidate, options: Lookup): Promise<(SkillCandidate & { content: string }) | undefined>
    }): () => void
  }
  effect(setup: () => () => void): unknown
}

/** A single public DSH preset serves both the owner and its delegated children. */
export function apply(ctx: PresetContext): void {
  function settings(context: IHomeToolContext) {
    const role = expertRole(context)
    if (role === 'unsupported' || !isIHomeToolContext(context)) return undefined
    return ctx.ihomeAgentSettings.get(role === 'coordinator' ? EXPERT_TEAM_SETTINGS_ID : role)
  }
  // Preset revisions are ancestors of live agents. An allow-list here would also
  // mask the revision's native skill tool when viewed from a mounted agent.
  const denied = ctx.tools.definitions().map(tool => tool.name).filter(tool => !coordinatorTools.has(tool))
  if (denied.length) ctx.tools.restrict({ deny: denied })
  // The execution guard also covers global tools registered after this preset.
  ctx.tools.guard(execution => {
    if (!isIHomeToolContext(execution)) return '专家团工具仅在 iHome工作区中可用。'
    if (!allowedExpertTools(execution).has(execution.name)) return '当前专家没有使用这个工具的权限。'
    return undefined
  })
  ctx.systemPrompt.section({
    name: 'ihome:expert-team',
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
    interpolate: false,
    text: context => {
      if (!isIHomeToolContext(context)) return '请用户从 iHome 首页进入专家团，在 iHome工作区中继续。'
      const value = settings(context)
      if (!value) return '当前会话没有可用的 iHome 专家身份，请将问题交给专家团主会话。'
      return [value.basePrompt, value.instructions.trim() && `业主附加指导\n${value.instructions}`].filter(Boolean).join('\n\n')
    },
  })
  ctx.skills.registerProvider(control => {
    ctx.effect(() => ctx.ihomeAgentSettings.subscribe(control.invalidate))
    function candidates(options: Lookup): SkillCandidate[] {
      options.signal?.throwIfAborted()
      if (options.cwd !== iHomeWorkspacePath()) return []
      const value = settings({ agent: options.scope })
      if (!value) return []
      return value.skills.filter(skill => value.enabledSkills.includes(skill.id) && skillBodies[skill.id]).map(skill => ({
        name: skill.id, description: skill.description,
        invocation: { modelInvocable: true, userInvocable: true },
        source: 'bundled', provider: name, rank: 0, locator: skill.id,
      }))
    }
    return {
      name,
      list: async options => candidates(options),
      get: async (candidate, options) => {
        // Recheck current settings even when a registry lookup retained an older candidate.
        const active = candidates(options).find(skill => skill.name === candidate.name)
        if (!active) return undefined
        return { ...active, content: skillBodies[active.name].replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim() }
      },
    }
  })
}
