import type { ProjectStorageMode } from '@/lib/projectStorage/types'
import type { Point2 } from '@/types/schema'
import { type Project } from './projectStoreTypes'

export const initialState = {
  currentProject: null as Project | null,
  lastWorkedCircuitId: null as string | null,
  currentProjectStorageMode: 'local' as ProjectStorageMode,
  isDirty: false,
  lastSaved: null as string | null,
  undoStack: [] as Project[],
  redoStack: [] as Project[],
  planFloorOverlayVisibleByBaseFloorId: {} as Record<string, string[]>,
  planCanvasPlanImageOffsetByFloorId: {} as Record<string, Point2>,
}
