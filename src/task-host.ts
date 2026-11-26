import { allowedExpertTools } from './expert-dispatch'
import type { ArchiveHostContext, ArchiveTool } from './archive-host'
import { isIHomeToolContext } from './ihome-workspace-path'
import { prepareTaskChange, queryTasks, TaskConflict, validateTaskBoard, type TaskBoard } from './task-model'

export interface TaskTable {
  get(key: string): TaskBoard | undefined
  put(key: string, board: TaskBoard): Promise<void>
  update(key: string, transform: (current: TaskBoard) => TaskBoard): Promise<TaskBoard>
}

export interface TaskHostContext extends Pick<ArchiveHostContext, 'connection' | 'tools' | 'userQuestions' | 'effect'> {
  storageDomain: { open(spec: {
    name: string, version: number,
    tables: { boards: { valueSchema: { parse(value: unknown): TaskBoard } } }
  }): Promise<{ table(name: 'boards'): TaskTable, close(): Promise<void> }> }
}

export function saveTaskBoard(table: TaskTable, raw: unknown, signal?: AbortSignal): Promise<TaskBoard> {
  const next = validateTaskBoard(raw)
  return table.update('home', current => {
    signal?.throwIfAborted()
    if (current.revision !== next.revision) throw new TaskConflict('任务列表已有更新，请重新载入后再保存。')
    return validateTaskBoard({ ...next, revision: current.revision + 1 })
  })
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
}

const output: ArchiveTool['output'] = {
  schema: {}, render(_args, value) { return [{ type: 'text', text: JSON.stringify(value) }] },
}

export async function mountTasks(ctx: TaskHostContext): Promise<void> {
  await ctx.effect(async () => {
    const domain = await ctx.storageDomain.open({ name: 'ihome_tasks', version: 1,
      tables: { boards: { valueSchema: { parse: validateTaskBoard } } } })
    const disposers: (() => void | Promise<void>)[] = []
    try {
      const table = domain.table('boards')
      if (!table.get('home')) await table.put('home', { revision: 0, tasks: [] })
      function read(): TaskBoard {
        const board = table.get('home')
        if (!board) throw new Error('任务列表尚未初始化。')
        return board
      }
      const register = (tool: ArchiveTool) => ctx.tools.register({ ...tool, async execute(args, execution) {
        execution.signal.throwIfAborted()
        if (!isIHomeToolContext(execution)) throw new Error('iHome 工具仅在 iHome工作区内可用。')
        if (!allowedExpertTools(execution).has(tool.name)) throw new Error('当前专家没有使用这个工具的权限。')
        return tool.execute(args, execution)
      } }, { when: context => allowedExpertTools(context).has(tool.name) })
      disposers.push(ctx.connection.fetch.register({ path: '/api/ihome/tasks', methods: ['GET', 'POST'], requestBody: 'buffered',
        async fetch(request) {
          try {
            request.signal.throwIfAborted()
            if (request.method === 'GET') return json(read())
            if (request.method !== 'POST') return json({ error: '请求方法无效。' }, 405)
            const raw = await request.json()
            request.signal.throwIfAborted()
            return json(await saveTaskBoard(table, raw, request.signal))
          } catch (error) {
            return json({ error: error instanceof Error ? error.message : '任务保存失败，请重试。' }, error instanceof TaskConflict ? 409 : 400)
          }
        },
      }))
      disposers.push(register({ name: 'ihome_read_tasks',
        description: '读取业主保存在本机的装修任务，返回任务及当前 revision。可用 status 筛选完成状态，from/to 按包含边界的日期范围筛选。未排期任务在不指定日期范围时返回。新增或修改前先读取，使用返回的 revision 作为 expectedRevision。',
        parameters: { type: 'object', additionalProperties: false, properties: {
          status: { type: 'string', enum: ['all', 'pending', 'completed'] },
          from: { type: 'string', description: '起始日期 YYYY-MM-DD。' }, to: { type: 'string', description: '结束日期 YYYY-MM-DD。' },
        }, required: [] }, output,
        async execute(args) { return queryTasks(read(), args) },
      }))
      disposers.push(register({ name: 'ihome_propose_task',
        description: '在当前对话展示任务修改，用户接受后直接保存到本机。先用 ihome_read_tasks 读取最新 revision。action=create 时 title 必填，dueDate 为空表示未排期，completed 默认 false。action=update/delete 时 taskId 必填，update 仅填写要修改的字段，completed 可标记或撤销完成，dueDate 空字符串可取消排期。日期由用户明确说明或确认，原始要求可放 notes。',
        parameters: { type: 'object', additionalProperties: false, properties: {
          action: { type: 'string', enum: ['create', 'update', 'delete'] }, expectedRevision: { type: 'integer', minimum: 0 },
          taskId: { type: 'string' }, title: { type: 'string', maxLength: 240 },
          dueDate: { type: 'string', description: 'YYYY-MM-DD，空字符串表示未排期。' }, notes: { type: 'string', maxLength: 10000 }, completed: { type: 'boolean' },
        }, required: ['action', 'expectedRevision'] }, output,
        async execute(args, execution) {
          const { signal, agent } = execution
          if (!agent) throw new Error('请在当前 iHome 对话中修改任务。')
          try {
            const change = prepareTaskChange(read(), args)
            if (!change.changed) return { status: 'unchanged', revision: change.next.revision, taskId: change.taskId, message: '任务已是本次请求的状态。' }
            const id = 'apply-task-change'
            const result = await ctx.userQuestions.ask({ agent, signal, questions: [{ id, header: '装修任务',
              question: '接受这项任务修改并保存吗？', detail: change.summary, options: [{ label: '接受' }, { label: '不接受' }] }] })
            signal.throwIfAborted()
            const [answer] = result.answers
            if (result.answers.length !== 1 || answer.id !== id || answer.custom?.trim() || answer.selected.length !== 1 || answer.selected[0] !== '接受') {
              return { status: 'not_applied', message: '本次任务修改未保存。', feedback: answer?.custom }
            }
            const saved = await saveTaskBoard(table, change.next, signal)
            return { status: 'applied', revision: saved.revision, taskId: change.taskId, message: '已按本次对话中接受的内容更新任务。' }
          } catch (error) {
            if (error instanceof TaskConflict) return { status: 'conflict', message: error.message }
            throw error
          }
        },
      }))
      return async () => {
        for (const dispose of disposers.reverse()) await dispose()
        await domain.close()
      }
    } catch (error) {
      for (const dispose of disposers.reverse()) await dispose()
      await domain.close()
      throw error
    }
  })
}
