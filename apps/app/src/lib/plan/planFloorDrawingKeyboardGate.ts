/**
 * While floor-plan wall/stair drawing handles Tab (axis / no browser focus),
 * global shortcuts must not also act on Tab — multiple window listeners on the
 * same phase all run; stopPropagation does not block siblings on window.
 */
export const planFloorDrawingConsumesTabRef = { current: false }

/** Floor-plan tools that use finger/mouse drag instead of single-finger canvas pan. */
export const FLOOR_PLAN_TOUCH_DRAG_TOOLS = [
  'drawWall',
  'drawWallRect',
  'drawStair',
  'drawGraphicElement',
  'insertDoor',
  'insertWindow',
] as const

export function isFloorPlanTouchDragTool(tool: string): boolean {
  return (FLOOR_PLAN_TOUCH_DRAG_TOOLS as readonly string[]).includes(tool)
}
