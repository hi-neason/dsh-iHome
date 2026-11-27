import { useRef, useState } from 'react'
import type { DesignScheme } from './design-model'
import { exportDesignProject, importDesignProject } from './design-project'
import { readDesignAsset, storeDesignAsset } from './design-media-client'

type ProjectFileProps = { disabled: boolean } & (
  { scheme: DesignScheme, onImport?: never } | { scheme?: never, onImport: (scheme: DesignScheme) => Promise<boolean> }
)
export function DesignProjectFiles({ scheme, disabled, onImport }: ProjectFileProps) {
  const input = useRef<HTMLInputElement>(null)
  const working = useRef(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function transfer(operation: () => Promise<void>) {
    if (working.current) return
    working.current = true
    setBusy(true); setError('')
    try { await operation() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { working.current = false; setBusy(false) }
  }
  function exportProject(scheme: DesignScheme) {
    return transfer(async () => {
      const project = await exportDesignProject(scheme, readDesignAsset)
      const url = URL.createObjectURL(project)
      const link = document.createElement('a')
      link.href = url
      link.download = scheme.name.replace(/[^\p{L}\p{N}._ -]/gu, '_') + '.ihome.json'
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 10000)
    })
  }
  function importFile(file: File) {
    return transfer(async () => {
      const design = await importDesignProject(file, storeDesignAsset)
      if (!onImport || !await onImport(design)) throw new Error('未导入方案，请重新选择工程文件。')
    })
  }
  return <section className="ih-design-files" aria-label="可编辑工程">
    <div className="ih-design-bar">
      {onImport && <><button disabled={busy || disabled} onClick={() => input.current?.click()}>导入工程</button>
      <input ref={input} aria-label="选择 iHome 工程文件" type="file" hidden accept=".ihome.json,.json" onChange={e => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (file) void importFile(file)
      }} /></>}
      {scheme && <button disabled={busy || disabled} onClick={() => exportProject(scheme)}>导出工程</button>}
    </div>
    {busy && <p role="status">正在处理工程文件…</p>}
    {error && <p role="alert">{error}</p>}
  </section>
}
