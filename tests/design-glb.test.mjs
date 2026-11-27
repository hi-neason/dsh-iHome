import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const dir = await mkdtemp(join(tmpdir(), 'ihome-glb-'))
const bundle = await build({ entryPoints: ['src/design-glb.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const file = join(dir, 'glb.mjs')
await writeFile(file, bundle.outputFiles[0].text)
const { inspectGLB, loadGLB, placeGLB, disposeGLB, loadDesignAssets, exportDesignGLB } = await import(pathToFileURL(file))
after(() => rm(dir, { recursive: true, force: true }))

function triangle(patch = {}) {
  const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0,0,0], max: [1,1,0] }], ...patch }
  const text = JSON.stringify(json), length = Math.ceil(Buffer.byteLength(text) / 4) * 4
  const buffer = new ArrayBuffer(12 + 8 + length + 8 + 36), view = new DataView(buffer)
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, buffer.byteLength, true)
  view.setUint32(12, length, true); view.setUint32(16, 0x4e4f534a, true)
  new Uint8Array(buffer, 20, length).fill(32); new Uint8Array(buffer, 20).set(new TextEncoder().encode(text))
  view.setUint32(20 + length, 36, true); view.setUint32(24 + length, 0x004e4942, true)
  new Float32Array(buffer, 28 + length).set([0,0,0,1,0,0,0,1,0])
  return buffer
}
const asset = { id:'chair', name:'椅子', assetId:'sha256:'+'a'.repeat(64), x:2,y:1,z:3,scale:2,rotation:90 }

test('loads a real embedded triangle and applies placement without changing native mesh geometry', async () => {
  const scene = await loadGLB(triangle())
  assert.equal(scene.children[0].geometry.attributes.position.count, 3)
  const placed = placeGLB(scene, asset)
  assert.deepEqual(placed.position.toArray(), [2,1,3])
  assert.equal(placed.rotation.y, Math.PI / 2)
  assert.equal(placed.scale.x, 2)
  let geometryDisposed = 0, materialDisposed = 0
  scene.children[0].geometry.addEventListener('dispose', () => geometryDisposed++)
  scene.children[0].material.addEventListener('dispose', () => materialDisposed++)
  disposeGLB(placed)
  assert.equal(geometryDisposed, 1); assert.equal(materialDisposed, 1)
})

test('rejects malformed files, all external references and decoder requirements before loading', async () => {
  assert.throws(() => inspectGLB(new ArrayBuffer(4)), /无效/)
  const bad = triangle(); new DataView(bad).setUint32(8, 20, true)
  assert.throws(() => inspectGLB(bad), /完整/)
  for (const uri of ['https://example.com/a.bin','file:///etc/passwd','data:application/octet-stream;base64,AA==']) {
    assert.throws(() => inspectGLB(triangle({ buffers: [{ byteLength:36,uri }] })), /URI/)
  }
  assert.throws(() => inspectGLB(triangle({ extensions: { KHR_draco_mesh_compression: {} } })), /解码/)
  assert.throws(() => inspectGLB(triangle({ extensionsRequired: ['VENDOR_unknown'] })), /不受支持/)
  await assert.rejects(loadGLB(triangle({ meshes:[{ primitives:[{ attributes:{POSITION:99} }] }] })))
})

test('attaches assets to their floor and rolls back earlier loads on missing asset', async () => {
  const root = await loadGLB(triangle()); root.clear()
  const floorGroup = await loadGLB(triangle()); floorGroup.clear(); floorGroup.userData.floorId = 'upper'; floorGroup.position.y = 3; root.add(floorGroup)
  const child = await loadGLB(triangle())
  child.userData.floorId = 'upper'
  child.position.y = 1.4
  floorGroup.add(child)
  const model = { floors:[{ id:'upper',name:'二楼',assets:[asset] }] }
  await loadDesignAssets(model, root, { allFloors:true }, undefined, async () => new Blob([triangle()]))
  root.updateMatrixWorld(true)
  assert.equal(floorGroup.children.length, 2)
  assert.equal(floorGroup.children[1].matrixWorld.elements[13], 4)
  disposeGLB(floorGroup.children[1])
  let calls = 0
  await assert.rejects(loadDesignAssets({floors:[{...model.floors[0],assets:[asset,{...asset,id:'second'}]}]},root, {allFloors:true},undefined,async () => {
    if (++calls === 2) throw new Error('missing'); return new Blob([triangle()])
  }), /missing/)
  assert.deepEqual(floorGroup.children, [child])
  disposeGLB(root)
})

test('honors pre-abort and abort while asset IO is pending', async () => {
  const abort = new AbortController(); abort.abort()
  await assert.rejects(loadGLB(triangle(), abort.signal), {name:'AbortError'})
  const root = await loadGLB(triangle()); root.children[0].userData.floorId = 'floor'
  const controller = new AbortController()
  await assert.rejects(loadDesignAssets({floors:[{id:'floor',assets:[asset]}]},root,{allFloors:true},controller.signal,async () => {
    controller.abort(); return new Blob([triangle()])
  }), {name:'AbortError'})
  assert.equal(root.children[0].children.length, 0)
})

// GLTFExporter uses the browser FileReader API even for geometry-only binary output.
class FileReaderShim {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(value => { this.result=value; this.onloadend?.() }) }
  readAsDataURL(blob) { blob.arrayBuffer().then(value => { this.result='data:'+blob.type+';base64,'+Buffer.from(value).toString('base64'); this.onloadend?.() }) }
}
test('exports and reloads geometry on every floor with correct elevations', async () => {
  const previous = globalThis.FileReader; globalThis.FileReader = FileReaderShim
  try {
    const floor = (id,elevation) => ({id,name:id,elevation,height:2.8,openings:[],items:[],walls:[{id:id+'w',name:'墙',x1:0,z1:0,x2:4,z2:0,thickness:0.2}]})
    const blob = await exportDesignGLB({floors:[floor('a',0),floor('b',3)]})
    const result = await loadGLB(await blob.arrayBuffer())
    const floors = []; result.traverse(node => { if (node.userData.floorId && ['a','b'].includes(node.name)) floors.push(node) })
    assert.equal(floors.length, 2)
    assert.deepEqual(floors.map(node => node.position.y).sort(), [0,3])
    disposeGLB(result)
  } finally { globalThis.FileReader = previous }
})
