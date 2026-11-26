import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkspaceManager, moduleSessionPrompt } from '../src/ihome-workspace.ts'
import { NEEDS_ANALYST_PRESET_ID } from '../src/agent-presets.ts'

test('module sessions survive repeated opens, concurrent clicks, renames and restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ihome-workspace-'))
  try {
    let stored
    const table = { get: () => stored, put: async (_, value) => { stored = structuredClone(value) } }
    const headers = new Map(), names = new Map(), archived = new Set()
    const workspace = { id: 'workspace', title: 'iHome工作区', path: directory, sessionIds: [],
      async setTitle(title) { this.title = title },
      async attachSession(id) { if (!this.sessionIds.includes(id)) this.sessionIds.push(id) } }
    let creates = 0, failRename = false
    const ctx = {
      agentPresets: { defaultId: 'standard' },
      workspaceRegistry: { create: async () => workspace, unarchiveSession: async id => { archived.delete(id) } },
      sessions: { get: () => undefined },
      sessionPersistence: { stat: async id => headers.has(id) ? { header: headers.get(id) } : undefined, flush: async () => {} },
      sessionController: {
        async create({ sessionId, agentPreset }) {
          creates++
          headers.set(sessionId, { id: sessionId, cwd: directory, agentPreset })
          return { sessionId, agentPreset }
        },
        async projections({ sessionId }) {
          return { kind: 'sequenced', values: { title: names.get(sessionId), agentPreset: headers.get(sessionId)?.agentPreset } }
        },
        async rename({ sessionId, title }) { if (failRename) throw new Error('rename failed'); names.set(sessionId, title) },
      },
    }
    let manager = createWorkspaceManager(ctx, table, directory)
    const [first, repeated] = await Promise.all([manager.open('archive'), manager.open('archive')])
    assert.equal(first.sessionId, repeated.sessionId)
    assert.equal(creates, 1)
    assert.equal(headers.get(first.sessionId).agentPreset, NEEDS_ANALYST_PRESET_ID)
    assert.equal(names.get(first.sessionId), 'iHome专家团')
    stored.sessions.archive.roleTitle = '家庭需求分析师'
    names.set(first.sessionId, '家庭需求分析师')
    assert.equal((await manager.open('archive')).sessionId, first.sessionId)
    assert.equal(names.get(first.sessionId), 'iHome专家团')
    // Simulate a pre-team archive session and a later user-named conversation.
    delete stored.sessions.archive.roleTitle
    names.set(first.sessionId, '家庭档案库')
    assert.equal((await manager.open('archive')).sessionId, first.sessionId)
    assert.equal(names.get(first.sessionId), 'iHome专家团')
    delete stored.sessions.archive.roleTitle
    names.set(first.sessionId, '我的具体需求')
    archived.add(first.sessionId)
    manager = createWorkspaceManager(ctx, table, directory)
    assert.equal((await manager.open('archive')).sessionId, first.sessionId)
    assert.equal(names.get(first.sessionId), '我的具体需求')
    assert.equal(archived.size, 0)
    workspace.title = '临时改名'
    assert.equal((await manager.ensure()).title, 'iHome工作区')
    failRename = true
    await assert.rejects(manager.open('design'), /rename failed/)
    const reserved = stored.sessions.design.sessionId
    failRename = false
    manager = createWorkspaceManager(ctx, table, directory)
    assert.equal((await manager.open('design')).sessionId, reserved)
    assert.equal(creates, 2)
    headers.delete(first.sessionId)
    assert.notEqual((await manager.open('archive')).sessionId, first.sessionId)
    assert.equal(creates, 3)
    await assert.rejects(manager.open('invalid'))
    assert.equal(creates, 3)
    const budget = await manager.open('budget')
    names.set(budget.sessionId, '已经记下的装修支出')
    const movein = await manager.open('movein')
    assert.notEqual(movein.sessionId, budget.sessionId)
    assert.equal(names.get(movein.sessionId), '入住规划师')
    manager = createWorkspaceManager(ctx, table, directory)
    const recovered = await manager.ensure()
    assert.equal(recovered.moduleSessions.budget, budget.sessionId)
    assert.equal(recovered.moduleSessions.movein, movein.sessionId)
    assert.equal((await manager.open('budget')).sessionId, budget.sessionId)
    assert.equal(names.get(budget.sessionId), '已经记下的装修支出')
    const documents = await manager.open('documents')
    assert.equal(names.get(documents.sessionId), '文档资料员')
    assert.notEqual(documents.sessionId, movein.sessionId)
    const tasks = await manager.open('tasks')
    assert.equal(names.get(tasks.sessionId), 'iHome专家团')
    assert.equal(tasks.sessionId, stored.sessions.archive.sessionId)
    assert.notEqual(tasks.sessionId, documents.sessionId)
    manager = createWorkspaceManager(ctx, table, directory)
    assert.equal((await manager.open('tasks')).sessionId, tasks.sessionId)
    assert.equal(headers.get(tasks.sessionId).agentPreset, NEEDS_ANALYST_PRESET_ID)
    ctx.agentPresets.defaultId = NEEDS_ANALYST_PRESET_ID
    const knowledge = await manager.open('knowledge')
    assert.equal(headers.get(knowledge.sessionId).agentPreset, 'standard')

    // Upgrade a pre-preset session. A failed creation must retain the previous
    // identity and the pending replacement across a restart.
    const legacy = stored.sessions.archive.sessionId
    headers.get(legacy).agentPreset = 'standard'
    names.set(legacy, '我最早记录的需求')
    failRename = true
    await assert.rejects(manager.open('archive'), /rename failed/)
    const pending = stored.sessions.archive.sessionId
    assert.notEqual(pending, legacy)
    manager = createWorkspaceManager(ctx, table, directory)
    failRename = false
    assert.equal((await manager.open('archive')).sessionId, pending)
    assert.deepEqual((await manager.ensure()).previousModuleSessions, { archive: [legacy], tasks: [legacy] })
    const restored = await manager.open('archive', legacy)
    assert.equal(restored.sessionId, legacy)
    assert.equal(restored.activeSessionId, pending)
    assert.equal(names.get(legacy), '我最早记录的需求')
    assert.equal((await manager.open('archive')).sessionId, pending)
    await assert.rejects(manager.open('archive', 'unrelated'), /历史会话/)
    headers.get(legacy).cwd = '/other'
    await assert.rejects(manager.open('archive', legacy), /历史会话/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('storage errors propagate and a partial creation retries the reserved identity', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ihome-workspace-'))
  try {
    let record, fail = true
    const calls = []
    const workspace = { id: 'w', path: directory, title: 'iHome工作区', sessionIds: [],
      async setTitle() {}, async attachSession() {} }
    const ctx = {
      workspaceRegistry: { create: async () => workspace, unarchiveSession: async () => {} },
      sessions: { get: id => calls.includes(id) && !fail ? { header: { id, cwd: directory } } : undefined },
      sessionPersistence: { stat: async () => undefined, flush: async () => {} },
      sessionController: {
        async create({sessionId, agentPreset}) { calls.push(sessionId); if (fail) throw new Error('storage offline'); return {sessionId, agentPreset} },
        async projections() { return { kind: 'sequenced', values: { agentPreset: NEEDS_ANALYST_PRESET_ID } } },
        async rename() {},
      },
    }
    const manager = createWorkspaceManager(ctx, {get: () => record, put: async (_, next) => { record = next }}, directory)
    await assert.rejects(manager.open('archive'), /storage offline/)
    const reserved = record.sessions.archive.sessionId
    fail = false
    assert.equal((await manager.open('archive')).sessionId, reserved)
    assert.equal(new Set(calls).size, 1)
  } finally { await rm(directory, {recursive:true,force:true}) }
})


test('module system instructions apply only to their own native sessions', () => {
  const state = { sessions: { archive: { sessionId: 'archive-session', ready: true } } }
  assert.equal(moduleSessionPrompt(state, undefined), '')
  assert.equal(moduleSessionPrompt(state, 'ordinary-session'), '')
  assert.match(moduleSessionPrompt(state, 'archive-session'), /需求分析师/)
  assert.match(moduleSessionPrompt(state, 'archive-session'), /家人和至少一个房间或区域/)
  assert.equal(moduleSessionPrompt(state, 'archive-session', NEEDS_ANALYST_PRESET_ID), '')
  state.sessions.archive.previousSessionIds = ['old-session']
  assert.match(moduleSessionPrompt(state, 'old-session', 'standard'), /需求分析师/)
})

test('renamed roles and new move-in role receive their own conversation instructions', () => {
  const state = { sessions: {
    handover: { sessionId: 'inspection', ready: true },
    movein: { sessionId: 'moving', ready: true },
    budget: { sessionId: 'old-budget', ready: true },
    documents: { sessionId: 'documents', ready: true },
    tasks: { sessionId: 'task-chat', ready: true },
  } }
  assert.match(moduleSessionPrompt(state, 'inspection'), /「验收监理」/)
  assert.match(moduleSessionPrompt(state, 'inspection'), /整改及复验/)
  assert.match(moduleSessionPrompt(state, 'moving'), /「入住规划师」/)
  assert.match(moduleSessionPrompt(state, 'moving'), /保洁、搬运、收纳/)
  assert.match(moduleSessionPrompt(state, 'old-budget'), /「预算与记账」/)
  assert.match(moduleSessionPrompt(state, 'documents'), /「文档资料员」/)
  assert.match(moduleSessionPrompt(state, 'documents'), /各阶段产生的文档及物料资料/)
  const tasks = moduleSessionPrompt(state, 'task-chat')
  assert.match(tasks, /「任务待办助理」/)
  assert.match(tasks, /ihome_read_tasks/)
  assert.match(tasks, /ihome_propose_task/)
})

test('upgrading separate expert conversations retains both histories and a user title', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ihome-team-'))
  try {
    let stored = { sessions: {
      archive: { sessionId: 'needs', ready: true, roleTitle: '需求分析师' },
      tasks: { sessionId: 'old-tasks', ready: true, roleTitle: '任务待办助理', previousSessionIds: ['older-tasks'] },
    } }
    const headers = new Map([
      ['needs', { id: 'needs', cwd: directory, agentPreset: NEEDS_ANALYST_PRESET_ID }],
      ['old-tasks', { id: 'old-tasks', cwd: directory, agentPreset: 'standard' }],
      ['older-tasks', { id: 'older-tasks', cwd: directory, agentPreset: 'standard' }],
    ])
    const names = new Map([['needs', '我家的装修计划'], ['old-tasks', '采购清单']])
    const workspace = { id: 'w', path: directory, title: 'iHome工作区',
      async attachSession() {}, async setTitle() {} }
    const ctx = {
      agentPresets: { defaultId: 'standard' },
      workspaceRegistry: { create: async () => workspace, unarchiveSession: async () => {} },
      sessions: { get: id => headers.has(id) ? { header: headers.get(id) } : undefined },
      sessionPersistence: { stat: async () => undefined, flush: async () => {} },
      sessionController: {
        async create() { throw new Error('should reuse existing native conversation') },
        async projections({ sessionId }) { return { kind: 'sequenced', values: {
          title: names.get(sessionId), agentPreset: headers.get(sessionId).agentPreset,
        } } },
        async rename({ sessionId, title }) { names.set(sessionId, title) },
      },
    }
    const table = { get: () => stored, put: async (_, value) => { stored = structuredClone(value) } }
    let manager = createWorkspaceManager(ctx, table, directory)
    const [tasks, needs] = await Promise.all([manager.open('tasks'), manager.open('archive')])
    assert.equal(tasks.sessionId, 'needs')
    assert.equal(needs.sessionId, 'needs')
    assert.deepEqual(tasks.previousSessionIds, ['old-tasks', 'older-tasks'])
    assert.equal(names.get('needs'), '我家的装修计划')
    assert.equal(names.get('old-tasks'), '采购清单')
    manager = createWorkspaceManager(ctx, table, directory)
    assert.equal((await manager.open('tasks', 'old-tasks')).activeSessionId, 'needs')
    assert.equal((await manager.open('tasks', 'older-tasks')).sessionId, 'older-tasks')
    assert.deepEqual((await manager.ensure()).moduleSessions, { archive: 'needs', tasks: 'needs' })
  } finally { await rm(directory, { recursive: true, force: true }) }
})
