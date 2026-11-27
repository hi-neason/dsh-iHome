import { useRef, useState } from 'react'
import { createEmptyModel, type DesignScheme } from './design-model'
import { disposeGLB, exportDesignGLB, loadGLB } from './design-glb'
import { exportDesignProject, importDesignProject } from './design-project'
import { readDesignAsset, storeDesignAsset } from './design-media-client'

type ProjectFileProps = { disabled: boolean } & (
  { scheme: DesignScheme, onImport?: never } | { scheme?: never, onImport: (scheme: DesignScheme) => Promise<boolean> }
)

async function importGLB(file: File): Promise<DesignScheme> {
  if (file.size > 64 * 1024 * 1024) throw new Error('GLB 文件不得超过 64 MiB。')
  const scene = await loadGLB(await file.arrayBuffer())
  disposeGLB(scene)
  const assetId = await storeDesignAsset(file, file.name)
  const model = createEmptyModel()
  model.floors[0].assets = [{ id: crypto.randomUUID(), name: file.name.slice(0, 160), assetId,
    x: 0, y: 0, z: 0, scale: 1, rotation: 0 }]
  return { id: crypto.randomUUID(), name: file.name.replace(/\.glb$/i, '').trim().slice(0, 160) || '导入模型', model, versions: [] }
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 10000)
}

export function DesignProjectFiles({ scheme, disabled, onImport }: ProjectFileProps) {
  const input = useRef<HTMLInputElement>(null)
  const working = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function transfer(operation: () => Promise<void>) {
    if (working.current) return
    working.current = true
    setBusy(true)
    setError('')
    try { await operation() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { working.current = false; setBusy(false) }
  }
  const filename = scheme?.name.replace(/[^\p{L}\p{N}._ -]/gu, '_')
  return <div className="ih-design-files">
    {onImport && <>
      <button type="button" disabled={busy || disabled} onClick={() => input.current?.click()}>导入方案</button>
      <input ref={input} aria-label="选择 iHome 工程或 GLB 模型" type="file" hidden accept=".ihome.json,.json,.glb" onChange={event => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (file) void transfer(async () => {
          const design = /\.glb$/i.test(file.name) ? await importGLB(file) : await importDesignProject(file, storeDesignAsset)
          if (!await onImport(design)) throw new Error('方案导入失败。')
        })
      }} />
    </>}
    {scheme && <>
      <button type="button" disabled={busy || disabled} onClick={() => void transfer(async () =>
        download(await exportDesignProject(scheme, readDesignAsset), filename + '.ihome.json'))}>导出 iHome 工程</button>
      <button type="button" disabled={busy || disabled} onClick={() => void transfer(async () =>
        download(await exportDesignGLB(scheme.model), filename + '.glb'))}>导出 GLB</button>
    </>}
    {busy && <p role="status">正在处理文件…</p>}
    {error && <p role="alert">{error}</p>}
  </div>
}
