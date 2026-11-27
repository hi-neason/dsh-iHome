import type { ArchiveHostContext, ArchiveTool } from './archive-host'
import type { IHomeDesignsService } from './design-host'
import { allowedExpertTools } from './expert-dispatch'
import { applyDesignCommand, DesignConflict, parseDesignCommand, validateDesignModel, type DesignState, type DesignCommand } from './design-model'

function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('设计参数必须是对象。')
  return raw as Record<string, unknown>
}
const fields: Record<string, string[]> = {
  floor: ['name', 'elevation', 'height', 'source'],
  asset: ['name', 'x', 'y', 'z', 'scale', 'rotation'],
  wall: ['name', 'x1', 'z1', 'x2', 'z2', 'thickness'],
  opening: ['name', 'wallId', 'kind', 'offset', 'width', 'sill', 'height'],
  item: ['name', 'kind', 'x', 'z', 'width', 'depth', 'height', 'rotation', 'targetFloorId', 'roomId'],
}
export function prepareDesignProposal(state: DesignState, raw: unknown): { command: DesignCommand, summary: string } {
  const input = object(raw)
  if (Object.keys(input).some(key => !['action', 'expectedRevision', 'designId', 'name', 'model', 'operations', 'description'].includes(key))) throw new Error('未知设计参数。')
  if (input.expectedRevision !== state.revision) throw new DesignConflict('设计已有更新，请重新读取后修改。')
  if (!['create', 'edit', 'copy', 'rename', 'activate', 'undo'].includes(String(input.action))) throw new Error('不支持此设计操作。')
  const source = state.designs.find(design => design.id === (input.designId ?? state.activeId))
  const { operations, description, ...base } = input
  if (description !== undefined && (typeof description !== 'string' || !description.trim() || description.length > 500)) throw new Error('请用 1 至 500 字简述本次设计变化。')
  let command: DesignCommand
  const changes: string[] = []
  if (input.action === 'edit') {
    if (!source || input.model !== undefined || input.versionId !== undefined) throw new Error('局部编辑需要有效方案，不接受完整模型。')
    if (!Array.isArray(operations) || !operations.length || operations.length > 100) throw new Error('请提交 1 至 100 项局部操作。')
    const model = structuredClone(source.model)
    for (const rawOperation of operations) {
      const op = object(rawOperation)
      if (Object.keys(op).some(key => !['entity', 'action', 'floorId', 'id', 'value'].includes(key))) throw new Error('未知局部操作参数。')
      const entity = String(op.entity)
      if (!Object.hasOwn(fields, entity) || !['upsert', 'remove'].includes(String(op.action)) || typeof op.id !== 'string' || !op.id) throw new Error('局部操作类型或编号无效。')
      const floor = model.floors.find(item => item.id === op.floorId)
      if (entity !== 'floor' && !floor) throw new Error('目标楼层不存在。')
      if (entity !== 'floor' && entity !== 'asset' && floor?.source) throw new Error('该楼层使用 Three.js 源码，请修改楼层 source，不能修改已被替代的结构化几何。')
      const records = (entity === 'floor' ? model.floors : entity === 'wall' ? floor!.walls : entity === 'opening' ? floor!.openings : entity === 'asset' ? (floor!.assets ?? []) : floor!.items) as unknown as Record<string, unknown>[]
      const index = records.findIndex(item => item.id === op.id)
      const before = index < 0 ? undefined : records[index]
      if (entity === 'asset' && !before) throw new Error('只能编辑或移除已有导入素材实例，不能创建或替换素材引用。')
      if (op.action === 'remove') {
        if (!before || op.value !== undefined) throw new Error('删除目标不存在或参数无效。')
        records.splice(index, 1)
        changes.push(entity === 'floor' && before.source ? `删除楼层「${before.name}」（${op.id}）及其模型。` : `删除 ${entity} ${op.id}：${JSON.stringify(before)}`)
      } else {
        const value = object(op.value)
        if (Object.keys(value).some(key => !fields[entity].includes(key))) throw new Error('局部字段无效；编号不可修改，附件由工作台管理。')
        const next: Record<string, unknown> = { ...(before ?? (entity === 'floor' ? { walls: [], openings: [], items: [] } : {})), ...value, ...(entity === 'floor' && Object.hasOwn(value, 'source') ? { walls: [], openings: [], items: [] } : {}), id: op.id }
        if (index < 0) records.push(next)
        else records[index] = next
        if (entity === 'floor' && (Object.hasOwn(value, 'source') || before?.source)) {
          const details = [`${before ? '修改' : '新增'}楼层「${next.name}」（${op.id}）`]
          if (Object.hasOwn(value, 'source')) {
            details.push(before?.source ? '更新本层空间模型' : '生成本层空间模型')
            const counts = ['walls', 'openings', 'items'].map(key => Array.isArray(before?.[key]) ? before![key].length : 0)
            if (counts.some(count => count > 0)) details.push(`将替换本层原有 ${counts[0]} 面墙、${counts[1]} 处门窗及 ${counts[2]} 个空间/物件`)
          }
          if (Object.hasOwn(value, 'name') && before) details.push(`名称：${before.name} → ${next.name}`)
          if (Object.hasOwn(value, 'elevation')) details.push(`标高：${before?.elevation ?? '未设置'} → ${next.elevation} 米`)
          if (Object.hasOwn(value, 'height')) details.push(`层高：${before?.height ?? '未设置'} → ${next.height} 米`)
          changes.push(details.join('；') + '。')
        } else changes.push(`${before ? '修改' : '新增'} ${entity} ${op.id}：${JSON.stringify(before ?? null)} → ${JSON.stringify(next)}`)
      }
    }
    command = parseDesignCommand({ ...base, action: 'replace', designId: source.id, model: validateDesignModel(model) })
  } else {
    if (operations !== undefined) throw new Error('仅局部编辑接受 operations。')
    command = parseDesignCommand({ ...base, ...(input.action === 'create' ? {} : { designId: source?.id }) })
    if (command.action !== 'create') changes.push(JSON.stringify(command, null, 2))
  }
  const result = applyDesignCommand(state, command)
  if (command.action === 'create') {
    for (const floor of result.designs.find(design => design.id === result.activeId)!.model.floors) {
      changes.push(`新增楼层「${floor.name}」（${floor.id}）：标高 ${floor.elevation} 米，层高 ${floor.height} 米；${floor.source ? '生成空间模型' : `${floor.walls.length} 面墙、${floor.openings.length} 处门窗、${floor.items.length} 个空间/物件`}。`)
    }
  }
  const title = command.action === 'create' || command.action === 'copy' ? result.designs.find(design => design.id === result.activeId)!.name : source?.name ?? '当前方案'
  const labels: Record<string, string> = { create: '新建方案', edit: '修改方案', copy: '复制方案', rename: '重命名方案', activate: '切换方案', undo: '撤销上次模型修改' }
  return { command, summary: `方案：${title}\n操作：${labels[String(input.action)]}\n${description ? `设计说明：${description}\n` : ''}${changes.join('\n')}` }
}

export interface DesignToolsContext extends Pick<ArchiveHostContext, 'tools' | 'userQuestions' | 'effect'> {
  ihomeDesigns: IHomeDesignsService
}
export async function mountDesignTools(ctx: DesignToolsContext): Promise<void> {
  await ctx.effect(async () => {
    const output: ArchiveTool['output'] = { schema: {}, render(_args, value) { return [{ type: 'text', text: JSON.stringify(value) }] } }
    const register = (tool: ArchiveTool) => ctx.tools.register({ ...tool, async execute(args, execution) {
      execution.signal.throwIfAborted()
      if (!allowedExpertTools(execution).has(tool.name)) throw new Error('当前上下文不能使用此设计工具。')
      return tool.execute(args, execution)
    } }, { when: context => allowedExpertTools(context).has(tool.name) })
    const disposers = [register({ name: 'ihome_read_design', description: '读取本机户型设计目录、当前 revision 和所选模型。默认当前方案；可指定 designId。返回各层当前 source 以供修改。源码自包含导出 buildFloor(THREE)，单位米、局部地面 y=0，标高由渲染器应用。',
      parameters: { type: 'object', additionalProperties: false, properties: { designId: { type: 'string' } } }, output,
      async execute(raw) {
        const args = object(raw), state = ctx.ihomeDesigns.read()
        if (Object.keys(args).some(key => !['designId', 'versionId'].includes(key))) throw new Error('未知读取参数。')
        const selected = state.designs.find(item => item.id === (args.designId ?? state.activeId))
        if (!selected) throw new Error('方案不存在。')
        const version = args.versionId === undefined ? undefined : selected.versions.find(item => item.id === args.versionId)
        if (args.versionId !== undefined && !version) throw new Error('版本不存在。')
        // Native DSH tool outputs must be lossless JSON, including optional nested geometry fields.
        return JSON.parse(JSON.stringify({ revision: state.revision, activeId: state.activeId, designs: state.designs.map(item => ({ id: item.id, name: item.name })), designId: selected.id, name: selected.name, model: version?.model ?? selected.model }))
      },
    }), register({ name: 'ihome_propose_design', description: '主会话提出设计操作，用户在对话接受后直接写入本机。先读最新 revision。create 可带完整 model；edit 接受局部 operations；floor upsert 的 value.source 替换该层旧墙/门窗/items，保留其他楼层、底图和素材；仅修改 elevation 不重画源码。已有导入素材用 asset upsert 调整 name/x/y/z/scale/rotation，或 remove 移除实例；不能创建实例或改 assetId。copy 复制为独立命名方案；rename 修改方案名称；activate 切换方案；undo 撤销该方案上一次模型编辑。字段详见 ihome-floorplan-modeling 技能。',
      parameters: { type: 'object', additionalProperties: false, required: ['action', 'expectedRevision'], properties: {
        action: { type: 'string', enum: ['create', 'edit', 'copy', 'rename', 'activate', 'undo'] }, expectedRevision: { type: 'integer', minimum: 0 }, designId: { type: 'string' }, name: { type: 'string' }, description: { type: 'string', maxLength: 500, description: '用业主能理解的话简述具体变化和估算依据，不贴源码。' }, model: { type: 'object' }, operations: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', additionalProperties: false, required: ['entity', 'action', 'id'], properties: { entity: { type: 'string', enum: ['floor', 'wall', 'opening', 'item', 'asset'] }, action: { type: 'string', enum: ['upsert', 'remove'] }, id: { type: 'string' }, floorId: { type: 'string' }, value: { type: 'object' } } } },
      } }, output,
      async execute(args, execution) {
        if (!execution.agent) throw new Error('请在主会话修改设计。')
        try {
          const proposal = prepareDesignProposal(ctx.ihomeDesigns.read(), args)
          const id = 'apply-design-change'
          const result = await ctx.userQuestions.ask({ agent: execution.agent, signal: execution.signal, questions: [{ id, header: '户型设计', question: '接受这项设计修改并保存吗？', detail: proposal.summary, options: [{ label: '接受' }, { label: '不接受' }] }] })
          execution.signal.throwIfAborted()
          const [answer] = result.answers
          if (result.answers.length !== 1 || answer?.id !== id || answer.custom?.trim() || answer.selected.length !== 1 || answer.selected[0] !== '接受') return { status: 'not_applied', message: '设计未修改。' }
          const saved = await ctx.ihomeDesigns.change(proposal.command, execution.signal)
          return { status: 'applied', revision: saved.revision, activeId: saved.activeId }
        } catch (error) {
          if (error instanceof DesignConflict) return { status: 'conflict', message: error.message }
          throw error
        }
      },
    })]
    return async () => { for (const dispose of disposers.reverse()) await dispose() }
  })
}
