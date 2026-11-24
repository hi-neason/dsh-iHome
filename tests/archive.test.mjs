import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { prepareArchiveChange, createArchive, currentHouse, memberReferences, removeMember, storeNeed, validateArchive } from '../src/archive-model.ts'
import { inspectBackup, packArchive, restoreFiles } from '../src/archive-backup.ts'

const dinner = {
  houseId: 'home', title: '两人做饭时保留一条通路', people: ['我', '妈妈'],
  places: [{ room: '厨房', zone: '水槽旁' }, { room: '餐厅', zone: '餐边柜' }],
  priority: 'must', quote: '端菜时我们总要互相让。',
}

test('member attributes preserve unknown legacy values and exact multiline text through backups', async () => {
  const legacy = { id: 'legacy', name: '家人', residency: '待确认' }
  const needsText = '  希望睡觉时房间安静。\n\n' + '需要给阅读、收纳和活动留出位置。'.repeat(120) + '\n  '
  const members = [
    legacy,
    { id: 'newborn', name: '宝宝', residency: '常住', gender: '女', age: 0, needsText },
    { id: 'visitor', name: '客人', residency: '偶住', gender: '男', age: 30, needsText: '' },
    { id: 'other', name: '另一位家人', residency: '常住', gender: '其他' },
  ]
  const archive = { ...createArchive(), members }
  const parsed = validateArchive(JSON.parse(JSON.stringify(archive)))
  assert.deepEqual(parsed.members, members)
  for (const field of ['gender', 'age', 'needsText']) assert.equal(Object.hasOwn(parsed.members[0], field), false)
  const preview = await inspectBackup(await packArchive(parsed, {
    downloadFile: async () => { throw new Error('no attachments expected') },
  }))
  assert.deepEqual(preview.archive.members, members)
  assert.equal(preview.archive.members[1].needsText, needsText)

  const withNeed = storeNeed(archive, { ...dinner, people: ['宝宝'] })
  assert.deepEqual(withNeed.members, members)
  const confirmed = prepareArchiveChange(withNeed, 'record', {
    kind: 'fact', text: '喜欢安静的环境', people: ['宝宝', '新称呼'], quote: '需要安静',
  }).next
  assert.deepEqual(confirmed.members.find(member => member.id === 'newborn'), members[1])
  const created = confirmed.members.find(member => member.name === '新称呼')
  assert.equal(created.residency, '待确认')
  for (const field of ['gender', 'age', 'needsText']) assert.equal(Object.hasOwn(created, field), false)
})

test('member attributes reject malformed ages, genders and requirement text', () => {
  const base = { id: 'person', name: '家人', residency: '常住' }
  for (const age of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, '20', null]) {
    assert.throws(() => validateArchive({ ...createArchive(), members: [{ ...base, age }] }), /年龄/)
  }
  for (const gender of ['', '未知', 1, null]) {
    assert.throws(() => validateArchive({ ...createArchive(), members: [{ ...base, gender }] }), /选项/)
  }
  for (const needsText of [1, null, [], {}]) {
    assert.throws(() => validateArchive({ ...createArchive(), members: [{ ...base, needsText }] }), /居住需求/)
  }
})

test('unused members can be removed without changing the input archive', () => {
  const mom = { id: 'mom', name: '妈妈', residency: '常住' }
  const dad = { id: 'dad', name: '爸爸', residency: '常住' }
  const archive = { ...createArchive(), members: [mom, dad] }
  assert.deepEqual(memberReferences(archive, mom), { needs: [], facts: [] })
  assert.deepEqual(validateArchive(removeMember(archive, 'mom')).members, [dad])
  assert.deepEqual(archive.members, [mom, dad])
})

test('confirmed requirements and habits protect the member and identify the references', () => {
  const a = storeNeed(createArchive(), dinner)
  const member = a.members[0]
  a.facts = [{ id: 'habit', text: '晚饭后看书', memberIds: [member.id] }]
  const refs = memberReferences(a, member)
  assert.equal(refs.needs[0].title, dinner.title)
  assert.equal(refs.facts[0].text, a.facts[0].text)
  for (const archive of [a, { ...a, needs: [] }, { ...a, facts: [] }]) {
    assert.throws(() => removeMember(archive, member.id), /已入档/)
  }
  const cleared = validateArchive(removeMember({ ...a, needs: [], facts: [] }, member.id))
  assert.deepEqual(cleared.members, a.members.slice(1))
})

test('a confirmed need links multiple people and specific zones in their own rooms', () => {
  let a = createArchive()
  a.houses.push({ id: 'other', name: '另一套房屋' })
  a = storeNeed(a, dinner)
  a = storeNeed(a, { ...dinner, houseId: 'other' })
  assert.equal(a.members.length, 2)
  assert.equal(a.rooms.length, 4)
  assert.equal(a.zones.length, 4)
  assert.equal(a.members[0].residency, '待确认')
  assert.equal(a.needs[0].memberIds.length, 2)
  assert.deepEqual(a.needs[0].zoneIds, a.zones.slice(0, 2).map(z => z.id))
  assert.throws(() => storeNeed(a, { ...dinner, people: [] }), /家人/)
  assert.throws(() => storeNeed(a, { ...dinner, places: [] }), /区域/)
  assert.throws(() => validateArchive({ ...a, needs: [{ ...a.needs[0], zoneIds: a.needs[1].zoneIds }] }), /当前房屋/)
  assert.throws(() => validateArchive({ ...a, members: [] }), /家人/)
})

test('conversation previews are isolated, deduplicate exact retries and preserve linked facts on updates', () => {
  const archive = createArchive()
  const before = structuredClone(archive)
  const change = prepareArchiveChange(archive, 'need', dinner)
  assert.deepEqual(archive, before)
  assert.equal(change.changed, true)
  assert.equal(change.next.revision, archive.revision)
  assert.equal(change.next.needs.length, 1)
  assert.match(change.summary, /同时添加家人.*我、妈妈/)
  assert.match(change.summary, /厨房 \/ 水槽旁/)
  assert.equal(Object.hasOwn(change.next, 'suggestions'), false)
  assert.equal(prepareArchiveChange(change.next, 'need', dinner).changed, false)
  const a = change.next
  a.facts = [{ id: 'fact', text: '下厨时通道拥挤', memberIds: [a.members[0].id] }]
  a.needs[0].factIds = ['fact']
  const { id, version } = a.needs[0]
  const updated = prepareArchiveChange(a, 'need', { ...dinner, title: '扩大通道', targetNeedId: id, targetVersion: version })
  assert.equal(updated.next.needs[0].version, version + 1)
  assert.deepEqual(updated.next.needs[0].factIds, ['fact'])
  assert.match(updated.summary, /修改前[\s\S]*两人做饭[\s\S]*修改后[\s\S]*扩大通道/)
  assert.throws(() => prepareArchiveChange(updated.next, 'need', { ...dinner, targetNeedId: id, targetVersion: version }), /已被修改/)
  assert.throws(() => prepareArchiveChange(a, 'need', { ...dinner, targetNeedId: id }), /编号和版本/)
  assert.throws(() => prepareArchiveChange(a, 'need', { ...dinner, targetVersion: version }), /编号和版本/)
})

test('portable backup retains exact originals, restores aliases, and detects damaged content', async () => {
  const blob = new Blob([new Uint8Array([0, 12, 33, 255, 199])])
  const bytes = Buffer.from(await blob.arrayBuffer())
  const digest = data => 'sha256:' + createHash('sha256').update(data).digest('hex')
  const a = storeNeed(createArchive(), dinner)
  a.attachments = ['图纸.png', '平面图.png'].map((name, i) => ({
    id: 'file' + i, houseId: 'home', name, date: '2026-11-24', roomIds: [a.rooms[0].id],
    file: { attachmentId: digest(bytes), name, bytes: bytes.length },
  }))
  const names = []
  const service = { downloadFile: async () => blob, uploadFile: async file => {
    names.push(file.name)
    return { attachmentId: digest(Buffer.from(await file.arrayBuffer())), name: file.name, bytes: file.size }
  } }
  const packed = await packArchive(a, service)
  const preview = await inspectBackup(packed)
  assert.deepEqual(preview.archive, a)
  assert.equal(preview.files.size, 1)
  await restoreFiles(preview, service)
  assert.deepEqual(names, a.attachments.map(f => f.name))
  await assert.rejects(inspectBackup(packed.slice(0, -1)))
  const damaged = new Blob([packed.slice(0, -1), new Uint8Array([0])])
  await assert.rejects(restoreFiles(await inspectBackup(damaged), service), /附件校验失败/)
})

test('measurement previews retain history and exact retries do not duplicate the new measurement', () => {
  const a = storeNeed(createArchive(), dinner)
  const room = a.rooms[0]
  a.measurements = [{ id: 'old', roomId: room.id, label: '净宽', value: 2.4, unit: 'm', source: '估算', date: '2026-11-15', adopted: true }]
  const input = { kind: 'measurement', room: room.name, label: '净宽', value: 2.32, unit: 'm',
    source: '实测', date: '2026-11-23', adopted: true, previousMeasurementId: 'old', quote: '昨天师傅量了，是 2.32 米。' }
  const change = prepareArchiveChange(a, 'record', input)
  assert.equal(a.measurements.length, 1)
  assert.equal(a.measurements[0].adopted, true)
  assert.deepEqual(change.next.measurements.map(m => [m.value, m.adopted]), [[2.4, false], [2.32, true]])
  assert.equal(change.next.measurements[0].id, 'old')
  assert.match(change.summary, /保留已有尺寸[\s\S]*2.4 m[\s\S]*本次尺寸[\s\S]*2.32 m/)
  assert.equal(prepareArchiveChange(change.next, 'record', input).changed, false)
  assert.throws(() => prepareArchiveChange(a, 'record', { ...input, room: '书房' }), /位置或测量项目/)
  assert.throws(() => prepareArchiveChange(a, 'record', { ...input, date: '2026-02-30' }), /日期/)
  assert.throws(() => prepareArchiveChange(a, 'record', { ...input, value: 0 }), /尺寸/)
})

test('living fact previews retain people and quotation with duplicate detection', () => {
  const input = { kind: 'fact', text: '周末两人一起做饭。', people: ['我', '伴侣'], quote: '我们周六一般一起下厨。' }
  const a = createArchive()
  const change = prepareArchiveChange(a, 'record', input)
  assert.equal(a.facts.length + a.members.length, 0)
  assert.deepEqual(change.next.facts[0].memberIds, change.next.members.map(m => m.id))
  assert.equal(prepareArchiveChange(change.next, 'record', input).changed, false)
  const fact = change.next.facts[0]
  const edited = prepareArchiveChange(change.next, 'record', {
    ...input, targetFactId: fact.id, text: '每天一起做饭。', quote: '最近每天都一起做饭了。',
  })
  assert.equal(edited.next.facts.length, 1)
  assert.equal(edited.next.facts[0].id, fact.id)
  assert.equal(edited.next.facts[0].quote, '最近每天都一起做饭了。')
  assert.match(edited.summary, /修改前[\s\S]*周末[\s\S]*修改后[\s\S]*每天/)
  assert.throws(() => prepareArchiveChange(a, 'record', { ...input, targetFactId: 'missing' }), /不存在/)
  assert.throws(() => prepareArchiveChange(a, 'record', { ...input, people: [] }), /家人/)
})

test('legacy archives discard only unconfirmed queues while retaining confirmed data and backups', async () => {
  const a = storeNeed(createArchive(), dinner)
  a.houses.push({ id: 'legacy', name: '旧版房屋' })
  const confirmed = storeNeed(a, { ...dinner, houseId: 'legacy', title: '旧版需求' })
  const legacy = { ...confirmed, suggestions: [{ id: 'pending', ...dinner }],
    recordSuggestions: [{ id: 'pending-fact', kind: 'fact', text: '未确认事实', people: ['新家人'] }] }
  assert.deepEqual(validateArchive(legacy), confirmed)
  assert.equal(currentHouse(confirmed).id, 'home')
  for (const kind of ['need', 'record']) assert.throws(() => prepareArchiveChange(confirmed, kind, { ...dinner, houseId: 'legacy' }), /当前家庭档案/)
  const preview = await inspectBackup(await packArchive(legacy, { downloadFile: async () => { throw new Error('unexpected file') } }))
  assert.deepEqual(preview.archive, confirmed)
  assert.equal(preview.archive.needs.find(n => n.houseId === 'legacy').title, '旧版需求')
  assert.equal(preview.archive.members.length, 2)
})

test('conversation writes default to the current house and retain complete long preview text', () => {
  const { houseId, ...input } = dinner
  const longQuote = '这是完整的生活原话。'.repeat(1000)
  const change = prepareArchiveChange(createArchive(), 'need', { ...input, quote: longQuote })
  assert.equal(change.next.needs[0].houseId, 'home')
  assert.ok(change.summary.includes(longQuote))
  const fact = prepareArchiveChange(change.next, 'record', { kind: 'fact', text: '下午看书', people: ['我'], quote: '下午看书' })
  assert.equal(fact.next.facts.length, 1)
  assert.equal(Object.hasOwn(fact.next, 'recordSuggestions'), false)
})
