import assert from 'node:assert/strict'
import test from 'node:test'
import { canRenderMacQuotePdf, renderMacQuotePdf } from '../src/quote-pdf-macos.ts'

// Two local vector pages. The second has a rotated crop and a visibly different drawing.
function samplePdf() {
  const content = ['0.2 0.4 0.8 rg 10 10 80 30 re f', '0.2 0.8 0.3 rg 40 20 35 55 re f']
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Count 2 /Kids [3 0 R 5 0 R] >>']
  for (const [index, data] of content.entries()) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 160 90] /Rotate ${index * 90} /Resources << >> /Contents ${4 + index * 2} 0 R >>`)
    objects.push(`<< /Length ${data.length} >>\nstream\n${data}\nendstream`)
  }
  let pdf = '%PDF-1.4\n'
  const offsets = []
  for (const [index, object] of objects.entries()) { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n` }
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map(n => String(n).padStart(10,'0') + ' 00000 n \n').join('')
  return Buffer.from(pdf + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
}
function request(overrides = {}) {
  const bytes = samplePdf()
  return { extension:'pdf', source:{ key:'demo', version:'1', bytes:bytes.length, async read(signal, limit) {
    signal.throwIfAborted(); assert.ok(bytes.length <= limit); return { bytes, version:'1' }
  }}, pages:[2], dpi:72, maxImages:1, maxDimension:500, maxPixels:100000, maxBytes:100000, ...overrides }
}
const mac = { skip:process.platform !== 'darwin' }
const active = () => new AbortController().signal

test('selects the system renderer only for macOS PDFs', () => {
  assert.equal(canRenderMacQuotePdf('pdf'),process.platform === 'darwin')
  for (const type of ['docx','xlsx']) assert.equal(canRenderMacQuotePdf(type),false)
})

test('PDFKit reads the selected original page and honors rotation and total page count', mac, async () => {
  const result = await renderMacQuotePdf(request({pages:[1,2],maxImages:2}),active())
  assert.equal(result.pageCount,2)
  assert.deepEqual(result.images.map(image=>image.page),[1,2])
  assert.equal(result.images[0].width > result.images[0].height,true)
  assert.equal(result.images[1].height > result.images[1].width,true)
  for (const image of result.images) {
    const png = Buffer.from(image.png)
    assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a')
    assert.equal(png.readUInt32BE(16),image.width)
    assert.equal(png.readUInt32BE(20),image.height)
  }
  const second = await renderMacQuotePdf(request(),active())
  assert.deepEqual(second.images[0].png,result.images[1].png)
})

test('enforces original page, pixel and byte limits and rejects changed input', mac, async () => {
  for (const [params, expected] of [[{pages:[3]},/共 2 页/],[{maxPixels:100},/尺寸上限/],[{maxBytes:10},/字节上限/],[{pages:[1,2]},/页数超出/]]) {
    await assert.rejects(renderMacQuotePdf(request(params),active()),expected)
  }
  const changed = request();changed.source.version = 'new'
  await assert.rejects(renderMacQuotePdf(changed,active()),/原件版本/)
})

test('cancellation during the deferred source read prevents native rendering', mac, async () => {
  const controller = new AbortController()
  const input = request();const read = input.source.read
  input.source.read = async (signal, limit) => {const data=await read(signal,limit);controller.abort(new Error('用户取消'));return data}
  await assert.rejects(renderMacQuotePdf(input,controller.signal),/用户取消/)
})
