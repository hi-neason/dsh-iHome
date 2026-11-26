import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

import type { ModuleId } from './modules'

type ExpertId = Exclude<ModuleId, 'budget'>
interface Expert {
  id: ExpertId
  x: number
  z: number
  coat: number
  hair: number
  skin: number
  turn: number
  longHair?: boolean
  helmet?: number
  glasses?: boolean
}

const experts: Expert[] = [
  { id: 'archive', x: -4.8, z: 1.25, coat: 0x799080, hair: 0x302b29, skin: 0xe6b995, turn: .3, longHair: true },
  { id: 'design', x: -3.6, z: -.65, coat: 0xe7dfcd, hair: 0x46372f, skin: 0xe8ba96, turn: -.15 },
  { id: 'quotes', x: -1.8, z: -1.35, coat: 0x566477, hair: 0x322c29, skin: 0xe5b593, turn: .2, glasses: true, longHair: true },
  { id: 'materials', x: -1.4, z: 1.35, coat: 0xb5a184, hair: 0x3a302b, skin: 0xdbab83, turn: -.28 },
  { id: 'site', x: .25, z: .15, coat: 0x647b74, hair: 0x3c322e, skin: 0xcf9e77, turn: -.4, helmet: 0xe9a145 },
  { id: 'handover', x: 2.2, z: -.8, coat: 0x6d9295, hair: 0x3b302c, skin: 0xe8bc9c, turn: .22, helmet: 0xf0eee2 },
  { id: 'movein', x: 3.4, z: 1.4, coat: 0xe8d5b6, hair: 0x49362e, skin: 0xe4b28d, turn: -.28, longHair: true },
  { id: 'knowledge', x: 4.6, z: -1.1, coat: 0x68766a, hair: 0x8b8476, skin: 0xd7ab87, turn: -.28, glasses: true },
  { id: 'tasks', x: .9, z: 2.15, coat: 0xb47c56, hair: 0x49352e, skin: 0xe3b598, turn: -.12, longHair: true },
  { id: 'documents', x: 5.1, z: 1.15, coat: 0x596b86, hair: 0x37302c, skin: 0xe0b28b, turn: -.35, glasses: true },
]

/** Self-contained meshes. The scene owner disposes shared geometries and materials once. */
export function createExpertCrew(): { group: THREE.Group, animate(timeSeconds: number): void } {
  const group = new THREE.Group()
  group.name = 'iHome experts'
  const cube = new THREE.BoxGeometry(1, 1, 1)
  const sphere = new THREE.SphereGeometry(1, 12, 10)
  const hairCap = new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)
  const capsule = new THREE.CapsuleGeometry(1, 1, 3, 8)
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 12)
  const ring = new THREE.TorusGeometry(1, .09, 4, 12)
  const materials = new Map<number, THREE.MeshStandardMaterial>()
  function material(color: number) {
    let value = materials.get(color)
    if (!value) {
      value = new THREE.MeshStandardMaterial({ color, roughness: .82, metalness: 0 })
      materials.set(color, value)
    }
    return value
  }
  function part(parent: THREE.Object3D, geometry: THREE.BufferGeometry, color: number,
    position: [number, number, number], scale: [number, number, number]) {
    const mesh = new THREE.Mesh(geometry, material(color))
    mesh.position.set(...position)
    mesh.scale.set(...scale)
    mesh.castShadow = true
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }
  function box(parent: THREE.Object3D, color: number, x: number, y: number, z: number, w: number, h: number, d: number) {
    return part(parent, cube, color, [x, y, z], [w, h, d])
  }
  function book(parent: THREE.Object3D, color: number, width = .34, height = .28) {
    box(parent, color, 0, 0, 0, width, height, .065)
    box(parent, 0xf4ead5, 0, 0, .039, width - .035, height - .025, .015)
    box(parent, color, -width / 2 + .014, 0, .048, .028, height, .02)
    box(parent, 0xc1b49d, .025, .045, .05, width * .55, .012, .008)
    box(parent, 0xc1b49d, .025, -.005, .05, width * .55, .012, .008)
  }
  const performers = experts.map((expert, index) => {
    const root = new THREE.Group()
    root.name = expert.id
    root.userData.expertId = expert.id
    root.position.set(expert.x, 0, expert.z)
    root.rotation.y = expert.turn
    group.add(root)
    const body = new THREE.Group()
    body.position.y = .68
    root.add(body)
    part(body, capsule, expert.coat, [0, .12, 0], [.195, .16, .13])
    box(body, 0xf3eadb, 0, .3, .118, .12, .12, .035)
    box(body, expert.coat, 0, .04, .133, .012, .3, .01)
    box(body, 0xf2e8d2, -.105, .13, .134, .06, .075, .012)
    const head = new THREE.Group()
    head.position.y = .48
    body.add(head)
    part(head, sphere, expert.skin, [0, .055, 0], [.225, .25, .212])
    part(head, sphere, expert.skin, [-.218, .025, 0], [.044, .062, .04])
    part(head, sphere, expert.skin, [.218, .025, 0], [.044, .062, .04])
    part(head, hairCap, expert.hair, [0, .11, -.018], [.233, .235, .218])
    if (expert.longHair) {
      part(head, capsule, expert.hair, [-.198, .015, -.045], [.065, .125, .105])
      part(head, capsule, expert.hair, [.198, .015, -.045], [.065, .125, .105])
    }
    part(head, sphere, 0x272b2a, [-.075, .064, .197], [.019, .027, .012])
    part(head, sphere, 0x272b2a, [.075, .064, .197], [.019, .027, .012])
    part(head, sphere, expert.skin, [0, .018, .214], [.035, .035, .041])
    box(head, 0xa97660, 0, -.067, .193, .06, .012, .01)
    if (expert.glasses) {
      part(head, ring, 0x675c4e, [-.078, .061, .222], [.066, .056, .056])
      part(head, ring, 0x675c4e, [.078, .061, .222], [.066, .056, .056])
      box(head, 0x675c4e, 0, .068, .223, .03, .012, .012)
    }
    if (expert.helmet !== undefined) {
      part(head, hairCap, expert.helmet, [0, .165, -.005], [.265, .2, .245])
      part(head, cylinder, expert.helmet, [0, .17, .02], [.29, .035, .28])
      box(head, expert.helmet, 0, .345, -.005, .045, .035, .27)
    }
    const arms = [-1, 1].map(side => {
      const arm = new THREE.Group()
      arm.position.set(side * .225, .27, 0)
      arm.rotation.z = side * .08
      body.add(arm)
      part(arm, capsule, expert.coat, [0, -.12, 0], [.068, .085, .073])
      part(arm, sphere, expert.skin, [0, -.3, 0], [.072, .077, .069])
      return arm
    })
    const legs = [-1, 1].map(side => {
      const leg = new THREE.Group()
      leg.position.set(side * .105, .55, 0)
      root.add(leg)
      part(leg, capsule, 0x4c5250, [0, -.2, 0], [.086, .16, .09])
      part(leg, sphere, 0xede6d5, [0, -.48, .045], [.105, .075, .16])
      return leg
    })
    const prop = new THREE.Group()
    prop.position.set(0, -.23, .065)
    arms[1].add(prop)
    arms[1].rotation.x = -.85
    arms[0].rotation.x = -.3
    switch (expert.id) {
      case 'archive':
        book(prop, 0xc8b491, .32, .38)
        prop.position.x = -.12
        break
      case 'design': {
        const scroll = part(prop, cylinder, 0xf2ead7, [0, 0, 0], [.07, .54, .07])
        scroll.rotation.z = -.28
        box(prop, 0x8eaaa2, 0, 0, .065, .09, .06, .012)
        break
      }
      case 'quotes':
        book(prop, 0x455361, .3, .37)
        box(prop, 0xb4cbc7, 0, .05, .065, .2, .09, .018)
        for (let key = 0; key < 6; key++) box(prop, 0xeee3cc, -.075 + key % 3 * .075, -.05 - Math.floor(key / 3) * .065, .065, .04, .035, .018)
        break
      case 'materials':
        for (let swatch = 0; swatch < 3; swatch++) {
          const tile = box(prop, [0xbb8964, 0xe4d3ad, 0x78928a][swatch], -.08 + swatch * .085, 0, swatch * .035, .16, .29, .035)
          tile.rotation.z = .25 - swatch * .25
        }
        break
      case 'site':
        box(prop, 0xe8b65a, 0, 0, 0, .16, .13, .1)
        box(prop, 0xf5e2a0, -.22, -.02, .025, .34, .027, .035)
        for (let mark = 0; mark < 4; mark++) box(prop, 0x5f604e, -.34 + mark * .07, -.001, .025, .009, .009, .036)
        break
      case 'handover':
        book(prop, 0x536d6e, .31, .37)
        box(prop, 0xa5b8ae, 0, .18, .05, .12, .045, .025)
        break
      case 'movein':
        box(prop, 0xc39a68, -.2, .015, .015, .43, .32, .28)
        box(prop, 0xebd7a6, -.2, .18, .015, .06, .012, .28)
        box(prop, 0xf5ecd7, -.2, .025, .161, .16, .09, .012)
        arms[0].rotation.x = -.85
        break
      case 'knowledge':
        book(prop, 0xb4bd9d, .34, .3)
        prop.rotation.y = -.3
        prop.position.x = -.15
        arms[0].rotation.x = -.7
        break
      case 'tasks':
        book(prop, 0xb57e68, .34, .39)
        prop.position.x = -.1
        box(prop, 0xb57e68, 0, .14, .065, .29, .07, .018)
        for (let day = 0; day < 9; day++) {
          box(prop, day === 4 ? 0x70978b : 0xcabda7, -.09 + day % 3 * .09,
            .045 - Math.floor(day / 3) * .075, .065, .055, .045, .018)
        }
        break
      case 'documents':
        book(prop, 0x95a5b6, .31, .36)
        prop.position.x = -.1
        box(prop, 0xd6bf8e, -.13, .09, .085, .06, .14, .02)
        break
    }
    return { root, body, head, arms, legs, expert, phase: index * 1.63, baseArms: arms.map(arm => arm.rotation.x) }
  })
  // Bake each rigid part into its own joint space. The animated hierarchy stays
  // intact while facial details and clothing share one vertex-colored draw call.
  const surface = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .82, metalness: 0 })
  const joints: THREE.Group[] = []
  group.traverse(object => { if (object instanceof THREE.Group) joints.push(object) })
  for (const joint of joints) {
    const meshes = joint.children.filter((child): child is THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> => child instanceof THREE.Mesh)
    if (!meshes.length) continue
    const pieces = meshes.map(mesh => {
      mesh.updateMatrix()
      const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrix)
      geometry.deleteAttribute('uv')
      const count = geometry.getAttribute('position').count
      const colors = new Float32Array(count * 3)
      const { r, g, b } = mesh.material.color
      for (let vertex = 0; vertex < count; vertex++) {
        colors[vertex * 3] = r
        colors[vertex * 3 + 1] = g
        colors[vertex * 3 + 2] = b
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      return geometry
    })
    const geometry = mergeGeometries(pieces)
    pieces.forEach(piece => piece.dispose())
    if (!geometry) throw new Error('Unable to assemble expert geometry.')
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    const merged = new THREE.Mesh(geometry, surface)
    merged.castShadow = true
    merged.receiveShadow = true
    joint.remove(...meshes)
    joint.add(merged)
  }
  for (const geometry of [cube, sphere, hairCap, capsule, cylinder, ring]) geometry.dispose()
  materials.forEach(value => value.dispose())

  function animate(timeSeconds: number) {
    const turn = 2 * Math.PI
    for (const { root, body, head, arms, legs, expert, phase, baseArms } of performers) {
      const time = turn * timeSeconds / 2.5 + phase
      body.rotation.z = Math.sin(time) * .018
      head.rotation.y = Math.sin(time * .65) * .13
      head.rotation.x = .07 + Math.sin(time * .9) * .045
      arms[0].rotation.x = baseArms[0] + Math.sin(time * 1.15) * .12
      arms[1].rotation.x = baseArms[1] + Math.sin(time * .9 + 1) * .09
      const gesture = (1 + Math.sin(time)) * .5
      switch (expert.id) {
        case 'archive':
        case 'quotes':
        case 'knowledge':
        case 'tasks':
          head.rotation.x += gesture * .33
          arms[1].rotation.x -= gesture * .32
          break
        case 'design':
        case 'materials':
          arms[1].rotation.z = .08 + gesture * .35
          arms[1].rotation.x -= gesture * .45
          head.rotation.y += gesture * .3
          break
        case 'handover':
          body.rotation.x = gesture * .24
          head.rotation.x += gesture * .18
          break
        case 'movein':
          body.position.y = .68 - gesture * .08
          body.rotation.x = gesture * .13
          break
      }
      const walking = expert.id === 'site' || expert.id === 'documents'
      if (walking) {
        // Two steps per second, with one round trip between stations every six seconds.
        const stride = Math.sin(turn * timeSeconds + phase)
        const routeAngle = turn * timeSeconds / 6 + phase
        const route = Math.sin(routeAngle)
        root.position.x = expert.x + route * .48
        root.position.z = expert.z + route * .14
        root.position.y = Math.abs(stride) * .035
        root.rotation.y = expert.turn + Math.cos(routeAngle) * .58
        legs[0].rotation.x = stride * .26
        legs[1].rotation.x = -stride * .26
      }
    }
  }
  animate(0)
  return { group, animate }
}
