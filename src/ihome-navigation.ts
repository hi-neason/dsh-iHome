import { modules, type ModuleId } from './modules.ts'
import { requestIHome } from './ihome-http.ts'
import type { IHomeWorkspace, IHomeModuleSession } from './ihome-workspace.ts'

export const workbenchKind = 'ihome-workbench'
interface Binding { sessionId: string }
export interface NavigationContext {
  layout: { beginNavigation(): AbortSignal }
  uiWorkspace: { openSession(sessionId: string): void }
  sidebarRight: { mounted: { getSnapshot(): string | undefined }, openTab(kind: string): void }
  sessions: {
    refresh(): Promise<void>
    retain(sessionId: string, options: { source: string }): {
      ready: Promise<Binding>, release(): void
    }
  }
  conversation: { input: { requestDraftInitialization(binding: Binding, options: {
    prompt: string, whenDraftExists: 'append'
  }): string } }
}

export function createIHomeNavigation(ctx: NavigationContext) {
  type SessionIndex = Pick<IHomeWorkspace, 'moduleSessions' | 'previousModuleSessions'> & {
    selectedModules: Record<string, ModuleId>, designEntries: Record<string, number>
  }
  let snapshot: SessionIndex = { moduleSessions: {}, previousModuleSessions: {}, selectedModules: {}, designEntries: {} }
  const listeners = new Set<() => void>()
  let initialization: Promise<void> | undefined
  let disposed = false
  let opening = 0
  async function request<T>(path: string, body?: object): Promise<T> {
    const response = await requestIHome(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
    })
    return response.json() as Promise<T>
  }
  function publish(next: SessionIndex) {
    if (disposed) return
    snapshot = next
    listeners.forEach(listener => listener())
  }
  function initialize(): Promise<void> {
    return initialization ??= request<IHomeWorkspace>('workspace').then(workspace => {
      if (!workspace.moduleSessions || !workspace.workspaceId) throw new Error('iHome 工作区响应无效。')
      publish({ ...snapshot, moduleSessions: workspace.moduleSessions, previousModuleSessions: workspace.previousModuleSessions ?? {} })
    }).catch(error => { initialization = undefined; throw error })
  }
  return {
    initialize,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    dispose() { disposed = true; opening++; listeners.clear() },
    async openModule(moduleId: ModuleId, previousSessionId?: string) {
      if (!modules.some(module => module.id === moduleId)) throw new Error('请选择一个 iHome 功能模块。')
      const revision = ++opening
      const navigation = ctx.layout.beginNavigation()
      await initialize()
      const result = await request<IHomeModuleSession>('module-session', { moduleId, previousSessionId })
      if (result.moduleId !== moduleId || !result.sessionId) throw new Error('iHome 模块会话响应无效。')
      publish({ ...snapshot,
        moduleSessions: result.moduleSessions ?? { ...snapshot.moduleSessions, [moduleId]: result.activeSessionId ?? result.sessionId },
        previousModuleSessions: result.previousModuleSessions ?? { ...snapshot.previousModuleSessions, [moduleId]: result.previousSessionIds ?? [] } })
      await ctx.sessions.refresh()
      if (disposed || revision !== opening || navigation.aborted) return
      publish({ ...snapshot,
        selectedModules: { ...snapshot.selectedModules, [result.sessionId]: moduleId },
        designEntries: moduleId === 'design' ? { ...snapshot.designEntries, [result.sessionId]: revision } : snapshot.designEntries,
      })
      ctx.uiWorkspace.openSession(result.sessionId)
      // openSession selects the native chat panel and ends the preceding navigation.
      const surfaceNavigation = ctx.layout.beginNavigation()
      const deadline = Date.now() + 10000
      while (!disposed && revision === opening && !surfaceNavigation.aborted) {
        if (ctx.sidebarRight.mounted.getSnapshot() === result.sessionId) {
          try { ctx.sidebarRight.openTab(workbenchKind); return } catch (error) {
            // React adopts the session surface just after the mounted observable changes.
            if (!(error instanceof Error) || !error.message.includes('no session surface is mounted')) throw error
          }
        }
        if (Date.now() >= deadline) throw new Error('会话已打开，但工作台尚未就绪，请重新点击模块。')
        await new Promise(resolve => setTimeout(resolve, 16))
      }
    },
    async prepareDraft(sessionId: string, prompt: string) {
      if (!Object.values(snapshot.moduleSessions).includes(sessionId) && !Object.values(snapshot.previousModuleSessions).some(ids => ids.includes(sessionId)))
        throw new Error('请先选择一个 iHome 模块。')
      const reference = ctx.sessions.retain(sessionId, { source: 'ihome' })
      try {
        const binding = await reference.ready
        if (disposed) return
        if (ctx.conversation.input.requestDraftInitialization(binding, { prompt, whenDraftExists: 'append' }) === 'blocked')
          throw new Error('当前会话暂时无法填写草稿，请稍后重试。')
      } finally { reference.release() }
    },
  }
}
