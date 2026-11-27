import type { ArchiveHostContext } from './archive-host'
import { registerQuoteDocuments } from './quote-document-host'
import { registerQuoteSources, type QuoteSourceHost } from './quote-source-host'
import { registerQuoteTools } from './quote-tools'
import { changeQuoteBoard, parseQuoteBoard, QuoteConflict, type QuoteBoard } from './quote-model'

export interface QuoteTable {
  get(key: string): QuoteBoard | undefined
  put(key: string, board: QuoteBoard): Promise<void>
  update(key: string, transform: (current: QuoteBoard) => QuoteBoard): Promise<QuoteBoard>
}
export interface QuoteHostContext extends Pick<ArchiveHostContext, 'effect' | 'connection' | 'tools' | 'userQuestions'> {
  storageDomain: { open(spec: {
    name: string, version: number, tables: { boards: { valueSchema: { parse(value: unknown): QuoteBoard } } }
  }): Promise<{ table(name: 'boards'): QuoteTable, close(): Promise<void> }> }
}

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } })

export async function mountQuotes(ctx: QuoteHostContext & QuoteSourceHost): Promise<void> {
  await ctx.effect(async () => {
    const domain = await ctx.storageDomain.open({ name: 'ihome_quotes', version: 1,
      tables: { boards: { valueSchema: { parse: parseQuoteBoard } } } })
    const disposers: (() => void | Promise<void>)[] = []
    try {
      const table = domain.table('boards')
      if (!table.get('home')) await table.put('home', parseQuoteBoard({ revision: 0, vendors: [] }))
      const read = () => {
        const board = table.get('home')
        if (!board) throw new Error('选商档案尚未初始化。')
        return board
      }
      const save = (change: unknown, signal: AbortSignal) => table.update('home', current => {
        signal.throwIfAborted()
        return changeQuoteBoard(current, change)
      })
      disposers.push(registerQuoteDocuments(ctx, table, read))
      disposers.push(ctx.connection.fetch.register({ path: '/api/ihome/quotes', methods: ['GET', 'POST'], requestBody: 'buffered',
        async fetch(request) {
          try {
            request.signal.throwIfAborted()
            if (request.method === 'GET') {
              const board = read()
              if (new URL(request.url).searchParams.get('revision') === String(board.revision))
                return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
              return json(board)
            }
            if (request.method !== 'POST') return json({ error: '请求方法无效。' }, 405)
            return json(await save(await request.json(), request.signal))
          } catch (error) {
            return json({ error: error instanceof Error ? error.message : '选商档案保存失败。' }, error instanceof QuoteConflict ? 409 : 400)
          }
        },
      }))
      registerQuoteTools(ctx, read, save, disposers)
      disposers.push(registerQuoteSources(ctx, read))
      return async () => { for (const dispose of disposers.reverse()) await dispose(); await domain.close() }
    } catch (error) {
      for (const dispose of disposers.reverse()) await dispose()
      await domain.close()
      throw error
    }
  })
}
