import { requestIHome } from './ihome-http.ts'
import { parseQuoteBoard, type QuoteBoard } from './quote-model.ts'
import type { QuoteDocumentMeta } from './quote-documents'

export async function uploadQuoteDocument(meta: QuoteDocumentMeta, file: File, signal?: AbortSignal): Promise<QuoteBoard> {
  const query = new URLSearchParams({ ...meta, name: file.name })
  const response = await requestIHome('quote-documents?' + query, { method:'POST', body:file, headers:{ 'content-type':'application/octet-stream' }, signal })
  return parseQuoteBoard(await response.json())
}
export async function downloadQuoteDocument(vendorId: string, id: string, signal?: AbortSignal): Promise<Blob> {
  return (await requestIHome('quote-documents?' + new URLSearchParams({ vendorId, id }), { signal })).blob()
}
export async function quoteDocumentPreviewAddress(vendorId: string, id: string, sessionId: string, signal?: AbortSignal): Promise<string> {
  const query = new URLSearchParams({ vendorId, id, preview:'1' })
  const { path } = await (await requestIHome('quote-documents?' + query, { signal })).json()
  signal?.throwIfAborted()
  if (typeof path !== 'string' || !path) throw new Error('无法取得此版本资料的预览地址。')
  const segment = (value:string) => encodeURIComponent(value).replace(/%3A/g, ':')
  return 'dsh-resource://file/session/' + segment(sessionId) + '/' + path.replaceAll('\\', '/').split('/').map(segment).join('/')
}
