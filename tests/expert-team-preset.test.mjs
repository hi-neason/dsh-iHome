import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { iHomeWorkspacePath } from '../src/ihome-workspace-path.ts'
import { defaultPresetPreferences, presetSettingsView, EXPERT_TEAM_SETTINGS_ID, NEEDS_ANALYST_PRESET_ID, TASK_ASSISTANT_PRESET_ID } from '../src/agent-presets.ts'

const bundle = await build({ entryPoints: ['src/expert-team-preset.ts'], bundle: true, platform: 'node', format: 'esm', loader: { '.md': 'text' }, write: false })
const { apply } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)

const root = { session: { header: { cwd: iHomeWorkspacePath(), agentPreset: NEEDS_ANALYST_PRESET_ID } } }
const child = (provider, label = '需求分析师') => ({ session: {
  header: { cwd: iHomeWorkspacePath(), origin: 'subagent', delegationDepth: 1, parentSession: 'parent' },
  snapshotEvents: () => [{ type: 'subagent/descriptor', data: { version: 3, mode: 'continuable', provider, label } }],
} })

function fixture() {
  const settings = Object.fromEntries([EXPERT_TEAM_SETTINGS_ID, NEEDS_ANALYST_PRESET_ID, TASK_ASSISTANT_PRESET_ID]
    .map(id => [id, presetSettingsView(id, defaultPresetPreferences(id))]))
  let section, provider, restriction, guard, invalidations = 0
  const listeners = new Set(), cleanup = []
  apply({
    ihomeAgentSettings: { get: id => settings[id], subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) } },
    systemPrompt: { getSectionOrder: () => 10, section(value) { section = value } },
    tools: {
      definitions: () => ['ihome_read_archive', 'ihome_propose_need', 'ihome_propose_record', 'ihome_read_tasks', 'ihome_propose_task', 'bash'].map(name => ({ name })),
      restrict(value) { restriction = value }, guard(check) { guard = check },
    },
    skills: { registerProvider(factory) { provider = factory({ invalidate() { invalidations++ }, signal: new AbortController().signal }) } },
    effect(setup) { cleanup.push(setup()) },
  })
  return { section, provider, restriction, guard, listeners, cleanup,
    invalidations: () => invalidations,
    update(id, patch) { settings[id] = { ...settings[id], ...patch }; for (const listener of listeners) listener() },
  }
}

test('preset uses live settings as literal persona and limits inherited tools', () => {
  const f = fixture()
  const context = { agent: root }
  assert.deepEqual(f.restriction.deny, ['bash'])
  assert.equal(f.section.interpolate, false)
  f.update(EXPERT_TEAM_SETTINGS_ID, { instructions: '关注收纳，保留 {{原话}}' })
  assert.match(f.section.text(context), /关注收纳，保留 \{\{原话\}\}/)
  assert.match(f.section.text(context), /ihome_consult_expert/)
  assert.ok(!f.section.text({}).includes('关注收纳'))
  assert.match(f.section.text({}), /从 iHome 首页进入/)
  assert.equal(f.guard({ ...context, name: 'skill' }), undefined)
  assert.equal(f.guard({ ...context, name: 'ihome_propose_need' }), undefined)
  assert.match(f.guard({ ...context, name: 'late_registered_tool' }), /没有使用/)
  assert.match(f.guard({ name: 'ihome_propose_need' }), /仅在 iHome工作区/)
  f.update(EXPERT_TEAM_SETTINGS_ID, { instructions: '' })
  assert.ok(!f.section.text(context).includes('关注收纳'))
})

test('skill switch invalidates discovery and prevents stale or direct loads', async () => {
  const f = fixture(), options = { cwd: iHomeWorkspacePath(), scope: child('ihome-needs-expert') }
  const candidates = await f.provider.list(options)
  assert.equal(candidates.length, 2)
  for (const candidate of candidates) {
    const loaded = await f.provider.get(candidate, options)
    assert.ok(loaded.content.length > 300)
    assert.match(loaded.content, /ihome_read_archive/)
    assert.ok(!loaded.content.startsWith('---'))
  }
  f.update(NEEDS_ANALYST_PRESET_ID, { enabledSkills: ['ihome-needs-review'] })
  assert.equal(f.invalidations(), 1)
  assert.deepEqual((await f.provider.list(options)).map(item => item.name), ['ihome-needs-review'])
  assert.equal(await f.provider.get(candidates[0], options), undefined)
  assert.equal(await f.provider.get({ name: 'unknown' }, options), undefined)
  f.update(NEEDS_ANALYST_PRESET_ID, { enabledSkills: [] })
  assert.deepEqual(await f.provider.list(options), [])
  for (const dispose of f.cleanup) dispose()
  assert.equal(f.listeners.size, 0)
})

test('skill provider refuses other workspaces and cancelled lookups', async () => {
  const f = fixture()
  const [candidate] = await f.provider.list({ cwd: iHomeWorkspacePath(), scope: root })
  for (const cwd of [undefined, '/tmp/ordinary', iHomeWorkspacePath() + '/child']) {
    assert.deepEqual(await f.provider.list({ cwd }), [])
    assert.equal(await f.provider.get(candidate, { cwd }), undefined)
  }
  const controller = new AbortController()
  controller.abort(new Error('cancelled'))
  await assert.rejects(f.provider.list({ cwd: iHomeWorkspacePath(), signal: controller.signal }), /cancelled/)
})

test('each role sees its own prompt and skills, with child writes and recursive delegation denied', async () => {
  const f = fixture()
  for (const [agent, id, skills] of [
    [root, EXPERT_TEAM_SETTINGS_ID, ['ihome-team-coordination']],
    [child('ihome-needs-expert'), NEEDS_ANALYST_PRESET_ID, ['ihome-needs-interview', 'ihome-needs-review']],
    [child('ihome-task-expert'), TASK_ASSISTANT_PRESET_ID, ['ihome-task-planning', 'ihome-task-review']],
  ]) {
    f.update(id, { instructions: '设置属于' + id })
    assert.ok(f.section.text({ agent }).includes('设置属于' + id))
    const options = { cwd: iHomeWorkspacePath(), scope: agent }
    assert.deepEqual((await f.provider.list(options)).map(skill => skill.name), skills)
    for (const name of skills) assert.ok((await f.provider.get({ name }, options)).content.length > 100)
    if (agent !== root) {
      for (const name of ['ihome_propose_record', 'ihome_propose_task', 'ihome_consult_expert']) {
        assert.ok(f.guard({ agent, name }))
      }
    }
  }
  const unknown = child('fork', '任务待办助理')
  assert.deepEqual(await f.provider.list({ cwd: iHomeWorkspacePath(), scope: unknown }), [])
  assert.ok(f.guard({ agent: unknown, name: 'ihome_read_archive' }))
})
