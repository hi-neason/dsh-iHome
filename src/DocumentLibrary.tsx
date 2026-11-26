import { FamilyArchive } from './FamilyArchive'
import type { ArchiveService } from './archive-model'

export function DocumentLibrary({ service }: { service: ArchiveService }) {
  return <FamilyArchive service={service} documents />
}
