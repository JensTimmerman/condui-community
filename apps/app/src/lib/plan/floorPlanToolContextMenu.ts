export type FloorPlanToolContextMenuAction = 'commitPenAndDropTool' | 'dropTool' | 'ignore'

const RIGHT_CLICK_EXIT_TOOLS = new Set([
  'drawWallRect',
  'drawStair',
  'insertDoor',
  'insertWindow',
  'insertPoint',
  'drawGraphicElement',
  'clipWall',
])

/** Resolve right-click behavior for the floor-plan drawing toolbar. */
export function resolveFloorPlanToolContextMenuAction(
  activeTool: string,
  penIsDrawing: boolean,
  penPointCount: number
): FloorPlanToolContextMenuAction {
  if (activeTool === 'drawWall') {
    if (!penIsDrawing || penPointCount === 0) return 'dropTool'
    if (penPointCount >= 2) return 'commitPenAndDropTool'
    return 'dropTool'
  }
  return RIGHT_CLICK_EXIT_TOOLS.has(activeTool) ? 'dropTool' : 'ignore'
}
