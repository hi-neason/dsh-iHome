import test from 'node:test'
import assert from 'node:assert/strict'
import { createIHomeNavigation } from '../src/ihome-navigation.ts'

function fixture(t, respond) {
  const previous = globalThis.__DSH_TRANSPORT__
  globalThis.__DSH_TRANSPORT__ = { fetch: async (url, init) => Response.json(await respond(url, JSON.parse(init.body))) }
  t.after(() => { globalThis.__DSH_TRANSPORT__ = previous })
  let signal = new AbortController()
  let mounted
  const calls = []
  const binding = { sessionId: 'archive-session' }
  const ctx = {
    layout: { beginNavigation() { signal.abort(); signal = new AbortController(); return signal.signal } },
    uiWorkspace: { openSession(id) { signal.abort(); mounted = id; calls.push(['session', id]) } },
    sidebarRight: { mounted: { getSnapshot: () => mounted }, openTab(kind) { calls.push(['tab', kind]) } },
    sessions: { refresh: async () => {}, retain(id) { calls.push(['retain', id]); return { ready: Promise.resolve(binding), release() { calls.push(['release']) } } } },
    conversation: { input: { requestDraftInitialization(b, options) { calls.push(['draft', b, options]); return 'applied' } } },
  }
  return { navigation: createIHomeNavigation(ctx), ctx, calls, binding }
}
const normal = (url, body) => url.endsWith('workspace')
  ? { workspaceId: 'ihome', moduleSessions: { archive: 'archive-session' } }
  : { workspaceId: 'ihome', moduleId: body.moduleId, sessionId: `${body.moduleId}-session` }

test('module opens native session before right sidebar, and existing draft receives append', async t => {
  const { navigation, calls, binding } = fixture(t, normal)
  await navigation.openModule('archive')
  assert.deepEqual(calls, [['session', 'archive-session'], ['tab', 'ihome-workbench']])
  await navigation.prepareDraft('archive-session', '需求')
  assert.deepEqual(calls.slice(2), [['retain', 'archive-session'], ['draft', binding, { prompt: '需求', whenDraftExists: 'append' }], ['release']])
  await assert.rejects(navigation.prepareDraft('unrelated', '需求'), /选择一个 iHome 模块/)
})

test('navigating elsewhere during host creation prevents late session takeover', async t => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const { navigation, ctx, calls } = fixture(t, async (url, body) => {
    if (url.endsWith('module-session')) await pending
    return normal(url, body)
  })
  await navigation.initialize()
  const opening = navigation.openModule('archive')
  ctx.layout.beginNavigation()
  release()
  await opening
  assert.deepEqual(calls, [])
})

test('restored sessions resolve module from persistent host index', async t => {
  const { navigation } = fixture(t, normal)
  await navigation.initialize()
  assert.equal(navigation.getSnapshot().archive, 'archive-session')
})

test('draft reference releases when native input blocks', async t => {
  const { navigation, ctx, calls } = fixture(t, normal)
  await navigation.initialize()
  ctx.conversation.input.requestDraftInitialization = () => 'blocked'
  await assert.rejects(navigation.prepareDraft('archive-session', '需求'), /无法填写草稿/)
  assert.deepEqual(calls.at(-1), ['release'])
})
