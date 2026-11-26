import {
  agentPresets, defaultPresetPreferences, parsePresetPreferences, presetDefinition, presetSettingsView,
  type AgentPresetPreferences, type AgentPresetSettingsView,
} from './agent-presets'
import type { ArchiveHostContext } from './archive-host'

interface SettingsTable {
  get(id: string): AgentPresetPreferences | undefined
  put(id: string, value: AgentPresetPreferences): Promise<void>
  update(id: string, transform: (current: AgentPresetPreferences) => AgentPresetPreferences): Promise<AgentPresetPreferences>
}

export interface IHomeAgentSettingsService {
  get(id: string): AgentPresetSettingsView
  subscribe(listener: () => void): () => void
}

export interface AgentSettingsHostContext extends Pick<ArchiveHostContext, 'connection' | 'effect'> {
  provide(name: 'ihomeAgentSettings', service: IHomeAgentSettingsService): () => void
  storageDomain: { open(spec: {
    name: string, version: number,
    tables: { presets: { valueSchema: { parse(value: unknown): AgentPresetPreferences } } }
  }): Promise<{ table(name: 'presets'): SettingsTable, close(): Promise<void> }> }
}

class SettingsConflict extends Error {}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
}

export async function mountAgentSettings(ctx: AgentSettingsHostContext): Promise<void> {
  await ctx.effect(async () => {
    const domain = await ctx.storageDomain.open({ name: 'ihome_agent_settings', version: 1,
      tables: { presets: { valueSchema: { parse: parsePresetPreferences } } } })
    const disposers: (() => void | Promise<void>)[] = []
    const listeners = new Set<() => void>()
    let active = true
    try {
      const table = domain.table('presets')
      for (const preset of agentPresets) {
        if (!table.get(preset.id)) await table.put(preset.id, defaultPresetPreferences(preset.id))
      }
      const service: IHomeAgentSettingsService = {
        get(id) {
          if (!active) throw new Error('iHome 专家设置已关闭。')
          const settings = table.get(presetDefinition(id).id)
          if (!settings) throw new Error('专家设置尚未初始化。')
          return presetSettingsView(id, settings)
        },
        subscribe(listener) {
          if (!active) throw new Error('iHome 专家设置已关闭。')
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      }
      disposers.push(ctx.provide('ihomeAgentSettings', service))
      disposers.push(ctx.connection.fetch.register({ path: '/api/ihome/agent-settings', methods: ['GET', 'PUT'], requestBody: 'buffered',
        async fetch(request) {
          try {
            request.signal.throwIfAborted()
            if (request.method === 'GET') return json({ presets: agentPresets.map(preset => service.get(preset.id)) })
            if (request.method !== 'PUT') return json({ error: '请求方法无效。' }, 405)
            const body: unknown = await request.json()
            if (!body || typeof body !== 'object' || !('id' in body) || typeof body.id !== 'string') throw new Error('缺少专家名称。')
            const raw = body as Record<string, unknown>
            const preset = presetDefinition(body.id)
            if ('reset' in raw && raw.reset !== true) throw new Error('恢复默认请求无效。')
            const incoming = parsePresetPreferences(raw.reset === true
              ? { ...defaultPresetPreferences(preset.id), revision: raw.revision } : raw)
            if (incoming.enabledSkills.some(id => !preset.skills.some(skill => skill.id === id))) throw new Error('所选技能不属于这个专家。')
            const saved = await table.update(preset.id, current => {
              request.signal.throwIfAborted()
              if (!active) throw new Error('iHome 专家设置已关闭。')
              if (current.revision !== incoming.revision) throw new SettingsConflict('专家设置已更新，请重新载入后再保存。')
              return parsePresetPreferences({ ...incoming, revision: current.revision + 1 })
            })
            // Observers refresh runtime caches. A failed observer must not turn a
            // committed configuration write into an apparent failed save.
            for (const listener of listeners) {
              try { listener() } catch { /* Other observers still need the change. */ }
            }
            return json(presetSettingsView(preset.id, saved))
          } catch (error) {
            return json({ error: error instanceof Error ? error.message : '专家设置保存失败。' }, error instanceof SettingsConflict ? 409 : 400)
          }
        },
      }))
      return async () => {
        active = false
        for (const dispose of disposers.reverse()) await dispose()
        listeners.clear()
        await domain.close()
      }
    } catch (error) {
      active = false
      for (const dispose of disposers.reverse()) await dispose()
      listeners.clear()
      await domain.close()
      throw error
    }
  })
}
