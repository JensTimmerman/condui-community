import type { ProjectV2 } from '@/types/projectV2'
import {
  exportPortableProjectToZip,
  importPortableProjectFromZip,
} from '@/lib/export/portableProjectPackage'

export async function exportCommunityProject(project: ProjectV2): Promise<Blob> {
  return exportPortableProjectToZip(project)
}

export async function importCommunityProject(file: Blob): Promise<ProjectV2> {
  return importPortableProjectFromZip(file)
}

export function downloadCommunityBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
