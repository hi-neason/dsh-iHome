import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const bundle = await build({ stdin: { contents: "export * from './src/design-review.ts'; export * from './src/archive-model.ts'; export * from './src/design-model.ts'", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false })
const { reviewDesign, prepareDesignDecision, createDesignReviewTools, createArchive, validateArchive, createDesignState, applyDesignCommand } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
function fixture() {
  const archive = createArchive()
  archive.members = [{ id: 'mom', name: '妈妈', residency: '常住' }]
  archive.rooms = [{ id: 'living', houseId: 'home', name: '客厅' }]
  archive.needs = [{ id: 'need', houseId: 'home', title: '客厅留活动空间', memberIds: ['mom'], roomIds: ['living'], factIds: [], priority: 'must', quote: '不想放太多家具', version: 1 }]
  let state = createDesignState()
  const floor = state.designs[0].model.floors[0]
  floor.items = [{ id: 'room', name: '客厅', kind: 'room', roomId: 'living', x: 0, z: 0, width: 5, depth: 4, height: 2.8, rotation: 0 },
    { id: 'a', name: '桌子', kind: 'furniture', x: 0, z: 0, width: 2, depth: 1, height: 1, rotation: 45 },
    { id: 'b', name: '椅子', kind: 'furniture', x: .1, z: .1, width: 1, depth: 1, height: 1, rotation: -30 }]
  state.designs[0].versions = [{ id: 'legacy-version', name: '旧历史', model: structuredClone(state.designs[0].model), createdAt: '2026-11-27T00:00:00.000Z' }]
  return { state, archive: validateArchive(archive) }
}
const args = (state, archive) => ({ expectedRevision: archive.revision, expectedDesignRevision: state.revision, designId: state.activeId, text: '采用客厅留白方案', reason: '保留妈妈活动空间', needIds: ['need'], objectIds: ['room'] })
test('review links actual people and needs without claiming fulfillment and compares measured model deltas', () => {
  const { state, archive } = fixture()
  state.designs.push({ ...structuredClone(state.designs[0]), id: 'baseline', name: '原布局' })
  state.designs[0].model.floors[0].items[0].width = 6
  const result = reviewDesign(state, archive, { compareDesignId: 'baseline' })
  assert.equal(result.needs[0].members[0].name, '妈妈')
  assert.deepEqual(result.needs[0].rooms[0].modelObjectIds, ['room'])
  assert.match(result.needs[0].assessment, /不代表/)
  assert.equal(result.metrics.roomArea, 24)
  assert.equal(result.comparison.delta.roomArea, 4)
  assert.equal(result.issues[0].kind, 'furniture-overlap')
  assert.match(result.comparison.objects.changed[0], /客厅/)
  state.designs[0].model.floors[0].items[2].x = 10
  assert.equal(reviewDesign(state, archive, {}).issues.length, 0)
})
test('decisions capture current named scheme without requiring a snapshot and preserve history', async () => {
  const { state, archive } = fixture()
  const proposal = await prepareDesignDecision(state, archive, args(state, archive))
  assert.equal(proposal.decision.needIds[0], 'need')
  assert.match(proposal.decision.reason, /modelSha256/)
  assert.ok(proposal.decision.reason.includes(state.activeId))
  assert.match(proposal.decision.reason, /capturedAt/)
  assert.match(proposal.decision.reason, /geometrySummary/)
  assert.equal(proposal.decision.reason.includes('versionId'), false)
  assert.equal(archive.decisions.length, 0)
  const second = await prepareDesignDecision(state, proposal.next, { ...args(state, proposal.next), supersedesId: proposal.decision.id })
  assert.equal(second.next.decisions.length, 2)
  assert.equal(second.decision.supersedesId, proposal.decision.id)
  for (const patch of [{ versionId: 'missing' }, { objectIds: ['missing'] }, { needIds: ['missing'] }, { expectedDesignRevision: 10 }]) await assert.rejects(prepareDesignDecision(state, archive, { ...args(state, archive), ...patch }))
})
test('decision confirmation accepts exact consent, rejects edits and detects concurrent sources', async () => {
  for (const mode of ['accept', 'reject', 'custom', 'archive-race', 'design-race', 'cancel']) {
    const { state, archive } = fixture(), controller = new AbortController()
    let writes = 0
    const tools = createDesignReviewTools({ readArchive: () => archive, readDesign: () => state,
      async saveArchive(next) { assert.equal(next.revision, archive.revision); writes++; return { ...next, revision: next.revision + 1 } },
      questions: { async ask(request) {
        if (mode === 'archive-race') archive.revision++
        if (mode === 'design-race') state.revision++
        if (mode === 'cancel') controller.abort()
        return { answers: [{ id: request.questions[0].id, selected: [mode === 'reject' ? '不接受' : '接受'], ...(mode === 'custom' ? { custom: '先改一下' } : {}) }] }
      } },
    })
    const action = tools[1].execute(args(state, archive), { agent: {}, signal: controller.signal })
    if (['archive-race', 'design-race', 'cancel'].includes(mode)) await assert.rejects(action)
    else assert.equal((await action).status, mode === 'accept' ? 'applied' : 'not_applied')
    assert.equal(writes, mode === 'accept' ? 1 : 0)
  }
})

test('stairs use generated openings and only flag disconnected target room footprints', () => {
  const { state, archive } = fixture()
  const model = state.designs[0].model, lower = model.floors[0]
  lower.items = [{ id: 'stairs', name: '楼梯', kind: 'stair', targetFloorId: 'upper', x: 0, z: 0, width: 1, depth: 3, height: 2.8, rotation: 0 }]
  model.floors.push({ id: 'upper', name: '二层', elevation: 3, height: 2.8, walls: [], openings: [], items: [{ id: 'upper-room', name: '二层客厅', kind: 'room', x: 0, z: 0, width: 5, depth: 5, height: 2.8, rotation: 0 }] })
  assert.equal(reviewDesign(state, archive, {}).issues.length, 0)
  model.floors[1].items[0].x = 20
  assert.equal(reviewDesign(state, archive, {}).issues[0].kind, 'stair-landing')
})

test('review output is lossless JSON with optional archive fields and absent comparison versions', () => {
  const { state, archive } = fixture()
  archive.measurements.push({ id: 'measure', roomId: 'living', label: '净宽', value: 4000, unit: 'mm', source: '实测', date: '2026-11-27', adopted: true, attachmentId: undefined, quote: undefined })
  // Unknown names can occur in stale input; the tool must still return a serializable diagnostic.
  archive.needs[0].roomIds.push('removed-room')
  archive.members[0].name = undefined
  for (const args of [{}, { compareDesignId: state.activeId }, { versionId: state.designs[0].versions[0].id }]) {
    const result = reviewDesign(state, archive, args)
    assert.deepEqual(result, JSON.parse(JSON.stringify(result)))
    assert.equal(Object.hasOwn(result.measurements[0], 'attachmentId'), false)
    assert.equal(Object.hasOwn(result.needs[0].rooms[1], 'name'), false)
    assert.equal(Object.hasOwn(result.needs[0].members[0], 'name'), false)
  }
})

test('decision works with no snapshots, records geometry at acceptance, and retains legacy reads', async () => {
  const { state, archive } = fixture()
  const legacyVersion = state.designs[0].versions[0]
  const legacy = await prepareDesignDecision(state, archive, { ...args(state, archive), versionId: legacyVersion.id })
  assert.ok(legacy.decision.reason.includes(legacyVersion.id))
  state.designs[0].versions = []
  const first = await prepareDesignDecision(state, archive, args(state, archive))
  state.designs[0].model.floors[0].items[0].width = 8
  state.revision++
  const second = await prepareDesignDecision(state, archive, args(state, archive))
  const source = decision => JSON.parse(decision.reason.split('设计来源：')[1])
  assert.notEqual(source(first.decision).modelSha256, source(second.decision).modelSha256)
  assert.equal(source(first.decision).geometrySummary.roomArea, 20)
  assert.equal(source(second.decision).geometrySummary.roomArea, 32)
  const tools = createDesignReviewTools({})
  for (const tool of tools) {
    assert.equal(JSON.stringify(tool.parameters).includes('versionId'), false)
    assert.equal(tool.description.includes('snapshot'), false)
  }
})

test('source floors never reuse obsolete structured geometry for automated review', () => {
  const { state, archive } = fixture()
  state.designs[0].model.floors[0].source = 'export function buildFloor(THREE) { return new THREE.Group(); }'
  const report = reviewDesign(state, archive, {})
  assert.equal(report.metrics.roomArea, null)
  assert.equal(report.metrics.furniture, null)
  assert.equal(report.metrics.sourceFloors.length, 1)
  assert.deepEqual(report.needs[0].rooms[0].modelObjectIds, [])
  assert.deepEqual(report.issues.map(issue => issue.kind), ['source-review-required'])
  assert.match(report.metricsNote, /未覆盖/)
})
