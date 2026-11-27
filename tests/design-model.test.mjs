import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createEmptyModel, createDesignState, validateDesignModel, validateDesignScheme, validateDesignState,
  parseDesignCommand, applyDesignCommand, migrateDesignVersions, hasUnmigratedDesignVersions, DesignConflict,
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

test('named schemes copy independently and rename uses revision CAS without snapshots', () => {
  let state = createDesignState()
  state = applyDesignCommand(state, command(state, 'replace', { model: model() }))
  const originalId = state.activeId
  state = applyDesignCommand(state, command(state, 'copy', { name: '方案 B' }))
  const copy = state.designs.find(design => design.id === state.activeId)
  copy.model.floors[0].walls[0].name = '独立修改'
  assert.equal(state.designs[0].model.floors[0].walls[0].name, '外墙')
  const before = structuredClone(state)
  state = applyDesignCommand(state, command(state, 'rename', { name: '客厅开放方案' }))
  assert.equal(state.designs.find(design => design.id === state.activeId).name, '客厅开放方案')
  assert.deepEqual(state.designs.find(design => design.id === state.activeId).model, copy.model)
  assert.throws(() => applyDesignCommand(state, {action:'rename', designId:state.activeId, expectedRevision:before.revision,name:'过期'}), DesignConflict)
  assert.throws(() => applyDesignCommand(state, command(state, 'rename')))
  assert.throws(() => applyDesignCommand(state, command(state, 'snapshot')))
  assert.ok(state.designs.every(design => design.versions.length === 0))
  state = applyDesignCommand(state, command(state, 'activate', {designId:originalId}))
  assert.equal(state.activeId, originalId)
})

function oldState() {
  const state = createDesignState()
  state.designs[0].model = model()
  state.designs[0].versions = ['earlier','later'].map((id,i) => ({ id, name:'相同的旧名称', model:{floors:[{...createEmptyModel().floors[0],height:2+i}]},createdAt:'2026-11-27T00:00:00.000Z' }))
  return state
}
test('legacy snapshots migrate once by source identity and keep old decision references intact', () => {
  const old = oldState(), before = structuredClone(old)
  let migrated = migrateDesignVersions(old)
  assert.equal(migrated.designs.length, 3)
  assert.equal(migrated.activeId, old.activeId)
  assert.deepEqual(migrated.designs[0], old.designs[0])
  assert.deepEqual(old, before)
  migrated.designs.reverse()
  const first = migrated.designs.find(design=>design.legacyVersion?.versionId==='earlier')
  first.name='已重命名';first.model.floors[0].height=9
  const again = migrateDesignVersions(migrated)
  assert.deepEqual(again, migrated)
  assert.equal(again.designs.find(design=>design.id===old.activeId).versions[0].model.floors[0].height,2)
  const activated = applyDesignCommand(again,{action:'activate',expectedRevision:0,designId:old.activeId,versionId:'earlier'})
  assert.equal(activated.activeId, first.id)
  assert.deepEqual(activated.designs.find(design=>design.id===old.activeId).model,old.designs[0].model)
})
test('migration can expand beyond the old 1000 scheme ceiling without losing snapshots', () => {
  const old=oldState()
  const template=old.designs[0]
  old.designs=Array.from({length:1000},(_,i)=>({...template,id:i===0?old.activeId:'scheme-'+i,versions:i===0?template.versions:[]}))
  const migrated=migrateDesignVersions(old)
  assert.equal(migrated.designs.length,1002)
  assert.doesNotThrow(()=>validateDesignState(migrated))
  assert.equal(migrateDesignVersions(migrated).designs.length,1002)
})
test('legacy project import atomically exposes snapshots as schemes while preserving source history', () => {
  const target=createDesignState(), imported=oldState().designs[0]
  const result=applyDesignCommand(target,{action:'import',expectedRevision:0,design:imported})
  const saved=result.designs.find(design=>design.id===result.activeId)
  assert.notEqual(saved.id, imported.id)
  assert.deepEqual(saved.versions, imported.versions)
  assert.equal(result.designs.filter(design=>design.legacyVersion?.designId===saved.id).length,2)
  assert.equal(result.designs.length,4)
  assert.deepEqual(migrateDesignVersions(result), result)
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

test('startup probe checks identities without touching or copying geometry', () => {
  const snapshot={id:'snapshot',get model(){throw new Error('geometry must stay untouched')}}
  const source={id:'original',versions:[snapshot],get model(){throw new Error('geometry must stay untouched')}}
  assert.equal(hasUnmigratedDesignVersions({designs:[source]}),true)
  assert.equal(hasUnmigratedDesignVersions({designs:[source,{id:'derived',versions:[],legacyVersion:{designId:'original',versionId:'snapshot'}}]}),false)
})
