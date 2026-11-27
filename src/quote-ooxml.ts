// Read only selected package parts into memory. External relationships, DTDs and
// formula evaluation are outside the Office Open XML text reader.
export function openQuotePackage(zip: Uint8Array, signal: AbortSignal) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  const u16 = (offset: number) => view.getUint16(offset, true)
  const u32 = (offset: number) => view.getUint32(offset, true)
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let end = zip.length - 22
  while (end >= Math.max(0, zip.length - 65557)) {
    if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === zip.length) break
    end--
  }
  if (end < Math.max(0, zip.length - 65557) || u16(end + 4) || u16(end + 6)) throw new Error('无法读取 Office 文件目录，请核对文件格式。')
  const count = u16(end + 10), directory = u32(end + 16)
  if (count > 10000 || directory + u32(end + 12) !== end) throw new Error('Office 文件目录无效或超出读取上限。')
  const entries = new Map<string, number>()
  let pos = directory
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || u32(pos) !== 0x02014b50) throw new Error('Office 文件目录不完整。')
    const nameStart = pos + 46, nameEnd = nameStart + u16(pos + 28)
    if (nameEnd > end) throw new Error('Office 文件名越界。')
    const name = decoder.decode(zip.subarray(nameStart, nameEnd))
    if (entries.has(name)) throw new Error('Office 文件内含同名部件。')
    entries.set(name, pos)
    pos = nameEnd + u16(pos + 30) + u16(pos + 32)
  }
  let remaining = 20 * 1024 * 1024
  return async (path: string, limit: number): Promise<string> => {
    signal.throwIfAborted()
    const entry = entries.get(path)
    if (entry === undefined) throw new Error('Office 文件缺少部件 ' + path + '。')
    const size = u32(entry + 24), compressed = u32(entry + 20), method = u16(entry + 10), local = u32(entry + 42)
    if (size > Math.min(limit, remaining) || local + 30 > directory || u32(local) !== 0x04034b50 || u16(entry + 8) & 1) throw new Error('Office 部件过大、已加密或格式无效。')
    remaining -= size
    const start = local + 30 + u16(local + 26) + u16(local + 28)
    if (start + compressed > directory || (method !== 0 && method !== 8)) throw new Error('Office 部件压缩格式无效。')
    const packed = zip.slice(start, start + compressed)
    const stream = new Blob([packed]).stream()
    const reader = (method === 8 ? stream.pipeThrough(new DecompressionStream('deflate-raw')) : stream).getReader()
    const xmlBytes = new Uint8Array(size)
    let written = 0
    try {
      for (;;) {
        signal.throwIfAborted()
        const { value, done } = await reader.read()
        if (done) break
        if (written + value.length > size) throw new Error('Office 部件超出声明长度。')
        xmlBytes.set(value, written)
        written += value.length
      }
    } finally { await reader.cancel().catch(() => {}) }
    if (written !== size) throw new Error('Office 部件缺失。')
    const encoding = xmlBytes[0] === 255 && xmlBytes[1] === 254 ? 'utf-16le' : xmlBytes[0] === 254 && xmlBytes[1] === 255 ? 'utf-16be' : 'utf-8'
    return new TextDecoder(encoding, { fatal: true }).decode(xmlBytes)
  }
}
type ReadPart = ReturnType<typeof openQuotePackage>
const mib = 1024 * 1024

function decode(text: string) {
  return text.replace(/&([^;&\s<>]{1,24});/g, (_, token: string) => {
    const named: Record<string, string> = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'" }
    if (Object.hasOwn(named, token)) return named[token]
    if (/^#(?:x[\da-fA-F]+|\d+)$/.test(token)) {
      const code = token[1] === 'x' ? parseInt(token.slice(2), 16) : Number(token.slice(1))
      if (code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) return String.fromCodePoint(code)
    }
    throw new Error('Office XML 含不支持的实体。')
  })
}

interface XmlReader {
  open?(tag: string, attrs: Record<string,string>): void
  close?(tag: string): void
  text?(value: string, tag: string): void
}
function scan(xml: string, visit: XmlReader) {
  // Sticky matching prevents skipping malformed bytes. Only built-in/numeric
  // entities are decoded; declarations such as DOCTYPE are rejected.
  const tokens = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[\w:.-]+(?:[^<>"']|"[^"]*"|'[^']*')*>|[^<]+/gy
  const stack: string[] = []
  const local = (name: string) => name.slice(name.lastIndexOf(':') + 1)
  let offset = 0, total = 0
  while (offset < xml.length) {
    const token = tokens.exec(xml)?.[0]
    if (!token || ++total > 1_000_000 || stack.length > 128) throw new Error('Office XML 结构无效或超出复杂度上限。')
    offset = tokens.lastIndex
    if (token.startsWith('<?') || token.startsWith('<!--')) continue
    if (token.startsWith('<![CDATA[')) { visit.text?.(token.slice(9,-3), local(stack.at(-1) ?? '')); continue }
    if (token[0] !== '<') { visit.text?.(decode(token), local(stack.at(-1) ?? '')); continue }
    const name = /^<\/?([\w:.-]+)/.exec(token)![1], tag = local(name)
    if (token[1] === '/') {
      if (stack.pop() !== name) throw new Error('Office XML 标签不匹配。')
      visit.close?.(tag)
    } else {
      const attrs: Record<string,string> = Object.create(null)
      if (visit.open) for (const match of token.matchAll(/\s([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[match[1]] = decode(match[2] ?? match[3])
      visit.open?.(tag, attrs)
      if (token.endsWith('/>')) visit.close?.(tag)
      else stack.push(name)
    }
  }
  if (stack.length) throw new Error('Office XML 标签不完整。')
}

async function workbook(read: ReadPart) {
  const sheets: { name: string, id?: string }[] = []
  scan(await read('xl/workbook.xml', mib), { open(tag, attrs) {
    if (tag === 'sheet' && attrs.name) {
      const rel = Object.keys(attrs).find(key => key.endsWith(':id'))
      sheets.push({ name: attrs.name, id: rel && attrs[rel] })
      if (sheets.length > 1000) throw new Error('工作表数量超出上限。')
    }
  } })
  if (!sheets.length) throw new Error('工作簿中未找到工作表。')
  return sheets
}
export async function listQuoteSheets(read: ReadPart) { return (await workbook(read)).map(sheet => sheet.name) }

function partPath(target: string): string {
  if (!target || /[\\:#?]/.test(target) || target.startsWith('//')) throw new Error('工作表关联目标无效。')
  const parts: string[] = target.startsWith('/') ? [] : ['xl']
  for (const part of target.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') { if (!parts.length) throw new Error('工作表关联越界。'); parts.pop() }
    else parts.push(part)
  }
  return parts.join('/')
}
function coordinate(ref: string) {
  const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(ref)
  if (!match) throw new Error('工作表中出现无效的单元格地址。')
  return { col: [...match[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0), row: Number(match[2]) }
}
interface Cell {
  address: string, type: string, raw: string | null, value: string | null, style?: string,
  formula?: string, formulaType?: string, formulaIndex?: string, formulaRange?: string
}
export async function readQuoteCells(read: ReadPart, name: string, range: string) {
  const sheet = (await workbook(read)).find(sheet => sheet.name === name)
  if (!sheet?.id) throw new Error('工作表名称或关联无效，请先读取工作表目录。')
  let selected = '', shared = ''
  scan(await read('xl/_rels/workbook.xml.rels', mib), { open(tag, attrs) {
    if (tag !== 'Relationship' || attrs.TargetMode === 'External' || !attrs.Type) return
    if (attrs.Id === sheet.id && attrs.Type.endsWith('/worksheet')) selected = partPath(attrs.Target)
    if (attrs.Type.endsWith('/sharedStrings')) shared = partPath(attrs.Target)
  } })
  if (!selected) throw new Error('此工作表没有可读取的本地单元格。')
  const [from, to = from] = range.split(':'), start = coordinate(from), end = coordinate(to)
  const cells: Cell[] = []
  let cell: Cell | undefined, inInline = false, phonetic = false, row = 0, col = 0
  scan(await read(selected, 10*mib), {
    open(tag, attrs) {
      if (tag === 'row') { row = attrs.r === undefined ? row + 1 : Number(attrs.r); col = 0 }
      if (tag === 'c') {
        const pos = attrs.r ? coordinate(attrs.r) : { row, col: col + 1 }
        col = pos.col
        if (pos.row >= start.row && pos.row <= end.row && pos.col >= start.col && pos.col <= end.col) {
          if (cells.length >= 2240) throw new Error('所选区域包含过多单元格。')
          let address = attrs.r
          if (!address) {
            let letters = ''
            for (let number = col; number > 0; number = Math.floor((number - 1) / 26)) letters = String.fromCharCode(65 + (number - 1) % 26) + letters
            address = letters + row
          }
          cell = { address, type: attrs.t ?? 'n', raw: null, value: null, ...(attrs.s ? {style:attrs.s} : {}) }
        }
      } else if (cell && tag === 'f') {
        cell.formula = ''
        if (attrs.t) cell.formulaType = attrs.t
        if (attrs.si) cell.formulaIndex = attrs.si
        if (attrs.ref) cell.formulaRange = attrs.ref
      }
      if (tag === 'is') inInline = true
      if (tag === 'rPh') phonetic = true
    },
    text(value, tag) {
      if (!cell) return
      if (tag === 'v') cell.raw = (cell.raw ?? '') + value
      if (tag === 'f') cell.formula = (cell.formula ?? '') + value
      if (tag === 't' && inInline && !phonetic) cell.value = (cell.value ?? '') + value
    },
    close(tag) {
      if (tag === 'c' && cell) {
        if (cell.type !== 'inlineStr' && cell.type !== 's') cell.value = cell.raw
        cells.push(cell)
        cell = undefined
      }
      if (tag === 'is') inInline = false
      if (tag === 'rPh') phonetic = false
    },
  })
  const need = new Map<number, Cell[]>()
  for (const cell of cells) {
    if (cell.type !== 's' || cell.raw === null) continue
    if (!/^\d+$/.test(cell.raw)) throw new Error('单元格共享字符串索引无效。')
    const index = Number(cell.raw), group = need.get(index)
    if (group) group.push(cell)
    else need.set(index, [cell])
  }
  if (need.size) {
    let index = -1, text = '', collect = false, phonetic = false
    scan(await read(shared || 'xl/sharedStrings.xml', 6*mib), {
      open(tag) { if (tag === 'si') { index++; collect = need.has(index); text = '' } if (tag === 'rPh') phonetic = true },
      text(value, tag) { if (collect && tag === 't' && !phonetic) text += value },
      close(tag) { if (tag === 'si' && collect) { for (const cell of need.get(index)!) cell.value = text; need.delete(index); collect = false } if (tag === 'rPh') phonetic = false },
    })
    if (need.size) throw new Error('工作表引用的共享字符串缺失。')
  }
  let chars = 0
  for (const entry of cells) {
    chars += (entry.value?.length ?? 0) + (entry.raw?.length ?? 0) + (entry.formula?.length ?? 0)
    if (chars > 80000) throw new Error('所选区域文字过多，请缩小行列范围。')
  }
  return { sheet:name, range, cells, hint:'未列的单元格在此范围内为空。raw 为原始 v 值，含公式时为已有缓存；数值和日期序列按原文返回。' }
}

interface Paragraph { paragraph: number, table?: number, row?: number, cell?: number, text: string }
export async function readQuoteParagraphs(read: ReadPart, start: number, count: number, column: number) {
  const paragraphs: (Paragraph & { startColumn: number })[] = []
  const tables: {table: number,row: number,cell: number}[] = []
  const openParagraphs: Paragraph[] = []
  let total = 0, tableIndex = 0, ignoreDepth = 0, inBody = false, inRun = false, budget = 16000, hasText = false
  let next: { startParagraph: number, startColumn?: number } | null = null
  scan(await read('word/document.xml', 10*mib), {
    open(tag) {
      if (ignoreDepth || ['del','moveFrom','drawing','pict','Fallback'].includes(tag)) { ignoreDepth++; return }
      if (tag === 'body') inBody = true
      if (!inBody) return
      if (tag === 'r') inRun = true
      if (tag === 'tbl') tables.push({ table: ++tableIndex, row: 0, cell: 0 })
      const table = tables.at(-1)
      if (tag === 'tr' && table) { table.row++; table.cell = 0 }
      if (tag === 'tc' && table) table.cell++
      if (tag === 'p') openParagraphs.push({ paragraph:++total, ...table, text:'' })
      const current = openParagraphs.at(-1)
      if (current && inRun && ['tab','br','cr'].includes(tag)) current.text += tag === 'tab' ? '\t' : '\n'
    },
    text(value, tag) { if (tag === 't' && !ignoreDepth) { const current = openParagraphs.at(-1); if (current) current.text += value } },
    close(tag) {
      if (ignoreDepth) { ignoreDepth--; return }
      if (!inBody) return
      if (tag === 'p') {
        const current = openParagraphs.pop()
        if (!current) return
        if (current.text.trim()) hasText = true
        if (current.paragraph < start || next) return
        if (paragraphs.length === count || budget === 0) { next = {startParagraph:current.paragraph}; return }
        const offset = current.paragraph === start ? column - 1 : 0
        if (offset > current.text.length) throw new Error('起始字符列超出段落长度。')
        const text = current.text.slice(offset, offset + budget)
        paragraphs.push({ ...current, startColumn:offset + 1, text })
        budget -= text.length
        if (offset + text.length < current.text.length) next = { startParagraph:current.paragraph, startColumn:offset + text.length + 1 }
      }
      if (tag === 'r') inRun = false
      if (tag === 'tbl') tables.pop()
      if (tag === 'body') inBody = false
    },
  })
  if (total && start > total) throw new Error('起始段落超过原文。')
  return { totalParagraphs:total, paragraphs, next, hint:hasText ? '按原文段落号引用，表格段落附表号、行号、单元格序号；核对页码或版式用 view=image。' : '未找到可读正文，文档可能以图片呈现，请用 view=image 按页查看。' }
}
