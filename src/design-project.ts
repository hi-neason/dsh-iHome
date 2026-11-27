import { validateDesignScheme, type DesignScheme } from './design-model.ts'

export const projectFileLimit = 128 * 1024 * 1024
const fileType = 'ihome.floorplan'

function assetsIn(design: DesignScheme): string[] {
  const ids = new Set<string>()
  for (const model of [design.model, ...design.versions.map(version => version.model)]) {
    for (const floor of model.floors) {
      if (floor.reference) ids.add(floor.reference.assetId)
      for (const asset of floor.assets ?? []) ids.add(asset.assetId)
    }
  }
  return [...ids]
}
function encode(bytes: Uint8Array): string {
  let result = ''
  // Each chunk ends at a three-byte boundary so only the final chunk is padded.
  for (let offset = 0; offset < bytes.length; offset += 24576) {
    result += btoa(String.fromCharCode(...bytes.subarray(offset, offset + 24576)))
  }
  return result
}
async function hash(bytes: Uint8Array<ArrayBuffer>) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return 'sha256:' + Array.from(digest, value => value.toString(16).padStart(2, '0')).join('')
}

export async function exportDesignProject(design: DesignScheme, load: (id: string) => Promise<Blob>): Promise<Blob> {
  const assets: Record<string, string> = {}
  let length = 0
  for (const id of assetsIn(design)) {
    const file = await load(id)
    length += 4 * Math.ceil(file.size / 3)
    if (length > projectFileLimit) throw new Error('工程超过可交换文件大小（128 MiB）。')
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (await hash(bytes) !== id) throw new Error('本机素材内容与工程记录不一致。')
    assets[id] = encode(bytes)
  }
  const file = new Blob([JSON.stringify({ type: fileType, formatVersion: 1, design, assets })], { type: 'application/json' })
  if (file.size > projectFileLimit) throw new Error('工程超过可交换文件大小（128 MiB）。')
  return file
}

export async function importDesignProject(file: Blob, store: (data: Blob, name: string) => Promise<string>): Promise<DesignScheme> {
  if (file.size > projectFileLimit) throw new Error('工程文件超过 128 MiB。')
  const data = JSON.parse(await file.text())
  if (data?.type !== fileType || data.formatVersion !== 1) throw new Error('无法识别这个 iHome 户型工程版本。')
  const design = validateDesignScheme(data.design)
  const refs = assetsIn(design)
  if (!data.assets || typeof data.assets !== 'object' || Array.isArray(data.assets) || Object.keys(data.assets).length !== refs.length) {
    throw new Error('工程素材目录不完整。')
  }
  const checked = new Map<string, Blob>()
  for (const id of refs) {
    const body = data.assets[id]
    if (typeof body !== 'string') throw new Error('工程缺少所引用的素材。')
    const bytes = Uint8Array.from(atob(body), ch => ch.charCodeAt(0))
    if (await hash(bytes) !== id) throw new Error('工程中的素材损坏。')
    checked.set(id, new Blob([bytes]))
  }
  for (const [id, blob] of checked) {
    if (await store(blob, id.slice(7)) !== id) throw new Error('本机素材校验失败。')
  }
  return design
}
