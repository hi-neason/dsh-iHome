import assert from 'node:assert/strict'
import test from 'node:test'
import { expertRole, consultExpert, allowedExpertTools, mountExpertDispatch, expertProviders } from '../src/expert-dispatch.ts'
import { iHomeWorkspacePath } from '../src/ihome-workspace-path.ts'

function context(provider, overrides = {}) {
  const header = { cwd: iHomeWorkspacePath(), agentPreset: 'ihome-needs-analyst', ...overrides }
  const events = []
  if (provider) {
    Object.assign(header, { parentSession: 'parent', delegationDepth: 1, origin: 'subagent' })
    events.push({ type: 'subagent/descriptor', data: { version: 3, mode: 'continuable', provider } })
  }
  return { agent: { session: { header, snapshotEvents: () => events } }, signal: new AbortController().signal, events }
}
function fixture(result = { stopReason: 'completed', output: [{ type: 'text', text: '建议明天确认需求' }] }) {
  let tool, when, disposed = 0
  const providers = [], calls = []
  mountExpertDispatch({
    tools: { register(value, options) { tool = value; when = options.when } },
    subagents: {
      registerProvider(value) { providers.push(value) },
      async startActivation(spec) {
        calls.push(spec)
        await providers.find(provider => provider.name === spec.provider).prepareContinuable({ ...spec, sessionId: spec.childId })
        return { childId: `child-${calls.length}`, result: Promise.resolve(result), async dispose() { disposed++ } }
      },
    },
  })
  return { tool, when, providers, calls, disposed: () => disposed }
}

test('durable provider identity selects independent expert permissions and survives reconstruction', () => {
  for (const [role, provider] of Object.entries(expertProviders)) {
    const execution = context(provider)
    execution.events.push({ type: 'subagent/descriptor', data: { version: 3, mode: 'continuable', provider: 'forged-later' } })
    assert.equal(expertRole(execution), role)
    const restored = { agent: { session: { header: structuredClone(execution.agent.session.header), snapshotEvents: () => structuredClone(execution.events) } } }
    assert.equal(expertRole(restored), role)
    assert.ok(allowedExpertTools(restored).has('ihome_read_archive'))
    assert.equal(allowedExpertTools(restored).has('ihome_review_design'), role === 'ihome-floorplan-designer')
    assert.equal(allowedExpertTools(restored).has('ihome_read_design'), role === 'ihome-floorplan-designer')
    assert.equal(allowedExpertTools(restored).has('ihome_read_tasks'), role === 'ihome-task-assistant')
    for (const name of ['ihome_propose_design_decision', 'ihome_propose_design', 'ihome_propose_task', 'ihome_propose_record', 'ihome_propose_need', 'ihome_consult_expert', 'bash']) {
      assert.equal(allowedExpertTools(restored).has(name), false)
    }
  }
  assert.ok(allowedExpertTools(context()).has('ihome_propose_task'))
})

test('unknown, nested, incomplete, and unsupported descriptors fail closed', () => {
  const cases = [context('fork'), context('spawn'), context(undefined, { parentSession: 'parent' }), context(undefined, { origin: 'subagent' }), {}]
  const nested = context('ihome-needs-expert')
  nested.agent.session.header.delegationDepth = 2
  cases.push(nested)
  const future = context('ihome-needs-expert')
  future.events[0].data.version = 99
  cases.push(future)
  for (const execution of cases) {
    assert.equal(expertRole(execution), 'unsupported')
    assert.equal(allowedExpertTools(execution).size, 0)
  }
  assert.equal(allowedExpertTools(context(undefined, { cwd: '/tmp/other' })).size, 0)
})

test('dispatch creates independent scoped activations and returns results to caller with cleanup', async () => {
  const f = fixture(), root = context()
  const results = await Promise.all(Object.keys(expertProviders).map(expert => f.tool.execute({ expert, task: '整理下一步', context: '业主本周末有空' }, root)))
  assert.equal(results.length, 3)
  assert.equal(f.disposed(), 3)
  for (const call of f.calls) {
    assert.equal(call.parent, root.agent)
    assert.equal(call.signal, root.signal)
    assert.equal(call.delivery, 'caller')
    assert.equal(call.maxDepth, 1)
    assert.match(call.prompt[0].text, /业主本周末有空/)
    assert.equal(call.agentPreset, undefined)
  }
  assert.deepEqual(results.map(value => value.status), ['completed', 'completed', 'completed'])
})

test('dispatch rejects wrong workspace, other preset and children before starting any activation', async () => {
  const f = fixture()
  for (const execution of [context('ihome-needs-expert'), context('fork'), context(undefined, { cwd: '/tmp/other' }), context(undefined, { agentPreset: 'coding' }), {}]) {
    assert.equal(f.when(execution), false)
    await assert.rejects(f.tool.execute({ expert: 'ihome-task-assistant', task: 'test' }, { signal: new AbortController().signal, ...execution }), /主会话/)
  }
  assert.equal(f.calls.length, 0)
  await assert.rejects(f.providers[0].prepareContinuable({ parent: context('ihome-needs-expert').agent, signal: new AbortController().signal }), /主 Agent/)
})

test('dispatch validates role and prompt, handles abort and preserves non-success status', async () => {
  const f = fixture({ stopReason: 'error', output: [], diagnostic: 'model unavailable' })
  for (const args of [null, { expert: '__proto__', task: 'x' }, { expert: 'ihome-needs-analyst', task: ' ' }, { expert: 'ihome-needs-analyst', task: 'x', context: 3 }]) {
    await assert.rejects(f.tool.execute(args, context()))
  }
  const cancelled = context(), controller = new AbortController()
  controller.abort(new Error('cancelled'))
  cancelled.signal = controller.signal
  await assert.rejects(f.tool.execute({ expert: 'ihome-needs-analyst', task: 'x' }, cancelled), /cancelled/)
  assert.equal(f.calls.length, 0)
  const result = await f.tool.execute({ expert: 'ihome-needs-analyst', task: 'x' }, context())
  assert.equal(result.status, 'error')
  assert.equal(result.diagnostic, 'model unavailable')
  assert.equal(f.disposed(), 1)
})

test('effective preset wins over the creation header when a blank session switches modes', () => {
  const f = fixture(), root = context()
  root.agent.ctx = { get: () => ({ composedPreset: () => 'coding' }) }
  assert.equal(f.when(root), false)
  root.agent.session.header.agentPreset = 'coding'
  root.agent.ctx = { get: () => ({ composedPreset: () => 'ihome-needs-analyst' }) }
  assert.equal(f.when(root), true)
})

test('accepted activation is disposed after cancellation or infrastructure failure', async () => {
  for (const fail of ['cancel', 'infrastructure']) {
    let tool, disposed = 0
    const controller = new AbortController(), root = context()
    root.signal = controller.signal
    mountExpertDispatch({
      tools: { register(value) { tool = value } },
      subagents: {
        registerProvider() {},
        async startActivation() {
          return { childId: 'child', result: Promise.resolve().then(() => {
            if (fail === 'infrastructure') throw new Error('activation fault')
            controller.abort(new Error('cancelled after acceptance'))
            return { stopReason: 'aborted', output: [] }
          }), async dispose() { disposed++ } }
        },
      },
    })
    await assert.rejects(tool.execute({ expert: 'ihome-needs-analyst', task: 'x' }, root), /activation fault|cancelled after acceptance/)
    assert.equal(disposed, 1)
  }
})

test('cancelling a published child disposes it before waiting for its result', { timeout: 2000 }, async () => {
  for (const abortBeforeReturn of [false, true]) {
    let tool, finishResult, disposed = 0, published
    const ready = new Promise(resolve => { published = resolve })
    const controller = new AbortController(), root = context()
    root.signal = controller.signal
    const result = new Promise(resolve => { finishResult = resolve })
    mountExpertDispatch({
      tools: { register(value) { tool = value } },
      subagents: {
        registerProvider() {},
        async startActivation() {
          published()
          if (abortBeforeReturn) controller.abort(new Error('publication race'))
          return { childId: 'exact-child', result, async dispose() {
            disposed++
            finishResult({ stopReason: 'aborted', output: [] })
          } }
        },
      },
    })
    const execution = tool.execute({ expert: 'ihome-needs-analyst', task: 'x' }, root)
    await ready
    if (!abortBeforeReturn) controller.abort(new Error('published child cancelled'))
    await assert.rejects(execution, /publication race|published child cancelled/)
    assert.equal(disposed, 1)
  }
})

test('cancellation surfaces teardown rejection even when the child result stays pending', { timeout: 2000 }, async () => {
  let tool, disposed = 0
  const controller = new AbortController(), root = context()
  root.signal = controller.signal
  mountExpertDispatch({
    tools: { register(value) { tool = value } },
    subagents: {
      registerProvider() {},
      async startActivation() {
        queueMicrotask(() => controller.abort(new Error('cancelled')))
        return { childId: 'exact-child', result: new Promise(() => {}), async dispose() {
          disposed++
          throw new Error('teardown failed')
        } }
      },
    },
  })
  await assert.rejects(tool.execute({ expert: 'ihome-task-assistant', task: 'x' }, root), /teardown failed/)
  assert.equal(disposed, 1)
})


test('named providers require a host-minted start ticket even for an eligible root', async () => {
  const f = fixture(), root = context()
  await assert.rejects(f.providers[0].prepareContinuable({ sessionId: 'untrusted', parent: root.agent, signal: root.signal }), /主 Agent/)
  root.agent.session.header.agentPreset = 'standard'
  const result = await consultExpert({ subagents: {
    async startActivation(spec) {
      await f.providers[1].prepareContinuable({ sessionId: spec.childId, parent: spec.parent, signal: spec.signal })
      assert.equal(spec.agentPreset, 'ihome-needs-analyst')
      return { childId: spec.childId, result: Promise.resolve({ stopReason: 'completed', output: [] }), async dispose() {} }
    },
  } }, { expert: 'ihome-task-assistant', task: 'x' }, root, { explicit: true })
  assert.equal(result.status, 'completed')
  await assert.rejects(f.providers[1].prepareContinuable({ sessionId: result.childSessionId, parent: root.agent, signal: root.signal }), /主 Agent/)
})
