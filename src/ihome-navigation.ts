import { modules, type ModuleId } from './modules.ts'
import { requestIHome } from './ihome-http.ts'
import type { IHomeWorkspace, IHomeModuleSession } from './ihome-workspace.ts'

export const workbenchKind = 'ihome-workbench'
interface Binding { sessionId: string }
interface SessionRow {
  cwd?: string
  parentId?: string
  origin?: string
  retainedBy?: Readonly<Record<string, number | undefined>>
}
export interface NavigationContext {
  layout: {
    beginNavigation(): AbortSignal
    panelInfo: { getSnapshot(): { activePanelId: string | null } }
    selectPanel(panelId: null): void
  }
  uiWorkspace: { openSession(sessionId: string): void }
  sidebarRight: { mounted: { getSnapshot(): string | undefined }, openTab(kind: string): void }
  workspaces: { list: { getSnapshot(): { phase: string, archivedSessionIds: readonly string[] } } }
  sessions: {
    list: { getSnapshot(): { ids: readonly string[], byId: Record<string, SessionRow | undefined> } }
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
  type WorkbenchState = {
    selectedModules: Record<string, ModuleId>, designEntries: Record<string, number>
  }
  let snapshot: WorkbenchState = { selectedModules: {}, designEntries: {} }
  let workspacePath: string | undefined
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
  function publish(next: WorkbenchState) {
    if (disposed) return
    snapshot = next
    listeners.forEach(listener => listener())
  }
  function initialize(): Promise<void> {
    return initialization ??= request<IHomeWorkspace>('workspace').then(workspace => {
      if (!workspace.selectedModules || !workspace.workspaceId || !workspace.path) throw new Error('iHome 工作区响应无效。')
      workspacePath = workspace.path
      publish({ ...snapshot, selectedModules: workspace.selectedModules })
    }).catch(error => { initialization = undefined; throw error })
  }
  // DSH keeps the mainView reference while a global panel covers the conversation.
  function currentSession(): string | undefined {
    // A displayed subagent can appear only in byId, outside the root history list.
    const { byId } = ctx.sessions.list.getSnapshot()
    return Object.keys(byId).find(id => (byId[id]?.retainedBy?.mainView ?? 0) > 0)
  }
  function available(sessionId: string): boolean {
    const workspaces = ctx.workspaces.list.getSnapshot()
    const list = ctx.sessions.list.getSnapshot()
    const row = list.byId[sessionId]
    return workspaces.phase === 'ready' && !workspaces.archivedSessionIds.includes(sessionId)
      && list.ids.includes(sessionId) && !!workspacePath && row?.cwd === workspacePath
      && !row.parentId && row.origin !== 'subagent'
  }
  function assertAvailable(sessionId: string) {
    if (!available(sessionId)) throw new Error('当前会话已归档、移除或不在 iHome工作区，请重新选择专家。')
  }
  return {
    initialize,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    dispose() { disposed = true; opening++; listeners.clear() },
    async openModule(moduleId: ModuleId, currentSessionId = currentSession()) {
      if (!modules.some(module => module.id === moduleId)) throw new Error('请选择一个 iHome 功能模块。')
      const revision = ++opening
      const navigation = ctx.layout.beginNavigation()
      await initialize()
      if (disposed || revision !== opening || navigation.aborted) return
      const result = await request<IHomeModuleSession>('module-session', { moduleId, currentSessionId })
      if (result.moduleId !== moduleId || !result.sessionId || result.path !== workspacePath) throw new Error('iHome 模块会话响应无效。')
      await ctx.sessions.refresh()
      if (disposed || revision !== opening || navigation.aborted) return
      // The owner can archive while the request is in flight. Never reveal that
      // response once the native workspace stream has marked its session archived.
      assertAvailable(result.sessionId)
      publish({ ...snapshot,
        selectedModules: { ...snapshot.selectedModules, [result.sessionId]: moduleId },
        designEntries: moduleId === 'design' ? { ...snapshot.designEntries, [result.sessionId]: revision } : snapshot.designEntries,
      })
      if (currentSession() !== result.sessionId) ctx.uiWorkspace.openSession(result.sessionId)
      else if (ctx.layout.panelInfo.getSnapshot().activePanelId !== null) ctx.layout.selectPanel(null)
      const surfaceNavigation = ctx.layout.beginNavigation()
      const deadline = Date.now() + 10000
      while (!disposed && revision === opening && !surfaceNavigation.aborted) {
        assertAvailable(result.sessionId)
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
      await initialize()
      assertAvailable(sessionId)
      const reference = ctx.sessions.retain(sessionId, { source: 'ihome' })
      try {
        const binding = await reference.ready
        if (disposed) return
        assertAvailable(sessionId)
        if (ctx.conversation.input.requestDraftInitialization(binding, { prompt, whenDraftExists: 'append' }) === 'blocked')
          throw new Error('当前会话暂时无法填写草稿，请稍后重试。')
      } finally { reference.release() }
    },
  }
}
