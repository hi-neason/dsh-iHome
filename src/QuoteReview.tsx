import { useRef, useState, type FormEvent } from 'react'
import { auditQuote } from './quote-audit'
import type { QuoteBoard } from './quote-model'
import { assertUniqueQuoteReviews, contractQuestions, parseQuoteReview, type QuoteReview } from './quote-review'

type Props = { board: QuoteBoard, onSave: (review: QuoteReview) => Promise<void> }
type ReviewDraft = { record: QuoteReview, original?: QuoteReview }

function ReviewEditor({ draft, setDraft, close, board, onSave }: Props & {
  draft: ReviewDraft, setDraft: (draft: ReviewDraft) => void, close: () => void
}) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const { record, original } = draft
  function change(patch: Partial<QuoteReview>) { setDraft({ ...draft, record: { ...record, ...patch } }) }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving.current) return
    saving.current = true
    setBusy(true)
    setError('')
    try {
      const value = parseQuoteReview(record)
      const current = board.reviews.find(item => item.id === record.id)
      if (JSON.stringify(current) !== JSON.stringify(original)) throw new Error('这条记录已有更新。请核对现有记录，再重新编辑。')
      assertUniqueQuoteReviews([...board.reviews.filter(item => item.id !== value.id), value])
      await onSave(value)
      close()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，请重试。') }
    finally { saving.current = false; setBusy(false) }
  }
  return <form onSubmit={event => void submit(event)}><fieldset className="ih-quote-fields" disabled={busy}>
    <legend>{original ? '更新澄清记录' : '新增澄清记录'}</legend>
    <label>核对主题<input required maxLength={250} value={record.topic} onChange={e => change({ topic: e.target.value })} /></label>
    <label>原约定与出处<textarea rows={2} maxLength={6000} value={record.source} placeholder="例如，合同第 5 条原文、报价第 2 页；尚未收到时可留空"
      onChange={e => change({ source: e.target.value })} /></label>
    <label>澄清问题<textarea required rows={3} maxLength={6000} value={record.question} onChange={e => change({ question: e.target.value })} /></label>
    <label>商家书面答复<textarea rows={3} maxLength={12000} value={record.answer} placeholder="照录商家书面说明"
      onChange={e => change({ answer: e.target.value })} /></label>
    <label>答复出处<input maxLength={2000} value={record.answerSource} placeholder="例如，11月27日报价补充函第2条" onChange={e => change({ answerSource: e.target.value })} /></label>
    <label>跟进状态<select value={record.status} onChange={e => change({ status: e.target.value as QuoteReview['status'] })}>
      <option value="open">待澄清</option><option value="answered">已答复</option>
    </select></label>
    <div><button type="submit">{busy ? '正在保存…' : '保存澄清记录'}</button> <button type="button" onClick={close}>取消编辑</button></div>
    {error && <p role="alert">{error}</p>}
  </fieldset></form>
}

export function QuoteReviewPanel({ board, onSave }: Props) {
  const [selected, setSelected] = useState('')
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft | undefined>>({})
  const quote = board.quotes.find(item => item.id === selected) ?? board.quotes.at(-1)
  if (!quote) return <section className="ih-quote-panel" aria-label="合同核对与商家澄清"><h2>合同核对与商家澄清</h2><p>录入报价版本后，即可对照合同逐项核对并跟踪书面答复。</p></section>
  const { id } = quote
  const reviews = board.reviews.filter(item => item.quoteId === id)
  const audit = auditQuote(board, id)
  const draft = drafts[id]
  function edit(value?: ReviewDraft) { setDrafts(current => ({ ...current, [id]: value })) }
  function begin(topic: string, question: string, source = '') {
    edit({ record: { id: crypto.randomUUID(), quoteId: id, topic, question, source, status: 'open', answer: '', answerSource: '' } })
  }
  return <section className="ih-quote-panel" aria-label="合同核对与商家澄清"><h2>合同核对与商家澄清</h2>
    <label>报价版本<select value={id} onChange={e => setSelected(e.target.value)}>
      {board.quotes.map(item => <option key={item.id} value={item.id}>{board.vendors.find(v => v.id === item.vendorId)?.name} · {item.version} · {item.date}</option>)}
    </select></label>
    {draft ? <ReviewEditor key={draft.record.id} board={board} draft={draft} setDraft={edit} close={() => edit(undefined)} onSave={onSave} /> : <>
      <h3>合同核对主题</h3>
      <ul>{contractQuestions.map(({ topic, question }) => {
        const related = reviews.filter(review => review.topic === topic)
        const open = related.filter(review => review.status === 'open').length
        return <li key={topic}><strong>{topic}</strong> · {related.length ? `${related.length} 条记录，${open} 条待澄清` : '尚未核对'}
          <br/><button type="button" onClick={() => begin(topic, question)}>核对{topic}</button></li>
      })}</ul>
      {audit.questions.length > 0 && <details><summary>从核价发现发起澄清（{audit.questions.length}）</summary>
        <ul>{audit.questions.map((finding, index) => {
          const topic = '核价 · ' + finding.kind
          const question = `【${finding.item}】${finding.evidence}。${finding.question}`
          const tracked = reviews.some(item => item.topic === topic && item.question === question && item.source === finding.source)
          return <li key={index}><strong>{finding.item}</strong> · {finding.evidence}<br/>{finding.question}<br/>
            <button type="button" disabled={tracked} onClick={() => begin(topic, question, finding.source)}>{tracked ? '已加入跟踪' : '跟踪此问题'}</button></li>
        })}</ul>
      </details>}
      <button type="button" onClick={() => begin('', '')}>自定义澄清问题</button>
    </>}
    <h3>本版澄清记录（{reviews.length}）</h3>
    {reviews.length ? <ul>{reviews.map(item => <li key={item.id}>
      <strong>{item.topic} · {item.status === 'open' ? '待澄清' : '已答复'}</strong><p>{item.question}</p>
      <p>原约定与出处 · {item.source || '尚未提供'}</p>
      {item.answer && <><p>书面答复 · {item.answer}</p><p>答复出处 · {item.answerSource}</p></>}
      {!draft && <button type="button" onClick={() => edit({ record: { ...item }, original: item })}>更新此记录</button>}
    </li>)}</ul> : <p>此报价版本尚无澄清记录。</p>}
  </section>
}
