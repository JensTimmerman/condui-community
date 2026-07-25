import type { Selection } from '@/types/ui'
import type { Frame, Note } from '@/types/schema'

export type EendraadAnnotationDeleteTarget = {
  eendraadNoteIds: string[]
  sitplanNoteIds: string[]
  frameIds: string[]
}

export type EendraadAnnotationDeleteGetters = {
  getEendraadNoteById: (id: string) => Note | undefined
  getSitplanNoteById: (id: string) => Note | undefined
  getFrameById: (id: string) => Frame | undefined
}

export type EendraadAnnotationDeleteActions = {
  deleteEendraadNotes: (ids: string[]) => void
  deleteSitplanNotes: (ids: string[]) => void
  deleteFrames: (ids: string[]) => void
}

export function resolveEendraadAnnotationDeleteTarget(
  selection: Selection,
  elementId: string | null,
  getters: EendraadAnnotationDeleteGetters
): EendraadAnnotationDeleteTarget {
  const ids = elementId ? [elementId] : selection.ids
  const target: EendraadAnnotationDeleteTarget = {
    eendraadNoteIds: [],
    sitplanNoteIds: [],
    frameIds: [],
  }

  for (const id of ids) {
    if (!id) continue
    if (getters.getFrameById(id)) {
      target.frameIds.push(id)
      continue
    }
    if (getters.getSitplanNoteById(id)) {
      target.sitplanNoteIds.push(id)
      continue
    }
    if (getters.getEendraadNoteById(id)) {
      target.eendraadNoteIds.push(id)
    }
  }

  return target
}

export function hasEendraadAnnotationDeleteTarget(
  target: EendraadAnnotationDeleteTarget
): boolean {
  return (
    target.eendraadNoteIds.length > 0 ||
    target.sitplanNoteIds.length > 0 ||
    target.frameIds.length > 0
  )
}

export function deleteEendraadAnnotationTarget(
  target: EendraadAnnotationDeleteTarget,
  actions: EendraadAnnotationDeleteActions
): void {
  if (target.eendraadNoteIds.length > 0) actions.deleteEendraadNotes(target.eendraadNoteIds)
  if (target.sitplanNoteIds.length > 0) actions.deleteSitplanNotes(target.sitplanNoteIds)
  if (target.frameIds.length > 0) actions.deleteFrames(target.frameIds)
}
