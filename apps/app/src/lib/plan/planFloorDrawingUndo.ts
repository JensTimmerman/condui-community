import type { Point2 } from '@/types/schema'
import type { ToolMode } from '@/components/plan/PlanImageTools'

export type FloorPlanWallDrawingState = {
  currentPoints: Point2[]
  isDrawing: boolean
  startPoint: Point2 | null
  rectStartPoint: Point2 | null
  pendingCurve?: boolean
}

export type FloorPlanDrawingUndoSnapshot = {
  wallDrawingState: FloorPlanWallDrawingState
  stairDrawingPoints: Point2[]
}

export type FloorPlanDrawingUndoHandlers = {
  tryUndo: () => boolean
  tryRedo: () => boolean
  pushBeforeMutation: () => void
  clearStacks: () => void
}

/** Global undo/redo delegates here while a floor-plan shape is still in progress. */
export const planFloorDrawingUndoRef: {
  current: FloorPlanDrawingUndoHandlers | null
} = { current: null }

export const MAX_FLOOR_PLAN_DRAWING_UNDO_ENTRIES = 100

export function cloneFloorPlanDrawingSnapshot(
  wallDrawingState: FloorPlanWallDrawingState,
  stairDrawingPoints: Point2[],
): FloorPlanDrawingUndoSnapshot {
  return {
    wallDrawingState: {
      ...wallDrawingState,
      currentPoints: wallDrawingState.currentPoints.map((p) => ({ ...p })),
      startPoint: wallDrawingState.startPoint ? { ...wallDrawingState.startPoint } : null,
      rectStartPoint: wallDrawingState.rectStartPoint
        ? { ...wallDrawingState.rectStartPoint }
        : null,
    },
    stairDrawingPoints: stairDrawingPoints.map((p) => ({ ...p })),
  }
}

export function isFloorPlanDrawingInProgress(
  activeTool: ToolMode,
  wallDrawingState: FloorPlanWallDrawingState,
  stairDrawingPoints: Point2[],
): boolean {
  if (activeTool === 'drawWall' && wallDrawingState.isDrawing) return true
  if (activeTool === 'drawWallRect' && wallDrawingState.rectStartPoint) return true
  if (activeTool === 'drawStair' && stairDrawingPoints.length > 0) return true
  return false
}
