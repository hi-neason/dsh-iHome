import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { platform, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { QuoteOfficeRequest, QuoteOfficeResult } from './quote-source-tool'

export function canRenderMacQuotePdf(extension: string) { return platform() === 'darwin' && extension === 'pdf' }

// The helper accepts only our private directory and numeric render settings as arguments.
// PDFKit handles orientation and rasterization without opening a document in an application.
const rasterize = `
ObjC.import('Foundation')
ObjC.import('PDFKit')
ObjC.import('AppKit')
function run(argv) {
  var dir = argv[0], options = JSON.parse(argv[1]);
  var doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(dir + '/source.pdf'));
  if (doc.isLocked) throw new Error('PDF 已加密，请提供解锁后的副本。');
  var total = Number(doc.pageCount);
  if (!Number.isSafeInteger(total) || total < 1) throw new Error('PDF 无法读取或没有页面。');
  var pages = options.pages;
  if (!pages) {
    if (total > options.maxImages) throw new Error('请指定要读取的 PDF 页码。');
    pages = Array.from({length: total}, function (_, i) { return i + 1 });
  }
  var images = [], remainingBytes = options.maxBytes;
  for (var i = 0; i < pages.length; i++) {
    var pageNumber = pages[i];
    if (pageNumber > total) throw new Error('PDF 共 ' + total + ' 页，所选页码超出范围。');
    var page = doc.pageAtIndex(pageNumber - 1), size = page.boundsForBox(1).size;
    var rotated = Math.abs(Number(page.rotation)) % 180 === 90;
    var width = Math.max(1, Math.round((rotated ? size.height : size.width) * options.dpi / 72));
    var height = Math.max(1, Math.round((rotated ? size.width : size.height) * options.dpi / 72));
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || Math.max(width,height) > options.maxDimension || width * height > options.maxPixels)
      throw new Error('PDF 页面超过图片尺寸上限。');
    var thumb = page.thumbnailOfSizeForBox($.NSMakeSize(width, height), 1);
    var bitmap = $.NSBitmapImageRep.imageRepWithData(thumb.TIFFRepresentation);
    width = Number(bitmap.pixelsWide); height = Number(bitmap.pixelsHigh);
    if (!width || !height || Math.max(width,height) > options.maxDimension || width * height > options.maxPixels) throw new Error('PDF 图片尺寸无效。');
    var png = bitmap.representationUsingTypeProperties(4, $({})), bytes = Number(png.length);
    if (!bytes || bytes > remainingBytes) throw new Error('PDF 页面超过图片字节上限。');
    if (!png.writeToFileAtomically(dir + '/page-' + i + '.png', true)) throw new Error('无法写入 PDF 临时页图。');
    remainingBytes -= bytes;
    images.push({page:pageNumber, width:width, height:height, bytes:bytes});
  }
  return JSON.stringify({pageCount:total, images:images});
}`

interface ImageMetadata { page: number, width: number, height: number, bytes: number }
const timeoutMs = 15000

function renderPages(dir: string, request: QuoteOfficeRequest, signal: AbortSignal): Promise<string> {
  const { pages, dpi, maxImages, maxPixels, maxDimension, maxBytes } = request
  const options = JSON.stringify({ pages, dpi, maxImages, maxPixels, maxDimension, maxBytes })
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', rasterize, '--', dir, options], {
      signal, encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 64 * 1024,
    }, (error, stdout, stderr) => {
      if (signal.aborted) { reject(signal.reason); return }
      if (error) { reject(new Error(stderr.trim().slice(-500) || '系统 PDF 读取失败或超时。')); return }
      resolve(stdout)
    })
  })
}

export async function renderMacQuotePdf(request: QuoteOfficeRequest, signal: AbortSignal): Promise<QuoteOfficeResult> {
  signal.throwIfAborted()
  if (!canRenderMacQuotePdf(request.extension)) throw new Error('系统分页读取仅适用于 macOS 上的 PDF。')
  const { source, pages, dpi, maxImages, maxPixels, maxDimension, maxBytes } = request
  if (![dpi,maxImages,maxPixels,maxDimension,maxBytes].every(value => Number.isSafeInteger(value) && value > 0) || dpi < 24 || dpi > 600) throw new Error('PDF 读取尺寸或字节上限无效。')
  if (pages && (!pages.length || pages.length > maxImages || new Set(pages).size !== pages.length || pages.some(page => !Number.isSafeInteger(page) || page < 1))) throw new Error('PDF 页码无效或页数超出读取上限。')
  if (!Number.isSafeInteger(source.bytes) || source.bytes < 1 || source.bytes > 24 * 1024 * 1024) throw new Error('PDF 为空或超过 24 MiB。')
  const lifetime = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
  const input = await source.read(lifetime, source.bytes)
  lifetime.throwIfAborted()
  if (input.version !== source.version || input.bytes.byteLength !== source.bytes) throw new Error('PDF 原件版本或大小已变化，请重新读取。')
  const dir = await mkdtemp(join(tmpdir(), 'ihome-pdf-'))
  try {
    await writeFile(join(dir, 'source.pdf'), input.bytes, { flag: 'wx', mode: 0o600, signal: lifetime })
    const output: { pageCount: number, images: ImageMetadata[] } = JSON.parse(await renderPages(dir, request, lifetime))
    const images = []
    for (const [index, entry] of output.images.entries()) {
      const png = await readFile(join(dir, `page-${index}.png`), { signal: lifetime })
      if (png.byteLength !== entry.bytes) throw new Error('系统 PDF 页图不完整。')
      images.push({ png, width: entry.width, height: entry.height, page: entry.page })
    }
    lifetime.throwIfAborted()
    return { pageCount: output.pageCount, dpi, missingFonts: [], images }
  } finally { await rm(dir, { recursive: true, force: true }) }
}
