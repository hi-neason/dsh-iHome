import * as THREE from 'three'
import { buildFloorSource } from './design-source.ts'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { DesignModel, DesignFloor, DesignItem, DesignOpening, DesignWall } from './design-model'
import { floorSlabPolygons, wallPanels } from './design-geometry.ts'

export interface DesignSceneOptions { floorId?: string, allFloors?: boolean, selectedId?: string | null, mode?: 'plan' | 'space' }
export type DesignAssetLoader = (model: DesignModel, group: THREE.Group, options: { floorId: string, allFloors: boolean }, signal: AbortSignal) => Promise<void>
const slabThickness = .15
const colors = { wall: 0xe9e7df, floor: 0xd6c8af, furniture: 0x739084, stair: 0xb29a74, door: 0xc2a580, window: 0xa3d3db, selected: 0xda9157 }

function material(color: number, selected = false, transparent = false) {
  return new THREE.MeshStandardMaterial({ color: selected ? colors.selected : color, roughness: .72,
    metalness: 0, transparent, opacity: transparent ? .35 : 1, side: transparent ? THREE.DoubleSide : THREE.FrontSide })
}
function box(width: number, height: number, depth: number, color: number, selected = false): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material(color, selected))
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}
function identify(object: THREE.Object3D, floorId: string, elementId: string, kind: string) {
  object.userData = { ...object.userData, floorId, elementId, kind }
}
function addWall(group: THREE.Group, floor: DesignFloor, wall: DesignWall, selectedId?: string | null) {
  const length = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1)
  const direction = Math.atan2(wall.z2 - wall.z1, wall.x2 - wall.x1)
  const wallGroup = new THREE.Group()
  wallGroup.name = wall.name
  wallGroup.position.set(wall.x1, 0, wall.z1)
  wallGroup.rotation.y = -direction
  identify(wallGroup, floor.id, wall.id, 'wall')
  for (const panel of wallPanels(wall, floor.height, floor.openings)) {
    const mesh = box(panel.end - panel.start, panel.top - panel.bottom, wall.thickness, colors.wall, selectedId === wall.id)
    mesh.position.set((panel.start + panel.end) / 2, (panel.bottom + panel.top) / 2, 0)
    identify(mesh, floor.id, wall.id, 'wall')
    wallGroup.add(mesh)
  }
  for (const opening of floor.openings.filter(item => item.wallId === wall.id)) addOpening(wallGroup, floor, wall, opening, selectedId)
  if (length > 0) group.add(wallGroup)
}
function addOpening(group: THREE.Group, floor: DesignFloor, wall: DesignWall, opening: DesignOpening, selectedId?: string | null) {
  const selected = selectedId === opening.id
  const frame = new THREE.Group()
  frame.name = opening.name
  frame.position.set(opening.offset, opening.sill, 0)
  identify(frame, floor.id, opening.id, opening.kind)
  const thickness = .035
  for (const [x, y, width, height] of [
    [thickness / 2, opening.height / 2, thickness, opening.height],
    [opening.width - thickness / 2, opening.height / 2, thickness, opening.height],
    [opening.width / 2, opening.height - thickness / 2, opening.width, thickness],
  ]) {
    const bar = box(width, height, wall.thickness + .025, colors.door, selected)
    bar.position.set(x, y, 0)
    identify(bar, floor.id, opening.id, opening.kind)
    frame.add(bar)
  }
  if (opening.kind === 'window') {
    const glass = new THREE.Mesh(new THREE.BoxGeometry(Math.max(.02, opening.width - .07), Math.max(.02, opening.height - .07), .025), material(colors.window, selected, true))
    glass.position.set(opening.width / 2, opening.height / 2, 0)
    identify(glass, floor.id, opening.id, 'window')
    frame.add(glass)
    const sill = box(opening.width, .035, wall.thickness + .06, colors.door, selected)
    sill.position.set(opening.width / 2, .0175, 0)
    identify(sill, floor.id, opening.id, 'window')
    frame.add(sill)
  } else {
    const hinge = new THREE.Group()
    hinge.rotation.y = -Math.PI * .42
    const leaf = box(Math.max(.02, opening.width - .06), Math.max(.02, opening.height - .04), .035, colors.door, selected)
    leaf.position.set(opening.width / 2, opening.height / 2, 0)
    identify(leaf, floor.id, opening.id, 'door')
    hinge.add(leaf)
    frame.add(hinge)
  }
  group.add(frame)
}
function addItem(group: THREE.Group, model: DesignModel, floor: DesignFloor, item: DesignItem, selectedId?: string | null) {
  if (item.kind === 'room' || item.kind === 'void') return
  const object = new THREE.Group()
  object.name = item.name
  object.position.set(item.x, 0, item.z)
  object.rotation.y = -THREE.MathUtils.degToRad(item.rotation)
  identify(object, floor.id, item.id, item.kind)
  if (item.kind === 'stair') {
    const target = model.floors.find(value => value.id === item.targetFloorId)
    const rise = target ? target.elevation - floor.elevation : item.height
    const count = Math.max(2, Math.min(100, Math.ceil(rise / .18)))
    for (let index = 0; index < count; index++) {
      const height = rise * (index + 1) / count
      const tread = box(item.width, height, item.depth / count, colors.stair, selectedId === item.id)
      tread.position.set(0, height / 2, -item.depth / 2 + item.depth * (index + .5) / count)
      identify(tread, floor.id, item.id, 'stair')
      object.add(tread)
    }
  } else {
    const mesh = box(item.width, item.height, item.depth, colors.furniture, selectedId === item.id)
    mesh.position.y = item.height / 2
    identify(mesh, floor.id, item.id, 'furniture')
    object.add(mesh)
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: 0x4f685d, transparent: true, opacity: .35 }))
    edges.position.copy(mesh.position)
    object.add(edges)
  }
  group.add(object)
}

/** Portable geometry in metres with Y up. The caller owns all returned resources. */
export function buildDesignGroup(model: DesignModel, options: DesignSceneOptions = {}): THREE.Group {
  const root = new THREE.Group()
  root.name = 'iHome'
  for (const floor of model.floors) {
    if (options.allFloors === false && floor.id !== options.floorId) continue
    const floorGroup = new THREE.Group()
    floorGroup.name = floor.id
    floorGroup.position.y = floor.elevation
    floorGroup.userData = { floorId: floor.id, floorName: floor.name }
    root.add(floorGroup)
    if (floor.source) {
      try { floorGroup.add(buildFloorSource(floor.source, THREE)) }
      catch (error) { disposeDesignGroup(root); throw error }
      continue
    }
    for (const slab of floorSlabPolygons(model, floor)) {
      const shape = new THREE.Shape(slab.polygon.map(point => new THREE.Vector2(point.x, -point.z)))
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: slabThickness, bevelEnabled: false, steps: 1 })
      // Shape xy -> world xz, extrusion lies below the walkable floor elevation.
      geometry.rotateX(-Math.PI / 2)
      geometry.translate(0, -slabThickness, 0)
      const mesh = new THREE.Mesh(geometry, material(colors.floor, options.selectedId === slab.roomId))
      mesh.receiveShadow = true
      mesh.name = '楼板'
      identify(mesh, floor.id, slab.roomId, 'room')
      floorGroup.add(mesh)
    }
    for (const wall of floor.walls) addWall(floorGroup, floor, wall, options.selectedId)
    for (const item of floor.items) addItem(floorGroup, model, floor, item, options.selectedId)
  }
  root.updateMatrixWorld(true)
  return root
}

export function disposeDesignGroup(group: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>()
  group.traverse(object => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points)) return
    geometries.add(object.geometry)
    for (const value of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(value)
      for (const property of Object.values(value)) if (property instanceof THREE.Texture) textures.add(property)
    }
  })
  for (const geometry of geometries) geometry.dispose()
  for (const value of materials) value.dispose()
  for (const texture of textures) {
    const image = texture.source?.data as { close?: () => void } | undefined
    image?.close?.()
    texture.dispose()
  }
  group.clear()
}

export function mountDesignScene(canvas: HTMLCanvasElement, onError: (message: string) => void) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setClearColor(0x000000, 0)
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.15
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(0xfff9ec, 0x7d928b, 2.6))
  const sun = new THREE.DirectionalLight(0xffffff, 3.3)
  sun.position.set(-8, 15, 9)
  scene.add(sun)
  const fill = new THREE.DirectionalLight(0xc9e0ff, 1.2)
  fill.position.set(8, 6, -9)
  scene.add(fill)
  const grid = new THREE.GridHelper(40, 40, 0xa2ada5, 0xbac0b8)
  grid.position.y = -.17
  grid.material.transparent = true
  grid.material.opacity = .28
  scene.add(grid)
  const perspective = new THREE.PerspectiveCamera(40, 1, .05, 3000)
  const plan = new THREE.OrthographicCamera(-10, 10, 10, -10, .01, 3000)
  plan.up.set(0, 0, -1)
  let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = perspective
  camera.position.set(10, 10, 12)
  let controls = new OrbitControls(camera, canvas)
  let mode: 'plan' | 'space' = 'space', halfHeight = 10
  let group = new THREE.Group(), frame = 0, disposed = false, lost = false
  let loading: AbortController | undefined
  scene.add(group)

  function configureControls() {
    controls.enableDamping = true
    controls.dampingFactor = .12
    controls.enableRotate = mode === 'space'
    controls.screenSpacePanning = true
    controls.mouseButtons.LEFT = mode === 'plan' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE
    controls.touches.ONE = mode === 'plan' ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE
    controls.maxPolarAngle = Math.PI * .49
    controls.minDistance = .5
    controls.maxDistance = 10000
    controls.minZoom = .02
    controls.maxZoom = 100
    controls.addEventListener('change', requestRender)
  }
  function render() {
    frame = 0
    if (disposed || lost || !canvas.clientWidth || !canvas.clientHeight) return
    const moving = controls.update()
    renderer.render(scene, camera)
    if (moving) requestRender()
  }
  function requestRender() { if (!frame && !disposed && !lost) frame = requestAnimationFrame(render) }
  function resize() {
    const width = canvas.clientWidth, height = canvas.clientHeight
    if (!width || !height || disposed || lost) return
    renderer.setSize(width, height, false)
    const aspect = width / height
    perspective.aspect = aspect
    perspective.updateProjectionMatrix()
    plan.left = -halfHeight * aspect; plan.right = halfHeight * aspect
    plan.top = halfHeight; plan.bottom = -halfHeight
    plan.updateProjectionMatrix()
    requestRender()
  }
  function fit() {
    const bounds = new THREE.Box3().setFromObject(group)
    if (bounds.isEmpty()) bounds.set(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 8))
    const center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3())
    const aspect = Math.max(canvas.clientWidth, 1) / Math.max(canvas.clientHeight, 1)
    controls.target.copy(center)
    if (mode === 'plan') {
      halfHeight = Math.max(size.z, size.x / aspect, 2) * .6
      plan.zoom = 1
      plan.position.set(center.x, bounds.max.y + Math.max(size.length(), 10) * 2, center.z)
      plan.far = Math.max(3000, size.length() * 6)
      plan.lookAt(center)
    } else {
      const radius = Math.max(size.length() / 2, 2)
      const fov = THREE.MathUtils.degToRad(perspective.fov)
      const narrowFov = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * aspect))
      const distance = radius / Math.sin(narrowFov / 2) * 1.1
      const direction = new THREE.Vector3(1, 1, 1.2).normalize()
      perspective.position.copy(center).addScaledVector(direction, distance)
      perspective.far = Math.max(3000, distance * 4)
      perspective.updateProjectionMatrix()
    }
    resize()
    controls.update()
    requestRender()
  }
  function zoom(factor: number) {
    if (mode === 'plan') { plan.zoom = Math.max(.02, Math.min(100, plan.zoom * factor)); plan.updateProjectionMatrix() }
    else {
      const offset = perspective.position.clone().sub(controls.target)
      const distance = Math.max(controls.minDistance, Math.min(controls.maxDistance, offset.length() / factor))
      perspective.position.copy(controls.target).add(offset.setLength(distance))
    }
    controls.update(); requestRender()
  }
  function setMode(next: 'plan' | 'space') {
    if (next === mode) return
    controls.removeEventListener('change', requestRender)
    controls.dispose()
    mode = next
    camera = mode === 'plan' ? plan : perspective
    controls = new OrbitControls(camera, canvas)
    configureControls()
  }
  function contextLost(event: Event) { event.preventDefault(); lost = true; cancelAnimationFrame(frame); frame = 0; onError('模型显示已中断，正在等待显卡恢复。') }
  function contextRestored() { lost = false; onError(''); resize() }
  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  configureControls()
  canvas.addEventListener('webglcontextlost', contextLost)
  canvas.addEventListener('webglcontextrestored', contextRestored)
  resize()
  return {
    fit, zoom,
    update(model: DesignModel, options: DesignSceneOptions, loadAssets?: DesignAssetLoader) {
      loading?.abort()
      onError('')
      setMode(options.mode ?? 'space')
      scene.remove(group)
      disposeDesignGroup(group)
      try { group = buildDesignGroup(model, options) }
      catch (error) { onError(error instanceof Error ? error.message : '模型源码无法绘制。'); group = new THREE.Group() }
      scene.add(group)
      grid.position.y = Math.min(...model.floors.filter(floor => options.allFloors !== false || floor.id === options.floorId).map(floor => floor.elevation), 0) - .17
      fit()
      const controller = new AbortController()
      loading = controller
      const currentGroup = group
      void (async () => {
        if (loadAssets) await loadAssets(model, currentGroup, { floorId: options.floorId ?? '', allFloors: options.allFloors !== false }, controller.signal)
        if (options.mode === 'plan') await loadPlanReferences(model, currentGroup, controller.signal)
      })().then(() => {
        if (controller.signal.aborted) { disposeDesignGroup(currentGroup); return }
        currentGroup.updateMatrixWorld(true)
        fit()
      }).catch(error => { if (!controller.signal.aborted) onError(error instanceof Error ? error.message : '模型素材加载失败。') })
    },
    dispose() {
      disposed = true
      loading?.abort()
      cancelAnimationFrame(frame)
      observer.disconnect()
      canvas.removeEventListener('webglcontextlost', contextLost)
      canvas.removeEventListener('webglcontextrestored', contextRestored)
      controls.removeEventListener('change', requestRender)
      controls.dispose()
      disposeDesignGroup(scene)
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }
}

async function loadPlanReferences(model: DesignModel, root: THREE.Group, signal: AbortSignal) {
  const { readDesignAsset } = await import('./design-media-client')
  for (const floor of model.floors) {
    const parent = root.children.find(child => child.userData.floorId === floor.id)
    if (!parent || !floor.reference) continue
    const ref = floor.reference
    const bitmap = await createImageBitmap(await readDesignAsset(ref.assetId, signal), { imageOrientation: 'flipY' })
    if (signal.aborted) { bitmap.close(); signal.throwIfAborted() }
    const texture = new THREE.Texture(bitmap)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.needsUpdate = true
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(ref.width, ref.depth), new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: .65, side: THREE.DoubleSide }))
    mesh.name = '原始户型底图'
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(ref.x + ref.width / 2, .02, ref.z + ref.depth / 2)
    parent.add(mesh)
  }
}
