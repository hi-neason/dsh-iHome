import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const bundle = await build({ entryPoints: ['src/design-host.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { mountDesigns } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)

async function fixture(beforeUpdate, initial) {
  let state = initial, route, service, cleanup, closed = false
  const ctx = {
    storageDomain: { async open(spec) {
      assert.equal(spec.name, 'ihome_designs')
      return { table: () => ({
        get: () => state,
        async put(_id, value) { state = value },
        async update(_id, transform) { await beforeUpdate?.(); state = transform(state); return state },
      }), async close() { closed = true } }
    } },
    provide(name, value) { assert.equal(name, 'ihomeDesigns'); service = value; return () => {} },
    connection: { fetch: { register(value) { route = value; return () => { route = undefined } } } },
    async effect(setup) { cleanup = await setup() },
  }
  await mountDesigns(ctx)
  return { state: () => state, service, closed: () => closed, cleanup: () => cleanup(),
    http: (command, signal) => route.fetch(new Request('http://localhost/api/ihome/designs', command === undefined
      ? { signal } : { method: 'POST', body: JSON.stringify(command), headers: { 'content-type': 'application/json' }, signal })),
  }
}

test('HTTP initializes a local blank floor, saves once and rejects concurrent stale updates', async () => {
  const f = await fixture()
  const loaded = await (await f.http()).json()
  assert.equal(loaded.designs[0].model.floors.length, 1)
  const command = { action: 'create', expectedRevision: loaded.revision, name: '另一个方案' }
  const replies = await Promise.all([f.http(command), f.http(command)])
  assert.deepEqual(replies.map(reply => reply.status).sort(), [200, 409])
  assert.equal(f.state().designs.length, 2)
  assert.equal(f.state().revision, 1)
  const state = await (await f.http()).json()
  assert.deepEqual(state, f.service.read())
  state.designs[0].name = '外部错误修改'
  assert.notEqual(f.service.read().designs[0].name, '外部错误修改')
})

test('service returns detached results and cancellation during storage cannot mutate saved design', async () => {
  const controller = new AbortController()
  const f = await fixture(() => controller.abort())
  const prior = f.state()
  const view = f.service.read()
  view.designs[0].model.floors[0].height = 10
  assert.equal(f.state().designs[0].model.floors[0].height, 2.8)
  await assert.rejects(f.service.change({ action: 'create', expectedRevision: 0 }, controller.signal), { name: 'AbortError' })
  assert.equal(f.state(), prior)
  const invalid = await f.http({ action: 'replace', expectedRevision: 0, designId: view.activeId, model: { floors: [] } })
  assert.equal(invalid.status, 400)
  assert.equal(f.state(), prior)
})

test('HTTP and service refuse closed or aborted operations and dispose the storage domain', async () => {
  const f = await fixture()
  const controller = new AbortController()
  controller.abort()
  assert.equal((await f.http({ action: 'create', expectedRevision: 0 }, controller.signal)).status, 400)
  assert.equal(f.state().revision, 0)
  await f.cleanup()
  assert.equal(f.closed(), true)
  assert.throws(() => f.service.read(), /已关闭/)
  await assert.rejects(f.service.change({ action: 'create', expectedRevision: 0 }), /已关闭/)
})

test('startup migration persists once and preserves old snapshot identities after restart', async () => {
  const first=await fixture(), initial=first.service.read()
  initial.designs[0].versions=[{id:'legacy',name:'旧方案',model:structuredClone(initial.designs[0].model),createdAt:'2026-11-27T00:00:00.000Z'}]
  const migrated=await fixture(undefined,initial)
  assert.equal(migrated.state().revision,1)
  assert.equal(migrated.state().designs.length,2)
  assert.equal(migrated.state().designs[0].versions[0].id,'legacy')
  const restart=await fixture(()=>assert.fail('idempotent migration must not write'),migrated.state())
  assert.deepEqual(restart.state(),migrated.state())
})
test('rename endpoint applies exactly one concurrent CAS update without replacing geometry', async () => {
  const f=await fixture(), initial=f.service.read()
  const responses=await Promise.all(['方案甲','方案乙'].map(name=>f.http({action:'rename',designId:initial.activeId,expectedRevision:0,name})))
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409])
  assert.deepEqual(f.state().designs[0].model,initial.designs[0].model)
  assert.equal(f.state().designs[0].versions.length,0)
})

test('undo restores the exact last changed model after host restart and consumes saved history', async () => {
  const first=await fixture(), initial=first.service.read(), original=structuredClone(initial.designs[0].model)
  const model=structuredClone(original)
  model.floors[0].source='export function buildFloor(THREE) { const group = new THREE.Group(); return group; }'
  const saved=await first.service.change({action:'replace',expectedRevision:0,designId:initial.activeId,model})
  assert.deepEqual(saved.designs[0].previousModel,original)
  await first.cleanup()
  const restarted=await fixture(undefined,JSON.parse(JSON.stringify(saved)))
  assert.equal((await restarted.http({action:'undo',expectedRevision:0,designId:initial.activeId})).status,409)
  const response=await restarted.http({action:'undo',expectedRevision:1,designId:initial.activeId})
  assert.equal(response.status,200)
  const restored=await response.json()
  assert.deepEqual(restored.designs[0].model,original)
  assert.equal(restored.designs[0].previousModel,undefined)
  assert.equal((await restarted.http({action:'undo',expectedRevision:2,designId:initial.activeId})).status,400)
})
