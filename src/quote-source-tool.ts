import { quoteDocumentInfo, type QuoteDocument } from './quote-documents.ts'
import { listQuoteSheets, openQuotePackage, readQuoteCells, readQuoteParagraphs } from './quote-ooxml.ts'
import type { DesignImageRef } from './design-reference-tool'
import type { IHomeToolContext } from './ihome-workspace-path'

export interface QuoteFileRef { attachmentId: string, name: string, bytes: number }
type Execution = IHomeToolContext & { signal: AbortSignal }
export interface QuoteOfficeRequest {
  extension: 'pdf' | 'docx' | 'xlsx'
  source: { key: string, version: string, bytes: number, read(signal: AbortSignal, maxBytes: number): Promise<{ bytes: Uint8Array, version: string }> }
  pages?: number[]
  sheet?: string
  range?: string
  dpi: number
  maxImages: number
  maxPixels: number
  maxDimension: number
  maxBytes: number
}
export interface QuoteOfficeResult {
  pageCount: number
  dpi: number
  missingFonts: readonly string[]
  images: readonly { png: Uint8Array, width: number, height: number, page?: number, sheet?: string, range?: string }[]
}
export interface QuoteSourceAccess {
  files(execution: Execution): readonly QuoteFileRef[]
  documents?(vendorId:string): readonly QuoteDocument[]
  read(ref: QuoteFileRef, signal: AbortSignal): Promise<Uint8Array>
  render?(request: QuoteOfficeRequest, signal: AbortSignal): Promise<QuoteOfficeResult>
  saveImage(input: { data: Uint8Array, mediaType: 'image/png' | 'image/jpeg', name: string }): Promise<DesignImageRef>
}

const maxDocument = 24 * 1024 * 1024
const maxText = 2 * 1024 * 1024
const textLimit = 16000
type Result = { description: string, images?: DesignImageRef[] }

function integer(value: unknown, label: string, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`${label}请填写 1 至 ${max} 的整数。`)
  return value
}
function allowed(args: Record<string, unknown>, fields: string[]) {
  const invalid = Object.keys(args).find(key => !['index', 'name', ...fields].includes(key))
  if (invalid) throw new Error(`当前格式不支持参数 ${invalid}。`)
}
function selectedRange(value: unknown): string {
  if (typeof value !== 'string') throw new Error('请提供表格 A1 区域。')
  const range = value.toUpperCase()
  const match = /^([A-Z]{1,3})([1-9]\d{0,6})(?::([A-Z]{1,3})([1-9]\d{0,6}))?$/.exec(range)
  const column = (code: string) => [...code].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0)
  if (!match) throw new Error('表格区域请用 A1:D20 这样的格式。')
  const left = column(match[1]), right = column(match[3] || match[1])
  const top = Number(match[2]), bottom = Number(match[4] || match[2])
  if (right < left || bottom < top || right > 16384 || bottom > 1048576 || right - left >= 28 || bottom - top >= 80) {
    throw new Error('单次区域最多 28 列、80 行，请选择工作表范围内的较小矩形。')
  }
  return range
}

async function readExact(access: QuoteSourceAccess, ref: QuoteFileRef, signal: AbortSignal, limit: number) {
  signal.throwIfAborted()
  if (!Number.isSafeInteger(ref.bytes) || ref.bytes < 0 || ref.bytes > limit) throw new Error('附件过大，请分拆后重新附上。')
  const bytes = await access.read(ref, signal)
  signal.throwIfAborted()
  if (bytes.byteLength !== ref.bytes) throw new Error('附件大小与原件不一致，请重新附上对应版本。')
  return bytes
}

function readText(bytes: Uint8Array, args: Record<string, unknown>, name: string): Result {
  const start = integer(args.startLine ?? 1, '起始行', maxText + 1)
  const count = integer(args.lineCount ?? 40, '读取行数', 100)
  const column = integer(args.startColumn ?? 1, '起始字符列', maxText + 1)
  const encoding = args.encoding ?? (bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8')
  if (typeof encoding !== 'string' || !['utf-8','utf-16le','utf-16be','gb18030'].includes(encoding)) throw new Error('文本编码无效。')
  let text: string
  try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes) }
  catch { throw new Error('文本编码与原件不匹配。中文旧表可用 encoding=gb18030，或将原件另存为 UTF-8。') }
  if (text.includes('\0')) throw new Error('文件未能识别为纯文本，请核对扩展名或文本编码。')
  const rows = text.split(/\r\n|\n|\r/)
  if (rows.length > 1 && rows.at(-1) === '') rows.pop()
  if (start > rows.length || column > rows[start - 1].length + 1) throw new Error('起始行或字符列超出原文。')
  const lines: { line: number, startColumn: number, text: string }[] = []
  let budget = textLimit
  let next: { startLine: number, startColumn?: number } | null = null
  for (let i = start - 1; i < Math.min(rows.length, start - 1 + count); i++) {
    const offset = i === start - 1 ? column - 1 : 0
    const chunk = rows[i].slice(offset, offset + budget)
    lines.push({ line: i + 1, startColumn: offset + 1, text: chunk })
    budget -= chunk.length
    if (offset + chunk.length < rows[i].length) { next = { startLine: i + 1, startColumn: offset + chunk.length + 1 }; break }
    next = i + 1 < rows.length ? { startLine: i + 2 } : null
    if (!budget) break
  }
  return { description: JSON.stringify({ file: name, encoding, totalLines: rows.length, lines, next }) }
}

export function createQuoteSourceTool(access: QuoteSourceAccess) {
  return {
    name: 'ihome_read_quote_source',
    description: '读取按公司归档或本轮附上的原件。传 vendorId 列此公司资料及各版本，指定 vendorId、documentId 读取该版本。PNG/JPEG 返回原图。空参数列本轮附件，再传 index（从1开始）或完整 name。TXT/CSV/TSV 返回带原行号的文本，按 next 续读；中文旧表可传 encoding=gb18030。PDF 用 page 逐页看图。DOCX 默认返回正文段落和表格位置，用 startParagraph、paragraphCount、next 续读。XLSX 不传 sheet 列表，指定 sheet、range（默认 A1:H25）读取单元格、原始值和公式缓存。DOCX/XLSX 可显式传 view=image 核对版式。按返回的文件名、行号、页码或区域引用原件。',
    parameters: { type: 'object', additionalProperties: false, properties: {
      index: { type: 'integer', minimum: 1 }, name: { type: 'string' }, vendorId: { type: 'string' }, documentId: { type: 'string' },
      startLine: { type: 'integer', minimum: 1 }, lineCount: { type: 'integer', minimum: 1, maximum: 100 }, startColumn: { type: 'integer', minimum: 1 },
      encoding: { type: 'string', enum: ['utf-8','utf-16le','utf-16be','gb18030'] }, page: { type: 'integer', minimum: 1 },
      sheet: { type: 'string' }, range: { type: 'string' }, view: { type: 'string', enum: ['text','image'] },
      startParagraph: { type: 'integer', minimum: 1 }, paragraphCount: { type: 'integer', minimum: 1, maximum: 80 },
    } },
    output: { schema: {}, render(_args: unknown, raw: unknown) {
      const result = raw as Result
      return [{ type: 'text' as const, text: result.description }, ...(result.images ?? []).map(attachment => ({ type: 'image' as const, attachment }))]
    } },
    async execute(raw: unknown, execution: Execution): Promise<Result> {
      const { signal } = execution
      signal.throwIfAborted()
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('请提供附件读取条件。')
      const args = raw as Record<string, unknown>
      if ('vendorId' in args || 'documentId' in args) {
        const { vendorId, documentId, ...options } = args
        if (typeof vendorId !== 'string' || !vendorId.trim() || !access.documents) throw new Error('请指定已登记公司的 vendorId。')
        const documents = access.documents(vendorId).filter(doc => doc.vendorId === vendorId)
        if (documentId === undefined && !Object.keys(options).length) {
          return { description:JSON.stringify({ vendorId, documents:documents.map(quoteDocumentInfo), hint:'指定 vendorId 和 documentId 读取所选版本。' }) }
        }
        if ('index' in options || 'name' in options) throw new Error('公司原件请按所属公司及资料版本编号读取。')
        const document = documents.find(doc => doc.id === documentId)
        if (!document) throw new Error('此公司没有指定的资料版本。')
        const result = await readSourceBody(access, document.file, options, signal)
        return { ...result, description:JSON.stringify({ ...JSON.parse(result.description), document:quoteDocumentInfo(document) }) }
      }
      const files = access.files(execution)
      if (!Object.keys(args).length) return { description: JSON.stringify({ files: files.map(({ name, bytes }, i) => ({ index: i + 1, name, bytes })),
        hint: files.length ? '传 index 或完整文件名选择附件。' : '请业主在本轮附上原件或粘贴原文。' }) }
      if (('index' in args) === ('name' in args)) throw new Error('请选择本轮附件的一个序号或完整文件名。')
      let file: QuoteFileRef
      if ('index' in args) file = files[integer(args.index, '附件序号', files.length) - 1]
      else {
        const matches = files.filter(item => item.name === args.name)
        if (matches.length !== 1) throw new Error('附件名重复或不在本轮，请从清单选择序号。')
        file = matches[0]
      }
      return readSourceBody(access, file, args, signal)
    },
  }
}

async function readSourceBody(access: QuoteSourceAccess, file: QuoteFileRef, args: Record<string,unknown>, signal: AbortSignal): Promise<Result> {
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') {
    allowed(args, ['view'])
    if (args.view !== undefined && args.view !== 'image') throw new Error('图纸原件请按图片查看。')
    const data = await readExact(access, file, signal, maxDocument)
    const image = await access.saveImage({ data, mediaType:ext === 'png' ? 'image/png' : 'image/jpeg', name:file.name })
    signal.throwIfAborted()
    return { description:JSON.stringify({ file:file.name, width:image.width, height:image.height }), images:[image] }
  }
  if (ext === 'txt' || ext === 'csv' || ext === 'tsv') {
    allowed(args, ['startLine', 'lineCount', 'startColumn', 'encoding'])
    return readText(await readExact(access, file, signal, maxText), args, file.name)
  }
  if (ext !== 'pdf' && ext !== 'docx' && ext !== 'xlsx') throw new Error('可读取 PNG、JPEG、TXT、CSV、TSV、PDF、DOCX、XLSX。其他原件可在公司资料中打开或下载。')
  if ('view' in args && args.view !== 'image' && args.view !== 'text') throw new Error('请选择 text 或 image 读取模式。')
  const textView = (args.view ?? (ext === 'pdf' ? 'image' : 'text')) === 'text'
  if (ext === 'pdf' && textView) throw new Error('PDF 按页读取，请使用 view=image。')
  allowed(args, ['view', ...(ext === 'xlsx' ? ['sheet','range'] : textView ? ['startParagraph','paragraphCount','startColumn'] : ['page'])])
  if (!Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > maxDocument) throw new Error('原件为空或超过 24 MiB，请分拆后附上。')
  const parts = async () => openQuotePackage(await readExact(access, file, signal, maxDocument), signal)
  if (ext === 'xlsx' && args.sheet === undefined) {
    if ('range' in args) throw new Error('请先指定区域所属的工作表。')
    const sheets = await listQuoteSheets(await parts())
    return { description: JSON.stringify({ file: file.name, sheets, hint: '指定 sheet 和 range 读取明细，如 A1:H25。' }) }
  }
  if (ext === 'xlsx' && (typeof args.sheet !== 'string' || !args.sheet.trim() || args.sheet.length > 31)) throw new Error('请选择有效的工作表名称。')
  if (textView) {
    const result = ext === 'xlsx'
      ? await readQuoteCells(await parts(), args.sheet as string, selectedRange(args.range ?? 'A1:H25'))
      : await readQuoteParagraphs(await parts(), integer(args.startParagraph ?? 1, '起始段落', 1000000), integer(args.paragraphCount ?? 30, '读取段落数', 80), integer(args.startColumn ?? 1, '起始字符列', 10 * 1024 * 1024))
    return { description: JSON.stringify({ file: file.name, ...result }) }
  }
  if (!access.render) throw new Error('当前宿主未加载 Office 渲染服务。可提供相应页截图，或另存为 CSV/TSV 后读取。')
  const selection = ext === 'xlsx' ? { sheet: args.sheet as string, range: selectedRange(args.range ?? 'A1:H25') } : { pages: [integer(args.page ?? 1, '页码', 1000000)] }
  const request: QuoteOfficeRequest = { extension: ext, source: {
    key: JSON.stringify(['ihome-quote-source', file.attachmentId, ext]), version: file.attachmentId, bytes: file.bytes,
    async read(readSignal, maxBytes) { return { bytes: await readExact(access, file, readSignal, Math.min(maxBytes, maxDocument)), version: file.attachmentId } },
  }, ...selection, dpi: 120, maxImages: ext === 'xlsx' ? 4 : 1, maxPixels: 5_000_000, maxDimension: 3000, maxBytes: 5_000_000 }
  let result: QuoteOfficeResult
  try { result = await access.render(request, signal) }
  catch (error) {
    signal.throwIfAborted()
    throw new Error('无法渲染指定页或区域，请核对页码、工作表名并缩小范围。' + (error instanceof Error ? ' ' + error.message : ''))
  }
  signal.throwIfAborted()
  const size = result.images.reduce((total, img) => total + img.png.byteLength, 0)
  if (!result.images.length || result.images.length > request.maxImages || size > request.maxBytes) throw new Error('渲染未返回有效大小的页面，请缩小范围。')
  const images: DesignImageRef[] = []
  for (const [i, image] of result.images.entries()) {
    if (!image.png.byteLength || image.width <= 0 || image.height <= 0 || image.width > request.maxDimension || image.height > request.maxDimension || image.width * image.height > request.maxPixels) throw new Error('渲染图片尺寸无效，请缩小范围。')
    images.push(await access.saveImage({ data: image.png, mediaType: 'image/png', name: file.name + '-' + (i + 1) + '.png' }))
    signal.throwIfAborted()
  }
  return { description: JSON.stringify({ file: file.name, pageCount: result.pageCount, dpi: result.dpi, missingFonts: result.missingFonts,
    locations: result.images.map(({page,sheet,range}) => ({page,sheet,range})) }), images }
}
