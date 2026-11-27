import type { DesignFloor, DesignItem, DesignModel, DesignOpening, DesignWall } from './design-model.ts'

export interface PlanPoint { x: number, z: number }
export interface PlanBounds { x: number, z: number, width: number, depth: number }
export interface WallPanel { start: number, end: number, bottom: number, top: number }
const epsilon = 1e-7

export function rectangleCorners(item: Pick<DesignItem, 'x' | 'z' | 'width' | 'depth' | 'rotation'>): PlanPoint[] {
  const angle = item.rotation * Math.PI / 180
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => ({
    x: item.x + x * item.width / 2 * Math.cos(angle) - z * item.depth / 2 * Math.sin(angle),
    z: item.z + x * item.width / 2 * Math.sin(angle) + z * item.depth / 2 * Math.cos(angle),
  }))
}

export function planBounds(floor: DesignFloor | undefined): PlanBounds {
  const points = floor?.walls.flatMap(wall => [{ x: wall.x1, z: wall.z1 }, { x: wall.x2, z: wall.z2 }]) ?? []
  for (const item of floor?.items ?? []) points.push(...rectangleCorners(item))
  if (floor?.reference) {
    const ref = floor.reference
    points.push({ x: ref.x, z: ref.z }, { x: ref.x + ref.width, z: ref.z + ref.depth })
  }
  if (!points.length) return { x: -1, z: -1, width: 12, depth: 10 }
  const minX = Math.min(...points.map(point => point.x)), maxX = Math.max(...points.map(point => point.x))
  const minZ = Math.min(...points.map(point => point.z)), maxZ = Math.max(...points.map(point => point.z))
  return { x: minX - 1, z: minZ - 1, width: Math.max(4, maxX - minX + 2), depth: Math.max(4, maxZ - minZ + 2) }
}

export function projectToWall(wall: DesignWall, point: PlanPoint) {
  const dx = wall.x2 - wall.x1, dz = wall.z2 - wall.z1
  const length = Math.hypot(dx, dz)
  const offset = Math.max(0, Math.min(length, ((point.x - wall.x1) * dx + (point.z - wall.z1) * dz) / length))
  const x = wall.x1 + offset * dx / length, z = wall.z1 + offset * dz / length
  return { offset, distance: Math.hypot(point.x - x, point.z - z), x, z, length }
}

/** Split a wall into solid rectangles, leaving the union of its openings empty. */
export function wallPanels(wall: DesignWall, height: number, openings: readonly DesignOpening[]): WallPanel[] {
  const length = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1)
  const cuts = openings.filter(opening => opening.wallId === wall.id)
  const xs = [...new Set([0, length, ...cuts.flatMap(opening => [opening.offset, opening.offset + opening.width])])].sort((a, b) => a - b)
  const ys = [...new Set([0, height, ...cuts.flatMap(opening => [opening.sill, opening.sill + opening.height])])].sort((a, b) => a - b)
  const panels: WallPanel[] = []
  for (let x = 0; x < xs.length - 1; x++) {
    for (let y = 0; y < ys.length - 1; y++) {
      const start = xs[x], end = xs[x + 1], bottom = ys[y], top = ys[y + 1]
      if (end - start <= epsilon || top - bottom <= epsilon) continue
      const midX = (start + end) / 2, midY = (bottom + top) / 2
      if (midX < 0 || midX > length || midY < 0 || midY > height) continue
      if (cuts.some(opening => midX > opening.offset && midX < opening.offset + opening.width
        && midY > opening.sill && midY < opening.sill + opening.height)) continue
      panels.push({ start, end, bottom, top })
    }
  }
  return panels
}

function side(point: PlanPoint, a: PlanPoint, b: PlanPoint): number {
  return (b.x - a.x) * (point.z - a.z) - (b.z - a.z) * (point.x - a.x)
}
function clipHalfPlane(polygon: PlanPoint[], a: PlanPoint, b: PlanPoint, inside: boolean): PlanPoint[] {
  const result: PlanPoint[] = []
  for (let index = 0; index < polygon.length; index++) {
    const from = polygon[index], to = polygon[(index + 1) % polygon.length]
    const fromSide = side(from, a, b), toSide = side(to, a, b)
    const keepFrom = inside ? fromSide >= -epsilon : fromSide <= epsilon
    const keepTo = inside ? toSide >= -epsilon : toSide <= epsilon
    if (keepFrom) result.push(from)
    if (keepFrom !== keepTo) {
      const ratio = fromSide / (fromSide - toSide)
      result.push({ x: from.x + ratio * (to.x - from.x), z: from.z + ratio * (to.z - from.z) })
    }
  }
  return result.filter((point, index) => {
    const next = result[(index + 1) % result.length]
    return Math.hypot(point.x - next.x, point.z - next.z) > epsilon
  })
}
export function polygonArea(polygon: readonly PlanPoint[]): number {
  return Math.abs(polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length]
    return sum + point.x * next.z - next.x * point.z
  }, 0) / 2)
}

/** Convex subtraction also handles openings touching a room edge and overlapping holes. */
export function subtractRectangle(polygon: PlanPoint[], hole: PlanPoint[]): PlanPoint[][] {
  let remaining = polygon
  const fragments: PlanPoint[][] = []
  for (let index = 0; index < hole.length && remaining.length >= 3; index++) {
    const a = hole[index], b = hole[(index + 1) % hole.length]
    const outside = clipHalfPlane(remaining, a, b, false)
    if (outside.length >= 3 && polygonArea(outside) > epsilon) fragments.push(outside)
    remaining = clipHalfPlane(remaining, a, b, true)
  }
  return fragments
}

export function floorHoles(model: DesignModel, floor: DesignFloor): DesignItem[] {
  return [
    ...floor.items.filter(item => item.kind === 'void'),
    ...model.floors.flatMap(source => source.items.filter(item => item.kind === 'stair'
      && item.targetFloorId === floor.id && source.elevation < floor.elevation)),
  ]
}

export function floorSlabPolygons(model: DesignModel, floor: DesignFloor): { roomId: string, polygon: PlanPoint[] }[] {
  const holes = floorHoles(model, floor).map(rectangleCorners)
  return floor.items.filter(item => item.kind === 'room').flatMap(room => {
    let polygons = [rectangleCorners(room)]
    for (const hole of holes) polygons = polygons.flatMap(polygon => subtractRectangle(polygon, hole))
    return polygons.map(polygon => ({ roomId: room.id, polygon }))
  })
}
