import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkspaceManager, moduleSessionPrompt, mountIHomeWorkspace } from '../src/ihome-workspace.ts'
import { iHomeWorkspacePath } from '../src/ihome-workspace-path.ts'
import { IHOME_TEAM_PRESET_ID } from '../src/agent-presets.ts'

async function fixture(t, initial) {
  const directory = await mkdtemp(join(tmpdir(), 'ihome-workspace-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let stored = initial, beforePut = () => {}, createFailure = false
  const headers = new Map(), titles = new Map(), archived = [], creates = [], routes = [], prompts = []
  const workspace = { id: 'workspace', title: 'iHome工作区', path: directory, sessionIds: [],
    async setTitle(title) { this.title = title } }
  const table = { get: () => stored, put: async (_, value) => { beforePut(value); stored = structuredClone(value) } }
  const ctx = {
    agentPresets: { defaultId: 'standard', presetForSession: session => session.header.agentPreset },
    workspaceRegistry: { archivedSessionIds: archived, create: async () => workspace,
      async unarchiveSession() { assert.fail('expert selection must never restore an archive') } },
    sessions: { get: id => headers.has(id) ? { id, header: headers.get(id) } : undefined },
    sessionPersistence: { stat: async id => headers.has(id) ? { header: headers.get(id) } : undefined, flush: async () => {} },
    sessionController: {
      async create(request) {
        creates.push(request)
        if (createFailure) throw new Error('storage offline')
        const { sessionId, agentPreset } = request
        headers.set(sessionId, { id: sessionId, cwd: directory, agentPreset })
        workspace.sessionIds.push(sessionId)
        return { sessionId, agentPreset }
      },
      async rename() { assert.fail('expert selection must not rename a conversation') },
    },
    storageDomain: { open: async () => ({ table: () => table, close: async () => {} }) },
    connection: { fetch: { register(route) { routes.push(route); return () => {} } } },
    systemPrompt: { getSectionOrder: () => 100, section(value) { prompts.push(value); return () => {} } },
    effect: setup => setup(),
  }
  const add = (id, overrides = {}) => {
    headers.set(id, { id, cwd: directory, agentPreset: 'standard', ...overrides })
    titles.set(id, '用户命名的 ' + id)
    workspace.sessionIds.push(id)
    return id
  }
  return { ctx, table, directory, archived, headers, titles, creates, routes, prompts, add,
    state: () => stored, restart: () => createWorkspaceManager(ctx, table, directory),
    failCreate(value) { createFailure = value }, onPut(callback) { beforePut = callback } }
}

test('all experts can share the current ordinary session without changing its title or preset', async t => {
  const f = await fixture(t), current = f.add('manually-created')
  const manager = f.restart()
  for (const role of ['archive', 'tasks', 'design', 'knowledge', 'quotes', 'documents', 'budget', 'fengshui']) {
    assert.equal((await manager.open(role, current)).sessionId, current)
    assert.equal(f.state().selectedModules[current], role)
  }
  assert.equal(f.creates.length, 0)
  assert.equal(f.headers.get(current).agentPreset, 'standard')
  assert.equal(f.titles.get(current), '用户命名的 manually-created')
  const freshManager = f.restart()
  assert.equal((await freshManager.open('materials')).sessionId, current)
  assert.deepEqual((await freshManager.ensure()).selectedModules, { [current]: 'materials' })
})

test('archive is respected across clicks, restart and obsolete module indexes', async t => {
  const f = await fixture(t, { sessions: { archive: { sessionId: 'old', ready: true }, tasks: { sessionId: 'old', ready: true } } })
  f.add('old'); f.archived.push('old')
  const manager = f.restart()
  const first = await manager.open('archive')
  assert.notEqual(first.sessionId, 'old')
  assert.deepEqual(f.archived, ['old'])
  f.archived.push(first.sessionId)
  const next = await f.restart().open('tasks', first.sessionId)
  assert.notEqual(next.sessionId, first.sessionId)
  assert.deepEqual(f.archived, ['old', first.sessionId])
  assert.equal(f.creates.length, 2)
  assert.deepEqual((await manager.ensure()).selectedModules, { [next.sessionId]: 'tasks' })
  assert.equal(f.titles.get('old'), '用户命名的 old')
})

test('a stale explicitly selected conversation starts fresh instead of reopening unrelated history', async t => {
  const f = await fixture(t), remembered = f.add('remembered'), current = f.add('current')
  const manager = f.restart()
  await manager.open('archive', remembered)
  f.archived.push(current)
  assert.notEqual((await manager.open('tasks', current)).sessionId, remembered)
  const deleted = await manager.open('archive', 'deleted')
  assert.notEqual(deleted.sessionId, remembered)
  const child = f.add('child', { origin: 'subagent', delegationDepth: 1 })
  assert.notEqual((await manager.open('design', child)).sessionId, child)
  assert.equal(f.creates.length, 3)
})

test('another workspace can continue the last iHome conversation while a new iHome current wins', async t => {
  const f = await fixture(t), old = f.add('old'), other = f.add('other', { cwd: '/other' }), fresh = f.add('fresh')
  const manager = f.restart()
  await manager.open('archive', old)
  assert.equal((await manager.open('tasks', other)).sessionId, old)
  assert.equal((await manager.open('tasks', fresh)).sessionId, fresh)
  assert.equal(f.creates.length, 0)
  f.archived.push(fresh)
  const next = await f.restart().open('archive')
  assert.notEqual(next.sessionId, old)
  assert.notEqual(next.sessionId, fresh)
})

test('concurrent first clicks create one team conversation and resume a failed reservation', async t => {
  const f = await fixture(t), manager = f.restart()
  f.failCreate(true)
  await assert.rejects(manager.open('archive'), /storage offline/)
  const pending = f.state().pendingSessionId
  f.failCreate(false)
  const restarted = f.restart()
  const [one, two] = await Promise.all([restarted.open('tasks'), restarted.open('quotes')])
  assert.equal(one.sessionId, pending)
  assert.equal(two.sessionId, pending)
  assert.equal(f.headers.get(pending).agentPreset, IHOME_TEAM_PRESET_ID)
  assert.equal(f.creates.length, 2)
  assert.equal(new Set(f.creates.map(item => item.sessionId)).size, 1)
  assert.equal(f.state().pendingSessionId, undefined)
  await assert.rejects(restarted.open('invalid'), /请选择/)
})

test('an archived partially created reservation is never retried or revived', async t => {
  const f = await fixture(t), manager = f.restart()
  f.failCreate(true)
  await assert.rejects(manager.open('tasks'), /storage offline/)
  const pending = f.state().pendingSessionId
  f.add(pending); f.archived.push(pending)
  f.failCreate(false)
  const result = await f.restart().open('tasks')
  assert.notEqual(result.sessionId, pending)
  assert.deepEqual(f.archived, [pending])
})

test('archive racing selection storage blocks navigation and remains authoritative', async t => {
  const f = await fixture(t), current = f.add('current'), manager = f.restart()
  f.onPut(value => { if (value.selectedModules.current) f.archived.push(current) })
  await assert.rejects(manager.open('archive', current), /已归档/)
  assert.deepEqual(f.archived, [current])
  assert.equal(f.creates.length, 0)
})

test('workbench context follows the current selection and gives direct user requests priority', () => {
  const state = { selectedModules: { chat: 'archive', tasks: 'tasks', quotes: 'quotes' } }
  assert.equal(moduleSessionPrompt(state, undefined), '')
  assert.equal(moduleSessionPrompt(state, 'missing'), '')
  assert.match(moduleSessionPrompt(state, 'chat'), /「需求分析师」/)
  assert.match(moduleSessionPrompt(state, 'chat'), /用户当前问题及 \/ 点名专家优先/)
  state.selectedModules.chat = 'design'
  assert.match(moduleSessionPrompt(state, 'chat'), /「户型设计师」/)
  assert.doesNotMatch(moduleSessionPrompt(state, 'chat'), /「需求分析师」/)
  assert.match(moduleSessionPrompt(state, 'tasks'), /ihome_propose_task/)
  assert.match(moduleSessionPrompt(state, 'quotes'), /报价与合同[\s\S]*ihome_read_quotes[\s\S]*ihome_propose_quote/)
  state.selectedModules.chat = 'budget'
  assert.match(moduleSessionPrompt(state, 'chat'), /「财务经费专员」[\s\S]*ihome_read_expenses[\s\S]*ihome_propose_expense/)
  state.selectedModules.chat = 'fengshui'
  assert.match(moduleSessionPrompt(state, 'chat'), /「风水大师」[\s\S]*ihome_read_design/)
})

test('host rejects legacy restore requests before opening and omits context from child agents', async t => {
  const f = await fixture(t)
  await mountIHomeWorkspace(f.ctx)
  const route = f.routes.find(item => item.path.endsWith('/module-session'))
  const response = await route.fetch(new Request('http://local/api/ihome/module-session', {
    method: 'POST', body: JSON.stringify({ moduleId: 'archive', previousSessionId: 'archived' }) }))
  assert.equal(response.status, 400)
  assert.match((await response.json()).error, /会话列表/)
  assert.equal(f.creates.length, 0)
  await f.table.put('home', { selectedModules: { current: 'archive' } })
  const header = { cwd: iHomeWorkspacePath(), agentPreset: IHOME_TEAM_PRESET_ID }
  assert.match(f.prompts[0].text({ agent: { session: { id: 'current', header } } }), /需求分析师/)
  assert.equal(f.prompts[0].text({ agent: { session: { id: 'current', header: { ...header, origin: 'subagent' } } } }), '')
})


test('a created session survives a failed selection save without duplicate creation', async t => {
  const f = await fixture(t), manager = f.restart()
  f.onPut(value => { if (value.lastSessionId) throw new Error('selection save failed') })
  await assert.rejects(manager.open('archive'), /selection save failed/)
  const pending = f.state().pendingSessionId
  assert.ok(f.headers.has(pending))
  f.onPut(() => {})
  assert.equal((await f.restart().open('tasks')).sessionId, pending)
  assert.equal(f.creates.length, 1)
})
