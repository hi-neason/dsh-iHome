import assert from 'node:assert/strict'
import test from 'node:test'
import { createEmptyModel, validateDesignModel } from '../src/design-model.ts'
import { drawDesignElement, moveDesignElement, removeDesignElement, snapPoint } from '../src/design-edit.ts'

test('drawing and moving a wall preserves attached openings and deleting it removes them', () => {
  const original = createEmptyModel(), floorId = original.floors[0].id
  const wall = drawDesignElement(original, floorId, 'wall', { x: 0, z: 0 }, { x: 5, z: 0 })
  const door = drawDesignElement(wall.model, floorId, 'door', { x: 2, z: .1 })
  assert.equal(original.floors[0].walls.length, 0)
  assert.equal(door.model.floors[0].openings[0].wallId, wall.id)
  const moved = moveDesignElement(door.model, floorId, wall.id, { x: 1, z: 2 })
  assert.equal(moved.floors[0].walls[0].x1, 1)
  assert.deepEqual(moved.floors[0].openings, door.model.floors[0].openings)
  const clamped = moveDesignElement(moved, floorId, door.id, { x: 50, z: 0 })
  assert.equal(clamped.floors[0].openings[0].offset, 4.1)
  validateDesignModel(clamped)
  assert.equal(removeDesignElement(clamped, floorId, wall.id).floors[0].openings.length, 0)
})

test('door placement rejects missing walls and overlapping openings; coordinates snap to decimetres', () => {
  const m = createEmptyModel(), id = m.floors[0].id
  assert.deepEqual(snapPoint({ x: 1.26, z: -2.24 }), { x: 1.3, z: -2.2 })
  assert.throws(() => drawDesignElement(m, id, 'door', { x: 0, z: 0 }), /墙体/)
  const wall = drawDesignElement(m, id, 'wall', { x: 0, z: 0 }, { x: 5, z: 0 })
  const door = drawDesignElement(wall.model, id, 'door', { x: 2, z: 0 })
  assert.throws(() => drawDesignElement(door.model, id, 'door', { x: 2, z: 0 }), /重叠/)
})

test('stairs choose the next higher elevation, including basements', () => {
  const m = createEmptyModel(), id = m.floors[0].id
  assert.throws(() => drawDesignElement(m, id, 'stair', { x: 0, z: 0 }), /上一层/)
  m.floors.push({ id: 'upper', name: '二层', elevation: 3, height: 3, walls: [], openings: [], items: [] })
  m.floors.push({ id: 'basement', name: '地下室', elevation: -3, height: 3, walls: [], openings: [], items: [] })
  const result = drawDesignElement(m, 'basement', 'stair', { x: 0, z: 0 })
  assert.equal(result.model.floors[2].items[0].targetFloorId, id)
  validateDesignModel(result.model)
})
