import type { Point2 } from '@/types/schema'

export const PLAN_WIRE_ARROW_LENGTH = 14
export const PLAN_WIRE_ARROW_WIDTH = 12

function unitVector(dx: number, dy: number): Point2 | null {
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return null
  return { x: dx / len, y: dy / len }
}

/**
 * Incoming direction at the wire end: unit vector from the last segment toward `end`.
 */
export function planWireIncomingAtEnd(end: Point2, beforeEnd: Point2): Point2 | null {
  return unitVector(end.x - beforeEnd.x, end.y - beforeEnd.y)
}

/** Cubic Bézier end tangent (parameter t → 1): 3 × (end − controlB). */
export function planWireSplineIncomingAtEnd(end: Point2, controlB: Point2): Point2 | null {
  return unitVector(end.x - controlB.x, end.y - controlB.y)
}

/**
 * V-shaped arrowhead at `end`. Apex sits on the endpoint; arms open along the incoming wire
 * and point away from the connection (back toward the wire source).
 */
export function buildPlanWireVArrowHead(
  end: Point2,
  incomingTowardEnd: Point2,
  options?: { length?: number; width?: number },
): number[] | null {
  const length = options?.length ?? PLAN_WIRE_ARROW_LENGTH
  const width = options?.width ?? PLAN_WIRE_ARROW_WIDTH
  const ux = incomingTowardEnd.x
  const uy = incomingTowardEnd.y
  if (Math.hypot(ux, uy) < 1e-6) return null

  const awayX = -ux
  const awayY = -uy
  const baseCenter = { x: end.x + awayX * length, y: end.y + awayY * length }
  const perpX = -awayY
  const perpY = awayX
  const half = width / 2

  return [
    baseCenter.x + perpX * half,
    baseCenter.y + perpY * half,
    end.x,
    end.y,
    baseCenter.x - perpX * half,
    baseCenter.y - perpY * half,
  ]
}
