import type { ProjectMetadata } from '@/lib/db'
import { createUuid } from '@/lib/uuid'

export type HomeProjectViewMode = 'grid' | 'list'

export type HomeFolder = {
  id: string
  name: string
  createdBy?: string | null
  system?: 'personal' | null
  collapsed?: boolean
}

export type HomeProjectLayout = {
  viewMode: HomeProjectViewMode
  folders: HomeFolder[]
  /** `${storageMode}:${projectId}` → folder id; omitted keys live at root */
  assignments: Record<string, string>
}

const LEGACY_STORAGE_KEY = 'eendra-home-project-layout'
export const PERSONAL_PROJECTS_FOLDER_ID = 'system-personal-projects'

function storageKeyForUser(userId: string | null | undefined): string {
  if (userId) return `${LEGACY_STORAGE_KEY}:${userId}`
  return LEGACY_STORAGE_KEY
}

/** MIME type for home screen project drag-and-drop */
export const HOME_PROJECT_DRAG_MIME = 'application/x-eendra-home-project'

/** MIME type for reordering folders (flat list only, no nesting) */
export const HOME_FOLDER_DRAG_MIME = 'application/x-eendra-home-folder'

const defaultLayout: HomeProjectLayout = {
  viewMode: 'grid',
  folders: [],
  assignments: {},
}

export function projectLayoutKey(project: Pick<ProjectMetadata, 'id' | 'storageMode'>): string {
  return `${project.storageMode}:${project.id}`
}

export function normalizeHomeProjectLayout(value: unknown): HomeProjectLayout {
  if (!value || typeof value !== 'object') return defaultLayout
  const parsed = value as Partial<HomeProjectLayout>
  return {
    viewMode: parsed.viewMode === 'list' ? 'list' : 'grid',
    folders: Array.isArray(parsed.folders)
      ? parsed.folders
          .filter(
            (f): f is HomeFolder =>
              f != null &&
              typeof f === 'object' &&
              typeof (f as HomeFolder).id === 'string' &&
              typeof (f as HomeFolder).name === 'string'
          )
          .map((folder) => {
            const raw = folder as HomeFolder & { created_by?: unknown }
            const createdBy =
              typeof raw.createdBy === 'string'
                ? raw.createdBy
                : typeof raw.created_by === 'string'
                  ? raw.created_by
                  : null
            return {
              id: raw.id,
              name: raw.name,
              ...(createdBy ? { createdBy } : {}),
              ...(raw.system === 'personal' ? { system: 'personal' as const } : {}),
              ...(raw.collapsed === true ? { collapsed: true } : {}),
            }
          })
      : [],
    assignments:
      parsed.assignments && typeof parsed.assignments === 'object'
        ? (parsed.assignments as Record<string, string>)
        : {},
  }
}

export function loadHomeProjectLayout(userId?: string | null): HomeProjectLayout {
  if (typeof window === 'undefined') return defaultLayout
  try {
    const key = storageKeyForUser(userId)
    const raw = window.localStorage.getItem(key)
    if (!raw) return defaultLayout
    return normalizeHomeProjectLayout(JSON.parse(raw))
  } catch {
    return defaultLayout
  }
}

export function saveHomeProjectLayout(layout: HomeProjectLayout, userId?: string | null): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKeyForUser(userId), JSON.stringify(layout))
  } catch {
    // ignore quota errors
  }
}

export function pruneEmptyFoldersFromHomeProjectLayout(
  layout: HomeProjectLayout
): HomeProjectLayout {
  const assignedFolderIds = new Set(Object.values(layout.assignments))
  const folders = layout.folders.filter((folder) => assignedFolderIds.has(folder.id))
  const keptFolderIds = new Set(folders.map((folder) => folder.id))
  const assignments = Object.fromEntries(
    Object.entries(layout.assignments).filter(([, folderId]) => keptFolderIds.has(folderId))
  )

  return {
    ...layout,
    folders,
    assignments,
  }
}

/** Initialize a signed-in user's layout cache without inheriting empty anonymous folders. */
export function migrateLegacyHomeProjectLayoutToUser(userId: string): void {
  if (typeof window === 'undefined') return
  const userKey = storageKeyForUser(userId)
  if (window.localStorage.getItem(userKey)) return
  const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY)
  try {
    const layout = legacy
      ? pruneEmptyFoldersFromHomeProjectLayout(normalizeHomeProjectLayout(JSON.parse(legacy)))
      : defaultLayout
    window.localStorage.setItem(userKey, JSON.stringify(layout))
  } catch {
    // ignore quota errors
  }
}

export function createFolderId(): string {
  return `folder-${createUuid()}`
}

export function assignProjectsToFolder(
  layout: HomeProjectLayout,
  projectKeys: string[],
  folderId: string | null
): HomeProjectLayout {
  const assignments = { ...layout.assignments }
  for (const key of projectKeys) {
    if (folderId == null) {
      delete assignments[key]
    } else {
      assignments[key] = folderId
    }
  }
  return { ...layout, assignments }
}



export function removeFolderFromLayout(layout: HomeProjectLayout, folderId: string): HomeProjectLayout {
  if (folderId === PERSONAL_PROJECTS_FOLDER_ID) return layout
  const assignments = { ...layout.assignments }
  for (const [key, value] of Object.entries(assignments)) {
    if (value === folderId) delete assignments[key]
  }
  return {
    ...layout,
    folders: layout.folders.filter((f) => f.id !== folderId),
    assignments,
  }
}

export function groupProjectsByFolder(
  projects: ProjectMetadata[],
  layout: HomeProjectLayout
): { folderId: string | null; folder: HomeFolder | null; projects: ProjectMetadata[] }[] {
  const folderIds = new Set(layout.folders.map((f) => f.id))
  const byFolder = new Map<string | null, ProjectMetadata[]>()

  for (const project of projects) {
    const key = projectLayoutKey(project)
    const folderId = layout.assignments[key]
    const resolved = folderId && folderIds.has(folderId) ? folderId : null
    const list = byFolder.get(resolved) ?? []
    list.push(project)
    byFolder.set(resolved, list)
  }

  const ungrouped = byFolder.get(null) ?? []
  const folderSections = layout.folders.map((folder) => ({
    folderId: folder.id,
    folder,
    projects: byFolder.get(folder.id) ?? [],
  }))

  return [
    { folderId: null, folder: null, projects: ungrouped },
    ...folderSections,
  ]
}

export function reorderFolders(
  layout: HomeProjectLayout,
  draggedFolderId: string,
  targetFolderId: string,
  placement: 'before' | 'after'
): HomeProjectLayout {
  if (draggedFolderId === targetFolderId) return layout
  const folders = [...layout.folders]
  const fromIndex = folders.findIndex((f) => f.id === draggedFolderId)
  let toIndex = folders.findIndex((f) => f.id === targetFolderId)
  if (fromIndex < 0 || toIndex < 0) return layout

  const [removed] = folders.splice(fromIndex, 1)
  if (!removed) return layout
  if (fromIndex < toIndex) toIndex -= 1
  if (placement === 'after') toIndex += 1
  folders.splice(toIndex, 0, removed)
  return { ...layout, folders }
}

export function toggleFolderCollapsed(
  layout: HomeProjectLayout,
  folderId: string
): HomeProjectLayout {
  return {
    ...layout,
    folders: layout.folders.map((f) =>
      f.id === folderId ? { ...f, collapsed: !f.collapsed } : f
    ),
  }
}
