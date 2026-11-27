import type { DesignFloor, DesignModel, DesignOpening, DesignWall, DesignItem } from './design-model.ts'
import { projectToWall, type PlanPoint } from './design-geometry.ts'

export type DrawingTool = 'select' | 'wall' | 'door' | 'window' | 'room' | 'furniture' | 'stair' | 'void'
export type DesignElement = DesignWall | DesignOpening | DesignItem
export const drawingLabels: Record<DrawingTool, string> = {
  select: '选择', wall: '墙体', door: '门', window: '窗', room: '房间', furniture: '家具', stair: '楼梯', void: '洞口',
}
export function snapPoint(point: PlanPoint): PlanPoint {
  return { x: Math.round(point.x * 10) / 10, z: Math.round(point.z * 10) / 10 }
}
export function findDesignElement(floor: DesignFloor, id: string | null): DesignElement | undefined {
  return [...floor.walls, ...floor.openings, ...floor.items].find(item => item.id === id)
}
export function editFloor(model: DesignModel, floorId: string, update: (floor: DesignFloor) => DesignFloor): DesignModel {
  return { ...model, floors: model.floors.map(floor => floor.id === floorId ? update(floor) : floor) }
}
export function updateDesignElement(model: DesignModel, floorId: string, id: string, patch: Partial<DesignElement>): DesignModel {
  return editFloor(model, floorId, floor => ({ ...floor,
    walls: floor.walls.map(item => item.id === id ? { ...item, ...patch } as DesignWall : item),
    openings: floor.openings.map(item => item.id === id ? { ...item, ...patch } as DesignOpening : item),
    items: floor.items.map(item => item.id === id ? { ...item, ...patch } as DesignItem : item),
  }))
}
export function removeDesignElement(model: DesignModel, floorId: string, id: string): DesignModel {
  return editFloor(model, floorId, floor => ({ ...floor,
    walls: floor.walls.filter(item => item.id !== id),
    openings: floor.openings.filter(item => item.id !== id && item.wallId !== id),
    items: floor.items.filter(item => item.id !== id),
  }))
}
export function moveDesignElement(model: DesignModel, floorId: string, id: string, delta: PlanPoint): DesignModel {
  const floor = model.floors.find(item => item.id === floorId)
  if (!floor) return model
  const item = findDesignElement(floor, id)
  if (!item) return model
  if ('wallId' in item) {
    const wall = floor.walls.find(wall => wall.id === item.wallId)
    if (!wall) return model
    const length = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1)
    const shift = (delta.x * (wall.x2 - wall.x1) + delta.z * (wall.z2 - wall.z1)) / length
    return updateDesignElement(model, floorId, id, { offset: Math.max(0, Math.min(length - item.width, item.offset + shift)) })
  }
  if ('x1' in item) return updateDesignElement(model, floorId, id, {
    x1: item.x1 + delta.x, z1: item.z1 + delta.z, x2: item.x2 + delta.x, z2: item.z2 + delta.z,
  })
  return updateDesignElement(model, floorId, id, { x: item.x + delta.x, z: item.z + delta.z })
}

export function drawDesignElement(model: DesignModel, floorId: string, tool: Exclude<DrawingTool, 'select'>, point: PlanPoint, end?: PlanPoint): { model: DesignModel, id: string } {
  const floor = model.floors.find(item => item.id === floorId)
  if (!floor) throw new Error('请选择楼层。')
  const id = crypto.randomUUID()
  if (tool === 'wall') {
    if (!end || Math.hypot(end.x - point.x, end.z - point.z) < .2) throw new Error('墙体至少长 0.2 米，请选择另一个端点。')
    const wall: DesignWall = { id, name: '墙体', x1: point.x, z1: point.z, x2: end.x, z2: end.z, thickness: .2 }
    return { id, model: editFloor(model, floorId, value => ({ ...value, walls: [...value.walls, wall] })) }
  }
  if (tool === 'door' || tool === 'window') {
    const nearest = floor.walls.map(wall => ({ wall, ...projectToWall(wall, point) })).sort((a, b) => a.distance - b.distance)[0]
    if (!nearest || nearest.distance > .6) throw new Error('请在墙体上放置门窗。')
    const width = tool === 'door' ? .9 : 1.2, height = Math.min(tool === 'door' ? 2.1 : 1.2, floor.height)
    if (nearest.length < width) throw new Error('这面墙不足以容纳门窗，请调整墙体或在属性中修改尺寸。')
    const offset = Math.max(0, Math.min(nearest.length - width, nearest.offset - width / 2))
    const sill = tool === 'door' ? 0 : Math.min(.9, floor.height - height)
    if (floor.openings.some(item => item.wallId === nearest.wall.id && offset < item.offset + item.width && offset + width > item.offset
      && sill < item.sill + item.height && sill + height > item.sill)) throw new Error('此处与已有门窗重叠，请换一个位置。')
    const opening: DesignOpening = { id, name: drawingLabels[tool], wallId: nearest.wall.id, kind: tool, offset, width, sill, height }
    return { id, model: editFloor(model, floorId, value => ({ ...value, openings: [...value.openings, opening] })) }
  }
  const target = model.floors.filter(item => item.elevation > floor.elevation).sort((a, b) => a.elevation - b.elevation)[0]
  if (tool === 'stair' && !target) throw new Error('请先添加上一层，再绘制连接楼梯。')
  const size = { room: [4, 3, floor.height], furniture: [1.8, .8, .75], stair: [1.1, 3.6, target ? target.elevation - floor.elevation : floor.height], void: [1.5, 3.6, .2] }[tool]
  const item: DesignItem = { id, name: drawingLabels[tool], kind: tool, x: point.x, z: point.z,
    width: size[0], depth: size[1], height: size[2], rotation: 0,
    ...(tool === 'stair' && target ? { targetFloorId: target.id } : {}),
  }
  return { id, model: editFloor(model, floorId, value => ({ ...value, items: [...value.items, item] })) }
}
