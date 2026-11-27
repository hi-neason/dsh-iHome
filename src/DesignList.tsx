import { useState } from 'react'
import { ArchiveDialog } from './ArchiveDialog'
import { DesignProjectFiles } from './DesignProjectFiles'
import type { DesignCommand, DesignScheme } from './design-model'

type NameAction = 'create' | 'copy' | 'rename'
const titles = { create: '新建方案', copy: '复制方案', rename: '重命名方案' }

export function DesignList({ schemes, busy, error, open, change }: {
  schemes: DesignScheme[], busy: boolean, error: string, open(id: string): void,
  change(command: Omit<DesignCommand, 'expectedRevision'>): Promise<boolean>,
}) {
  const [dialog, setDialog] = useState<{ action: NameAction, scheme?: DesignScheme }>()
  const [name, setName] = useState('')
  function editName(action: NameAction, scheme?: DesignScheme) {
    const suggested = action === 'copy' ? scheme!.name.slice(0, 156) + ' 副本' : scheme?.name ?? ''
    setName(suggested)
    setDialog({ action, scheme })
  }
  return <>
    <header className="ih-design-heading"><h2>方案列表</h2><div className="ih-design-bar">
      <button disabled={busy} onClick={() => editName('create')}>新建方案</button>
      <DesignProjectFiles disabled={busy} onImport={design => change({ action: 'import', design })} />
    </div></header>
    <ul className="ih-design-list" aria-label="设计方案">{schemes.map(scheme =>
      <li key={scheme.id}>
        <button className="ih-scheme-name" disabled={busy} onClick={() => open(scheme.id)}>{scheme.name}</button>
        <button disabled={busy} aria-label={'复制 ' + scheme.name} onClick={() => editName('copy', scheme)}>复制</button>
        <button disabled={busy} aria-label={'重命名 ' + scheme.name} onClick={() => editName('rename', scheme)}>重命名</button>
      </li>)}</ul>
    {error && !dialog && <p role="alert">{error}</p>}
    {dialog && <ArchiveDialog title={titles[dialog.action]} busy={busy} onDismiss={() => setDialog(undefined)}>
      <form className="ih-design-form" onSubmit={async event => {
        event.preventDefault()
        const trimmed = name.trim()
        if (!trimmed) return
        const ok = await change({ action: dialog.action, name: trimmed, ...(dialog.scheme && { designId: dialog.scheme.id }) })
        if (ok) setDialog(undefined)
      }}><fieldset disabled={busy}>
        <label>方案名称<input required maxLength={160} value={name} onChange={event => setName(event.target.value)} /></label>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={!name.trim()}>保存</button>
      </fieldset></form>
    </ArchiveDialog>}
  </>
}
