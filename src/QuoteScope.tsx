import { useRef, useState, type FormEvent } from 'react'
import type { QuoteBoard } from './quote-model'
import { assertUniqueScopeKeys, parseQuoteScopeItem, type QuoteScopeItem } from './quote-scope'

type Props = { board: QuoteBoard, onSave: (item: QuoteScopeItem) => Promise<void> }

function ScopeEditor({ board, onSave, initial, onClose }: Props & { initial?: QuoteScopeItem, onClose: () => void }) {
  const [draft, setDraft] = useState<QuoteScopeItem>(() => initial ?? { id: crypto.randomUUID(), key: '', label: '', unit: '', quantity: null, spec: '', source: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving.current) return
    saving.current = true
    setBusy(true)
    setError('')
    try {
      const item = parseQuoteScopeItem(draft)
      const existing = board.scopeItems.find(row => row.id === item.id)
      if (JSON.stringify(existing) !== JSON.stringify(initial)) throw new Error('底稿已有更新，请核对最新记录后重新编辑。')
      assertUniqueScopeKeys([...board.scopeItems.filter(row => row.id !== item.id), item])
      await onSave(item)
      onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存询价底稿失败。') }
    finally { saving.current = false; setBusy(false) }
  }
  return <form onSubmit={event => void submit(event)}><fieldset disabled={busy}><legend>{initial ? '修改底稿项目' : '新增底稿项目'}</legend>
    <label>要求项目名称<input required maxLength={500} value={draft.label} onChange={event => setDraft({ ...draft, label: event.target.value })} placeholder="例如，公卫地面防水"/></label>
    <label>对齐项<input required maxLength={200} value={draft.key} onChange={event => setDraft({ ...draft, key: event.target.value })} placeholder="与商家报价使用相同的项目键"/></label>
    {initial && initial.key !== draft.key && <p>保存后按新的对齐项匹配商家报价，原报价保持存档。</p>}
    <label>底稿工程量<input type="number" min="0" step="any" value={draft.quantity ?? ''} placeholder="待量房时可留空" onChange={event => setDraft({ ...draft, quantity: event.target.value ? event.target.valueAsNumber : null })}/></label>
    <label>底稿单位<input maxLength={80} value={draft.unit} onChange={event => setDraft({ ...draft, unit: event.target.value })} placeholder="例如，平方米"/></label>
    <label>底稿规格与工艺<textarea maxLength={4000} rows={2} value={draft.spec} onChange={event => setDraft({ ...draft, spec: event.target.value })}/></label>
    <label>底稿出处<input required maxLength={2000} value={draft.source} onChange={event => setDraft({ ...draft, source: event.target.value })} placeholder="例如，水电施工图第 3 页或业主确认清单第 5 行"/></label>
    <div className="ih-quote-actions"><button type="submit">{busy ? '正在保存…' : '保存底稿项目'}</button><button type="button" onClick={onClose}>取消</button></div>
    {error && <p role="alert">{error}</p>}
  </fieldset></form>
}

export function QuoteScope({ board, onSave }: Props) {
  const [editing, setEditing] = useState<{ initial?: QuoteScopeItem } | null>(null)
  return <section aria-label="业主询价底稿"><header><h2>业主询价底稿</h2>{!editing && <button type="button" onClick={() => setEditing({})}>添加底稿项目</button>}</header>
    {editing && <ScopeEditor initial={editing.initial} board={board} onSave={onSave} onClose={() => setEditing(null)}/>}
    {!board.scopeItems.length && !editing && <p>按图纸、量房记录或家庭需求列出要询价的项目。核价时会逐家检查漏报和规格差异。</p>}
    {board.scopeItems.map(item => <article key={item.id}><header><h3>{item.label}</h3><button type="button" disabled={!!editing} onClick={() => setEditing({ initial: item })}>修改底稿项目</button></header>
      <p>{item.key} · {item.quantity ?? '工程量待定'} {item.unit} · {item.spec || '规格与工艺待定'}</p><small>底稿出处　{item.source}</small>
    </article>)}
  </section>
}
