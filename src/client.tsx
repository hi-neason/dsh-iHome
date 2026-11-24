import type { ComponentType } from 'react'
import { Home } from './Home'

// The two desktop slots that expose a selectable main panel.
type PanelSlot =
  | { name: 'main', key: string }
  | { name: 'sidebar.panellist', id: string, label: string }

interface ClientContext {
  uiWorkspace: {
    startSession(workspaceId: undefined, options: { prompt: string, whenDraftExists: 'append' }): void
  }
  slots: {
    inject(name: PanelSlot['name'], setup: () => () => void): unknown
    register(slot: PanelSlot, component: ComponentType): () => void
  }
}

const panelId = 'ihome'
export const inject = ['slots', 'uiWorkspace']

function IHomeIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false">
      <path d="M2 11 12 3l10 8" />
      <path d="M5 8.6V20h5v-6h4v6h5V8.6" />
    </svg>
  )
}

export function apply({ slots, uiWorkspace }: ClientContext): void {
  function IHomePanel() {
    return <Home onAsk={prompt => uiWorkspace.startSession(undefined, { prompt, whenDraftExists: 'append' })} />
  }

  slots.inject('main', () =>
    slots.register({ name: 'main', key: panelId }, IHomePanel))
  slots.inject('sidebar.panellist', () =>
    slots.register({ name: 'sidebar.panellist', id: panelId, label: 'iHome' }, IHomeIcon))
}
