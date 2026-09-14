import JSZip from 'jszip'
import type { ProjectV2 } from '@/types/projectV2'
import {
  normalizeStoredProjectToV2,
  projectToStoredProjectV2,
  type LegacyProjectDocument,
} from '@/lib/projectV2/migration'
import { sanitizeLegacyV2Project } from '@/lib/projectV2/sanitizeLegacyV2Project'
import { validateProjectStructure } from '@/utils/project'

const PROJECT_JSON_FILENAME = 'project.json'
const MAX_PROJECT_JSON_BYTES = 160 * 1024 * 1024

export async function exportCommunityProject(project: ProjectV2): Promise<Blob> {
  const zip = new JSZip()
  zip.file(PROJECT_JSON_FILENAME, JSON.stringify(projectToStoredProjectV2(project), null, 2))
  zip.file(
    'manifest.json',
    JSON.stringify({ format: 'condui-project', version: 1, projectFile: PROJECT_JSON_FILENAME }, null, 2),
  )
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

export async function importCommunityProject(file: Blob): Promise<ProjectV2> {
  const zip = await JSZip.loadAsync(file)
  const entry = zip.file(PROJECT_JSON_FILENAME)
  if (!entry) throw new Error('This archive does not contain project.json.')
  const json = await entry.async('text')
  if (new TextEncoder().encode(json).byteLength > MAX_PROJECT_JSON_BYTES) {
    throw new Error('The project file is too large.')
  }
  const raw = JSON.parse(json) as LegacyProjectDocument
  const project = sanitizeLegacyV2Project(normalizeStoredProjectToV2(raw)).project
  const validation = validateProjectStructure(project)
  if (!validation.valid) throw new Error('The project file is invalid.')
  return project
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
