import { createDesignReviewTools } from './design-review'
import type { IHomeDesignsService } from './design-host'
import { allowedExpertTools } from './expert-dispatch'
import { prepareArchiveChange, createArchive, validateArchive, assertCurrentHouse, attachmentStage, documentStages } from './archive-model'
import type { Archive, ArchiveFile } from './archive-model'
import { isIHomeToolContext, type IHomeToolContext } from './ihome-workspace-path'
import { createRecordProposalTool } from './archive-record-tool'

/** The subset of the DSH 0.2.2-rc.5 host services used by this plugin. */
export interface ArchiveHostContext {
  ihomeDesigns: IHomeDesignsService
  storageDomain: {
    open(spec: {
      name: string
      version: number
      tables: { archives: { valueSchema: { parse(value: unknown): Archive } } }
    }): Promise<ArchiveDomain>
  }
  attachments: {
    saveFile(input: { data: Uint8Array, name?: string }): Promise<ArchiveFile>
    readFileStream(file: ArchiveFile, signal?: AbortSignal): AsyncIterable<Uint8Array>
  }
  connection: {
    fetch: {
      register(route: {
        path: string
        methods: string[]
        requestBody: 'buffered'
        fetch(request: Request): Promise<Response>
      }): () => void | Promise<void>
    }
  }
  tools: { register(tool: ArchiveTool, options: { when(context: IHomeToolContext): boolean }): () => void | Promise<void> }
  userQuestions: {
    ask(request: {
      agent: NonNullable<IHomeToolContext['agent']>
      signal: AbortSignal
      questions: { id: string, header: string, question: string, detail: string, options: { label: string }[] }[]
    }): Promise<{ answers: { id: string, selected: string[], custom?: string }[] }>
  }
  effect(setup: () => Promise<() => Promise<void>>): Promise<unknown>
}

export interface ArchiveTable {
  get(key: string): Archive | undefined
  put(key: string, value: Archive): Promise<void>
  update(key: string, transform: (current: Archive) => Archive): Promise<Archive>
}
interface ArchiveDomain {
  table(name: 'archives'): ArchiveTable
  close(): Promise<void>
}
export interface ArchiveTool {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: { schema: Record<string, unknown>, render(args: unknown, value: unknown): { type: 'text', text: string }[] }
  execute(args: unknown, execution: IHomeToolContext & { signal: AbortSignal }): Promise<unknown>
}

const jsonHeaders = { 'cache-control': 'no-store', 'content-type': 'application/json' }

class ArchiveConflict extends Error {}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: jsonHeaders })
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求内容无效。')
  return value as Record<string, unknown>
}

/** Atomically checks the caller revision inside DSH's serialized update slot. */
export function saveArchive(table: ArchiveTable, raw: unknown, signal?: AbortSignal): Promise<Archive> {
  const next = validateArchive(raw)
  return table.update('home', current => {
    signal?.throwIfAborted()
    if (current.revision !== next.revision) {
      throw new ArchiveConflict('档案已有新修改，请先重新载入，再保存本次编辑。')
    }
    return validateArchive({ ...next, revision: current.revision + 1 })
  })
}

function toolOutput() {
  return {
    schema: {},
    render(_args: unknown, value: unknown): { type: 'text', text: string }[] {
      return [{ type: 'text', text: JSON.stringify(value) }]
    },
  }
}

export async function mountArchive(ctx: ArchiveHostContext): Promise<void> {
  await ctx.effect(async () => {
    // DSH's domain boundary calls valueSchema.parse on load. Keep validation
    // shared with the client and validate again before every durable mutation.
    const domain = await ctx.storageDomain.open({
      name: 'ihome_archive', version: 1,
      tables: { archives: { valueSchema: { parse: validateArchive } } },
    })
    const disposers: (() => void | Promise<void>)[] = []
    try {
      const table = domain.table('archives')
      if (!table.get('home')) await table.put('home', validateArchive(createArchive()))
      const read = () => {
        const archive = table.get('home')
        if (!archive) throw new Error('家庭档案尚未初始化。')
        return archive
      }
      // Wait in the calling conversation, outside the storage transaction.
      async function confirmChange(kind: 'need' | 'record', args: unknown, execution: Parameters<ArchiveTool['execute']>[1]) {
        const { agent, signal } = execution
        if (!agent) throw new Error('请在当前 iHome 对话中修改档案。')
        const change = prepareArchiveChange(read(), kind, args)
        if (!change.changed) return { status: 'unchanged', revision: change.next.revision, message: '这项内容已在档案中。' }
        const questionId = 'apply-archive-change'
        const result = await ctx.userQuestions.ask({
          agent, signal, questions: [{
            id: questionId, header: '家庭档案', question: '接受这项修改并保存到家庭档案吗？',
            detail: change.summary, options: [{ label: '接受' }, { label: '不接受' }],
          }],
        })
        signal.throwIfAborted()
        const [answer] = result.answers
        if (result.answers.length !== 1 || answer.id !== questionId || answer.custom?.trim()
          || answer.selected.length !== 1 || answer.selected[0] !== '接受') {
          return { status: 'not_applied', message: '本次修改未入档。', feedback: answer?.custom }
        }
        try {
          const archive = await saveArchive(table, change.next, signal)
          return { status: 'applied', revision: archive.revision, message: '已按本次对话中接受的内容更新家庭档案。' }
        } catch (error) {
          if (error instanceof ArchiveConflict) return { status: 'conflict', message: '确认期间档案已有更新。请读取最新记录并在对话中重新确认修改。' }
          throw error
        }
      }
      // Visibility and execution both use trusted host session metadata.
      const registerTool = (tool: ArchiveTool) => ctx.tools.register({
        ...tool,
        async execute(args, execution) {
          execution.signal.throwIfAborted()
          if (!isIHomeToolContext(execution)) throw new Error('iHome 工具仅在 iHome工作区内可用。')
          if (!allowedExpertTools(execution).has(tool.name)) throw new Error('当前专家没有使用这个工具的权限。')
          return tool.execute(args, execution)
        },
      }, { when: context => allowedExpertTools(context).has(tool.name) })
      for (const tool of createDesignReviewTools({ readArchive: read, readDesign: () => ctx.ihomeDesigns.read(),
        saveArchive: (next, signal) => saveArchive(table, next, signal), questions: ctx.userQuestions })) disposers.push(registerTool(tool))
      const route = (handler: (request: Request) => Promise<Response>) => async (request: Request) => {
        try {
          request.signal.throwIfAborted()
          return await handler(request)
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : '操作失败，请重试。' }, error instanceof ArchiveConflict ? 409 : 400)
        }
      }
      disposers.push(ctx.connection.fetch.register({
        path: '/api/ihome/archive', methods: ['GET', 'POST'], requestBody: 'buffered',
        fetch: route(async request => {
          if (request.method === 'GET') return json(read())
          const raw: unknown = await request.json()
          request.signal.throwIfAborted()
          return json(await saveArchive(table, raw, request.signal))
        }),
      }))
      disposers.push(ctx.connection.fetch.register({
        path: '/api/ihome/file', methods: ['GET', 'POST'], requestBody: 'buffered',
        fetch: route(async request => {
          const url = new URL(request.url)
          if (request.method === 'POST') {
            const data = new Uint8Array(await request.arrayBuffer())
            request.signal.throwIfAborted()
            return json(await ctx.attachments.saveFile({ data, name: url.searchParams.get('name') ?? '附件' }))
          }
          const attachment = read().attachments.find(item => item.id === url.searchParams.get('id'))
          if (!attachment) return json({ error: '此附件未在家庭档案中找到。' }, 404)
          const chunks: Uint8Array<ArrayBuffer>[] = []
          for await (const chunk of ctx.attachments.readFileStream(attachment.file, request.signal)) {
            chunks.push(new Uint8Array(chunk))
          }
          return new Response(new Blob(chunks), { headers: {
            'content-type': 'application/octet-stream', 'cache-control': 'no-store',
            'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(attachment.file.name)}`,
            'x-content-type-options': 'nosniff',
          } })
        }),
      }))
      disposers.push(registerTool({
        name: 'ihome_propose_need',
        description: '根据用户明确讲述的情况新增或修改居住需求。每条需求至少关联一位家人和一个房间或区域，保留用户原话，缺少信息先追问。houseId 默认为当前房屋。修改已有需求须提供其 id 和 version。此工具在当前对话展示修改内容，等用户选择接受后直接保存，返回写入结果。',
        parameters: {
          type: 'object', additionalProperties: false,
          properties: {
            houseId: { type: 'string' }, title: { type: 'string' },
            people: { type: 'array', minItems: 1, items: { type: 'string' } },
            rooms: { type: 'array', minItems: 1, items: { type: 'string' }, description: '直接填写用户提到的房间或区域名称，例如「书房」「阅读区」。每个名称都是独立的一项。' },
            priority: { type: 'string', enum: ['must', 'prefer', 'discuss'] },
            quote: { type: 'string' }, targetNeedId: { type: 'string' }, targetVersion: { type: 'integer' },
          },
          required: ['title', 'people', 'rooms', 'priority', 'quote'],
        },
        output: toolOutput(),
        execute: (args, execution) => confirmChange('need', args, execution),
      }))
      disposers.push(registerTool(createRecordProposalTool((args, execution) => confirmChange('record', args, execution))))
      disposers.push(registerTool({
        name: 'ihome_read_archive',
        description: '根据本轮话题按需读取家庭档案。houseId 可省略，默认为当前房屋。仅传 houseId 或空参数时返回房间或区域的编号和名称。用 roomId 读取该处的需求、关联家人及尺寸记录（含 id 和是否采信）。明确需要生活习惯时提供 factQuery（具体话题关键词）或已知 factId，两者任选一个。查找归档文件时提供 documentQuery（名称、来源或备注关键词）、documentStage 或 documentKind，可组合筛选。文件查询仅返回归档信息，阅读正文需要原件。',
        parameters: {
          type: 'object', additionalProperties: false,
          properties: { houseId: { type: 'string' }, roomId: { type: 'string' },
            factQuery: { type: 'string', description: '本轮讨论的具体生活话题关键词，如做饭、早起。仅返回包含该关键词的生活事实。' },
            factId: { type: 'string', description: '需要核对的已知生活事实编号。' },
            documentQuery: { type: 'string', description: '资料名称、来源或备注中的关键词。' },
            documentStage: { type: 'string', enum: documentStages.map(stage => stage.id) },
            documentKind: { type: 'string', enum: ['document', 'material'] } }, required: [],
        },
        output: toolOutput(),
        async execute(args, execution) {
          execution.signal.throwIfAborted()
          return archiveContext(read(), object(args))
        },
      }))
      return async () => {
        for (const dispose of disposers.reverse()) await dispose()
        await domain.close()
      }
    } catch (error) {
      for (const dispose of disposers.reverse()) await dispose()
      await domain.close()
      throw error
    }
  })
}

function archiveContext(archive: Archive, input: Record<string, unknown>): unknown {
  if (input.houseId !== undefined) assertCurrentHouse(archive, String(input.houseId))
  const house = archive.houses[0]
  if (!house) throw new Error('请使用当前家庭档案提供的房屋编号。')
  const rooms = archive.rooms.filter(room => room.houseId === house.id && (input.roomId === undefined || room.id === input.roomId))
  if (input.roomId !== undefined && rooms.length === 0) throw new Error('该房屋中未找到指定的房间或区域。')
  if (input.factQuery !== undefined && input.factId !== undefined) throw new Error('请选择生活话题关键词或事实编号之一。')
  if (input.factQuery !== undefined && (typeof input.factQuery !== 'string' || !input.factQuery.trim())) throw new Error('请提供具体的生活话题关键词。')
  if (input.factId !== undefined && (typeof input.factId !== 'string' || !input.factId.trim())) throw new Error('生活事实编号无效。')
  const factQuery = typeof input.factQuery === 'string' ? input.factQuery.trim().toLocaleLowerCase() : undefined
  const wantsFacts = input.factQuery !== undefined || input.factId !== undefined
  const facts = archive.facts.filter(fact => factQuery !== undefined
    ? fact.text.toLocaleLowerCase().includes(factQuery) : input.factId !== undefined && fact.id === input.factId)
  if (input.factId !== undefined && facts.length === 0) throw new Error('未找到指定生活事实。')
  const wantsDocuments = input.documentQuery !== undefined || input.documentStage !== undefined || input.documentKind !== undefined
  if (input.documentQuery !== undefined && (typeof input.documentQuery !== 'string' || !input.documentQuery.trim())) throw new Error('请提供具体的资料关键词。')
  if (input.documentStage !== undefined && !documentStages.some(stage => stage.id === input.documentStage)) throw new Error('资料阶段无效。')
  if (input.documentKind !== undefined && input.documentKind !== 'document' && input.documentKind !== 'material') throw new Error('资料类型无效。')
  const query = typeof input.documentQuery === 'string' ? input.documentQuery.trim().toLocaleLowerCase() : ''
  const documents = wantsDocuments ? archive.attachments.filter(item => item.houseId === house.id &&
    (input.roomId === undefined || item.roomIds.length === 0 || item.roomIds.includes(String(input.roomId))) &&
    (input.documentStage === undefined || attachmentStage(item) === input.documentStage) &&
    (input.documentKind === undefined || (item.kind ?? 'document') === input.documentKind) &&
    [item.name, item.source, item.notes].join(' ').toLocaleLowerCase().includes(query))
    .map(item => ({ id: item.id, name: item.name, stage: attachmentStage(item), kind: item.kind ?? 'document',
      roomIds: item.roomIds, date: item.date, source: item.source, notes: item.notes, originalName: item.file.name, bytes: item.file.bytes })) : []
  const documentResult = wantsDocuments ? { documents, documentContent: '仅包含归档信息，未读取文件正文。' } : {}
  const memberIds = new Set(facts.flatMap(fact => fact.memberIds))
  if (input.roomId === undefined) {
    if (!wantsFacts) return wantsDocuments ? { revision: archive.revision, ...documentResult } : { rooms: rooms.map(({ id, name }) => ({ id, name })) }
    return { ...documentResult, facts, members: archive.members.filter(member => memberIds.has(member.id)).map(({ id, name }) => ({ id, name })) }
  }
  const roomId = rooms[0].id
  const needs = archive.needs.filter(need => need.houseId === house.id && need.roomIds.includes(roomId))
  for (const need of needs) for (const id of need.memberIds) memberIds.add(id)
  return {
    revision: archive.revision, house, rooms, ...documentResult,
    members: archive.members.filter(member => memberIds.has(member.id)).map(({ id, name }) => ({ id, name })),
    needs: needs.map(({ id, title, memberIds, roomIds, priority, version }) => ({ id, title, memberIds, roomIds, priority, version })),
    ...(wantsFacts ? { facts } : {}),
    measurements: archive.measurements.filter(item => item.roomId === roomId)
      .map(({ id, roomId, label, value, unit, source, date, adopted }) => ({ id, roomId, label, value, unit, source, date, adopted })),
  }
}
