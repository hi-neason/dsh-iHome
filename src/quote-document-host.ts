import type { ArchiveHostContext } from './archive-host'
import type { QuoteFileRef } from './quote-source-tool'
import type { QuoteTable } from './quote-host'
import { documentVersionKey, maxQuoteDocumentBytes, parseQuoteDocument, parseQuoteDocumentMeta, type QuoteDocumentMeta } from './quote-documents.ts'
import { QuoteConflict, type QuoteBoard } from './quote-model.ts'

export type QuoteDocumentStore = ArchiveHostContext['attachments'] & { fileHostPath(file: QuoteFileRef): string | undefined }
type DocumentHost = Pick<ArchiveHostContext,'connection'> & { attachments: QuoteDocumentStore }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control':'no-store' } })

export async function quoteFileBytes(attachments: Pick<QuoteDocumentStore,'readFileStream'>, file: QuoteFileRef, signal: AbortSignal) {
  if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > maxQuoteDocumentBytes) throw new Error('附件超过读取上限。')
  signal.throwIfAborted()
  const data = new Uint8Array(file.bytes)
  let length = 0
  for await (const chunk of attachments.readFileStream(file, signal)) {
    signal.throwIfAborted()
    if (length + chunk.length > data.length) throw new Error('附件大小与上传记录不符。')
    data.set(chunk, length)
    length += chunk.length
  }
  if (length !== file.bytes) throw new Error('附件读取不完整。')
  return data
}
function checkUpload(board: QuoteBoard, meta: QuoteDocumentMeta) {
  if (!board.vendors.some(vendor => vendor.id === meta.vendorId)) throw new Error('请先登记所属公司。')
  const key = documentVersionKey(meta)
  if (board.documents.some(doc => doc.id === meta.id ? documentVersionKey(doc) !== key : documentVersionKey(doc) === key)) {
    throw new QuoteConflict('该资料编号或版本已存在，新原件请使用新的资料版本。')
  }
}
export function registerQuoteDocuments(ctx: DocumentHost, table: QuoteTable, read: () => QuoteBoard) {
  return ctx.connection.fetch.register({ path:'/api/ihome/quote-documents', methods:['GET','POST','PATCH'], requestBody:'buffered',
    async fetch(request) {
      try {
        const { signal } = request, params = new URL(request.url).searchParams
        signal.throwIfAborted()
        if (request.method === 'PATCH') {
          const { expectedRevision, inactive } = await request.json()
          if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || typeof inactive !== 'boolean')
            throw new Error('请指定资料状态和已读取的档案版本。')
          const board = await table.update('home', current => {
            signal.throwIfAborted()
            const doc = current.documents.find(d => d.id === params.get('id') && d.vendorId === params.get('vendorId'))
            if (!doc) throw new Error('此公司没有这份资料版本。')
            if (Boolean(doc.inactive) === inactive) return current
            if (expectedRevision !== current.revision) throw new QuoteConflict('档案已有更新，请重新载入后再修改资料状态。')
            const next = parseQuoteDocument({ ...doc, inactive })
            return { ...current, revision: current.revision + 1, documents: current.documents.map(d => d.id === doc.id ? next : d) }
          })
          return json(board)
        }
        if (request.method === 'POST') {
          const meta = parseQuoteDocumentMeta({ id:params.get('id'), vendorId:params.get('vendorId'), kind:params.get('kind'), title:params.get('title'), version:params.get('version') })
          checkUpload(read(), meta)
          const name = params.get('name')
          if (!name || !name.trim() || name.length > 255 || /[/\\\u0000-\u001f]/u.test(name) || ['.','..'].includes(name)) throw new Error('上传文件名无效。')
          if (Number(request.headers.get('content-length')) > maxQuoteDocumentBytes) return json({error:'单份原件超过 24 MiB。'}, 413)
          const data = new Uint8Array(await request.arrayBuffer())
          if (!data.length) throw new Error('请上传有内容的原件。')
          if (data.length > maxQuoteDocumentBytes) return json({error:'单份原件超过 24 MiB。'}, 413)
          signal.throwIfAborted()
          const file = await ctx.attachments.saveFile({ data, name })
          const doc = parseQuoteDocument({ ...meta, file, uploadedAt:new Date().toISOString() })
          const board = await table.update('home', current => {
            signal.throwIfAborted()
            checkUpload(current, meta)
            const prior = current.documents.find(item => item.id === meta.id)
            if (prior) {
              if (prior.file.attachmentId === file.attachmentId && prior.file.name === file.name && prior.file.bytes === file.bytes) return current
              throw new QuoteConflict('此记录已保存其他原件，请另存新版本。')
            }
            return { ...current, revision:current.revision + 1, documents:[...current.documents, doc] }
          })
          return json(board)
        }
        if (request.method !== 'GET') return json({error:'请求方法无效。'}, 405)
        const doc = read().documents.find(item => item.vendorId === params.get('vendorId') && item.id === params.get('id'))
        if (!doc) return json({error:'此公司没有这份资料版本。'}, 404)
        if (params.get('preview') === '1') {
          const path = ctx.attachments.fileHostPath(doc.file)
          return path ? json({ path }) : json({error:'当前宿主无法打开预览，可下载原件查看。'}, 422)
        }
        return new Response(await quoteFileBytes(ctx.attachments, doc.file, signal), { headers:{
          'content-type':'application/octet-stream', 'cache-control':'no-store', 'x-content-type-options':'nosniff',
          'content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(doc.file.name),
        } })
      } catch (error) { return json({ error:error instanceof Error ? error.message : '公司原件处理失败。' }, error instanceof QuoteConflict ? 409 : 400) }
    },
  })
}
