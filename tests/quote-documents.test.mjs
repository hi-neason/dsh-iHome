import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'
import { iHomeWorkspacePath } from '../src/ihome-workspace-path.ts'
import { parseQuoteBoard } from '../src/quote-model.ts'
import { quoteDocumentPreviewAddress, downloadQuoteDocument, uploadQuoteDocument } from '../src/quote-document-client.ts'
const built = await build({ entryPoints:['src/quote-host.ts'], bundle:true, platform:'node', write:false, format:'esm' })
const { mountQuotes } = await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].contents).toString('base64'))

const sourceName = 'ihome_read_quote_source'
function hostState() { return { board:parseQuoteBoard({ revision:2, vendors:[{id:'a',name:'甲公司'},{id:'b',name:'乙公司'}] }), blobs:new Map(), images:[] } }
async function fixture(state = hostState()) {
  const routes = new Map(), tools = new Map()
  let close
  await mountQuotes({
    effect:async fn=>{close=await fn()}, get:()=>undefined,
    storageDomain:{open:async()=>({table:()=>({get:()=>state.board,put:async(_,b)=>state.board=b,update:async(_,fn)=>state.board=fn(state.board)}),close:async()=>{}})},
    connection:{fetch:{register(route){routes.set(route.path, route);return ()=>routes.delete(route.path)}}},
    tools:{register(tool){tools.set(tool.name, tool);return ()=>tools.delete(tool.name)}},
    attachments:{
      async saveFile({ data,name }) {
        const id='sha256:'+createHash('sha256').update(data).digest('hex')
        state.blobs.set(id, data.slice()); return {attachmentId:id,name,bytes:data.byteLength}
      },
      fileHostPath:file=>'/原 件/'+file.name,
      async *readFileStream(file){yield state.blobs.get(file.attachmentId)},
      async saveImage({mediaType,data,name}) { state.images.push({mediaType,data,name});return {attachmentId:'image',mediaType,width:3,height:4,bytes:data.length,name} },
    },
  })
  const request = (params,method='GET',body) => routes.get('/api/ihome/quote-documents').fetch(new Request('http://test/quote-documents?'+new URLSearchParams(params),{method,body}))
  const read=(args, context={agent:{session:{header:{cwd:iHomeWorkspacePath()}}}})=>tools.get(sourceName).execute(args,{...context,signal:new AbortController().signal})
  return {state,routes, request,read, close}
}
const meta={id:'original',vendorId:'a',kind:'quote',title:'工程报价',version:'V1',name:'半包报价.csv'}
test('公司原件上传、下载、宿主预览、重挂载和幂等重试保持同一版本', async()=>{
  const f=await fixture(), body='名称,价格\n地板,100'
  let resp=await f.request(meta,'POST',body);assert.equal(resp.status,200)
  const board=await resp.json(), saved=board.documents[0]
  assert.equal(board.revision,3);assert.equal(saved.uploadedAt,new Date(saved.uploadedAt).toISOString())
  assert.equal(saved.file.name,meta.name)
  assert.equal((await (await f.request(meta,'POST',body)).json()).revision,3)
  assert.equal((await f.request(meta,'POST','新报价')).status,409)
  assert.equal((await f.request({...meta,id:'alt'},'POST',body)).status,409)
  assert.equal((await f.request({...meta,id:'v2',version:'V2'},'POST','二稿')).status,200)
  assert.equal((await f.request({...meta,id:'b1',vendorId:'b'},'POST','乙原件')).status,200)
  assert.equal((await f.request({vendorId:'b',id:'original'})).status,404)
  assert.equal((await f.request({vendorId:'b',id:'original',preview:'1'})).status,404)
  assert.equal((await f.request({vendorId:'a',id:saved.file.attachmentId})).status,404)
  await f.close()
  f.state.board=parseQuoteBoard(JSON.parse(JSON.stringify(f.state.board)))
  const reopened=await fixture(f.state)
  assert.deepEqual((await (await reopened.request({vendorId:'a',id:'original',preview:'1'})).json()).path,'/原 件/半包报价.csv')
  assert.equal(await (await reopened.request({vendorId:'a',id:'original'})).text(),body)
  assert.equal(await (await reopened.request({vendorId:'a',id:'v2'})).text(),'二稿')
  const directory=JSON.parse((await reopened.read({vendorId:'a'})).description).documents
  assert.deepEqual(directory.map(doc=>doc.version),['V1','V2']);assert.ok(!JSON.stringify(directory).includes('sha256:'))
  const text=JSON.parse((await reopened.read({vendorId:'a',documentId:'original',startLine:2})).description)
  assert.equal(text.document.version,'V1');assert.equal(text.lines[0].text,'地板,100')
  await assert.rejects(reopened.read({vendorId:'b',documentId:'original'}),/没有指定/)
  await assert.rejects(reopened.read({vendorId:'a',documentId:'original',name:meta.name}),/编号/)
  await assert.rejects(reopened.read({vendorId:'a'},{agent:{session:{header:{cwd:'/tmp/other'}}}}),/权限/)
  await reopened.close()
})

test('归档图纸读取返回对应公司与版本的模型图片块，其他资料支持原件下载',async()=>{
  const f=await fixture()
  for (const [name,mime,ext] of [['设计.png','image/png','png'],['设计.jpg','image/jpeg','jpg']]) {
    const content=new Uint8Array([1,2,3,4]), original={...meta,kind:'design',title:'户型',version:ext,id:ext,name}
    assert.equal((await f.request(original,'POST',content)).status,200)
    const result=await f.read({vendorId:'a',documentId:ext,view:'image'})
    assert.equal(result.images[0].mediaType,mime)
    assert.deepEqual(JSON.parse(result.description).document.version,ext)
    assert.deepEqual(f.state.images.at(-1).data,content)
  }
  const other={...meta,id:'dwg',kind:'other',name:'图纸.dwg'}
  assert.equal((await f.request(other,'POST','cad-data')).status,200)
  assert.equal(await (await f.request({vendorId:'a',id:'dwg'})).text(),'cad-data')
  await assert.rejects(f.read({vendorId:'a',documentId:'dwg'}),/打开或下载/)
  const legacy=parseQuoteBoard({revision:0,vendors:[]})
  assert.deepEqual(legacy.documents,[])
  await f.close()
})

test('浏览器使用认证桥传输原件，返回编码后的当前会话资源地址',async t=>{
  const f=await fixture();t.after(()=>f.close())
  const old=globalThis.__DSH_TRANSPORT__
  t.after(()=>{if(old===undefined) delete globalThis.__DSH_TRANSPORT__; else globalThis.__DSH_TRANSPORT__=old})
  globalThis.__DSH_TRANSPORT__={fetch:async(path,init)=>{
    const url=new URL(path,'http://ihome/')
    assert.equal(url.pathname,'/api/ihome/quote-documents')
    return f.routes.get(url.pathname).fetch(new Request(url,init))
  }}
  const file=new File(['原文'], '图 #2％.txt')
  const {name,...metadata}=meta
  assert.equal((await uploadQuoteDocument(metadata,file)).documents[0].file.name,file.name)
  const result=await downloadQuoteDocument('a','original')
  assert.equal(await result.text(),'原文')
  assert.equal(await quoteDocumentPreviewAddress('a','original','session/1'),
    'dsh-resource://file/session/session%2F1//'+encodeURIComponent('原 件')+'/'+encodeURIComponent(file.name))
  await assert.rejects(quoteDocumentPreviewAddress('b','original','session'),{status:404})
})
