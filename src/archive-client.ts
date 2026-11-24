import { validateArchive } from './archive-model'
import type { ArchiveFile, ArchiveService } from './archive-model'

type HostFetch = (input: string | URL, init: RequestInit) => Promise<Response>

/** Use the same authenticated carrier as DSH, including its desktop bridge. */
export function createArchiveService(): ArchiveService {
  const globals = globalThis as typeof globalThis & { __DSH_TRANSPORT__?: { fetch?: HostFetch } }
  const fetchHost: HostFetch = globals.__DSH_TRANSPORT__?.fetch ?? ((input, init) => globalThis.fetch(input, init))
  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetchHost(`api/ihome/${path}`, { credentials: 'same-origin', ...init })
    if (!response.ok) {
      let message = response.status === 413
        ? '附件超过当前 DSH 宿主的请求大小上限，请拆分文件后上传。'
        : `家庭档案暂时无法连接（${response.status}）。`
      try {
        const body = await response.json() as { error?: unknown }
        if (typeof body.error === 'string') message = body.error
      } catch { /* Preserve the transport error when the host sends a non-JSON response. */ }
      throw new Error(message)
    }
    return response
  }
  return {
    async load() {
      return validateArchive(await (await request('archive')).json())
    },
    async save(archive) {
      return validateArchive(await (await request('archive', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(archive),
      })).json())
    },
    async uploadFile(file) {
      const value = await (await request(`file?name=${encodeURIComponent(file.name)}`, {
        method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file,
      })).json() as ArchiveFile
      if (typeof value?.attachmentId !== 'string' || typeof value.name !== 'string'
        || !Number.isSafeInteger(value.bytes) || value.bytes < 0) throw new Error('附件保存响应无效，请重试。')
      return value
    },
    async downloadFile(attachmentId) {
      return (await request(`file?id=${encodeURIComponent(attachmentId)}`)).blob()
    },
  }
}
