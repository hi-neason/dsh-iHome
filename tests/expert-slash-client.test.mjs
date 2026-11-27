import assert from 'node:assert/strict'
import test from 'node:test'
import { createExpertSlashSource, mountExpertSlash } from '../src/expert-slash-client.ts'
import { expertSlashLocales } from '../src/expert-slash-locales.ts'
import { IHOME_TEAM_PRESET_ID } from '../src/agent-presets.ts'

function fixture(t) {
  const original = globalThis.__DSH_TRANSPORT__
  let requests = 0
  globalThis.__DSH_TRANSPORT__ = { fetch: async () => {
    requests++
    return Response.json({ path: '/home/owner/iHome工作区' })
  } }
  t.after(() => { globalThis.__DSH_TRANSPORT__ = original })
  const state = { openState: 'open', removed: false, subagent: null, blank: false }
  let preset = IHOME_TEAM_PRESET_ID
  const entry = { cwd: '/home/owner/iHome工作区' }
  const rows = { team: entry }
  let locale = 'zh'
  const ctx = {
    sessions: {
      refresh: async () => {},
      binding: id => id === 'team' ? { session: {
        getSnapshot: () => state,
        projections: { faceOf: () => ({ getSnapshot: () => preset }) },
      } } : undefined,
      list: { getSnapshot: () => ({ byId: rows }) },
    },
    locale: { bind: () => key => expertSlashLocales[locale][key] },
  }
  return { source: createExpertSlashSource(ctx), ctx, entry, state, rows,
    setPreset: value => { preset = value }, setLocale: value => { locale = value }, requests: () => requests }
}
const session = { sessionId: 'team' }
const request = (query = '', position = 'leading') => ({ query, position, signal: new AbortController().signal })

test('native slash source groups all four experts and supports Chinese, English and localized search', async t => {
  const f = fixture(t)
  const rows = await f.source.candidates(session, request())
  assert.ok(f.source.order < 0, 'show the expert group before native commands and skills')
  assert.deepEqual(rows.map(row => [row.name, row.section]), [['需求分析师', 'iHome专家团'], ['户型设计师', 'iHome专家团'], ['选商核价分析师', 'iHome专家团'], ['任务待办助理', 'iHome专家团']])
  assert.equal((await f.source.candidates(session, request('需分')))[0].name, '需求分析师')
  assert.equal((await f.source.candidates(session, request('TODO')))[0].name, '任务待办助理')
  assert.equal((await f.source.candidates(session, request('floorplan')))[0].name, '户型设计师')
  assert.equal((await f.source.candidates(session, request('报价')))[0].name, '选商核价分析师')
  assert.equal((await f.source.candidates(session, request('vendor')))[0].name, '选商核价分析师')
  assert.deepEqual(await f.source.candidates(session, request('unknown')), [])
  f.setLocale('en')
  const english = await f.source.candidates(session, request('n an'))
  assert.equal(english[0].label, 'Needs Analyst')
  assert.equal(english[0].section, 'iHome Expert Team')
  assert.equal((await f.source.candidates(session, request('contractor')))[0].label, 'Contractor and Quote Analyst')
  assert.equal(f.requests(), 1)
})

test('selection replaces only the leading token and normal send retains native ownership', async t => {
  const { source } = fixture(t)
  const rows = await source.candidates(session, request())
  assert.deepEqual(source.onPick({ session, candidate: rows[3], position: 'leading' }), { text: '/任务待办助理 ' })
  // Undefined preserves DSH's normal send path, including its attachments,
  // cancellation and queue/steer mode instead of a separate command submit.
  assert.equal(await source.matchEnter(session, '/任务待办助理 下周安排量房', new AbortController().signal, { attachments: 2 }), undefined)
  assert.equal(await source.matchEnter(session, '/需求分析师\n我需要适老化设计', new AbortController().signal), undefined)
  await assert.rejects(source.matchEnter(session, '/需求分析师 ', new AbortController().signal), /填写/)
  assert.equal(await source.matchEnter(session, '/compact', new AbortController().signal), undefined)
  assert.equal(source.onPick({ session, candidate: rows[0], position: 'inline' }), undefined)
  assert.equal(source.onPick({ session, candidate: { name: '伪造专家' }, position: 'leading' }), undefined)
})

test('standard and team modes both allow experts while workspace and subagent gates remain live', async t => {
  const f = fixture(t)
  assert.deepEqual(await f.source.candidates({ sessionId: 'missing' }, request()), [])
  assert.deepEqual(await f.source.candidates(session, request('', 'inline')), [])
  assert.equal(f.requests(), 0)
  const [row] = await f.source.candidates(session, request())
  f.setPreset('standard')
  assert.deepEqual(f.source.onPick({ session, candidate: row, position: 'leading' }), { text: '/需求分析师 ' })
  assert.equal((await f.source.candidates(session, request())).length, 4)
  assert.equal(await f.source.matchEnter(session, '/需求分析师 帮我', new AbortController().signal), undefined)
  f.setPreset(IHOME_TEAM_PRESET_ID)
  f.entry.cwd = '/different-workspace'
  assert.equal(f.source.onPick({ session, candidate: row, position: 'leading' }), undefined)
  await assert.rejects(f.source.matchEnter(session, '/需求分析师 帮我', new AbortController().signal), /iHome工作区/)
  assert.deepEqual(await f.source.candidates(session, request()), [])
  f.entry.cwd = '/home/owner/iHome工作区'
  f.state.subagent = { address: {} }
  assert.deepEqual(await f.source.candidates(session, request()), [])
  f.state.subagent = null
  f.state.removed = true
  assert.deepEqual(await f.source.candidates(session, request()), [])
})

test('a cancelled menu request leaves a later opening usable and failure permits retry', async t => {
  const f = fixture(t)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(f.source.candidates(session, { ...request(), signal: controller.signal }), /abort/i)
  assert.equal(f.requests(), 0)
  let count = 0
  globalThis.__DSH_TRANSPORT__.fetch = async () => {
    if (++count === 1) throw new Error('offline')
    return Response.json({ path: '/home/owner/iHome工作区' })
  }
  await assert.rejects(f.source.candidates(session, request()), /offline/)
  assert.equal((await f.source.candidates(session, request())).length, 4)
})

test('plugin lifecycle registers and disposes the native source and localized dictionaries', t => {
  const f = fixture(t)
  const disposers = [], events = []
  mountExpertSlash({ ...f.ctx,
    effect: setup => { disposers.push(setup()) },
    locale: { ...f.ctx.locale, register: namespace => { events.push(namespace); return () => events.push('locale disposed') } },
    inputTriggers: { registerSource: source => { events.push(source.name); return () => events.push('source disposed') } },
  })
  assert.deepEqual(events, ['ihome.experts', 'ihome-experts'])
  for (const dispose of disposers.reverse()) dispose()
  assert.deepEqual(events.slice(-2), ['source disposed', 'locale disposed'])
})


test('blank root sessions use host cwd and recover a missing catalog row without inventing a session', async t => {
  const f = fixture(t)
  f.state.blank = true
  f.setPreset('standard')
  delete f.rows.team
  let refreshes = 0
  f.ctx.sessions.refresh = async () => { refreshes++; f.rows.team = f.entry }
  assert.equal((await f.source.candidates(session, request())).length, 4)
  assert.equal(refreshes, 1)
  assert.equal(await f.source.matchEnter(session, '/任务待办助理 帮我安排量房', new AbortController().signal), undefined)
  delete f.rows.team
  f.ctx.sessions.refresh = async () => { refreshes++ }
  assert.deepEqual(await f.source.candidates(session, request()), [])
  await assert.rejects(f.source.matchEnter(session, '/需求分析师 帮我', new AbortController().signal), /主会话/)
  f.state.openState = 'opening'
  assert.deepEqual(await f.source.candidates(session, request()), [])
  const calls = refreshes
  await assert.rejects(f.source.matchEnter({ sessionId: 'missing' }, '/需求分析师 帮我', new AbortController().signal), /主会话/)
  assert.equal(refreshes, calls)
})
