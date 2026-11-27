import test from 'node:test'
import assert from 'node:assert/strict'
import { createDesignReferenceTool } from '../src/design-reference-tool.ts'

const sourceId='sha256:'+'a'.repeat(64), historicalId='sha256:'+'b'.repeat(64)
function fixture() {
  const ref={assetId:sourceId,name:'一楼原始图',x:-2,z:1,width:12,depth:8}
  const floor={id:'first',name:'一楼',elevation:0,height:2.8,walls:[],openings:[],items:[],reference:ref}
  const model={floors:[floor]}, oldModel=structuredClone(model)
  oldModel.floors[0].reference.assetId=historicalId
  oldModel.floors[0].reference.width=10
  const state={revision:4,activeId:'scheme',designs:[{id:'scheme',name:'方案A',model,versions:[{id:'v1',name:'原始版本',model:oldModel,createdAt:'2026-11-27'}]}]}
  const reads=[], saves=[], data=new Uint8Array([137,80,78,71])
  const access={readDesign:()=>state,async readMedia(id,signal){signal.throwIfAborted();reads.push(id);return {data,name:'original.png',mime:'image/png'}},
    async saveImage(input){saves.push(input);return {attachmentId:'sha256:'+'c'.repeat(64),mediaType:'image/png',bytes:4,width:1200,height:800,name:input.name}}}
  const tool=createDesignReferenceTool(access), execution={signal:new AbortController().signal}
  return {state,access,reads,saves,data,tool,execution}
}
test('returns real image attachment and explicit calibration for the selected floor',async()=>{
  const f=fixture(),before=structuredClone(f.state)
  const value=await f.tool.execute({floorId:'first'},f.execution)
  const blocks=f.tool.output.render({},value)
  assert.deepEqual(f.reads,[sourceId]);assert.equal(f.saves[0].data,f.data)
  assert.equal(f.saves[0].mediaType,'image/png')
  assert.equal(blocks[1].type,'image');assert.equal(blocks[1].attachment.width,1200)
  const metadata=JSON.parse(blocks[0].text)
  assert.deepEqual(metadata.calibration,{unit:'metre',origin:'top-left',x:-2,z:1,width:12,depth:8})
  assert.equal(metadata.sourceAssetId,sourceId);assert.equal(metadata.floorId,'first');assert.equal(metadata.revision,4)
  assert.deepEqual(f.state,before)
})
test('reads historical reference without falling back to current draft',async()=>{
  const f=fixture(),value=await f.tool.execute({designId:'scheme',versionId:'v1',floorId:'first'},f.execution)
  assert.deepEqual(f.reads,[historicalId])
  assert.equal(JSON.parse(value.description).calibration.width,10)
  assert.equal(Object.hasOwn(JSON.parse(value.description),'versionName'),false)
  assert.equal(Object.hasOwn(f.tool.parameters.properties,'versionId'),false)
})
test('rejects unknown selectors before reading media',async()=>{
  const f=fixture()
  for(const args of [{},{floorId:'absent'},{floorId:'first',designId:'absent'},{floorId:'first',versionId:'absent'},{floorId:'first',path:'/tmp/a'},{floorId:'first',designId:3}]) await assert.rejects(f.tool.execute(args,f.execution))
  assert.equal(f.reads.length,0)
})
test('a valid floor without a reference returns only text and needs no attachment', async () => {
  const f = fixture()
  delete f.state.designs[0].model.floors[0].reference
  const result = await f.tool.execute({floorId:'first'}, f.execution)
  const blocks = f.tool.output.render({}, result)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, 'text')
  const info = JSON.parse(blocks[0].text)
  assert.equal(info.reference, null)
  assert.equal(info.floorId, 'first')
  assert.equal(f.reads.length, 0)
  assert.equal(f.saves.length, 0)
})
test('rejects non-image data and propagates decode and media errors',async()=>{
  const f=fixture()
  f.access.readMedia=async()=>({data:f.data,name:'bad.glb',mime:'model/gltf-binary'})
  await assert.rejects(f.tool.execute({floorId:'first'},f.execution),/不是支持的图片/)
  assert.equal(f.saves.length,0)
  f.access.readMedia=async()=>({data:f.data,name:'bad.png',mime:'image/png'})
  f.access.saveImage=async()=>{throw new Error('decode failed')}
  await assert.rejects(f.tool.execute({floorId:'first'},f.execution),/decode failed/)
  f.access.readMedia=async()=>{throw new Error('missing asset')}
  await assert.rejects(f.tool.execute({floorId:'first'},f.execution),/missing asset/)
})
test('honors cancellation before and after local image admission',async()=>{
  const f=fixture(),controller=new AbortController()
  controller.abort()
  await assert.rejects(f.tool.execute({floorId:'first'},{signal:controller.signal}),{name:'AbortError'})
  assert.equal(f.reads.length,0)
  const delayed=new AbortController(),save=f.access.saveImage
  f.access.saveImage=async input=>{const result=await save(input);delayed.abort();return result}
  await assert.rejects(f.tool.execute({floorId:'first'},{signal:delayed.signal}),{name:'AbortError'})
})
