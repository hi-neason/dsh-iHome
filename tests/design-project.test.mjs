import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { importDesignProject, exportDesignProject } from '../src/design-project.ts'
import { createDesignState } from '../src/design-model.ts'

test('editable project round trip preserves snapshots and embeds each referenced asset once', async () => {
  const scheme = createDesignState().designs[0]
  const blob = new Blob(['from historical version'])
  const id = 'sha256:'+createHash('sha256').update(await blob.text()).digest('hex')
  const model = structuredClone(scheme.model)
  model.floors[0].reference = { assetId:id,name:'plan.png',x:0,z:0,width:10,depth:8 }
  scheme.versions.push(...['A','B'].map(name=>({id:name,name,model,createdAt:new Date().toISOString()})))
  let loads=0, writes=0
  const file=await exportDesignProject(scheme,async key=>{loads++;assert.equal(key,id);return blob})
  const restored=await importDesignProject(file,async data=>{writes++;assert.equal(await data.text(),await blob.text());return id})
  assert.equal(loads,1);assert.equal(writes,1);assert.deepEqual(restored,scheme)
  const corrupted=JSON.parse(await file.text())
  corrupted.assets[id]=btoa('wrong content')
  await assert.rejects(importDesignProject(new Blob([JSON.stringify(corrupted)]),async()=>{assert.fail('corrupt data written')}),/损坏/)
})
