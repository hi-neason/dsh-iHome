import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { wallPanels, rectangleCorners, subtractRectangle, polygonArea, floorSlabPolygons } from '../src/design-geometry.ts'
import { buildDesignGroup, disposeDesignGroup } from '../src/design-scene.ts'
const room = { id: 'room', name: '房间', kind: 'room', x: 0, z: 0, width: 10, depth: 10, height: 3, rotation: 0 }
const floor = (id, elevation) => ({ id, name: id, elevation, height: 3, walls: [], openings: [], items: [{ ...room, id: id + '-room' }] })
const total = polygons => polygons.reduce((sum, p) => sum + polygonArea(p), 0)

test('wall geometry leaves full-height doors and raised windows empty', () => {
  const wall = { id: 'wall', x1: 0, z1: 0, x2: 5, z2: 0 }
  const panels = wallPanels(wall, 3, [
    { wallId: 'wall', offset: 1, width: 1, sill: 0, height: 2 },
    { wallId: 'wall', offset: 3, width: 1, sill: 1, height: 1 },
  ])
  assert.equal(panels.reduce((sum, p) => sum + (p.end - p.start) * (p.top - p.bottom), 0), 12)
  assert.ok(!panels.some(p => p.start < 2 && p.end > 1 && p.bottom < 2))
})

test('rotated, edge touching and overlapping floor holes preserve exact area', () => {
  const outer = rectangleCorners(room)
  const hole = rectangleCorners({ ...room, width: 2, depth: 2, rotation: 45 })
  assert.ok(Math.abs(total(subtractRectangle(outer, hole)) - 96) < 1e-8)
  const edge = rectangleCorners({ ...room, x: 5, width: 2, depth: 2 })
  assert.ok(Math.abs(total(subtractRectangle(outer, edge)) - 98) < 1e-8)
  const first = subtractRectangle(outer, hole)
  const repeated = first.flatMap(p => subtractRectangle(p, hole))
  assert.ok(Math.abs(total(repeated) - 96) < 1e-8)
})

test('stairs cut the destination slab and whole-building rendering respects elevations', () => {
  const lower = floor('ground', -3), upper = floor('upper', 0)
  lower.items.push({ ...room, id: 'stair', kind: 'stair', width: 2, depth: 3, rotation: 30, targetFloorId: 'upper' })
  const model = { floors: [lower, upper] }
  assert.ok(Math.abs(total(floorSlabPolygons(model, upper).map(p => p.polygon)) - 94) < 1e-8)
  const group = buildDesignGroup(model)
  assert.deepEqual(group.children.map(child => child.position.y), [-3, 0])
  const single = buildDesignGroup(model, { floorId: 'upper', allFloors: false })
  assert.equal(single.children.length, 1)
  assert.equal(single.children[0].name, 'upper')
  disposeDesignGroup(group); disposeDesignGroup(single)
})

test('scene disposal releases shared geometry, materials, textures and bitmap once', () => {
  const group = new THREE.Group(), geometry = new THREE.BoxGeometry(), texture = new THREE.Texture()
  let closed = 0, disposedGeometry = 0, disposedMaterial = 0, disposedTexture = 0
  texture.source.data = { close() { closed++ } }
  const material = new THREE.MeshBasicMaterial({ map: texture })
  geometry.addEventListener('dispose', () => disposedGeometry++)
  material.addEventListener('dispose', () => disposedMaterial++)
  texture.addEventListener('dispose', () => disposedTexture++)
  group.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material))
  disposeDesignGroup(group)
  assert.deepEqual([closed, disposedGeometry, disposedMaterial, disposedTexture, group.children.length], [1, 1, 1, 1, 0])
})

test('source floor replaces legacy meshes while host owns elevation and level filtering', () => {
  const lower = floor('ground', 0), upper = floor('upper', 4)
  lower.source = `export function buildFloor(THREE) {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 3), new THREE.MeshStandardMaterial({color: 0xff0000}));
    mesh.position.set(7, 0.5, 8); group.add(mesh); return group;
  }`
  upper.source = lower.source
  const group = buildDesignGroup({ floors: [lower, upper] })
  assert.equal(group.children.length, 2)
  assert.equal(group.children[0].children.length, 1, 'legacy room slab must be replaced')
  assert.equal(group.children[0].children[0].children.length, 1)
  const bounds = new THREE.Box3().setFromObject(group)
  assert.equal(bounds.min.y, 0)
  assert.equal(bounds.max.y, 5)
  const single = buildDesignGroup({ floors: [lower, upper] }, { allFloors: false, floorId: 'upper', mode: 'plan' })
  assert.equal(single.children.length, 1)
  assert.equal(new THREE.Box3().setFromObject(single).min.y, 4)
  disposeDesignGroup(group); disposeDesignGroup(single)
})
