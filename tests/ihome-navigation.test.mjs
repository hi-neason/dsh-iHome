import test from 'node:test'
import assert from 'node:assert/strict'
import { createIHomeNavigation } from '../src/ihome-navigation.ts'

const path = '/home/owner/iHome工作区'
function fixture(t, respond) {
  const previous = globalThis.__DSH_TRANSPORT__
  const requests = []
  globalThis.__DSH_TRANSPORT__ = { fetch: async (url, init) => {
    const body = JSON.parse(init.body)
    requests.push([url, body])
    return Response.json(await respond(url, body))
  } }
  t.after(() => { globalThis.__DSH_TRANSPORT__ = previous })
  let signal = new AbortController()
  let mounted
  let activePanelId = 'ihome'
  const calls = []
  const rows = Object.fromEntries(['existing', 'new', 'manual', 'other'].map(id => [id, { cwd: id === 'other' ? '/different' : path, retainedBy: {} }]))
  const workspace = { phase: 'ready', archivedSessionIds: [] }
  const select = id => {
    for (const row of Object.values(rows)) row.retainedBy = {}
    if (rows[id]) rows[id].retainedBy.mainView = 1
    mounted = id
  }
  const ctx = {
    layout: {
      beginNavigation() { signal.abort(); signal = new AbortController(); return signal.signal },
      panelInfo: { getSnapshot: () => ({ activePanelId }) },
      selectPanel(panel) { signal.abort(); activePanelId = panel; calls.push(['panel', panel]) },
    },
    uiWorkspace: { openSession(id) { signal.abort(); select(id); activePanelId = null; calls.push(['session', id]) } },
    sidebarRight: { mounted: { getSnapshot: () => mounted }, openTab(kind) { calls.push(['tab', kind]) } },
    workspaces: { list: { getSnapshot: () => workspace } },
    sessions: {
      list: { getSnapshot: () => ({ ids: Object.keys(rows), byId: rows }) },
      refresh: async () => {},
      retain(id) { calls.push(['retain', id]); return { ready: Promise.resolve({ sessionId: id }), release() { calls.push(['release']) } } },
    },
    conversation: { input: { requestDraftInitialization(b, options) { calls.push(['draft', b, options]); return 'applied' } } },
  }
  return { navigation: createIHomeNavigation(ctx), ctx, calls, requests, rows, workspace, select,
    panel(value) { activePanelId = value }, mounted(value) { mounted = value } }
}
const normal = (url, body) => url.endsWith('workspace')
  ? { workspaceId: 'ihome', path, selectedModules: { existing: 'archive' } }
  : { workspaceId: 'ihome', path, moduleId: body.moduleId, sessionId: body.currentSessionId ?? 'new' }

test('home uses the native current conversation and reveals it without reopening or replacing its draft', async t => {
  const f = fixture(t, normal)
  f.select('existing')
  await f.navigation.openModule('tasks')
  assert.equal(f.requests.at(-1)[1].currentSessionId, 'existing')
  assert.deepEqual(f.calls, [['panel', null], ['tab', 'ihome-workbench']])
  assert.equal(f.navigation.getSnapshot().selectedModules.existing, 'tasks')
  await f.navigation.prepareDraft('existing', '需求')
  assert.deepEqual(f.calls.slice(2), [['retain', 'existing'], ['draft', { sessionId: 'existing' }, { prompt: '需求', whenDraftExists: 'append' }], ['release']])
})

test('all expert workbenches switch in the same manually-created conversation', async t => {
  const f = fixture(t, normal)
  f.select('manual'); f.panel(null)
  for (const id of ['archive', 'tasks', 'design', 'quotes', 'knowledge', 'documents']) {
    await f.navigation.openModule(id, 'manual')
    assert.equal(f.navigation.getSnapshot().selectedModules.manual, id)
  }
  assert.ok(f.calls.every(call => call[0] === 'tab'))
  assert.ok(f.requests.filter(([url]) => url.endsWith('module-session')).every(([, body]) => body.currentSessionId === 'manual'))
})

test('no selected conversation opens the newly resolved session before its sidebar', async t => {
  const f = fixture(t, normal)
  await f.navigation.openModule('archive')
  assert.equal(f.requests.at(-1)[1].currentSessionId, undefined)
  assert.deepEqual(f.calls, [['session', 'new'], ['tab', 'ihome-workbench']])
})

test('home passes the displayed child even when native history lists only roots', async t => {
  const f = fixture(t, (url, body) => url.endsWith('module-session')
    ? { workspaceId: 'ihome', path, moduleId: body.moduleId, sessionId: 'new' }
    : normal(url, body))
  const ids = Object.keys(f.rows)
  f.rows.child = { parentId: 'existing', origin: 'subagent', retainedBy: {} }
  f.select('child')
  f.ctx.sessions.list.getSnapshot = () => ({ ids, byId: f.rows })
  await f.navigation.openModule('design')
  assert.equal(f.requests.at(-1)[1].currentSessionId, 'child')
  assert.deepEqual(f.calls, [['session', 'new'], ['tab', 'ihome-workbench']])
})

test('navigating elsewhere during host resolution prevents late takeover and selection updates', async t => {
  const pending = Promise.withResolvers(), started = Promise.withResolvers()
  const f = fixture(t, async (url, body) => {
    if (url.endsWith('module-session')) { started.resolve(); await pending.promise }
    return normal(url, body)
  })
  const opening = f.navigation.openModule('archive')
  await started.promise
  f.ctx.layout.beginNavigation()
  pending.resolve()
  await opening
  assert.deepEqual(f.calls, [])
  assert.equal(f.navigation.getSnapshot().selectedModules.new, undefined)
})

test('a session archived during resolution stays closed and receives no workbench update', async t => {
  const f = fixture(t, normal)
  f.select('existing')
  f.ctx.sessions.refresh = async () => { f.workspace.archivedSessionIds.push('existing') }
  await assert.rejects(f.navigation.openModule('tasks'), /已归档/)
  assert.deepEqual(f.calls, [])
  assert.equal(f.navigation.getSnapshot().selectedModules.existing, 'archive')
})

test('archival while waiting for the sidebar stops the pending open', async t => {
  const f = fixture(t, normal)
  f.select('existing'); f.mounted(undefined); f.panel(null)
  const pending = f.navigation.openModule('tasks')
  setTimeout(() => { f.workspace.archivedSessionIds.push('existing') }, 1)
  await assert.rejects(pending, /已归档/)
  assert.deepEqual(f.calls, [])
})

test('native history selection restores only the workbench choice and permits independent sessions', async t => {
  const f = fixture(t, normal)
  await f.navigation.initialize()
  assert.deepEqual(f.navigation.getSnapshot().selectedModules, { existing: 'archive' })
  f.select('manual'); f.panel(null)
  await f.navigation.openModule('tasks')
  assert.deepEqual(f.navigation.getSnapshot().selectedModules, { existing: 'archive', manual: 'tasks' })
})

test('drafts can use manual iHome sessions, and reject archived, external and child sessions', async t => {
  const f = fixture(t, normal)
  await f.navigation.prepareDraft('manual', '需求')
  assert.equal(f.calls[1][0], 'draft')
  f.workspace.archivedSessionIds.push('existing')
  f.rows.child = { cwd: path, parentId: 'manual', origin: 'subagent', retainedBy: {} }
  for (const id of ['existing', 'other', 'child', 'missing']) await assert.rejects(f.navigation.prepareDraft(id, '需求'), /已归档、移除或不在/)
  assert.equal(f.calls.filter(call => call[0] === 'retain').length, 1)
})

test('draft reference releases when native input blocks or its session is archived while retaining', async t => {
  const f = fixture(t, normal)
  f.ctx.conversation.input.requestDraftInitialization = () => 'blocked'
  await assert.rejects(f.navigation.prepareDraft('manual', '需求'), /无法填写草稿/)
  assert.deepEqual(f.calls.at(-1), ['release'])
  f.ctx.sessions.retain = id => ({ ready: Promise.resolve().then(() => {
    f.workspace.archivedSessionIds.push(id); return { sessionId: id }
  }), release() { f.calls.push(['released after archive']) } })
  await assert.rejects(f.navigation.prepareDraft('manual', '需求'), /已归档/)
  assert.deepEqual(f.calls.at(-1), ['released after archive'])
})

test('reopening the design workbench returns to its scheme directory within the same chat', async t => {
  const f = fixture(t, normal)
  f.select('manual'); f.panel(null)
  await f.navigation.openModule('design', 'manual')
  const first = f.navigation.getSnapshot().designEntries.manual
  await f.navigation.openModule('design', 'manual')
  assert.ok(f.navigation.getSnapshot().designEntries.manual > first)
  assert.ok(f.calls.every(call => call[0] === 'tab'))
})
