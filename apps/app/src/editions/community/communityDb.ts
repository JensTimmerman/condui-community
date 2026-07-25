import Dexie, { type Table } from 'dexie'
import type { ProjectV2 } from '@/types/projectV2'
import {
  normalizeStoredProjectToV2,
  projectToStoredProjectV2,
} from '@/lib/projectV2/migration'

export type ProjectStorageMode = 'local'

export interface ProjectMetadata {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  lastOpened?: string
  storageMode: 'local'
}

export interface AppSettings {
  key: string
  value: unknown
}

interface ProjectAssetBlob {
  id: string
  projectId: string
  kind: string
  updatedAt: string
  bytes: Uint8Array
}

export class EendraDatabase extends Dexie {
  projects!: Table<ProjectV2, string>
  projectAssetBlobs!: Table<ProjectAssetBlob, string>
  projectMetadata!: Table<ProjectMetadata, string>
  settings!: Table<AppSettings, string>

  constructor() {
    super('ConduiCommunityDB')
    this.version(1).stores({
      projects: 'project.id, project.name, project.updatedAt',
      projectAssetBlobs: 'id, projectId, kind, updatedAt',
      projectMetadata: 'id, name, updatedAt, lastOpened',
      settings: 'key',
    })
  }
}

export const db = new EendraDatabase()

export async function saveProject(
  project: ProjectV2,
  options?: { lastOpened?: string; storageMode?: ProjectStorageMode },
): Promise<void> {
  const stored = projectToStoredProjectV2(project)
  const metadata: ProjectMetadata = {
    id: stored.project.id,
    name: stored.project.name,
    createdAt: stored.project.createdAt,
    updatedAt: stored.project.updatedAt,
    lastOpened: options?.lastOpened ?? new Date().toISOString(),
    storageMode: 'local',
  }
  await db.transaction('rw', [db.projects, db.projectMetadata], async () => {
    await db.projects.put(stored, stored.project.id)
    await db.projectMetadata.put(metadata, metadata.id)
  })
}

export async function loadProject(projectId: string): Promise<ProjectV2 | undefined> {
  const stored = await db.projects.get(projectId)
  if (!stored) return undefined
  await db.projectMetadata.update(projectId, { lastOpened: new Date().toISOString() })
  return normalizeStoredProjectToV2(stored)
}

export async function deleteProject(projectId: string): Promise<void> {
  await db.transaction('rw', [db.projects, db.projectAssetBlobs, db.projectMetadata], async () => {
    await db.projects.delete(projectId)
    await db.projectAssetBlobs.where('projectId').equals(projectId).delete()
    await db.projectMetadata.delete(projectId)
  })
}

export async function listProjects(): Promise<ProjectMetadata[]> {
  return db.projectMetadata.orderBy('lastOpened').reverse().toArray()
}

export async function getRecentProjects(limit = 50): Promise<ProjectMetadata[]> {
  return (await listProjects()).slice(0, limit)
}

export async function getCachedRecentProjects(limit = 50): Promise<ProjectMetadata[]> {
  return getRecentProjects(limit)
}

export async function getProjectMetadataById(projectId: string): Promise<ProjectMetadata | undefined> {
  return db.projectMetadata.get(projectId)
}

export async function getProjectRemoteRevision(projectId: string): Promise<string | undefined> {
  return (await db.projectMetadata.get(projectId))?.updatedAt
}

export async function prepareProjectForCloudMove(project: ProjectV2): Promise<ProjectV2> {
  return project
}

export async function markCloudProjectMovedToLocal(_projectId: string): Promise<void> {
  throw new Error('Cloud storage is not active.')
}

export async function adoptUnscopedLocalProjectsForUser(_userId: string): Promise<void> {}

export function isProjectStorageModeAvailable(mode: string): mode is ProjectStorageMode {
  return mode === 'local'
}
