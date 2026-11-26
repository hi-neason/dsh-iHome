export interface OwnerTask {
  id: string
  title: string
  dueDate: string
  notes: string
  completed: boolean
}

export interface TaskBoard { revision: number, tasks: OwnerTask[] }

export function taskObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('任务数据格式有误。')
  return value as Record<string, unknown>
}

function text(value: unknown, name: string, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error(`${name}格式有误。`)
  return value.trim()
}

export function taskDate(value: unknown): string {
  if (value === '') return ''
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) || value.startsWith('0000-')) throw new Error('任务日期请填写 YYYY-MM-DD。')
  const date = new Date(value + 'T00:00:00Z')
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('任务日期无效。')
  return value
}

function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('任务版本无效。')
  return value
}

function task(value: unknown): OwnerTask {
  const raw = taskObject(value)
  if (typeof raw.completed !== 'boolean') throw new Error('任务完成状态无效。')
  return { id: text(raw.id, '任务编号', 200, true), title: text(raw.title, '任务名称', 240, true),
    dueDate: taskDate(raw.dueDate), notes: text(raw.notes, '任务备注', 10000), completed: raw.completed }
}

export function validateTaskBoard(value: unknown): TaskBoard {
  const raw = taskObject(value)
  if (!Array.isArray(raw.tasks)) throw new Error('任务列表格式有误。')
  const tasks = raw.tasks.map(task)
  if (new Set(tasks.map(item => item.id)).size !== tasks.length) throw new Error('任务编号重复。')
  return { revision: revision(raw.revision), tasks }
}

export class TaskConflict extends Error {}

function sameTask(a: OwnerTask, b: OwnerTask): boolean {
  return a.title === b.title && a.dueDate === b.dueDate && a.notes === b.notes && a.completed === b.completed
}

function describeTask(item: OwnerTask): string {
  return [`任务：${item.title}`, `日期：${item.dueDate || '未排期'}`, `状态：${item.completed ? '已完成' : '待完成'}`, `备注：${item.notes || '未填写'}`].join('\n')
}

export function prepareTaskChange(board: TaskBoard, value: unknown) {
  const raw = taskObject(value)
  if (!['create', 'update', 'delete'].includes(String(raw.action))) throw new Error('请选择新增、更新或删除任务。')
  const expectedRevision = revision(raw.expectedRevision)
  const targetId = raw.action === 'create' ? undefined : text(raw.taskId, '任务编号', 200, true)
  const previous = board.tasks.find(item => item.id === targetId)
  if (raw.action === 'update' && !previous) throw new Error('这条任务已不存在，请重新读取任务列表。')
  if (raw.action === 'delete') {
    if (!previous) return { changed: false, next: board, summary: '', taskId: targetId }
    if (expectedRevision !== board.revision) throw new TaskConflict('任务列表已有更新，请读取最新任务后重新确认。')
    return { changed: true, next: { ...board, tasks: board.tasks.filter(item => item.id !== targetId) }, summary: '删除任务\n' + describeTask(previous), taskId: targetId }
  }
  const nextTask = task({ id: previous?.id ?? crypto.randomUUID(),
    title: raw.title === undefined ? previous?.title : raw.title,
    dueDate: raw.dueDate === undefined ? previous?.dueDate ?? '' : raw.dueDate,
    notes: raw.notes === undefined ? previous?.notes ?? '' : raw.notes,
    completed: raw.completed === undefined ? previous?.completed ?? false : raw.completed })
  const existing = previous ?? board.tasks.find(item => sameTask(item, nextTask))
  if (existing && sameTask(existing, nextTask)) return { changed: false, next: board, summary: '', taskId: existing.id }
  if (expectedRevision !== board.revision) throw new TaskConflict('任务列表已有更新，请读取最新任务后重新确认。')
  const tasks = previous ? board.tasks.map(item => item.id === previous.id ? nextTask : item) : [...board.tasks, nextTask]
  return { changed: true, next: validateTaskBoard({ ...board, tasks }), taskId: nextTask.id,
    summary: previous ? '更新前\n' + describeTask(previous) + '\n\n更新后\n' + describeTask(nextTask) : '新增任务\n' + describeTask(nextTask) }
}

export function queryTasks(board: TaskBoard, value: unknown): TaskBoard {
  const raw = taskObject(value)
  const status = raw.status ?? 'all'
  if (!['all', 'pending', 'completed'].includes(String(status))) throw new Error('任务筛选状态无效。')
  const from = raw.from === undefined ? undefined : taskDate(raw.from)
  const to = raw.to === undefined ? undefined : taskDate(raw.to)
  if (from === '' || to === '' || (from && to && from > to)) throw new Error('请选择有效的任务日期范围。')
  return { revision: board.revision, tasks: board.tasks.filter(item =>
    (status === 'all' || item.completed === (status === 'completed')) &&
    (!from || !!item.dueDate && item.dueDate >= from) && (!to || !!item.dueDate && item.dueDate <= to)) }
}
