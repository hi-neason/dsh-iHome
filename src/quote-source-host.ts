import type { ArchiveHostContext } from './archive-host'
import { allowedExpertTools, currentUserAttachments } from './expert-dispatch.ts'
import type { DesignReferenceAccess } from './design-reference-tool'
import type { IHomeToolContext } from './ihome-workspace-path'
import { canRenderMacQuotePdf, renderMacQuotePdf } from './quote-pdf-macos'
import { createQuoteSourceTool, type QuoteFileRef, type QuoteOfficeRequest, type QuoteOfficeResult } from './quote-source-tool.ts'

export interface QuoteSourceHost {
  get(name: 'officeKit'): { renderImages(request: QuoteOfficeRequest, signal: AbortSignal): Promise<QuoteOfficeResult> } | undefined
  attachments: ArchiveHostContext['attachments'] & Pick<DesignReferenceAccess, 'saveImage'>
  tools: { register(tool: ReturnType<typeof createQuoteSourceTool>, options: { when(context: IHomeToolContext): boolean }): () => void | Promise<void> }
  effect(setup: () => () => void | Promise<void>): unknown
}

export function mountQuoteSources(ctx: QuoteSourceHost): void {
  const tool = createQuoteSourceTool({
    files(execution) {
      return execution.agent ? currentUserAttachments(execution.agent).flatMap(block => {
        if (block.type !== 'file' || !block.attachment || typeof block.attachment !== 'object') return []
        const ref = block.attachment as Partial<QuoteFileRef>
        if (typeof ref.attachmentId !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(ref.attachmentId) ||
          typeof ref.name !== 'string' || typeof ref.bytes !== 'number' || !Number.isSafeInteger(ref.bytes) || ref.bytes < 0) return []
        return [{ attachmentId: ref.attachmentId, name: ref.name, bytes: ref.bytes }]
      }) : []
    },
    async read(file, signal) {
      signal.throwIfAborted()
      const data = new Uint8Array(file.bytes)
      let length = 0
      for await (const chunk of ctx.attachments.readFileStream(file, signal)) {
        signal.throwIfAborted()
        if (length + chunk.length > data.length) throw new Error('附件大小与上传记录不符。')
        data.set(chunk, length)
        length += chunk.length
      }
      if (length !== file.bytes) throw new Error('附件读取不完整。')
      return data
    },
    render(request, signal) {
      if (canRenderMacQuotePdf(request.extension)) return renderMacQuotePdf(request, signal)
      const kit = ctx.get('officeKit')
      if (!kit) throw new Error('当前 DSH 未加载 Office 文档服务，可以提供页图或粘贴报价表格。')
      return kit.renderImages(request, AbortSignal.any([signal, AbortSignal.timeout(60_000)]))
    },
    saveImage: input => ctx.attachments.saveImage(input),
  })
  const permitted = (context: IHomeToolContext) => allowedExpertTools(context).has(tool.name)
  ctx.effect(() => ctx.tools.register({ ...tool, async execute(args, execution) {
    execution.signal.throwIfAborted()
    if (!permitted(execution)) throw new Error('当前工作区或专家没有读取选商原件的权限。')
    return tool.execute(args, execution)
  } }, { when: permitted }))
}
