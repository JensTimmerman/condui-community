import type { WireSegment } from '@/types/schema'

/**
 * Route decorations belong to the first physical run above a protection.
 * A circuit trunk may continue past that run to higher branches, while
 * `wireLabelEndPoint` records the first branch boundary for the run.
 */
export function getVerticalRouteIndicatorEndY(wireSegment: WireSegment): number {
  const fallbackEndY = wireSegment.endPoint.y
  const boundaryY = wireSegment.wireLabelEndPoint?.y
  if (boundaryY === undefined || !Number.isFinite(boundaryY)) return fallbackEndY

  const minY = Math.min(wireSegment.startPoint.y, fallbackEndY)
  const maxY = Math.max(wireSegment.startPoint.y, fallbackEndY)
  return boundaryY >= minY && boundaryY <= maxY ? boundaryY : fallbackEndY
}
