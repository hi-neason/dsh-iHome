import test from 'node:test'
import assert from 'node:assert/strict'
import { createQuoteSourceTool } from '../src/quote-source-tool.ts'

const exec = () => ({ signal: new AbortController().signal })
function fixture(files = [], overrides = {}) {
  const reads = [], renders = [], saves = []
  const refs = files.map(([name, bytes], index) => ({ attachmentId: 'local-id-'+index, name, bytes: bytes.length }))
  const access = {
    files: () => refs,
    async read(ref, signal) { signal.throwIfAborted(); reads.push(ref); return files[refs.indexOf(ref)][1] },
    async render(request, signal) {
      const content = await request.source.read(signal, request.source.bytes)
      assert.ok(content.bytes.length); assert.equal(content.version, request.source.version)
      renders.push(request)
      return { pageCount: 3, dpi: request.dpi, missingFonts: [], images: [{ png: new Uint8Array([1]), width: 24, height: 40,
        ...(request.sheet ? { sheet: request.sheet, range: request.range } : { page: request.pages[0] }) }] }
    },
    async saveImage(input) { saves.push(input); return { attachmentId: 'durable-image', mediaType: 'image/png', width: 24, height: 40, bytes: 1 } },
    ...overrides,
  }
  const tool = createQuoteSourceTool(access)
  const run = (args, execution = exec()) => tool.execute(args, execution)
  const detail = async args => JSON.parse((await run(args)).description)
  return { reads, renders, saves, refs, tool, run, detail }
}
test('目录只枚举授权文件的序号、展示名与大小，绝不按模型构造的路径或附件 ID 读取', async () => {
  const bytes = new TextEncoder().encode('来源')
  const f = fixture([['材料.tsv',bytes], ['材料.tsv',bytes]])
  assert.deepEqual((await f.detail({})).files[1], { index:2, name:'材料.tsv', bytes:6 })
  for (const args of [{path:'/tmp/报价'}, {attachmentId:'local-id-1'}, {index:2,name:'材料.tsv'}, {name:'材料.tsv'}, {name:'/etc/passwd'},
    {index:1,path:'/tmp/quote'}, {index:3}, {index:0}, {index:'1'}]) await assert.rejects(f.run(args))
  assert.equal(f.reads.length, 0)
  assert.equal((await f.detail({ index:2 })).lines[0].text,'来源')
  assert.equal(f.reads[0], f.refs[1])
})

test('文本保留 CSV/TSV 原文行号，长行能够无损续读并支持 UTF16 的中文表', async () => {
  const long = 'x'.repeat(16300)
  const bytes = Buffer.concat([Buffer.from([255,254]),Buffer.from('项目\t元\r\n'+long+'\r\n末项\t9\r\n','utf16le')])
  const f = fixture([['报价.tsv',bytes]])
  const first = await f.detail({name:'报价.tsv',startLine:1,lineCount:1})
  assert.deepEqual(first.lines,[{line:1,startColumn:1,text:'项目\t元'}])
  assert.deepEqual(first.next,{startLine:2});assert.equal(first.totalLines,3)
  const second = await f.detail({index:1,...first.next})
  const third = await f.detail({index:1,...second.next})
  assert.equal(second.lines[0].text + third.lines[0].text,long)
  assert.equal(third.lines[1].text,'末项\t9')
  assert.equal(third.next,null)
  await assert.rejects(f.run({index:1,startLine:4}),/超出/)
})

test('图片按文件扩展与页码调用宿主，持久图片引用和原页位置一并交付', async () => {
  const data = new Uint8Array([32, 33]), f = fixture([['变更.pdf',data],['合同.docx',data]])
  for (const [index,extension,page] of [[1,'pdf',2],[2,'docx',1]]) {
    const value = await f.run({ index, page, view: 'image' })
    const [request] = f.renders.slice(-1)
    assert.equal(request.extension,extension);assert.deepEqual(request.pages,[page]);assert.equal(request.maxImages,1)
    assert.ok(request.maxPixels > 0 && request.maxDimension > 0 && request.maxBytes > 0)
    assert.equal(f.tool.output.render({},value)[1].type,'image')
    assert.equal(value.images[0].attachmentId,'durable-image')
    assert.equal(JSON.parse(value.description).locations[0].page,page)
    await assert.rejects(request.source.read(exec().signal,1),/过大/)
  }
  assert.equal(f.saves.length,2)
  await assert.rejects(f.run({index:1,page:0}));await assert.rejects(f.run({index:1,sheet:'sheet1'}))
})

test('工作簿读取真实 deflate 目录，仅将指定的有限区域送给 OfficeKit', async () => {
  // A ZIP fixture containing xl/workbook.xml with two worksheet names, including an XML entity.
  const workbook = Buffer.from('UEsDBBQAAAAIAB2ae11FCG61TQAAAHUAAAAPAAAAeGwvd29ya2Jvb2sueG1ssynPL8pOys/PtrMpzkhNLSmG0gp5ibmptkpP5+96vrDh6falz1d0KymAZTxTbJUMlfRR1T3bsEUtMbfA+vmUrUjKjEDK9GHm6sOtAgBQSwECFAMUAAAACAAdmntdRQhutU0AAAB1AAAADwAAAAAAAAAAAAAAgAEAAAAAeGwvd29ya2Jvb2sueG1sUEsFBgAAAAABAAEAPQAAAHoAAAAAAA==','base64')
  const f = fixture([['变更.XLSX',workbook]])
  assert.deepEqual((await f.detail({index:1})).sheets,['基础工程','水&电'])
  assert.equal(f.renders.length,0)
  const value = await f.detail({index:1,view:'image',sheet:'水&电',range:'c2:e9'})
  assert.deepEqual(value.locations,[{sheet:'水&电',range:'C2:E9'}])
  assert.equal(f.renders[0].pages,undefined)
  for (const args of [{range:'A1:D1'},{sheet:'水&电',range:'A1:ZZ999'},{sheet:'x',range:'A40:A1'},{sheet:'x',range:'D1:B9'},
    {sheet:'x',range:'A0:B3'},{sheet:'x',page:1},{sheet:'x',range:'XFE1:XFE2'}]) await assert.rejects(f.run({index:1,...args}))
  assert.equal(f.renders.length,1)
})

test('拒绝超大或已变更的字节，缺少宿主服务给出替代方式，取消不产生回图', async () => {
  const tiny = new Uint8Array([1]), f = fixture([['a.txt',tiny]], {read:async()=>new Uint8Array([1,2])})
  await assert.rejects(f.run({index:1}),/不一致/)
  f.refs[0].bytes=3_000_000
  await assert.rejects(f.run({index:1}),/过大/)
  const unavailable = fixture([['a.pdf',tiny]],{render:undefined})
  await assert.rejects(unavailable.run({index:1}),/未加载 Office/)
  const abort = new AbortController()
  const cancelled = fixture([['b.pdf',tiny]],{async render() { abort.abort(); return { images:[] } }})
  await assert.rejects(cancelled.run({index:1},{signal:abort.signal}),{name:'AbortError'})
  assert.equal(cancelled.saves.length,0)
})
