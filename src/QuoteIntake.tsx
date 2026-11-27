import { useRef, useState, type FormEvent } from 'react'
import type { QuoteBoard } from './quote-model'
import { parseQuoteTsv, parseQuoteVersion, quoteStatusLabels, quoteTsvHeader, type QuoteLine, type QuoteVersion } from './quote-version'
import css from './quote-intake.css'

type Props = { board: QuoteBoard, onSave: (quote: QuoteVersion) => Promise<void> }
const example = quoteTsvHeader + '\n客厅墙面\t墙面面漆\t㎡\t32\t58\t1856\t一底两面 A 型\t包含\t报价第 2 页第 3 行'
const lineNumbers = [['quantity', '工程量'], ['unitPrice', '单价（元）'], ['amount', '原合价（元）']] as const
const lineText = [['key', '对齐项', '例如，客厅墙面'], ['label', '原项目名称', '照录商家的名称'],
  ['unit', '单位', '例如，㎡'], ['spec', '规格与工艺', '例如，品牌、型号、一底两面'],
  ['source', '分项出处', '例如，第 2 页第 3 行']] as const

function blankLine(): QuoteLine {
  return { key: '', label: '', unit: '', quantity: null, unitPrice: null, amount: null, spec: '', source: '', status: 'unknown' }
}
function money(value: number | null) { return value === null ? '未注明' : '¥' + value.toLocaleString('zh-CN', { maximumFractionDigits: 8 }) }

function QuoteEditor({ board, initial, onClose, onSave }: Props & { initial?: QuoteVersion, onClose: () => void }) {
  const [quote, setQuote] = useState<QuoteVersion>(() => ({
    id: crypto.randomUUID(), vendorId: initial?.vendorId ?? board.vendors[0]?.id ?? '',
    version: '', date: '', scope: initial?.scope ?? '', source: '', statedTotal: null,
    lines: initial?.lines.map(line => ({ ...line })) ?? [blankLine()],
  }))
  const [pasted, setPasted] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)

  function updateLine(index: number, changes: Partial<QuoteLine>) {
    setQuote(previous => ({ ...previous, lines: previous.lines.map((line, i) => i === index ? { ...line, ...changes } : line) }))
  }
  function appendPasted() {
    try {
      const added = parseQuoteTsv(pasted)
      const existing = quote.lines.filter(line => Object.entries(blankLine()).some(([field, value]) => line[field as keyof QuoteLine] !== value))
      const combined = [...existing, ...added]
      if (combined.length > 2000) throw new Error('每份报价最多录入 2000 条分项。')
      const keys = new Set(existing.map(line => line.key.trim()).filter(Boolean))
      for (const line of added) {
        if (keys.has(line.key)) throw new Error(`对齐项“${line.key}”已在草稿中，请按房间或工序细分。`)
      }
      setQuote({ ...quote, lines: combined })
      setPasted('')
      setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '分项未能加入草稿。') }
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving.current) return
    saving.current = true
    setBusy(true)
    setError('')
    try {
      if (pasted.trim()) throw new Error('还有尚未加入草稿的粘贴内容，请先加入分项或清空粘贴框。')
      const next = parseQuoteVersion(quote)
      if (!board.vendors.some(vendor => vendor.id === next.vendorId)) throw new Error('请重新选择候选团队。')
      if (board.quotes.some(other => other.vendorId === next.vendorId && other.version === next.version)) {
        throw new Error('这家团队已使用这个版本名，请给新报价起一个不同名称。')
      }
      await onSave(next)
      onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '当前报价保存失败，草稿仍可编辑。') }
    finally { saving.current = false; setBusy(false) }
  }
  return <form className="ih-quote-editor" onSubmit={event => void submit(event)}>
    <fieldset disabled={busy}>
      <legend>{initial ? '从“' + initial.version + '”修订' : '新报价版本'}</legend>
      {initial && <p>请对照新报价更新分项与出处。保存后可同时查看两个版本。</p>}
      <div className="ih-quote-grid">
        <label>候选团队<select required disabled={!!initial} value={quote.vendorId} onChange={e => setQuote({ ...quote, vendorId: e.target.value })}>
          {board.vendors.map(vendor => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
        </select></label>
        <label>版本名称<input required maxLength={200} value={quote.version} onChange={e => setQuote({ ...quote, version: e.target.value })} placeholder="例如，量房后第二稿" /></label>
        <label>报价日期<input type="date" required value={quote.date} onChange={e => setQuote({ ...quote, date: e.target.value })} /></label>
        <label>原报价总额（元）<input type="number" min="0" step="any" value={quote.statedTotal ?? ''} placeholder="未注明时留空"
          onChange={e => setQuote({ ...quote, statedTotal: e.target.value === '' ? null : e.target.valueAsNumber })} /></label>
      </div>
      <label>承包范围<textarea rows={2} value={quote.scope} maxLength={4000} onChange={e => setQuote({ ...quote, scope: e.target.value })} placeholder="例如，半包，含辅材及垃圾清运" /></label>
      <label>报价出处<input required maxLength={2000} value={quote.source} onChange={e => setQuote({ ...quote, source: e.target.value })} placeholder="原文件名、材料链接或商家书面答复" /></label>
      <details className="ih-quote-paste"><summary>从表格粘贴分项</summary>
        <p>按下列顺序从表格复制 9 列。每行一项，金额单位为元，未知数字留空。多家报价用相同的对齐项名称表示同一工程。</p>
        <pre>{example}</pre>
        <label>表格内容<textarea rows={4} value={pasted} onChange={e => setPasted(e.target.value)} /></label>
        <button type="button" disabled={!pasted.trim()} onClick={appendPasted}>将分项加入草稿</button>
      </details>
      {quote.lines.map((line, i) => <fieldset key={i} className="ih-quote-line">
        <legend>分项 {i + 1}</legend>
        <div className="ih-quote-grid">
          {lineText.map(([key, title, placeholder]) => <label key={key}>{title}<input required={key === 'key' || key === 'label' || key === 'source'}
            value={line[key]} placeholder={placeholder} onChange={e => updateLine(i, { [key]: e.target.value })} /></label>)}
          <label>承包口径<select value={line.status} onChange={e => updateLine(i, { status: e.target.value as QuoteLine['status'] })}>
            {Object.entries(quoteStatusLabels).map(([value, title]) => <option key={value} value={value}>{title}</option>)}
          </select></label>
          {lineNumbers.map(([key, label]) => <label key={key}>{label}<input type="number" min="0" step="any" value={line[key] ?? ''} placeholder="未注明时留空"
            onChange={e => updateLine(i, { [key]: e.target.value === '' ? null : e.target.valueAsNumber })} /></label>)}
        </div>
        <button type="button" onClick={() => setQuote({ ...quote, lines: quote.lines.filter((_, index) => index !== i) })}>移除分项 {i + 1}</button>
      </fieldset>)}
      <button type="button" disabled={quote.lines.length >= 2000} onClick={() => setQuote({ ...quote, lines: [...quote.lines, blankLine()] })}>添加一行分项</button>
      {error && <p role="alert">{error}</p>}
      <div className="ih-quote-editor-actions"><button type="submit" className="ih-quote-primary">{busy ? '正在保存…' : '保存报价版本'}</button>
        <button type="button" onClick={onClose}>取消</button></div>
    </fieldset>
  </form>
}

export function QuoteIntake({ board, onSave }: Props) {
  const [editor, setEditor] = useState<{ initial?: QuoteVersion } | null>(null)
  return <section className="ih-quote-intake" aria-label="报价版本与原始分项"><style>{css}</style>
    {editor ? <QuoteEditor board={board} initial={editor.initial} onSave={onSave} onClose={() => setEditor(null)} /> : <>
      <button type="button" className="ih-quote-primary" disabled={!board.vendors.length} onClick={() => setEditor({})}>录入报价版本</button>
      {!board.vendors.length && <p>先登记候选团队，即可为这家团队录入报价。</p>}
      {board.vendors.length > 0 && !board.quotes.length && <p>还没有已保存的报价。</p>}
      {board.quotes.slice().reverse().map(quote => <details className="ih-quote-original" key={quote.id}>
        <summary>{board.vendors.find(vendor => vendor.id === quote.vendorId)?.name} · {quote.version} · {quote.date}</summary>
        <dl><dt>原报价总额</dt><dd>{money(quote.statedTotal)}</dd><dt>承包范围</dt><dd>{quote.scope || '未注明'}</dd>
          <dt>报价出处</dt><dd>{quote.source}</dd></dl>
        <ol>{quote.lines.map(line => <li key={line.key}><strong>{line.label}</strong> · {quoteStatusLabels[line.status]}
          <dl><dt>对齐项</dt><dd>{line.key}</dd><dt>规格与工艺</dt><dd>{line.spec || '未注明'}</dd>
            <dt>单位 / 工程量</dt><dd>{line.unit || '未注明'} / {line.quantity ?? '未注明'}</dd><dt>单价 / 原合价</dt><dd>{money(line.unitPrice)} / {money(line.amount)}</dd>
            <dt>分项出处</dt><dd>{line.source}</dd></dl></li>)}</ol>
        <button type="button" onClick={() => setEditor({ initial: quote })}>基于此版修订</button>
      </details>)}
    </>}
  </section>
}
