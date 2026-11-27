import { Group, LoadingManager, MathUtils, type Object3D, type Material, type Texture } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import type { DesignAsset, DesignModel } from './design-model'

/** Only a GLB with embedded buffers/images can enter the local design renderer. */
export function inspectGLB(bytes: ArrayBuffer): void {
  if (bytes.byteLength < 20 || bytes.byteLength > 64 * 1024 * 1024) throw new Error('GLB 文件无效或超过 64 MiB。')
  const view = new DataView(bytes)
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength) throw new Error('仅支持完整的 glTF 2.0 二进制 GLB 文件。')
  let offset = 12, json: Record<string, any> | undefined, binaryLength = 0
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) throw new Error('GLB 数据块不完整。')
    const length = view.getUint32(offset, true), kind = view.getUint32(offset + 4, true)
    if (length % 4 || offset + 8 + length > bytes.byteLength) throw new Error('GLB 数据块长度无效。')
    if (offset === 12 && kind !== 0x4e4f534a) throw new Error('GLB 缺少 JSON 数据块。')
    if (kind === 0x4e4f534a) {
      if (json) throw new Error('GLB JSON 数据块重复。')
      json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, offset + 8, length)))
    } else if (kind === 0x004e4942) {
      if (binaryLength) throw new Error('GLB 二进制数据块重复。')
      binaryLength = length
    }
    offset += 8 + length
  }
  if (!json || json.asset?.version !== '2.0') throw new Error('GLB 版本无效。')
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (key === 'uri') throw new Error('请导入将所有贴图和缓冲区嵌入文件的 GLB，不支持 URI 引用。')
      if (['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_meshopt_compression', 'KHR_texture_basisu'].includes(key)) throw new Error('请先将压缩模型解码后导出 GLB；本地查看器不下载解码器。')
      visit(child)
    }
  }
  visit(json)
  const supported = new Set(['KHR_materials_clearcoat', 'KHR_materials_dispersion', 'KHR_materials_ior',
    'KHR_materials_specular', 'KHR_materials_transmission', 'KHR_materials_iridescence', 'KHR_materials_unlit',
    'KHR_materials_volume', 'KHR_materials_sheen', 'KHR_materials_anisotropy', 'KHR_materials_emissive_strength',
    'KHR_mesh_quantization', 'KHR_lights_punctual', 'KHR_texture_transform', 'EXT_texture_webp',
    'EXT_texture_avif', 'EXT_mesh_gpu_instancing'])
  for (const extension of json.extensionsRequired ?? []) {
    if (!supported.has(extension)) throw new Error(`GLB 必需扩展不受支持：${extension}`)
  }
  if ((json.buffers?.length ?? 0) > 1 || (json.buffers?.[0]?.byteLength ?? 0) > binaryLength) throw new Error('GLB 嵌入缓冲区缺失。')
}

export function disposeGLB(root: Object3D, retained?: Object3D): void {
  const geometries = new Set<any>(), materials = new Set<Material>(), textures = new Set<Texture>()
  root.traverse((node: any) => {
    if (node.geometry) geometries.add(node.geometry)
    for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) materials.add(material)
  })
  for (const material of materials) for (const value of Object.values(material)) {
    if (value && typeof value === 'object' && (value as Texture).isTexture) textures.add(value as Texture)
  }
  retained?.traverse((node: any) => {
    geometries.delete(node.geometry)
    for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) {
      materials.delete(material)
      for (const value of Object.values(material)) textures.delete(value as Texture)
    }
  })
  for (const material of materials) material.dispose()
  for (const texture of textures) { texture.dispose(); (texture.source?.data as { close?: () => void } | undefined)?.close?.() }
  for (const geometry of geometries) geometry.dispose()
  root.removeFromParent()
}

export async function loadGLB(bytes: ArrayBuffer, signal?: AbortSignal): Promise<Group> {
  signal?.throwIfAborted()
  inspectGLB(bytes)
  const failedResources: string[] = []
  const manager = new LoadingManager(undefined, undefined, url => failedResources.push(url))
  manager.setURLModifier(url => {
    if (!url.startsWith('blob:')) throw new Error('GLB 不允许访问外部资源。')
    return url
  })
  const gltf = await new GLTFLoader(manager).parseAsync(bytes, '')
  if (signal?.aborted) { for (const scene of gltf.scenes) disposeGLB(scene); signal.throwIfAborted() }
  if (failedResources.length) {
    for (const scene of gltf.scenes) disposeGLB(scene)
    throw new Error('GLB 内嵌素材加载失败，请检查贴图和缓冲区。')
  }
  const scene = gltf.scene
  for (const other of gltf.scenes) if (other !== scene) {
    disposeGLB(other, scene)
  }
  return scene
}

export function placeGLB(scene: Group, asset: DesignAsset): Group {
  const wrapper = new Group()
  wrapper.name = asset.name
  wrapper.userData.designAssetId = asset.id
  wrapper.userData.elementId = asset.id
  wrapper.position.set(asset.x, asset.y, asset.z)
  wrapper.rotation.y = MathUtils.degToRad(asset.rotation)
  wrapper.scale.setScalar(asset.scale)
  wrapper.add(scene)
  return wrapper
}

export async function loadDesignAssets(model: DesignModel, root: Group,
  options: { floorId?: string, allFloors?: boolean }, signal?: AbortSignal,
  read?: (id: string, signal?: AbortSignal) => Promise<Blob>): Promise<void> {
  const reader = read ?? (await import('./design-media-client')).readDesignAsset
  const added: Group[] = []
  try {
    for (const floor of model.floors) {
      if (!options.allFloors && options.floorId && floor.id !== options.floorId) continue
      const floorGroup = root.children.find(node => node.userData.floorId === floor.id)
      if (!floorGroup && floor.assets?.length) throw new Error(`找不到楼层 ${floor.name} 的场景。`)
      for (const asset of floor.assets ?? []) {
        signal?.throwIfAborted()
        const bytes = await (await reader(asset.assetId, signal)).arrayBuffer()
        const scene = await loadGLB(bytes, signal)
        const group = placeGLB(scene, asset)
        group.userData.floorId = floor.id
        floorGroup!.add(group); added.push(group)
      }
    }
  } catch (error) { for (const group of added) disposeGLB(group); throw error }
}

export async function exportDesignGLB(model: DesignModel, signal?: AbortSignal): Promise<Blob> {
  const { buildDesignGroup, disposeDesignGroup } = await import('./design-scene')
  const root = buildDesignGroup(model, { allFloors: true })
  try {
    await loadDesignAssets(model, root, { allFloors: true }, signal)
    signal?.throwIfAborted()
    const bytes = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: false })
    signal?.throwIfAborted()
    return new Blob([bytes as ArrayBuffer], { type: 'model/gltf-binary' })
  } finally { disposeDesignGroup(root) }
}
