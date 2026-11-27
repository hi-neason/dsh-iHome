import test from 'node:test'
import assert from 'node:assert/strict'
import { mountExpertRequests, parseExpertRequest } from '../src/expert-request.ts'
import { iHomeWorkspacePath } from '../src/ihome-workspace-path.ts'

function message(id, text, kind = 'user') {
  return { id, role: 'user', source: { kind }, content: [{ type: 'text', text }] }
}
function fixture(startError) {
  let listener, provider, disposed = 0
  const calls = []
  mountExpertRequests({
    on(_event, value) { listener = value },
    systemPrompt: { context(value) { provider = value } },
    subagents: {
      async startActivation(spec) {
        calls.push(spec)
        if (startError) throw startError
        return { childId: `child-${calls.length}`, result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: '{{独立报告}}' }] }), async dispose() { disposed++ } }
      },
    },
  })
  const agent = { session: {
    header: { cwd: iHomeWorkspacePath(), agentPreset: 'ihome-needs-analyst' },
    surface: { nodes: [0, 1] },
    snapshotEvents: () => [
      { seq: 0, type: 'user/message', data: message('old', '有老人同住') },
      { seq: 1, type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: '需要考虑防滑' }] } } },
      { seq: 2, type: 'user/message', data: message('hidden', '隐藏历史') },
    ],
  } }
  return { agent, calls, provider, disposed: () => disposed,
    step(messages, options = {}) {
      return listener({ agent, messages, signal: options.signal ?? new AbortController().signal }, async () => options.reject ? { kind: 'reject' } : { kind: 'enter', messages })
    },
  }
}

test('explicit routing accepts only exact leading expert names', () => {
  assert.deepEqual(parseExpertRequest('/户型设计师 画两层'), { expert: 'ihome-floorplan-designer', task: '画两层' })
  assert.deepEqual(parseExpertRequest('/需求分析师\n帮我梳理需求'), { expert: 'ihome-needs-analyst', task: '帮我梳理需求' })
  assert.equal(parseExpertRequest('引用 /需求分析师 问题'), undefined)
  assert.equal(parseExpertRequest('/需求分析师x 问题'), undefined)
  assert.equal(parseExpertRequest('/其他专家 问题'), undefined)
})

test('two real expert activations precede coordinator and include current conversation context', async () => {
  const f = fixture()
  const messages = [message('a', '/需求分析师 帮我整理'), message('b', '/任务待办助理 给我列任务')]
  const result = await f.step(messages)
  assert.equal(result.messages, messages)
  assert.deepEqual(f.calls.map(call => call.provider), ['ihome-needs-expert', 'ihome-task-expert'])
  assert.match(f.calls[0].prompt[0].text, /有老人同住/)
  assert.match(f.calls[0].prompt[0].text, /需要考虑防滑/)
  assert.match(f.calls[0].prompt[0].text, /给我列任务/)
  assert.doesNotMatch(f.calls[0].prompt[0].text, /隐藏历史/)
  assert.equal(f.disposed(), 2)
  assert.equal(f.provider.required, true)
  assert.equal(f.provider.interpolate, false)
  assert.match(f.provider.text({ agent: f.agent }), /child-1/)
  assert.match(f.provider.text({ agent: f.agent }), /child-2/)
  await f.step(messages)
  assert.equal(f.calls.length, 2)
  await f.step([message('next', '谢谢')])
  assert.equal(f.provider.text({ agent: f.agent }), '')
})

test('external source, rejected step, other mode and missing task never start an expert', async () => {
  const f = fixture()
  await f.step([message('external', '/需求分析师 x', 'tool')])
  await f.step([message('reject', '/需求分析师 x')], { reject: true })
  await f.step([message('empty', '/需求分析师')])
  assert.match(f.provider.text({ agent: f.agent }), /尚未提供任务/)
  f.agent.session.header.cwd = '/tmp/other'
  await f.step([message('wrong-mode', '/需求分析师 x')])
  assert.equal(f.calls.length, 0)
  assert.equal(f.provider.text({ agent: f.agent }), '')
})

test('aborted requests produce no current report and propagate cancellation', async () => {
  const f = fixture(), controller = new AbortController()
  controller.abort(new Error('cancelled'))
  await assert.rejects(f.step([message('abort', '/任务待办助理 x')], { signal: controller.signal }), /cancelled/)
  assert.equal(f.calls.length, 0)
  assert.equal(f.provider.text({ agent: f.agent }), '')
})


test('standard iHome root explicitly starts pinned expert preset with native attachments', async () => {
  const f = fixture()
  f.agent.session.header.agentPreset = 'standard'
  const image = { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'AA==' } }
  const file = { type: 'file', name: '原始户型.pdf', source: { type: 'attachment', id: 'attachment-1' } }
  const input = message('a', '/需求分析师 帮我看看原始户型')
  input.content.push(image, file)
  await f.step([input])
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].agentPreset, 'ihome-needs-analyst')
  assert.deepEqual(f.calls[0].prompt.slice(1), [image, file])
  assert.equal(f.calls[0].prompt[0].text.split('帮我看看原始户型').length - 1, 1)
  assert.equal(f.agent.session.header.agentPreset, 'standard')
  assert.match(f.provider.text({ agent: f.agent }), /child-1/)
})

test('startup failure keeps original message and returns a failure report to its parent', async () => {
  const f = fixture(new Error('provider unavailable'))
  f.agent.session.header.agentPreset = 'standard'
  const messages = [message('a', '/任务待办助理 下周有哪些任务')]
  const decision = await f.step(messages)
  assert.equal(decision.messages, messages)
  assert.match(f.provider.text({ agent: f.agent }), /provider unavailable/)
  assert.match(f.provider.text({ agent: f.agent }), /下周有哪些任务/)
})

test('commands on later lines and child conversations never trigger direct routing', async () => {
  const f = fixture()
  await f.step([message('newline', '\n/需求分析师 问题')])
  assert.equal(f.calls.length, 0)
  f.agent.session.header.parentSession = 'parent'
  f.agent.session.header.delegationDepth = 1
  await f.step([message('child', '/需求分析师 问题')])
  assert.equal(f.calls.length, 0)
})
