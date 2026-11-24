import { validateArchive, type Archive, type ArchiveService } from './archive-model.ts'

/** Small manifest followed by the unmodified file bodies, so photos don't expand into JSON. */
const magic = 'iHome-Archive/1\n'
const encoder = new TextEncoder()
const prefix = encoder.encode(magic)
export interface BackupPreview { archive: Archive, files: Map<string, Blob> }

export async function packArchive(archive: Archive, service: ArchiveService): Promise<Blob> {
  const blobs = new Map<string, Blob>()
  for (const attachment of archive.attachments) {
    const ref = attachment.file
    if (blobs.has(ref.attachmentId)) continue
    const blob = await service.downloadFile(attachment.id)
    if (blob.size !== ref.bytes) throw new Error('原件大小与档案不符，请重新导入该文件。')
    blobs.set(ref.attachmentId, blob)
  }
  const manifest = encoder.encode(JSON.stringify({ archive, objects: [...blobs.keys()] }))
  const length = new Uint8Array(4)
  new DataView(length.buffer).setUint32(0, manifest.length)
  return new Blob([prefix, length, manifest, ...blobs.values()], { type: 'application/octet-stream' })
}

export async function inspectBackup(source: Blob): Promise<BackupPreview> {
  const header = await source.slice(0, prefix.length + 4).arrayBuffer()
  if (header.byteLength !== prefix.length + 4 || new TextDecoder().decode(header.slice(0, prefix.length)) !== magic)
    throw new Error('请选择由 iHome 导出的 .ihome 档案备份。')
  const manifestBytes = new DataView(header).getUint32(prefix.length)
  let offset = header.byteLength + manifestBytes
  if (offset > source.size) throw new Error('备份不完整，无法读取目录。')
  const manifest = JSON.parse(await source.slice(header.byteLength, offset).text())
  const archive = validateArchive(manifest.archive)
  const refs = new Map(archive.attachments.map(a => [a.file.attachmentId, a.file]))
  if (!Array.isArray(manifest.objects) || manifest.objects.length !== refs.size) throw new Error('备份的附件目录不完整。')
  const files = new Map<string, Blob>()
  for (const id of manifest.objects) {
    const ref = refs.get(id)
    if (!ref || files.has(id) || offset + ref.bytes > source.size) throw new Error('备份的原件目录无效。')
    files.set(id, source.slice(offset, offset + ref.bytes))
    offset += ref.bytes
  }
  if (offset !== source.size) throw new Error('备份文件长度有误。')
  return { archive, files }
}

/** Verify each imported original before publishing a single archive revision. */
export async function restoreFiles(preview: BackupPreview, service: ArchiveService) {
  const imported = new Set<string>()
  for (const { file: ref } of preview.archive.attachments) {
    const key = JSON.stringify([ref.attachmentId, ref.name])
    if (imported.has(key)) continue
    const part = preview.files.get(ref.attachmentId)
    if (!part) throw new Error('备份缺少附件原件。')
    const stored = await service.uploadFile(new File([part], ref.name))
    if (stored.attachmentId !== ref.attachmentId || stored.bytes !== ref.bytes || stored.name !== ref.name)
      throw new Error('附件校验失败，当前家庭档案已保留。')
    imported.add(key)
  }
}
