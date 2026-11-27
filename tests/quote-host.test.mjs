import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const bundled = await build({ entryPoints: ['src/quote-host.ts'], platform: 'node', bundle: true, write: false, format: 'esm' })
const { mountQuotes } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].contents).toString('base64'))

test('incremental reads return no body until the local board revision changes', async () => {
  let board, route, close
  const store = { get: () => board, put: async (_key, value) => { board = value }, update: async (_key, fn) => (board = fn(board)) }
  await mountQuotes({
    effect: async setup => { close = await setup() },
    storageDomain: { open: async () => ({ table: () => store, close: async () => {} }) },
    connection: { fetch: { register(value) { route = value; return () => {} } } },
    tools: { register: () => () => {} },
  })
  const url = 'http://localhost/api/ihome/quotes'
  const prior = await route.fetch(new Request(url + '?revision=0'))
  assert.equal(prior.status, 204)
  assert.equal(await prior.text(), '')
  const command = { expectedRevision: 0, collection: 'vendors', record: { name: '甲', id: 'v1' } }
  assert.equal((await route.fetch(new Request(url, { method: 'POST', body: JSON.stringify(command) }))).status, 200)
  assert.equal((await (await route.fetch(new Request(url + '?revision=0'))).json()).vendors[0].name, '甲')
  assert.equal((await route.fetch(new Request(url + '?revision=1'))).status, 204)
  assert.equal((await route.fetch(new Request(url, { method: 'POST', body: JSON.stringify({ ...command, record: { id: 'v1', name: '旧草稿' } }) }))).status, 409)
  assert.equal(board.vendors[0].name, '甲')
  await close()
})
