import type { QuoteFileRef } from './quote-source-tool'

export const quoteDocumentKinds = { design: '设计图', quote: '报价单', contract: '合同', other: '其他资料' } as const
export type QuoteDocumentKind = keyof typeof quoteDocumentKinds
export interface QuoteDocumentMeta { id: string, vendorId: string, kind: QuoteDocumentKind, title: string, version: string }
export interface QuoteDocument extends QuoteDocumentMeta { uploadedAt: string, file: QuoteFileRef, inactive?: boolean }
export const maxQuoteDocumentBytes = 24 * 1024 * 1024

function text(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/u.test(value)) throw new Error(name + '无效。')
  return value.trim()
}
export function parseQuoteDocumentMeta(raw: Record<string, unknown>): QuoteDocumentMeta {
  if (typeof raw.kind !== 'string' || !Object.hasOwn(quoteDocumentKinds, raw.kind)) throw new Error('公司资料类型无效。')
  return { id: text(raw.id, '资料编号', 200), vendorId: text(raw.vendorId, '所属公司', 120), kind: raw.kind as QuoteDocumentKind,
    title: text(raw.title, '资料名称', 240), version: text(raw.version, '资料版本', 120) }
}
export function parseQuoteDocument(value: unknown): QuoteDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('公司资料格式无效。')
  const raw = value as Record<string, unknown>, file = raw.file as Partial<QuoteFileRef> | null
  if (!file || typeof file.attachmentId !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(file.attachmentId)
    || typeof file.bytes !== 'number' || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > maxQuoteDocumentBytes) throw new Error('公司资料附件无效。')
  const name = text(file.name, '原件文件名', 255)
  if (/[/\\]/.test(name) || name === '.' || name === '..') throw new Error('原件文件名无效。')
  const uploadedAt = text(raw.uploadedAt, '上传时间', 32)
  if (!Number.isFinite(Date.parse(uploadedAt)) || new Date(uploadedAt).toISOString() !== uploadedAt) throw new Error('资料上传时间无效。')
  if (raw.inactive !== undefined && typeof raw.inactive !== 'boolean') throw new Error('原件状态无效。')
  return { ...parseQuoteDocumentMeta(raw), ...(raw.inactive ? { inactive: true } : {}), uploadedAt, file: { attachmentId:file.attachmentId, name, bytes:file.bytes } }
}
export function documentVersionKey(document: QuoteDocumentMeta) {
  return JSON.stringify([document.vendorId, document.kind, document.title, document.version])
}
export function quoteDocumentInfo({file, ...metadata}: QuoteDocument) {
  return { ...metadata, name: file.name, bytes: file.bytes }
}
