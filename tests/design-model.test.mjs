import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createEmptyModel, createDesignState, validateDesignModel, validateDesignScheme, validateDesignState,
  parseDesignCommand, applyDesignCommand, DesignConflict,
} from '../src/design-model.ts'

const assetId = 'sha256:' + 'a'.repeat(64)
function model() {
  return { floors: [{ id: 'ground', name: '一层', elevation: 0, height: 3,
    walls: [{ id: 'wall', name: '外墙', x1: 0, z1: 0, x2: 8, z2: 0, thickness: 0.2 }],
    openings: [{ id: 'window', name: '书房窗', wallId: 'wall', kind: 'window', offset: 2, width: 1.2, sill: 0.8, height: 1.5 }],
    items: [{ id: 'stairs', name: '楼梯', kind: 'stair', x: 1, z: 2, width: 1, depth: 3, height: 3, rotation: 90, targetFloorId: 'upper' }],
    reference: { assetId, name: '原始户型图', x: -1, z: -2, width: 10, depth: 12 },
    assets: [{ id: 'sofa', name: '沙发', assetId, x: 2, z: 3, y: 0, scale: 1, rotation: 30 }],
  }, { id: 'upper', name: '二层', elevation: 3, height: 2.8, walls: [], openings: [], items: [] }] }
}
const command = (state, action, fields = {}) => ({ action, expectedRevision: state.revision, designId: state.activeId, ...fields })

test('multilevel geometry keeps calibrated references and placed assets detached from input', () => {
  const original = model()
  const parsed = validateDesignModel(original)
  assert.deepEqual(parsed, original)
  parsed.floors[0].reference.width = 15
  parsed.floors[0].assets[0].scale = 2
  assert.equal(original.floors[0].reference.width, 10)
  assert.equal(original.floors[0].assets[0].scale, 1)
  assert.equal(createEmptyModel().floors.length, 1)
})

test('invalid dimensions, missing references and duplicate identities fail before rendering', () => {
  const cases = [
    m => { m.floors = [] },
    m => { m.floors[0].walls[0].x1 = NaN },
    m => { m.floors[0].walls[0].x2 = 0 },
    m => { m.floors[0].walls[0].thickness = -0.2 },
    m => { m.floors[0].openings[0].wallId = 'missing' },
    m => { m.floors[0].openings[0].offset = 7.5 },
    m => { m.floors[0].openings[0].height = 3 },
    m => { m.floors[0].items[0].targetFloorId = 'missing' },
    m => { m.floors[0].items[0].targetFloorId = 'ground' },
    m => { m.floors[0].items[0].kind = 'furniture' },
    m => { m.floors[1].id = 'window' },
    m => { m.floors[0].assets[0].id = 'wall' },
    m => { m.floors[0].reference.assetId = 'https://example.com/image.png' },
    m => { m.floors[0].assets[0].scale = 0 },
    m => { m.floors[0].reference.width = Infinity },
    m => { m.floors[0].unsupported = true },
  ]
  for (const mutate of cases) {
    const value = model()
    mutate(value)
    assert.throws(() => validateDesignModel(value))
  }
  const diagonal = model()
  diagonal.floors[0].walls[0].x2 = 3
  diagonal.floors[0].walls[0].z2 = 4
  diagonal.floors[0].openings[0].offset = 3.8
  assert.doesNotThrow(() => validateDesignModel(diagonal))
})

test('new projects, independent copies and immutable snapshots survive model edits', () => {
  let state = createDesignState()
  state = applyDesignCommand(state, command(state, 'replace', { model: model() }))
  state = applyDesignCommand(state, command(state, 'snapshot', { name: '量房底稿' }))
  const originalId = state.activeId
  const version = structuredClone(state.designs[0].versions[0])
  const changed = model()
  changed.floors[0].walls[0].name = '修改后的外墙'
  state = applyDesignCommand(state, command(state, 'replace', { model: changed }))
  assert.deepEqual(state.designs[0].versions[0], version)
  state = applyDesignCommand(state, command(state, 'copy', { versionId: version.id, name: '方案 B' }))
  assert.notEqual(state.activeId, originalId)
  assert.equal(state.designs[1].name, '方案 B')
  assert.equal(state.designs[1].model.floors[0].walls[0].name, '外墙')
  assert.equal(state.designs[1].versions.length, 0)
  state.designs[1].model.floors[0].walls[0].name = '独立修改'
  assert.equal(state.designs[0].model.floors[0].walls[0].name, '修改后的外墙')
  assert.equal(state.designs[0].versions[0].model.floors[0].walls[0].name, '外墙')
  state = applyDesignCommand(state, command(state, 'activate', { designId: originalId, versionId: version.id }))
  assert.equal(state.activeId, originalId)
  assert.deepEqual(state.designs[0].model, version.model)
  assert.deepEqual(state.designs[0].versions[0], version)
  state = applyDesignCommand(state, { action: 'create', expectedRevision: state.revision, name: '空白方案' })
  assert.equal(state.designs.at(-1).model.floors[0].walls.length, 0)
})

test('import retains version history with a new design identity and independent storage', () => {
  let source = createDesignState()
  source = applyDesignCommand(source, command(source, 'replace', { model: model() }))
  source = applyDesignCommand(source, command(source, 'snapshot'))
  const scheme = source.designs[0]
  const result = applyDesignCommand(source, { action: 'import', expectedRevision: source.revision, design: scheme })
  assert.notEqual(result.activeId, scheme.id)
  assert.deepEqual(result.designs[1].versions, scheme.versions)
  assert.deepEqual(validateDesignScheme(result.designs[1]), result.designs[1])
  result.designs[1].versions[0].model.floors[0].name = '拷贝修改'
  assert.equal(source.designs[0].versions[0].model.floors[0].name, '一层')
})

test('strict command validation and revision compare prevent accidental overwrites', () => {
  const state = createDesignState()
  const invalid = [
    { action: 'replace', expectedRevision: 0, model: model() },
    { action: 'replace', expectedRevision: 0, designId: state.activeId },
    { action: 'create', expectedRevision: 0, designId: 'provided' },
    { action: 'create', expectedRevision: 0, name: '' },
    { action: 'copy', expectedRevision: 0, designId: state.activeId, model: model() },
    { action: 'snapshot', expectedRevision: 0, designId: state.activeId, versionId: 'missing' },
    { action: 'activate', expectedRevision: 0, designId: state.activeId, versionId: 'missing' },
    { action: 'create', expectedRevision: 0, design: state.designs[0] },
    { action: 'import', expectedRevision: 0 },
    { action: 'replace', expectedRevision: 0, designId: 'missing', model: model() },
    { action: 'unknown', expectedRevision: 0 },
    { action: 'create', expectedRevision: 0.5 },
    { action: 'create', expectedRevision: 0, unsupported: true },
  ]
  for (const change of invalid) assert.throws(() => applyDesignCommand(state, change))
  assert.equal(state.revision, 0)
  assert.equal(state.designs.length, 1)
  assert.throws(() => applyDesignCommand(state, { action: 'create', expectedRevision: 4 }), DesignConflict)
  const parsed = parseDesignCommand({ action: 'create', expectedRevision: 0, model: model() })
  assert.equal(parsed.model.floors.length, 2)
  assert.throws(() => validateDesignState({ ...state, activeId: 'missing' }), /当前方案不存在/)
  const invalidVersion = { id: 'v1', name: '时间错误', model: model(), createdAt: '2026-02-30T12:00:00.000Z' }
  assert.throws(() => validateDesignScheme({ ...state.designs[0], versions: [invalidVersion] }), /时间无效/)
})
