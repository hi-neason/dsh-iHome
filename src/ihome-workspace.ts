import { mkdir } from 'node:fs/promises'
import { iHomeWorkspacePath } from './ihome-workspace-path.ts'
import { modules, type ModuleId } from './modules.ts'

interface ModuleSession { sessionId: string, ready: boolean, roleTitle?: string }
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
    projections(request: { sessionId: string }, signal: AbortSignal): Promise<{ kind: string, values: { title?: string | null } } | null>
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
    sessions[id] = { sessionId: entry.sessionId, ready: entry.ready,
      ...('roleTitle' in entry && typeof entry.roleTitle === 'string' ? { roleTitle: entry.roleTitle } : {}) }
  }
  return { sessions }
}

function moduleId(value: unknown): ModuleId {
  if (!modules.some(module => module.id === value)) throw new Error('请选择一个 iHome 功能模块。')
  return value as ModuleId
}

// Previous default titles of sessions created before roleTitle was stored.
const legacyTitles: Partial<Record<ModuleId, readonly string[]>> = {
  archive: ['家庭档案库', '家庭档案管理员', '家庭需求分析师'], design: ['设计工作室'], quotes: ['选商、报价与合同'],
  materials: ['选材与采购'], site: ['施工计划与现场'], handover: ['验收、交付与保修'],
  knowledge: ['装修知识库'], documents: ['档案文档管理员'],
}

const roleInstructions: Record<ModuleId, string> = {
  archive: '从真实生活中的困扰开始，每次追问一个具体问题。每条需求至少关联一位家人和至少一个房间或区域。书房、玄关、阅读区都可以直接作为独立空间，可以多选。保留用户原话及不同意见，区分必须满足、尽量满足和待商量。未知尺寸、日期和来源继续询问。',
  knowledge: '解答各装修阶段的通用问题，用业主能理解的语言解释术语、做法和取舍。涉及标准时说明依据和适用条件；需要结合用户家情况才能判断时，先补齐相关信息。',
  documents: '管理设计、选商、施工、验收和入住各阶段产生的文档及物料资料。协助用户按阶段、房间或区域、来源和用途归档与查找，保留文件版本和依据关系。用 ihome_read_archive 的 documentQuery、documentStage、documentKind 查找文件名称、来源与备注。需要阅读正文时请用户提供原件，导入与编辑在右侧工作台完成。',
  tasks: '把业主需要做的事记成具体任务，协助安排日期、改期和跟进完成进度。用户尚未决定日期时可记录为未排期。用 ihome_read_tasks 查询任务、状态和日期范围，核对同名任务。修改前先取最新 revision，再用 ihome_propose_task 提交新增、更新或删除建议。用户在对话中接受后，依据工具返回的结果说明是否保存。只有业主明确说已完成时才标记完成。',
  design: '结合家人需求、原始户型和实测尺寸讨论空间布局、家具尺度与生活动线。保留图纸来源，区分实测信息与推测，结构改动交由具备相应资质的专业人员核实。',
  quotes: '比较装修团队的服务范围、报价与合同。先对齐工程内容、计量单位、材料工艺和税费，再核算金额；标明漏项、暂估项、增项及付款约定，引用所提供文件的条目。',
  materials: '按需求、预算及现场安装条件比较具体品牌型号。核实规格、报价日期、配件、配送安装与售后范围，把下单和到货时间衔接到施工节点。',
  budget: '按合同、确认的变更与付款凭证整理预算和支出，区分估算与已确认金额，避免重复计入合同额与付款额。',
  site: '围绕工序依赖、材料到货和人员安排制定施工计划。记录现场问题、责任人、约定期限及复查结果，隐蔽工程覆盖前安排检查和留照。',
  handover: '按施工范围和合同约定整理验收清单、问题证据、整改及复验记录。说明需要现场专业人员或仪器检测的项目，依据用户提供的检测结果判断，准确区分待验与已通过。',
  movein: '结合家庭成员、交付状态与物品清单安排保洁、搬运、收纳和入住。跟进未整改问题，整理设备启用、保修联系人及维护周期；入住条件依据实际检测和交付资料核实。',
}

export function moduleSessionPrompt(state: WorkspaceState, sessionId: string | undefined): string {
  if (!sessionId) return ''
  const module = modules.find(item => state.sessions[item.id]?.sessionId === sessionId)
  if (!module) return ''
  const intro = '你是 iHome 装修专家团中的「' + module.title + '」，在 iHome工作区帮助业主' + module.description + '。' + roleInstructions[module.id]
  if (module.id === 'tasks') return intro + '设备本地日期为 ' + new Date().toLocaleDateString('sv-SE') + '。用户可以在右侧工作台的任务列表和日历中查看或直接编辑任务。'
  const common = intro + '右侧 iHome 工作台与当前原生对话并排显示，用户可以直接编辑资料。只使用当前问题需要的档案，通过 ihome_read_archive 按所选房间或区域、生活话题读取；MVP 只有当前这一套房，工具的 houseId 可省略。'
  const write = '新增或修改居住需求用 ihome_propose_need，记录或修正生活事实、量房尺寸用 ihome_propose_record。修改已有记录前先读取最新内容。信息齐全就调用工具，由工具在当前对话展示具体改动、询问是否接受并完成写入。根据返回结果告诉用户是否已保存，尊重拒绝，如用户给出不同意见则继续讨论。'
  return common + write
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
    const title = modules.find(module => module.id === id)!.title
    if (!entry.ready || entry.roleTitle !== title) {
      let rename = !entry.ready
      if (entry.ready) {
        const oldTitles = entry.roleTitle ? [entry.roleTitle] : legacyTitles[id] ?? []
        if (oldTitles.length) {
          const projection = await ctx.sessionController.projections({ sessionId: entry.sessionId }, new AbortController().signal)
          rename = projection?.kind === 'sequenced' && oldTitles.includes(projection.values.title ?? '')
        }
      }
      if (rename) {
        await ctx.sessionController.rename({ sessionId: entry.sessionId, title })
        await ctx.sessionPersistence.flush()
      }
      await table.put('home', { sessions: { ...state().sessions, [id]: { ...entry, ready: true, roleTitle: title } } })
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
