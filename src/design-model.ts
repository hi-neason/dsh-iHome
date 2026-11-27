import { validateFloorSource } from './design-source.ts'
/** Editable geometry shared by the local host, the two views and project files.
 * Coordinates and dimensions are metres. The plan uses x/z, with elevation on y. */
export interface DesignWall {
  id: string
  name: string
  x1: number
  z1: number
  x2: number
  z2: number
  thickness: number
}

export interface DesignOpening {
  id: string
  name: string
  wallId: string
  kind: 'door' | 'window'
  /** Distance from the wall's first endpoint to the start of the opening. */
  offset: number
  width: number
  sill: number
  height: number
}

export interface DesignItem {
  id: string
  name: string
  kind: 'room' | 'furniture' | 'stair' | 'void'
  /** Centre position on the floor. Rotation is degrees about the vertical axis. */
  x: number
  z: number
  width: number
  depth: number
  height: number
  rotation: number
  targetFloorId?: string
  /** Optional link to the household archive's room. */
  roomId?: string
}

export interface DesignReference {
  assetId: string
  name: string
  /** Top-left position of the calibrated plan image. */
  x: number
  z: number
  width: number
  depth: number
}
export interface DesignAsset {
  id: string
  name: string
  assetId: string
  x: number
  z: number
  y: number
  scale: number
  rotation: number
}

export interface DesignFloor {
  id: string
  name: string
  elevation: number
  height: number
  walls: DesignWall[]
  openings: DesignOpening[]
  items: DesignItem[]
  reference?: DesignReference
  assets?: DesignAsset[]
  /** Self-contained restricted Three.js buildFloor function; replaces primitive geometry. */
  source?: string
}

export interface DesignModel { floors: DesignFloor[] }
export interface DesignVersion { id: string, name: string, model: DesignModel, createdAt: string }
export interface DesignScheme { id: string, name: string, model: DesignModel, versions: DesignVersion[], previousModel?: DesignModel, legacyVersion?: { designId: string, versionId: string } }
export interface DesignState { revision: number, activeId: string, designs: DesignScheme[] }
export interface DesignCommand {
  action: 'replace' | 'create' | 'copy' | 'rename' | 'undo' | 'activate' | 'import'
  expectedRevision: number
  designId?: string
  versionId?: string
  name?: string
  model?: DesignModel
  design?: DesignScheme
}

export class DesignConflict extends Error {}

function record(value: unknown, label: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}格式无效。`)
  const input = value as Record<string, unknown>
  if (Object.keys(input).some(key => !keys.includes(key))) throw new Error(`${label}含不支持的字段，请检查工程版本。`)
  return input
}
function text(value: unknown, label: string, maximum = 160): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new Error(`${label}须为 1–${maximum} 字的文字。`)
  return value
}
function number(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label}须为 ${min} 到 ${max} 之间的数值。`)
  return value
}
function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('设计版本号无效。')
  return value as number
}
function list<T>(value: unknown, label: string, parse: (raw: unknown) => T, maximum = 10000): T[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${label}列表无效或数量超过 ${maximum}。`)
  return value.map(parse)
}
function unique(values: readonly { id: string }[], label: string): void {
  if (new Set(values.map(value => value.id)).size !== values.length) throw new Error(`${label}编号重复。`)
}
function wall(raw: unknown): DesignWall {
  const value = record(raw, '墙体', ['id', 'name', 'x1', 'z1', 'x2', 'z2', 'thickness'])
  const result: DesignWall = {
    id: text(value.id, '墙体编号'), name: text(value.name, '墙体名称'),
    x1: number(value.x1, '墙体坐标', -10000, 10000), z1: number(value.z1, '墙体坐标', -10000, 10000),
    x2: number(value.x2, '墙体坐标', -10000, 10000), z2: number(value.z2, '墙体坐标', -10000, 10000),
    thickness: number(value.thickness, '墙厚', 0.001, 10),
  }
  if (Math.hypot(result.x2 - result.x1, result.z2 - result.z1) < 0.001) throw new Error('墙体长度须大于或等于 1 毫米。')
  return result
}
function opening(raw: unknown): DesignOpening {
  const value = record(raw, '门窗', ['id', 'name', 'wallId', 'kind', 'offset', 'width', 'sill', 'height'])
  if (value.kind !== 'door' && value.kind !== 'window') throw new Error('门窗类型无效。')
  return {
    id: text(value.id, '门窗编号'), name: text(value.name, '门窗名称'), wallId: text(value.wallId, '所属墙体'), kind: value.kind,
    offset: number(value.offset, '门窗起始距离', 0, 20000), width: number(value.width, '门窗宽度', 0.001, 1000),
    sill: number(value.sill, '窗台高度', 0, 100), height: number(value.height, '门窗高度', 0.001, 100),
  }
}
function item(raw: unknown): DesignItem {
  const value = record(raw, '空间构件', ['id', 'name', 'kind', 'x', 'z', 'width', 'depth', 'height', 'rotation', 'targetFloorId', 'roomId'])
  if (!['room', 'furniture', 'stair', 'void'].includes(value.kind as string)) throw new Error('空间构件类型无效。')
  if (value.targetFloorId !== undefined && value.kind !== 'stair') throw new Error('只有楼梯可以关联目标楼层。')
  return {
    id: text(value.id, '构件编号'), name: text(value.name, '构件名称'), kind: value.kind as DesignItem['kind'],
    x: number(value.x, '构件坐标', -10000, 10000), z: number(value.z, '构件坐标', -10000, 10000),
    width: number(value.width, '构件宽度', 0.001, 1000), depth: number(value.depth, '构件深度', 0.001, 1000),
    height: number(value.height, '构件高度', 0, 100), rotation: number(value.rotation, '旋转角度', -360000, 360000),
    ...(value.targetFloorId === undefined ? {} : { targetFloorId: text(value.targetFloorId, '目标楼层') }),
    ...(value.roomId === undefined ? {} : { roomId: text(value.roomId, '档案空间编号') }),
  }
}
function assetId(value: unknown): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) throw new Error('素材编号无效。')
  return value
}
function reference(raw: unknown): DesignReference {
  const value = record(raw, '参考图', ['assetId', 'name', 'x', 'z', 'width', 'depth'])
  return {
    assetId: assetId(value.assetId), name: text(value.name, '参考图名称'),
    x: number(value.x, '参考图坐标', -10000, 10000), z: number(value.z, '参考图坐标', -10000, 10000),
    width: number(value.width, '参考图宽度', 0.001, 1000), depth: number(value.depth, '参考图深度', 0.001, 1000),
  }
}
function asset(raw: unknown): DesignAsset {
  const value = record(raw, '三维素材', ['id', 'name', 'assetId', 'x', 'z', 'y', 'scale', 'rotation'])
  return {
    id: text(value.id, '素材实例编号'), name: text(value.name, '素材名称'), assetId: assetId(value.assetId),
    x: number(value.x, '素材坐标', -10000, 10000), z: number(value.z, '素材坐标', -10000, 10000),
    y: number(value.y, '素材高度', -1000, 1000), scale: number(value.scale, '素材比例', 0.000001, 10000),
    rotation: number(value.rotation, '旋转角度', -360000, 360000),
  }
}
function floor(raw: unknown): DesignFloor {
  const value = record(raw, '楼层', ['id', 'name', 'elevation', 'height', 'walls', 'openings', 'items', 'reference', 'assets', 'source'])
  const result = {
    id: text(value.id, '楼层编号'), name: text(value.name, '楼层名称'),
    elevation: number(value.elevation, '楼层标高', -1000, 1000), height: number(value.height, '层高', 0.1, 100),
    walls: list(value.walls, '墙体', wall), openings: list(value.openings, '门窗', opening), items: list(value.items, '空间构件', item),
    ...(value.reference === undefined ? {} : { reference: reference(value.reference) }),
    ...(value.assets === undefined ? {} : { assets: list(value.assets, '三维素材', asset, 1000) }),
    ...(value.source === undefined ? {} : { source: value.source as string }),
  }
  if (value.source !== undefined) {
    if (typeof value.source !== 'string') throw new Error('楼层源码必须是文字。')
    validateFloorSource(value.source)
    if (result.walls.length || result.openings.length || result.items.length) throw new Error('源码楼层不能同时包含旧墙体、门窗或构件。')
  }
  const walls = new Map(result.walls.map(wall => [wall.id, wall]))
  for (const hole of result.openings) {
    const owner = walls.get(hole.wallId)
    if (!owner) throw new Error(`门窗「${hole.name}」引用了本层不存在的墙体。`)
    if (hole.offset + hole.width > Math.hypot(owner.x2 - owner.x1, owner.z2 - owner.z1) + 1e-7 || hole.sill + hole.height > result.height + 1e-7) {
      throw new Error(`门窗「${hole.name}」超出墙体范围。`)
    }
  }
  return result
}

export function validateDesignModel(raw: unknown): DesignModel {
  const value = record(raw, '户型模型', ['floors'])
  const floors = list(value.floors, '楼层', floor, 100)
  if (!floors.length) throw new Error('户型至少需要一个楼层。')
  unique(floors.flatMap(level => [level, ...level.walls, ...level.openings, ...level.items, ...(level.assets ?? [])]), '户型元素')
  const floorIds = new Set(floors.map(level => level.id))
  for (const level of floors) {
    for (const item of level.items) {
      if (item.targetFloorId !== undefined && (item.targetFloorId === level.id || !floorIds.has(item.targetFloorId))) throw new Error(`楼梯「${item.name}」须关联另一个已有楼层。`)
    }
  }
  return { floors }
}

export function createEmptyModel(): DesignModel {
  return { floors: [{ id: crypto.randomUUID(), name: '一层', elevation: 0, height: 2.8, walls: [], openings: [], items: [] }] }
}
export function createDesignState(): DesignState {
  const id = crypto.randomUUID()
  return { revision: 0, activeId: id, designs: [{ id, name: '方案 1', model: createEmptyModel(), versions: [] }] }
}
function version(raw: unknown): DesignVersion {
  const value = record(raw, '方案版本', ['id', 'name', 'model', 'createdAt'])
  const createdAt = text(value.createdAt, '保存时间')
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(createdAt) || !Number.isFinite(Date.parse(createdAt)) || new Date(createdAt).toISOString() !== createdAt) throw new Error('版本保存时间无效。')
  return { id: text(value.id, '版本编号'), name: text(value.name, '版本名称'), model: validateDesignModel(value.model), createdAt }
}
export function validateDesignScheme(raw: unknown): DesignScheme {
  const value = record(raw, '设计方案', ['id', 'name', 'model', 'versions', 'legacyVersion', 'previousModel'])
  const versions = list(value.versions, '历史版本', version, 1000)
  unique(versions, '历史版本')
  const legacy = value.legacyVersion === undefined ? undefined : record(value.legacyVersion, '旧版来源', ['designId', 'versionId'])
  return { id: text(value.id, '方案编号'), name: text(value.name, '方案名称'), model: validateDesignModel(value.model), versions,
    ...(value.previousModel === undefined ? {} : { previousModel: validateDesignModel(value.previousModel) }),
    ...(legacy ? { legacyVersion: { designId: text(legacy.designId, '原方案编号'), versionId: text(legacy.versionId, '原版本编号') } } : {}) }

}
export function validateDesignState(raw: unknown): DesignState {
  const value = record(raw, '设计档案', ['revision', 'activeId', 'designs'])
  const designs = list(value.designs, '设计方案', validateDesignScheme, Number.MAX_SAFE_INTEGER)
  unique(designs, '设计方案')
  const activeId = text(value.activeId, '当前方案')
  if (!designs.some(item => item.id === activeId)) throw new Error('当前方案不存在。')
  return { revision: revision(value.revision), activeId, designs }
}
/** Read-only startup probe; no model cloning, IDs or allocations per snapshot. */
export function hasUnmigratedDesignVersions(state: DesignState): boolean {
  const migrated = new Map<string, Set<string>>()
  for (const design of state.designs) if (design.legacyVersion) {
    const { designId, versionId } = design.legacyVersion
    let versions = migrated.get(designId)
    if (!versions) migrated.set(designId, versions = new Set())
    versions.add(versionId)
  }
  return state.designs.some(design => design.versions.some(version => !migrated.get(design.id)?.has(version.id)))
}

/** Materialize old snapshots as ordinary independent schemes without destroying
 * their original IDs/models: existing decision references still resolve there.
 * Identity is the source pair, never an array index or a display name. */
export function migrateDesignVersions(raw: DesignState): DesignState {
  const state = validateDesignState(raw)
  const migrated = new Set(state.designs.flatMap(design => design.legacyVersion
    ? [JSON.stringify([design.legacyVersion.designId, design.legacyVersion.versionId])] : []))
  const ids = new Set(state.designs.map(design => design.id))
  const additions: DesignScheme[] = []
  for (const design of state.designs) for (const version of design.versions) {
    const key = JSON.stringify([design.id, version.id])
    if (migrated.has(key)) continue
    let id = crypto.randomUUID()
    while (ids.has(id)) id = crypto.randomUUID()
    ids.add(id); migrated.add(key)
    additions.push({ id, name: `${design.name} · ${version.name}`.slice(0, 160),
      model: structuredClone(version.model), versions: [], legacyVersion: { designId: design.id, versionId: version.id } })
  }
  for (const addition of additions) state.designs.push(addition)
  return state
}

export function parseDesignCommand(raw: unknown): DesignCommand {
  const value = record(raw, '设计操作', ['action', 'expectedRevision', 'designId', 'versionId', 'name', 'model', 'design'])
  if (!['replace', 'create', 'copy', 'rename', 'undo', 'activate', 'import'].includes(value.action as string)) throw new Error('设计操作无效。')
  const action = value.action as DesignCommand['action']
  const designId = value.designId === undefined ? undefined : text(value.designId, '方案编号')
  const versionId = value.versionId === undefined ? undefined : text(value.versionId, '版本编号')
  if (action !== 'create' && action !== 'import' && designId === undefined) throw new Error('请指定要操作的方案编号。')
  if ((action === 'create' || action === 'import') && designId !== undefined) throw new Error('新建方案由系统分配编号。')
  if (versionId !== undefined && action !== 'copy' && action !== 'activate') throw new Error('此操作不支持指定历史版本。')
  if (value.model !== undefined && action !== 'replace' && action !== 'create') throw new Error('此操作不接受新的户型模型。')
  if (action === 'undo' && value.name !== undefined) throw new Error('撤销操作不接受名称。')
  if (action === 'rename' && value.name === undefined) throw new Error('请提供新的方案名称。')
  if (action === 'replace' && value.model === undefined) throw new Error('请提供完整的户型模型。')
  if (action === 'import' && value.design === undefined) throw new Error('请提供要导入的设计方案。')
  if (action !== 'import' && value.design !== undefined) throw new Error('此操作不接受工程导入数据。')
  return {
    action, expectedRevision: revision(value.expectedRevision),
    ...(designId === undefined ? {} : { designId }), ...(versionId === undefined ? {} : { versionId }),
    ...(value.name === undefined ? {} : { name: text(value.name, '名称') }),
    ...(value.model === undefined ? {} : { model: validateDesignModel(value.model) }),
    ...(value.design === undefined ? {} : { design: validateDesignScheme(value.design) }),
  }
}

/** Pure transaction, applied inside the storage domain's serialized update slot. */
export function applyDesignCommand(current: DesignState, raw: unknown): DesignState {
  const command = parseDesignCommand(raw)
  if (command.expectedRevision !== current.revision) throw new DesignConflict('设计已被其他操作更新，请重新载入后再修改。')
  const next = command.versionId !== undefined && hasUnmigratedDesignVersions(current)
    ? migrateDesignVersions(current) : validateDesignState(current)
  const source = next.designs.find(item => item.id === command.designId)
  if (command.action !== 'create' && command.action !== 'import' && !source) throw new Error('指定的设计方案不存在。')
  const savedVersion = command.versionId === undefined ? undefined : source?.versions.find(item => item.id === command.versionId)
  if (command.versionId !== undefined && !savedVersion) throw new Error('指定的历史版本不存在。')
  switch (command.action) {
    case 'import': {
      const id = crypto.randomUUID()
      next.designs.push({ id, name: command.name ?? command.design!.name, model: command.design!.model, versions: command.design!.versions })
      next.activeId = id
      break
    }
    case 'create': {
      const id = crypto.randomUUID()
      next.designs.push({ id, name: command.name ?? `方案 ${next.designs.length + 1}`, model: command.model ?? createEmptyModel(), versions: [] })
      next.activeId = id
      break
    }
    case 'copy': {
      const id = crypto.randomUUID()
      next.designs.push({ id, name: command.name ?? `${source!.name} 副本`.slice(0, 160), model: structuredClone(savedVersion?.model ?? source!.model), versions: [] })
      next.activeId = id
      break
    }
    case 'replace':
      if (JSON.stringify(source!.model) !== JSON.stringify(command.model)) {
        source!.previousModel = structuredClone(source!.model)
        source!.model = command.model!
      }
      if (command.name !== undefined) source!.name = command.name
      break
    case 'undo':
      if (!source!.previousModel) throw new Error('该方案没有可撤销的模型修改。')
      source!.model = structuredClone(source!.previousModel)
      delete source!.previousModel
      break
    case 'rename':
      source!.name = command.name!
      break
    case 'activate':
      next.activeId = source!.id
      if (savedVersion) next.activeId = next.designs.find(design => design.legacyVersion?.designId === source!.id && design.legacyVersion.versionId === savedVersion.id)!.id
      break
  }
  next.revision++
  return command.action === 'import' && command.design!.versions.length
    ? migrateDesignVersions(next) : validateDesignState(next)
}
