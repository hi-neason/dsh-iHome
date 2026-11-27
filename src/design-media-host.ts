import type { ArchiveHostContext } from './archive-host'
import type { ArchiveFile } from './archive-model'

interface Media extends ArchiveFile { mime: string }
const limit = 64 * 1024 * 1024
export function designMediaType(bytes: Uint8Array) {
  const matches = (at: number, ...seq: number[]) => seq.every((value, i) => bytes[at+i] === value)
  if (matches(0,137,80,78,71,13,10,26,10)) return 'image/png'
  if (matches(0,255,216,255)) return 'image/jpeg'
  if (matches(0,82,73,70,70) && matches(8,87,69,66,80)) return 'image/webp'
  if (bytes.byteLength >= 20 && matches(0,103,108,84,70,2,0,0,0)) return 'model/gltf-binary'
  throw new Error('素材须为 PNG、JPEG、WebP 图片或 GLB 2.0 模型。')
}
function parseMedia(raw: unknown): Media {
  const value = raw as Media
  if (!value || !/^sha256:[a-f0-9]{64}$/.test(value.attachmentId) || typeof value.name !== 'string' ||
    !Number.isSafeInteger(value.bytes) || value.bytes <= 0 || value.bytes > limit ||
    !['image/png','image/jpeg','image/webp','model/gltf-binary'].includes(value.mime)) throw new Error('素材记录无效。')
  return { attachmentId:value.attachmentId, name:value.name, bytes:value.bytes, mime:value.mime }
}
export interface MediaHost extends Pick<ArchiveHostContext,'attachments'|'connection'|'effect'> {
  storageDomain: { open(spec: { name:string, version:number, tables:{ files:{ valueSchema:{ parse(raw:unknown):Media } } } }):Promise<{
    table(key:'files'):{ get(id:string):Media|undefined, put(id:string, value:Media):Promise<void> }, close():Promise<void>
  }> }
}
export async function mountDesignMedia(ctx: MediaHost) {
  await ctx.effect(async () => {
    const domain = await ctx.storageDomain.open({name:'ihome_design_media',version:1,tables:{files:{valueSchema:{parse:parseMedia}}}})
    try {
      const files = domain.table('files')
      const dispose = ctx.connection.fetch.register({path:'/api/ihome/design-media',methods:['GET','POST'],requestBody:'buffered',
        async fetch(request) {
          const url = new URL(request.url)
          try {
            if (request.method === 'POST') {
              if (Number(request.headers.get('content-length')) > limit) throw new Error('单个素材限 64 MiB。')
              const bytes = new Uint8Array(await request.arrayBuffer())
              if (bytes.length > limit) throw new Error('单个素材限 64 MiB。')
              const mime = designMediaType(bytes)
              request.signal.throwIfAborted()
              const file = await ctx.attachments.saveFile({data:bytes,name:(url.searchParams.get('name') || '设计素材').slice(0,160)})
              const stored = parseMedia({...file, mime})
              await files.put(file.attachmentId,stored)
              return Response.json({id:file.attachmentId})
            }
            if (request.method !== 'GET') return new Response(null,{status:405})
            const id = url.searchParams.get('id') ?? ''
            const file = /^sha256:[a-f0-9]{64}$/.test(id) ? files.get(id) : undefined
            if (!file) return Response.json({error:'在本机设计素材中找不到该文件。'},{status:404})
            const chunks: Uint8Array<ArrayBuffer>[] = []
            for await (const chunk of ctx.attachments.readFileStream(file,request.signal)) chunks.push(new Uint8Array(chunk))
            return new Response(new Blob(chunks),{headers:{'content-type':file.mime,'x-content-type-options':'nosniff','cache-control':'private, max-age=31536000, immutable'}})
          } catch (error) {
            return Response.json({error:error instanceof Error ? error.message : '素材读写失败。'},{status:400})
          }
        },
      })
      return async () => { await dispose(); await domain.close() }
    } catch (error) { await domain.close(); throw error }
  })
}
