import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mountDesignMedia } from '../src/design-media-host.ts'

test('media route stores supported files locally and only serves IDs registered by design', async () => {
  let route
  const files = new Map(), contents = new Map()
  await mountDesignMedia({
    async effect(setup) { await setup() },
    connection: { fetch: { register(r) { route = r; return () => {} } } },
    storageDomain: { async open() { return { table() { return { get: id => files.get(id), put: (id,value) => files.set(id,value) } }, close() {} } } },
    attachments: {
      async saveFile({data,name}) {
        const attachmentId = 'sha256:' + createHash('sha256').update(data).digest('hex')
        contents.set(attachmentId,data)
        return { attachmentId, name, bytes: data.length }
      },
      async *readFileStream({attachmentId}) { yield contents.get(attachmentId) },
    },
  })
  const url = 'http://local/api/ihome/design-media'
  const bytes = new Uint8Array([137,80,78,71,13,10,26,10])
  const response = await route.fetch(new Request(url + '?name=plan.png',{ method:'POST',body:bytes }))
  assert.equal(response.status,200)
  const {id} = await response.json()
  const image = await route.fetch(new Request(url + '?id=' + id))
  assert.equal(image.headers.get('content-type'),'image/png')
  assert.deepEqual(new Uint8Array(await image.arrayBuffer()),bytes)
  assert.equal((await route.fetch(new Request(url + '?id=sha256:' + 'a'.repeat(64)))).status,404)
  assert.equal((await route.fetch(new Request(url,{method:'POST',body:'other type'}))).status,400)
})
