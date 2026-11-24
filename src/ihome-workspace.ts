import { mkdir } from 'node:fs/promises'
import { iHomeWorkspacePath } from './ihome-workspace-path.ts'
import { modules, type ModuleId } from './modules.ts'

interface ModuleSession { sessionId: string, ready: boolean }
export interface WorkspaceState { sessions: Partial<Record<ModuleId, ModuleSession>> }
interface StateTable {
  get(key: string): WorkspaceState | undefined
  put(key: string, value: WorkspaceState): Promise<void>
}
interface Workspace {
  id: string
  path: string
  title: string
  sessionIds: readonly string[]
  setTitle(title: string): Promise<void>
  attachSession(sessionId: string): Promise<void>
}
interface Header { id: string, cwd?: string }
export interface WorkspaceHostContext {
  systemPrompt: {
    getSectionOrder(name: 'DEPLOYMENT_PERSONA_SUFFIX'): number
    section(section: { name: string, order: number, interpolate: false,
      text(context: { agent?: { session: { id: string } } }): string }): () => void
  }
  workspaceRegistry: {
    create(path: string, title?: string): Promise<Workspace>
    unarchiveSession(sessionId: string): Promise<void>
  }
  sessions: { get(id: string): { header: Header } | undefined }
  sessionPersistence: {
    stat(id: string): Promise<{ header: Header } | undefined>
    flush(): Promise<void>
  }
  sessionController: {
    create(request: { workspaceId: string, sessionId: string }): Promise<{ sessionId: string }>
    rename(request: { sessionId: string, title: string }): Promise<unknown>
  }
  storageDomain: {
    open(spec: {
      name: string, version: number,
      tables: { state: { valueSchema: { parse(value: unknown): WorkspaceState } } }
    }): Promise<{ table(name: 'state'): StateTable, close(): Promise<void> }>
  }
  connection: {
    fetch: { register(route: {
      path: string, methods: string[], requestBody: 'buffered',
      fetch(request: Request): Promise<Response>
    }): () => void | Promise<void> }
  }
  effect(setup: () => Promise<() => Promise<void>>): Promise<unknown>
}

export interface IHomeWorkspace {
  workspaceId: string
  path: string
  title: string
  moduleSessions: Partial<Record<ModuleId, string>>
}
export interface IHomeModuleSession { workspaceId: string, path: string, moduleId: ModuleId, sessionId: string }

function parseState(value: unknown): WorkspaceState {
  if (!value || typeof value !== 'object' || !('sessions' in value)
    || !value.sessions || typeof value.sessions !== 'object' || Array.isArray(value.sessions))
    throw new Error('iHome 会话索引格式无效。')
  const sessions: WorkspaceState['sessions'] = {}
  for (const { id } of modules) {
    const entry: unknown = (value.sessions as Record<string, unknown>)[id]
    if (entry === undefined) continue
    if (!entry || typeof entry !== 'object' || !('sessionId' in entry) || typeof entry.sessionId !== 'string'
      || !entry.sessionId || !('ready' in entry) || typeof entry.ready !== 'boolean')
      throw new Error('iHome 模块会话记录格式无效。')
    sessions[id] = { sessionId: entry.sessionId, ready: entry.ready }
  }
  return { sessions }
}

function moduleId(value: unknown): ModuleId {
  if (!modules.some(module => module.id === value)) throw new Error('请选择一个 iHome 功能模块。')
  return value as ModuleId
}

export function moduleSessionPrompt(state: WorkspaceState, sessionId: string | undefined): string {
  if (!sessionId) return ''
  const module = modules.find(item => state.sessions[item.id]?.sessionId === sessionId)
  if (!module) return ''
  const common = '你正在 iHome工作区中的「' + module.title + '」会话，帮助业主' + module.description + '。右侧 iHome 工作台与当前原生对话并排显示，用户可以直接编辑资料。只使用当前问题需要的档案，通过 ihome_read_archive 按房间或生活话题读取；MVP 只有当前这一套房，工具的 houseId 可省略。'
  const write = '新增或修改居住需求用 ihome_propose_need，记录或修正生活事实、量房尺寸用 ihome_propose_record。修改已有记录前先读取最新内容。信息齐全就调用工具，由工具在当前对话展示具体改动、询问是否接受并完成写入。根据返回结果告诉用户是否已保存，尊重拒绝，如用户给出不同意见则继续讨论。'
  if (module.id !== 'archive') return common + write
  return common + '当用户说不清需求时，从一件真实生活中的困扰开始，每次追问一个具体问题。每条需求关联具体家人和区域，可以涉及多人或跨房间。保留用户原话及不同意见，区分必须满足、尽量满足和待商量。未知尺寸、日期和来源继续询问。' + write
}

/** Serializes workspace creation and durably reserves a Session ID before creation. */
export function createWorkspaceManager(
  ctx: Pick<WorkspaceHostContext, 'workspaceRegistry' | 'sessionController' | 'sessionPersistence' | 'sessions'>,
  table: StateTable,
  directory: string,
) {
  let tail: Promise<unknown> = Promise.resolve()
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = tail.then(operation)
    tail = next.catch(() => undefined)
    return next
  }
  async function workspace() {
    await mkdir(directory, { recursive: true })
    const value = await ctx.workspaceRegistry.create(directory, 'iHome工作区')
    if (value.title !== 'iHome工作区') await value.setTitle('iHome工作区')
    return value
  }
  function state() { return table.get('home') ?? { sessions: {} } }
  async function ensureSession(id: ModuleId): Promise<IHomeModuleSession> {
    const target = await workspace()
    let entry = state().sessions[id]
    let header = entry
      ? ctx.sessions.get(entry.sessionId)?.header ?? (await ctx.sessionPersistence.stat(entry.sessionId))?.header
      : undefined
    if (header && header.cwd !== target.path) throw new Error('模块会话的工作区已变化，请先核对该会话。')
    if (!header) {
      // A missing ready Session was deleted. Reserve its replacement before making
      // external writes, so an interrupted create retries the same blank identity.
      if (!entry || entry.ready) {
        entry = { sessionId: crypto.randomUUID(), ready: false }
        await table.put('home', { sessions: { ...state().sessions, [id]: entry } })
      }
      const created = await ctx.sessionController.create({ workspaceId: target.id, sessionId: entry.sessionId })
      if (created.sessionId !== entry.sessionId) {
        entry = { sessionId: created.sessionId, ready: false }
        await table.put('home', { sessions: { ...state().sessions, [id]: entry } })
      }
      header = ctx.sessions.get(entry.sessionId)?.header ?? (await ctx.sessionPersistence.stat(entry.sessionId))?.header
      if (!header || header.cwd !== target.path) throw new Error('模块会话创建后尚未就绪，请重试。')
    }
    if (!entry) throw new Error('模块会话索引丢失，请重试。')
    await target.attachSession(entry.sessionId)
    await ctx.workspaceRegistry.unarchiveSession(entry.sessionId)
    if (!entry.ready) {
      await ctx.sessionController.rename({ sessionId: entry.sessionId, title: modules.find(module => module.id === id)!.title })
      await ctx.sessionPersistence.flush()
      await table.put('home', { sessions: { ...state().sessions, [id]: { ...entry, ready: true } } })
    }
    return { workspaceId: target.id, path: target.path, moduleId: id, sessionId: entry.sessionId }
  }
  return {
    ensure(): Promise<IHomeWorkspace> {
      return enqueue(async () => {
        const target = await workspace()
        const moduleSessions: IHomeWorkspace['moduleSessions'] = {}
        for (const { id } of modules) {
          const entry = state().sessions[id]
          if (entry?.ready) moduleSessions[id] = entry.sessionId
        }
        return { workspaceId: target.id, path: target.path, title: target.title, moduleSessions }
      })
    },
    open(id: unknown): Promise<IHomeModuleSession> { return enqueue(() => ensureSession(moduleId(id))) },
    settled(): Promise<unknown> { return tail },
  }
}

export async function mountIHomeWorkspace(ctx: WorkspaceHostContext): Promise<void> {
  await ctx.effect(async () => {
    const domain = await ctx.storageDomain.open({
      name: 'ihome_workspace', version: 1, tables: { state: { valueSchema: { parse: parseState } } },
    })
    const table = domain.table('state')
    const manager = createWorkspaceManager(ctx, table, iHomeWorkspacePath())
    const disposers: (() => void | Promise<void>)[] = []
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
      status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    })
    const handler = (operation: (request: Request) => Promise<unknown>) => async (request: Request) => {
      try { request.signal.throwIfAborted(); return json(await operation(request)) }
      catch (error) { return json({ error: error instanceof Error ? error.message : 'iHome 会话暂时无法打开。' }, 400) }
    }
    try {
      disposers.push(ctx.systemPrompt.section({
        name: 'ihome:module', order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX'),
        interpolate: false,
        text: ({ agent }) => moduleSessionPrompt(table.get('home') ?? { sessions: {} }, agent?.session.id),
      }))
      disposers.push(ctx.connection.fetch.register({
        path: '/api/ihome/workspace', methods: ['POST'], requestBody: 'buffered',
        fetch: handler(() => manager.ensure()),
      }))
      disposers.push(ctx.connection.fetch.register({
        path: '/api/ihome/module-session', methods: ['POST'], requestBody: 'buffered',
        fetch: handler(async request => {
          const body: unknown = await request.json()
          if (!body || typeof body !== 'object' || !('moduleId' in body)) throw new Error('缺少模块名称。')
          request.signal.throwIfAborted()
          return manager.open(body.moduleId)
        }),
      }))
      return async () => {
        for (const dispose of disposers.reverse()) await dispose()
        await manager.settled()
        await domain.close()
      }
    } catch (error) {
      for (const dispose of disposers.reverse()) await dispose()
      await manager.settled()
      await domain.close()
      throw error
    }
  })
}
