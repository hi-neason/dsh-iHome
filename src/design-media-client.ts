import { requestIHome } from './ihome-http.ts'

export async function storeDesignAsset(blob: Blob, name: string): Promise<string> {
  const response = await requestIHome('design-media?name=' + encodeURIComponent(name), {
    method:'POST', headers:{'content-type':'application/octet-stream'}, body:blob,
  })
  const { id } = await response.json()
  if (typeof id !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(id)) throw new Error('素材保存结果无效。')
  return id
}
export async function readDesignAsset(id: string, signal?: AbortSignal): Promise<Blob> {
  return (await requestIHome('design-media?id=' + encodeURIComponent(id), { signal })).blob()
}
