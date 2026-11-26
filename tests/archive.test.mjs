import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { prepareArchiveChange, createArchive, currentHouse, memberReferences, removeMember, removeAttachment, storeNeed, validateArchive } from '../src/archive-model.ts'
import { inspectBackup, packArchive, restoreFiles } from '../src/archive-backup.ts'

const dinner = {
  houseId: 'home', title: '两人做饭时保留一条通路', people: ['我', '妈妈'],
  rooms: ['厨房', '餐厅'],
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

test('a confirmed need links multiple people and flat rooms or areas in their own house', () => {
  let a = createArchive()
  a.houses.push({ id: 'other', name: '另一套房屋' })
  a = storeNeed(a, dinner)
  a = storeNeed(a, { ...dinner, houseId: 'other' })
  assert.equal(a.members.length, 2)
  assert.equal(a.rooms.length, 4)
  assert.equal(a.members[0].residency, '待确认')
  assert.equal(a.needs[0].memberIds.length, 2)
  assert.deepEqual(a.needs[0].roomIds, a.rooms.slice(0, 2).map(r => r.id))
  assert.throws(() => storeNeed(a, { ...dinner, people: [] }), /家人/)
  assert.throws(() => storeNeed(a, { ...dinner, rooms: [] }), /区域/)
  assert.throws(() => validateArchive({ ...a, needs: [{ ...a.needs[0], roomIds: a.needs[1].roomIds }] }), /当前房屋/)
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
  assert.match(change.summary, /厨房、餐厅/)
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

test('document metadata survives validation and backup while legacy attachments keep their shape', async () => {
  const bytes = new TextEncoder().encode('original document')
  const file = { attachmentId: 'sha256:' + createHash('sha256').update(bytes).digest('hex'), name: 'plan.pdf', bytes: bytes.length }
  const legacy = { id: 'legacy', houseId: 'home', name: '原始户型图', roomIds: [], date: '2026-11-26', file }
  const material = { ...legacy, id: 'material', name: '地板样本', stage: 'construction', kind: 'material', source: '商家', notes: '型号 A1' }
  const archive = { ...createArchive(), attachments: [legacy, material] }
  assert.deepEqual(validateArchive(archive).attachments, [legacy, material])
  const backup = await packArchive(archive, { downloadFile: async () => new Blob([bytes]) })
  assert.deepEqual((await inspectBackup(backup)).archive.attachments, [legacy, material])
  for (const fields of [{ stage: 'unknown' }, { kind: 'unknown' }, { notes: 1 }]) {
    assert.throws(() => validateArchive({ ...archive, attachments: [{ ...legacy, ...fields }] }))
  }
})


test('referenced documents cannot be removed and other archive records stay intact', () => {
  const attachment = { id: 'file', houseId: 'home', name: '依据.pdf', date: '2026-11-26', roomIds: [],
    file: { attachmentId: 'sha256:' + 'a'.repeat(64), name: '依据.pdf', bytes: 4 } }
  const a = { ...createArchive(), attachments: [attachment] }
  assert.equal(removeAttachment(a, 'file').attachments.length, 0)
  assert.equal(a.attachments.length, 1)
  assert.throws(() => removeAttachment({ ...a, decisions: [{ attachmentIds: ['file'] }] }, 'file'), /引用/)
  assert.throws(() => removeAttachment({ ...a, measurements: [{ attachmentId: 'file' }] }, 'file'), /引用/)
  assert.throws(() => removeAttachment(a, 'missing'), /已被移除/)
})

function legacyLocations() {
  const a = storeNeed(createArchive(), dinner)
  const [kitchen, dining] = a.rooms
  const zones = [
    { id: 'sink', roomId: kitchen.id, name: '水槽旁' },
    { id: 'window', roomId: kitchen.id, name: '窗边' },
    { id: 'cabinet', roomId: dining.id, name: '餐边柜' },
  ]
  const { roomIds, ...need } = a.needs[0]
  return { ...a, zones, needs: [{ ...need, zoneIds: zones.map(zone => zone.id) }] }
}

test('legacy zone links collapse to parent rooms without changing confirmed records or backup round trips', async () => {
  const legacy = legacyLocations()
  const need = legacy.needs[0]
  legacy.facts = [{ id: 'fact', text: '一起做饭', memberIds: need.memberIds, quote: '原话' }]
  need.factIds = ['fact']
  legacy.decisions = [{ id: 'decision', houseId: 'home', text: '扩大通道', reason: '避免拥挤', needIds: [need.id], attachmentIds: [] }]
  const original = structuredClone(legacy)
  const a = validateArchive(legacy)
  assert.deepEqual(legacy, original)
  assert.deepEqual(a.needs[0].roomIds, legacy.rooms.map(room => room.id))
  const { zoneIds, ...oldNeed } = need
  assert.deepEqual(a.needs[0], { ...oldNeed, roomIds: a.rooms.map(room => room.id) })
  assert.deepEqual(a.facts, legacy.facts)
  assert.deepEqual(a.decisions, legacy.decisions)
  assert.equal(Object.hasOwn(a, 'zones'), false)
  assert.equal(Object.hasOwn(a.needs[0], 'zoneIds'), false)
  assert.deepEqual(validateArchive(a), a)
  const service = { downloadFile: async () => { throw new Error('no files') } }
  const restored = (await inspectBackup(await packArchive(legacy, service))).archive
  assert.deepEqual(restored, a)
  assert.deepEqual((await inspectBackup(await packArchive(restored, service))).archive, a)
})

test('legacy migration rejects missing, duplicate, cross-house and mismatched zone references', () => {
  const a = legacyLocations()
  assert.throws(() => validateArchive({ ...a, zones: [] }), /区域不存在/)
  const { zones, ...withoutZones } = a
  assert.throws(() => validateArchive(withoutZones), /区域不存在/)
  const flat = validateArchive(a)
  assert.throws(() => validateArchive({ ...flat, measurements: [{ roomId: flat.rooms[0].id, zoneId: 'sink' }] }), /尺寸记录/)
  assert.throws(() => validateArchive({ ...flat, needs: [{ ...flat.needs[0], zoneIds: ['sink'] }] }), /区域不存在/)
  assert.throws(() => validateArchive({ ...a, zones: [...a.zones, a.zones[0]] }), /重复编号/)
  assert.throws(() => validateArchive({ ...a, needs: [{ ...a.needs[0], zoneIds: ['sink', 'sink'] }] }), /区域不存在/)
  assert.throws(() => validateArchive({ ...a, houses: [...a.houses, { id: 'other', name: '另一套' }],
    rooms: a.rooms.map(room => ({ ...room, houseId: 'other' })) }), /当前房屋/)
  assert.throws(() => validateArchive({ ...a, measurements: [{ roomId: a.rooms[0].id, zoneId: 'cabinet' }] }), /尺寸记录/)
})

test('legacy measurement collisions retain adopted values, historical grouping and stable labels', () => {
  const a = legacyLocations()
  const base = { roomId: a.rooms[0].id, label: '净宽', value: 2, unit: 'm', source: '实测', date: '2026-11-26', adopted: true }
  a.measurements = [
    { ...base, id: 'sink-old', zoneId: 'sink', adopted: false, value: 1.9 },
    { ...base, id: 'sink-new', zoneId: 'sink' },
    { ...base, id: 'window', zoneId: 'window', value: 3 },
    { ...base, id: 'whole', value: 4 },
    { ...base, id: 'existing-label', label: '净宽（水槽旁）', value: 5 },
  ]
  const migrated = validateArchive(a)
  assert.deepEqual(migrated.measurements.map(m => [m.id, m.value, m.adopted]), a.measurements.map(m => [m.id, m.value, m.adopted]))
  assert.equal(migrated.measurements[0].label, migrated.measurements[1].label)
  assert.match(migrated.measurements[0].label, /水槽旁/)
  assert.equal(new Set(migrated.measurements.filter(m => m.adopted).map(m => m.label)).size, 4)
  assert.ok(migrated.measurements.every(m => !Object.hasOwn(m, 'zoneId')))
  assert.deepEqual(validateArchive(migrated), migrated)
  assert.throws(() => validateArchive({ ...a, measurements: [...a.measurements, { ...a.measurements[1], id: 'duplicate' }] }), /只能采信一个值/)
  assert.throws(() => validateArchive({ ...migrated, measurements: [...migrated.measurements, { ...migrated.measurements[1], id: 'duplicate' }] }), /只能采信一个值/)
})
