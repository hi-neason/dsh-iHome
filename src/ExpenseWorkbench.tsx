import { useEffect, useState } from 'react'
import { loadExpenses } from './expense-client'
import { expenseStages, formatExpenseAmount, type ExpenseView } from './expense-model'
import css from './expenses.css'

const stageNames = new Map(expenseStages.map(stage => [stage.id, stage.title]))

export function ExpenseWorkbench({ onAsk }: { onAsk: (prompt: string) => void }) {
  const [ledger, setLedger] = useState<ExpenseView>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState('all')
  const [draft, setDraft] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    let revision: number | undefined
    let pending = false
    async function refresh() {
      if (pending || document.hidden) return
      pending = true
      try {
        const next = await loadExpenses(revision, controller.signal)
        if (controller.signal.aborted) return
        if (next) {
          revision = next.revision
          setLedger(next)
        }
        setError('')
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '账本读取失败。')
      } finally { pending = false }
    }
    void refresh()
    const timer = window.setInterval(refresh, 5000)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      controller.abort()
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [attempt])

  const stage = expenseStages.find(item => item.id === selected)
  const totals = stage ? ledger?.summary.stages.find(item => item.stage === stage.id) : ledger?.summary
  const entries = ledger?.entries.filter(item => !stage || item.stage === stage.id)
    .sort((left, right) => right.date.localeCompare(left.date))

  return <div className="ih-expenses">
    <style>{css}</style>
    <div className="ih-expense-heading">
      <h2>装修账本</h2>
      <select aria-label="装修阶段" value={selected} onChange={event => setSelected(event.target.value)}>
        <option value="all">全部阶段</option>
        {expenseStages.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select>
    </div>
    {error && <p role="alert">{error} <button onClick={() => setAttempt(value => value + 1)}>重试</button></p>}
    {!ledger && !error && <p role="status">正在读取账本…</p>}
    {totals && <dl className="ih-expense-totals">
      <div><dt>净支出</dt><dd>¥{formatExpenseAmount(totals.netCents)}</dd></div>
      <div><dt>已付款</dt><dd>¥{formatExpenseAmount(totals.paymentCents)}</dd></div>
      <div><dt>已退款</dt><dd>¥{formatExpenseAmount(totals.refundCents)}</dd></div>
    </dl>}
    <form className="ih-expense-compose" onSubmit={event => {
      event.preventDefault()
      if (draft.trim()) onAsk('/财务经费专员 请帮我记一笔。' + draft.trim())
    }}>
      <label htmlFor="ih-expense-draft">记一笔</label>
      <input id="ih-expense-draft" value={draft} maxLength={3000}
        onChange={event => setDraft(event.target.value)} placeholder="例如：今天付了 800 元设计定金" />
      <button className="ih-expense-primary" disabled={!draft.trim()}>带到对话</button>
    </form>
    <div className="ih-expense-actions">
      <button type="button" onClick={() => onAsk('/财务经费专员 请分析' + (stage?.title ?? '各装修阶段') + '的已记账收支，按类别列出主要开销和退款。')}>分析支出 ↗</button>
      <button type="button" onClick={() => onAsk('/财务经费专员 请结合已知报价、合同和实际付款，帮我分配装修预算、核对待付款。请标明估算和仍需我补充的金额。')}>规划预算与待付款 ↗</button>
    </div>
    <div className="ih-expense-heading"><h2>收支明细</h2>{entries && <small>{entries.length} 笔</small>}</div>
    {entries?.length === 0 && <p className="ih-expense-empty">{stage ? '这个阶段还没有流水。' : '还没有流水。记下第一笔付款或退款，在对话中确认后就会显示在这里。'}</p>}
    {!!entries?.length && <ul className="ih-expense-list">
      {entries.map(item => <li key={item.id}>
        <div>
          <strong>{item.title}</strong>
          <small>{[item.date, stageNames.get(item.stage), item.category, item.payee].filter(Boolean).join(' · ')}</small>
          {item.notes && <small>{item.notes}</small>}
        </div>
        <div className="ih-expense-amount">
          <strong>¥{formatExpenseAmount(item.amountCents)}</strong><small>{item.kind === 'refund' ? '退款' : '付款'}</small>
        </div>
      </li>)}
    </ul>}
  </div>
}
