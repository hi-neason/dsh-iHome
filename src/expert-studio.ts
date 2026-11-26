import * as THREE from 'three'

/** A roofless renovation studio. The experts stand on the floor at y = 0. */
export function createExpertStudio(): THREE.Group {
  const studio = new THREE.Group()
  studio.name = 'renovation-studio'
  const materials = {
    edge: new THREE.MeshStandardMaterial({ color: '#203c3b', roughness: .72 }),
    wall: new THREE.MeshStandardMaterial({ color: '#ece3cd', roughness: .9 }),
    timber: new THREE.MeshStandardMaterial({ color: '#a77b51', roughness: .82 }),
    plank: new THREE.MeshStandardMaterial({ color: '#c4a77e', roughness: .92 }),
    paleWood: new THREE.MeshStandardMaterial({ color: '#dbc6a3', roughness: .88 }),
    walnut: new THREE.MeshStandardMaterial({ color: '#66503c', roughness: .8 }),
    brass: new THREE.MeshStandardMaterial({ color: '#d6aa60', metalness: .45, roughness: .4 }),
    paper: new THREE.MeshStandardMaterial({ color: '#f4f0df', roughness: .95 }),
    drawing: new THREE.MeshStandardMaterial({ color: '#366b73', roughness: .8 }),
    window: new THREE.MeshStandardMaterial({ color: '#9bc0be', roughness: .35, metalness: .12 }),
    sky: new THREE.MeshStandardMaterial({ color: '#bddbd0', roughness: .7, emissive: '#bddbd0', emissiveIntensity: .13 }),
    sage: new THREE.MeshStandardMaterial({ color: '#8b9d7c', roughness: 1 }),
    leaf: new THREE.MeshStandardMaterial({ color: '#486e53', roughness: .95 }),
    clay: new THREE.MeshStandardMaterial({ color: '#bd8266', roughness: .95 }),
    orange: new THREE.MeshStandardMaterial({ color: '#d89142', roughness: .8 }),
    linen: new THREE.MeshStandardMaterial({ color: '#d4caba', roughness: 1 }),
    charcoal: new THREE.MeshStandardMaterial({ color: '#35454a', roughness: .86 }),
  }
  type Finish = keyof typeof materials
  const cube = new THREE.BoxGeometry(1, 1, 1)
  const round = new THREE.CylinderGeometry(1, 1, 1, 16)
  const ball = new THREE.SphereGeometry(1, 12, 8)
  const batches = new Map<string, { geometry: THREE.BufferGeometry, material: THREE.Material, matrices: THREE.Matrix4[] }>()
  const transform = new THREE.Object3D()

  // Each geometry/material pair becomes one instanced draw call.
  function place(shape: 'box' | 'round' | 'ball', finish: Finish, x: number, y: number, z: number,
    width: number, height: number, depth: number, rotation = 0, tilt = 0) {
    transform.position.set(x, y, z)
    transform.scale.set(width, height, depth)
    transform.rotation.set(tilt, rotation, 0)
    transform.updateMatrix()
    const key = shape + '-' + finish
    let batch = batches.get(key)
    if (!batch) {
      batch = { geometry: shape === 'box' ? cube : shape === 'round' ? round : ball,
        material: materials[finish], matrices: [] }
      batches.set(key, batch)
    }
    batch.matrices.push(transform.matrix.clone())
  }
  function box(finish: Finish, x: number, y: number, z: number, width: number, height: number, depth: number, rotation = 0) {
    place('box', finish, x, y, z, width, height, depth, rotation)
  }
  function cylinder(finish: Finish, x: number, y: number, z: number, radius: number, height: number) {
    place('round', finish, x, y, z, radius, height, radius)
  }
  function plant(x: number, z: number, scale = 1) {
    cylinder('clay', x, .18 * scale, z, .23 * scale, .36 * scale)
    cylinder('walnut', x, .8 * scale, z, .035 * scale, 1.05 * scale)
    for (let i = 0; i < 5; i++) {
      const angle = i * 2.4
      place('ball', i % 2 ? 'leaf' : 'sage', x + Math.cos(angle) * .19 * scale,
        (.74 + i * .105) * scale, z + Math.sin(angle) * .19 * scale,
        .2 * scale, .31 * scale, .12 * scale, angle, .35)
    }
  }

  // The plinth and narrow inset edge give the miniature a physical model finish.
  box('edge', 0, -.23, 0, 13.6, .44, 5.5)
  box('brass', 0, -.075, 0, 13.53, .045, 5.43)
  box('timber', 0, -.025, 0, 13.4, .05, 5.3)
  for (let i = 0; i < 27; i++) {
    box(i % 3 === 0 ? 'paleWood' : 'plank', -6.45 + i * .495, .002, 0, .48, .008, 5.25)
  }

  // Low cutaway walls frame the room without hiding the people and their tools.
  box('wall', 0, .32, -2.57, 13.4, .64, .16)
  box('edge', 0, .045, -2.45, 13.3, .09, .06)
  box('wall', -6.63, 1.12, -1.28, .14, 2.24, 2.55)
  box('wall', 6.63, .56, -1.28, .14, 1.12, 2.55)
  box('wall', .35, 1.34, -2.57, 5.2, 1.4, .16)
  box('wall', 5.1, 1.34, -2.57, 3.0, 1.4, .16)
  box('wall', -6.05, 1.34, -2.57, 1.12, 1.4, .16)
  box('edge', 0, 2.08, -2.57, 13.4, .12, .2)

  // An inset window catches the daylight behind the design desk.
  box('sky', -3.85, 1.38, -2.58, 3.1, 1.24, .04)
  box('window', -3.06, 1.36, -2.53, 1.47, 1.16, .035)
  for (const x of [-5.45, -3.85, -2.25]) box('edge', x, 1.37, -2.48, .065, 1.37, .1)
  for (const y of [.7, 1.37, 2.03]) box('edge', -3.85, y, -2.48, 3.26, .055, .1)
  box('paleWood', -3.85, .68, -2.4, 3.45, .09, .34)

  // Design workbench, rolled plan and a pinned floor plan.
  box('walnut', -4.32, .82, -1.93, 2.8, .12, .82)
  for (const x of [-5.52, -3.12]) for (const z of [-2.2, -1.68]) box('edge', x, .39, z, .07, .78, .07)
  box('paper', -4.65, .889, -1.9, 1.36, .018, .61, -.07)
  for (const x of [-5.1, -4.67, -4.18]) box('drawing', x, .901, -1.89, .014, .004, .44)
  for (const z of [-2.1, -1.7]) box('drawing', -4.64, .901, z, .93, .004, .014)
  place('round', 'paper', -3.54, .93, -1.94, .065, .58, .065, 0, Math.PI / 2)
  cylinder('clay', -5.48, .98, -2.06, .075, .2)
  for (let i = 0; i < 3; i++) box('brass', -5.5 + i * .025, 1.11, -2.06, .012, .22, .012)

  // Central architectural presentation board is drawn entirely with geometry.
  box('walnut', -.12, 1.43, -2.43, 2.1, 1.07, .06)
  box('drawing', -.12, 1.43, -2.388, 1.96, .93, .025)
  for (const y of [1.08, 1.78]) box('paper', -.18, y, -2.366, 1.58, .016, .006)
  for (const x of [-.96, .6]) box('paper', x, 1.43, -2.366, .016, .7, .006)
  box('paper', -.37, 1.43, -2.366, .016, .7, .006)
  box('paper', .11, 1.36, -2.366, .96, .016, .006)
  box('paper', .22, 1.59, -2.366, .016, .37, .006)
  box('paper', -.65, 1.28, -2.366, .4, .016, .006)
  // A short swatch console sits between the discussion and construction areas.
  box('sage', -1.45, .39, -2.12, .8, .76, .62)
  box('paleWood', -1.45, .8, -2.12, .9, .08, .7)
  for (let i = 0; i < 4; i++) box((['linen', 'clay', 'walnut', 'drawing'] as const)[i], -1.7 + i * .17, .85, -2.12, .14, .025, .38, -.08)

  // Hardware and inspection corner, with a low toolbox and sample wall.
  box('wall', 2.35, 1.41, -2.42, 1.03, 1.0, .06)
  for (let i = 0; i < 4; i++) {
    box(i % 2 ? 'linen' : 'clay', 2.09 + (i % 2) * .53, 1.15 + Math.floor(i / 2) * .51, -2.36, .48, .46, .04)
  }
  box('orange', .87, .19, -.67, .62, .36, .38)
  box('charcoal', .87, .39, -.67, .64, .05, .4)
  box('charcoal', .87, .45, -.67, .25, .1, .04)
  box('brass', .87, .24, -.465, .08, .1, .02)
  cylinder('paper', 1.47, .16, -1.76, .19, .31)
  cylinder('charcoal', 1.47, .325, -1.76, .2, .035)
  box('orange', 1.87, .055, -1.71, .46, .1, .12, .25)

  // Furnished end: low sofa, side table, books and document storage.
  box('linen', 3.63, .28, -1.88, 1.32, .45, .85)
  box('sage', 3.63, .65, -2.21, 1.32, .7, .18)
  for (const x of [3.03, 4.23]) box('sage', x, .5, -1.87, .15, .5, .87)
  box('paleWood', 3.64, .53, -1.8, 1.04, .12, .55)
  box('clay', 3.97, .77, -2.04, .36, .38, .16, -.14)
  cylinder('walnut', 5.55, .31, -.72, .36, .08)
  cylinder('edge', 5.55, .14, -.72, .07, .28)
  box('paper', 5.56, .37, -.73, .38, .05, .27, .12)
  box('drawing', 5.57, .41, -.73, .36, .035, .25, -.08)
  box('walnut', 5.26, .57, -2.13, 1.7, 1.12, .57)
  for (const y of [.18, .6, 1.04]) box('paleWood', 5.26, y, -1.82, 1.6, .045, .05)
  for (let i = 0; i < 8; i++) {
    box(i % 3 === 0 ? 'sage' : i % 3 === 1 ? 'paper' : 'drawing', 4.65 + i * .16, .84, -1.91, .105, .37 - (i % 2) * .04, .27)
  }
  for (const x of [4.76, 5.3, 5.83]) {
    box('linen', x, .39, -1.94, .44, .31, .32)
    box('walnut', x, .4, -1.77, .13, .04, .012)
  }
  plant(6.08, -1.91, .95)
  plant(-6.03, -.76, 1.05)
  plant(2.94, -2.15, .62)
  // Small moving boxes stay clear of the front-right experts.
  box('timber', 4.12, .17, 2.04, .58, .34, .44)
  box('paper', 4.12, .346, 2.04, .07, .012, .44)
  box('paleWood', 4.02, .49, 2.02, .42, .28, .36, -.1)
  box('paper', 4.02, .636, 2.02, .06, .012, .36, -.1)

  for (const { geometry, material, matrices } of batches.values()) {
    const mesh = new THREE.InstancedMesh(geometry, material, matrices.length)
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix))
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.computeBoundingSphere()
    studio.add(mesh)
  }
  return studio
}
