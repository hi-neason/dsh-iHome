import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkspaceManager, moduleSessionPrompt } from '../src/ihome-workspace.ts'

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
      workspaceRegistry: { create: async () => workspace, unarchiveSession: async id => { archived.delete(id) } },
      sessions: { get: () => undefined },
      sessionPersistence: { stat: async id => headers.has(id) ? { header: headers.get(id) } : undefined, flush: async () => {} },
      sessionController: {
        async create({ sessionId }) { creates++; headers.set(sessionId, { id: sessionId, cwd: directory }); return { sessionId } },
        async rename({ sessionId, title }) { if (failRename) throw new Error('rename failed'); names.set(sessionId, title) },
      },
    }
    let manager = createWorkspaceManager(ctx, table, directory)
    const [first, repeated] = await Promise.all([manager.open('archive'), manager.open('archive')])
    assert.equal(first.sessionId, repeated.sessionId)
    assert.equal(creates, 1)
    assert.equal(names.get(first.sessionId), '家庭档案库')
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
        async create({sessionId}) { calls.push(sessionId); if (fail) throw new Error('storage offline'); return {sessionId} },
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
  assert.match(moduleSessionPrompt(state, 'archive-session'), /具体家人和区域/)
  assert.match(moduleSessionPrompt(state, 'archive-session'), /ihome_propose_need/)
})
