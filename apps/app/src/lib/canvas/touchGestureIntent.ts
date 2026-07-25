export type RecentTouchTap = {
  time: number
  clientX: number
  clientY: number
  elementId: string | null
}

export function isPotentialSecondTap(
  previous: RecentTouchTap | null,
  current: { time: number; clientX: number; clientY: number; elementId: string | null },
  maxDelayMs: number,
  slopPx: number
): boolean {
  return (
    previous != null &&
    current.time - previous.time <= maxDelayMs &&
    current.elementId === previous.elementId &&
    Math.hypot(current.clientX - previous.clientX, current.clientY - previous.clientY) <= slopPx
  )
}

export function shouldScheduleTouchLongPress(args: {
  enabled: boolean
  startedOnDraggable: boolean
  hasDuplicateDrag: boolean
  dragSelectFromContent: boolean
  potentialSecondTap: boolean
}): boolean {
  if (!args.enabled || args.potentialSecondTap) return false
  return !args.startedOnDraggable || args.hasDuplicateDrag || args.dragSelectFromContent
}

export function longPressTargetIsSelectionBackground(
  targetType: string | null,
  dragSelectFromContent: boolean
): boolean {
  return dragSelectFromContent && (targetType === 'panel' || targetType === 'supplyPanel')
}

export function shouldIgnoreCanvasTouchForContextMenu(
  contextMenuOpen: boolean,
  touchStartedInsideContextMenu: boolean
): boolean {
  return contextMenuOpen && touchStartedInsideContextMenu
}

export function shouldActivateSingleFingerPan(
  movementPx: number,
  thresholdPx: number,
  alreadyActive: boolean
): boolean {
  return !alreadyActive && movementPx > thresholdPx
}
