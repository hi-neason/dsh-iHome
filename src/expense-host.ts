import { allowedExpertTools } from './expert-dispatch'
import { auditDateToday } from './quote-audit'
import type { ArchiveHostContext, ArchiveTool } from './archive-host'
import { isIHomeToolContext } from './ihome-workspace-path'
import { expenseStages, prepareExpenseChange, queryExpenses, ExpenseConflict, validateExpenseBoard, type ExpenseBoard } from './expense-model'

export interface ExpenseTable {
  get(key: string): ExpenseBoard | undefined
  put(key: string, board: ExpenseBoard): Promise<void>
  update(key: string, transform: (current: ExpenseBoard) => ExpenseBoard): Promise<ExpenseBoard>
}
export interface ExpenseHostContext extends Pick<ArchiveHostContext, 'connection' | 'tools' | 'userQuestions' | 'effect'> {
  storageDomain: { open(spec: {
    name: string, version: number,
    tables: { boards: { valueSchema: { parse(value: unknown): ExpenseBoard } } }
  }): Promise<{ table(name: 'boards'): ExpenseTable, close(): Promise<void> }> }
}
const output: ArchiveTool['output'] = {
  schema: {}, render(_args, value) { return [{ type: 'text', text: JSON.stringify(value) }] },
}

export async function mountExpenses(ctx: ExpenseHostContext): Promise<void> {
  await ctx.effect(async () => {
    const domain = await ctx.storageDomain.open({ name: 'ihome_expenses', version: 1,
      tables: { boards: { valueSchema: { parse: validateExpenseBoard } } } })
    const disposers: (() => void | Promise<void>)[] = []
    try {
      const table = domain.table('boards')
      if (!table.get('home')) await table.put('home', { revision: 0, entries: [] })
      const read = () => {
        const board = table.get('home')
        if (!board) throw new Error('装修账本尚未初始化。')
        return board
      }
      const register = (tool: ArchiveTool) => ctx.tools.register({ ...tool, async execute(args, execution) {
        execution.signal.throwIfAborted()
        if (!isIHomeToolContext(execution)) throw new Error('iHome 工具仅在 iHome工作区内可用。')
        if (!allowedExpertTools(execution).has(tool.name)) throw new Error('当前专家没有使用这个工具的权限。')
        return tool.execute(args, execution)
      } }, { when: context => allowedExpertTools(context).has(tool.name) })
      disposers.push(ctx.connection.fetch.register({ path: '/api/ihome/expenses', methods: ['GET'], requestBody: 'buffered',
        async fetch(request) {
          try {
            request.signal.throwIfAborted()
            if (request.method !== 'GET') return Response.json({ error: '请求方法无效。' }, { status: 405 })
            const board = read()
            if (new URL(request.url).searchParams.get('revision') === String(board.revision))
              return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
            return Response.json(queryExpenses(board), { headers: { 'cache-control': 'no-store' } })
          } catch (error) {
            return Response.json({ error: error instanceof Error ? error.message : '账本读取失败。' }, { status: 400 })
          }
        },
      }))
      disposers.push(register({ name: 'ihome_read_expenses',
        description: '读取本机装修账本及 revision，today 返回本机当前日期 YYYY-MM-DD，供换算今天、昨天等相对日期。返回实际付款、退款、净支出和各阶段合计，金额单位为人民币分。stage/from/to 可筛选阶段和包含边界的交易日期，合计仅覆盖筛选结果。新增修改前先读取，返回的 revision 用作 expectedRevision。',
        parameters: { type: 'object', additionalProperties: false, properties: {
          stage: { type: 'string', enum: expenseStages.map(item => item.id) },
          from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' },
        }, required: [] }, output,
        async execute(args) { return { today: auditDateToday(), ...queryExpenses(read(), args) } },
      }))
      disposers.push(register({ name: 'ihome_propose_expense',
        description: '在当前主对话确认并保存一笔实际装修付款或退款。先读取最新账本。expenseId 是每笔交易的唯一编号，创建时生成一个新编号，重试同一笔沿用原编号；不同交易即使内容相同也用不同编号。create 必填 title/date/stage/kind/amountCents，payee/category 可留空；日期和金额依据实际交易，金额为正整数人民币分，退款 kind=refund。合同额、预算和待付款保持为分析信息。update 仅填改变字段，delete 按编号删除。notes 保留凭证来源及备注。',
        parameters: { type: 'object', additionalProperties: false, properties: {
          action: { type: 'string', enum: ['create', 'update', 'delete'] }, expectedRevision: { type: 'integer', minimum: 0 },
          expenseId: { type: 'string', minLength: 1, maxLength: 200 }, title: { type: 'string', maxLength: 240 },
          date: { type: 'string', description: '实际交易日期 YYYY-MM-DD。' }, payee: { type: 'string', maxLength: 240 },
          category: { type: 'string', maxLength: 120 }, stage: { type: 'string', enum: expenseStages.map(item => item.id) },
          kind: { type: 'string', enum: ['payment', 'refund'] }, amountCents: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
          notes: { type: 'string', maxLength: 10000 },
        }, required: ['action', 'expectedRevision', 'expenseId'] }, output,
        async execute(args, execution) {
          const { signal, agent } = execution
          if (!agent) throw new Error('请在当前 iHome 主对话中记账。')
          try {
            const change = prepareExpenseChange(read(), args)
            if (!change.changed) return { status: 'unchanged', revision: change.next.revision, expenseId: change.expenseId }
            const id = 'apply-expense-change'
            const result = await ctx.userQuestions.ask({ agent, signal, questions: [{ id, header: '装修账本',
              question: '接受这项账目修改并保存吗？', detail: change.summary, options: [{ label: '接受' }, { label: '不接受' }] }] })
            signal.throwIfAborted()
            const [answer] = result.answers
            if (result.answers.length !== 1 || answer.id !== id || answer.custom?.trim() || answer.selected.length !== 1 || answer.selected[0] !== '接受')
              return { status: 'not_applied', message: '本次账目修改未保存。', ...(answer?.custom ? { feedback: answer.custom } : {}) }
            const saved = await table.update('home', current => {
              signal.throwIfAborted()
              if (current.revision !== change.next.revision) throw new ExpenseConflict('账本已有更新，请读取最新账本后重新确认。')
              return validateExpenseBoard({ ...change.next, revision: current.revision + 1 })
            })
            return { status: 'applied', revision: saved.revision, expenseId: change.expenseId, message: '已保存本次确认的账目。' }
          } catch (error) {
            if (error instanceof ExpenseConflict) return { status: 'conflict', message: error.message }
            throw error
          }
        },
      }))
      return async () => { for (const dispose of disposers.reverse()) await dispose(); await domain.close() }
    } catch (error) {
      for (const dispose of disposers.reverse()) await dispose()
      await domain.close()
      throw error
    }
  })
}
