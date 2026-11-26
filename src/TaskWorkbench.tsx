import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ArchiveDialog } from './ArchiveDialog'
import type { TaskService } from './task-client'
import { validateTaskBoard, type OwnerTask, type TaskBoard } from './task-model'
import css from './task-workbench.css'

type StatusFilter = 'all' | 'open' | 'done'
interface TaskEdit { task: OwnerTask, revision: number, isNew: boolean }

function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
function monthStart(date: string) { return new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, 1) }
function dateTitle(date: string) { return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日` }

function TaskEditor({ edit, board, busy, error, onDismiss, onReload, onSave }: {
  edit: TaskEdit, board: TaskBoard, busy: boolean, error: string,
  onDismiss: () => void, onReload: (draft: OwnerTask) => void, onSave: (task: OwnerTask) => Promise<void>
}) {
  const [task, setTask] = useState(edit.task)
  const stale = edit.revision !== board.revision
  const exists = edit.isNew || board.tasks.some(item => item.id === task.id)
  async function submit(event: FormEvent) { event.preventDefault(); if (!busy && !stale) await onSave(task) }
  return <ArchiveDialog title={edit.isNew ? '添加任务' : '编辑任务'} busy={busy} onDismiss={onDismiss}>
    <form className="ih-task-form" onSubmit={event => void submit(event)}>
      <fieldset disabled={busy}>
        <label>任务名称<input autoFocus required maxLength={240} value={task.title} onChange={event => setTask({ ...task, title: event.target.value })} placeholder="例如，确认厨房插座位置" /></label>
        <label>计划日期<input type="date" aria-label="计划日期" value={task.dueDate} onChange={event => setTask({ ...task, dueDate: event.target.value })} /><small>可以留空，之后再安排。</small></label>
        <label>备注<textarea rows={4} maxLength={10000} value={task.notes} onChange={event => setTask({ ...task, notes: event.target.value })} placeholder="记录要准备的材料、联系人或注意事项" /></label>
        <label className="ih-task-completed-field"><input type="checkbox" checked={task.completed} onChange={event => setTask({ ...task, completed: event.target.checked })} />已完成</label>
      </fieldset>
      {error && <p className="ih-task-error" role="alert">{error}</p>}
      {stale && <div className="ih-task-notice" role="status"><p>{exists ? '任务列表有新修改，请核对最新内容后再保存。' : '这项任务已被删除，当前输入仍保留在弹窗中。'}</p>
        {exists && <button type="button" disabled={busy} onClick={() => onReload(task)}>{edit.isNew ? '保留草稿并更新列表版本' : '重新载入任务'}</button>}
      </div>}
      <div className="ih-task-actions"><button className="ih-task-primary" type="submit" disabled={busy || stale || !task.title.trim()}>{busy ? '正在保存…' : '保存任务'}</button><button type="button" disabled={busy} onClick={onDismiss}>取消</button></div>
    </form>
  </ArchiveDialog>
}

export function TaskWorkbench({ service, onAsk }: { service: TaskService, onAsk: (prompt: string) => void }) {
  const [board, setBoard] = useState<TaskBoard>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [today, setToday] = useState(localDay)
  const [month, setMonth] = useState(() => monthStart(localDay()))
  const [dateFilter, setDateFilter] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [editing, setEditing] = useState<TaskEdit | null>(null)
  const [removing, setRemoving] = useState<{ task: OwnerTask, revision: number } | null>(null)
  const saving = useRef(false)
  const loading = useRef(false)
  const generation = useRef(0)
  const mounted = useRef(false)
  const latest = useRef(board)
  latest.current = board

  const refresh = useCallback(async (silent = false) => {
    if (saving.current || loading.current) return
    loading.current = true
    const request = ++generation.current
    try {
      const next = await service.load()
      if (mounted.current && request === generation.current) {
        setBoard(current => current?.revision === next.revision ? current : next)
        if (!silent) setError('')
      }
    } catch (cause) {
      if (mounted.current && request === generation.current && !silent) setError(cause instanceof Error ? cause.message : '无法读取本机任务。')
    } finally { if (request === generation.current) loading.current = false }
  }, [service])

  useEffect(() => {
    mounted.current = true
    void refresh()
    const visible = () => { if (!document.hidden) { setToday(localDay()); void refresh(true) } }
    const timer = window.setInterval(visible, 3000)
    window.addEventListener('focus', visible)
    document.addEventListener('visibilitychange', visible)
    return () => { mounted.current = false; ++generation.current; loading.current = false; window.clearInterval(timer); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible) }
  }, [refresh])

  async function save(next: TaskBoard): Promise<boolean> {
    if (saving.current) return false
    if (next.revision !== latest.current?.revision) { setError('任务列表已有更新，请核对最新内容后再操作。'); return false }
    saving.current = true
    const request = ++generation.current
    setBusy(true); setError(''); setSaved(false)
    try {
      next = validateTaskBoard(next)
      const written = await service.save(next)
      if (mounted.current && request === generation.current) { setBoard(written); setSaved(true) }
      return true
    } catch (cause) {
      if (mounted.current && request === generation.current) setError(cause instanceof Error ? cause.message : '保存失败，请重试。')
      try {
        const current = await service.load()
        if (mounted.current && request === generation.current) {
          setBoard(current)
          if (current.revision > next.revision && JSON.stringify(current.tasks) === JSON.stringify(next.tasks)) {
            setError(''); setSaved(true)
            return true
          }
        }
      } catch { /* Preserve the draft and original save error. */ }
      return false
    } finally { saving.current = false; loading.current = false; if (mounted.current) setBusy(false) }
  }

  function addTask() {
    if (!board) return
    setError('')
    setEditing({ revision: board.revision, isNew: true, task: { id: crypto.randomUUID(), title: '', dueDate: dateFilter && dateFilter !== 'unscheduled' ? dateFilter : '', notes: '', completed: false } })
  }
  function moveMonth(offset: number) {
    setMonth(current => new Date(current.getFullYear(), current.getMonth() + offset, 1))
    if (dateFilter && dateFilter !== 'unscheduled') setDateFilter('')
  }
  const completed = board?.tasks.filter(task => task.completed).length ?? 0
  const overdue = board?.tasks.filter(task => !task.completed && task.dueDate && task.dueDate < today).length ?? 0
  const visibleTasks = (board?.tasks ?? []).filter(task =>
    (!dateFilter || (dateFilter === 'unscheduled' ? !task.dueDate : task.dueDate === dateFilter)) &&
    (status === 'all' || task.completed === (status === 'done')))
    .sort((a, b) => Number(a.completed) - Number(b.completed) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
  const offset = (month.getDay() + 6) % 7
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const calendar = Array.from({ length: Math.ceil((offset + days) / 7) * 7 }, (_, index) => {
    const date = new Date(month.getFullYear(), month.getMonth(), index - offset + 1)
    return { date: localDay(date), day: date.getDate(), current: date.getMonth() === month.getMonth() }
  })
  const dateCounts = new Map<string, { total: number, open: number }>()
  for (const task of board?.tasks ?? []) {
    if (!task.dueDate) continue
    const count = dateCounts.get(task.dueDate) ?? { total: 0, open: 0 }
    count.total++; if (!task.completed) count.open++
    dateCounts.set(task.dueDate, count)
  }
  const scope = dateFilter === 'unscheduled' ? '未排期任务' : dateFilter ? dateTitle(dateFilter) + '的任务' : '任务清单'
  const statusName = status === 'all' ? '全部任务' : status === 'open' ? '未完成任务' : '已完成任务'
  const emptyMessage = board?.tasks.length ? '当前筛选下没有任务。' : '还没有任务，点击「添加任务」记下第一件事。'

  return <section className="ih-task-workbench" aria-label="业主任务与日历"><style>{css}</style>
    <div className="ih-task-toolbar"><button className="ih-task-primary" disabled={!board || busy} onClick={addTask}>添加任务</button>
      <button onClick={() => onAsk('/任务待办助理 请帮我梳理装修中需要我处理的任务，先了解当前进度和近期安排，结合已有任务给出建议。日期不确定时先保留未排期，需要修改资料时请在对话中让我确认。')}>和助理聊聊</button>
      <small role="status">{busy ? '正在保存…' : saved ? '已保存到本机' : ''}</small></div>
    {error && !editing && !removing && <div className="ih-task-error" role="alert">{error}<button disabled={busy} onClick={() => void refresh()}>重新载入</button></div>}
    {!board ? <p role="status">{error ? '任务暂时无法打开。' : '正在读取任务…'}</p> : <>
      <section className="ih-task-progress" aria-label="全部任务完成情况"><div><span>全部任务完成情况</span><strong>{completed}<span> / {board.tasks.length}</span></strong></div>
        <progress value={completed} max={board.tasks.length || 1} aria-label="全部任务完成进度" />
        {board.tasks.length > 0 && <p>{completed === board.tasks.length ? '全部任务已完成' : `还有 ${board.tasks.length - completed} 项待完成`}{overdue > 0 && <span className="ih-task-overdue"> · {overdue} 项已逾期</span>}</p>}
      </section>
      <section className="ih-task-calendar" aria-label="任务月历">
        <div className="ih-task-month"><h2>{month.getFullYear()}年{month.getMonth() + 1}月</h2><div><button aria-label="上个月" onClick={() => moveMonth(-1)}>‹</button><button onClick={() => { setMonth(monthStart(today)); setDateFilter(today) }}>今天</button><button aria-label="下个月" onClick={() => moveMonth(1)}>›</button></div></div>
        <div className="ih-task-weekdays" aria-hidden="true">{['一', '二', '三', '四', '五', '六', '日'].map(day => <span key={day}>{day}</span>)}</div>
        <div className="ih-task-days">{calendar.map(cell => {
          const count = dateCounts.get(cell.date)
          return <button key={cell.date} className="ih-task-day" data-outside={!cell.current || undefined} data-today={cell.date === today || undefined} aria-pressed={dateFilter === cell.date} aria-current={cell.date === today ? 'date' : undefined}
            aria-label={`${cell.date}，${count ? `${count.total} 项任务，${count.open} 项未完成` : '暂无任务'}`} onClick={() => { setDateFilter(cell.date); if (!cell.current) setMonth(monthStart(cell.date)) }}>
            <span>{cell.day}</span><small data-complete={count && !count.open || undefined}>{count ? count.total : ''}</small>
          </button>
        })}</div>
      </section>
      <div className="ih-task-date-filters"><button aria-pressed={!dateFilter} onClick={() => setDateFilter('')}>全部日期</button><button aria-pressed={dateFilter === 'unscheduled'} onClick={() => setDateFilter('unscheduled')}>未排期</button>{dateFilter && dateFilter !== 'unscheduled' && <span>{dateFilter}</span>}</div>
      <div className="ih-task-list-heading"><h2>{scope}</h2><span>{visibleTasks.length} 项</span></div>
      <nav className="ih-task-filters" aria-label="任务完成状态">{([['all', '全部'], ['open', '未完成'], ['done', '已完成']] as const).map(([value, title]) => <button key={value} aria-pressed={status === value} onClick={() => setStatus(value)}>{title}</button>)}</nav>
      <ul className="ih-task-list" aria-label={`${scope}，${statusName}`}>{visibleTasks.map(task => <li key={task.id} data-completed={task.completed || undefined}>
        <input type="checkbox" checked={task.completed} disabled={busy} aria-label={`${task.completed ? '重新打开' : '完成'}任务「${task.title}」`} onChange={() => void save({ ...board, tasks: board.tasks.map(item => item.id === task.id ? { ...item, completed: !task.completed } : item) })} />
        <div className="ih-task-item"><strong>{task.title}</strong><div className="ih-task-meta"><span>{task.dueDate || '未排期'}</span><span>{task.completed ? '已完成' : task.dueDate && task.dueDate < today ? '已逾期' : '待完成'}</span></div>
          {task.notes && <details><summary>备注</summary><p>{task.notes}</p></details>}
          <div className="ih-task-item-actions"><button disabled={busy} onClick={() => { setError(''); setEditing({ task, revision: board.revision, isNew: false }) }}>编辑</button><button disabled={busy} onClick={() => { setError(''); setRemoving({ task, revision: board.revision }) }}>删除</button></div>
        </div>
      </li>)}</ul>
      {!visibleTasks.length && <p className="ih-task-empty">{emptyMessage}</p>}
      {editing && <TaskEditor key={`${editing.task.id}:${editing.revision}`} edit={editing} board={board} busy={busy} error={error} onDismiss={() => { setEditing(null); setError('') }} onReload={draft => {
        const task = editing.isNew ? draft : board.tasks.find(item => item.id === draft.id)
        if (task) { setEditing({ ...editing, task, isNew: editing.isNew && !board.tasks.some(item => item.id === task.id), revision: board.revision }); setError('') }
      }} onSave={async task => {
        const tasks = editing.isNew ? [...board.tasks, task] : board.tasks.map(item => item.id === task.id ? task : item)
        if (await save({ revision: editing.revision, tasks })) setEditing(null)
      }} />}
      {removing && <ArchiveDialog title="删除任务" busy={busy} onDismiss={() => { setRemoving(null); setError('') }}>
        <div className="ih-task-form"><p>确认删除「{removing.task.title}」？</p><p className="ih-task-delete-context">{removing.task.dueDate || '未排期'} · {removing.task.completed ? '已完成' : '未完成'}</p>
          {removing.task.notes && <p className="ih-task-delete-context">{removing.task.notes}</p>}
          {error && <p className="ih-task-error" role="alert">{error}</p>}
          {removing.revision !== board.revision && <div className="ih-task-notice" role="status"><p>任务列表已更新，请重新核对待删除的任务。</p><button disabled={busy} onClick={() => {
            const task = board.tasks.find(item => item.id === removing.task.id)
            setRemoving(task ? { task, revision: board.revision } : null); setError('')
          }}>重新核对</button></div>}
          <div className="ih-task-actions"><button disabled={busy || removing.revision !== board.revision} onClick={async () => { if (await save({ ...board, tasks: board.tasks.filter(item => item.id !== removing.task.id) })) setRemoving(null) }}>确认删除</button><button disabled={busy} onClick={() => { setRemoving(null); setError('') }}>取消</button></div>
        </div>
      </ArchiveDialog>}
    </>}
  </section>
}
