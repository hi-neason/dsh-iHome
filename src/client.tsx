import { useEffect, useState, useSyncExternalStore, type ComponentType } from 'react'
import { Home } from './Home'
import { ModuleWorkbench } from './ModuleWorkbench'
import { createArchiveService } from './archive-client'
import { createTaskService } from './task-client'
import { createIHomeNavigation, workbenchKind, type NavigationContext } from './ihome-navigation'
import { AgentSettings } from './AgentSettings'
import { mountExpertSlash, type ExpertSlashContext } from './expert-slash-client'

type PanelSlot =
  | { name: 'main', key: string }
  | { name: 'sidebar.panellist', id: string, label: string }
  | { name: 'sidebar.right.pane.tab', key: string }
  | { name: 'settings.section', id: string, order: number, label: string }
  | { name: 'settings.section.icon', id: string }
interface ClientContext extends NavigationContext {
  sessions: NavigationContext['sessions'] & ExpertSlashContext['sessions']
  inputTriggers: ExpertSlashContext['inputTriggers']
  locale: ExpertSlashContext['locale']
  effect(setup: () => () => void): unknown
  sidebarRightTabs: { register(definition: {
    id: string, kind: string, title: () => string,
    guide: { id: string, order: number, title: () => string, icon: ComponentType<{ size?: number }> }[]
  }): () => void }
  slots: {
    inject(name: PanelSlot['name'], setup: () => () => void): unknown
    register<P>(slot: PanelSlot, component: ComponentType<P>): () => void
  }
}

const panelId = 'ihome'
const workbenchId = 'dsh-ihome-workbench'
export const inject = ['slots', 'layout', 'uiWorkspace', 'sidebarRight', 'sidebarRightTabs', 'sessions', 'workspaces', 'conversation', 'inputTriggers', 'locale']

function IHomeIcon({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" focusable="false">
    <path d="M2 11 12 3l10 8" /><path d="M5 8.6V20h5v-6h4v6h5V8.6" />
  </svg>
}

export function apply(ctx: ClientContext): void {
  mountExpertSlash(ctx)
  const archiveService = createArchiveService()
  const taskService = createTaskService()
  const navigation = createIHomeNavigation(ctx)
  ctx.effect(() => () => navigation.dispose())
  function useWorkspace() {
    const [error, setError] = useState('')
    const snapshot = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot)
    useEffect(() => {
      let active = true
      void navigation.initialize().catch(error => { if (active) setError(String(error.message ?? error)) })
      return () => { active = false }
    }, [])
    return { snapshot, error, setError }
  }
  function IHomePanel() {
    const { error } = useWorkspace()
    return <>{error && <p role="alert">{error}</p>}<Home onOpenModule={navigation.openModule} /></>
  }
  function IHomeWorkbench({ sessionId }: { sessionId: string }) {
    const { snapshot, error, setError } = useWorkspace()
    const id = snapshot.selectedModules[sessionId] ?? null
    const workbenchKey = id === 'design' ? sessionId + ':design:' + (snapshot.designEntries[sessionId] ?? 0) : sessionId + ':' + id
    return <>{error && <p role="alert">{error}</p>}
      <ModuleWorkbench key={workbenchKey} id={id} archiveService={archiveService} taskService={taskService}
        onOpenModule={next => navigation.openModule(next, sessionId)} onAsk={prompt => {
          setError('')
          void navigation.prepareDraft(sessionId, prompt).catch(error => setError(String(error.message ?? error)))
        }} />
    </>
  }
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: workbenchId, kind: workbenchKind, title: () => 'iHome工作台',
    guide: [{ id: workbenchKind, order: 35, title: () => 'iHome工作台', icon: IHomeIcon }],
  }))
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: panelId }, IHomePanel))
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register({ name: 'sidebar.panellist', id: panelId, label: 'iHome' }, IHomeIcon))
  ctx.slots.inject('sidebar.right.pane.tab', () =>
    ctx.slots.register({ name: 'sidebar.right.pane.tab', key: workbenchId }, IHomeWorkbench))
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register({ name: 'settings.section', id: 'ihome', order: 50, label: 'iHome' }, AgentSettings))
  ctx.slots.inject('settings.section.icon', () =>
    ctx.slots.register({ name: 'settings.section.icon', id: 'ihome' }, IHomeIcon))
}
