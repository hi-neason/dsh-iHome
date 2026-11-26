import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { iHomeWorkspacePath } from '../src/ihome-workspace-path.ts'

const bundle = await build({ entryPoints: ['src/archive-host.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { mountArchive } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)

async function fixture(ask, beforeUpdate) {
  let archive, reads = 0, writes = 0
  const registered = []
  const table = {
    get() { reads++; return archive },
    async put(_key, value) { writes++; archive = value },
    async update(_key, transform) { await beforeUpdate?.(); archive = transform(archive); writes++; return archive },
  }
  await mountArchive({
    userQuestions: { ask },
    storageDomain: { open: async () => ({ table: () => table, close: async () => {} }) },
    attachments: {}, connection: { fetch: { register: () => () => {} } },
    tools: { register(tool, options) { registered.push({ tool, options }); return () => {} } },
    effect: async setup => setup(),
  })
  const run = (name, args, execution = context(iHomeWorkspacePath())) => registered.find(item => item.tool.name === name).tool.execute(args, execution)
  return { registered, counts: () => [reads, writes], archive: () => archive, table, run }
}
const context = cwd => ({ signal: new AbortController().signal, agent: { session: { header: { id: 'session', cwd } } } })

test('all household tools hide and refuse execution outside the dedicated workspace', async () => {
  const f = await fixture()
  assert.equal(f.registered.length, 3)
  const initial = f.counts()
  for (const { tool, options } of f.registered) {
    for (const execution of [context('/tmp/ordinary'), context(iHomeWorkspacePath() + '/child'), context(undefined), { signal: new AbortController().signal }]) {
      assert.equal(options.when(execution), false)
      // Model arguments cannot counterfeit the host-owned workspace context.
      await assert.rejects(tool.execute({ cwd: iHomeWorkspacePath(), houseId: 'home' }, execution), /仅在 iHome工作区/)
    }
  }
  assert.deepEqual(f.counts(), initial, 'rejected calls must not read or modify archive storage')
})

const need = { title: '厨房通行', people: ['我'], rooms: ['厨房', '用餐区'], priority: 'must', quote: '希望从厨房端菜到用餐区时通道够宽' }
const fact = { kind: 'fact', text: '每天做饭', people: ['我'], quote: '我每天做饭' }
const measurement = { kind: 'measurement', room: '厨房', label: '台面高度', value: 85, unit: 'cm', source: '实测', date: '2026-11-24', adopted: true, quote: '刚量过台面高85厘米' }
const reply = (id, selected, custom) => ({ answers: [{ id, selected, custom }] })

test('acceptance in the calling conversation commits the displayed need, fact and measurement', async () => {
  const execution = context(iHomeWorkspacePath())
  const requests = []
  const f = await fixture(async request => {
    assert.equal(request.agent, execution.agent)
    assert.equal(request.signal, execution.signal)
    assert.equal(request.questions.length, 1)
    const [question] = request.questions
    assert.deepEqual(question.options.map(o => o.label), ['接受', '不接受'])
    requests.push(question.detail)
    return reply(question.id, ['接受'])
  })
  for (const [tool, args] of [['ihome_propose_need', need], ['ihome_propose_record', fact], ['ihome_propose_record', measurement]]) {
    const result = await f.run(tool, args, execution)
    assert.equal(result.status, 'applied')
    for (const expected of [args.title || args.text || args.label, args.quote]) assert.ok(requests.at(-1).includes(expected))
  }
  const saved = f.archive()
  assert.deepEqual([saved.revision, saved.needs.length, saved.facts.length, saved.measurements.length], [3, 1, 1, 1])
  assert.deepEqual(saved.needs[0].memberIds, [saved.members[0].id])
  assert.deepEqual(saved.rooms.map(room => room.name), ['厨房', '用餐区'])
  assert.deepEqual(saved.needs[0].roomIds, saved.rooms.map(room => room.id))
  const { rooms } = await f.run('ihome_read_archive', {})
  for (const room of rooms) {
    const detail = await f.run('ihome_read_archive', { roomId: room.id })
    assert.deepEqual(detail.needs.map(n => n.id), [saved.needs[0].id])
    assert.deepEqual(detail.needs[0].roomIds, saved.needs[0].roomIds)
    assert.equal(detail.measurements.length, room.name === '厨房' ? 1 : 0)
    assert.ok(!('zones' in detail) && !('zoneIds' in detail.needs[0]))
  }
  const schema = name => f.registered.find(item => item.tool.name === name).tool.parameters
  assert.ok(schema('ihome_propose_need').required.includes('rooms'))
  assert.deepEqual(schema('ihome_propose_need').properties.rooms.items, { type: 'string' })
  assert.ok(!('places' in schema('ihome_propose_need').properties) && !('zone' in schema('ihome_propose_record').properties))
  assert.ok(!('suggestions' in saved) && !('recordSuggestions' in saved))
  assert.equal((await f.run('ihome_propose_need', need, execution)).status, 'unchanged')
  assert.equal(requests.length, 3)
  assert.equal(f.archive().revision, 3)
})

test('decline, feedback, malformed answer and absent conversation provider never write', async () => {
  for (const respond of [
    id => reply(id, ['不接受']), id => reply(id, [], '改成书房'),
    id => reply(id, ['接受'], '请先换人'), id => reply(id, ['接受', '不接受']),
    () => reply('other-question', ['接受']), () => ({ answers: [] }),
  ]) {
    const f = await fixture(async ({ questions: [q] }) => respond(q.id))
    const before = f.archive()
    assert.equal((await f.run('ihome_propose_need', need)).status, 'not_applied')
    assert.equal(f.archive(), before)
    assert.equal(f.counts()[1], 1) // Initial empty archive only.
  }
  const unavailable = await fixture(async () => { throw new Error('NO_PROVIDER') })
  await assert.rejects(unavailable.run('ihome_propose_record', fact), /NO_PROVIDER/)
  assert.equal(unavailable.archive().revision, 0)
})

test('waiting creates no record and a later acceptance cannot overwrite a newer edit', async () => {
  const asked = Promise.withResolvers(), answer = Promise.withResolvers()
  const f = await fixture(async ({ questions: [q] }) => { asked.resolve(q); return answer.promise })
  const change = f.run('ihome_propose_need', need)
  const question = await asked.promise
  assert.equal(f.counts()[1], 1)
  assert.equal(f.archive().needs.length, 0)
  await f.table.update('home', current => ({ ...current, revision: 1, members: [{ id: 'm', name: '外婆', residency: '偶住' }] }))
  answer.resolve(reply(question.id, ['接受']))
  assert.equal((await change).status, 'conflict')
  assert.deepEqual(f.archive().members.map(m => m.name), ['外婆'])
  assert.deepEqual([f.archive().revision, f.archive().needs.length], [1, 0])
})

test('cancelling while awaiting an answer or waiting for storage cannot commit', async () => {
  for (const phase of ['ask', 'write']) {
    const controller = new AbortController()
    const f = await fixture(async ({ questions: [q] }) => {
      if (phase === 'ask') controller.abort()
      return reply(q.id, ['接受'])
    }, () => { if (phase === 'write') controller.abort() })
    const execution = { ...context(iHomeWorkspacePath()), signal: controller.signal }
    await assert.rejects(f.run('ihome_propose_record', measurement, execution), { name: 'AbortError' })
    assert.equal(f.archive().revision, 0)
    assert.equal(f.archive().measurements.length, 0)
  }
})

test('document lookup filters metadata by stage, kind, keyword and room without changing normal reads', async () => {
  const f = await fixture()
  const file = { attachmentId: 'sha256:' + 'a'.repeat(64), name: '资料.pdf', bytes: 100 }
  const base = { houseId: 'home', date: '2026-11-26', roomIds: [], file }
  await f.table.update('home', current => ({ ...current,
    rooms: [{ id: 'kitchen', houseId: 'home', name: '厨房' }],
    attachments: [
      { ...base, id: 'original', name: '原始户型图' },
      { ...base, id: 'material', name: '厨房地砖', stage: 'construction', kind: 'material', roomIds: ['kitchen'], source: '建材商', notes: '型号 A1' },
      { ...base, id: 'quote', name: '施工报价', stage: 'selection', kind: 'document' },
    ],
  }))
  assert.deepEqual(await f.run('ihome_read_archive', {}), { rooms: [{ id: 'kitchen', name: '厨房' }] })
  const original = await f.run('ihome_read_archive', { documentStage: 'original' })
  assert.deepEqual(original.documents.map(item => item.id), ['original'])
  assert.equal(original.documents[0].kind, 'document')
  assert.equal('file' in original.documents[0], false)
  const material = await f.run('ihome_read_archive', { roomId: 'kitchen', documentStage: 'construction', documentKind: 'material', documentQuery: 'a1' })
  assert.deepEqual(material.documents.map(item => item.id), ['material'])
  assert.match(material.documentContent, /未读取文件正文/)
  assert.deepEqual((await f.run('ihome_read_archive', { documentQuery: '不存在' })).documents, [])
  for (const args of [{ documentStage: 'invalid' }, { documentKind: 'invalid' }, { documentQuery: '' }]) await assert.rejects(f.run('ihome_read_archive', args))
})
