import type { Point2 } from '@/types/schema'

/**
 * Snap a point to the grid if grid snapping is enabled.
 * @param point The point to snap
 * @param gridSize The size of the grid
 * @param enabled Whether grid snapping is enabled
 * @returns The snapped point, or the original point if snapping is disabled
 */
export function snapToGrid(point: Point2, gridSize: number, enabled: boolean): Point2 {
  if (!enabled) return point
  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize,
  }
}

/** Snap a symbol placement center to the nearest grid intersection (hard snap). */
export function snapPlacementCenterToGrid(
  point: Point2,
  gridSize: number,
  enabled: boolean,
): Point2 {
  return snapToGrid(point, gridSize, enabled)
}
