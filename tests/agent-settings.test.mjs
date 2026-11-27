import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { NEEDS_ANALYST_PRESET_ID as id, EXPERT_TEAM_SETTINGS_ID, TASK_ASSISTANT_PRESET_ID, publicAgentPresets, presetDefinition } from '../src/agent-presets.ts'
import { requestIHome } from '../src/ihome-http.ts'

const bundle = await build({ entryPoints: ['src/agent-settings-host.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { mountAgentSettings } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)

test('an unavailable settings route explains how to reload the host while file errors keep their own detail', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: '未找到资源' }, { status: 404 }))
  await assert.rejects(requestIHome('agent-settings'), { status: 404, message: /完整退出并重新打开 DeepSeek Harness/ })
  await assert.rejects(requestIHome('file?id=missing'), { status: 404, message: '未找到资源' })
})

async function fixture(rows = new Map()) {
  let route, cleanup, service, closed = false
  const table = {
    get: key => rows.get(key),
    async put(key, value) { rows.set(key, value) },
    async update(key, transform) { const next = transform(rows.get(key)); rows.set(key, next); return next },
  }
  await mountAgentSettings({
    storageDomain: { async open(spec) {
      assert.equal(spec.name, 'ihome_agent_settings')
      return { table: () => table, async close() { closed = true } }
    } },
    effect: async setup => { cleanup = await setup() },
    provide(name, value) { assert.equal(name, 'ihomeAgentSettings'); service = value; return () => { service = undefined } },
    connection: { fetch: { register(value) { route = value; return () => { route = undefined } } } },
  })
  return { rows, service: () => service, cleanup: () => cleanup(), closed: () => closed,
    http(body, signal) { return route.fetch(new Request('http://localhost/api/ihome/agent-settings',
      body === undefined ? { signal } : { method: 'PUT', body: JSON.stringify(body), signal })) },
  }
}

test('preset settings persist and snapshots do not mutate stored or default settings', async () => {
  const first = await fixture()
  const defaults = (await (await first.http()).json()).presets.find(preset => preset.id === id)
  assert.equal(defaults.id, id)
  assert.equal(defaults.revision, 0)
  assert.equal(defaults.enabledSkills.length, 2)
  assert.equal(defaults.basePrompt, presetDefinition(id).basePrompt)
  const saved = await (await first.http({ id, revision: 0, instructions: '每次只问一个问题 {{literal}}', enabledSkills: [] })).json()
  assert.equal(saved.revision, 1)
  const view = first.service().get(id)
  view.enabledSkills.push('invalid')
  view.skills[0].title = 'modified'
  assert.deepEqual(first.service().get(id).enabledSkills, [])
  assert.notEqual(first.service().get(id).skills[0].title, 'modified')
  const retained = first.service()
  await first.cleanup()
  assert.equal(first.closed(), true)
  assert.equal(first.service(), undefined)
  assert.throws(() => retained.get(id), /已关闭/)
  const second = await fixture(first.rows)
  assert.equal(second.service().get(id).instructions, saved.instructions)
  assert.equal(second.service().get(id).revision, 1)
  await second.cleanup()
})

test('settings reject concurrent and invalid changes, reset restores defaults and notifies after commit', async () => {
  const f = await fixture()
  const revisions = []
  f.service().subscribe(() => { throw new Error('observer failure') })
  const unsubscribe = f.service().subscribe(() => revisions.push(f.service().get(id).revision))
  const update = { id, revision: 0, instructions: '优先询问老人需求', enabledSkills: ['ihome-needs-interview'] }
  const outcomes = await Promise.all([f.http(update), f.http(update)])
  assert.deepEqual(outcomes.map(response => response.status).sort(), [200, 409])
  assert.deepEqual(revisions, [1])
  for (const patch of [{ id: 'missing' }, { revision: -1 }, { instructions: 0 }, { enabledSkills: ['unknown'] },
    { enabledSkills: ['ihome-needs-interview', 'ihome-needs-interview'] }, { reset: false }]) {
    assert.equal((await f.http({ ...update, revision: 1, ...patch })).status, 400)
  }
  const controller = new AbortController()
  controller.abort()
  assert.equal((await f.http({ ...update, revision: 1 }, controller.signal)).status, 400)
  assert.equal(f.service().get(id).revision, 1)
  const reset = await (await f.http({ id, revision: 1, reset: true })).json()
  assert.equal(reset.revision, 2)
  assert.equal(reset.instructions, '')
  assert.equal(reset.enabledSkills.length, 2)
  assert.deepEqual(revisions, [1, 2])
  unsubscribe()
  await f.http({ ...update, revision: 2 })
  assert.deepEqual(revisions, [1, 2])
  await f.cleanup()
})


test('team and expert settings are independent and preserve existing analyst preferences', async () => {
  const existing = { revision: 7, instructions: '先关注老人', enabledSkills: ['ihome-needs-review'] }
  const f = await fixture(new Map([[id, existing]]))
  const { presets } = await (await f.http()).json()
  assert.deepEqual(presets.map(preset => preset.id), [EXPERT_TEAM_SETTINGS_ID, id, 'ihome-floorplan-designer', TASK_ASSISTANT_PRESET_ID])
  assert.equal(f.service().get(id).instructions, existing.instructions)
  assert.equal(f.service().get(id).revision, 7)
  assert.deepEqual(f.service().get(id).enabledSkills, existing.enabledSkills)
  const taskChange = { id: TASK_ASSISTANT_PRESET_ID, revision: 0, instructions: '优先看本周', enabledSkills: ['ihome-task-review'] }
  assert.equal((await f.http(taskChange)).status, 200)
  assert.equal(f.service().get(EXPERT_TEAM_SETTINGS_ID).revision, 0)
  assert.equal(f.service().get(id).revision, 7)
  assert.equal(f.service().get(TASK_ASSISTANT_PRESET_ID).instructions, '优先看本周')
  assert.equal((await f.http({ ...taskChange, revision: 1, enabledSkills: ['ihome-needs-review'] })).status, 400)
  assert.equal(publicAgentPresets.length, 1)
  assert.equal(publicAgentPresets[0].id, id)
  assert.deepEqual(publicAgentPresets[0].moduleIds, ['archive', 'tasks', 'design'])
  await f.cleanup()
})
