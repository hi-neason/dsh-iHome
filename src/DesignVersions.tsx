import { useMemo, useState } from 'react'
import { compareDesignModels } from './design-diff'
import { ArchiveDialog } from './ArchiveDialog'
import type { DesignCommand, DesignScheme, DesignState, DesignVersion } from './design-model'

export function DesignVersions({ state, scheme, version, busy, onView, change }: {
  state: DesignState, scheme: DesignScheme, version?: DesignVersion, busy: boolean,
  onView: (id: string) => void, change: (command: Omit<DesignCommand, 'expectedRevision'>) => Promise<boolean>,
}) {
  const [action, setAction] = useState<'create' | 'copy' | 'snapshot' | null>(null)
  const [name, setName] = useState('')
  const diff = useMemo(() => version ? compareDesignModels(version.model, scheme.model) : null, [version, scheme.model])
  const [error, setError] = useState('')
  const titles = { create: '新建设计', copy: '复制为新方案', snapshot: '保存版本' }
  return <section className="ih-design-versions" aria-label="方案与版本">
    <div className="ih-design-bar">
      <label>方案 <select value={scheme.id} disabled={busy} onChange={async e => {
        const id = e.target.value
        if (await change({ action: 'activate', designId: id })) onView('')
      }}>{state.designs.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
      <label>版本 <select value={version?.id ?? ''} disabled={busy} onChange={e => onView(e.target.value)}>
        <option value="">当前草稿</option>
        {[...scheme.versions].reverse().map((snapshot, i) =>
          <option key={snapshot.id} value={snapshot.id}>V{scheme.versions.length - i} · {snapshot.name}</option>)}
      </select></label>
    </div>
    <div className="ih-design-bar">
      {(['create','copy','snapshot'] as const).map(key => <button key={key} disabled={busy || (key === 'snapshot' && !!version)}
        onClick={() => { setAction(key); setName(''); setError('') }}>{titles[key]}</button>)}
      {version && <button onClick={() => onView('')}>返回草稿</button>}
    </div>
    {version && <span className="ih-design-caption">历史快照 · {new Date(version.createdAt).toLocaleString()} · 复制后可继续设计</span>}
    {diff && <details><summary>与当前草稿比较 · 新增 {diff.added.length} · 调整 {diff.changed.length} · 移除 {diff.removed.length}</summary>
      {([['新增',diff.added],['调整',diff.changed],['移除',diff.removed]] as const).map(([title, names]) =>
        names.length > 0 && <p key={title}>{title}　{names.join('、')}</p>)}
      {!diff.added.length && !diff.changed.length && !diff.removed.length && <p>草稿与这个版本的布局相同。</p>}
    </details>}
    {action && <ArchiveDialog title={titles[action]} busy={busy} onDismiss={() => setAction(null)}>
      <form className="ih-design-form" onSubmit={async event => {
        event.preventDefault()
        const ok = await change({ action, ...(action === 'create' ? {} : { designId: scheme.id }),
          ...(action === 'copy' && version ? { versionId: version.id } : {}), ...(name.trim() ? { name: name.trim() } : {}) })
        if (ok) { setAction(null); onView('') }
        else setError('保存失败，请返回工作台查看原因。')
      }}><fieldset disabled={busy}><label>{action === 'snapshot' ? '版本说明' : '方案名称'}
        <input value={name} onChange={e => setName(e.target.value)} maxLength={120} placeholder="可选，留空自动命名" />
      </label>{error && <p role="alert">{error}</p>}<button type="submit">{titles[action]}</button></fieldset></form>
    </ArchiveDialog>}
  </section>
}
