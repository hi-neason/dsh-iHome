import { validateArchive } from './archive-model'
import type { ArchiveFile, ArchiveService } from './archive-model'
import { requestIHome as request } from './ihome-http'

/** Use the same authenticated carrier as DSH, including its desktop bridge. */
export function createArchiveService(): ArchiveService {
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
