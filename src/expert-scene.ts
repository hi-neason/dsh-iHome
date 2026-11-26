import * as THREE from 'three'
import { createExpertCrew } from './expert-figures'
import { createExpertStudio } from './expert-studio'

/** The renderer owns the canvas and GPU resources for one mounted home panel. */
export function mountExpertScene(canvas: HTMLCanvasElement, pins: HTMLElement, onReady: (ready: boolean) => void) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' })
  renderer.setClearColor(0x000000, 0)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.14

  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-8, 8, 4, -4, .1, 60)
  const studio = createExpertStudio()
  const crew = createExpertCrew()
  scene.add(studio, crew.group)
  scene.add(new THREE.HemisphereLight(0xfff5dd, 0xb4c6c1, 2))
  const sun = new THREE.DirectionalLight(0xffe6bc, 3.15)
  sun.position.set(-5, 10, 7)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  Object.assign(sun.shadow.camera, { left: -8.6, right: 8.6, top: 6, bottom: -6, near: 1, far: 27 })
  sun.shadow.camera.updateProjectionMatrix()
  sun.shadow.normalBias = .018
  sun.shadow.bias = -.0002
  scene.add(sun)
  const fill = new THREE.DirectionalLight(0xd7edff, 1.05)
  fill.position.set(4, 4, -5)
  scene.add(fill)

  const bounds = new THREE.Box3().setFromObject(studio)
  const corners: THREE.Vector3[] = []
  for (const x of [bounds.min.x, bounds.max.x])
    for (const y of [bounds.min.y, bounds.max.y])
      for (const z of [bounds.min.z, bounds.max.z]) corners.push(new THREE.Vector3(x, y, z))
  const targets = crew.group.children.map(figure => ({
    figure, button: pins.querySelector<HTMLButtonElement>(`[data-expert="${figure.userData.expertId}"]`),
  }))
  const point = new THREE.Vector3()
  const motion = matchMedia('(prefers-reduced-motion: reduce)')
  let frame = 0, previous = 0, elapsed = 0
  let width = 0, height = 0
  let inView = true, paused = false, lost = false, ready = false

  function render() {
    if (!width || !height || lost) return
    crew.animate(elapsed)
    camera.position.set(4 + .46 * Math.sin(elapsed * .17), 8.6, 18)
    camera.lookAt(0, .8, 0)
    camera.updateMatrixWorld()
    renderer.render(scene, camera)
    for (const { figure, button } of targets) {
      if (!button) continue
      point.set(0, .85, 0)
      figure.localToWorld(point).project(camera)
      button.style.left = `${(point.x + 1) * 50}%`
      button.style.top = `${(1 - point.y) * 50}%`
    }
    if (!ready) { ready = true; onReady(true) }
  }

  function resize() {
    width = canvas.clientWidth
    height = canvas.clientHeight
    if (!width || !height || lost) return
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65))
    renderer.setSize(width, height, false)
    camera.position.set(4, 8.6, 18)
    camera.lookAt(0, .8, 0)
    camera.updateMatrixWorld()
    const view = new THREE.Box3().setFromPoints(corners.map(v => v.clone().applyMatrix4(camera.matrixWorldInverse)))
    const center = view.getCenter(new THREE.Vector3())
    const aspect = width / height
    const halfHeight = Math.max((view.max.y - view.min.y) / 2, (view.max.x - view.min.x) / (2 * aspect)) * 1.04
    camera.left = center.x - halfHeight * aspect
    camera.right = center.x + halfHeight * aspect
    camera.top = center.y + halfHeight
    camera.bottom = center.y - halfHeight
    camera.updateProjectionMatrix()
    const pixelsPerUnit = height / (2 * halfHeight)
    pins.style.setProperty('--ih-figure-width', `${pixelsPerUnit * .76}px`)
    pins.style.setProperty('--ih-figure-height', `${pixelsPerUnit * 1.52}px`)
    render()
  }

  function tick(now: number) {
    if (now - previous >= 1000 / 30 - 1) {
      if (previous) elapsed += Math.min((now - previous) / 1000, .1)
      previous = now
      render()
    }
    frame = requestAnimationFrame(tick)
  }
  function sync() {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    previous = 0
    if (!paused && !lost && !motion.matches && !document.hidden && inView && width && height) frame = requestAnimationFrame(tick)
  }
  function contextLost(event: Event) {
    event.preventDefault()
    lost = true
    ready = false
    onReady(false)
    sync()
  }
  function contextRestored() { lost = false; resize(); sync() }

  const size = new ResizeObserver(() => { resize(); sync() })
  const visibility = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; sync() })
  size.observe(canvas)
  visibility.observe(canvas)
  canvas.addEventListener('webglcontextlost', contextLost)
  canvas.addEventListener('webglcontextrestored', contextRestored)
  document.addEventListener('visibilitychange', sync)
  motion.addEventListener('change', sync)
  resize()
  sync()
  return {
    setPaused(value: boolean) { paused = value; sync() },
    dispose() {
      cancelAnimationFrame(frame)
      size.disconnect()
      visibility.disconnect()
      canvas.removeEventListener('webglcontextlost', contextLost)
      canvas.removeEventListener('webglcontextrestored', contextRestored)
      document.removeEventListener('visibilitychange', sync)
      motion.removeEventListener('change', sync)
      const geometries = new Set<THREE.BufferGeometry>()
      const materials = new Set<THREE.Material>()
      scene.traverse(object => {
        if (object instanceof THREE.Mesh) {
          geometries.add(object.geometry)
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material)
          if (object instanceof THREE.InstancedMesh) object.dispose()
        }
      })
      for (const geometry of geometries) geometry.dispose()
      for (const material of materials) material.dispose()
      sun.shadow.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }
}
