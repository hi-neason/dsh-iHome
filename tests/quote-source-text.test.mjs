import test from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'
import { createQuoteSourceTool } from '../src/quote-source-tool.ts'

// Small in-memory OOXML package, compressed using the same DEFLATE method as Excel/Word.
function packageParts(parts) {
  const content = [], directory = []
  let offset = 0
  for (const [path, xml] of Object.entries(parts)) {
    const name = Buffer.from(path), bytes = Buffer.from(xml), packed = deflateRawSync(bytes)
    let crc = -1
    for (const b of bytes) { crc ^= b; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0) }
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE((~crc) >>> 0, 14)
    local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10); central.writeUInt32LE((~crc) >>> 0, 16)
    central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42)
    content.push(local, name, packed); directory.push(central,name); offset += local.length + name.length + packed.length
  }
  const index=Buffer.concat(directory), end=Buffer.alloc(22), count=Object.keys(parts).length
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(count,8); end.writeUInt16LE(count,10); end.writeUInt32LE(index.length,12); end.writeUInt32LE(offset,16)
  return Buffer.concat([...content,index,end])
}
const workbook = {
  'xl/workbook.xml':'<workbook xmlns:r="urn:test"><sheets><sheet name="装修明细" sheetId="8" r:id="pick"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="pick" Type="a/worksheet" Target="/xl/worksheets/other.xml"/><Relationship Id="words" Type="a/sharedStrings" Target="words.xml"/></Relationships>',
  'xl/words.xml':'<sst><si><r><t>含税</t></r><r><t>&amp;运费</t></r><rPh><t>yùn</t></rPh></si></sst>',
  'xl/worksheets/other.xml':'<worksheet><sheetData><row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2" t="inlineStr"><is><t>墙漆</t></is></c><c r="C2" s="7"><v>45122.0</v></c><c r="D2"><f>ROUND(C2*0.5,2)</f><v>22561</v></c><c r="E2"><f>C2*3</f></c><c t="b"><v>0</v></c></row></sheetData></worksheet>',
}
function reader(name, contents) {
  const bytes = packageParts(contents)
  const tool=createQuoteSourceTool({files:()=>[{name,bytes:bytes.length,attachmentId:'trusted'}],read:async()=>bytes,
    render:async()=>assert.fail('Structured reads must not invoke rendering'),saveImage:async()=>assert.fail('No raster output expected')})
  return async args=>JSON.parse((await tool.execute({index:1,...args},{signal:new AbortController().signal})).description)
}

test('指定工作表关系取值，保留原数字、共享字符串、内联字符串、公式与缺失缓存', async()=>{
  const read=reader('报价.xlsx',workbook)
  assert.deepEqual((await read({})).sheets,['装修明细'])
  const result=await read({sheet:'装修明细',range:'A2:G2'}), cells=new Map(result.cells.map(item=>[item.address,item]))
  assert.equal(cells.get('A2').value,'含税&运费')
  assert.equal(cells.get('A2').raw,'0')
  assert.equal(cells.get('B2').value,'墙漆')
  assert.deepEqual(cells.get('C2'),{address:'C2',type:'n',raw:'45122.0',value:'45122.0',style:'7'})
  assert.equal(cells.get('D2').formula,'ROUND(C2*0.5,2)')
  assert.equal(cells.get('D2').raw,'22561')
  assert.equal(cells.get('E2').value,null)
  assert.equal(cells.get('E2').formula,'C2*3')
  assert.equal(cells.get('F2').value,'0')
  assert.ok(!cells.has('G2'))
  assert.deepEqual((await read({sheet:'装修明细',range:'D2'})).cells,[cells.get('D2')])
})

test('正文与嵌套文字段落按原序号追溯，表格有行列位置；隐藏的删除文本不计入', async()=>{
  const doc='<w:document xmlns:w="urn:w"><w:body><w:p><w:pPr><w:tabs><w:tab/></w:tabs></w:pPr><w:r><w:t>原合同</w:t><w:tab/><w:t>A &amp; B</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>尾款</w:t></w:r><w:del><w:r><w:delText>旧金额</w:delText></w:r></w:del></w:p></w:tc><w:tc><w:p><w:r><w:t>验收后</w:t><w:br/><w:t>3日</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'
  const read=reader('合同.docx',{'word/document.xml':doc})
  const first=await read({paragraphCount:1}), second=await read(first.next)
  assert.equal(first.totalParagraphs,3)
  assert.equal(first.paragraphs[0].text,'原合同\tA & B')
  assert.deepEqual(second.paragraphs[0],{paragraph:2,table:1,row:1,cell:1,text:'尾款',startColumn:1})
  assert.equal(second.paragraphs[1].text,'验收后\n3日')
  assert.equal(second.paragraphs[1].cell,2)
  assert.equal(second.next,null)
})

test('长段可续读，纯图片 DOCX 可选择图片查看',async()=>{
  const doc = content=>'<w:document xmlns:w="urn:w"><w:body><w:p><w:r>'+content+'</w:r></w:p></w:body></w:document>'
  const read=reader('长条款.docx',{'word/document.xml':doc('<w:t>'+'壹'.repeat(17000)+'</w:t>')})
  const first=await read({}), second=await read(first.next)
  assert.equal(first.paragraphs[0].text.length,16000)
  assert.equal(second.paragraphs[0].startColumn,16001)
  assert.equal(second.paragraphs[0].text.length,1000)
  const imageOnly=reader('扫描合同.docx',{'word/document.xml':doc('<w:drawing/>')})
  assert.match((await imageOnly({})).hint,/未找到可读正文.*view=image/)
})

test('拒绝外部关系、文档类型声明、过大展开和未知实体',async()=>{
  const external=reader('报价.xlsx',{...workbook,'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="pick" Type="a/worksheet" TargetMode="External" Target="https://example.invalid"/></Relationships>'})
  await assert.rejects(external({sheet:'装修明细'}),/本地单元格/)
  for (const xml of ['<!DOCTYPE document><document/>','<doc><body><p><t>&unknown;</t></p></body></doc>']) {
    await assert.rejects(reader('合同.docx',{'word/document.xml':xml})({}),/无效|实体/)
  }
  await assert.rejects(reader('合同.docx',{'word/document.xml':' '.repeat(10*1024*1024+1)})({}),/过大/)
})
