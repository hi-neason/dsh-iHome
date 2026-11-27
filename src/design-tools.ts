import type { ArchiveHostContext, ArchiveTool } from './archive-host'
import type { IHomeDesignsService } from './design-host'
import { allowedExpertTools } from './expert-dispatch'
import { applyDesignCommand, DesignConflict, parseDesignCommand, validateDesignModel, type DesignState, type DesignCommand } from './design-model'

function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('设计参数必须是对象。')
  return raw as Record<string, unknown>
}
const fields: Record<string, string[]> = {
  floor: ['name', 'elevation', 'height'],
  wall: ['name', 'x1', 'z1', 'x2', 'z2', 'thickness'],
  opening: ['name', 'wallId', 'kind', 'offset', 'width', 'sill', 'height'],
  item: ['name', 'kind', 'x', 'z', 'width', 'depth', 'height', 'rotation', 'targetFloorId', 'roomId'],
}
export function prepareDesignProposal(state: DesignState, raw: unknown): { command: DesignCommand, summary: string } {
  const input = object(raw)
  if (Object.keys(input).some(key => !['action', 'expectedRevision', 'designId', 'name', 'model', 'operations'].includes(key))) throw new Error('未知设计参数。')
  if (input.expectedRevision !== state.revision) throw new DesignConflict('设计已有更新，请重新读取后修改。')
  if (!['create', 'edit', 'copy', 'rename', 'activate'].includes(String(input.action))) throw new Error('不支持此设计操作。')
  const source = state.designs.find(design => design.id === (input.designId ?? state.activeId))
  const { operations, ...base } = input
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
      const records = (entity === 'floor' ? model.floors : entity === 'wall' ? floor!.walls : entity === 'opening' ? floor!.openings : floor!.items) as unknown as Record<string, unknown>[]
      const index = records.findIndex(item => item.id === op.id)
      const before = index < 0 ? undefined : records[index]
      if (op.action === 'remove') {
        if (!before || op.value !== undefined) throw new Error('删除目标不存在或参数无效。')
        records.splice(index, 1)
        changes.push(`删除 ${entity} ${op.id}：${JSON.stringify(before)}`)
      } else {
        const value = object(op.value)
        if (Object.keys(value).some(key => !fields[entity].includes(key))) throw new Error('局部字段无效；编号不可修改，附件由工作台管理。')
        const next = { ...(before ?? (entity === 'floor' ? { walls: [], openings: [], items: [] } : {})), ...value, id: op.id }
        if (index < 0) records.push(next)
        else records[index] = next
        changes.push(`${before ? '修改' : '新增'} ${entity} ${op.id}：${JSON.stringify(before ?? null)} → ${JSON.stringify(next)}`)
      }
    }
    command = parseDesignCommand({ ...base, action: 'replace', designId: source.id, model: validateDesignModel(model) })
  } else {
    if (operations !== undefined) throw new Error('仅局部编辑接受 operations。')
    command = parseDesignCommand({ ...base, ...(input.action === 'create' ? {} : { designId: source?.id }) })
    changes.push(JSON.stringify(command, null, 2))
  }
  applyDesignCommand(state, command)
  return { command, summary: `方案：${source?.name ?? '新方案'}\n操作：${input.action}\n${changes.join('\n')}` }
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
    const disposers = [register({ name: 'ihome_read_design', description: '读取本机户型设计目录、当前 revision 和所选模型。默认当前方案；可指定 designId。坐标和尺寸单位米，x/z 为物体中心，旋转单位度。',
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
    }), register({ name: 'ihome_propose_design', description: '主会话提出设计操作，用户在对话接受后直接写入本机。先读最新 revision。create 可带完整 model；edit 只接受局部 operations 并保留未修改对象及附件。copy 复制为独立命名方案；rename 修改方案名称；activate 切换方案。字段详见 ihome-floorplan-modeling 技能。',
      parameters: { type: 'object', additionalProperties: false, required: ['action', 'expectedRevision'], properties: {
        action: { type: 'string', enum: ['create', 'edit', 'copy', 'rename', 'activate'] }, expectedRevision: { type: 'integer', minimum: 0 }, designId: { type: 'string' }, name: { type: 'string' }, model: { type: 'object' }, operations: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', additionalProperties: false, required: ['entity', 'action', 'id'], properties: { entity: { type: 'string', enum: ['floor', 'wall', 'opening', 'item'] }, action: { type: 'string', enum: ['upsert', 'remove'] }, id: { type: 'string' }, floorId: { type: 'string' }, value: { type: 'object' } } } },
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
