import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { importDesignProject, exportDesignProject } from '../src/design-project.ts'
import { createDesignState, applyDesignCommand } from '../src/design-model.ts'

const digest = value => 'sha256:'+createHash('sha256').update(value).digest('hex')
function fixture() {
  const scheme=createDesignState().designs[0], current='current picture', old='historic picture'
  scheme.model.floors[0].reference={assetId:digest(current),name:'plan.png',x:0,z:0,width:10,depth:8}
  const model=structuredClone(scheme.model);model.floors[0].reference.assetId=digest(old)
  scheme.versions=[{id:'old',name:'旧方案',model,createdAt:'2026-11-27T00:00:00.000Z'}]
  return {scheme,current,old}
}
test('new project exports just the named scheme and current referenced assets',async()=>{
  const {scheme,current}=fixture(), loads=[]
  const file=await exportDesignProject(scheme,async id=>{loads.push(id);return new Blob([current])})
  const payload=JSON.parse(await file.text())
  assert.equal(payload.formatVersion,2)
  assert.equal('versions' in payload.design,false)
  assert.deepEqual(loads,[digest(current)])
  const restored=await importDesignProject(file,async blob=>digest(await blob.text()))
  assert.deepEqual(restored,{id:scheme.id,name:scheme.name,model:scheme.model,versions:[]})
  assert.equal(scheme.versions.length,1)
})
test('old v1 project retains historical assets and imports as independently named schemes',async()=>{
  const {scheme,current,old}=fixture()
  const payload={type:'ihome.floorplan',formatVersion:1,design:scheme,assets:{[digest(current)]:btoa(current),[digest(old)]:btoa(old)}}
  const writes=[]
  const design=await importDesignProject(new Blob([JSON.stringify(payload)]),async data=>{const value=await data.text();writes.push(value);return digest(value)})
  assert.deepEqual(design,scheme);assert.deepEqual(writes,[current,old])
  const state=applyDesignCommand(createDesignState(),{action:'import',expectedRevision:0,design})
  assert.equal(state.designs.length,3)
  assert.equal(state.designs.at(-1).model.floors[0].reference.assetId,digest(old))
})
test('both project versions reject corrupt or absent assets before any write',async()=>{
  const {scheme,current}=fixture()
  const file=await exportDesignProject(scheme,async()=>new Blob([current]))
  const corrupt=JSON.parse(await file.text());corrupt.assets[digest(current)]=btoa('wrong')
  await assert.rejects(importDesignProject(new Blob([JSON.stringify(corrupt)]),async()=>assert.fail('corrupt write')),/损坏/)
  corrupt.assets={}
  await assert.rejects(importDesignProject(new Blob([JSON.stringify(corrupt)]),async()=>assert.fail('missing write')),/不完整/)
  corrupt.design.versions=scheme.versions
  await assert.rejects(importDesignProject(new Blob([JSON.stringify(corrupt)]),async()=>assert.fail('v2 versions write')),/单方案工程格式/)
})
