import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { validateFloorSource, buildFloorSource } from '../src/design-source.ts'
import { createDesignState, applyDesignCommand, validateDesignState, validateDesignModel } from '../src/design-model.ts'
import { exportDesignProject, importDesignProject } from '../src/design-project.ts'
const source=`export function buildFloor(THREE) {
 const room = new THREE.Group();
 const width = 4;
 const geometry = new THREE.BoxGeometry(width, 0.5, 2);
 const material = new THREE.MeshStandardMaterial({color: 0xabcdef, roughness: 0.7, side: THREE.DoubleSide});
 const sofa = new THREE.Mesh(geometry, material);
 sofa.name = "沙发";
 sofa.position.set(1, 0.25, -2);
 sofa.rotation.y = Math.PI / 2;
 sofa.scale.setScalar(0.5);
 sofa.castShadow = true;
 room.add(sofa);
 return room;
}`
function withSource() { const model=createDesignState().designs[0].model;model.floors[0].source=source;return model }
test('restricted real Three code builds geometry, material, placement and nested groups',()=>{
 validateFloorSource(source)
 const group=buildFloorSource(source,THREE),mesh=group.children[0]
 assert.ok(group instanceof THREE.Group);assert.ok(mesh instanceof THREE.Mesh)
 assert.equal(mesh.geometry.parameters.width,4);assert.equal(mesh.material.color.getHex(),0xabcdef)
 assert.deepEqual(mesh.position.toArray(),[1,0.25,-2]);assert.equal(mesh.rotation.y,Math.PI/2)
 assert.equal(mesh.scale.x,0.5);assert.equal(mesh.name,'沙发');assert.equal(mesh.castShadow,true)
 const nested=buildFloorSource('export function buildFloor(THREE) { const g=new THREE.Group(); const child=new THREE.Group(); const m=new THREE.Mesh(new THREE.SphereGeometry(1,8,8),new THREE.MeshBasicMaterial({color:"#ff0000"})); child.add(m);g.add(child);return g;}',THREE)
 assert.equal(nested.children[0].children.length,1)
})
test('no runtime evaluation or arbitrary JS escape paths are admitted',()=>{
 for(const body of [
  'globalThis.alert(1);','const g=new THREE.WebGLRenderer();','const g=new THREE.Group();g.constructor("return globalThis")();',
  'const g=new THREE.Group();g.userData.x=1;','const g=new THREE.Group();while(true){}',
  'const g=new THREE.Group();const alias=g;g.add(alias);','const g=new THREE.Group();const child=new THREE.Group();g.add(child);child.add(g);',
  'const g=new THREE.Group();fetch("https://example.com");','const g=new THREE.Group();const n=1/0;',
  'const g=new THREE.Group();const m=new THREE.MeshBasicMaterial({map:"https://example.com"});',
  'const g=new THREE.Group();g.position.set(1,2,"3");','const g=new THREE.Group();const q=new THREE.SphereGeometry(1,100000,100000);',
  'const g=new THREE.Group();const n=Function("return 1")();',
 ]) assert.throws(()=>validateFloorSource(`export function buildFloor(THREE) { ${body} return g; }`),body)
 assert.throws(()=>validateFloorSource('export function buildFloor(THREE) { const g=new THREE.Group(); const n='+ '('.repeat(100)+'1'+')'.repeat(100)+';return g;}'),/64层/)
 assert.throws(()=>validateFloorSource(source+';globalThis.x=1;'))
 assert.throws(()=>validateFloorSource(' '.repeat(64001)))
 assert.throws(()=>validateFloorSource('export function buildFloor(THREE) {'+Array.from({length:401},(_,i)=>`const a${i}=new THREE.Group();`).join('')+'return a0;}'),/400/)
})
test('source persists, copies and exchanges without importing undo state',async()=>{
 let state=createDesignState(),id=state.activeId
 state=applyDesignCommand(state,{action:'replace',designId:id,expectedRevision:0,model:withSource()})
 const scheme=state.designs[0]
 assert.equal(scheme.model.floors[0].source,source);assert.ok(scheme.previousModel)
 const copy=applyDesignCommand(state,{action:'copy',designId:id,expectedRevision:1})
 assert.equal(copy.designs[1].model.floors[0].source,source);assert.equal(copy.designs[1].previousModel,undefined)
 const file=await exportDesignProject(scheme,async()=>assert.fail('no assets'))
 assert.equal(JSON.parse(await file.text()).design.previousModel,undefined)
 const restored=await importDesignProject(file,async()=>assert.fail('no assets'))
 assert.equal(restored.model.floors[0].source,source);assert.equal(restored.previousModel,undefined)
 const invalid=withSource();invalid.floors[0].walls=[{id:'wall',name:'wall',x1:0,z1:0,x2:1,z2:0,thickness:0.1}]
 assert.throws(()=>validateDesignModel(invalid),/不能同时/)
})
test('one-step undo survives storage/reload, is scheme scoped and requires current revision',()=>{
 let state=createDesignState(),id=state.activeId
 state=applyDesignCommand(state,{action:'replace',designId:id,expectedRevision:0,model:withSource()})
 const second=structuredClone(state.designs[0].model);second.floors[0].source=source.replace('width = 4','width = 6')
 state=applyDesignCommand(state,{action:'replace',designId:id,expectedRevision:1,model:second})
 const prior=structuredClone(state.designs[0].previousModel),same=structuredClone(state.designs[0].model)
 state=applyDesignCommand(state,{action:'replace',designId:id,expectedRevision:2,model:same})
 assert.deepEqual(state.designs[0].previousModel,prior)
 state=validateDesignState(JSON.parse(JSON.stringify(state)))
 state=applyDesignCommand(state,{action:'create',expectedRevision:3,name:'其他方案'})
 const other=structuredClone(state.designs[1])
 assert.throws(()=>applyDesignCommand(state,{action:'undo',designId:id,expectedRevision:3}),/更新/)
 state=applyDesignCommand(state,{action:'undo',designId:id,expectedRevision:4})
 assert.deepEqual(state.designs[0].model,prior);assert.equal(state.designs[0].previousModel,undefined)
 assert.deepEqual(state.designs[1],other);assert.equal(state.activeId,other.id)
 assert.throws(()=>applyDesignCommand(state,{action:'undo',designId:id,expectedRevision:5}),/没有可撤销/)
})

test('admitted source respects JavaScript reserved bindings, token boundaries and return semantics', () => {
 for (const binding of ['class','await','yield','return','const','null','eval','arguments']) {
  assert.throws(()=>validateFloorSource(`export function buildFloor(THREE) { const ${binding}=new THREE.Group(); return ${binding}; }`))
 }
 for (const expression of ['++1','--1','1--2','012']) {
  assert.throws(()=>validateFloorSource(`export function buildFloor(THREE) { const group=new THREE.Group(); const value=${expression};return group; }`))
 }
 assert.throws(()=>validateFloorSource('export function buildFloor(THREE) { const g=new THREE.Group() return g; }'))
 assert.throws(()=>validateFloorSource('export function buildFloor(THREE) { const g=new THREE.Group(); return\ng; }'))
 assert.throws(()=>validateFloorSource("export function buildFloor(THREE) { const g=new THREE.Group();g.name='bad\nstring';return g; }"))
 assert.doesNotThrow(()=>validateFloorSource('export function buildFloor(THREE) {\nconst g=new THREE.Group()\ng.position.x = - -1\nreturn g\n}'))
})
test('cached successful programs still create independent Three resources', () => {
 const first=buildFloorSource(source,THREE)
 first.children[0].position.x=99
 first.children[0].material.color.setHex(0)
 // More than the bounded cache capacity must remain semantically equivalent.
 for(let i=0;i<20;i++) validateFloorSource(source.replace('width = 4',`width = ${i+1}`))
 const second=buildFloorSource(source,THREE)
 assert.equal(second.children[0].position.x,1)
 assert.equal(second.children[0].material.color.getHex(),0xabcdef)
 assert.notEqual(first.children[0].geometry,second.children[0].geometry)
})
