import { useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import dialogCss from './archive-dialog.css'

export function ArchiveDialog({ title, busy, onDismiss, children }: {
  title: string, busy?: boolean, onDismiss: () => void, children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useLayoutEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    dialog.querySelector<HTMLElement>('input:enabled, textarea:enabled, select:enabled')?.focus()
    return () => dialog.close()
  }, [])

  return <dialog ref={ref} className="ih-archive-dialog" aria-labelledby={titleId}
    onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation() }}
    onCancel={event => { event.preventDefault(); if (!busy) onDismiss() }}>
    <style>{dialogCss}</style>
    <header className="ih-archive-dialog-heading">
      <h2 id={titleId}>{title}</h2>
      <button type="button" className="ih-dialog-close" aria-label="关闭弹窗" disabled={busy} onClick={onDismiss}>×</button>
    </header>
    {children}
  </dialog>
}
