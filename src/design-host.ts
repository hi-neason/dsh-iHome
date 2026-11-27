import type { ArchiveHostContext } from './archive-host'
import { applyDesignCommand, createDesignState, DesignConflict, parseDesignCommand, hasUnmigratedDesignVersions, migrateDesignVersions, validateDesignState, type DesignState, type DesignCommand } from './design-model.ts'

interface DesignTable {
  get(id: string): DesignState | undefined
  put(id: string, value: DesignState): Promise<void>
  update(id: string, transform: (current: DesignState) => DesignState): Promise<DesignState>
}
export interface IHomeDesignsService {
  read(): DesignState
  change(command: DesignCommand, signal?: AbortSignal): Promise<DesignState>
}
export interface DesignHostContext extends Pick<ArchiveHostContext, 'connection' | 'effect'> {
  provide(name: 'ihomeDesigns', service: IHomeDesignsService): () => void
  storageDomain: {
    open(spec: { name: string, version: number, tables: { projects: { valueSchema: { parse(value: unknown): DesignState } } } }): Promise<{
      table(name: 'projects'): DesignTable
      close(): Promise<void>
    }>
  }
}
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
}

export async function mountDesigns(ctx: DesignHostContext): Promise<void> {
  await ctx.effect(async () => {
    const domain = await ctx.storageDomain.open({ name: 'ihome_designs', version: 1,
      tables: { projects: { valueSchema: { parse: validateDesignState } } } })
    const disposers: (() => void | Promise<void>)[] = []
    let active = true
    try {
      const table = domain.table('projects')
      if (!table.get('home')) await table.put('home', createDesignState())
      else {
        const prior = table.get('home')!
        if (hasUnmigratedDesignVersions(prior)) {
          await table.update('home', current => {
            const migrated = migrateDesignVersions(current)
            if (migrated.designs.length !== current.designs.length) migrated.revision++
            return migrated
          })
        }
      }
      function assertActive(): void {
        if (!active) throw new Error('户型设计服务已关闭。')
      }
      const service: IHomeDesignsService = {
        read() {
          assertActive()
          const state = table.get('home')
          if (!state) throw new Error('户型设计尚未初始化。')
          return validateDesignState(state)
        },
        async change(raw, signal) {
          assertActive()
          signal?.throwIfAborted()
          const command = parseDesignCommand(raw)
          const saved = await table.update('home', current => {
            assertActive()
            signal?.throwIfAborted()
            return applyDesignCommand(current, command)
          })
          return validateDesignState(saved)
        },
      }
      disposers.push(ctx.provide('ihomeDesigns', service))
      disposers.push(ctx.connection.fetch.register({ path: '/api/ihome/designs', methods: ['GET', 'POST'], requestBody: 'buffered',
        async fetch(request) {
          try {
            request.signal.throwIfAborted()
            if (request.method === 'GET') return json(service.read())
            if (request.method !== 'POST') return json({ error: '请求方法无效。' }, 405)
            const command = parseDesignCommand(await request.json())
            return json(await service.change(command, request.signal))
          } catch (error) {
            return json({ error: error instanceof Error ? error.message : '户型设计保存失败。' }, error instanceof DesignConflict ? 409 : 400)
          }
        },
      }))
      return async () => {
        active = false
        for (const dispose of disposers.reverse()) await dispose()
        await domain.close()
      }
    } catch (error) {
      active = false
      for (const dispose of disposers.reverse()) await dispose()
      await domain.close()
      throw error
    }
  })
}
