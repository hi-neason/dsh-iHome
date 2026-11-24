/** JSON shared by the desktop host, the panel and portable backups. */
export type Priority = 'must' | 'prefer' | 'discuss'
export interface Member {
  id: string, name: string, residency: '常住' | '偶住' | '待确认',
  gender?: '男' | '女' | '其他', age?: number, needsText?: string
}
export interface House { id: string, name: string }
export interface Room { id: string, houseId: string, name: string }
export interface Zone { id: string, roomId: string, name: string }
export interface Fact { id: string, text: string, memberIds: string[], quote?: string }
export interface Need {
  id: string, houseId: string, title: string, memberIds: string[], zoneIds: string[],
  factIds: string[], priority: Priority, quote: string, version: number
}
export interface NeedInput {
  houseId: string, title: string, people: string[], places: { room: string, zone: string }[],
  priority: Priority, quote: string
}
export interface Measurement {
  id: string, roomId: string, zoneId?: string, label: string, value: number, unit: 'mm' | 'cm' | 'm',
  source: '实测' | '图纸' | '估算', date: string, adopted: boolean, attachmentId?: string, quote?: string
}
export interface ArchiveFile { attachmentId: string, name: string, bytes: number }
export interface Attachment { id: string, houseId: string, name: string, roomIds: string[], date: string, file: ArchiveFile }
export interface Decision {
  id: string, houseId: string, text: string, reason: string, needIds: string[], attachmentIds: string[], supersedesId?: string
}
export interface Archive {
  revision: number, familyName: string, members: Member[], houses: House[], rooms: Room[], zones: Zone[],
  facts: Fact[], needs: Need[], measurements: Measurement[], attachments: Attachment[], decisions: Decision[]
}
export interface ArchiveService {
  load(): Promise<Archive>
  save(next: Archive): Promise<Archive>
  uploadFile(file: File): Promise<ArchiveFile>
  downloadFile(attachmentId: string): Promise<Blob>
}

export function currentHouse(archive: Archive): House {
  const house = archive.houses[0]
  if (!house) throw new Error('家庭档案缺少房屋信息。')
  return house
}

export function assertCurrentHouse(archive: Archive, houseId: string): void {
  if (houseId !== currentHouse(archive).id) throw new Error('请使用当前家庭档案中的房屋编号。')
}

function withCurrentHouse(archive: Archive, raw: unknown): Record<string, unknown> {
  check(raw && typeof raw === 'object' && !Array.isArray(raw), '档案记录格式有误。')
  const input = raw as Record<string, unknown>
  return { ...input, houseId: input.houseId === undefined ? currentHouse(archive).id : input.houseId }
}

export const newId = () => crypto.randomUUID()
export function createArchive(): Archive {
  return { revision: 0, familyName: '我的家庭', houses: [{ id: 'home', name: '我的家' }], members: [], rooms: [], zones: [],
    facts: [], needs: [], measurements: [], attachments: [], decisions: [] }
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
type Reader<T> = (value: unknown) => T
function object<S extends Record<string, Reader<unknown>>>(fields: S) {
  return (value: unknown): { [K in keyof S]: ReturnType<S[K]> } => {
    check(value && typeof value === 'object' && !Array.isArray(value), '档案记录格式有误。')
    const result: Record<string, unknown> = {}
    for (const [key, read] of Object.entries(fields)) {
      const parsed = read((value as Record<string, unknown>)[key])
      if (parsed !== undefined) result[key] = parsed
    }
    return result as { [K in keyof S]: ReturnType<S[K]> }
  }
}
function list<T>(read: Reader<T>): Reader<T[]> {
  return value => { check(Array.isArray(value), '档案列表格式有误。'); return value.map(read) }
}
function optional<T>(read: Reader<T>): Reader<T | undefined> {
  return value => value === undefined ? undefined : read(value)
}
const text: Reader<string> = value => { check(typeof value === 'string', '请输入文字。'); return value.trim() }
const memberNeedsText: Reader<string> = value => { check(typeof value === 'string', '居住需求请输入文字。'); return value }
const memberAge: Reader<number> = value => {
  check(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0, '年龄请输入非负整数。')
  return value
}
const label: Reader<string> = value => { const s = text(value); check(s, '名称或内容不能为空。'); return s }
function choice<const T extends readonly string[]>(...choices: T): Reader<T[number]> {
  return value => { check(typeof value === 'string' && choices.includes(value), '档案选项无效。'); return value }
}
const count: Reader<number> = value => {
  check(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0, '档案版本或文件大小无效。')
  return value
}
const positive: Reader<number> = value => {
  check(typeof value === 'number' && Number.isFinite(value) && value > 0, '尺寸必须大于零。')
  return value
}
const flag: Reader<boolean> = value => { check(typeof value === 'boolean', '档案状态无效。'); return value }
const day: Reader<string> = value => {
  const s = label(value)
  check(/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().startsWith(s), '日期无效。')
  return s
}
const ids = list(label)
const priority = choice('must', 'prefer', 'discuss')
const needFields = { houseId: label, title: label, people: list(label), places: list(object({ room: label, zone: label })), priority, quote: text }
const targetFields = { targetNeedId: optional(label), targetVersion: optional(count) }
const parseInput = object(needFields)
const parseProposal = object({ ...needFields, ...targetFields })
const factProposal = object({ kind: choice('fact'), houseId: label, text: label, people: list(label), quote: label, targetFactId: optional(label) })
const measurementProposal = object({ kind: choice('measurement'), houseId: label, room: label, zone: optional(label), label,
  value: positive, unit: choice('mm', 'cm', 'm'), source: choice('实测', '图纸', '估算'), date: day, adopted: flag, quote: label,
  previousMeasurementId: optional(label) })
function parseRecordInput(raw: unknown) {
  const { kind } = object({ kind: choice('fact', 'measurement') })(raw)
  return kind === 'fact' ? factProposal(raw) : measurementProposal(raw)
}
const parseArchive = object({
  revision: count, familyName: label, houses: list(object({ id: label, name: label })),
  members: list(object({
    id: label, name: label, residency: choice('常住', '偶住', '待确认'),
    gender: optional(choice('男', '女', '其他')), age: optional(memberAge), needsText: optional(memberNeedsText),
  })),
  rooms: list(object({ id: label, houseId: label, name: label })), zones: list(object({ id: label, roomId: label, name: label })),
  facts: list(object({ id: label, text: label, memberIds: ids, quote: optional(text) })),
  needs: list(object({ id: label, houseId: label, title: label, memberIds: ids, zoneIds: ids, factIds: ids, priority, quote: text, version: count })),
  measurements: list(object({ id: label, roomId: label, zoneId: optional(label), label, value: positive, unit: choice('mm', 'cm', 'm'),
    source: choice('实测', '图纸', '估算'), date: day, adopted: flag, attachmentId: optional(label), quote: optional(text) })),
  attachments: list(object({ id: label, houseId: label, name: label, roomIds: ids, date: day,
    file: object({ attachmentId: label, name: label, bytes: count }) })),
  decisions: list(object({ id: label, houseId: label, text: label, reason: text, needIds: ids, attachmentIds: ids, supersedesId: optional(label) })),
})

function unique(values: string[], message: string) {
  check(new Set(values).size === values.length, message)
}
function index<T extends { id: string }>(items: T[]) {
  const byId = new Map(items.map(item => [item.id, item]))
  check(byId.size === items.length, '档案中存在重复编号。')
  return byId
}
function references<T>(ids: string[], valid: (id: string) => T, message: string) {
  unique(ids, message)
  check(ids.every(valid), message)
}
function scopedName(parent: string, name: string): string { return JSON.stringify([parent, name]) }

export function memberReferences(archive: Archive, member: Member) {
  return {
    needs: archive.needs.filter(need => need.memberIds.includes(member.id)),
    facts: archive.facts.filter(fact => fact.memberIds.includes(member.id)),
  }
}

export function removeMember(archive: Archive, memberId: string): Archive {
  const member = archive.members.find(item => item.id === memberId)
  check(member, '这位家人已被删除，请刷新档案。')
  const { needs, facts } = memberReferences(archive, member)
  check(!needs.length && !facts.length, '请先调整已入档需求或生活习惯所关联的家人。')
  return { ...archive, members: archive.members.filter(item => item.id !== memberId) }
}

export function validateArchive(value: unknown): Archive {
  const a = parseArchive(value)
  const members = index(a.members), houses = index(a.houses), rooms = index(a.rooms), zones = index(a.zones)
  const facts = index(a.facts), needs = index(a.needs), files = index(a.attachments), decisions = index(a.decisions)
  index(a.measurements)
  check(houses.size, '请保留至少一套房屋。')
  unique(a.members.map(m => m.name), '请给家人使用可区分的称呼。')
  unique(a.houses.map(h => h.name), '房屋名称重复。')
  unique(a.rooms.map(r => scopedName(r.houseId, r.name)), '同一套房屋里房间名不能重复。')
  unique(a.zones.map(z => scopedName(z.roomId, z.name)), '同一房间内区域名不能重复。')
  for (const r of a.rooms) check(houses.has(r.houseId), '房间所属的房屋不存在。')
  for (const z of a.zones) check(rooms.has(z.roomId), '区域所属的房间不存在。')
  for (const f of a.facts) references(f.memberIds, id => members.has(id), '生活事实关联的家人无效。')
  for (const n of a.needs) {
    check(houses.has(n.houseId) && n.version > 0, '需求所属房屋或版本无效。')
    check(n.memberIds.length && n.zoneIds.length, '每条需求都要关联家人和房间内的具体区域。')
    references(n.memberIds, id => members.has(id), '需求关联的家人无效。')
    references(n.factIds, id => facts.has(id), '需求关联的生活事实无效。')
    references(n.zoneIds, id => rooms.get(zones.get(id)?.roomId ?? '')?.houseId === n.houseId, '需求区域必须属于当前房屋。')
  }
  for (const f of a.attachments) {
    check(houses.has(f.houseId) && /^sha256:[a-f0-9]{64}$/.test(f.file.attachmentId), '附件引用无效。')
    references(f.roomIds, id => rooms.get(id)?.houseId === f.houseId, '附件关联的房间无效。')
  }
  for (const m of a.measurements) {
    check(rooms.has(m.roomId) && (!m.zoneId || zones.get(m.zoneId)?.roomId === m.roomId), '尺寸记录的房间或区域无效。')
    if (m.attachmentId) check(files.get(m.attachmentId)?.houseId === rooms.get(m.roomId)?.houseId, '尺寸记录的依据文件无效。')
  }
  unique(a.measurements.filter(m => m.adopted).map(m => JSON.stringify([m.roomId, m.zoneId, m.label])), '同一位置的同一尺寸只能采信一个值。')
  for (const d of a.decisions) {
    check(houses.has(d.houseId), '决定对应的房屋不存在。')
    references(d.needIds, id => needs.get(id)?.houseId === d.houseId, '决定关联的需求无效。')
    references(d.attachmentIds, id => files.get(id)?.houseId === d.houseId, '决定关联的资料无效。')
    if (d.supersedesId) check(d.supersedesId !== d.id && decisions.get(d.supersedesId)?.houseId === d.houseId, '原决定引用无效。')
  }
  return a
}

interface SaveNeedOptions { needId?: string, expectedVersion?: number, factIds?: string[] }

export function storeNeed(archive: Archive, raw: NeedInput, opts: SaveNeedOptions = {}): Archive {
  const data = parseInput(raw)
  check(data.people.length && data.places.length, '请至少选择一位家人和一个房间内的具体区域。')
  const prior = opts.needId ? archive.needs.find(n => n.id === opts.needId && n.houseId === data.houseId) : undefined
  if (opts.needId) check(prior && prior.version === opts.expectedVersion, '这条需求已被修改，请重新核对最新版本。')
  const members = [...archive.members], rooms = [...archive.rooms], zones = [...archive.zones]
  const memberIds = data.people.map(name => resolveMember(members, name))
  const zoneIds = data.places.map(place => resolvePlace(rooms, zones, data.houseId, place.room, place.zone).zoneId!)
  const record: Need = { id: prior?.id ?? newId(), houseId: data.houseId, title: data.title, quote: data.quote,
    memberIds: [...new Set(memberIds)], zoneIds: [...new Set(zoneIds)], priority: data.priority,
    factIds: opts.factIds ?? prior?.factIds ?? [], version: (prior?.version ?? 0) + 1 }
  return validateArchive({ ...archive, rooms, members, zones, needs: prior ? archive.needs.map(n => n.id === record.id ? record : n) : [...archive.needs, record] })
}

function resolveMember(members: Member[], name: string): string {
  let member = members.find(m => m.name === name)
  if (!member) { member = { id: newId(), name, residency: '待确认' }; members.push(member) }
  return member.id
}

function resolvePlace(rooms: Room[], zones: Zone[], houseId: string, roomName: string, zoneName?: string) {
  let room = rooms.find(r => r.houseId === houseId && r.name === roomName)
  if (!room) { room = { id: newId(), houseId, name: roomName }; rooms.push(room) }
  const roomId = room.id
  if (!zoneName) return { roomId, zoneId: undefined }
  let zone = zones.find(z => z.roomId === roomId && z.name === zoneName)
  if (!zone) { zone = { id: newId(), roomId, name: zoneName }; zones.push(zone) }
  return { roomId, zoneId: zone.id }
}

export interface PreparedArchiveChange { next: Archive, summary: string, changed: boolean }

const priorityLabels: Record<Priority, string> = { must: '必须满足', prefer: '尽量满足', discuss: '待商量' }

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every(id => right.includes(id))
}

function describeNeed(archive: Archive, need: Need): string {
  const people = need.memberIds.map(id => archive.members.find(member => member.id === id)!.name)
  const places = need.zoneIds.map(id => {
    const zone = archive.zones.find(item => item.id === id)!
    return archive.rooms.find(room => room.id === zone.roomId)!.name + ' / ' + zone.name
  })
  return [
    '需求描述：' + need.title, '关联家人：' + people.join('、'),
    '位置：' + places.join('、'), '重要程度：' + priorityLabels[need.priority],
    '依据原话：' + need.quote,
  ].join('\n')
}

function describeFact(archive: Archive, fact: Fact): string {
  return [
    '生活事实：' + fact.text,
    '关联家人：' + fact.memberIds.map(id => archive.members.find(member => member.id === id)!.name).join('、'),
    '依据原话：' + (fact.quote || '未填写'),
  ].join('\n')
}

function describeMeasurement(archive: Archive, measurement: Measurement): string {
  const room = archive.rooms.find(item => item.id === measurement.roomId)!
  const zone = archive.zones.find(item => item.id === measurement.zoneId)
  return [
    '位置：' + room.name + (zone ? ' / ' + zone.name : '（整个房间）'),
    '测量项目：' + measurement.label,
    '尺寸：' + measurement.value + ' ' + measurement.unit,
    '来源：' + measurement.source, '日期：' + measurement.date,
    '采用状态：' + (measurement.adopted ? '当前采用' : '仅留存'),
    '依据原话：' + (measurement.quote || '未填写'),
  ].join('\n')
}

function prepared(archive: Archive, next: Archive, summary: string): PreparedArchiveChange {
  const validated = validateArchive(next)
  const createdMembers = validated.members.filter(item => !archive.members.some(old => old.id === item.id))
  const createdRooms = validated.rooms.filter(item => !archive.rooms.some(old => old.id === item.id))
  const createdZones = validated.zones.filter(item => !archive.zones.some(old => old.id === item.id))
  const additions = [
    createdMembers.length ? '同时添加家人：' + createdMembers.map(item => item.name).join('、') : '',
    createdRooms.length ? '同时添加房间：' + createdRooms.map(item => item.name).join('、') : '',
    createdZones.length ? '同时添加区域：' + createdZones.map(item =>
      validated.rooms.find(room => room.id === item.roomId)!.name + ' / ' + item.name).join('、') : '',
  ].filter(Boolean)
  return { next: validated, summary: [summary, ...additions].join('\n\n'), changed: true }
}

/** Build a complete in-memory preview. The host commits it only after conversation acceptance. */
export function prepareArchiveChange(archive: Archive, kind: 'need' | 'record', raw: unknown): PreparedArchiveChange {
  const input = withCurrentHouse(archive, raw)
  assertCurrentHouse(archive, label(input.houseId))
  if (kind === 'need') {
    const data = parseProposal(input)
    check(data.people.length && data.places.length && data.quote, '请先问清涉及的家人、具体区域，并保留用户原话。')
    check((data.targetNeedId === undefined) === (data.targetVersion === undefined), '修改需求须同时提供原需求编号和版本。')
    const prior = archive.needs.find(item => item.id === data.targetNeedId && item.houseId === data.houseId)
    const next = storeNeed(archive, data, { needId: data.targetNeedId, expectedVersion: data.targetVersion })
    const target = next.needs.find(item => item.id === prior?.id) ?? next.needs[next.needs.length - 1]
    const matching = archive.needs.find(item =>
      (!data.targetNeedId || item.id === data.targetNeedId) && item.houseId === target.houseId &&
      item.title === target.title && item.quote === target.quote && item.priority === target.priority &&
      sameIds(item.memberIds, target.memberIds) && sameIds(item.zoneIds, target.zoneIds) &&
      sameIds(item.factIds, target.factIds))
    if (matching) return { next: archive, summary: '这条需求已经入档。\n' + describeNeed(archive, matching), changed: false }
    const summary = prior
      ? '修改居住需求\n\n修改前\n' + describeNeed(archive, prior) + '\n\n修改后\n' + describeNeed(next, target)
      : '新增居住需求\n\n' + describeNeed(next, target)
    return prepared(archive, next, summary)
  }

  const data = parseRecordInput(input)
  if (data.kind === 'fact') {
    check(data.people.length, '请先了解这件事与哪位家人有关。')
    const prior = archive.facts.find(item => item.id === data.targetFactId)
    if (data.targetFactId) check(prior, '原生活事实不存在，请重新读取。')
    const members = [...archive.members]
    const fact: Fact = {
      id: prior?.id ?? newId(), text: data.text, quote: data.quote,
      memberIds: [...new Set(data.people.map(name => resolveMember(members, name)))],
    }
    const matching = archive.facts.find(item =>
      (!data.targetFactId || item.id === data.targetFactId) && item.text === fact.text &&
      item.quote === fact.quote && sameIds(item.memberIds, fact.memberIds))
    if (matching) return { next: archive, summary: '这条生活事实已经入档。\n' + describeFact(archive, matching), changed: false }
    const next = { ...archive, members, facts: prior
      ? archive.facts.map(item => item.id === prior.id ? fact : item) : [...archive.facts, fact] }
    const summary = prior
      ? '修改生活事实\n\n修改前\n' + describeFact(archive, prior) + '\n\n修改后\n' + describeFact(next, fact)
      : '新增生活事实\n\n' + describeFact(next, fact)
    return prepared(archive, next, summary)
  }

  const previous = archive.measurements.find(item => item.id === data.previousMeasurementId)
  if (data.previousMeasurementId) {
    const room = archive.rooms.find(item => item.id === previous?.roomId)
    const zone = archive.zones.find(item => item.id === previous?.zoneId)
    check(previous && room?.houseId === data.houseId && room.name === data.room &&
      zone?.name === data.zone && previous.label === data.label, '原尺寸与本次记录的位置或测量项目不符。')
  }
  const rooms = [...archive.rooms], zones = [...archive.zones]
  const { roomId, zoneId } = resolvePlace(rooms, zones, data.houseId, data.room, data.zone)
  const measurement: Measurement = {
    id: newId(), roomId, zoneId, label: data.label, value: data.value, unit: data.unit,
    source: data.source, date: data.date, adopted: data.adopted, quote: data.quote,
  }
  const matching = archive.measurements.find(item =>
    item.roomId === roomId && item.zoneId === zoneId && item.label === data.label &&
    item.value === data.value && item.unit === data.unit && item.source === data.source &&
    item.date === data.date && item.adopted === data.adopted && item.quote === data.quote)
  if (matching) return { next: archive, summary: '这条尺寸已经入档。\n' + describeMeasurement(archive, matching), changed: false }
  const replaced = archive.measurements.filter(item =>
    data.adopted && item.adopted && item.roomId === roomId && item.zoneId === zoneId && item.label === data.label)
  const measurements = archive.measurements.map(item => replaced.includes(item) ? { ...item, adopted: false } : item)
  const next = { ...archive, rooms, zones, measurements: [...measurements, measurement] }
  const before = [...new Set([previous, ...replaced].filter((item): item is Measurement => !!item))]
  const summary = [
    '新增尺寸记录', ...before.map(item => '保留已有尺寸\n' + describeMeasurement(archive, item)),
    '本次尺寸\n' + describeMeasurement(next, measurement),
    replaced.length ? '上述当前采用的旧尺寸转为历史留存，本次尺寸设为当前采用。' : '',
  ].filter(Boolean).join('\n\n')
  return prepared(archive, next, summary)
}
