import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { iHomeWorkspacePath } from '../src/ihome-workspace-path.ts'
const bundle = await build({ stdin: { contents: "export * from './src/design-tools.ts'; export * from './src/design-model.ts'", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false })
const { mountDesignTools, prepareDesignProposal, createDesignState, applyDesignCommand } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
const execution = () => ({ agent: { session: { header: { cwd: iHomeWorkspacePath() } } }, signal: new AbortController().signal })
async function fixture(answer = '接受', onAsk = () => {}) {
  let state = createDesignState(), writes = 0, questions = 0
  const tools = {}
  await mountDesignTools({ ihomeDesigns: { read: () => structuredClone(state), async change(command, signal) { signal?.throwIfAborted(); state = applyDesignCommand(state, command); writes++; return state } },
    tools: { register(tool) { tools[tool.name] = tool; return () => {} } },
    userQuestions: { async ask(request) { questions++; onAsk({ request, mutate() { state.revision++ } }); return { answers: [{ id: request.questions[0].id, selected: [answer] }] } } }, effect: async setup => setup() })
  return { tools, state: () => state, writes: () => writes, questions: () => questions }
}
test('localized edits preserve attached assets and stable unrelated geometry', () => {
  const state = createDesignState(), floor = state.designs[0].model.floors[0]
  floor.reference = { assetId: 'sha256:' + 'a'.repeat(64), name: '底图', x: 0, z: 0, width: 10, depth: 8 }
  floor.assets = [{ id: 'asset', assetId: 'sha256:' + 'b'.repeat(64), name: '沙发', x: 0, z: 0, y: 0, scale: 1, rotation: 0 }]
  const proposal = prepareDesignProposal(state, { action: 'edit', expectedRevision: 0, operations: [{ entity: 'floor', action: 'upsert', id: floor.id, value: { name: '一楼' } }] })
  assert.deepEqual(proposal.command.model.floors[0].reference, floor.reference)
  assert.deepEqual(proposal.command.model.floors[0].assets, floor.assets)
  assert.equal(floor.name === '一楼', false)
  assert.match(proposal.summary, /一楼/)
  assert.throws(() => prepareDesignProposal(state, { action: 'edit', expectedRevision: 0, operations: [{ entity: 'wall', action: 'upsert', floorId: floor.id, id: 'wall', value: { name: '无效墙' } }] }))
})
test('design writes require accepted confirmation and CAS preserves concurrent updates', async () => {
  for (const answer of ['接受', '不接受']) {
    const f = await fixture(answer)
    const result = await f.tools.ihome_propose_design.execute({ action: 'create', expectedRevision: 0, name: '新方案' }, execution())
    assert.equal(result.status, answer === '接受' ? 'applied' : 'not_applied')
    assert.equal(f.writes(), answer === '接受' ? 1 : 0)
  }
  const f = await fixture('接受', ({ mutate }) => mutate())
  assert.equal((await f.tools.ihome_propose_design.execute({ action: 'create', expectedRevision: 0 }, execution())).status, 'conflict')
  assert.equal(f.writes(), 0)
  assert.equal(f.state().designs.length, 1)
})
test('stale, foreign and subagent requests cannot prompt or write; cancellation cannot write', async () => {
  const f = await fixture()
  const args = { action: 'create', expectedRevision: 0 }
  assert.equal((await f.tools.ihome_propose_design.execute({ ...args, expectedRevision: 1 }, execution())).status, 'conflict')
  const foreign = execution(); foreign.agent.session.header.cwd = '/tmp/other'
  await assert.rejects(f.tools.ihome_propose_design.execute(args, foreign))
  const child = execution(); Object.assign(child.agent.session.header, { origin: 'subagent', delegationDepth: 1, parentSession: 'parent' }); child.agent.session.snapshotEvents = () => [{ type: 'subagent/descriptor', data: { version: 3, mode: 'continuable', provider: 'ihome-floorplan-expert' } }]
  await assert.rejects(f.tools.ihome_propose_design.execute(args, child))
  assert.equal((await f.tools.ihome_read_design.execute({}, child)).revision, 0)
  assert.equal(f.questions(), 0)
  const controller = new AbortController(), cancelled = await fixture('接受', () => controller.abort())
  await assert.rejects(cancelled.tools.ihome_propose_design.execute(args, { ...execution(), signal: controller.signal }))
  assert.equal(cancelled.writes(), 0)
})

test('public design tools expose named schemes without snapshots or version fields', async () => {
  const f = await fixture()
  const current = await f.tools.ihome_read_design.execute({}, execution())
  assert.deepEqual(current, JSON.parse(JSON.stringify(current)))
  assert.equal(Object.hasOwn(current, 'versionId'), false)
  assert.equal(Object.hasOwn(current.designs[0], 'versions'), false)
  assert.equal(Object.hasOwn(f.tools.ihome_read_design.parameters.properties, 'versionId'), false)
  assert.deepEqual(f.tools.ihome_propose_design.parameters.properties.action.enum, ['create', 'edit', 'copy', 'rename', 'activate'])
  await assert.rejects(f.tools.ihome_propose_design.execute({ action: 'snapshot', expectedRevision: 0 }, execution()))
  await f.tools.ihome_propose_design.execute({ action: 'copy', expectedRevision: 0, name: '客厅留白方案' }, execution())
  const copied = await f.tools.ihome_read_design.execute({}, execution())
  assert.equal(copied.name, '客厅留白方案')
  assert.equal(copied.designs.length, 2)
  assert.deepEqual(copied, JSON.parse(JSON.stringify(copied)))
})

test('renaming a scheme requires confirmation and preserves its geometry', async () => {
  const f = await fixture()
  const before = structuredClone(f.state().designs[0])
  const result = await f.tools.ihome_propose_design.execute({ action: 'rename', expectedRevision: 0, designId: before.id, name: '南向采光方案' }, execution())
  assert.equal(result.status, 'applied')
  assert.equal(f.state().designs[0].name, '南向采光方案')
  assert.deepEqual(f.state().designs[0].model, before.model)
  const declined = await fixture('不接受')
  const name = declined.state().designs[0].name
  assert.equal((await declined.tools.ihome_propose_design.execute({ action: 'rename', expectedRevision: 0, name: '不应保存' }, execution())).status, 'not_applied')
  assert.equal(declined.state().designs[0].name, name)
})
