import type { Archive, Decision } from './archive-model'
import { validateArchive } from './archive-model'
import type { ArchiveHostContext, ArchiveTool } from './archive-host'
import { compareDesignModels } from './design-diff'
import type { DesignItem, DesignModel, DesignState } from './design-model'

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('评审参数必须是对象。')
  return value as Record<string, unknown>
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 10000) throw new Error(`${label}无效。`)
  return value.trim()
}
function ids(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !id)) throw new Error('关联编号必须是字符串数组。')
  return [...new Set(value as string[])]
}
function select(state: DesignState, designId: unknown, versionId?: unknown) {
  const design = state.designs.find(item => item.id === (designId ?? state.activeId))
  if (!design) throw new Error('方案不存在。')
  const version = versionId === undefined ? undefined : design.versions.find(item => item.id === versionId)
  if (versionId !== undefined && !version) throw new Error('保存版本不存在。')
  return { design, version, model: version?.model ?? design.model }
}
function metrics(model: DesignModel) {
  return {
    floors: model.floors.length,
    roomArea: model.floors.reduce((sum, floor) => sum + floor.items.filter(item => item.kind === 'room').reduce((n, item) => n + item.width * item.depth, 0), 0),
    wallLength: model.floors.reduce((sum, floor) => sum + floor.walls.reduce((n, wall) => n + Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1), 0), 0),
    furniture: model.floors.reduce((sum, floor) => sum + floor.items.filter(item => item.kind === 'furniture').length, 0),
  }
}
/** Separating-axis test for positive-area overlap; touching edges are not collisions. */
function overlaps(a: DesignItem, b: DesignItem): boolean {
  const angleA = a.rotation * Math.PI / 180, angleB = b.rotation * Math.PI / 180
  const axesA = [[Math.cos(angleA), Math.sin(angleA)], [-Math.sin(angleA), Math.cos(angleA)]]
  const axesB = [[Math.cos(angleB), Math.sin(angleB)], [-Math.sin(angleB), Math.cos(angleB)]]
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1]
  return [...axesA, ...axesB].every(axis => {
    const ra = Math.abs(dot(axesA[0], axis)) * a.width / 2 + Math.abs(dot(axesA[1], axis)) * a.depth / 2
    const rb = Math.abs(dot(axesB[0], axis)) * b.width / 2 + Math.abs(dot(axesB[1], axis)) * b.depth / 2
    return Math.abs(dot([b.x - a.x, b.z - a.z], axis)) < ra + rb - 1e-6
  })
}
export function reviewDesign(state: DesignState, archive: Archive, raw: unknown) {
  const args = object(raw)
  if (Object.keys(args).some(key => !['designId', 'versionId', 'compareDesignId', 'compareVersionId'].includes(key))) throw new Error('未知评审参数。')
  const selected = select(state, args.designId, args.versionId)
  const rooms = selected.model.floors.flatMap(floor => floor.items.filter(item => item.kind === 'room').map(item => ({ floorId: floor.id, ...item })))
  const issues: { kind: string, floorId?: string, objectIds: string[], message: string }[] = []
  for (const room of rooms) if (room.roomId && !archive.rooms.some(item => item.id === room.roomId)) issues.push({ kind: 'unknown-room', floorId: room.floorId, objectIds: [room.id], message: '关联的家庭档案房间已不存在，请重新关联。' })
  for (const floor of selected.model.floors) {
    const furniture = floor.items.filter(item => item.kind === 'furniture')
    for (let i = 0; i < furniture.length; i++) for (let j = i + 1; j < furniture.length; j++) {
      if (overlaps(furniture[i], furniture[j])) issues.push({ kind: 'furniture-overlap', floorId: floor.id, objectIds: [furniture[i].id, furniture[j].id], message: `${furniture[i].name}与${furniture[j].name}的平面占地重叠；核实是否为允许的上下叠放，否则调整位置。` })
    }
    for (const item of floor.items.filter(item => item.kind === 'stair')) {
      const target = selected.model.floors.find(other => other.id === item.targetFloorId)
      if (target && !target.items.some(room => room.kind === 'room' && overlaps(item, room))) issues.push({ kind: 'stair-landing', floorId: floor.id, objectIds: [item.id], message: `通往${target.name}的楼梯占地没有接入该层任何房间楼板，请核实位置与落点。渲染器会自动生成楼梯洞口，现场洞口及净高仍须实测核验。` })
    }
  }
  const needs = archive.needs.map(need => ({ id: need.id, title: need.title, priority: need.priority, quote: need.quote,
    members: archive.members.filter(member => need.memberIds.includes(member.id)).map(({ id, name }) => ({ id, name })),
    rooms: need.roomIds.map(id => ({ id, name: archive.rooms.find(room => room.id === id)?.name, modelObjectIds: rooms.filter(room => room.roomId === id).map(room => room.id) })),
    assessment: '待结合需求内容判断；存在房间关联不代表需求已满足。',
  }))
  const current = metrics(selected.model)
  const comparison = args.compareDesignId !== undefined || args.compareVersionId !== undefined ? select(state, args.compareDesignId ?? selected.design.id, args.compareVersionId) : undefined
  const baseline = comparison ? metrics(comparison.model) : undefined
  const report = {
    revision: state.revision, archiveRevision: archive.revision, designId: selected.design.id, designName: selected.design.name,
    metrics: current, metricsNote: '面积为模型矩形房间占地之和，未扣除重叠及墙体，不是建筑面积；模型数量及长度不证明功能满足或施工合规。',
    needs, measurements: archive.measurements, issues,
    comparison: comparison && baseline ? { designId: comparison.design.id, designName: comparison.design.name, baseline,
      delta: { floors: current.floors - baseline.floors, roomArea: current.roomArea - baseline.roomArea, wallLength: current.wallLength - baseline.wallLength, furniture: current.furniture - baseline.furniture },
      objects: compareDesignModels(comparison.model, selected.model) } : undefined,
    limits: ['未自动验证承重、采光、消防、楼梯净高及通道净宽。', '几何问题为待核验线索，不能直接视为违规。', '请用需求编号、模型对象编号与尺寸来源逐项说明满足、冲突或未知，并给出可测量的下一步。'],
  }
  // Remove absent optional properties at the tool boundary, including nested archive records.
  return JSON.parse(JSON.stringify(report)) as typeof report
}

export async function prepareDesignDecision(state: DesignState, archive: Archive, raw: unknown): Promise<{ next: Archive, decision: Decision, summary: string }> {
  const args = object(raw)
  if (Object.keys(args).some(key => !['expectedRevision', 'expectedDesignRevision', 'designId', 'versionId', 'text', 'reason', 'needIds', 'objectIds', 'attachmentIds', 'supersedesId'].includes(key))) throw new Error('未知决定参数。')
  if (args.expectedRevision !== archive.revision || args.expectedDesignRevision !== state.revision) throw new Error('档案或设计已有更新，请重新读取后提议。')
  const versionId = args.versionId === undefined ? undefined : text(args.versionId, '历史版本编号')
  const selected = select(state, text(args.designId, '方案编号'), versionId)
  const objectIds = ids(args.objectIds ?? [])
  const modelIds = new Set(selected.model.floors.flatMap(floor => [floor.id, ...floor.walls.map(item => item.id), ...floor.openings.map(item => item.id), ...floor.items.map(item => item.id), ...(floor.assets ?? []).map(item => item.id)]))
  if (objectIds.some(id => !modelIds.has(id))) throw new Error('决定关联的模型对象不存在。')
  const source = { designId: selected.design.id, designName: selected.design.name, capturedAt: new Date().toISOString(),
    ...(selected.version ? { versionId: selected.version.id, versionName: selected.version.name } : {}),
    geometrySummary: metrics(selected.model),
    objectIds, modelSha256: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(selected.model))))).map(byte => byte.toString(16).padStart(2, '0')).join('') }
  const needIds = ids(args.needIds ?? [])
  const decision: Decision = { id: crypto.randomUUID(), houseId: archive.houses[0].id,
    text: text(args.text, '决定内容'), reason: `${text(args.reason, '采纳理由')}\n\n设计来源：${JSON.stringify(source)}`,
    needIds, attachmentIds: ids(args.attachmentIds ?? []), ...(args.supersedesId === undefined ? {} : { supersedesId: text(args.supersedesId, '原决定编号') }),
  }
  const next = validateArchive({ ...archive, decisions: [...archive.decisions, decision] })
  return { next, decision, summary: `${decision.text}\n${decision.reason}\n关联需求：${needIds.map(id => `${id} ${archive.needs.find(need => need.id === id)?.title}`).join('；') || '无'}\n替代决定：${decision.supersedesId ?? '无'}` }
}

export function createDesignReviewTools(access: {
  readArchive(): Archive, readDesign(): DesignState,
  saveArchive(next: Archive, signal: AbortSignal): Promise<Archive>, questions: ArchiveHostContext['userQuestions'],
}): ArchiveTool[] {
  const output: ArchiveTool['output'] = { schema: {}, render(_args, value) { return [{ type: 'text', text: JSON.stringify(value) }] } }
  return [{ name: 'ihome_review_design', description: '结合真实家庭需求与户型模型检查关联、家具占地重叠、楼梯与目标楼层的连接，并按命名方案量化比较面积、墙长及物件变化。输出含需求/房间/对象编号和实测来源，供设计师解释，不自动断定需求满足或施工合规。',
    parameters: { type: 'object', additionalProperties: false, properties: { designId: { type: 'string' }, compareDesignId: { type: 'string' } } }, output,
    async execute(args) { return reviewDesign(access.readDesign(), access.readArchive(), args) },
  }, { name: 'ihome_propose_design_decision', description: '主会话确认后保存正式装修决定，关联居住需求和当前命名方案，自动保存采纳时的几何摘要、时间与指纹。先读取设计与档案 revision；只记录用户采纳的具体做法及理由，不会自动创建待办。替代已有决定用 supersedesId 保留历史。',
    parameters: { type: 'object', additionalProperties: false, required: ['expectedRevision', 'expectedDesignRevision', 'designId', 'text', 'reason'], properties: {
      expectedRevision: { type: 'integer', minimum: 0 }, expectedDesignRevision: { type: 'integer', minimum: 0 }, designId: { type: 'string' }, text: { type: 'string' }, reason: { type: 'string' }, supersedesId: { type: 'string' },
      needIds: { type: 'array', items: { type: 'string' } }, objectIds: { type: 'array', items: { type: 'string' } }, attachmentIds: { type: 'array', items: { type: 'string' } },
    } }, output,
    async execute(args, execution) {
      if (!execution.agent) throw new Error('请在主会话确认设计决定。')
      execution.signal.throwIfAborted()
      const change = await prepareDesignDecision(access.readDesign(), access.readArchive(), args)
      const id = 'apply-design-decision'
      const result = await access.questions.ask({ agent: execution.agent, signal: execution.signal, questions: [{ id, header: '装修决定', question: '接受并记录这项装修决定吗？', detail: change.summary, options: [{ label: '接受' }, { label: '不接受' }] }] })
      execution.signal.throwIfAborted()
      const [answer] = result.answers
      if (result.answers.length !== 1 || answer?.id !== id || answer.custom?.trim() || answer.selected.length !== 1 || answer.selected[0] !== '接受') return { status: 'not_applied' }
      // Revalidate both sources after waiting. Archive save also checks revision inside its atomic update.
      await prepareDesignDecision(access.readDesign(), access.readArchive(), args)
      const saved = await access.saveArchive(change.next, execution.signal)
      return { status: 'applied', revision: saved.revision, decisionId: change.decision.id, designId: object(args).designId }
    },
  }]
}
