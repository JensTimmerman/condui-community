import type { StoreApi } from 'zustand'
import type { Floor } from '@/types/schema'
import { useUIStore } from '@/stores/uiStore'
import { stripLazyElementGraphForRuntime } from '@/lib/projectV2/migration'
import { type Project, type ProjectState } from './projectStoreTypes'

export const MAX_HISTORY_ENTRIES = 100

export const cloneProjectForHistory = (project: Project): Project => {
  // structuredClone is generally faster than JSON roundtrips and preserves
  // more JS types (though our project is plain JSON-compatible data).
  // Fall back to JSON clone for older browsers.
  const snapshot =
    typeof structuredClone === 'function'
      ? structuredClone(project)
      : JSON.parse(JSON.stringify(project)) as Project
  stripLazyElementGraphForRuntime(snapshot)
  return snapshot
}

// Coalesce rapid-fire edits (typing, sliders) into a single undo entry.
// This avoids deep-cloning the entire project on every keystroke.
export const HISTORY_DEBOUNCE_MS = 400

class ProjectHistoryCoordinator {
  private recordingSuppressionDepth = 0
  private skipNextSubscriber = false
  private suppressNextDebouncedSubscriber = false
  private pendingTimer: number | null = null
  private pendingProject: Project | null = null

  isRecordingEnabled(): boolean {
    return this.recordingSuppressionDepth === 0
  }

  runWithoutRecording<T>(fn: () => T): T {
    this.recordingSuppressionDepth += 1
    try {
      return fn()
    } finally {
      this.recordingSuppressionDepth = Math.max(0, this.recordingSuppressionDepth - 1)
    }
  }

  skipNextSubscriberRun(): void {
    this.skipNextSubscriber = true
  }

  consumeSkipNextSubscriberRun(): boolean {
    const shouldSkip = this.skipNextSubscriber
    this.skipNextSubscriber = false
    if (shouldSkip) this.clearPending()
    return shouldSkip
  }

  suppressNextDebouncedRun(): void {
    this.suppressNextDebouncedSubscriber = true
  }

  consumeSuppressNextDebouncedRun(): boolean {
    const shouldSuppress = this.suppressNextDebouncedSubscriber
    this.suppressNextDebouncedSubscriber = false
    return shouldSuppress
  }

  clearDebouncedSuppression(): void {
    this.suppressNextDebouncedSubscriber = false
  }

  clearPending(): void {
    if (this.pendingTimer != null) {
      clearTimeout(this.pendingTimer)
      this.pendingTimer = null
    }
    this.pendingProject = null
  }

  flushPending(): void {
    if (this.pendingTimer != null) {
      clearTimeout(this.pendingTimer)
      this.pendingTimer = null
    }
    const toSnapshot = this.pendingProject
    this.pendingProject = null
    if (!toSnapshot) return
    pushUndoSnapshot(toSnapshot)
  }

  schedulePending(project: Project): void {
    this.pendingProject = project
    if (this.pendingTimer != null) clearTimeout(this.pendingTimer)
    this.pendingTimer = window.setTimeout(() => {
      this.flushPending()
    }, HISTORY_DEBOUNCE_MS)
  }
}

export const projectHistory = new ProjectHistoryCoordinator()

let projectStoreApi: StoreApi<ProjectState> | null = null

export function bindProjectStoreApi(api: StoreApi<ProjectState>): void {
  projectStoreApi = api
}

export function getProjectStoreApi(): StoreApi<ProjectState> {
  if (!projectStoreApi) throw new Error('Project store API requested before initialization')
  return projectStoreApi
}

export function appendUndoSnapshotInStore(
  set: (fn: (state: ProjectState) => void) => void,
  snapshotBefore: Project
): void {
  set((state) => {
    const nextUndoStack = [...state.undoStack, snapshotBefore]
    if (nextUndoStack.length > MAX_HISTORY_ENTRIES) nextUndoStack.shift()
    state.undoStack = nextUndoStack
    state.redoStack = []
  })
}

export function pushUndoSnapshot(snapshotProject: Project): void {
  const snapshot = cloneProjectForHistory(snapshotProject)
  getProjectStoreApi().setState((s: ProjectState) => {
    const nextUndoStack = [...s.undoStack, snapshot]
    if (nextUndoStack.length > MAX_HISTORY_ENTRIES) nextUndoStack.shift()
    return { undoStack: nextUndoStack, redoStack: [] }
  })
}

export function flushPendingProjectHistory(): void {
  projectHistory.flushPending()
}

/**
 * Merge consecutive undo snapshots from `startIndex` onward into a single step.
 * Used when a picker records exploratory edits that should undo atomically on exit.
 */
export function collapseUndoGroupFromIndex(startIndex: number): void {
  getProjectStoreApi().setState((state) => {
    if (startIndex < 0 || startIndex >= state.undoStack.length) return {}
    const baseline = state.undoStack[startIndex]
    if (!baseline) return {}
    return {
      undoStack: [...state.undoStack.slice(0, startIndex), baseline],
      redoStack: [],
    }
  })
}

export function clearStaleSelectionAfterProjectRestore(): void {
  const { selection, setSelection } = useUIStore.getState()
  if (!selection.type || selection.ids.length === 0) return

  const store = getProjectStoreApi().getState()
  if (selection.type === 'endpoint') {
    const hasMissing = selection.ids.some((id) => !store.getEndpointById(id))
    if (hasMissing) setSelection({ type: null, ids: [] })
    return
  }
  if (selection.type === 'placement') {
    const hasMissing = selection.ids.some((id) => !store.getPlacementById(id))
    if (hasMissing) setSelection({ type: null, ids: [] })
  }
}

export function floorHasReferenceOverlayContent(floor: Floor): boolean {
  if (floor.planAsset || floor.planImportAsset) return true
  const fp = floor.floorPlan
  if (!fp) return false
  return (
    (fp.walls?.length ?? 0) > 0 ||
    (fp.doors?.length ?? 0) > 0 ||
    (fp.windows?.length ?? 0) > 0 ||
    (fp.stairs?.length ?? 0) > 0
  )
}

export function findClosestNonEmptyBelow(floors: Floor[], startIndex: number): Floor | null {
  for (let i = startIndex; i < floors.length; i++) {
    const f = floors[i]
    if (f && floorHasReferenceOverlayContent(f)) return f
  }
  return null
}

export function findClosestNonEmptyAbove(floors: Floor[], startIndex: number): Floor | null {
  for (let i = startIndex; i >= 0; i--) {
    const f = floors[i]
    if (f && floorHasReferenceOverlayContent(f)) return f
  }
  return null
}

export function pickDefaultPlanReferenceOverlayFloor(floors: Floor[], baseFloorId: string): string | null {
  const idx = floors.findIndex((f) => f.id === baseFloorId)
  if (idx < 0) return null

  const immediateBelow = floors[idx + 1] ?? null
  if (immediateBelow) {
    if (floorHasReferenceOverlayContent(immediateBelow)) return immediateBelow.id
    const nonEmptyBelow = findClosestNonEmptyBelow(floors, idx + 1)
    return nonEmptyBelow?.id ?? immediateBelow.id
  }

  const immediateAbove = floors[idx - 1] ?? null
  if (immediateAbove) {
    if (floorHasReferenceOverlayContent(immediateAbove)) return immediateAbove.id
    const nonEmptyBelow = findClosestNonEmptyBelow(floors, idx + 1)
    if (nonEmptyBelow) return nonEmptyBelow.id
    const nonEmptyAbove = findClosestNonEmptyAbove(floors, idx - 1)
    return nonEmptyAbove?.id ?? immediateAbove.id
  }

  return null
}

export function sanitizeOverlayMap(
  overlayByBase: Record<string, string[]> | undefined,
  floors: Floor[]
): Record<string, string[]> {
  if (!overlayByBase) return {}
  const knownFloorIds = new Set(floors.map((f) => f.id))
  const sanitized: Record<string, string[]> = {}

  for (const [baseFloorId, overlayFloorIds] of Object.entries(overlayByBase)) {
    if (!knownFloorIds.has(baseFloorId)) continue
    const unique: string[] = []
    for (const floorId of overlayFloorIds ?? []) {
      if (!knownFloorIds.has(floorId) || floorId === baseFloorId || unique.includes(floorId))
        continue
      unique.push(floorId)
    }
    if (unique.length > 0) sanitized[baseFloorId] = unique
  }

  return sanitized
}
