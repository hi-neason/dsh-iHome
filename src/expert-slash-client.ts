import { requestIHome } from './ihome-http.ts'
import { expertSlashLocales, type ExpertSlashKey } from './expert-slash-locales.ts'

interface SessionContext { readonly sessionId: string }
interface CandidateRequest { query: string, position: 'leading' | 'inline', signal: AbortSignal }
interface Candidate {
  name: string
  label: string
  description: string
  section: string
}
interface ExpertSlashSource {
  trigger: '/'
  name: string
  order: number
  showGroupTitle: boolean
  candidates(session: SessionContext, request: CandidateRequest): Promise<Candidate[]>
  onPick(pick: { session: SessionContext, candidate: { name: string }, position: 'leading' | 'inline' }): { text: string } | undefined
  matchEnter(session: SessionContext, line: string, signal: AbortSignal): Promise<undefined>
}
export interface ExpertSlashContext {
  effect(setup: () => () => void): unknown
  inputTriggers: { registerSource(source: ExpertSlashSource): () => void }
  sessions: {
    refresh(): Promise<void>
    binding(id: string): {
      session: {
        getSnapshot(): { openState: string, removed: boolean, subagent: unknown | null }
      }
    } | undefined
    list: { getSnapshot(): { byId: Record<string, { cwd?: string } | undefined> } }
  }
  locale: {
    register(namespace: string, dictionaries: typeof expertSlashLocales): () => void
    bind(namespace: string): (key: ExpertSlashKey) => string
  }
}

const experts = [
  { name: '需求分析师', key: 'needs', aliases: ['needs', 'analyst', 'requirements', 'xuqiu'] },
  { name: '户型设计师', key: 'design', aliases: ['design', 'floorplan', 'layout', 'huxing'] },
  { name: '任务待办助理', key: 'tasks', aliases: ['tasks', 'todo', 'calendar', 'renwu'] },
] as const

function matches(query: string, value: string): boolean {
  const text = value.toLocaleLowerCase()
  let offset = 0
  for (const character of query.toLocaleLowerCase()) {
    const index = text.indexOf(character, offset)
    if (index < 0) return false
    offset = index + 1
  }
  return true
}

/** A native slash source. Picks edit the composer through DSH's guarded token
 * replacement, and ordinary submission retains attachments, queue mode and cancellation. */
export function createExpertSlashSource(ctx: ExpertSlashContext): ExpertSlashSource {
  const t = ctx.locale.bind('ihome.experts')
  let workspacePath: string | undefined
  let workspaceRequest: Promise<void> | undefined
  function isRootSession(sessionId: string): boolean {
    const binding = ctx.sessions.binding(sessionId)
    if (!binding) return false
    const state = binding.session.getSnapshot()
    return state.openState === 'open' && !state.removed && state.subagent === null
  }
  function available(sessionId: string): boolean {
    return workspacePath !== undefined && isRootSession(sessionId)
      && ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd === workspacePath
  }
  async function loadWorkspace(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    // The installation has one stable workspace path. A failed request is retried
    // on the next opening; a closing menu cannot poison another menu's request.
    workspaceRequest ??= requestIHome('workspace', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: '{}' }).then(async response => {
      const workspace: unknown = await response.json()
      if (!workspace || typeof workspace !== 'object' || !('path' in workspace)
        || typeof workspace.path !== 'string' || !workspace.path) throw new Error(t('unavailable'))
      workspacePath = workspace.path
    }).catch(error => { workspaceRequest = undefined; throw error })
    await workspaceRequest
    signal.throwIfAborted()
  }
  async function ensureMetadata(sessionId: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    // RC.5 create() publishes the catalog before resolving, including blank
    // hero sessions. A retained session can briefly precede a refreshed catalog
    // after reconnect, so read its host metadata before deciding availability.
    await Promise.all([
      loadWorkspace(signal),
      ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd === undefined
        ? ctx.sessions.refresh() : Promise.resolve(),
    ])
    signal.throwIfAborted()
  }
  return {
    // DSH sorts slash sources in ascending order. Native commands start at 0.
    trigger: '/', name: 'ihome-experts', order: -10, showGroupTitle: false,
    async candidates(session, request) {
      if (request.position !== 'leading' || !isRootSession(session.sessionId)) return []
      await ensureMetadata(session.sessionId, request.signal)
      if (!available(session.sessionId)) return []
      const query = request.query.trim()
      return experts.filter(expert => !query || [expert.name, t(expert.key), ...expert.aliases]
        .some(value => matches(query, value))).map(expert => ({
        name: expert.name, label: t(expert.key), description: t(`${expert.key}.description`), section: t('group'),
      }))
    },
    onPick({ session, candidate, position }) {
      if (position !== 'leading' || !available(session.sessionId)) return undefined
      const expert = experts.find(item => item.name === candidate.name)
      return expert ? { text: `/${expert.name} ` } : undefined
    },
    async matchEnter(session, line, signal) {
      const token = line.trimStart().split(/\s/u, 1)[0]
      const expert = experts.find(item => token === `/${item.name}`)
      if (!expert) return undefined
      if (!isRootSession(session.sessionId)) throw new Error(t('unavailable'))
      await ensureMetadata(session.sessionId, signal)
      if (!available(session.sessionId)) throw new Error(t('unavailable'))
      if (!line.trimStart().slice(token.length).trim()) throw new Error(t('questionRequired'))
      // No CommandClaim: DSH sends the original user message through its normal
      // input transaction. The Host consumes the selected expert prefix per turn.
      return undefined
    },
  }
}

export function mountExpertSlash(ctx: ExpertSlashContext): void {
  ctx.effect(() => ctx.locale.register('ihome.experts', expertSlashLocales))
  ctx.effect(() => ctx.inputTriggers.registerSource(createExpertSlashSource(ctx)))
}
