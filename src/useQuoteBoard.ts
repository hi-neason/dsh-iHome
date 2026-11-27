import { useCallback, useEffect, useRef, useState } from 'react'
import { requestIHome } from './ihome-http'
import { parseQuoteBoard, type QuoteBoard, type QuoteCollection } from './quote-model'

export function useQuoteBoard() {
  const containerRef = useRef<HTMLDivElement>(null)
  const current = useRef<QuoteBoard>()
  const read = useRef<AbortController>()
  const lifetime = useRef<AbortController>()
  const saving = useRef(false)
  const [board, setBoard] = useState<QuoteBoard>()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const accept = useCallback((next: QuoteBoard) => {
    if (current.current && current.current.revision >= next.revision) return
    current.current = next
    setBoard(next)
  }, [])

  const refresh = useCallback(async (manual: boolean) => {
    if (lifetime.current?.signal.aborted !== false || saving.current) return
    const editing = () => !!containerRef.current?.querySelector('form:not([data-quote-pristine]), [data-quote-draft]')
    if (current.current && editing()) {
      if (manual) setNotice('草稿已保留，结束编辑后可重新载入。')
      return
    }
    if (!manual && (document.hidden || read.current)) return
    read.current?.abort()
    const controller = new AbortController()
    read.current = controller
    const revision = current.current?.revision
    const path = !manual && revision !== undefined ? 'quotes?revision=' + revision : 'quotes'
    try {
      const response = await requestIHome(path, { signal: controller.signal })
      if (response.status === 204) return
      const next = parseQuoteBoard(await response.json())
      if (!controller.signal.aborted && !editing()) {
        accept(next)
        setError('')
        if (manual) setNotice('')
      }
    } catch (cause) {
      if (!controller.signal.aborted && (manual || !current.current))
        setError(cause instanceof Error ? cause.message : '选商档案读取失败。')
    } finally {
      if (read.current === controller) read.current = undefined
    }
  }, [accept])

  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    void refresh(true)
    const check = () => { void refresh(false) }
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    const timer = window.setInterval(check, 5000)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
      read.current?.abort()
      read.current = undefined
      controller.abort()
    }
  }, [refresh])

  async function save(collection: QuoteCollection, record: unknown) {
    // Bind the write to the revision visible to this render and its open form.
    const signal = lifetime.current?.signal
    if (!board || !signal || signal.aborted) throw new Error('选商档案尚未就绪。')
    if (saving.current) throw new Error('正在保存，请稍候。')
    saving.current = true
    read.current?.abort()
    read.current = undefined
    setError('')
    setNotice('')
    try {
      const response = await requestIHome('quotes', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedRevision: board.revision, collection, record }), signal })
      const next = parseQuoteBoard(await response.json())
      signal.throwIfAborted()
      accept(next)
      setNotice('已保存到本机。')
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : '选商档案保存失败。')
      throw cause
    } finally {
      saving.current = false
    }
  }

  return { containerRef, board, error, notice, setNotice, save, reload: () => refresh(true) }
}
